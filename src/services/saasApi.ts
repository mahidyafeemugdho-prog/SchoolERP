import { getFreshIdToken } from './firebase';

export type SaaSPlanId = 'free' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'lifetime' | (string & {});
export type SaaSSubscriptionStatus = 'Pending' | 'Active' | 'Expired' | 'Suspended';
export type SaaSSchoolStatus = 'pending' | 'active' | 'expired' | 'suspended';

export const CORE_PLAN_IDS = new Set<string>([
  'free',
  'monthly',
  'quarterly',
  'half_yearly',
  'yearly',
  'lifetime',
]);

export interface SaaSPlanConfig {
  id: SaaSPlanId;
  name: string;
  nameBn: string;
  durationDays: number;
  priceBdt: number;
  discountPercent?: number;
  badgeText?: string;
  features?: string[];
  sortOrder?: number;
  isCustom?: boolean;
  description: string;
  descriptionBn: string;
  isActive: boolean;
  updatedAt: string;
}

export function getEffectivePlanPriceBdt(plan: {
  priceBdt: number;
  discountPercent?: number;
}): number {
  const base = Math.max(0, Number(plan.priceBdt) || 0);
  const pct = Math.min(100, Math.max(0, Number(plan.discountPercent) || 0));
  if (base === 0 || pct === 0) return Math.round(base);
  return Math.max(0, Math.round(base * (1 - pct / 100)));
}

export interface SaaSComputedSubscription {
  planId: SaaSPlanId;
  planName: string;
  effectiveStatus: SaaSSubscriptionStatus;
  schoolStatus: SaaSSchoolStatus;
  startDate: string;
  expiryDate: string;
  remainingDays: number;
  expiredDays: number;
  isExpired: boolean;
  isSuspended: boolean;
  isPending: boolean;
  accessAllowed: boolean;
  lastPaymentDate: string | null;
  nextRenewalDate: string | null;
  serverTime: string;
}

export interface SaaSSchoolRecord {
  schoolId: string;
  schoolCode: string;
  schoolName: string;
  address: string;
  contactNumber: string;
  email: string;
  principalName: string;
  adminName: string;
  adminEmail: string;
  adminUid: string;
  status: SaaSSchoolStatus;
  subscription: {
    planId: SaaSPlanId;
    planName: string;
    status: SaaSSubscriptionStatus;
    startDate: string;
    expiryDate: string;
    lastPaymentDate: string | null;
    nextRenewalDate: string | null;
    amountBdt: number;
  };
  computedSubscription?: SaaSComputedSubscription;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  notes?: string;
}

export interface SaaSPaymentRequestDTO {
  id: string;
  schoolId: string;
  schoolName: string;
  planId: SaaSPlanId;
  planName: string;
  durationDays: number;
  amount: number;
  paymentMethod: 'bKash' | 'Nagad' | 'Rocket' | 'Bank Transfer';
  senderNumber: string;
  transactionId: string;
  paymentDate: string;
  screenshotUrl?: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedByEmail: string;
  submittedAt: string;
  reviewedByEmail?: string;
  reviewedAt?: string;
  rejectionReason?: string;
}

