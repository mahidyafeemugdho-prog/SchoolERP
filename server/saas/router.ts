import express, { Response } from 'express';
import {
  AuthProviderInterface,
  DEFAULT_SUBSCRIPTION_PLANS,
  DatabaseProviderInterface,
  PlatformPaymentChannels,
  SaaSServiceError,
  SubscriptionPlanConfig,
  SubscriptionPlanId,
  getDefaultPlatformPaymentChannels,
} from './types';
import { createSaaSMiddleware, AuthenticatedRequest } from './middleware';
import { evaluateSubscriptionState } from './subscriptionService';
import { createTenantService } from './tenantService';
import { createPaymentService } from './paymentService';

export interface SaasRouterDeps {
  db: DatabaseProviderInterface;
  auth: AuthProviderInterface;
  nowProvider?: () => Date;
  adminSdkReady?: boolean;
}

function handleRouteError(res: Response, err: unknown) {
  if (err instanceof SaaSServiceError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      error: err.message,
      details: err.details,
    });
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[SaaS API Error]:', err);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    error: message,
  });
}

export function createSaasRouter(deps: SaasRouterDeps) {
  const router = express.Router();
  const nowProvider = deps.nowProvider ?? (() => new Date());
  const mw = createSaaSMiddleware(deps.auth, deps.db, nowProvider);
  const tenantService = createTenantService({
    db: deps.db,
    auth: deps.auth,
    nowProvider,
  });
  const paymentService = createPaymentService({
    db: deps.db,
    nowProvider,
  });

  // Public health & provider info
  router.get('/health', (_req, res) => {
    res.json({
      success: true,
      service: 'SmartSchoolBD Multi-Tenant SaaS API',
      dbProvider: deps.db.providerName,
      authProvider: deps.auth.providerName,
      adminSdkReady: deps.adminSdkReady ?? true,
      serverTime: nowProvider().toISOString(),
    });
  });

  const loadPaymentChannelsSafe = async (): Promise<PlatformPaymentChannels> => {
    try {
      return await deps.db.getPaymentChannels();
    } catch (dbErr: any) {
      if (dbErr instanceof SaaSServiceError && dbErr.code === 'ADMIN_SDK_UNAVAILABLE') {
        return getDefaultPlatformPaymentChannels();
      }
      throw dbErr;
    }
  };

  // Public / authenticated subscription plans catalog + platform MFS instructions
  router.get('/plans', async (_req, res) => {
    try {
      let plans: SubscriptionPlanConfig[];
      let catalogSource: 'database' | 'default_catalog' = 'database';
      try {
        plans = await deps.db.getPlans();
      } catch (dbErr: any) {
        if (dbErr instanceof SaaSServiceError && dbErr.code === 'ADMIN_SDK_UNAVAILABLE') {
          plans = DEFAULT_SUBSCRIPTION_PLANS;
          catalogSource = 'default_catalog';
        } else {
          throw dbErr;
        }
      }
      const channels = await loadPaymentChannelsSafe();
      res.json({
        success: true,
        source: catalogSource,
        plans: plans.filter((p) => p.isActive),
        platformPaymentChannels: {
          bkash: channels.bkash,
          nagad: channels.nagad,
          rocket: channels.rocket || '',
          bank: channels.bank,
          paymentInstruction: channels.paymentInstruction || '',
          supportPhone: channels.supportPhone,
          supportEmail: channels.supportEmail,
          updatedAt: channels.updatedAt,
          updatedBy: channels.updatedBy,
        },
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  /**
   * GET /api/saas/me
   * Resolves verified principal, assigned school tenant, and real-time subscription access state.
   */
  router.get('/me', mw.requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const principal = req.principal!;
      const now = nowProvider();
      const channels = await loadPaymentChannelsSafe();
      const platformSupportContact = {
        phone: channels.supportPhone,
        email: channels.supportEmail,
      };

      if (principal.isMasterAdmin) {
        return res.json({
          success: true,
          principal,
          school: null,
          subscription: null,
          accessAllowed: true,
          blockReason: null,
          platformSupportContact,
        });
      }

      if (!principal.schoolId) {
        return res.json({
          success: true,
          principal,
          school: null,
          subscription: null,
          accessAllowed: false,
          blockReason: 'NO_TENANT_ASSIGNED',
          platformSupportContact,
        });
      }

      const school = await deps.db.getSchoolById(principal.schoolId);
      if (!school) {
        return res.status(404).json({
          success: false,
          code: 'SCHOOL_NOT_FOUND',
          error: 'Assigned school tenant could not be found.',
        });
      }

      const subscription = evaluateSubscriptionState(school, now);
      let blockReason: string | null = null;
      if (!subscription.accessAllowed) {
        blockReason = subscription.isSuspended
          ? 'SCHOOL_SUSPENDED'
          : subscription.isPending
          ? 'SUBSCRIPTION_PENDING'
          : 'SUBSCRIPTION_EXPIRED';
      }

      return res.json({
        success: true,
        principal,
        school,
        subscription,
        accessAllowed: subscription.accessAllowed,
        blockReason,
        platformSupportContact,
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  /**
   * PATCH /api/saas/me/credentials
   * Allows any authenticated user (Master Admin, School Admin, Teacher, Student, Staff)
   * to update their own profile name, phone, email, or password.
   */
  router.patch('/me/credentials', mw.requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const updated = await tenantService.updateOwnCredentials(req.principal!, req.body || {});
      res.json({ success: true, user: updated });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // =========================================================================
  // MASTER ADMIN ENDPOINTS
  // =========================================================================

  router.get('/master/schools', mw.requireAuth, mw.requireMasterAdmin, async (req, res) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;

      const allSchools = await tenantService.listSchoolsWithState();
      const filtered = await tenantService.listSchoolsWithState({ search, status });
      const payments = await deps.db.listPaymentRequests();

      const approvedPayments = payments.filter((p) => p.status === 'approved');
      const totalRevenue = approvedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const pendingPaymentsCount = payments.filter((p) => p.status === 'pending').length;

      const planDistribution: Record<string, number> = {
        monthly: 0,
        quarterly: 0,
        half_yearly: 0,
        yearly: 0,
      };
      for (const s of allSchools) {
        const pid = s.subscription.planId;
        planDistribution[pid] = (planDistribution[pid] || 0) + 1;
      }

      const analytics = {
        totalSchools: allSchools.length,
        activeSchools: allSchools.filter((s) => s.computedSubscription.effectiveStatus === 'Active').length,
        expiredSchools: allSchools.filter((s) => s.computedSubscription.effectiveStatus === 'Expired').length,
        suspendedSchools: allSchools.filter((s) => s.computedSubscription.effectiveStatus === 'Suspended').length,
        pendingSchools: allSchools.filter((s) => s.computedSubscription.effectiveStatus === 'Pending').length,
        totalRevenue,
        pendingPaymentsCount,
        approvedPaymentsCount: approvedPayments.length,
        planDistribution,
      };

      res.json({
        success: true,
        schools: filtered,
        analytics,
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/master/schools', mw.requireAuth, mw.requireMasterAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const created = await tenantService.createSchool(req.body, req.principal!);
      const state = evaluateSubscriptionState(created, nowProvider());
      res.status(201).json({
        success: true,
        school: { ...created, computedSubscription: state },
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/master/schools/:schoolId', mw.requireAuth, mw.requireMasterAdmin, async (req, res) => {
    try {
      const schoolId = String(req.params.schoolId);
      const school = await deps.db.getSchoolById(schoolId);
      if (!school) {
        return res.status(404).json({ success: false, code: 'SCHOOL_NOT_FOUND', error: 'School not found.' });
      }
      const [paymentHistory, subscriptionHistory, users] = await Promise.all([
        deps.db.listPaymentRequests(schoolId),
        deps.db.listSubscriptionHistory(schoolId),
        deps.db.listSaaSUsersBySchool(schoolId),
      ]);
      res.json({
        success: true,
        school: {
          ...school,
          computedSubscription: evaluateSubscriptionState(school, nowProvider()),
        },
        paymentHistory,
        subscriptionHistory,
        users,
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch('/master/schools/:schoolId', mw.requireAuth, mw.requireMasterAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = String(req.params.schoolId);
      const updated = await tenantService.updateSchool(schoolId, req.body, req.principal!);
      res.json({
        success: true,
        school: {
          ...updated,
          computedSubscription: evaluateSubscriptionState(updated, nowProvider()),
        },
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.delete('/master/schools/:schoolId', mw.requireAuth, mw.requireMasterAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = String(req.params.schoolId);
      const result = await tenantService.deleteSchool(schoolId, req.principal!);
      res.json({
        success: true,
        deletedSchoolId: result.deletedSchoolId,
        deletedUsersCount: result.deletedUsersCount,
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/master/schools/:schoolId/history', mw.requireAuth, mw.requireMasterAdmin, async (req, res) => {
    try {
      const schoolId = String(req.params.schoolId);
      const [paymentHistory, subscriptionHistory] = await Promise.all([
        deps.db.listPaymentRequests(schoolId),
        deps.db.listSubscriptionHistory(schoolId),
      ]);
      res.json({ success: true, paymentHistory, subscriptionHistory });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/master/plans', mw.requireAuth, mw.requireMasterAdmin, async (_req, res) => {
    try {
      const plans = await deps.db.getPlans();
      res.json({ success: true, plans });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.put('/master/plans/:planId', mw.requireAuth, mw.requireMasterAdmin, async (req, res) => {
    try {
      const planId = String(req.params.planId) as SubscriptionPlanId;
      const existing = await deps.db.getPlanById(planId);
      if (!existing) {
        return res.status(404).json({ success: false, code: 'PLAN_NOT_FOUND', error: 'Plan not found.' });
      }
      const updated = await deps.db.upsertPlan({
        ...existing,
        name: req.body.name?.trim() || existing.name,
        nameBn: req.body.nameBn?.trim() || existing.nameBn,
        priceBdt: Number(req.body.priceBdt) >= 0 ? Number(req.body.priceBdt) : existing.priceBdt,
        durationDays: Number(req.body.durationDays) > 0 ? Number(req.body.durationDays) : existing.durationDays,
        description: req.body.description ?? existing.description,
        descriptionBn: req.body.descriptionBn ?? existing.descriptionBn,
        isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : existing.isActive,
        updatedAt: nowProvider().toISOString(),
      });
      res.json({ success: true, plan: updated });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/master/payment-channels', mw.requireAuth, mw.requireMasterAdmin, async (_req, res) => {
    try {
      const channels = await deps.db.getPaymentChannels();
      res.json({ success: true, channels });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.put(
    '/master/payment-channels',
    mw.requireAuth,
    mw.requireMasterAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const existing = await deps.db.getPaymentChannels();
        const body = req.body || {};

        const bkash = typeof body.bkash === 'string' ? body.bkash.trim() : existing.bkash;
        const nagad = typeof body.nagad === 'string' ? body.nagad.trim() : existing.nagad;
        const rocket = typeof body.rocket === 'string' ? body.rocket.trim() : existing.rocket || '';
        const bank = typeof body.bank === 'string' ? body.bank.trim() : existing.bank;
        const paymentInstruction =
          typeof body.paymentInstruction === 'string'
            ? body.paymentInstruction.trim()
            : existing.paymentInstruction || '';
        const supportPhone =
          typeof body.supportPhone === 'string' ? body.supportPhone.trim() : existing.supportPhone;
        const supportEmail =
          typeof body.supportEmail === 'string' ? body.supportEmail.trim() : existing.supportEmail;

        if (!bkash && !nagad && !bank && !rocket) {
          throw new SaaSServiceError(
            'At least one payment channel (bKash, Nagad, Rocket, or Bank) is required.',
            400,
            'PAYMENT_CHANNEL_REQUIRED'
          );
        }
        if (!supportPhone) {
          throw new SaaSServiceError(
            'Support phone number is required.',
            400,
            'SUPPORT_PHONE_REQUIRED'
          );
        }
        if (!supportEmail || !supportEmail.includes('@')) {
          throw new SaaSServiceError(
            'A valid support email address is required.',
            400,
            'INVALID_SUPPORT_EMAIL'
          );
        }

        const saved = await deps.db.savePaymentChannels({
          bkash,
          nagad,
          rocket,
          bank,
          paymentInstruction,
          supportPhone,
          supportEmail,
          updatedAt: nowProvider().toISOString(),
          updatedBy: req.principal!.email,
        });
        res.json({ success: true, channels: saved });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get('/master/payment-requests', mw.requireAuth, mw.requireMasterAdmin, async (req, res) => {
    try {
      const schoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      let requests = await deps.db.listPaymentRequests(schoolId);
      if (status && status !== 'all') {
        requests = requests.filter((r) => r.status === status);
      }
      res.json({ success: true, paymentRequests: requests });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post(
    '/master/payment-requests/:id/approve',
    mw.requireAuth,
    mw.requireMasterAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const requestId = String(req.params.id);
        if (req.body?.action === 'reject') {
          const rejected = await paymentService.rejectPaymentRequest(
            requestId,
            req.body?.rejectionReason || 'Rejected by Master Admin',
            req.principal!
          );
          return res.json({ success: true, paymentRequest: rejected });
        }
        const result = await paymentService.approvePaymentRequest(requestId, req.principal!);
        res.json({
          success: true,
          paymentRequest: result.paymentRequest,
          school: {
            ...result.school,
            computedSubscription: evaluateSubscriptionState(result.school, nowProvider()),
          },
        });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/master/payment-requests/:id/reject',
    mw.requireAuth,
    mw.requireMasterAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const requestId = String(req.params.id);
        const rejected = await paymentService.rejectPaymentRequest(
          requestId,
          req.body?.rejectionReason || 'Transaction could not be verified',
          req.principal!
        );
        res.json({ success: true, paymentRequest: rejected });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // =========================================================================
  // SCHOOL PAYMENT REQUEST ENDPOINTS (Accessible even when expired for renewal)
  // =========================================================================

  router.post('/payment-requests', mw.requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const created = await paymentService.submitPaymentRequest(req.body, req.principal!);
      res.status(201).json({ success: true, paymentRequest: created });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/my-payment-request', mw.requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const principal = req.principal!;
      if (!principal.schoolId) {
        return res.status(403).json({
          success: false,
          code: 'NO_TENANT_CONTEXT',
          error: 'Only school accounts have tenant payment requests.',
        });
      }
      const [paymentRequests, subscriptionHistory] = await Promise.all([
        deps.db.listPaymentRequests(principal.schoolId),
        deps.db.listSubscriptionHistory(principal.schoolId),
      ]);
      res.json({
        success: true,
        schoolId: principal.schoolId,
        paymentRequests,
        subscriptionHistory,
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // =========================================================================
  // STAFF & USER ACCOUNT PROVISIONING (Active Subscription Required)
  // =========================================================================

  router.post(
    '/users',
    mw.requireAuth,
    mw.requireActiveTenantSubscription,
    mw.requireRole(['super_admin', 'admin']),
    async (req: AuthenticatedRequest, res) => {
      try {
        const created = await tenantService.provisionTenantUser(req.body, req.principal!);
        res.status(201).json({ success: true, user: created });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.get(
    '/users',
    mw.requireAuth,
    mw.requireActiveTenantSubscription,
    mw.requireRole(['super_admin', 'admin']),
    async (req: AuthenticatedRequest, res) => {
      try {
        const principal = req.principal!;
        const targetSchoolId = principal.isMasterAdmin
          ? String(req.query.schoolId || '')
          : principal.schoolId || '';
        if (!targetSchoolId) {
          return res.status(400).json({ success: false, code: 'MISSING_SCHOOL_ID', error: 'schoolId is required.' });
        }
        const users = await deps.db.listSaaSUsersBySchool(targetSchoolId);
        res.json({ success: true, users });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.patch(
    '/users/:uid/status',
    mw.requireAuth,
    mw.requireActiveTenantSubscription,
    mw.requireRole(['super_admin', 'admin']),
    async (req: AuthenticatedRequest, res) => {
      try {
        const uid = String(req.params.uid);
        const disabled = Boolean(req.body?.disabled);
        const updated = await tenantService.setTenantUserStatus(uid, disabled, req.principal!);
        res.json({ success: true, user: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.patch(
    '/users/:uid/credentials',
    mw.requireAuth,
    mw.requireActiveTenantSubscription,
    mw.requireRole(['super_admin', 'admin']),
    async (req: AuthenticatedRequest, res) => {
      try {
        const uid = String(req.params.uid);
        const updated = await tenantService.updateTenantUserCredentials(uid, req.body || {}, req.principal!);
        res.json({ success: true, user: updated });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.delete(
    '/users/:uid',
    mw.requireAuth,
    mw.requireActiveTenantSubscription,
    mw.requireRole(['super_admin', 'admin']),
    async (req: AuthenticatedRequest, res) => {
      try {
        const uid = String(req.params.uid);
        const result = await tenantService.deleteTenantUser(uid, req.principal!);
        res.json({ success: true, ...result });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // =========================================================================
  // TENANT-ISOLATED ERP DATA API (VPS Parity + Server-Side Enforcement)
  // =========================================================================

  router.get(
    '/tenant/slices',
    mw.requireAuth,
    mw.requireActiveTenantSubscription,
    async (req: AuthenticatedRequest, res) => {
      try {
        const principal = req.principal!;
        const requestedSchoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId : undefined;
        if (requestedSchoolId && !principal.isMasterAdmin && requestedSchoolId !== principal.schoolId) {
          return res.status(403).json({
            success: false,
            code: 'CROSS_TENANT_FORBIDDEN',
            error: 'Cross-school data access is strictly prohibited.',
          });
        }
        const targetSchoolId = principal.isMasterAdmin
          ? requestedSchoolId || principal.schoolId
          : principal.schoolId;

        if (!targetSchoolId) {
          return res.status(400).json({ success: false, code: 'MISSING_SCHOOL_ID', error: 'schoolId is required.' });
        }

        const slices = await deps.db.getTenantSlices(targetSchoolId);
        res.json({ success: true, schoolId: targetSchoolId, slices });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.put(
    '/tenant/slices/:sliceName',
    mw.requireAuth,
    mw.requireActiveTenantSubscription,
    async (req: AuthenticatedRequest, res) => {
      try {
        const principal = req.principal!;
        const sliceName = String(req.params.sliceName).replace(/[^a-zA-Z0-9_-]/g, '');
        if (!sliceName) {
          return res.status(400).json({ success: false, code: 'INVALID_SLICE', error: 'Invalid slice name.' });
        }
        if (!principal.schoolId && !principal.isMasterAdmin) {
          return res.status(403).json({ success: false, code: 'NO_TENANT_CONTEXT', error: 'No tenant context.' });
        }
        const targetSchoolId = principal.isMasterAdmin
          ? String(req.body?.schoolId || principal.schoolId || '')
          : principal.schoolId!;

        if (!targetSchoolId) {
          return res.status(400).json({ success: false, code: 'MISSING_SCHOOL_ID', error: 'schoolId is required.' });
        }

        // Prevent cross-school overwrite via body payload
        if (!principal.isMasterAdmin && req.body?.schoolId && req.body.schoolId !== principal.schoolId) {
          return res.status(403).json({
            success: false,
            code: 'CROSS_TENANT_FORBIDDEN',
            error: 'Cannot write to another school tenant.',
          });
        }

        await deps.db.saveTenantSlice(targetSchoolId, sliceName, req.body || {});
        res.json({ success: true, schoolId: targetSchoolId, sliceName });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // =========================================================================
  // GUARDIAN ONLINE FEE PAYMENTS (bKash / Nagad / Rocket -> Super Admin)
  // Allows verified guardians/students/staff to submit fee payment requests
  // securely through Admin SDK into schools/{schoolId}/slices/online_payments
  // so Super Admin receives instant real-time notifications across devices.
  // =========================================================================

  router.get(
    '/tenant/online-payments',
    mw.requireAuth,
    mw.requireActiveTenantSubscription,
    async (req: AuthenticatedRequest, res) => {
      try {
        const principal = req.principal!;
        const requestedSchoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId : undefined;
        if (requestedSchoolId && !principal.isMasterAdmin && requestedSchoolId !== principal.schoolId) {
          return res.status(403).json({
            success: false,
            code: 'CROSS_TENANT_FORBIDDEN',
            error: 'Cross-school data access is strictly prohibited.',
          });
        }
        const targetSchoolId = principal.isMasterAdmin
          ? requestedSchoolId || principal.schoolId
          : principal.schoolId;

        if (!targetSchoolId) {
          return res.status(403).json({ success: false, code: 'NO_TENANT_CONTEXT', error: 'No tenant context.' });
        }

        const slices = await deps.db.getTenantSlices(targetSchoolId);
        const dedicated = Array.isArray(slices.online_payments?.school_erp_online_payment_requests)
          ? slices.online_payments.school_erp_online_payment_requests
          : null;
        const legacy = Array.isArray(slices.finance?.school_erp_online_payment_requests)
          ? slices.finance.school_erp_online_payment_requests
          : [];
        const requests = dedicated ?? legacy;

        return res.json({
          success: true,
          schoolId: targetSchoolId,
          requests,
        });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/tenant/online-payments',
    mw.requireAuth,
    mw.requireActiveTenantSubscription,
    async (req: AuthenticatedRequest, res) => {
      try {
        const principal = req.principal!;
        if (!principal.schoolId && !principal.isMasterAdmin) {
          return res.status(403).json({ success: false, code: 'NO_TENANT_CONTEXT', error: 'No tenant context.' });
        }
        if (!principal.isMasterAdmin && req.body?.schoolId && req.body.schoolId !== principal.schoolId) {
          return res.status(403).json({
            success: false,
            code: 'CROSS_TENANT_FORBIDDEN',
            error: 'Cannot submit payment to another school tenant.',
          });
        }

        const targetSchoolId = principal.isMasterAdmin
          ? String(req.body?.schoolId || principal.schoolId || '')
          : principal.schoolId!;

        if (!targetSchoolId) {
          return res.status(400).json({ success: false, code: 'MISSING_SCHOOL_ID', error: 'schoolId is required.' });
        }

        const body = req.body || {};
        const paymentMethod = String(body.paymentMethod || '').trim();
        if (!['bKash', 'Nagad', 'Rocket'].includes(paymentMethod)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_PAYMENT_METHOD',
            error: 'Payment method must be bKash, Nagad, or Rocket.',
          });
        }

        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_AMOUNT',
            error: 'Payment amount must be a positive number.',
          });
        }

        const senderPhone = String(body.senderPhone || '').trim();
        const cleanTrx = String(body.transactionId || '').trim().toUpperCase();
        const studentId = String(body.studentId || '').trim();
        const studentName = String(body.studentName || '').trim();
        const feeTitle = String(body.feeTitle || '').trim();

        if (!senderPhone || !cleanTrx || !studentId || !studentName || !feeTitle) {
          return res.status(400).json({
            success: false,
            code: 'MISSING_FIELDS',
            error: 'senderPhone, transactionId, studentId, studentName, and feeTitle are required.',
          });
        }

        const nowIso = nowProvider().toISOString();
        const slices = await deps.db.getTenantSlices(targetSchoolId);
        const dedicatedList: any[] = Array.isArray(slices.online_payments?.school_erp_online_payment_requests)
          ? slices.online_payments.school_erp_online_payment_requests
          : [];
        const legacyList: any[] = Array.isArray(slices.finance?.school_erp_online_payment_requests)
          ? slices.finance.school_erp_online_payment_requests
          : [];

        // Merge any legacy finance requests if dedicated slice doesn't have them yet
        const mergedMap = new Map<string, any>();
        for (const item of [...dedicatedList, ...legacyList]) {
          if (item && item.id && !mergedMap.has(String(item.id))) {
            mergedMap.set(String(item.id), item);
          }
        }
        const currentList = Array.from(mergedMap.values());

        const duplicateTrx = currentList.find(
          (r) =>
            r &&
            String(r.transactionId || '').trim().toUpperCase() === cleanTrx &&
            r.status !== 'rejected'
        );
        if (duplicateTrx) {
          return res.status(409).json({
            success: false,
            code: 'DUPLICATE_TRANSACTION_ID',
            error: 'এই ট্রানজেকশন আইডি (TrxID) ইতিমধ্যে ব্যবহৃত হয়েছে। সঠিক TrxID দিন।',
          });
        }

        const requestId =
          typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `opr_${Date.now()}`;
        const receiptNo =
          typeof body.receiptNo === 'string' && body.receiptNo.trim()
            ? body.receiptNo.trim()
            : `REQ-${Date.now().toString().slice(-6)}`;

        const newRequest = {
          id: requestId,
          receiptNo,
          studentId,
          studentName,
          studentRoll: String(body.studentRoll || '').trim(),
          className: String(body.className || '').trim(),
          section: String(body.section || '').trim(),
          feeTitle,
          amount,
          ...(Array.isArray(body.items) && body.items.length > 0 ? { items: body.items } : {}),
          ...(body.isPayAll !== undefined ? { isPayAll: Boolean(body.isPayAll) } : {}),
          paymentMethod,
          senderPhone,
          transactionId: cleanTrx,
          requestDate:
            typeof body.requestDate === 'string' && body.requestDate.trim()
              ? body.requestDate.trim()
              : nowIso.split('T')[0],
          status: 'pending' as const,
          notes:
            typeof body.notes === 'string' && body.notes.trim()
              ? body.notes.trim()
              : `Guardian online payment request via ${paymentMethod}`,
          submittedByUid: principal.uid,
          submittedByRole: principal.schoolRole || 'guardian',
          createdAt: nowIso,
        };

        const updatedList = [newRequest, ...currentList.filter((r) => r.id !== requestId)];

        await deps.db.saveTenantSlice(targetSchoolId, 'online_payments', {
          school_erp_online_payment_requests: updatedList,
          __chunked: false,
          chunkCount: 0,
          tenantId: targetSchoolId,
          domain: 'server',
          deviceId: 'server_online_payment',
          updatedAt: nowIso,
        });

        return res.status(201).json({
          success: true,
          schoolId: targetSchoolId,
          request: newRequest,
        });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // =========================================================================
  // HOMEWORK SUBMISSIONS & AI EVALUATIONS (Student / Guardian / Teacher Sync)
  // Allows verified students/guardians/staff to persist homework submissions
  // and AI evaluation marks into schools/{schoolId}/slices/homework_submissions
  // via Admin SDK, bypassing client Firestore staff-only slice write rules.
  // =========================================================================

  router.get(
    '/tenant/homework-submissions',
    mw.requireAuth,
    mw.requireActiveTenantSubscription,
    async (req: AuthenticatedRequest, res) => {
      try {
        const principal = req.principal!;
        const requestedSchoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId : undefined;
        if (requestedSchoolId && !principal.isMasterAdmin && requestedSchoolId !== principal.schoolId) {
          return res.status(403).json({
            success: false,
            code: 'CROSS_TENANT_FORBIDDEN',
            error: 'Cross-school data access is strictly prohibited.',
          });
        }
        const targetSchoolId = principal.isMasterAdmin
          ? requestedSchoolId || principal.schoolId
          : principal.schoolId;

        if (!targetSchoolId) {
          return res.status(403).json({ success: false, code: 'NO_TENANT_CONTEXT', error: 'No tenant context.' });
        }

        const slices = await deps.db.getTenantSlices(targetSchoolId);
        const dedicated: any[] = Array.isArray(slices.homework_submissions?.school_erp_homework_submissions)
          ? slices.homework_submissions.school_erp_homework_submissions
          : [];
        const legacy: any[] = Array.isArray(slices.finance?.school_erp_homework_submissions)
          ? slices.finance.school_erp_homework_submissions
          : [];

        const merged = new Map<string, any>();
        for (const item of [...legacy, ...dedicated]) {
          if (!item || !item.id) continue;
          const key = item.homeworkId && item.studentId ? `${item.homeworkId}::${item.studentId}` : String(item.id);
          merged.set(key, item);
        }

        return res.json({
          success: true,
          schoolId: targetSchoolId,
          submissions: Array.from(merged.values()),
        });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/tenant/homework-submissions',
    mw.requireAuth,
    mw.requireActiveTenantSubscription,
    async (req: AuthenticatedRequest, res) => {
      try {
        const principal = req.principal!;
        if (!principal.schoolId && !principal.isMasterAdmin) {
          return res.status(403).json({ success: false, code: 'NO_TENANT_CONTEXT', error: 'No tenant context.' });
        }
        if (!principal.isMasterAdmin && req.body?.schoolId && req.body.schoolId !== principal.schoolId) {
          return res.status(403).json({
            success: false,
            code: 'CROSS_TENANT_FORBIDDEN',
            error: 'Cannot submit homework to another school tenant.',
          });
        }

        const targetSchoolId = principal.isMasterAdmin
          ? String(req.body?.schoolId || principal.schoolId || '')
          : principal.schoolId!;

        if (!targetSchoolId) {
          return res.status(400).json({ success: false, code: 'MISSING_SCHOOL_ID', error: 'schoolId is required.' });
        }

        const body = req.body || {};
        const homeworkId = String(body.homeworkId || '').trim();
        const studentId = String(body.studentId || '').trim();
        const studentName = String(body.studentName || '').trim();
        const className = String(body.className || '').trim();

        if (!homeworkId || !studentId || !studentName || !className) {
          return res.status(400).json({
            success: false,
            code: 'MISSING_FIELDS',
            error: 'homeworkId, studentId, studentName, and className are required.',
          });
        }

        const hasText = typeof body.textAnswer === 'string' && body.textAnswer.trim().length > 0;
        const hasImages = Array.isArray(body.imageUrls) && body.imageUrls.length > 0;
        if (!hasText && !hasImages) {
          return res.status(400).json({
            success: false,
            code: 'EMPTY_SUBMISSION',
            error: 'Either textAnswer or at least one image is required.',
          });
        }

        const nowIso = nowProvider().toISOString();
        const slices = await deps.db.getTenantSlices(targetSchoolId);
        const dedicatedList: any[] = Array.isArray(slices.homework_submissions?.school_erp_homework_submissions)
          ? slices.homework_submissions.school_erp_homework_submissions
          : [];
        const legacyList: any[] = Array.isArray(slices.finance?.school_erp_homework_submissions)
          ? slices.finance.school_erp_homework_submissions
          : [];

        const mergedMap = new Map<string, any>();
        for (const item of [...legacyList, ...dedicatedList]) {
          if (item && item.id) {
            const key =
              item.homeworkId && item.studentId
                ? `${item.homeworkId}::${item.studentId}`
                : String(item.id);
            mergedMap.set(key, item);
          }
        }

        const dedupKey = `${homeworkId}::${studentId}`;
        const existing = mergedMap.get(dedupKey) || Array.from(mergedMap.values()).find((s) => s.id === body.id);

        const submissionId =
          existing?.id ||
          (typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `sub_${Date.now()}_${studentId}`);

        const nextVersion = existing
          ? Math.max(Number(existing.version || 1), Number(body.version || 1)) +
            (body.aiEvaluation && !existing.aiEvaluation ? 0 : 1)
          : Number(body.version || 1);

        const allowedStatuses = new Set([
          'submitted',
          'ai_evaluated',
          'approved',
          'rejected',
          'resubmission_requested',
          'review_required',
          'pending',
        ]);
        const status =
          typeof body.status === 'string' && allowedStatuses.has(body.status) ? body.status : 'submitted';

        const savedSubmission: Record<string, any> = {
          id: submissionId,
          homeworkId,
          studentId,
          ...(typeof body.studentCode === 'string' && body.studentCode.trim()
            ? { studentCode: body.studentCode.trim() }
            : {}),
          studentName,
          studentRoll: String(body.studentRoll || '').trim(),
          className,
          section: String(body.section || '').trim(),
          submissionDate:
            typeof body.submissionDate === 'string' && body.submissionDate.trim()
              ? body.submissionDate.trim()
              : nowIso.replace('T', ' ').slice(0, 16),
          submissionType:
            typeof body.submissionType === 'string' && body.submissionType.trim()
              ? body.submissionType.trim()
              : hasImages
              ? 'handwritten_image'
              : 'text',
          imageUrls: Array.isArray(body.imageUrls)
            ? body.imageUrls.filter((u: unknown) => typeof u === 'string' && u.length > 0).slice(0, 8)
            : [],
          textAnswer: typeof body.textAnswer === 'string' ? body.textAnswer : '',
          ...(typeof body.attachmentName === 'string' && body.attachmentName.trim()
            ? { attachmentName: body.attachmentName.trim() }
            : {}),
          status,
          version: nextVersion,
          ...(body.aiEvaluation && typeof body.aiEvaluation === 'object' ? { aiEvaluation: body.aiEvaluation } : {}),
          ...(body.teacherMarks !== undefined && body.teacherMarks !== null
            ? { teacherMarks: Number(body.teacherMarks) }
            : {}),
          ...(typeof body.teacherFeedback === 'string' ? { teacherFeedback: body.teacherFeedback } : {}),
          ...(typeof body.reviewedBy === 'string' ? { reviewedBy: body.reviewedBy } : {}),
          ...(typeof body.reviewedAt === 'string' ? { reviewedAt: body.reviewedAt } : {}),
          submittedByUid: principal.uid,
          submittedByRole: principal.schoolRole || 'student',
          updatedAt: nowIso,
        };

        mergedMap.set(dedupKey, savedSubmission);
        const updatedList = Array.from(mergedMap.values()).sort((a, b) =>
          String(b.submissionDate || '').localeCompare(String(a.submissionDate || ''))
        );

        await deps.db.saveTenantSlice(targetSchoolId, 'homework_submissions', {
          school_erp_homework_submissions: updatedList,
          __chunked: false,
          chunkCount: 0,
          tenantId: targetSchoolId,
          domain: 'server',
          deviceId: 'server_homework_submission',
          updatedAt: nowIso,
        });

        return res.status(201).json({
          success: true,
          schoolId: targetSchoolId,
          submission: savedSubmission,
          submissions: updatedList,
        });
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  return router;
}
