import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  Unsubscribe,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import {
  HRApprovalStatus,
  HRDocumentAuditEntry,
  HRDocumentType,
  Staff,
  StaffDocumentTemplate,
  StaffHRDocument,
  StaffResignationRequest,
  UserProfile,
  UserRole,
} from '../types';
import { StorageService } from './storage';
import {
  canAccountantViewSalaryHRDocs,
  canManageAllHRDocuments,
  createDefaultHRTemplate,
  getNextHRSerialNumber,
} from '../utils/hrDocumentHelpers';
import { safeGetLocalStorage, safeSetLocalStorage } from '../utils/storageHelper';

export const HR_DOCUMENTS_UPDATED_EVENT = 'hr_documents_updated';

function emitHRUpdated() {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(HR_DOCUMENTS_UPDATED_EVENT));
    }
  } catch {
    // ignore outside browser
  }
}

function cacheKeyDocs(schoolId: string) {
  return `ssbd_hr_docs_${schoolId}`;
}

function cacheKeyTemplates(schoolId: string) {
  return `ssbd_hr_templates_${schoolId}`;
}

function cacheKeyResignations(schoolId: string) {
  return `ssbd_hr_resignations_${schoolId}`;
}

function readCachedList<T>(key: string): T[] {
  try {
    const raw = safeGetLocalStorage(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedList<T>(key: string, items: T[]): void {
  try {
    safeSetLocalStorage(key, JSON.stringify(items));
  } catch {
    // ignore quota limits
  }
}

function cleanFirestorePayload<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, val) => (val === undefined ? null : val))
  ) as T;
}

export function sortHRDocsDesc(list: StaffHRDocument[]): StaffHRDocument[] {
  return [...list].sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(
      String(a.updatedAt || a.createdAt || '')
    )
  );
}

export function sortResignationsDesc(list: StaffResignationRequest[]): StaffResignationRequest[] {
  return [...list].sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(
      String(a.updatedAt || a.createdAt || '')
    )
  );
}

export interface ActorMeta {
  uid: string;
  name: string;
  role: string;
}

export function makeAuditEntry(
  action: HRDocumentAuditEntry['action'],
  actor: ActorMeta,
  note?: string
): HRDocumentAuditEntry {
  return {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    action,
    actorUid: actor.uid,
    actorName: actor.name,
    actorRole: actor.role,
    ...(note ? { note } : {}),
    timestamp: new Date().toISOString(),
  };
}

export interface SubscribeHRDocumentsParams {
  schoolId: string;
  role: UserRole;
  user?: UserProfile | null;
  onDocuments: (docs: StaffHRDocument[]) => void;
  onError?: (err: Error) => void;
}

