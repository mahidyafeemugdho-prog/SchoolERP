import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  AuthPrincipal,
  AuthProviderInterface,
  CustomClaimsPayload,
  DEFAULT_SUBSCRIPTION_PLANS,
  DatabaseProviderInterface,
  PlatformPaymentChannels,
  SaaSPaymentRequest,
  SaaSRole,
  SaaSServiceError,
  SaaSUserRecord,
  SchoolTenantRecord,
  SubscriptionHistoryRecord,
  SubscriptionPlanConfig,
  SubscriptionPlanId,
  TransactionContext,
  getDefaultPlatformPaymentChannels,
} from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseAppletConfig {
  projectId: string;
  apiKey?: string;
  firestoreDatabaseId?: string;
}

function loadAppletConfig(): FirebaseAppletConfig {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(__dirname, '../../../firebase-applet-config.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, 'utf-8'));
    }
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    apiKey: process.env.FIREBASE_WEB_API_KEY || '',
    firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
  };
}

let cachedApp: App | null = null;
let adminInitError: string | null = null;

function getAdminApp(): { app: App | null; config: FirebaseAppletConfig; hasCredentials: boolean } {
  const config = loadAppletConfig();
  if (cachedApp) {
    return { app: cachedApp, config, hasCredentials: true };
  }
  if (getApps().length > 0) {
    cachedApp = getApps()[0];
    return { app: cachedApp, config, hasCredentials: true };
  }

  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (serviceAccountJson && serviceAccountJson.trim().startsWith('{')) {
      const parsed = JSON.parse(serviceAccountJson);
      cachedApp = initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || config.projectId,
      });
      return { app: cachedApp, config, hasCredentials: true };
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const credPath = path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS);
      if (fs.existsSync(credPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
          if (parsed?.type === 'service_account' && parsed?.private_key && parsed?.client_email) {
            cachedApp = initializeApp({
              credential: cert(parsed),
              projectId: parsed.project_id || config.projectId,
            });
            return { app: cachedApp, config, hasCredentials: true };
          }
        } catch {
          // Fall back to applicationDefault below
        }
        cachedApp = initializeApp({
          credential: applicationDefault(),
          projectId: config.projectId,
        });
        return { app: cachedApp, config, hasCredentials: true };
      }
    }

    // Attempt ADC only when explicitly enabled or running inside the target Firebase GCP project
    const runtimeProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
    if (process.env.FIREBASE_USE_ADC === 'true' || (runtimeProject && runtimeProject === config.projectId)) {
      cachedApp = initializeApp({
        credential: applicationDefault(),
        projectId: config.projectId,
      });
      return { app: cachedApp, config, hasCredentials: true };
    }

    adminInitError =
      'Firebase Admin credentials (FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS) are not configured on this server.';
    return { app: null, config, hasCredentials: false };
  } catch (err: any) {
    adminInitError = err?.message || 'Failed to initialize Firebase Admin SDK';
    return { app: null, config, hasCredentials: false };
  }
}