export interface SaaSPlatformPaymentChannels {
  bkash: string;
  nagad: string;
  rocket?: string;
  bank: string;
  paymentInstruction?: string;
  supportPhone: string;
  supportEmail: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface SaaSSubscriptionHistoryDTO {
  id: string;
  schoolId: string;
  schoolName: string;
  eventType: string;
  planId: SaaSPlanId;
  planName: string;
  previousExpiryDate: string | null;
  newExpiryDate: string | null;
  durationDaysAdded: number;
  amount?: number;
  transactionId?: string;
  actorEmail: string;
  remarks: string;
  createdAt: string;
}

export interface SaaSUserDTO {
  uid: string;
  email: string;
  displayName: string;
  schoolId: string;
  schoolRole: string;
  linkedStaffId?: string;
  linkedStudentId?: string;
  phone?: string;
  avatarUrl?: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

export interface SaaSMeResponse {
  success: boolean;
  principal: {
    uid: string;
    email: string;
    emailVerified: boolean;
    schoolId: string | null;
    schoolRole: string | null;
    isMasterAdmin: boolean;
    displayName?: string;
    linkedStaffId?: string;
    linkedStudentId?: string;
    phone?: string;
    avatarUrl?: string;
  };
  school: SaaSSchoolRecord | null;
  subscription: SaaSComputedSubscription | null;
  accessAllowed: boolean;
  blockReason: string | null;
  platformSupportContact: {
    phone: string;
    email: string;
  };
}

export interface SaaSMasterAnalytics {
  totalSchools: number;
  activeSchools: number;
  expiredSchools: number;
  suspendedSchools: number;
  pendingSchools: number;
  totalRevenue: number;
  pendingPaymentsCount: number;
  approvedPaymentsCount: number;
  planDistribution: Record<string, number>;
}

export type SupportCategory = 'technical' | 'billing' | 'training' | 'data' | 'other';
export type SupportTicketStatus = 'open' | 'replied' | 'resolved';
export type SupportSenderRole = 'school' | 'master_admin';

export interface SupportTicketDTO {
  id: string;
  schoolId: string;
  schoolName: string;
  schoolCode?: string;
  createdByUid: string;
  createdByName?: string;
  createdByEmail: string;
  createdByRole: string;
  subject: string;
  category: SupportCategory;
  status: SupportTicketStatus;
  lastMessagePreview?: string;
  lastSenderRole: SupportSenderRole;
  unreadByMaster: boolean;
  unreadBySchool: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessageDTO {
  id: string;
  ticketId: string;
  schoolId: string;
  ticketCreatorUid?: string;
  senderUid: string;
  senderName: string;
  senderEmail?: string;
  senderRole: SupportSenderRole;
  senderSchoolRole?: string;
  text: string;
  imageUrls: string[];
  createdAt: string;
}

export const DEFAULT_FALLBACK_PLANS: SaaSPlanConfig[] = [
  {
    id: 'free',
    name: 'Free Plan',
    nameBn: 'ফ্রি প্ল্যান',
    durationDays: 30,
    priceBdt: 0,
    description: 'Free starter plan with full school ERP access',
    descriptionBn: 'সম্পূর্ণ বিনামূল্যে ৩০ দিনের স্টার্টার স্কুল ইআরপি প্ল্যান',
    isActive: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'monthly',
    name: 'Monthly Plan',
    nameBn: 'মাসিক প্ল্যান',
    durationDays: 30,
    priceBdt: 1500,
    description: 'Full multi-module school ERP access for 30 days',
    descriptionBn: '৩০ দিনের জন্য সম্পূর্ণ স্কুল ইআরপি সুবিধা',
    isActive: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'quarterly',
    name: 'Quarterly Plan',
    nameBn: 'ত্রৈমাসিক প্ল্যান',
    durationDays: 90,
    priceBdt: 4200,
    description: '90-day school ERP subscription with priority support',
    descriptionBn: '৯০ দিনের স্কুল ইআরপি সাবস্ক্রিপশন ও সাপোর্ট',
    isActive: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'half_yearly',
    name: 'Half-Yearly Plan',
    nameBn: 'ষাণ্মাসিক প্ল্যান',
    durationDays: 180,
    priceBdt: 8000,
    description: '180-day semester subscription with savings',
    descriptionBn: '১৮০ দিনের সাশ্রয়ী সেমিস্টার সাবস্ক্রিপশন',
    isActive: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'yearly',
    name: 'Yearly Plan',
    nameBn: 'বাৎসরিক প্ল্যান',
    durationDays: 365,
    priceBdt: 15000,
    description: 'Best value 365-day annual institutional license',
    descriptionBn: '৩৬৫ দিনের সেরা সাশ্রয়ী বাৎসরিক লাইসেন্স',
    isActive: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'lifetime',
    name: 'Lifetime Plan',
    nameBn: 'লাইফটাইম প্ল্যান',
    durationDays: 36500,
    priceBdt: 25000,
    description: 'One-time lifetime institutional school ERP license',
    descriptionBn: 'এককালীন পেমেন্টে আজীবন (লাইফটাইম) স্কুল ইআরপি লাইসেন্স',
    isActive: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

export const DEFAULT_FALLBACK_CHANNELS: SaaSPlatformPaymentChannels = {
  bkash: '01711-234567 (Merchant / Send Money)',
  nagad: '01911-234567 (Personal / Merchant)',
  rocket: '',
  bank: 'Dutch-Bangla Bank • A/C: 101-110-0045678 (SmartSchool BD)',
  paymentInstruction: '',
  supportPhone: 'Platform Support',
  supportEmail: 'support@smartschoolbd.com',
};

export function isSaaSBackendUnavailableError(err: any): boolean {
  const code = err?.code;
  const status = err?.status;
  if (
    code === 'NON_JSON_RESPONSE' ||
    code === 'EMPTY_RESPONSE' ||
    code === 'INVALID_ME_RESPONSE' ||
    code === 'ADMIN_SDK_UNAVAILABLE' ||
    code === 'AUTH_VERIFIER_UNAVAILABLE'
  ) {
    return true;
  }
  if (status === 502 || status === 503 || status === 504) {
    return true;
  }
  if (status === 404 && code !== 'SCHOOL_NOT_FOUND' && code !== 'PLAN_NOT_FOUND' && code !== 'PAYMENT_NOT_FOUND') {
    return true;
  }
  if (err instanceof TypeError || err?.name === 'AbortError' || code === 'TIMEOUT') {
    return true;
  }
  return false;
}

export function computeClientSubscriptionState(
  school: any,
  nowMs: number = Date.now()
): SaaSComputedSubscription {
  const planId = (school?.subscription?.planId || 'monthly') as SaaSPlanId;
  const planName = school?.subscription?.planName || planId;
  const startDate = school?.subscription?.startDate || school?.createdAt || new Date(nowMs).toISOString();
  const expiryDate = school?.subscription?.expiryDate || new Date(nowMs).toISOString();
  const expiryMs = new Date(expiryDate).getTime();
  const diffMs = Number.isNaN(expiryMs) ? -1 : expiryMs - nowMs;
  const dayMs = 86_400_000;

  const isSuspended = school?.status === 'suspended' || school?.subscription?.status === 'Suspended';
  const isPending = school?.status === 'pending' || school?.subscription?.status === 'Pending';
  const isExpiredByDate = diffMs <= 0;
  const isExpired =
    !isSuspended &&
    !isPending &&
    (school?.status === 'expired' || school?.subscription?.status === 'Expired' || isExpiredByDate);

  const effectiveStatus = isSuspended
    ? 'Suspended'
    : isPending
    ? 'Pending'
    : isExpired
    ? 'Expired'
    : 'Active';

  const schoolStatus = isSuspended
    ? 'suspended'
    : isPending
    ? 'pending'
    : isExpired
    ? 'expired'
    : 'active';

  return {
    planId,
    planName,
    effectiveStatus,
    schoolStatus,
    startDate,
    expiryDate,
    remainingDays: diffMs > 0 ? Math.ceil(diffMs / dayMs) : 0,
    expiredDays: diffMs < 0 ? Math.ceil(Math.abs(diffMs) / dayMs) : 0,
    isExpired,
    isSuspended,
    isPending,
    accessAllowed: effectiveStatus === 'Active',
    lastPaymentDate: school?.subscription?.lastPaymentDate || null,
    nextRenewalDate: school?.subscription?.nextRenewalDate || null,
    serverTime: new Date(nowMs).toISOString(),
  };
}

const SAAS_API_BASE = (import.meta.env.VITE_SAAS_API_BASE || '/api/saas').replace(/\/+$/, '');

async function saasFetch<T>(path: string, options: RequestInit = {}, requireAuthToken = true): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (requireAuthToken) {
    const token = await getFreshIdToken(false);
    if (!token) {
      throw new Error('Authentication session expired. Please sign in again.');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(`${SAAS_API_BASE}${path}`, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
    });
  } catch (fetchErr: any) {
    if (fetchErr?.name === 'AbortError') {
      const err = new Error('SaaS API request timed out.') as Error & {
        code?: string;
        status?: number;
      };
      err.code = 'TIMEOUT';
      err.status = 504;
      throw err;
    }
    throw fetchErr;
  } finally {
    clearTimeout(timeoutId);
  }

  const contentType = res.headers.get('content-type') || '';
  const rawText = await res.text();
  let data: any = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      const err = new Error(
        res.ok
          ? 'SaaS API returned a non-JSON response (static SPA fallback or HTML page).'
          : `SaaS API error (${res.status}): invalid server response.`
      ) as Error & {
        code?: string;
        status?: number;
      };
      err.code = 'NON_JSON_RESPONSE';
      err.status = res.status;
      throw err;
    }
  }