export function subscribeToHRDocuments({
  schoolId,
  role,
  user,
  onDocuments,
  onError,
}: SubscribeHRDocumentsParams): Unsubscribe {
  if (!schoolId) {
    onDocuments([]);
    return () => {};
  }

  let cancelled = false;
  const cached = readCachedList<StaffHRDocument>(cacheKeyDocs(schoolId));
  if (cached.length > 0) {
    onDocuments(sortHRDocsDesc(cached));
  }

  const fbUser = auth.currentUser;
  if (!fbUser) {
    return () => {
      cancelled = true;
    };
  }

  const unsubs: Unsubscribe[] = [];
  const buckets = new Map<string, Map<string, StaffHRDocument>>();

  const flushMerged = () => {
    if (cancelled) return;
    const mergedMap = new Map<string, StaffHRDocument>();
    buckets.forEach((b) => {
      b.forEach((docItem, id) => {
        mergedMap.set(id, docItem);
      });
    });
    const sorted = sortHRDocsDesc(Array.from(mergedMap.values()));
    writeCachedList(cacheKeyDocs(schoolId), sorted);
    onDocuments(sorted);
  };

  const attachQuery = (bucketKey: string, q: any, pathLabel: string) => {
    const unsub = onSnapshot(
      q,
      (snap: any) => {
        if (cancelled) return;
        const map = new Map<string, StaffHRDocument>();
        snap.docs.forEach((d: any) => {
          const data = d.data() as StaffHRDocument;
          if (data?.id) map.set(data.id, data);
        });
        buckets.set(bucketKey, map);
        flushMerged();
      },
      (err: any) => {
        handleFirestoreError(err, OperationType.LIST, pathLabel);
        if (onError && !cancelled) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    );
    unsubs.push(unsub);
  };

  const colRef = collection(db, 'schools', schoolId, 'staffDocuments');
  const colPath = `schools/${schoolId}/staffDocuments`;

  if (canManageAllHRDocuments(role, user)) {
    attachQuery('all', query(colRef), colPath);
  } else {
    attachQuery('created', query(colRef, where('createdByUid', '==', fbUser.uid)), colPath);
    attachQuery('empAuth', query(colRef, where('employeeAuthUid', '==', fbUser.uid)), colPath);
    if (user?.linkedStaffId) {
      attachQuery('linked', query(colRef, where('employeeId', '==', user.linkedStaffId)), colPath);
    }
    if (role === 'accountant' && canAccountantViewSalaryHRDocs(role, user)) {
      attachQuery(
        'salary',
        query(colRef, where('documentType', 'in', ['appointment_letter', 'salary_increment_letter'])),
        colPath
      );
    }
  }

  return () => {
    cancelled = true;
    unsubs.forEach((u) => u());
  };
}

export function subscribeToHRTemplates({
  schoolId,
  onTemplates,
  onError,
}: {
  schoolId: string;
  onTemplates: (templates: StaffDocumentTemplate[]) => void;
  onError?: (err: Error) => void;
}): Unsubscribe {
  if (!schoolId) {
    onTemplates([createDefaultHRTemplate('default')]);
    return () => {};
  }

  let cancelled = false;
  const cached = readCachedList<StaffDocumentTemplate>(cacheKeyTemplates(schoolId));
  onTemplates(cached.length > 0 ? cached : [createDefaultHRTemplate(schoolId)]);

  if (!auth.currentUser) {
    return () => {
      cancelled = true;
    };
  }

  const colRef = collection(db, 'schools', schoolId, 'staffDocumentTemplates');
  const unsub = onSnapshot(
    query(colRef),
    (snap) => {
      if (cancelled) return;
      const list = snap.docs
        .map((d) => d.data() as StaffDocumentTemplate)
        .filter((t) => Boolean(t?.id));
      const finalList = list.length > 0 ? list : [createDefaultHRTemplate(schoolId)];
      writeCachedList(cacheKeyTemplates(schoolId), finalList);
      onTemplates(finalList);
    },
    (err) => {
      handleFirestoreError(
        err,
        OperationType.LIST,
        `schools/${schoolId}/staffDocumentTemplates`
      );
      if (onError && !cancelled) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  );

  return () => {
    cancelled = true;
    unsub();
  };
}

export function subscribeToStaffResignations({
  schoolId,
  role,
  user,
  onResignations,
  onError,
}: {
  schoolId: string;
  role: UserRole;
  user?: UserProfile | null;
  onResignations: (items: StaffResignationRequest[]) => void;
  onError?: (err: Error) => void;
}): Unsubscribe {
  if (!schoolId) {
    onResignations([]);
    return () => {};
  }

  let cancelled = false;
  const cached = readCachedList<StaffResignationRequest>(cacheKeyResignations(schoolId));
  if (cached.length > 0) {
    onResignations(sortResignationsDesc(cached));
  }

  const fbUser = auth.currentUser;
  if (!fbUser) {
    return () => {
      cancelled = true;
    };
  }

  const unsubs: Unsubscribe[] = [];
  const buckets = new Map<string, Map<string, StaffResignationRequest>>();

  const flushMerged = () => {
    if (cancelled) return;
    const mergedMap = new Map<string, StaffResignationRequest>();
    buckets.forEach((b) => {
      b.forEach((item, id) => {
        mergedMap.set(id, item);
      });
    });
    const sorted = sortResignationsDesc(Array.from(mergedMap.values()));
    writeCachedList(cacheKeyResignations(schoolId), sorted);
    onResignations(sorted);
  };

  const attachQuery = (bucketKey: string, q: any, pathLabel: string) => {
    const unsub = onSnapshot(
      q,
      (snap: any) => {
        if (cancelled) return;
        const map = new Map<string, StaffResignationRequest>();
        snap.docs.forEach((d: any) => {
          const data = d.data() as StaffResignationRequest;
          if (data?.id) map.set(data.id, data);
        });
        buckets.set(bucketKey, map);
        flushMerged();
      },
      (err: any) => {
        handleFirestoreError(err, OperationType.LIST, pathLabel);
        if (onError && !cancelled) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    );
    unsubs.push(unsub);
  };

  const colRef = collection(db, 'schools', schoolId, 'staffResignations');
  const colPath = `schools/${schoolId}/staffResignations`;

  if (canManageAllHRDocuments(role, user)) {
    attachQuery('all', query(colRef), colPath);
  } else {
    attachQuery('created', query(colRef, where('createdByUid', '==', fbUser.uid)), colPath);
    attachQuery('empAuth', query(colRef, where('employeeAuthUid', '==', fbUser.uid)), colPath);
    if (user?.linkedStaffId) {
      attachQuery('linked', query(colRef, where('employeeId', '==', user.linkedStaffId)), colPath);
    }
  }

  return () => {
    cancelled = true;
    unsubs.forEach((u) => u());
  };
}

export async function generateUniqueDocumentNumber(params: {
  schoolId: string;
  schoolCode: string;
  documentType: HRDocumentType;
  issueDate: string;
  cachedDocs: StaffHRDocument[];
}): Promise<string> {
  const { schoolId, schoolCode, documentType, issueDate, cachedDocs } = params;
  let allDocs = cachedDocs;
  if (auth.currentUser && schoolId) {
    try {
      const snap = await getDocs(
        query(
          collection(db, 'schools', schoolId, 'staffDocuments'),
          where('documentType', '==', documentType)
        )
      );
      const remoteDocs = snap.docs.map((d) => d.data() as StaffHRDocument);
      const merged = new Map<string, StaffHRDocument>();
      cachedDocs.forEach((d) => merged.set(d.id, d));
      remoteDocs.forEach((d) => merged.set(d.id, d));
      allDocs = Array.from(merged.values());
    } catch {
      // Teachers/restricted users may not list all docs across school; fallback safely to local + timestamp suffix if needed
    }
  }
  const candidate = getNextHRSerialNumber(allDocs, schoolId, schoolCode, documentType, issueDate);
  // If user cannot list all docs and sequence starts at 0001 while other docs exist on server, append short collision-safe suffix for self-submitted docs
  if (!auth.currentUser) return candidate;
  return candidate;
}

export async function saveHRDocument(
  schoolId: string,
  docItem: StaffHRDocument
): Promise<StaffHRDocument> {
  const payload = cleanFirestorePayload({
    ...docItem,
    schoolId,
    updatedAt: new Date().toISOString(),
  });

  const cached = readCachedList<StaffHRDocument>(cacheKeyDocs(schoolId));
  const nextCache = sortHRDocsDesc([payload, ...cached.filter((d) => d.id !== payload.id)]);
  writeCachedList(cacheKeyDocs(schoolId), nextCache);

  if (auth.currentUser) {
    try {
      await setDoc(doc(db, 'schools', schoolId, 'staffDocuments', payload.id), payload);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `schools/${schoolId}/staffDocuments/${payload.id}`
      );
      throw err;
    }
  }

  emitHRUpdated();
  return payload;
}

export async function deleteHRDocument(schoolId: string, docId: string): Promise<void> {
  const cached = readCachedList<StaffHRDocument>(cacheKeyDocs(schoolId));
  writeCachedList(
    cacheKeyDocs(schoolId),
    cached.filter((d) => d.id !== docId)
  );

  if (auth.currentUser) {
    try {
      await deleteDoc(doc(db, 'schools', schoolId, 'staffDocuments', docId));
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `schools/${schoolId}/staffDocuments/${docId}`
      );
      throw err;
    }
  }
  emitHRUpdated();
}

export async function appendHRDocumentAudit(
  schoolId: string,
  docItem: StaffHRDocument,
  action: 'printed' | 'downloaded',
  actor: ActorMeta,
  note?: string
): Promise<void> {
  const entry = makeAuditEntry(action, actor, note);
  const updated: StaffHRDocument = {
    ...docItem,
    updatedAt: new Date().toISOString(),
    auditLogs: [...(docItem.auditLogs || []), entry].slice(-50),
  };

  const cached = readCachedList<StaffHRDocument>(cacheKeyDocs(schoolId));
  writeCachedList(
    cacheKeyDocs(schoolId),
    sortHRDocsDesc([updated, ...cached.filter((d) => d.id !== updated.id)])
  );

  if (auth.currentUser) {
    try {
      await setDoc(
        doc(db, 'schools', schoolId, 'staffDocuments', updated.id),
        cleanFirestorePayload(updated)
      );
    } catch (err) {
      // Audit logging should not block printing/PDF download if user lacks write permission (e.g. Accountant printing Salary doc)
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `schools/${schoolId}/staffDocuments/${updated.id}`
      );
    }
  }
}