function getMasterAdminEmailAllowlist(): Set<string> {
  const raw = process.env.MASTER_ADMIN_EMAILS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeSchoolRecordForFirestore(school: SchoolTenantRecord) {
  const expiryDate = school.subscription?.expiryDate ? new Date(school.subscription.expiryDate) : new Date();
  return {
    ...school,
    subscription: {
      ...school.subscription,
      expiryTimestamp: Timestamp.fromDate(Number.isNaN(expiryDate.getTime()) ? new Date() : expiryDate),
    },
  };
}

function stripFirestoreInternalFields(data: any): SchoolTenantRecord {
  const clone = { ...data };
  if (clone.subscription && clone.subscription.expiryTimestamp) {
    const subClone = { ...clone.subscription };
    delete subClone.expiryTimestamp;
    clone.subscription = subClone;
  }
  return clone as SchoolTenantRecord;
}

function stripUndefined<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (value instanceof Date || value instanceof Timestamp) return value;
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map((item) => stripUndefined(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

const configuredFirestoreInstances = new WeakSet<Firestore>();

export class FirebaseAuthProvider implements AuthProviderInterface {
  public readonly providerName = 'firebase-admin-auth';

  private requireAdminAuth(): Auth {
    const { app } = getAdminApp();
    if (!app) {
      throw new SaaSServiceError(
        adminInitError || 'Firebase Admin Auth is not configured on the server.',
        503,
        'ADMIN_SDK_UNAVAILABLE'
      );
    }
    return getAuth(app);
  }

  async verifyIdToken(idToken: string): Promise<AuthPrincipal> {
    if (!idToken || !idToken.trim()) {
      throw new SaaSServiceError('Missing Bearer authentication token.', 401, 'UNAUTHORIZED');
    }

    const { app, config } = getAdminApp();
    const allowlist = getMasterAdminEmailAllowlist();

    if (app) {
      try {
        const decoded = await getAuth(app).verifyIdToken(idToken, true);
        const email = (decoded.email || '').toLowerCase();
        const schoolRole = (decoded.schoolRole as SaaSRole) || null;
        const isMaster =
          decoded.isMasterAdmin === true ||
          schoolRole === 'master_admin' ||
          (!!email && decoded.email_verified === true && allowlist.has(email));

        return {
          uid: decoded.uid,
          email,
          emailVerified: !!decoded.email_verified,
          schoolId: typeof decoded.schoolId === 'string' ? decoded.schoolId : null,
          schoolRole: isMaster ? 'master_admin' : schoolRole,
          isMasterAdmin: isMaster,
          displayName: decoded.name || email,
        };
      } catch (err: any) {
        throw new SaaSServiceError(
          `Invalid or expired authentication token: ${err?.message || 'unauthorized'}`,
          401,
          'INVALID_TOKEN'
        );
      }
    }

    // Fallback token verification using Firebase Identity Toolkit REST API when service account JSON
    // is not yet injected locally (never trusts unsigned claims; verifies directly with Google)
    if (!config.apiKey) {
      throw new SaaSServiceError(
        'Server cannot verify Firebase tokens: configure FIREBASE_SERVICE_ACCOUNT_JSON.',
        503,
        'AUTH_VERIFIER_UNAVAILABLE'
      );
    }

    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) {
      throw new SaaSServiceError('Invalid or expired Firebase ID token.', 401, 'INVALID_TOKEN');
    }
    const payload = (await resp.json()) as any;
    const user = payload?.users?.[0];
    if (!user?.localId) {
      throw new SaaSServiceError('Invalid Firebase ID token payload.', 401, 'INVALID_TOKEN');
    }

    let customClaims: Record<string, any> = {};
    if (user.customAttributes) {
      try {
        customClaims = JSON.parse(user.customAttributes);
      } catch {}
    }

    const email = (user.email || '').toLowerCase();
    const schoolRole = (customClaims.schoolRole as SaaSRole) || null;
    const isMaster =
      customClaims.isMasterAdmin === true ||
      schoolRole === 'master_admin' ||
      (!!email && !!user.emailVerified && allowlist.has(email));

    return {
      uid: user.localId,
      email,
      emailVerified: !!user.emailVerified,
      schoolId: typeof customClaims.schoolId === 'string' ? customClaims.schoolId : null,
      schoolRole: isMaster ? 'master_admin' : schoolRole,
      isMasterAdmin: isMaster,
      displayName: user.displayName || email,
    };
  }

  async createUser(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ uid: string; email: string; displayName: string }> {
    const auth = this.requireAdminAuth();
    const userRecord = await auth.createUser({
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      emailVerified: true,
      disabled: false,
    });
    return {
      uid: userRecord.uid,
      email: userRecord.email || input.email,
      displayName: userRecord.displayName || input.displayName,
    };
  }

  async setCustomClaims(uid: string, claims: CustomClaimsPayload): Promise<void> {
    const auth = this.requireAdminAuth();
    await auth.setCustomUserClaims(uid, claims);
  }

  async getUserByEmail(
    email: string
  ): Promise<{ uid: string; email: string; disabled: boolean; customClaims?: Record<string, any> } | null> {
    const auth = this.requireAdminAuth();
    try {
      const user = await auth.getUserByEmail(email);
      return {
        uid: user.uid,
        email: user.email || email,
        disabled: user.disabled,
        customClaims: user.customClaims || undefined,
      };
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        return null;
      }
      throw err;
    }
  }

  async getUserByUid(
    uid: string
  ): Promise<{ uid: string; email: string; displayName: string; disabled: boolean } | null> {
    const auth = this.requireAdminAuth();
    try {
      const user = await auth.getUser(uid);
      return {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        disabled: user.disabled,
      };
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        return null;
      }
      throw err;
    }
  }

  async updateUserStatus(uid: string, disabled: boolean): Promise<void> {
    const auth = this.requireAdminAuth();
    await auth.updateUser(uid, { disabled });
  }

  async updateUserPassword(uid: string, password: string): Promise<void> {
    const auth = this.requireAdminAuth();
    await auth.updateUser(uid, { password });
  }

  async deleteUser(uid: string): Promise<void> {
    const auth = this.requireAdminAuth();
    try {
      await auth.revokeRefreshTokens(uid).catch(() => {});
      await auth.deleteUser(uid);
    } catch (err: any) {
      if (err?.code !== 'auth/user-not-found') {
        throw err;
      }
    }
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
    const auth = this.requireAdminAuth();
    const payload: Record<string, any> = {};
    if (updates.email !== undefined) payload.email = updates.email;
    if (updates.password !== undefined) payload.password = updates.password;
    if (updates.displayName !== undefined) payload.displayName = updates.displayName;
    if (updates.disabled !== undefined) payload.disabled = updates.disabled;
    if (updates.emailVerified !== undefined) payload.emailVerified = updates.emailVerified;

    const updated = await auth.updateUser(uid, payload);
    return {
      uid: updated.uid,
      email: updated.email || '',
      displayName: updated.displayName || '',
      disabled: updated.disabled,
    };
  }
}

