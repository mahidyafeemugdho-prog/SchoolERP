import {
  AuthPrincipal,
  AuthProviderInterface,
  CustomClaimsPayload,
  DEFAULT_SUBSCRIPTION_PLANS,
  DatabaseProviderInterface,
  PlatformPaymentChannels,
  SaaSPaymentRequest,
  SaaSServiceError,
  SaaSUserRecord,
  SchoolTenantRecord,
  SubscriptionHistoryRecord,
  SubscriptionPlanConfig,
  SubscriptionPlanId,
  TransactionContext,
  getDefaultPlatformPaymentChannels,
} from '../types';

interface InMemoryAuthUser {
  uid: string;
  email: string;
  password: string;
  displayName: string;
  disabled: boolean;
  claims: CustomClaimsPayload;
}

/**
 * Deterministic in-memory provider implementing AuthProviderInterface and DatabaseProviderInterface.
 * Used exclusively by the automated test suite to verify multi-tenant isolation,
 * subscription lifecycle, payment approval, and time-based expiration rules.
 */
export class InMemoryAuthProvider implements AuthProviderInterface {
  public readonly providerName = 'in-memory-test-auth';
  private users = new Map<string, InMemoryAuthUser>();
  private tokens = new Map<string, string>();
  private seq = 1;

  seedMasterAdmin(email: string, uid = 'master_uid_1'): string {
    const normalized = email.toLowerCase();
    this.users.set(uid, {
      uid,
      email: normalized,
      password: 'test-password',
      displayName: 'Platform Master Admin',
      disabled: false,
      claims: { schoolRole: 'master_admin', isMasterAdmin: true },
    });
    const token = `tok_${uid}`;
    this.tokens.set(token, uid);
    return token;
  }

  issueTestTokenForEmail(email: string): string {
    const normalized = email.toLowerCase();
    const found = Array.from(this.users.values()).find((u) => u.email === normalized);
    if (!found) {
      throw new Error(`No test user for email ${email}`);
    }
    const token = `tok_${found.uid}_${Date.now()}_${Math.random()}`;
    this.tokens.set(token, found.uid);
    return token;
  }

  getUserClaims(uid: string): CustomClaimsPayload | undefined {
    return this.users.get(uid)?.claims;
  }

  async verifyIdToken(idToken: string): Promise<AuthPrincipal> {
    const uid = this.tokens.get(idToken);
    if (!uid) {
      throw new SaaSServiceError('Invalid authentication token.', 401, 'INVALID_TOKEN');
    }
    const user = this.users.get(uid);
    if (!user || user.disabled) {
      throw new SaaSServiceError('Account disabled or not found.', 401, 'ACCOUNT_DISABLED');
    }
    return {
      uid: user.uid,
      email: user.email,
      emailVerified: true,
      schoolId: user.claims.schoolId || null,
      schoolRole: user.claims.schoolRole || null,
      isMasterAdmin: !!user.claims.isMasterAdmin || user.claims.schoolRole === 'master_admin',
      displayName: user.displayName,
    };
  }

  async createUser(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ uid: string; email: string; displayName: string }> {
    const email = input.email.toLowerCase();
    const existing = await this.getUserByEmail(email);
    if (existing) {
      throw new SaaSServiceError('Email already exists in Auth.', 409, 'DUPLICATE_EMAIL');
    }
    const uid = `uid_${this.seq++}`;
    this.users.set(uid, {
      uid,
      email,
      password: input.password,
      displayName: input.displayName,
      disabled: false,
      claims: { schoolRole: 'teacher' },
    });
    return { uid, email, displayName: input.displayName };
  }

  async setCustomClaims(uid: string, claims: CustomClaimsPayload): Promise<void> {
    const user = this.users.get(uid);
    if (!user) throw new Error(`User ${uid} not found`);
    user.claims = { ...claims };
  }

  async getUserByEmail(
    email: string
  ): Promise<{ uid: string; email: string; disabled: boolean; customClaims?: Record<string, any> } | null> {
    const normalized = email.toLowerCase();
    const found = Array.from(this.users.values()).find((u) => u.email === normalized);
    return found
      ? { uid: found.uid, email: found.email, disabled: found.disabled, customClaims: found.claims }
      : null;
  }

  async getUserByUid(
    uid: string
  ): Promise<{ uid: string; email: string; displayName: string; disabled: boolean } | null> {
    const found = this.users.get(uid);
    return found
      ? { uid: found.uid, email: found.email, displayName: found.displayName, disabled: found.disabled }
      : null;
  }

  async updateUserStatus(uid: string, disabled: boolean): Promise<void> {
    const user = this.users.get(uid);
    if (user) user.disabled = disabled;
  }

