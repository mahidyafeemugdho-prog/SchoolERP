import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  SaaSApi,
  SupportCategory,
  SupportMessageDTO,
  SupportTicketDTO,
  SupportTicketStatus,
  isSaaSBackendUnavailableError,
} from './saasApi';

export const SUPPORT_UPDATED_EVENT = 'support_tickets_updated';

export function emitSupportUpdated(tickets?: SupportTicketDTO[]) {
  try {
    window.dispatchEvent(
      new CustomEvent(SUPPORT_UPDATED_EVENT, { detail: { tickets } })
    );
  } catch {
    // ignore outside browser window
  }
}

export function sortTicketsDesc(tickets: SupportTicketDTO[]): SupportTicketDTO[] {
  return [...tickets].sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(
      String(a.updatedAt || a.createdAt || '')
    )
  );
}

export function sortMessagesAsc(messages: SupportMessageDTO[]): SupportMessageDTO[] {
  return [...messages].sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  );
}

function buildPreview(text: string, imageCount: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean) {
    return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean;
  }
  return imageCount > 1 ? `[${imageCount}টি ছবি সংযুক্ত]` : '[ছবি সংযুক্ত]';
}

export interface SubscribeSupportTicketsParams {
  schoolId?: string | null;
  uid?: string | null;
  isMasterAdmin: boolean;
  onTickets: (tickets: SupportTicketDTO[]) => void;
  onError?: (err: Error) => void;
}

/**
 * Real-time subscription for Support Tickets:
 * - Attaches live Firestore onSnapshot when auth.currentUser is signed in
 * - Fetches immediately via Backend Admin SDK API (/api/saas/support/tickets)
 *   so everything works even before firestore.rules are published or when offline
 */