export class FirebaseDatabaseProvider implements DatabaseProviderInterface {
  public readonly providerName = 'firebase-firestore';

  private getDb(): Firestore {
    const { app, config } = getAdminApp();
    if (!app) {
      throw new SaaSServiceError(
        adminInitError || 'Firebase Admin Firestore is not configured on the server.',
        503,
        'ADMIN_SDK_UNAVAILABLE'
      );
    }
    const dbId = config.firestoreDatabaseId || '(default)';
    const db = dbId && dbId !== '(default)' ? getFirestore(app, dbId) : getFirestore(app);
    if (!configuredFirestoreInstances.has(db)) {
      configuredFirestoreInstances.add(db);
      try {
        db.settings({ ignoreUndefinedProperties: true });
      } catch {
        // Ignore if settings were already applied before first call; stripUndefined handles cleanup regardless
      }
    }
    return db;
  }

  async isMasterAdminUidOrEmail(uid: string, email: string): Promise<boolean> {
    if (email && getMasterAdminEmailAllowlist().has(email.toLowerCase())) {
      return true;
    }
    try {
      const db = this.getDb();
      const snap = await db.collection('master_admins').doc(uid).get();
      return snap.exists && snap.data()?.active !== false;
    } catch {
      return false;
    }
  }

  async getPlans(): Promise<SubscriptionPlanConfig[]> {
    const db = this.getDb();
    const snap = await db.collection('subscription_plans').get();
    if (snap.empty) {
      // Seed default plans on first read
      const batch = db.batch();
      for (const plan of DEFAULT_SUBSCRIPTION_PLANS) {
        batch.set(db.collection('subscription_plans').doc(plan.id), plan);
      }
      await batch.commit();
      return DEFAULT_SUBSCRIPTION_PLANS;
    }
    const plans = snap.docs.map((d) => d.data() as SubscriptionPlanConfig);
    const order: Record<string, number> = { monthly: 1, quarterly: 2, half_yearly: 3, yearly: 4 };
    return plans.sort((a, b) => (order[a.id] || 99) - (order[b.id] || 99));
  }

  async getPlanById(planId: SubscriptionPlanId): Promise<SubscriptionPlanConfig | null> {
    const plans = await this.getPlans();
    return plans.find((p) => p.id === planId) || null;
  }

  async upsertPlan(plan: SubscriptionPlanConfig): Promise<SubscriptionPlanConfig> {
    const db = this.getDb();
    const clean = stripUndefined(plan);
    await db.collection('subscription_plans').doc(plan.id).set(clean, { merge: true });
    return clean;
  }