  async updateUserPassword(uid: string, password: string): Promise<void> {
    const user = this.users.get(uid);
    if (user) user.password = password;
  }

  async updateUser(
    uid: string,
    updates: {
      email?: string;
      password?: string;
      displayName?: string;
      disabled?: boolean;
      emailVerified?: boolean;
    }
  ): Promise<{ uid: string; email: string; displayName: string; disabled: boolean }> {
    const user = this.users.get(uid);
    if (!user) throw new SaaSServiceError('User not found.', 404, 'USER_NOT_FOUND');
    if (updates.email !== undefined) user.email = updates.email.toLowerCase();
    if (updates.password !== undefined) user.password = updates.password;
    if (updates.displayName !== undefined) user.displayName = updates.displayName;
    if (updates.disabled !== undefined) user.disabled = updates.disabled;
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      disabled: user.disabled,
    };
  }

  async deleteUser(uid: string): Promise<void> {
    this.users.delete(uid);
    for (const [token, tokenUid] of this.tokens.entries()) {
      if (tokenUid === uid) {
        this.tokens.delete(token);
      }
    }
  }
}

export class InMemoryDatabaseProvider implements DatabaseProviderInterface {
  public readonly providerName = 'in-memory-test-db';
  public masterAdminEmails = new Set<string>();
  public plans = new Map<SubscriptionPlanId, SubscriptionPlanConfig>(
    DEFAULT_SUBSCRIPTION_PLANS.map((p) => [p.id, { ...p }])
  );
  public schools = new Map<string, SchoolTenantRecord>();
  public paymentRequests = new Map<string, SaaSPaymentRequest>();
  public trxIndex = new Map<string, string>();
  public subscriptionHistory: SubscriptionHistoryRecord[] = [];
  public saasUsers = new Map<string, SaaSUserRecord>();
  public tenantSlices = new Map<string, Record<string, any>>();
  public paymentChannels: PlatformPaymentChannels = getDefaultPlatformPaymentChannels();
  private schoolSeq = 1;

  async isMasterAdminUidOrEmail(_uid: string, email: string): Promise<boolean> {
    return this.masterAdminEmails.has(email.toLowerCase());
  }

  async getPlans(): Promise<SubscriptionPlanConfig[]> {
    return Array.from(this.plans.values());
  }

  async getPlanById(planId: SubscriptionPlanId): Promise<SubscriptionPlanConfig | null> {
    return this.plans.get(planId) || null;
  }

  async upsertPlan(plan: SubscriptionPlanConfig): Promise<SubscriptionPlanConfig> {
    this.plans.set(plan.id, { ...plan });
    return plan;
  }

  async getPaymentChannels(): Promise<PlatformPaymentChannels> {
    return structuredClone(this.paymentChannels);
  }

  async savePaymentChannels(channels: PlatformPaymentChannels): Promise<PlatformPaymentChannels> {
    this.paymentChannels = structuredClone(channels);
    return structuredClone(this.paymentChannels);
  }

  async getNextSchoolId(): Promise<string> {
    return `SCH${String(this.schoolSeq++).padStart(3, '0')}`;
  }

  async getSchoolById(schoolId: string): Promise<SchoolTenantRecord | null> {
    const found = this.schools.get(schoolId);
    return found ? structuredClone(found) : null;
  }

  async getSchoolByCode(schoolCode: string): Promise<SchoolTenantRecord | null> {
    const normalized = schoolCode.trim().toUpperCase();
    const found = Array.from(this.schools.values()).find((s) => s.schoolCode === normalized);
    return found ? structuredClone(found) : null;
  }

  async listSchools(): Promise<SchoolTenantRecord[]> {
    return Array.from(this.schools.values()).map((s) => structuredClone(s));
  }

  async createSchool(school: SchoolTenantRecord): Promise<SchoolTenantRecord> {
    this.schools.set(school.schoolId, structuredClone(school));
    return structuredClone(school);
  }

  async updateSchool(schoolId: string, updates: Partial<SchoolTenantRecord>): Promise<SchoolTenantRecord> {
    const existing = this.schools.get(schoolId);
    if (!existing) throw new SaaSServiceError('School not found.', 404, 'SCHOOL_NOT_FOUND');
    const merged = structuredClone({ ...existing, ...updates });
    this.schools.set(schoolId, merged);
    return structuredClone(merged);
  }

  async deleteSchool(schoolId: string): Promise<void> {
    this.schools.delete(schoolId);
    this.tenantSlices.delete(schoolId);
    for (const [uid, u] of this.saasUsers.entries()) {
      if (u.schoolId === schoolId) this.saasUsers.delete(uid);
    }
    for (const [id, p] of this.paymentRequests.entries()) {
      if (p.schoolId === schoolId) {
        this.paymentRequests.delete(id);
        if (p.normalizedTransactionId) this.trxIndex.delete(p.normalizedTransactionId);
      }
    }
    this.subscriptionHistory = this.subscriptionHistory.filter((h) => h.schoolId !== schoolId);
  }