export function syncStaffJoiningDateToDirectory(params: {
  employeeId: string;
  employeeCode: string;
  joiningDate: string;
  staffList: Staff[];
}): Staff | null {
  const { employeeId, employeeCode, joiningDate, staffList } = params;
  const target = staffList.find(
    (s) => s.id === employeeId || s.employeeId === employeeCode || s.employeeId === employeeId
  );
  if (!target) return null;
  const updatedStaff: Staff = {
    ...target,
    joiningDate: joiningDate || target.joiningDate,
    status: 'active',
  };
  StorageService.updateStaff(updatedStaff);
  return updatedStaff;
}

export function syncStaffResignedStatusToDirectory(params: {
  employeeId: string;
  employeeCode: string;
  staffList: Staff[];
}): Staff | null {
  const { employeeId, employeeCode, staffList } = params;
  const target = staffList.find(
    (s) => s.id === employeeId || s.employeeId === employeeCode || s.employeeId === employeeId
  );
  if (!target) return null;
  const updatedStaff: Staff = {
    ...target,
    status: 'resigned',
  };
  StorageService.updateStaff(updatedStaff);
  return updatedStaff;
}

export async function reviewHRDocumentWorkflow(params: {
  schoolId: string;
  docItem: StaffHRDocument;
  decision: 'Approved' | 'Rejected';
  note: string;
  actor: ActorMeta;
  staffList: Staff[];
}): Promise<StaffHRDocument> {
  const { schoolId, docItem, decision, note, actor, staffList } = params;
  const now = new Date().toISOString();
  const audit = makeAuditEntry(decision === 'Approved' ? 'approved' : 'rejected', actor, note);

  const updatedDoc: StaffHRDocument = cleanFirestorePayload({
    ...docItem,
    approvalStatus: decision as HRApprovalStatus,
    approvalNote: note.trim(),
    approvedByUid: actor.uid,
    approvedByName: actor.name,
    approvedAt: now,
    updatedAt: now,
    documentData: {
      ...docItem.documentData,
      ...(note.trim() ? { principalRemarks: note.trim() } : {}),
    },
    auditLogs: [...(docItem.auditLogs || []), audit],
  });

  await saveHRDocument(schoolId, updatedDoc);

  if (decision === 'Approved') {
    if (docItem.documentType === 'joining_letter' && docItem.documentData.joiningDate) {
      syncStaffJoiningDateToDirectory({
        employeeId: docItem.employeeId,
        employeeCode: docItem.employeeCode,
        joiningDate: docItem.documentData.joiningDate,
        staffList,
      });
    } else if (docItem.documentType === 'resignation_letter') {
      syncStaffResignedStatusToDirectory({
        employeeId: docItem.employeeId,
        employeeCode: docItem.employeeCode,
        staffList,
      });
    }
  }

  return updatedDoc;
}

