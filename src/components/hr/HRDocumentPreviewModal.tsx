import React, { useMemo, useState } from 'react';
import {
  SchoolProfile,
  Staff,
  StaffDocumentTemplate,
  StaffHRDocument,
  UserProfile,
  UserRole,
} from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import {
  HR_DOCUMENT_TYPE_MAP,
  canApproveHRDocuments,
  canManageAllHRDocuments,
  createDefaultHRTemplate,
} from '../../utils/hrDocumentHelpers';
import {
  buildHRDocumentPreviewHtml,
  downloadHRDocumentPdf,
  printHRDocument,
} from '../../utils/hrDocumentPdf';
import {
  appendHRDocumentAudit,
  reviewHRDocumentWorkflow,
} from '../../services/hrDocumentService';
import {
  CheckCircle2,
  Clock,
  Download,
  Edit2,
  History,
  Loader2,
  Printer,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';

interface HRDocumentPreviewModalProps {
  document: StaffHRDocument | null;
  schoolId: string;
  schoolProfile: Partial<SchoolProfile>;
  templates: StaffDocumentTemplate[];
  currentUser: UserProfile | null;
  activeRole: UserRole;
  staffList: Staff[];
  onClose: () => void;
  onUpdated: (doc: StaffHRDocument) => void;
  onEdit?: (doc: StaffHRDocument) => void;
}

export const HRDocumentPreviewModal: React.FC<HRDocumentPreviewModalProps> = ({
  document,
  schoolId,
  schoolProfile,
  templates,
  currentUser,
  activeRole,
  staffList,
  onClose,
  onUpdated,
  onEdit,
}) => {
  const { language, formatDate } = useLanguage();
  const isBn = language === 'bn';

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [showAuditDrawer, setShowAuditDrawer] = useState<boolean>(false);
  const [reviewRemarks, setReviewRemarks] = useState<string>('');
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);
  const [isReviewing, setIsReviewing] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>('');

  const activeTemplate = useMemo(() => {
    if (!document) return createDefaultHRTemplate(schoolId);
    const preferredId = selectedTemplateId || document.templateId;
    return (
      templates.find((t) => t.id === preferredId) ||
      templates.find((t) => t.isDefault) ||
      templates[0] ||
      createDefaultHRTemplate(schoolId)
    );
  }, [document, selectedTemplateId, templates, schoolId]);

  const previewHtml = useMemo(() => {
    if (!document) return '';
    return buildHRDocumentPreviewHtml(document, schoolProfile, activeTemplate);
  }, [document, schoolProfile, activeTemplate]);

  if (!document) return null;

  const meta = HR_DOCUMENT_TYPE_MAP[document.documentType];
  const canApprove =
    canApproveHRDocuments(activeRole) &&
    document.approvalStatus === 'Pending' &&
    meta.requiresApproval;
  const canEditDoc = canManageAllHRDocuments(activeRole, currentUser);

  const actor = {
    uid: currentUser?.authUid || currentUser?.id || 'system',
    name: currentUser?.name || currentUser?.email || 'User',
    role: activeRole,
  };

  const handleDownloadPdf = async () => {
    setActionError('');
    setIsDownloadingPdf(true);
    try {
      await downloadHRDocumentPdf(document, schoolProfile, activeTemplate);
      await appendHRDocumentAudit(schoolId, document, 'downloaded', actor);
    } catch (err: any) {
      setActionError(err?.message || (isBn ? 'PDF ডাউনলোড ব্যর্থ হয়েছে।' : 'Failed to generate PDF.'));
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handlePrint = async () => {
    setActionError('');
    try {
      printHRDocument(document, schoolProfile, activeTemplate);
      await appendHRDocumentAudit(schoolId, document, 'printed', actor);
    } catch (err: any) {
      setActionError(
        err?.message ||
          (isBn
            ? 'ব্রাউজারে পপ-আপ ব্লক করা আছে। প্রিন্ট করতে পপ-আপ অনুমতি দিন।'
            : 'Popup blocked by browser. Please allow popups to print.')
      );
    }
  };

  const handleDecision = async (decision: 'Approved' | 'Rejected') => {
    setActionError('');
    setIsReviewing(true);
    try {
      const updated = await reviewHRDocumentWorkflow({
        schoolId,
        docItem: document,
        decision,
        note: reviewRemarks,
        actor,
        staffList,
      });
      onUpdated(updated);
      setReviewRemarks('');
    } catch (err: any) {
      setActionError(err?.message || (isBn ? 'অনুমোদন আপডেট ব্যর্থ হয়েছে।' : 'Approval update failed.'));
    } finally {
      setIsReviewing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[195] bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 print:hidden">
      <div className="w-full max-w-6xl h-[93vh] bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="px-4 sm:px-5 py-3 bg-[#0f294d] text-white flex flex-wrap items-center justify-between gap-2 border-b-2 border-amber-500">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold truncate">
                {meta.labelBn} · {meta.labelEn}
              </h3>
              <span className="text-[11px] font-mono bg-white/10 border border-white/20 px-2 py-0.5 rounded">
                {document.documentNumber}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 truncate mt-0.5">
              {document.employeeName} ({document.employeeCode}) ·{' '}
              {isBn ? 'ইস্যু:' : 'Issued:'} {formatDate(document.issueDate)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activeTemplate.id}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg text-xs bg-white/10 text-white border border-white/20 focus:outline-none"
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id} className="text-slate-900">
                  {tpl.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setShowAuditDrawer((p) => !p)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                showAuditDrawer
                  ? 'bg-amber-500 text-slate-950 border-amber-400'
                  : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>{isBn ? 'লগ' : 'Audit'} ({(document.auditLogs || []).length})</span>
            </button>

            {canEditDoc && onEdit && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEdit(document);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/20 cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>{isBn ? 'সম্পাদনা' : 'Edit'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handlePrint()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{isBn ? 'প্রিন্ট' : 'Print'}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={isDownloadingPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer disabled:opacity-60"
            >
              {isDownloadingPdf ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{isBn ? 'PDF ডাউনলোড' : 'Download A4 PDF'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {actionError && (
          <div className="px-4 py-2 bg-rose-50 border-b border-rose-200 text-xs font-semibold text-rose-800">
            {actionError}
          </div>
        )}

        {/* Approval Action Ribbon for Pending Joining / Resignation */}
        {canApprove && (
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
              <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                {document.documentType === 'joining_letter'
                  ? isBn
                    ? 'যোগদানপত্র অনুমোদনের অপেক্ষায় — অনুমোদন করলে কর্মীর যোগদানের তারিখ ও স্ট্যাটাস আপডেট হবে।'
                    : 'Joining Letter Pending Review — Approving updates employee Joining Date & Active status.'
                  : isBn
                  ? 'পদত্যাগপত্র অনুমোদনের অপেক্ষায় — অনুমোদন করলে কর্মীর স্ট্যাটাস Resigned হবে।'
                  : 'Resignation Application Pending Review — Approving marks staff status as Resigned.'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={reviewRemarks}
                onChange={(e) => setReviewRemarks(e.target.value)}
                placeholder={isBn ? 'প্রিন্সিপালের মন্তব্য লিখুন...' : 'Principal remarks (optional)...'}
                className="px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white min-w-[200px]"
              />
              <button
                type="button"
                disabled={isReviewing}
                onClick={() => void handleDecision('Approved')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-60"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{isBn ? 'অনুমোদন (Approve)' : 'Approve'}</span>
              </button>
              <button
                type="button"
                disabled={isReviewing}
                onClick={() => void handleDecision('Rejected')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer disabled:opacity-60"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{isBn ? 'বাতিল (Reject)' : 'Reject'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Main Workspace: Preview Iframe + Optional Audit Sidebar */}
        <div className="flex-1 flex min-h-0 bg-slate-200/80">
          <div className="flex-1 p-3 sm:p-5 overflow-hidden">
            <iframe
              title="HR Document Official Preview"
              sandbox="allow-same-origin"
              srcDoc={previewHtml}
              className="w-full h-full rounded-xl border border-slate-300 bg-white shadow-sm"
            />
          </div>

          {showAuditDrawer && (
            <div className="w-80 bg-white border-l border-slate-200 p-4 overflow-y-auto shrink-0">
              <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-slate-200">
                <h4 className="text-xs font-bold text-[#0f294d] uppercase tracking-wide flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  <span>{isBn ? 'অডিট ও কার্যক্রম লগ' : 'Document Audit Trail'}</span>
                </h4>
              </div>
              {(document.auditLogs || []).length === 0 ? (
                <p className="text-xs text-slate-500">
                  {isBn ? 'কোনো অডিট ইতিহাস পাওয়া যায়নি।' : 'No audit entries recorded yet.'}
                </p>
              ) : (
                <div className="space-y-2.5">
                  {[...(document.auditLogs || [])].reverse().map((entry) => (
                    <div key={entry.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 capitalize">{entry.action}</span>
                        <span className="text-[10px] text-slate-500 tabular-nums">
                          {new Date(entry.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        {entry.actorName} ({entry.actorRole.replace('_', ' ')})
                      </div>
                      {entry.note && (
                        <div className="text-[11px] text-slate-700 mt-1 italic bg-white p-1.5 rounded border border-slate-100">
                          “{entry.note}”
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {document.approvalNote && (
                <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  <div className="font-bold text-slate-800 flex items-center gap-1 mb-1">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span>{isBn ? 'অনুমোদন সিদ্ধান্ত নোট' : 'Decision Note'}</span>
                  </div>
                  <p className="text-slate-700">{document.approvalNote}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