export function subscribeToSupportTickets({
  schoolId,
  uid,
  isMasterAdmin,
  onTickets,
  onError,
}: SubscribeSupportTicketsParams): Unsubscribe {
  let cancelled = false;
  let unsubSnapshot: Unsubscribe | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const deliver = (list: SupportTicketDTO[]) => {
    if (cancelled) return;
    const sorted = sortTicketsDesc(list);
    onTickets(sorted);
    emitSupportUpdated(sorted);
  };

  const fetchViaApi = async () => {
    if (cancelled || !auth.currentUser) return;
    try {
      const res = await SaaSApi.listSupportTickets();
      if (!cancelled && Array.isArray(res.tickets)) {
        deliver(res.tickets);
      }
    } catch (err: any) {
      if (!isSaaSBackendUnavailableError(err) && onError && !cancelled) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  const startApiPollingFallback = () => {
    if (cancelled || pollTimer) return;
    pollTimer = setInterval(() => {
      void fetchViaApi();
    }, 8000);
  };

  // Immediate API load so UI renders reliably
  void fetchViaApi();

  // Attach Firestore real-time stream if user is authenticated
  if (auth.currentUser) {
    try {
      const colRef = collection(db, 'support_tickets');
      const q = isMasterAdmin
        ? query(colRef)
        : schoolId
        ? query(colRef, where('schoolId', '==', schoolId))
        : uid
        ? query(colRef, where('createdByUid', '==', uid))
        : null;

      if (q) {
        unsubSnapshot = onSnapshot(
          q,
          (snap) => {
            if (cancelled) return;
            const list = snap.docs
              .map((d) => d.data() as SupportTicketDTO)
              .filter((t) => Boolean(t?.id));
            // Only replace with snapshot when snapshot returns data or rules allow reading empty collection
            deliver(list);
          },
          (err) => {
            handleFirestoreError(err, OperationType.LIST, 'support_tickets');
            // Fall back smoothly to Admin SDK API polling if client rules are not yet deployed
            startApiPollingFallback();
          }
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'support_tickets');
      startApiPollingFallback();
    }
  }

  return () => {
    cancelled = true;
    if (unsubSnapshot) unsubSnapshot();
    if (pollTimer) clearInterval(pollTimer);
  };
}

export interface SubscribeSupportMessagesParams {
  ticketId: string;
  onMessages: (messages: SupportMessageDTO[]) => void;
  onTicketUpdated?: (ticket: SupportTicketDTO) => void;
  onError?: (err: Error) => void;
}

/**
 * Real-time subscription for messages inside an active Support Ticket.
 */
export function subscribeToSupportMessages({
  ticketId,
  onMessages,
  onTicketUpdated,
  onError,
}: SubscribeSupportMessagesParams): Unsubscribe {
  let cancelled = false;
  let unsubMessages: Unsubscribe | null = null;
  let unsubTicket: Unsubscribe | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const fetchViaApi = async () => {
    if (cancelled || !auth.currentUser || !ticketId) return;
    try {
      const res = await SaaSApi.listSupportMessages(ticketId);
      if (cancelled) return;
      if (res.ticket && onTicketUpdated) {
        onTicketUpdated(res.ticket);
      }
      if (Array.isArray(res.messages)) {
        onMessages(sortMessagesAsc(res.messages));
      }
    } catch (err: any) {
      if (!isSaaSBackendUnavailableError(err) && onError && !cancelled) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  const startApiPollingFallback = () => {
    if (cancelled || pollTimer) return;
    pollTimer = setInterval(() => {
      void fetchViaApi();
    }, 5000);
  };

  void fetchViaApi();

  if (auth.currentUser && ticketId) {
    try {
      const msgQuery = query(
        collection(db, 'support_tickets', ticketId, 'messages'),
        orderBy('createdAt', 'asc')
      );
      unsubMessages = onSnapshot(
        msgQuery,
        (snap) => {
          if (cancelled) return;
          const msgs = snap.docs
            .map((d) => d.data() as SupportMessageDTO)
            .filter((m) => Boolean(m?.id));
          onMessages(sortMessagesAsc(msgs));
        },
        (err) => {
          handleFirestoreError(
            err,
            OperationType.LIST,
            `support_tickets/${ticketId}/messages`
          );
          startApiPollingFallback();
        }
      );

      unsubTicket = onSnapshot(
        doc(db, 'support_tickets', ticketId),
        (snap) => {
          if (cancelled || !snap.exists()) return;
          if (onTicketUpdated) {
            onTicketUpdated(snap.data() as SupportTicketDTO);
          }
        },
        (err) => {
          handleFirestoreError(
            err,
            OperationType.GET,
            `support_tickets/${ticketId}`
          );
        }
      );
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.LIST,
        `support_tickets/${ticketId}/messages`
      );
      startApiPollingFallback();
    }
  }

  return () => {
    cancelled = true;
    if (unsubMessages) unsubMessages();
    if (unsubTicket) unsubTicket();
    if (pollTimer) clearInterval(pollTimer);
  };
}

export interface CreateSupportTicketClientInput {
  subject: string;
  category: SupportCategory;
  text: string;
  imageUrls: string[];
  schoolId: string;
  schoolName: string;
  schoolCode?: string;
  senderName: string;
  senderEmail: string;
  senderSchoolRole: string;
  isMasterAdmin: boolean;
}

export async function createSupportTicketClient(
  input: CreateSupportTicketClientInput
): Promise<{ ticket: SupportTicketDTO; message: SupportMessageDTO }> {
  try {
    const res = await SaaSApi.createSupportTicket({
      subject: input.subject,
      category: input.category,
      text: input.text,
      imageUrls: input.imageUrls,
      schoolId: input.schoolId,
      schoolName: input.schoolName,
      schoolCode: input.schoolCode,
    });
    emitSupportUpdated();
    return { ticket: res.ticket, message: res.message };
  } catch (err: any) {
    if (!isSaaSBackendUnavailableError(err)) {
      throw err;
    }

    const user = auth.currentUser;
    if (!user) {
      throw new Error('Authentication required to create a support request.');
    }
    const nowIso = new Date().toISOString();
    const rand = Math.random().toString(36).slice(2, 7);
    const ticketId = `tkt_${Date.now()}_${rand}`;
    const messageId = `msg_${Date.now()}_${rand}`;
    const senderRole = input.isMasterAdmin ? 'master_admin' : 'school';

    const ticket: SupportTicketDTO = {
      id: ticketId,
      schoolId: input.schoolId || user.uid,
      schoolName: input.schoolName || input.schoolId || 'School',
      ...(input.schoolCode ? { schoolCode: input.schoolCode } : {}),
      createdByUid: user.uid,
      createdByName: input.senderName,
      createdByEmail: input.senderEmail || user.email || '',
      createdByRole: input.senderSchoolRole,
      subject: input.subject.trim().slice(0, 240),
      category: input.category,
      status: input.isMasterAdmin ? 'replied' : 'open',
      lastMessagePreview: buildPreview(input.text, input.imageUrls.length),
      lastSenderRole: senderRole,
      unreadByMaster: !input.isMasterAdmin,
      unreadBySchool: input.isMasterAdmin,
      messageCount: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const message: SupportMessageDTO = {
      id: messageId,
      ticketId,
      schoolId: ticket.schoolId,
      ticketCreatorUid: user.uid,
      senderUid: user.uid,
      senderName: input.senderName,
      senderEmail: input.senderEmail || user.email || '',
      senderRole,
      senderSchoolRole: input.senderSchoolRole,
      text: input.text.trim().slice(0, 3500),
      imageUrls: input.imageUrls.slice(0, 3),
      createdAt: nowIso,
    };

    try {
      const batch = writeBatch(db);
      const tRef = doc(db, 'support_tickets', ticketId);
      const mRef = doc(db, 'support_tickets', ticketId, 'messages', messageId);
      batch.set(tRef, ticket);
      batch.set(mRef, message);
      await batch.commit();
      emitSupportUpdated();
      return { ticket, message };
    } catch (fsErr) {
      handleFirestoreError(fsErr, OperationType.CREATE, `support_tickets/${ticketId}`);
      throw fsErr;
    }
  }
}

export interface SendSupportReplyClientInput {
  ticket: SupportTicketDTO;
  text: string;
  imageUrls: string[];
  senderName: string;
  senderEmail: string;
  senderSchoolRole: string;
  isMasterAdmin: boolean;
}

export async function sendSupportReplyClient(
  input: SendSupportReplyClientInput
): Promise<{ ticket: SupportTicketDTO; message: SupportMessageDTO }> {
  try {
    const res = await SaaSApi.sendSupportMessage(input.ticket.id, {
      text: input.text,
      imageUrls: input.imageUrls,
    });
    emitSupportUpdated();
    return { ticket: res.ticket, message: res.message };
  } catch (err: any) {
    if (!isSaaSBackendUnavailableError(err)) {
      throw err;
    }

    const user = auth.currentUser;
    if (!user) {
      throw new Error('Authentication required to send support reply.');
    }
    const nowIso = new Date().toISOString();
    const rand = Math.random().toString(36).slice(2, 7);
    const messageId = `msg_${Date.now()}_${rand}`;
    const senderRole = input.isMasterAdmin ? 'master_admin' : 'school';

    const message: SupportMessageDTO = {
      id: messageId,
      ticketId: input.ticket.id,
      schoolId: input.ticket.schoolId,
      ticketCreatorUid: input.ticket.createdByUid,
      senderUid: user.uid,
      senderName: input.senderName,
      senderEmail: input.senderEmail || user.email || '',
      senderRole,
      senderSchoolRole: input.senderSchoolRole,
      text: input.text.trim().slice(0, 3500),
      imageUrls: input.imageUrls.slice(0, 3),
      createdAt: nowIso,
    };

    const updatedTicket: SupportTicketDTO = {
      ...input.ticket,
      status: input.isMasterAdmin ? 'replied' : 'open',
      lastSenderRole: senderRole,
      lastMessagePreview: buildPreview(input.text, input.imageUrls.length),
      unreadByMaster: !input.isMasterAdmin,
      unreadBySchool: input.isMasterAdmin,
      messageCount: Number(input.ticket.messageCount || 0) + 1,
      updatedAt: nowIso,
    };

    try {
      const batch = writeBatch(db);
      const tRef = doc(db, 'support_tickets', input.ticket.id);
      const mRef = doc(db, 'support_tickets', input.ticket.id, 'messages', messageId);
      batch.set(tRef, updatedTicket);
      batch.set(mRef, message);
      await batch.commit();
      emitSupportUpdated();
      return { ticket: updatedTicket, message };
    } catch (fsErr) {
      handleFirestoreError(
        fsErr,
        OperationType.CREATE,
        `support_tickets/${input.ticket.id}/messages/${messageId}`
      );
      throw fsErr;
    }
  }
}

export async function updateSupportTicketStatusClient(
  ticket: SupportTicketDTO,
  status: SupportTicketStatus
): Promise<SupportTicketDTO> {
  try {
    const res = await SaaSApi.updateSupportTicketStatus(ticket.id, { status });
    emitSupportUpdated();
    return res.ticket;
  } catch (err: any) {
    if (!isSaaSBackendUnavailableError(err)) {
      throw err;
    }
    const updated: SupportTicketDTO = {
      ...ticket,
      status,
      updatedAt: new Date().toISOString(),
    };
    try {
      await setDoc(doc(db, 'support_tickets', ticket.id), updated);
      emitSupportUpdated();
      return updated;
    } catch (fsErr) {
      handleFirestoreError(fsErr, OperationType.UPDATE, `support_tickets/${ticket.id}`);
      throw fsErr;
    }
  }
}

export async function markSupportTicketReadClient(
  ticket: SupportTicketDTO,
  isMasterAdmin: boolean
): Promise<void> {
  const needsUpdate = isMasterAdmin ? ticket.unreadByMaster : ticket.unreadBySchool;
  if (!needsUpdate) return;
  try {
    await SaaSApi.updateSupportTicketStatus(ticket.id, { markRead: true });
    emitSupportUpdated();
  } catch (err: any) {
    if (!isSaaSBackendUnavailableError(err)) return;
    try {
      await setDoc(doc(db, 'support_tickets', ticket.id), {
        ...ticket,
        ...(isMasterAdmin ? { unreadByMaster: false } : { unreadBySchool: false }),
      });
      emitSupportUpdated();
    } catch {
      // ignore non-critical read receipt failures
    }
  }
}