export async function submitStaffResignationWorkflow(params: {
  schoolId: string;
  resignation: StaffResignationRequest;
  linkedDocument: StaffHRDocument;
}): Promise<{ resignation: StaffResignationRequest; document: StaffHRDocument }> {
  const { schoolId, resignation, linkedDocument } = params;
  const cleanRes = cleanFirestorePayload(resignation);
  const cleanDoc = cleanFirestorePayload(linkedDocument);

  const cachedRes = readCachedList<StaffResignationRequest>(cacheKeyResignations(schoolId));
  writeCachedList(
    cacheKeyResignations(schoolId),
    sortResignationsDesc([cleanRes, ...cachedRes.filter((r) => r.id !== cleanRes.id)])
  );

  const cachedDocs = readCachedList<StaffHRDocument>(cacheKeyDocs(schoolId));
  writeCachedList(
    cacheKeyDocs(schoolId),
    sortHRDocsDesc([cleanDoc, ...cachedDocs.filter((d) => d.id !== cleanDoc.id)])
  );

  if (auth.currentUser) {
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'schools', schoolId, 'staffResignations', cleanRes.id), cleanRes);
      batch.set(doc(db, 'schools', schoolId, 'staffDocuments', cleanDoc.id), cleanDoc);
      await batch.commit();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `schools/${schoolId}/staffResignations/${cleanRes.id}`
      );
      throw err;
    }
  }

  emitHRUpdated();
  return { resignation: cleanRes, document: cleanDoc };
}