  if (!data || typeof data !== 'object') {
    const err = new Error(`SaaS API returned an empty response (${res.status}).`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = contentType.includes('application/json') ? 'EMPTY_RESPONSE' : 'NON_JSON_RESPONSE';
    err.status = res.status;
    throw err;
  }

  if (!res.ok || data?.success === false) {
    const err = new Error(data?.error || `Request failed (${res.status})`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }

  return data as T;
}

export const SaaSApi = {
  getHealth: () =>
    saasFetch<{
      success: boolean;
      dbProvider: string;
      authProvider: string;
      adminSdkReady: boolean;
      serverTime: string;
    }>('/health', {}, false),

  getPlans: () =>
    saasFetch<{
      success: boolean;
      plans: SaaSPlanConfig[];
      platformPaymentChannels: SaaSPlatformPaymentChannels;
    }>('/plans', {}, false),

  getMe: async () => {
    const data = await saasFetch<SaaSMeResponse>('/me');
    if (!data || !data.principal || typeof data.principal !== 'object') {
      const err = new Error('Invalid SaaS session response: missing principal metadata.') as Error & {
        code?: string;
        status?: number;
      };
      err.code = 'INVALID_ME_RESPONSE';
      err.status = 502;
      throw err;
    }
    return data;
  },

  updateMyCredentials: (payload: {
    displayName?: string;
    email?: string;
    password?: string;
    phone?: string;
    avatarUrl?: string;
  }) =>
    saasFetch<{
      success: boolean;
      user: {
        uid: string;
        email: string;
        displayName: string;
        phone?: string;
        avatarUrl?: string;
        schoolId: string | null;
        schoolRole: string | null;
        isMasterAdmin: boolean;
      };
    }>('/me/credentials', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // School User Payment Endpoints
  getMyPaymentRequests: () =>
    saasFetch<{
      success: boolean;
      schoolId: string;
      paymentRequests: SaaSPaymentRequestDTO[];
      subscriptionHistory: SaaSSubscriptionHistoryDTO[];
    }>('/my-payment-request'),

  submitPaymentRequest: (payload: {
    planId: SaaSPlanId;
    amount: number;
    paymentMethod: 'bKash' | 'Nagad' | 'Rocket' | 'Bank Transfer';
    senderNumber: string;
    transactionId: string;
    paymentDate: string;
    screenshotUrl?: string;
    notes?: string;
  }) =>
    saasFetch<{ success: boolean; paymentRequest: SaaSPaymentRequestDTO }>('/payment-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Staff / User Provisioning Endpoints
  provisionUser: (payload: {
    email: string;
    password: string;
    displayName: string;
    schoolRole: string;
    schoolId?: string;
    linkedStaffId?: string;
    linkedStudentId?: string;
    phone?: string;
  }) =>
    saasFetch<{ success: boolean; user: SaaSUserDTO }>('/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listUsers: (schoolId?: string) =>
    saasFetch<{ success: boolean; users: SaaSUserDTO[] }>(
      schoolId ? `/users?schoolId=${encodeURIComponent(schoolId)}` : '/users'
    ),

  setUserStatus: (uid: string, disabled: boolean) =>
    saasFetch<{ success: boolean; user: SaaSUserDTO }>(`/users/${encodeURIComponent(uid)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    }),

  updateUserCredentials: (
    uid: string,
    payload: {
      displayName?: string;
      email?: string;
      password?: string;
      phone?: string;
      schoolRole?: string;
      linkedStudentId?: string;
      linkedStaffId?: string;
    }
  ) =>
    saasFetch<{ success: boolean; user: SaaSUserDTO }>(`/users/${encodeURIComponent(uid)}/credentials`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteUser: (uid: string) =>
    saasFetch<{ success: boolean; deletedUid: string; schoolId: string; email: string }>(
      `/users/${encodeURIComponent(uid)}`,
      { method: 'DELETE' }
    ),

  // Master Admin Endpoints
  masterListSchools: (filters?: { search?: string; status?: string }) => {
    const params = new URLSearchParams();
    if (filters?.search) params.set('search', filters.search);
    if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
    const qs = params.toString();
    return saasFetch<{
      success: boolean;
      schools: SaaSSchoolRecord[];
      analytics: SaaSMasterAnalytics;
    }>(`/master/schools${qs ? `?${qs}` : ''}`);
  },

  masterCreateSchool: (payload: {
    schoolName: string;
    schoolCode: string;
    address: string;
    contactNumber: string;
    email: string;
    principalName: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
    initialPlan: SaaSPlanId;
    startDate: string;
    expiryDate?: string;
    activateImmediately?: boolean;
  }) =>
    saasFetch<{ success: boolean; school: SaaSSchoolRecord }>('/master/schools', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  masterGetSchoolDetails: (schoolId: string) =>
    saasFetch<{
      success: boolean;
      school: SaaSSchoolRecord;
      paymentHistory: SaaSPaymentRequestDTO[];
      subscriptionHistory: SaaSSubscriptionHistoryDTO[];
      users: SaaSUserDTO[];
    }>(`/master/schools/${encodeURIComponent(schoolId)}`),

  masterUpdateSchool: (
    schoolId: string,
    payload: {
      schoolName?: string;
      schoolCode?: string;
      address?: string;
      contactNumber?: string;
      email?: string;
      principalName?: string;
      status?: SaaSSchoolStatus;
      extendDays?: number;
      newExpiryDate?: string;
      planId?: SaaSPlanId;
      notes?: string;
    }
  ) =>
    saasFetch<{ success: boolean; school: SaaSSchoolRecord }>(
      `/master/schools/${encodeURIComponent(schoolId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  masterDeleteSchool: (schoolId: string) =>
    saasFetch<{ success: boolean; deletedSchoolId: string; deletedUsersCount?: number }>(
      `/master/schools/${encodeURIComponent(schoolId)}`,
      { method: 'DELETE' }
    ),

  masterListPlans: () =>
    saasFetch<{ success: boolean; plans: SaaSPlanConfig[] }>('/master/plans'),

  masterCreatePlan: (payload: {
    id?: string;
    name: string;
    nameBn?: string;
    priceBdt: number;
    discountPercent?: number;
    durationDays: number;
    badgeText?: string;
    features?: string[];
    description?: string;
    descriptionBn?: string;
    isActive?: boolean;
  }) =>
    saasFetch<{ success: boolean; plan: SaaSPlanConfig }>('/master/plans', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  masterUpdatePlan: (
    planId: SaaSPlanId,
    payload: Partial<
      Pick<
        SaaSPlanConfig,
        | 'name'
        | 'nameBn'
        | 'priceBdt'
        | 'discountPercent'
        | 'durationDays'
        | 'badgeText'
        | 'features'
        | 'sortOrder'
        | 'description'
        | 'descriptionBn'
        | 'isActive'
      >
    >
  ) =>
    saasFetch<{ success: boolean; plan: SaaSPlanConfig }>(`/master/plans/${encodeURIComponent(planId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  masterDeletePlan: (planId: SaaSPlanId) =>
    saasFetch<{ success: boolean; deletedPlanId: string }>(
      `/master/plans/${encodeURIComponent(planId)}`,
      { method: 'DELETE' }
    ),

  masterListPaymentRequests: (filters?: { schoolId?: string; status?: string }) => {
    const params = new URLSearchParams();
    if (filters?.schoolId) params.set('schoolId', filters.schoolId);
    if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
    const qs = params.toString();
    return saasFetch<{ success: boolean; paymentRequests: SaaSPaymentRequestDTO[] }>(
      `/master/payment-requests${qs ? `?${qs}` : ''}`
    );
  },

  masterApprovePaymentRequest: (id: string) =>
    saasFetch<{ success: boolean; paymentRequest: SaaSPaymentRequestDTO; school: SaaSSchoolRecord }>(
      `/master/payment-requests/${encodeURIComponent(id)}/approve`,
      { method: 'POST', body: JSON.stringify({}) }
    ),

  masterGetPaymentChannels: () =>
    saasFetch<{ success: boolean; channels: SaaSPlatformPaymentChannels }>('/master/payment-channels'),

  masterUpdatePaymentChannels: (payload: Partial<SaaSPlatformPaymentChannels>) =>
    saasFetch<{ success: boolean; channels: SaaSPlatformPaymentChannels }>('/master/payment-channels', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  masterRejectPaymentRequest: (id: string, rejectionReason: string) =>
    saasFetch<{ success: boolean; paymentRequest: SaaSPaymentRequestDTO }>(
      `/master/payment-requests/${encodeURIComponent(id)}/reject`,
      { method: 'POST', body: JSON.stringify({ rejectionReason }) }
    ),

  // Guardian Online School Fee Payments (bKash / Nagad / Rocket)
  submitOnlineFeePayment: (payload: {
    id?: string;
    receiptNo?: string;
    studentId: string;
    studentName: string;
    studentRoll?: string;
    className?: string;
    section?: string;
    feeTitle: string;
    amount: number;
    items?: any[];
    isPayAll?: boolean;
    paymentMethod: 'bKash' | 'Nagad' | 'Rocket';
    senderPhone: string;
    transactionId: string;
    requestDate?: string;
    notes?: string;
  }) =>
    saasFetch<{ success: boolean; schoolId: string; request: any }>('/tenant/online-payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listOnlineFeePayments: () =>
    saasFetch<{ success: boolean; schoolId: string; requests: any[] }>('/tenant/online-payments'),

  // Student / Guardian Homework Submissions (persisted via Admin SDK across devices)
  submitHomeworkSubmission: (payload: Record<string, any>) =>
    saasFetch<{ success: boolean; schoolId: string; submission: any; submissions: any[] }>(
      '/tenant/homework-submissions',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  listHomeworkSubmissions: () =>
    saasFetch<{ success: boolean; schoolId: string; submissions: any[] }>('/tenant/homework-submissions'),

  // Support Team Two-Way Chat & Screenshot Feedback
  listSupportTickets: (filters?: { status?: string; schoolId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters?.schoolId) params.set('schoolId', filters.schoolId);
    const qs = params.toString();
    return saasFetch<{ success: boolean; tickets: SupportTicketDTO[] }>(
      `/support/tickets${qs ? `?${qs}` : ''}`
    );
  },

  createSupportTicket: (payload: {
    subject: string;
    category: SupportCategory;
    text: string;
    imageUrls?: string[];
    schoolId?: string;
    schoolName?: string;
    schoolCode?: string;
  }) =>
    saasFetch<{ success: boolean; ticket: SupportTicketDTO; message: SupportMessageDTO }>(
      '/support/tickets',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  listSupportMessages: (ticketId: string) =>
    saasFetch<{ success: boolean; ticket: SupportTicketDTO; messages: SupportMessageDTO[] }>(
      `/support/tickets/${encodeURIComponent(ticketId)}/messages`
    ),

  sendSupportMessage: (
    ticketId: string,
    payload: { text: string; imageUrls?: string[] }
  ) =>
    saasFetch<{ success: boolean; ticket: SupportTicketDTO; message: SupportMessageDTO }>(
      `/support/tickets/${encodeURIComponent(ticketId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateSupportTicketStatus: (
    ticketId: string,
    payload: { status?: SupportTicketStatus; markRead?: boolean }
  ) =>
    saasFetch<{ success: boolean; ticket: SupportTicketDTO }>(
      `/support/tickets/${encodeURIComponent(ticketId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),
};