  async getPaymentChannels(): Promise<PlatformPaymentChannels> {
    const db = this.getDb();
    const defaults = getDefaultPlatformPaymentChannels();
    const snap = await db.collection('saas_platform_config').doc('payment_channels').get();
    if (!snap.exists) {
      return defaults;
    }
    return {
      ...defaults,
      ...(snap.data() as Partial<PlatformPaymentChannels>),
    };
  }

  async savePaymentChannels(channels: PlatformPaymentChannels): Promise<PlatformPaymentChannels> {
    const db = this.getDb();
    const cleanPayload: PlatformPaymentChannels = {
      bkash: String(channels.bkash || '').trim(),
      nagad: String(channels.nagad || '').trim(),
      rocket: String(channels.rocket || '').trim(),
      bank: String(channels.bank || '').trim(),
      paymentInstruction: String(channels.paymentInstruction || '').trim(),
      supportPhone: String(channels.supportPhone || '').trim(),
      supportEmail: String(channels.supportEmail || '').trim(),
      updatedAt: channels.updatedAt || new Date().toISOString(),
      updatedBy: channels.updatedBy || '',
    };
    await db
      .collection('saas_platform_config')
      .doc('payment_channels')
      .set(cleanPayload, { merge: true });
    return cleanPayload;
  }