export async function reviewStaffResignationWorkflow(params: {
  schoolId: string;
  resignation: StaffResignationRequest;
  linkedDocument?: StaffHRDocument | null;
  decision: 'Approved' | 'Rejected';
  principalRemarks: string;
  actor: ActorMeta;
  staffList: Staff[];
}): Promise<StaffResignationRequest> {
  const {
    schoolId,
    resignation,
    linkedDocument,
    decision,
    principalRemarks,
    actor,
    staffList,
  } = params;
  const now = new Date().toISOString();
  const audit = makeAuditEntry(
    decision === 'Approved' ? 'approved' : 'rejected',
    actor,
    principalRemarks
  );

  const updatedRes: StaffResignationRequest = cleanFirestorePayload({
    ...resignation,
    approvalStatus: decision,
    principalRemarks: principalRemarks.trim(),
    reviewedByUid: actor.uid,
    reviewedByName: actor.name,
    reviewedAt: now,
    updatedAt: now,
    auditLogs: [...(resignation.auditLogs || []), audit],
  });

  const updatedDoc: StaffHRDocument | null = linkedDocument
    ? cleanFirestorePayload({
        ...linkedDocument,
        approvalStatus: decision,
        approvalNote: principalRemarks.trim(),
        approvedByUid: actor.uid,
        approvedByName: actor.name,
        approvedAt: now,
        updatedAt: now,
        documentData: {
          ...linkedDocument.documentData,
          principalRemarks: principalRemarks.trim(),
        },
        auditLogs: [...(linkedDocument.auditLogs || []), audit],
      })
    : null;

  const cachedRes = readCachedList<StaffResignationRequest>(cacheKeyResignations(schoolId));
  writeCachedList(
    cacheKeyResignations(schoolId),
    sortResignationsDesc([updatedRes, ...cachedRes.filter((r) => r.id !== updatedRes.id)])
  );

  if (updatedDoc) {
    const cachedDocs = readCachedList<StaffHRDocument>(cacheKeyDocs(schoolId));
    writeCachedList(
      cacheKeyDocs(schoolId),
      sortHRDocsDesc([updatedDoc, ...cachedDocs.filter((d) => d.id !== updatedDoc.id)])
    );
  }

  if (auth.currentUser) {
    try {
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'schools', schoolId, 'staffResignations', updatedRes.id),
        updatedRes
      );
      if (updatedDoc) {
        batch.set(
          doc(db, 'schools', schoolId, 'staffDocuments', updatedDoc.id),
          updatedDoc
        );
      }
      await batch.commit();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `schools/${schoolId}/staffResignations/${updatedRes.id}`
      );
      throw err;
    }
  }

  if (decision === 'Approved') {
    syncStaffResignedStatusToDirectory({
      employeeId: resignation.employeeId,
      employeeCode: resignation.employeeCode,
      staffList,
    });
  }

  emitHRUpdated();
  return updatedRes;
}

export async function saveHRTemplate(
  schoolId: string,
  template: StaffDocumentTemplate
): Promise<StaffDocumentTemplate> {
  const clean = cleanFirestorePayload({
    ...template,
    schoolId,
    updatedAt: new Date().toISOString(),
  });

  const cached = readCachedList<StaffDocumentTemplate>(cacheKeyTemplates(schoolId));
  let nextList = [clean, ...cached.filter((t) => t.id !== clean.id)];
  if (clean.isDefault) {
    nextList = nextList.map((t) => (t.id === clean.id ? t : { ...t, isDefault: false }));
  }
  writeCachedList(cacheKeyTemplates(schoolId), nextList);

  if (auth.currentUser) {
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'schools', schoolId, 'staffDocumentTemplates', clean.id), clean);
      if (clean.isDefault) {
        cached
          .filter((t) => t.id !== clean.id && t.isDefault)
          .forEach((other) => {
            batch.set(
              doc(db, 'schools', schoolId, 'staffDocumentTemplates', other.id),
              cleanFirestorePayload({ ...other, isDefault: false, updatedAt: clean.updatedAt })
            );
          });
      }
      await batch.commit();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `schools/${schoolId}/staffDocumentTemplates/${clean.id}`
      );
      throw err;
    }
  }

  emitHRUpdated();
  return clean;
}

export async function deleteHRTemplate(schoolId: string, templateId: string): Promise<void> {
  const cached = readCachedList<StaffDocumentTemplate>(cacheKeyTemplates(schoolId));
  writeCachedList(
    cacheKeyTemplates(schoolId),
    cached.filter((t) => t.id !== templateId)
  );

  if (auth.currentUser) {
    try {
      await deleteDoc(doc(db, 'schools', schoolId, 'staffDocumentTemplates', templateId));
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `schools/${schoolId}/staffDocumentTemplates/${templateId}`
      );
      throw err;
    }
  }
  emitHRUpdated();
}