  async listPaymentRequests(schoolId?: string): Promise<SaaSPaymentRequest[]> {
    const all = Array.from(this.paymentRequests.values());
    return (schoolId ? all.filter((p) => p.schoolId === schoolId) : all).map((p) =>
      structuredClone(p)
    );
  }

  async getPaymentRequestById(id: string): Promise<SaaSPaymentRequest | null> {
    const found = this.paymentRequests.get(id);
    return found ? structuredClone(found) : null;
  }

  async getPaymentByNormalizedTrxId(normalizedTrxId: string): Promise<SaaSPaymentRequest | null> {
    const reqId = this.trxIndex.get(normalizedTrxId);
    if (!reqId) return null;
    return this.getPaymentRequestById(reqId);
  }

  async listSubscriptionHistory(schoolId?: string): Promise<SubscriptionHistoryRecord[]> {
    return (
      schoolId
        ? this.subscriptionHistory.filter((h) => h.schoolId === schoolId)
        : this.subscriptionHistory
    ).map((h) => structuredClone(h));
  }

  async appendSubscriptionHistory(entry: SubscriptionHistoryRecord): Promise<void> {
    this.subscriptionHistory.push(structuredClone(entry));
  }

  async createSaaSUserRecord(user: SaaSUserRecord): Promise<SaaSUserRecord> {
    this.saasUsers.set(user.uid, structuredClone(user));
    return structuredClone(user);
  }

  async getSaaSUserByUid(uid: string): Promise<SaaSUserRecord | null> {
    const found = this.saasUsers.get(uid);
    return found ? structuredClone(found) : null;
  }

  async getSaaSUserByEmail(email: string): Promise<SaaSUserRecord | null> {
    const norm = email.toLowerCase();
    const found = Array.from(this.saasUsers.values()).find((u) => u.email === norm);
    return found ? structuredClone(found) : null;
  }

  async listSaaSUsersBySchool(schoolId: string): Promise<SaaSUserRecord[]> {
    return Array.from(this.saasUsers.values())
      .filter((u) => u.schoolId === schoolId)
      .map((u) => structuredClone(u));
  }

  async updateSaaSUserRecord(uid: string, updates: Partial<SaaSUserRecord>): Promise<SaaSUserRecord> {
    const existing = this.saasUsers.get(uid);
    if (!existing) throw new SaaSServiceError('User not found', 404, 'USER_NOT_FOUND');
    const merged = structuredClone({ ...existing, ...updates });
    this.saasUsers.set(uid, merged);
    return structuredClone(merged);
  }

  async deleteSaaSUserRecord(uid: string): Promise<void> {
    this.saasUsers.delete(uid);
  }

  async getTenantSlices(schoolId: string): Promise<Record<string, any>> {
    return structuredClone(this.tenantSlices.get(schoolId) || {});
  }

  async saveTenantSlice(schoolId: string, sliceName: string, data: Record<string, any>): Promise<void> {
    const current = this.tenantSlices.get(schoolId) || {};
    current[sliceName] = { ...(current[sliceName] || {}), ...structuredClone(data), schoolId };
    this.tenantSlices.set(schoolId, current);
  }

  async runInTransaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const ctx: TransactionContext = {
      getSchoolById: (id) => this.getSchoolById(id),
      updateSchool: (id, updates) => this.updateSchool(id, updates),
      getPaymentRequestById: (id) => this.getPaymentRequestById(id),
      getPaymentByNormalizedTrxId: (trx) => this.getPaymentByNormalizedTrxId(trx),
      createPaymentRequestWithTrxLock: async (req) => {
        if (this.trxIndex.has(req.normalizedTransactionId)) {
          throw new SaaSServiceError('Duplicate Transaction ID.', 409, 'DUPLICATE_TRANSACTION_ID');
        }
        this.trxIndex.set(req.normalizedTransactionId, req.id);
        this.paymentRequests.set(req.id, structuredClone(req));
        return structuredClone(req);
      },
      updatePaymentRequest: async (id, updates) => {
        const existing = this.paymentRequests.get(id);
        if (!existing) throw new SaaSServiceError('Payment request not found.', 404, 'PAYMENT_NOT_FOUND');
        const merged = structuredClone({ ...existing, ...updates });
        this.paymentRequests.set(id, merged);
        return structuredClone(merged);
      },
      appendSubscriptionHistory: (entry) => this.appendSubscriptionHistory(entry),
    };
    return fn(ctx);
  }
}