  async getNextSchoolId(): Promise<string> {
    const db = this.getDb();
    const counterRef = db.collection('platform_counters').doc('schools');
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      let nextSeq = 1;
      if (snap.exists) {
        nextSeq = Number(snap.data()?.lastSeq || 0) + 1;
      } else {
        const existing = await tx.get(db.collection('schools').select('schoolId'));
        existing.forEach((doc) => {
          const m = /^SCH(\d+)$/i.exec(doc.id);
          if (m) {
            const num = parseInt(m[1], 10);
            if (num >= nextSeq) nextSeq = num + 1;
          }
        });
      }
      tx.set(counterRef, { lastSeq: nextSeq, updatedAt: new Date().toISOString() }, { merge: true });
      return `SCH${String(nextSeq).padStart(3, '0')}`;
    });
  }

  async getSchoolById(schoolId: string): Promise<SchoolTenantRecord | null> {
    const db = this.getDb();
    const snap = await db.collection('schools').doc(schoolId).get();
    return snap.exists ? stripFirestoreInternalFields(snap.data()) : null;
  }

  async getSchoolByCode(schoolCode: string): Promise<SchoolTenantRecord | null> {
    const db = this.getDb();
    const normalized = schoolCode.trim().toUpperCase();
    const snap = await db.collection('schools').where('schoolCode', '==', normalized).limit(1).get();
    if (snap.empty) return null;
    return stripFirestoreInternalFields(snap.docs[0].data());
  }

  async listSchools(): Promise<SchoolTenantRecord[]> {
    const db = this.getDb();
    const snap = await db.collection('schools').orderBy('createdAt', 'desc').get();
    return snap.docs
      .map((d) => stripFirestoreInternalFields(d.data()))
      .filter((s) => !!s.schoolId);
  }

  async createSchool(school: SchoolTenantRecord): Promise<SchoolTenantRecord> {
    const db = this.getDb();
    const clean = stripUndefined(school);
    await db.collection('schools').doc(school.schoolId).set(stripUndefined(normalizeSchoolRecordForFirestore(clean)));
    return clean;
  }

  async updateSchool(schoolId: string, updates: Partial<SchoolTenantRecord>): Promise<SchoolTenantRecord> {
    const db = this.getDb();
    const ref = db.collection('schools').doc(schoolId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new SaaSServiceError(`School "${schoolId}" not found.`, 404, 'SCHOOL_NOT_FOUND');
    }
    const merged = stripUndefined({
      ...stripFirestoreInternalFields(snap.data()),
      ...updates,
    }) as SchoolTenantRecord;
    await ref.set(stripUndefined(normalizeSchoolRecordForFirestore(merged)));
    return merged;
  }

  async deleteSchool(schoolId: string): Promise<void> {
    const db = this.getDb();
    const schoolRef = db.collection('schools').doc(schoolId);
    const snap = await schoolRef.get();
    if (!snap.exists) {
      throw new SaaSServiceError(`School "${schoolId}" not found.`, 404, 'SCHOOL_NOT_FOUND');
    }

    const [
      saasUsersSnap,
      paymentsSnap,
      historySnap,
      legacySyncBySchoolSnap,
      legacySyncByTenantSnap,
    ] = await Promise.all([
      db.collection('saas_users').where('schoolId', '==', schoolId).get(),
      db.collection('payment_requests').where('schoolId', '==', schoolId).get(),
      db.collection('subscription_history').where('schoolId', '==', schoolId).get(),
      db.collection('school_sync').where('schoolId', '==', schoolId).get().catch(() => null),
      db.collection('school_sync').where('tenantId', '==', schoolId).get().catch(() => null),
    ]);

    const refsToDelete = new Map<string, FirebaseFirestore.DocumentReference>();
    const addRef = (ref: FirebaseFirestore.DocumentReference) => {
      refsToDelete.set(ref.path, ref);
    };

    saasUsersSnap.docs.forEach((d) => addRef(d.ref));
    paymentsSnap.docs.forEach((d) => {
      const pData = d.data() as Partial<SaaSPaymentRequest>;
      if (pData?.normalizedTransactionId) {
        addRef(db.collection('payment_trx_index').doc(pData.normalizedTransactionId));
      }
      addRef(d.ref);
    });
    historySnap.docs.forEach((d) => addRef(d.ref));
    legacySyncBySchoolSnap?.docs.forEach((d) => addRef(d.ref));
    legacySyncByTenantSnap?.docs.forEach((d) => addRef(d.ref));
    addRef(db.collection('school_sync').doc(schoolId));

    // Delete all top-level SaaS / legacy references in batches of 400
    const topLevelRefs = Array.from(refsToDelete.values());
    for (let i = 0; i < topLevelRefs.length; i += 400) {
      const batch = db.batch();
      for (const r of topLevelRefs.slice(i, i + 400)) {
        batch.delete(r);
      }
      await batch.commit();
    }

    // Recursively delete schools/{schoolId} and EVERY nested subcollection (users, slices, chunks, domain collections)
    if (typeof (db as any).recursiveDelete === 'function') {
      await (db as any).recursiveDelete(schoolRef);
    } else {
      const subCols = await schoolRef.listCollections();
      const subRefs: FirebaseFirestore.DocumentReference[] = [];
      for (const col of subCols) {
        const colSnap = await col.get();
        colSnap.docs.forEach((d) => subRefs.push(d.ref));
      }
      subRefs.push(schoolRef);
      for (let i = 0; i < subRefs.length; i += 400) {
        const batch = db.batch();
        for (const r of subRefs.slice(i, i + 400)) {
          batch.delete(r);
        }
        await batch.commit();
      }
    }
  }

  async listPaymentRequests(schoolId?: string): Promise<SaaSPaymentRequest[]> {
    const db = this.getDb();
    let query: FirebaseFirestore.Query = db.collection('payment_requests');
    if (schoolId) {
      query = query.where('schoolId', '==', schoolId);
    }
    const snap = await query.get();
    const list = snap.docs.map((d) => d.data() as SaaSPaymentRequest);
    return list.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  }

  async getPaymentRequestById(id: string): Promise<SaaSPaymentRequest | null> {
    const db = this.getDb();
    const snap = await db.collection('payment_requests').doc(id).get();
    return snap.exists ? (snap.data() as SaaSPaymentRequest) : null;
  }

  async getPaymentByNormalizedTrxId(normalizedTrxId: string): Promise<SaaSPaymentRequest | null> {
    const db = this.getDb();
    const lockSnap = await db.collection('payment_trx_index').doc(normalizedTrxId).get();
    if (!lockSnap.exists) return null;
    const reqId = lockSnap.data()?.paymentRequestId;
    if (!reqId) return null;
    return this.getPaymentRequestById(reqId);
  }

  async listSubscriptionHistory(schoolId?: string): Promise<SubscriptionHistoryRecord[]> {
    const db = this.getDb();
    let query: FirebaseFirestore.Query = db.collection('subscription_history');
    if (schoolId) {
      query = query.where('schoolId', '==', schoolId);
    }
    const snap = await query.get();
    const list = snap.docs.map((d) => d.data() as SubscriptionHistoryRecord);
    return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  async appendSubscriptionHistory(entry: SubscriptionHistoryRecord): Promise<void> {
    const db = this.getDb();
    await db.collection('subscription_history').doc(entry.id).set(stripUndefined(entry));
  }

  async createSaaSUserRecord(user: SaaSUserRecord): Promise<SaaSUserRecord> {
    const db = this.getDb();
    const cleanUser = stripUndefined(user);
    const batch = db.batch();
    batch.set(db.collection('saas_users').doc(user.uid), cleanUser);
    batch.set(db.collection('schools').doc(user.schoolId).collection('users').doc(user.uid), cleanUser);
    await batch.commit();
    return cleanUser;
  }

  async getSaaSUserByUid(uid: string): Promise<SaaSUserRecord | null> {
    const db = this.getDb();
    const snap = await db.collection('saas_users').doc(uid).get();
    return snap.exists ? (snap.data() as SaaSUserRecord) : null;
  }

  async getSaaSUserByEmail(email: string): Promise<SaaSUserRecord | null> {
    const db = this.getDb();
    const snap = await db
      .collection('saas_users')
      .where('email', '==', email.trim().toLowerCase())
      .limit(1)
      .get();
    return snap.empty ? null : (snap.docs[0].data() as SaaSUserRecord);
  }

  async listSaaSUsersBySchool(schoolId: string): Promise<SaaSUserRecord[]> {
    const db = this.getDb();
    const [scopedSnap, globalSnap] = await Promise.all([
      db.collection('schools').doc(schoolId).collection('users').get(),
      db.collection('saas_users').where('schoolId', '==', schoolId).get(),
    ]);
    const byUid = new Map<string, SaaSUserRecord>();
    globalSnap.docs.forEach((d) => {
      const u = d.data() as SaaSUserRecord;
      if (u?.uid) byUid.set(u.uid, u);
    });
    scopedSnap.docs.forEach((d) => {
      const u = d.data() as SaaSUserRecord;
      if (u?.uid) byUid.set(u.uid, u);
    });
    return Array.from(byUid.values());
  }

  async updateSaaSUserRecord(uid: string, updates: Partial<SaaSUserRecord>): Promise<SaaSUserRecord> {
    const db = this.getDb();
    const existing = await this.getSaaSUserByUid(uid);
    if (!existing) {
      throw new SaaSServiceError('User record not found.', 404, 'USER_NOT_FOUND');
    }
    const updated = stripUndefined({ ...existing, ...updates });
    const batch = db.batch();
    batch.set(db.collection('saas_users').doc(uid), updated);
    batch.set(db.collection('schools').doc(existing.schoolId).collection('users').doc(uid), updated);
    await batch.commit();
    return updated;
  }

  async deleteSaaSUserRecord(uid: string, schoolIdHint?: string): Promise<void> {
    const db = this.getDb();
    const existing = await this.getSaaSUserByUid(uid);
    const schoolId = existing?.schoolId || schoolIdHint;
    if (!existing && !schoolId) {
      throw new SaaSServiceError('User record not found.', 404, 'USER_NOT_FOUND');
    }
    const batch = db.batch();
    batch.delete(db.collection('saas_users').doc(uid));
    if (schoolId) {
      batch.delete(db.collection('schools').doc(schoolId).collection('users').doc(uid));
    }
    await batch.commit();
  }

  async getTenantSlices(schoolId: string): Promise<Record<string, any>> {
    const db = this.getDb();
    const snap = await db.collection('schools').doc(schoolId).collection('slices').get();
    const result: Record<string, any> = {};
    snap.forEach((doc) => {
      result[doc.id] = doc.data();
    });
    return result;
  }

  async saveTenantSlice(schoolId: string, sliceName: string, data: Record<string, any>): Promise<void> {
    const db = this.getDb();
    await db
      .collection('schools')
      .doc(schoolId)
      .collection('slices')
      .doc(sliceName)
      .set(
        stripUndefined({
          ...data,
          schoolId,
          slice: sliceName,
          updatedAt: new Date().toISOString(),
        }),
        { merge: true }
      );
  }

  async runInTransaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const db = this.getDb();
    return db.runTransaction(async (fsTx) => {
      // Cache reads inside the transaction so sequential updates (e.g., approvePaymentRequest)
      // never perform a Firestore read after a write.
      const schoolCache = new Map<string, SchoolTenantRecord | null>();
      const paymentCache = new Map<string, SaaSPaymentRequest | null>();

      const ctx: TransactionContext = {
        async getSchoolById(schoolId) {
          if (schoolCache.has(schoolId)) {
            const cached = schoolCache.get(schoolId);
            return cached ? structuredClone(cached) : null;
          }
          const snap = await fsTx.get(db.collection('schools').doc(schoolId));
          const record = snap.exists ? stripFirestoreInternalFields(snap.data()) : null;
          schoolCache.set(schoolId, record);
          return record ? structuredClone(record) : null;
        },
        async updateSchool(schoolId, updates) {
          const ref = db.collection('schools').doc(schoolId);
          let existing = schoolCache.has(schoolId) ? schoolCache.get(schoolId) ?? null : undefined;
          if (existing === undefined) {
            const snap = await fsTx.get(ref);
            existing = snap.exists ? stripFirestoreInternalFields(snap.data()) : null;
          }
          if (!existing) {
            throw new SaaSServiceError(`School "${schoolId}" not found.`, 404, 'SCHOOL_NOT_FOUND');
          }
          const merged = stripUndefined({
            ...existing,
            ...updates,
          }) as SchoolTenantRecord;
          schoolCache.set(schoolId, merged);
          fsTx.set(ref, stripUndefined(normalizeSchoolRecordForFirestore(merged)));
          return structuredClone(merged);
        },
        async getPaymentRequestById(id) {
          if (paymentCache.has(id)) {
            const cached = paymentCache.get(id);
            return cached ? structuredClone(cached) : null;
          }
          const snap = await fsTx.get(db.collection('payment_requests').doc(id));
          const record = snap.exists ? (snap.data() as SaaSPaymentRequest) : null;
          paymentCache.set(id, record);
          return record ? structuredClone(record) : null;
        },
        async getPaymentByNormalizedTrxId(normalizedTrxId) {
          const lockSnap = await fsTx.get(db.collection('payment_trx_index').doc(normalizedTrxId));
          if (!lockSnap.exists) return null;
          const reqId = lockSnap.data()?.paymentRequestId;
          if (!reqId) return null;
          return ctx.getPaymentRequestById(reqId);
        },
        async createPaymentRequestWithTrxLock(request) {
          const cleanReq = stripUndefined(request);
          const lockRef = db.collection('payment_trx_index').doc(cleanReq.normalizedTransactionId);
          const reqRef = db.collection('payment_requests').doc(cleanReq.id);
          fsTx.create(lockRef, {
            normalizedTransactionId: cleanReq.normalizedTransactionId,
            paymentRequestId: cleanReq.id,
            schoolId: cleanReq.schoolId,
            createdAt: cleanReq.submittedAt,
          });
          fsTx.create(reqRef, cleanReq);
          paymentCache.set(cleanReq.id, cleanReq);
          return structuredClone(cleanReq);
        },
        async updatePaymentRequest(id, updates) {
          const ref = db.collection('payment_requests').doc(id);
          let existing = paymentCache.has(id) ? paymentCache.get(id) ?? null : undefined;
          if (existing === undefined) {
            const snap = await fsTx.get(ref);
            existing = snap.exists ? (snap.data() as SaaSPaymentRequest) : null;
          }
          if (!existing) {
            throw new SaaSServiceError('Payment request not found.', 404, 'PAYMENT_NOT_FOUND');
          }
          const merged = stripUndefined({ ...existing, ...updates }) as SaaSPaymentRequest;
          paymentCache.set(id, merged);
          fsTx.set(ref, merged);
          return structuredClone(merged);
        },
        async appendSubscriptionHistory(entry) {
          fsTx.set(db.collection('subscription_history').doc(entry.id), stripUndefined(entry));
        },
      };
      return fn(ctx);
    });
  }
}

export function isFirebaseAdminConfigured(): boolean {
  const { hasCredentials } = getAdminApp();
  return hasCredentials;
}
