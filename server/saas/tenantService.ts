import {
  AuthPrincipal,
  AuthProviderInterface,
  CreateSchoolInput,
  CreateTenantUserInput,
  DatabaseProviderInterface,
  SaaSServiceError,
  SaaSUserRecord,
  SchoolTenantRecord,
  UpdateOwnCredentialsInput,
  UpdateSchoolInput,
  UpdateTenantUserCredentialsInput,
} from './types';
import { addDaysUtc, evaluateSubscriptionState } from './subscriptionService';

export interface TenantServiceDeps {
  db: DatabaseProviderInterface;
  auth: AuthProviderInterface;
  nowProvider?: () => Date;
}

const ALLOWED_SCHOOL_ROLES = new Set([
  'super_admin',
  'admin',
  'teacher',
  'accountant',
  'staff',
  'student',
  'guardian',
  'librarian',
  'receptionist',
  'gatekeeper',
]);

export function createTenantService(deps: TenantServiceDeps) {
  const getNow = deps.nowProvider ?? (() => new Date());

  return {
    async createSchool(
      input: CreateSchoolInput,
      actor: AuthPrincipal
    ): Promise<SchoolTenantRecord> {
      const schoolName = (input.schoolName || '').trim();
      const schoolCode = (input.schoolCode || '').trim().toUpperCase();
      const address = (input.address || '').trim();
      const contactNumber = (input.contactNumber || '').trim();
      const email = (input.email || '').trim().toLowerCase();
      const principalName = (input.principalName || '').trim();
      const adminName = (input.adminName || '').trim();
      const adminEmail = (input.adminEmail || '').trim().toLowerCase();
      const adminPassword = input.adminPassword || '';

      if (
        !schoolName ||
        !schoolCode ||
        !address ||
        !contactNumber ||
        !email ||
        !principalName ||
        !adminName ||
        !adminEmail ||
        !adminPassword
      ) {
        throw new SaaSServiceError(
          'All required school and administrator fields must be provided.',
          400,
          'VALIDATION_ERROR'
        );
      }

      if (adminPassword.length < 6) {
        throw new SaaSServiceError(
          'Admin password must be at least 6 characters.',
          400,
          'WEAK_PASSWORD'
        );
      }

      // 1. Prevent duplicate school code
      const existingCode = await deps.db.getSchoolByCode(schoolCode);
      if (existingCode) {
        throw new SaaSServiceError(
          `School code "${schoolCode}" is already registered.`,
          409,
          'DUPLICATE_SCHOOL_CODE'
        );
      }

      // 2. Prevent duplicate admin email
      const existingSaasUser = await deps.db.getSaaSUserByEmail(adminEmail);
      const existingAuthUser = await deps.auth.getUserByEmail(adminEmail);
      if (existingSaasUser || existingAuthUser) {
        throw new SaaSServiceError(
          `Administrator email "${adminEmail}" is already registered.`,
          409,
          'DUPLICATE_ADMIN_EMAIL'
        );
      }

      // 3. Validate plan
      const plan = await deps.db.getPlanById(input.initialPlan);
      if (!plan) {
        throw new SaaSServiceError(
          `Invalid subscription plan "${input.initialPlan}".`,
          400,
          'INVALID_PLAN'
        );
      }

      const now = getNow();
      const startDateObj = input.startDate ? new Date(input.startDate) : now;
      if (Number.isNaN(startDateObj.getTime())) {
        throw new SaaSServiceError('Invalid startDate format.', 400, 'INVALID_DATE');
      }

      const expiryDateObj = input.expiryDate
        ? new Date(input.expiryDate)
        : addDaysUtc(startDateObj, plan.durationDays);
      if (Number.isNaN(expiryDateObj.getTime()) || expiryDateObj.getTime() <= startDateObj.getTime()) {
        throw new SaaSServiceError(
          'Subscription expiryDate must be after startDate.',
          400,
          'INVALID_DATE'
        );
      }

      // 4. Generate unique schoolId (SCH001, SCH002...)
      const schoolId = await deps.db.getNextSchoolId();

      // 5. Create School Admin Firebase Auth account and assign custom claims
      const createdAuthUser = await deps.auth.createUser({
        email: adminEmail,
        password: adminPassword,
        displayName: adminName,
      });

      await deps.auth.setCustomClaims(createdAuthUser.uid, {
        schoolId,
        schoolRole: 'super_admin',
        isMasterAdmin: false,
      });

      const activateNow = input.activateImmediately !== false;
      const nowIso = now.toISOString();

      const schoolRecord: SchoolTenantRecord = {
        schoolId,
        schoolCode,
        schoolName,
        address,
        contactNumber,
        email,
        principalName,
        adminName,
        adminEmail,
        adminUid: createdAuthUser.uid,
        status: activateNow ? 'active' : 'pending',
        subscription: {
          planId: plan.id,
          planName: plan.name,
          status: activateNow ? 'Active' : 'Pending',
          startDate: startDateObj.toISOString(),
          expiryDate: expiryDateObj.toISOString(),
          lastPaymentDate: activateNow ? nowIso : null,
          nextRenewalDate: expiryDateObj.toISOString(),
          amountBdt: plan.priceBdt,
        },
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: actor.email || actor.uid,
      };

      await deps.db.createSchool(schoolRecord);

      // 6. Store school admin profile record (without plaintext password)
      const adminUserRecord: SaaSUserRecord = {
        uid: createdAuthUser.uid,
        email: adminEmail,
        displayName: adminName,
        schoolId,
        schoolRole: 'super_admin',
        phone: contactNumber,
        status: 'active',
        createdAt: nowIso,
        createdBy: actor.email || actor.uid,
        updatedAt: nowIso,
      };
      await deps.db.createSaaSUserRecord(adminUserRecord);

      // 7. Initialize isolated tenant profile slice
      await deps.db.saveTenantSlice(schoolId, 'profile', {
        school_erp_profile: {
          id: schoolId,
          nameEn: schoolName,
          nameBn: schoolName,
          eiin: schoolCode,
          schoolCode,
          addressEn: address,
          addressBn: address,
          phone: contactNumber,
          email,
          website: '',
          principalNameEn: principalName,
          principalNameBn: principalName,
          establishedYear: String(now.getUTCFullYear()),
          currentSession: String(now.getUTCFullYear()),
          currencySymbol: '৳',
          timezone: 'Asia/Dhaka',
          isSaturdayOff: true,
        },
      });

      // 8. Append subscription audit history
      await deps.db.appendSubscriptionHistory({
        id: `hist_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
        schoolId,
        schoolName,
        eventType: 'school_created',
        planId: plan.id,
        planName: plan.name,
        previousExpiryDate: null,
        newExpiryDate: expiryDateObj.toISOString(),
        durationDaysAdded: plan.durationDays,
        amount: plan.priceBdt,
        actorUid: actor.uid,
        actorEmail: actor.email,
        remarks: activateNow
          ? `School created and activated on ${plan.name}`
          : `School created with Pending activation on ${plan.name}`,
        createdAt: nowIso,
      });

      return schoolRecord;
    },

    async listSchoolsWithState(filters?: { search?: string; status?: string }) {
      const now = getNow();
      const schools = await deps.db.listSchools();
      const enriched = schools.map((s) => ({
        ...s,
        computedSubscription: evaluateSubscriptionState(s, now),
      }));

      return enriched.filter((item) => {
        if (filters?.status && filters.status !== 'all') {
          const eff = item.computedSubscription.effectiveStatus.toLowerCase();
          if (eff !== filters.status.toLowerCase() && item.status !== filters.status.toLowerCase()) {
            return false;
          }
        }
        if (filters?.search && filters.search.trim()) {
          const q = filters.search.trim().toLowerCase();
          const match =
            item.schoolId.toLowerCase().includes(q) ||
            item.schoolCode.toLowerCase().includes(q) ||
            item.schoolName.toLowerCase().includes(q) ||
            item.adminEmail.toLowerCase().includes(q) ||
            item.principalName.toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      });
    },

    async updateSchool(
      schoolId: string,
      input: UpdateSchoolInput,
      actor: AuthPrincipal
    ): Promise<SchoolTenantRecord> {
      const school = await deps.db.getSchoolById(schoolId);
      if (!school) {
        throw new SaaSServiceError(`School "${schoolId}" not found.`, 404, 'SCHOOL_NOT_FOUND');
      }

      const now = getNow();
      const nowIso = now.toISOString();

      if (input.schoolCode && input.schoolCode.trim().toUpperCase() !== school.schoolCode) {
        const dup = await deps.db.getSchoolByCode(input.schoolCode.trim().toUpperCase());
        if (dup && dup.schoolId !== schoolId) {
          throw new SaaSServiceError(
            `School code "${input.schoolCode.trim().toUpperCase()}" already exists.`,
            409,
            'DUPLICATE_SCHOOL_CODE'
          );
        }
      }

      const nextSubscription = { ...school.subscription };
      let nextStatus = input.status ?? school.status;
      let eventType: 'manual_extension' | 'suspended' | 'activated' | 'plan_changed' | null = null;
      let daysAdded = 0;
      const prevExpiry = school.subscription.expiryDate;

      if (input.planId && input.planId !== school.subscription.planId) {
        const plan = await deps.db.getPlanById(input.planId);
        if (!plan) {
          throw new SaaSServiceError(`Invalid plan "${input.planId}".`, 400, 'INVALID_PLAN');
        }
        nextSubscription.planId = plan.id;
        nextSubscription.planName = plan.name;
        nextSubscription.amountBdt = plan.priceBdt;
        eventType = 'plan_changed';
      }

      if (typeof input.extendDays === 'number' && input.extendDays > 0) {
        const existingExpiryMs = Date.parse(nextSubscription.expiryDate);
        const baseDate =
          !Number.isNaN(existingExpiryMs) && existingExpiryMs > now.getTime()
            ? new Date(existingExpiryMs)
            : now;
        const extended = addDaysUtc(baseDate, input.extendDays);
        nextSubscription.expiryDate = extended.toISOString();
        nextSubscription.nextRenewalDate = extended.toISOString();
        nextSubscription.status = 'Active';
        if (nextStatus !== 'suspended') {
          nextStatus = 'active';
        }
        daysAdded = input.extendDays;
        eventType = 'manual_extension';
      } else if (input.newExpiryDate) {
        const parsed = new Date(input.newExpiryDate);
        if (Number.isNaN(parsed.getTime())) {
          throw new SaaSServiceError('Invalid newExpiryDate format.', 400, 'INVALID_DATE');
        }
        nextSubscription.expiryDate = parsed.toISOString();
        nextSubscription.nextRenewalDate = parsed.toISOString();
        if (parsed.getTime() > now.getTime() && nextStatus !== 'suspended') {
          nextSubscription.status = 'Active';
          nextStatus = 'active';
        }
        eventType = 'manual_extension';
      }

      if (input.status === 'suspended') {
        nextSubscription.status = 'Suspended';
        nextStatus = 'suspended';
        eventType = 'suspended';
      } else if (input.status === 'active') {
        const expMs = Date.parse(nextSubscription.expiryDate);
        if (Number.isNaN(expMs) || expMs <= now.getTime()) {
          throw new SaaSServiceError(
            'Cannot activate an expired school without extending the expiry date.',
            400,
            'CANNOT_ACTIVATE_EXPIRED'
          );
        }
        nextSubscription.status = 'Active';
        nextStatus = 'active';
        eventType = eventType || 'activated';
      }

      const updated = await deps.db.updateSchool(schoolId, {
        schoolName: input.schoolName?.trim() || school.schoolName,
        schoolCode: input.schoolCode?.trim().toUpperCase() || school.schoolCode,
        address: input.address?.trim() || school.address,
        contactNumber: input.contactNumber?.trim() || school.contactNumber,
        email: input.email?.trim().toLowerCase() || school.email,
        principalName: input.principalName?.trim() || school.principalName,
        notes: input.notes !== undefined ? input.notes : school.notes,
        status: nextStatus,
        subscription: nextSubscription,
        updatedAt: nowIso,
      });

      if (eventType) {
        await deps.db.appendSubscriptionHistory({
          id: `hist_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
          schoolId,
          schoolName: updated.schoolName,
          eventType,
          planId: updated.subscription.planId,
          planName: updated.subscription.planName,
          previousExpiryDate: prevExpiry,
          newExpiryDate: updated.subscription.expiryDate,
          durationDaysAdded: daysAdded,
          actorUid: actor.uid,
          actorEmail: actor.email,
          remarks:
            eventType === 'manual_extension'
              ? `Subscription extended (${daysAdded ? `${daysAdded} days` : 'custom date'}) by Master Admin`
              : eventType === 'suspended'
              ? 'School suspended by Master Admin'
              : eventType === 'activated'
              ? 'School activated by Master Admin'
              : 'Subscription plan updated by Master Admin',
          createdAt: nowIso,
        });
      }

      return updated;
    },

    async deleteSchool(
      schoolId: string,
      actor: AuthPrincipal
    ): Promise<{ deletedSchoolId: string; deletedUsersCount: number }> {
      if (!actor.isMasterAdmin) {
        throw new SaaSServiceError('Only Master Admin can delete schools.', 403, 'MASTER_ADMIN_REQUIRED');
      }

      const school = await deps.db.getSchoolById(schoolId);
      if (!school) {
        throw new SaaSServiceError(`School "${schoolId}" not found.`, 404, 'SCHOOL_NOT_FOUND');
      }

      const schoolUsers = await deps.db.listSaaSUsersBySchool(schoolId);
      const userTargets = new Map<string, { uid: string; email: string }>();
      for (const u of schoolUsers) {
        if (u.uid) {
          userTargets.set(u.uid, { uid: u.uid, email: u.email || '' });
        }
      }
      if (school.adminUid && !userTargets.has(school.adminUid)) {
        userTargets.set(school.adminUid, {
          uid: school.adminUid,
          email: school.adminEmail || '',
        });
      }

      let deletedUsersCount = 0;
      for (const target of userTargets.values()) {
        try {
          const isProtectedMaster = await deps.db.isMasterAdminUidOrEmail(target.uid, target.email);
          if (!isProtectedMaster) {
            if (deps.auth.deleteUser) {
              await deps.auth.deleteUser(target.uid);
            } else {
              await deps.auth.updateUserStatus(target.uid, true);
            }
            deletedUsersCount += 1;
          }
        } catch (err) {
          console.warn(`[SaaS] Failed removing auth user ${target.uid} while deleting school ${schoolId}:`, err);
        }
      }

      await deps.db.deleteSchool(schoolId);
      return { deletedSchoolId: schoolId, deletedUsersCount };
    },

    /**
     * Provisions a Firebase Auth user account for a school staff member, student, or guardian,
     * assigns server-side custom claims { schoolId, schoolRole }, and stores a safe profile
     * record without plaintext passwords.
     */
    async provisionTenantUser(
      input: CreateTenantUserInput,
      actor: AuthPrincipal
    ): Promise<SaaSUserRecord> {
      const email = (input.email || '').trim().toLowerCase();
      const displayName = (input.displayName || '').trim();
      const password = input.password || '';
      const role = input.schoolRole;

      if (!email || !displayName || !password) {
        throw new SaaSServiceError(
          'Email, displayName, and password are required.',
          400,
          'VALIDATION_ERROR'
        );
      }

      if (password.length < 6) {
        throw new SaaSServiceError(
          'Password must be at least 6 characters.',
          400,
          'WEAK_PASSWORD'
        );
      }

      if (!ALLOWED_SCHOOL_ROLES.has(role)) {
        throw new SaaSServiceError(
          `Role "${role}" cannot be provisioned via tenant user API.`,
          403,
          'FORBIDDEN_ROLE'
        );
      }

      // Strictly derive target schoolId: school admins can NEVER provision into another school!
      let targetSchoolId: string | null = null;
      if (actor.isMasterAdmin) {
        targetSchoolId = (input.schoolId || actor.schoolId || '').trim() || null;
      } else {
        if (actor.schoolRole !== 'super_admin' && actor.schoolRole !== 'admin') {
          throw new SaaSServiceError(
            'Only School Super Admin, Head Teacher/Admin, or Master Admin can provision user accounts.',
            403,
            'FORBIDDEN'
          );
        }
        targetSchoolId = actor.schoolId;
      }

      if (!targetSchoolId) {
        throw new SaaSServiceError(
          'Target schoolId is required for user provisioning.',
          400,
          'MISSING_SCHOOL_ID'
        );
      }

      const school = await deps.db.getSchoolById(targetSchoolId);
      if (!school) {
        throw new SaaSServiceError(`School "${targetSchoolId}" not found.`, 404, 'SCHOOL_NOT_FOUND');
      }

      if (!actor.isMasterAdmin) {
        const subState = evaluateSubscriptionState(school, getNow());
        if (!subState.accessAllowed) {
          throw new SaaSServiceError(
            'Cannot provision users while school subscription is inactive or expired.',
            403,
            'SUBSCRIPTION_EXPIRED'
          );
        }
      }

      const existingAuth = await deps.auth.getUserByEmail(email);
      const existingRecord = await deps.db.getSaaSUserByEmail(email);

      let uidToUse: string;
      if (existingAuth) {
        const isOrphanSameSchool =
          !existingRecord &&
          existingAuth.customClaims?.schoolId === targetSchoolId &&
          existingAuth.customClaims?.isMasterAdmin !== true &&
          !(await deps.db.isMasterAdminUidOrEmail(existingAuth.uid, email));

        if (!isOrphanSameSchool) {
          throw new SaaSServiceError(
            `A user account with email "${email}" already exists.`,
            409,
            'DUPLICATE_EMAIL'
          );
        }

        uidToUse = existingAuth.uid;
        if (deps.auth.updateUser) {
          await deps.auth.updateUser(uidToUse, {
            password,
            displayName,
            disabled: false,
            emailVerified: true,
          });
        } else if (deps.auth.updateUserPassword) {
          await deps.auth.updateUserPassword(uidToUse, password);
        }
      } else if (existingRecord) {
        throw new SaaSServiceError(
          `A user account with email "${email}" already exists.`,
          409,
          'DUPLICATE_EMAIL'
        );
      } else {
        const created = await deps.auth.createUser({
          email,
          password,
          displayName,
        });
        uidToUse = created.uid;
      }

      await deps.auth.setCustomClaims(uidToUse, {
        schoolId: targetSchoolId,
        schoolRole: role,
        isMasterAdmin: false,
      });

      const nowIso = getNow().toISOString();
      const record: SaaSUserRecord = {
        uid: uidToUse,
        email,
        displayName,
        schoolId: targetSchoolId,
        schoolRole: role,
        ...(input.linkedStaffId ? { linkedStaffId: input.linkedStaffId } : {}),
        ...(input.linkedStudentId ? { linkedStudentId: input.linkedStudentId } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        status: 'active',
        createdAt: nowIso,
        createdBy: actor.email || actor.uid,
        updatedAt: nowIso,
      };

      return deps.db.createSaaSUserRecord(record);
    },

    async setTenantUserStatus(
      targetUid: string,
      disabled: boolean,
      actor: AuthPrincipal
    ): Promise<SaaSUserRecord> {
      const user = await deps.db.getSaaSUserByUid(targetUid);
      if (!user) {
        throw new SaaSServiceError('User not found.', 404, 'USER_NOT_FOUND');
      }

      if (!actor.isMasterAdmin && user.schoolId !== actor.schoolId) {
        throw new SaaSServiceError(
          'Cross-tenant user management is strictly prohibited.',
          403,
          'CROSS_TENANT_FORBIDDEN'
        );
      }

      if (!actor.isMasterAdmin && actor.schoolRole !== 'super_admin' && actor.schoolRole !== 'admin') {
        throw new SaaSServiceError('Insufficient permissions.', 403, 'FORBIDDEN');
      }

      await deps.auth.updateUserStatus(targetUid, disabled);
      return deps.db.updateSaaSUserRecord(targetUid, {
        status: disabled ? 'disabled' : 'active',
        updatedAt: getNow().toISOString(),
      });
    },

    async updateOwnCredentials(
      actor: AuthPrincipal,
      input: UpdateOwnCredentialsInput
    ): Promise<{
      uid: string;
      email: string;
      displayName: string;
      phone?: string;
      avatarUrl?: string;
      schoolId: string | null;
      schoolRole: string | null;
      isMasterAdmin: boolean;
    }> {
      const nextDisplayName = input.displayName !== undefined ? input.displayName.trim() : undefined;
      const nextEmail = input.email !== undefined ? input.email.trim().toLowerCase() : undefined;
      const nextPassword = input.password !== undefined ? input.password : undefined;
      const nextPhone = input.phone !== undefined ? input.phone.trim() : undefined;
      const nextAvatarUrl = input.avatarUrl !== undefined ? String(input.avatarUrl).trim() : undefined;

      if (nextDisplayName !== undefined && !nextDisplayName) {
        throw new SaaSServiceError('Display name cannot be empty.', 400, 'VALIDATION_ERROR');
      }

      if (nextPassword !== undefined && nextPassword.length > 0 && nextPassword.length < 6) {
        throw new SaaSServiceError('Password must be at least 6 characters.', 400, 'WEAK_PASSWORD');
      }

      if (nextAvatarUrl !== undefined && nextAvatarUrl.length > 0) {
        if (nextAvatarUrl.length > 180_000) {
          throw new SaaSServiceError(
            'Profile photo is too large. Please choose a smaller image.',
            400,
            'IMAGE_TOO_LARGE'
          );
        }
        if (
          !/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(nextAvatarUrl) &&
          !/^https?:\/\//i.test(nextAvatarUrl)
        ) {
          throw new SaaSServiceError('Invalid profile image format.', 400, 'INVALID_IMAGE_FORMAT');
        }
      }

      const emailChanged = Boolean(nextEmail && nextEmail !== (actor.email || '').toLowerCase());
      if (emailChanged && nextEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
          throw new SaaSServiceError('Please provide a valid email address.', 400, 'INVALID_EMAIL');
        }
        if (actor.isMasterAdmin) {
          throw new SaaSServiceError(
            'Master Admin primary email is bound to platform configuration. You can update your display name, phone, or password.',
            400,
            'MASTER_EMAIL_IMMUTABLE'
          );
        }
        const existingAuth = await deps.auth.getUserByEmail(nextEmail);
        if (existingAuth && existingAuth.uid !== actor.uid) {
          throw new SaaSServiceError(`Email "${nextEmail}" is already in use by another account.`, 409, 'DUPLICATE_EMAIL');
        }
        const existingRecord = await deps.db.getSaaSUserByEmail(nextEmail);
        if (existingRecord && existingRecord.uid !== actor.uid) {
          throw new SaaSServiceError(`Email "${nextEmail}" is already registered.`, 409, 'DUPLICATE_EMAIL');
        }
      }

      const authUpdates: {
        email?: string;
        emailVerified?: boolean;
        password?: string;
        displayName?: string;
      } = {};
      if (emailChanged && nextEmail) {
        authUpdates.email = nextEmail;
        authUpdates.emailVerified = true;
      }
      if (nextDisplayName !== undefined) {
        authUpdates.displayName = nextDisplayName;
      }
      if (nextPassword && nextPassword.length >= 6) {
        authUpdates.password = nextPassword;
      }

      if (Object.keys(authUpdates).length > 0) {
        if (deps.auth.updateUser) {
          await deps.auth.updateUser(actor.uid, authUpdates);
        } else if (authUpdates.password && deps.auth.updateUserPassword) {
          await deps.auth.updateUserPassword(actor.uid, authUpdates.password);
        }
      }

      const finalEmail = (emailChanged && nextEmail ? nextEmail : actor.email).toLowerCase();
      const finalName = nextDisplayName !== undefined ? nextDisplayName : actor.displayName || finalEmail;
      const nowIso = getNow().toISOString();

      const existingSaasUser = await deps.db.getSaaSUserByUid(actor.uid);
      if (existingSaasUser) {
        await deps.db.updateSaaSUserRecord(actor.uid, {
          email: finalEmail,
          displayName: finalName,
          ...(nextPhone !== undefined ? { phone: nextPhone } : {}),
          ...(nextAvatarUrl !== undefined ? { avatarUrl: nextAvatarUrl } : {}),
          updatedAt: nowIso,
        });
      } else if (actor.schoolId) {
        await deps.db.createSaaSUserRecord({
          uid: actor.uid,
          email: finalEmail,
          displayName: finalName,
          schoolId: actor.schoolId,
          schoolRole: actor.schoolRole || 'teacher',
          ...(nextPhone !== undefined ? { phone: nextPhone } : {}),
          ...(nextAvatarUrl !== undefined ? { avatarUrl: nextAvatarUrl } : {}),
          status: 'active',
          createdAt: nowIso,
          createdBy: actor.email || actor.uid,
          updatedAt: nowIso,
        });
      }

      if (actor.schoolId) {
        const school = await deps.db.getSchoolById(actor.schoolId);
        if (school && school.adminUid === actor.uid && (emailChanged || nextDisplayName !== undefined)) {
          await deps.db.updateSchool(actor.schoolId, {
            adminEmail: finalEmail,
            adminName: finalName,
            updatedAt: nowIso,
          });
        }
      }

      return {
        uid: actor.uid,
        email: finalEmail,
        displayName: finalName,
        phone: nextPhone !== undefined ? nextPhone : existingSaasUser?.phone,
        avatarUrl: nextAvatarUrl !== undefined ? nextAvatarUrl : existingSaasUser?.avatarUrl,
        schoolId: actor.schoolId,
        schoolRole: actor.schoolRole,
        isMasterAdmin: actor.isMasterAdmin,
      };
    },

    async updateTenantUserCredentials(
      targetUid: string,
      input: UpdateTenantUserCredentialsInput,
      actor: AuthPrincipal
    ): Promise<SaaSUserRecord> {
      if (!actor.isMasterAdmin && actor.schoolRole !== 'super_admin' && actor.schoolRole !== 'admin') {
        throw new SaaSServiceError('Only School Admins or Master Admin can update user credentials.', 403, 'FORBIDDEN');
      }

      const user = await deps.db.getSaaSUserByUid(targetUid);
      if (!user) {
        throw new SaaSServiceError('User not found.', 404, 'USER_NOT_FOUND');
      }

      if (!actor.isMasterAdmin && user.schoolId !== actor.schoolId) {
        throw new SaaSServiceError('Cross-tenant user management is strictly prohibited.', 403, 'CROSS_TENANT_FORBIDDEN');
      }

      if (!actor.isMasterAdmin && actor.schoolRole === 'admin') {
        if (user.schoolRole === 'super_admin' || input.schoolRole === 'super_admin') {
          throw new SaaSServiceError('Only Super Admin or Master Admin can modify Super Admin credentials.', 403, 'FORBIDDEN');
        }
      }

      const nextDisplayName = input.displayName !== undefined ? input.displayName.trim() : undefined;
      const nextEmail = input.email !== undefined ? input.email.trim().toLowerCase() : undefined;
      const nextPassword = input.password !== undefined ? input.password : undefined;
      const nextPhone = input.phone !== undefined ? input.phone.trim() : undefined;
      const nextRole = input.schoolRole;
      const nextLinkedStudentId =
        input.linkedStudentId !== undefined ? input.linkedStudentId.trim() : undefined;
      const nextLinkedStaffId =
        input.linkedStaffId !== undefined ? input.linkedStaffId.trim() : undefined;

      if (nextDisplayName !== undefined && !nextDisplayName) {
        throw new SaaSServiceError('Display name cannot be empty.', 400, 'VALIDATION_ERROR');
      }
      if (nextPassword !== undefined && nextPassword.length > 0 && nextPassword.length < 6) {
        throw new SaaSServiceError('Password must be at least 6 characters.', 400, 'WEAK_PASSWORD');
      }
      if (nextRole !== undefined && !ALLOWED_SCHOOL_ROLES.has(nextRole)) {
        throw new SaaSServiceError(`Invalid school role "${nextRole}".`, 403, 'FORBIDDEN_ROLE');
      }

      const emailChanged = Boolean(nextEmail && nextEmail !== user.email.toLowerCase());
      if (emailChanged && nextEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
          throw new SaaSServiceError('Please provide a valid email address.', 400, 'INVALID_EMAIL');
        }
        const existingAuth = await deps.auth.getUserByEmail(nextEmail);
        if (existingAuth && existingAuth.uid !== targetUid) {
          throw new SaaSServiceError(`Email "${nextEmail}" is already in use by another account.`, 409, 'DUPLICATE_EMAIL');
        }
        const existingRecord = await deps.db.getSaaSUserByEmail(nextEmail);
        if (existingRecord && existingRecord.uid !== targetUid) {
          throw new SaaSServiceError(`Email "${nextEmail}" is already registered.`, 409, 'DUPLICATE_EMAIL');
        }
      }

      const authUpdates: {
        email?: string;
        emailVerified?: boolean;
        password?: string;
        displayName?: string;
      } = {};
      if (emailChanged && nextEmail) {
        authUpdates.email = nextEmail;
        authUpdates.emailVerified = true;
      }
      if (nextDisplayName !== undefined) {
        authUpdates.displayName = nextDisplayName;
      }
      if (nextPassword && nextPassword.length >= 6) {
        authUpdates.password = nextPassword;
      }

      if (Object.keys(authUpdates).length > 0) {
        if (deps.auth.updateUser) {
          await deps.auth.updateUser(targetUid, authUpdates);
        } else if (authUpdates.password && deps.auth.updateUserPassword) {
          await deps.auth.updateUserPassword(targetUid, authUpdates.password);
        }
      }

      if (nextRole && nextRole !== user.schoolRole) {
        await deps.auth.setCustomClaims(targetUid, {
          schoolId: user.schoolId,
          schoolRole: nextRole,
          isMasterAdmin: false,
        });
      }

      const nowIso = getNow().toISOString();
      const updatedUser = await deps.db.updateSaaSUserRecord(targetUid, {
        ...(emailChanged && nextEmail ? { email: nextEmail } : {}),
        ...(nextDisplayName !== undefined ? { displayName: nextDisplayName } : {}),
        ...(nextPhone !== undefined ? { phone: nextPhone } : {}),
        ...(nextRole ? { schoolRole: nextRole } : {}),
        ...(nextLinkedStudentId !== undefined ? { linkedStudentId: nextLinkedStudentId } : {}),
        ...(nextLinkedStaffId !== undefined ? { linkedStaffId: nextLinkedStaffId } : {}),
        updatedAt: nowIso,
      });

      const school = await deps.db.getSchoolById(user.schoolId);
      if (school && school.adminUid === targetUid && (emailChanged || nextDisplayName !== undefined)) {
        await deps.db.updateSchool(user.schoolId, {
          adminEmail: updatedUser.email,
          adminName: updatedUser.displayName,
          updatedAt: nowIso,
        });
      }

      return updatedUser;
    },

    async deleteTenantUser(
      targetUid: string,
      actor: AuthPrincipal
    ): Promise<{ deletedUid: string; schoolId: string; email: string }> {
      if (!actor.isMasterAdmin && actor.schoolRole !== 'super_admin' && actor.schoolRole !== 'admin') {
        throw new SaaSServiceError('Only School Admins or Master Admin can delete user logins.', 403, 'FORBIDDEN');
      }

      if (actor.uid === targetUid) {
        throw new SaaSServiceError('You cannot delete your own active login account.', 400, 'CANNOT_DELETE_SELF');
      }

      let user = await deps.db.getSaaSUserByUid(targetUid);
      if (!user && !actor.isMasterAdmin && actor.schoolId) {
        const schoolUsers = await deps.db.listSaaSUsersBySchool(actor.schoolId);
        user = schoolUsers.find((u) => u.uid === targetUid) || null;
      }

      if (!user) {
        throw new SaaSServiceError('User not found.', 404, 'USER_NOT_FOUND');
      }

      if (!actor.isMasterAdmin && user.schoolId !== actor.schoolId) {
        throw new SaaSServiceError('Cross-tenant user deletion is strictly prohibited.', 403, 'CROSS_TENANT_FORBIDDEN');
      }

      if (user.schoolRole === 'master_admin' || (await deps.db.isMasterAdminUidOrEmail(user.uid, user.email))) {
        throw new SaaSServiceError('Master Admin account cannot be deleted.', 403, 'CANNOT_DELETE_MASTER_ADMIN');
      }

      if (!actor.isMasterAdmin && actor.schoolRole === 'admin' && user.schoolRole === 'super_admin') {
        throw new SaaSServiceError('Only Super Admin or Master Admin can delete a Super Admin account.', 403, 'FORBIDDEN');
      }

      if (deps.auth.deleteUser) {
        await deps.auth.deleteUser(targetUid);
      } else {
        await deps.auth.updateUserStatus(targetUid, true);
      }

      await deps.db.deleteSaaSUserRecord(targetUid, user.schoolId);

      const school = await deps.db.getSchoolById(user.schoolId);
      if (school && school.adminUid === targetUid) {
        await deps.db.updateSchool(user.schoolId, {
          adminUid: '',
          updatedAt: getNow().toISOString(),
        });
      }

      return {
        deletedUid: targetUid,
        schoolId: user.schoolId,
        email: user.email,
      };
    },
  };
}
