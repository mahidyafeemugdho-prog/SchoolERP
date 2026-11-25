import React, { useEffect, useMemo, useState } from 'react';
import {
  HRApprovalStatus,
  HRDocumentType,
  Staff,
  StaffDocumentTemplate,
  StaffHRDocument,
  StaffResignationRequest,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useSchool } from '../../context/SchoolContext';
import { StorageService } from '../../services/storage';
import { resolveSchoolCode } from '../../utils/schoolIdFormatter';
import {
  HR_DOCUMENT_TYPE_MAP,
  HR_DOCUMENT_TYPES,
  canApproveHRDocuments,
  canDeleteHRDocuments,
  canManageAllHRDocuments,
  canManageHRTemplates,
  canViewHRDocument,
  createDefaultHRTemplate,
} from '../../utils/hrDocumentHelpers';
import { downloadHRDocumentPdf, printHRDocument } from '../../utils/hrDocumentPdf';
import {
  HR_DOCUMENTS_UPDATED_EVENT,
  appendHRDocumentAudit,
  deleteHRDocument,
  reviewHRDocumentWorkflow,
  reviewStaffResignationWorkflow,
  subscribeToHRDocuments,
  subscribeToHRTemplates,
  subscribeToStaffResignations,
} from '../../services/hrDocumentService';
import { HRDocumentEditorModal } from './HRDocumentEditorModal';
import { HRDocumentPreviewModal } from './HRDocumentPreviewModal';
import { HRTemplateDesignerPanel } from './HRTemplateDesignerPanel';
import {
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Edit2,
  Eye,
  FileBadge2,
  FileCheck2,
  FilePlus2,
  FileText,
  Filter,
  LayoutTemplate,
  Loader2,
  LogOut,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Trash2,
  UserCheck,
  UserMinus,
  X,
  XCircle,
} from 'lucide-react';

type WorkspaceTab = 'documents' | 'workflows' | 'templates';

const ITEMS_PER_PAGE = 10;

export const StaffDocumentsDashboardView: React.FC = () => {
  const { activeRole, currentUser, saasSession } = useAuth();
  const { language, formatDate, toBnNumber } = useLanguage();
  const { schoolProfile } = useSchool();
  const isBn = language === 'bn';

  const schoolId =
    saasSession?.school?.schoolId || currentUser?.schoolId || schoolProfile.schoolCode || 'default';
  const schoolCode = resolveSchoolCode(saasSession?.school?.schoolId, schoolProfile);

  const [staffList, setStaffList] = useState<Staff[]>(() => StorageService.getStaff());
  const [documents, setDocuments] = useState<StaffHRDocument[]>([]);
  const [templates, setTemplates] = useState<StaffDocumentTemplate[]>(() => [
    createDefaultHRTemplate(schoolId),
  ]);
  const [resignations, setResignations] = useState<StaffResignationRequest[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>('');

  const [activeSubTab, setActiveSubTab] = useState<WorkspaceTab>('documents');

  // Search & Filter states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | HRDocumentType>('all');
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | HRApprovalStatus>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Modals & Inline Review
  const [editorOpen, setEditorOpen] = useState<boolean>(false);
  const [editingDoc, setEditingDoc] = useState<StaffHRDocument | null>(null);
  const [editorInitialType, setEditorInitialType] = useState<HRDocumentType | undefined>(undefined);
  const [previewDoc, setPreviewDoc] = useState<StaffHRDocument | null>(null);
  const [docPendingDelete, setDocPendingDelete] = useState<StaffHRDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [workflowNotes, setWorkflowNotes] = useState<Record<string, string>>({});
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const isHrManager = canManageAllHRDocuments(activeRole, currentUser);
  const canApprove = canApproveHRDocuments(activeRole);
  const canDelete = canDeleteHRDocuments(activeRole);
  const canDesignTemplates = canManageHRTemplates(activeRole, currentUser);

  // Sync Staff directory updates
  useEffect(() => {
    const syncStaff = () => setStaffList(StorageService.getStaff());
    window.addEventListener('school_cloud_data_synced', syncStaff);
    window.addEventListener('storage', syncStaff);
    return () => {
      window.removeEventListener('school_cloud_data_synced', syncStaff);
      window.removeEventListener('storage', syncStaff);
    };
  }, []);

  // Subscribe to Firestore real-time HR collections scoped strictly to schoolId & RBAC
  useEffect(() => {
    setIsLoading(true);
    setLoadError('');
    const unsubDocs = subscribeToHRDocuments({
      schoolId,
      role: activeRole,
      user: currentUser,
      onDocuments: (list) => {
        setDocuments(list);
        setIsLoading(false);
      },
      onError: (err) => {
        setLoadError(err.message);
        setIsLoading(false);
      },
    });

    const unsubTemplates = subscribeToHRTemplates({
      schoolId,
      onTemplates: (list) => setTemplates(list),
    });

    const unsubResignations = subscribeToStaffResignations({
      schoolId,
      role: activeRole,
      user: currentUser,
      onResignations: (list) => setResignations(list),
    });

    const refreshHandler = () => {
      setStaffList(StorageService.getStaff());
    };
    window.addEventListener(HR_DOCUMENTS_UPDATED_EVENT, refreshHandler);

    return () => {
      unsubDocs();
      unsubTemplates();
      unsubResignations();
      window.removeEventListener(HR_DOCUMENTS_UPDATED_EVENT, refreshHandler);
    };
  }, [schoolId, activeRole, currentUser]);

  // Apply client-side RBAC filter as defense-in-depth alongside Firestore rules
  const visibleDocuments = useMemo(
    () => documents.filter((d) => canViewHRDocument(d, activeRole, currentUser, staffList)),
    [documents, activeRole, currentUser, staffList]
  );

  // KPI Metrics (7 required cards)
  const kpis = useMemo(() => {
    const total = visibleDocuments.length;
    const appointments = visibleDocuments.filter((d) => d.documentType === 'appointment_letter').length;
    const joiningAll = visibleDocuments.filter((d) => d.documentType === 'joining_letter').length;
    const pendingJoining = visibleDocuments.filter(
      (d) => d.documentType === 'joining_letter' && d.approvalStatus === 'Pending'
    ).length;
    const pendingResignations =
      resignations.length > 0
        ? resignations.filter((r) => r.approvalStatus === 'Pending').length
        : visibleDocuments.filter(
            (d) => d.documentType === 'resignation_letter' && d.approvalStatus === 'Pending'
          ).length;
    const released = visibleDocuments.filter((d) => d.documentType === 'release_letter').length;
    const experience = visibleDocuments.filter((d) => d.documentType === 'experience_certificate').length;
    return {
      total,
      appointments,
      joiningAll,
      pendingJoining,
      pendingResignations,
      released,
      experience,
    };
  }, [visibleDocuments, resignations]);

  // Filtered list for table
  const filteredDocuments = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return visibleDocuments.filter((doc) => {
      if (filterType !== 'all' && doc.documentType !== filterType) return false;
      if (filterEmployeeId !== 'all' && doc.employeeId !== filterEmployeeId) return false;
      if (filterStatus !== 'all' && doc.approvalStatus !== filterStatus) return false;
      if (dateFrom && doc.issueDate < dateFrom) return false;
      if (dateTo && doc.issueDate > dateTo) return false;
      if (q) {
        const hay = [
          doc.documentNumber,
          doc.employeeName,
          doc.documentData?.employeeNameBn,
          doc.employeeCode,
          doc.documentData?.designation,
          doc.documentData?.department,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visibleDocuments, filterType, filterEmployeeId, filterStatus, dateFrom, dateTo, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedDocs = useMemo(
    () => filteredDocuments.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE),
    [filteredDocuments, safePage]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterType, filterEmployeeId, filterStatus, dateFrom, dateTo]);

  const pendingJoiningDocs = useMemo(
    () =>
      visibleDocuments.filter(
        (d) => d.documentType === 'joining_letter' && d.approvalStatus === 'Pending'
      ),
    [visibleDocuments]
  );

  const actor = {
    uid: currentUser?.authUid || currentUser?.id || 'system',
    name: currentUser?.name || currentUser?.email || 'User',
    role: activeRole,
  };

  const resolveTemplateForDoc = (doc: StaffHRDocument) =>
    templates.find((t) => t.id === doc.templateId) ||
    templates.find((t) => t.isDefault) ||
    templates[0] ||
    createDefaultHRTemplate(schoolId);

  const openCreateModal = (initialType?: HRDocumentType) => {
    setEditingDoc(null);
    setEditorInitialType(initialType);
    setEditorOpen(true);
  };

  const handleQuickDownload = async (doc: StaffHRDocument) => {
    setBusyDocId(doc.id);
    setFeedbackBanner(null);
    try {
      await downloadHRDocumentPdf(doc, schoolProfile, resolveTemplateForDoc(doc));
      await appendHRDocumentAudit(schoolId, doc, 'downloaded', actor);
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: err?.message || (isBn ? 'PDF ডাউনলোড করতে ব্যর্থ হয়েছে।' : 'Failed to generate PDF.'),
      });
    } finally {
      setBusyDocId(null);
    }
  };

  const handleQuickPrint = async (doc: StaffHRDocument) => {
    setFeedbackBanner(null);
    try {
      printHRDocument(doc, schoolProfile, resolveTemplateForDoc(doc));
      await appendHRDocumentAudit(schoolId, doc, 'printed', actor);
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text:
          err?.message ||
          (isBn ? 'প্রিন্টের জন্য ব্রাউজারে পপ-আপ অনুমতি দিন।' : 'Allow popups in your browser to print.'),
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!docPendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteHRDocument(schoolId, docPendingDelete.id);
      setFeedbackBanner({
        type: 'success',
        text: isBn
          ? `ডকুমেন্ট (${docPendingDelete.documentNumber}) সফলভাবে মুছে ফেলা হয়েছে।`
          : `Document ${docPendingDelete.documentNumber} deleted.`,
      });
      setDocPendingDelete(null);
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: err?.message || (isBn ? 'ডকুমেন্ট মুছতে সমস্যা হয়েছে।' : 'Failed to delete document.'),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleJoiningReview = async (docItem: StaffHRDocument, decision: 'Approved' | 'Rejected') => {
    setBusyDocId(docItem.id);
    setFeedbackBanner(null);
    try {
      const note = workflowNotes[docItem.id] || '';
      await reviewHRDocumentWorkflow({
        schoolId,
        docItem,
        decision,
        note,
        actor,
        staffList,
      });
      setStaffList(StorageService.getStaff());
      setFeedbackBanner({
        type: 'success',
        text:
          decision === 'Approved'
            ? isBn
              ? `${docItem.employeeName}-এর যোগদানপত্র অনুমোদিত হয়েছে এবং যোগদানের তারিখ আপডেট করা হয়েছে।`
              : `Approved Joining Letter for ${docItem.employeeName} and synced official joining date.`
            : isBn
            ? `${docItem.employeeName}-এর যোগদানপত্র বাতিল করা হয়েছে।`
            : `Rejected Joining Letter for ${docItem.employeeName}.`,
      });
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: err?.message || 'Failed updating joining workflow.',
      });
    } finally {
      setBusyDocId(null);
    }
  };

  const handleResignationReview = async (
    req: StaffResignationRequest,
    decision: 'Approved' | 'Rejected'
  ) => {
    setBusyDocId(req.id);
    setFeedbackBanner(null);
    try {
      const remarks = workflowNotes[req.id] || '';
      const linkedDoc = documents.find((d) => d.id === req.linkedDocumentId) || null;
      await reviewStaffResignationWorkflow({
        schoolId,
        resignation: req,
        linkedDocument: linkedDoc,
        decision,
        principalRemarks: remarks,
        actor,
        staffList,
      });
      setStaffList(StorageService.getStaff());
      setFeedbackBanner({
        type: 'success',
        text:
          decision === 'Approved'
            ? isBn
              ? `${req.employeeName}-এর পদত্যাগপত্র অনুমোদিত হয়েছে এবং কর্মী স্ট্যাটাস Resigned করা হয়েছে।`
              : `Approved resignation for ${req.employeeName}; employment status updated to Resigned.`
            : isBn
            ? `${req.employeeName}-এর পদত্যাগ আবেদন বাতিল করা হয়েছে।`
            : `Rejected resignation request for ${req.employeeName}.`,
      });
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: err?.message || 'Failed updating resignation status.',
      });
    } finally {
      setBusyDocId(null);
    }
  };

  const renderStatusCell = (status: HRApprovalStatus) => {
    const styles: Record<HRApprovalStatus, string> = {
      Approved: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      Pending: 'text-amber-700 bg-amber-50 border-amber-200',
      Rejected: 'text-rose-700 bg-rose-50 border-rose-200',
      Issued: 'text-blue-700 bg-blue-50 border-blue-200',
    };
    const labelsBn: Record<HRApprovalStatus, string> = {
      Approved: 'অনুমোদিত',
      Pending: 'অপেক্ষমাণ',
      Rejected: 'বাতিল',
      Issued: 'ইস্যুকৃত',
    };
    return (
      <span
        className={`inline-block px-2 py-0.5 text-[11px] font-bold rounded border ${styles[status]}`}
      >
        {isBn ? labelsBn[status] : status}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header + Breadcrumb */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
            {isBn ? 'HR ম্যানেজমেন্ট / স্টাফ ডকুমেন্টস' : 'HR Management → Staff Documents'}
          </div>
          <h1 className="text-lg sm:text-xl font-extrabold text-[#0f294d] mt-0.5">
            {isBn
              ? 'শিক্ষক ও কর্মচারী এইচআর ডকুমেন্ট ব্যবস্থাপনা'
              : 'HR & Staff Documents Management'}
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            {isBn
              ? 'নিয়োগপত্র, যোগদানপত্র, পদত্যাগ, অব্যাহতি, অভিজ্ঞতার সনদ, পদোন্নতি, বদলি ও A4 PDF/প্রিন্ট টেমপ্লেট'
              : 'Appointment, Joining, Resignation, Release, Experience, Promotion, Transfer & customizable A4 letterheads'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isHrManager ? (
            <button
              type="button"
              onClick={() => openCreateModal('appointment_letter')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#0f294d] hover:bg-[#163a6b] text-white transition-colors cursor-pointer"
            >
              <FilePlus2 className="w-4 h-4 text-amber-300" />
              <span>{isBn ? 'নতুন এইচআর ডকুমেন্ট তৈরি' : 'Create HR Document'}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => openCreateModal('joining_letter')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#0f294d] hover:bg-[#163a6b] text-white transition-colors cursor-pointer"
              >
                <UserCheck className="w-4 h-4 text-amber-300" />
                <span>{isBn ? 'যোগদানপত্র দাখিল' : 'Submit Joining Letter'}</span>
              </button>
              <button
                type="button"
                onClick={() => openCreateModal('resignation_letter')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4 text-rose-600" />
                <span>{isBn ? 'পদত্যাগ আবেদন' : 'Submit Resignation'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackBanner && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
            feedbackBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <span>{feedbackBanner.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="p-0.5 hover:opacity-70 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loadError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
          {loadError}
        </div>
      )}

      {/* 7 KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {[
          {
            label: isBn ? 'মোট ডকুমেন্ট' : 'Total Staff Documents',
            value: kpis.total,
            icon: FileText,
            tone: 'text-[#0f294d]',
          },
          {
            label: isBn ? 'নিয়োগপত্র' : 'Appointment Letters',
            value: kpis.appointments,
            icon: FileBadge2,
            tone: 'text-blue-700',
          },
          {
            label: isBn ? 'যোগদানপত্র' : 'Joining Letters',
            value: kpis.joiningAll,
            icon: FileCheck2,
            tone: 'text-emerald-700',
          },
          {
            label: isBn ? 'যোগদান অপেক্ষমাণ' : 'Pending Joining Approvals',
            value: kpis.pendingJoining,
            icon: Clock,
            tone: 'text-amber-700',
          },
          {
            label: isBn ? 'পদত্যাগ অপেক্ষমাণ' : 'Pending Resignation Apps',
            value: kpis.pendingResignations,
            icon: UserMinus,
            tone: 'text-rose-700',
          },
          {
            label: isBn ? 'অব্যাহতি প্রাপ্ত' : 'Released Staff',
            value: kpis.released,
            icon: LogOut,
            tone: 'text-slate-700',
          },
          {
            label: isBn ? 'অভিজ্ঞতার সনদ' : 'Experience Certificates',
            value: kpis.experience,
            icon: Award,
            tone: 'text-indigo-700',
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="bg-white rounded-xl border border-slate-200 p-3.5 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-600 leading-tight">
                  {card.label}
                </span>
                <Icon className={`w-4 h-4 shrink-0 ${card.tone}`} />
              </div>
              <div className={`text-2xl font-extrabold mt-2 tabular-nums ${card.tone}`}>
                {isBn ? toBnNumber(card.value) : card.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveSubTab('documents')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeSubTab === 'documents'
              ? 'bg-[#0f294d] text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>{isBn ? 'সকল স্টাফ ডকুমেন্ট' : 'All Staff Documents'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('workflows')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeSubTab === 'workflows'
              ? 'bg-[#0f294d] text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>{isBn ? 'যোগদান ও পদত্যাগ অনুমোদন' : 'Joining & Resignation Workflows'}</span>
          {kpis.pendingJoining + kpis.pendingResignations > 0 && (
            <span className="px-1.5 py-0.2 rounded bg-amber-500 text-slate-950 text-[10px] font-extrabold tabular-nums">
              {kpis.pendingJoining + kpis.pendingResignations}
            </span>
          )}
        </button>

        {canDesignTemplates && (
          <button
            type="button"
            onClick={() => setActiveSubTab('templates')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              activeSubTab === 'templates'
                ? 'bg-[#0f294d] text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <LayoutTemplate className="w-3.5 h-3.5" />
            <span>{isBn ? 'টেমপ্লেট ডিজাইনার (A4)' : 'Document Template Designer'}</span>
          </button>
        )}
      </div>

      {/* Tab 1: All Staff Documents Register */}
      {activeSubTab === 'documents' && (
        <div className="space-y-4">
          {/* Search & Multi-Filters */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="inline-flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-[#0f294d]" />
                <span>{isBn ? 'অনুসন্ধান ও ফিল্টার' : 'Search & Filters'}</span>
              </span>
              {(searchTerm || filterType !== 'all' || filterEmployeeId !== 'all' || filterStatus !== 'all' || dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setFilterType('all');
                    setFilterEmployeeId('all');
                    setFilterStatus('all');
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{isBn ? 'ফিল্টার রিসেট' : 'Reset Filters'}</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
              <div className="relative lg:col-span-2">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={
                    isBn
                      ? 'নাম, স্টাফ আইডি বা সিরিয়াল নং দিয়ে খুঁজুন...'
                      : 'Search by name, Staff ID, or Serial No...'
                  }
                  className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0f294d]"
                />
              </div>

              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as 'all' | HRDocumentType)}
                className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800"
              >
                <option value="all">{isBn ? 'সকল ডকুমেন্ট ধরন' : 'All Document Types'}</option>
                {HR_DOCUMENT_TYPES.map((m) => (
                  <option key={m.type} value={m.type}>
                    {isBn ? `${m.labelBn} (${m.shortEn})` : m.labelEn}
                  </option>
                ))}
              </select>

              <select
                value={filterEmployeeId}
                onChange={(e) => setFilterEmployeeId(e.target.value)}
                className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800"
              >
                <option value="all">{isBn ? 'সকল কর্মকর্তা / শিক্ষক' : 'All Employees'}</option>
                {staffList.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.nameEn} ({st.employeeId})
                  </option>
                ))}
              </select>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'all' | HRApprovalStatus)}
                className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800"
              >
                <option value="all">{isBn ? 'সকল স্ট্যাটাস' : 'All Statuses'}</option>
                <option value="Issued">{isBn ? 'ইস্যুকৃত (Issued)' : 'Issued'}</option>
                <option value="Pending">{isBn ? 'অপেক্ষমাণ (Pending)' : 'Pending'}</option>
                <option value="Approved">{isBn ? 'অনুমোদিত (Approved)' : 'Approved'}</option>
                <option value="Rejected">{isBn ? 'বাতিল (Rejected)' : 'Rejected'}</option>
              </select>

              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  title={isBn ? 'শুরুর তারিখ' : 'From Date'}
                  className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-lg bg-white"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  title={isBn ? 'শেষ তারিখ' : 'To Date'}
                  className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-lg bg-white"
                />
              </div>
            </div>
          </div>

          {/* Documents Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {isLoading ? (
              <div className="p-12 flex flex-col items-center justify-center text-slate-500 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-[#0f294d]" />
                <span className="text-xs font-medium">
                  {isBn ? 'এইচআর ডকুমেন্ট লোড হচ্ছে...' : 'Loading HR documents...'}
                </span>
              </div>
            ) : paginatedDocs.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <FileText className="w-10 h-10 text-slate-300 mx-auto" />
                <div className="text-sm font-bold text-slate-800">
                  {isBn ? 'কোনো এইচআর ডকুমেন্ট পাওয়া যায়নি' : 'No HR Documents Found'}
                </div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {isHrManager
                    ? isBn
                      ? 'শিক্ষক ও কর্মচারীদের নিয়োগপত্র, অভিজ্ঞতার সনদ বা পদোন্নতি পত্র তৈরি করতে নিচের বাটনে ক্লিক করুন।'
                      : 'Create official appointment letters, experience certificates, or notices directly from your Staff Directory.'
                    : isBn
                    ? 'আপনার কোনো ডকুমেন্ট বা আবেদন নেই। প্রয়োজনে যোগদানপত্র বা পদত্যাগপত্র দাখিল করুন।'
                    : 'No HR documents found for your profile. You can submit a Joining Letter or Resignation application anytime.'}
                </p>
                <button
                  type="button"
                  onClick={() => openCreateModal(isHrManager ? 'appointment_letter' : 'joining_letter')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#0f294d] text-white cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {isHrManager
                      ? isBn
                        ? 'প্রথম ডকুমেন্ট তৈরি করুন'
                        : 'Create First Document'
                      : isBn
                      ? 'যোগদানপত্র দাখিল করুন'
                      : 'Submit Joining Letter'}
                  </span>
                </button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase">
                        <th className="py-3 px-4">{isBn ? 'সিরিয়াল নং' : 'Serial No.'}</th>
                        <th className="py-3 px-4">{isBn ? 'শিক্ষক / কর্মচারী' : 'Employee'}</th>
                        <th className="py-3 px-4">{isBn ? 'ডকুমেন্টের ধরন' : 'Document Type'}</th>
                        <th className="py-3 px-4">{isBn ? 'ইস্যুর তারিখ' : 'Issue Date'}</th>
                        <th className="py-3 px-4">{isBn ? 'অবস্থা' : 'Status'}</th>
                        <th className="py-3 px-4 text-right">{isBn ? 'কার্যক্রম' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {paginatedDocs.map((doc) => {
                        const meta = HR_DOCUMENT_TYPE_MAP[doc.documentType];
                        const isBusy = busyDocId === doc.id;
                        return (
                          <tr key={doc.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 font-mono font-bold text-[#0f294d] whitespace-nowrap">
                              {doc.documentNumber}
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-bold text-slate-900">{doc.employeeName}</div>
                              <div className="text-[11px] text-slate-500 font-mono">
                                {doc.employeeCode} · {doc.documentData?.designation || '-'}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-semibold text-slate-800">{meta.labelBn}</div>
                              <div className="text-[11px] text-slate-500">{meta.labelEn}</div>
                            </td>
                            <td className="py-3 px-4 tabular-nums text-slate-700 whitespace-nowrap">
                              {formatDate(doc.issueDate)}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {renderStatusCell(doc.approvalStatus)}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setPreviewDoc(doc)}
                                  title={isBn ? 'প্রিভিউ দেখুন' : 'Preview Document'}
                                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleQuickDownload(doc)}
                                  title={isBn ? 'PDF ডাউনলোড' : 'Download A4 PDF'}
                                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-amber-50 text-amber-700 cursor-pointer disabled:opacity-50"
                                >
                                  {isBusy ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Download className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleQuickPrint(doc)}
                                  title={isBn ? 'প্রিন্ট করুন' : 'Print'}
                                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-blue-50 text-blue-700 cursor-pointer"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </button>
                                {isHrManager && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingDoc(doc);
                                      setEditorInitialType(doc.documentType);
                                      setEditorOpen(true);
                                    }}
                                    title={isBn ? 'সম্পাদনা' : 'Edit'}
                                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 cursor-pointer"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => setDocPendingDelete(doc)}
                                    title={isBn ? 'মুছে ফেলুন' : 'Delete'}
                                    className="p-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-600 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Footer */}
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <span className="tabular-nums">
                    {isBn
                      ? `মোট ${toBnNumber(filteredDocuments.length)} টি ডকুমেন্ট · পৃষ্ঠা ${toBnNumber(safePage)} / ${toBnNumber(totalPages)}`
                      : `Showing ${filteredDocuments.length} records · Page ${safePage} of ${totalPages}`}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Joining Letter Approvals & Resignation Applications */}
      {activeSubTab === 'workflows' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Joining Approvals Queue */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#0f294d]">
                  {isBn ? 'যোগদানপত্র অনুমোদন তালিকা' : 'Joining Letter Applications'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {isBn
                    ? 'অনুমোদন করলে কর্মীর যোগদানের তারিখ ও সক্রিয় স্ট্যাটাস স্বয়ংক্রিয়ভাবে আপডেট হবে'
                    : 'Approving automatically updates Staff Joining Date & Active status'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openCreateModal('joining_letter')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0f294d] text-white cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isBn ? 'যোগদানপত্র জমা' : 'New Joining'}</span>
              </button>
            </div>

            {pendingJoiningDocs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                {isBn
                  ? 'কোনো অপেক্ষমাণ যোগদানপত্র নেই।'
                  : 'No pending joining letters waiting for approval.'}
              </div>
            ) : (
              <div className="space-y-3">
                {pendingJoiningDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-xs text-slate-900">{doc.employeeName}</div>
                        <div className="text-[11px] text-slate-600 font-mono">
                          {doc.employeeCode} · {doc.documentNumber}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-1">
                          {isBn ? 'যোগদানের তারিখ:' : 'Joining Date:'}{' '}
                          <strong className="tabular-nums">
                            {formatDate(doc.documentData.joiningDate || '')}
                          </strong>
                          {doc.documentData.appointmentRefNumber
                            ? ` · Ref: ${doc.documentData.appointmentRefNumber}`
                            : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPreviewDoc(doc)}
                        className="text-[11px] font-bold text-blue-700 hover:underline cursor-pointer shrink-0"
                      >
                        {isBn ? 'বিস্তারিত' : 'View'}
                      </button>
                    </div>

                    {doc.documentData.joiningRemarks && (
                      <p className="text-[11px] text-slate-700 bg-white p-2 rounded border border-slate-200">
                        {doc.documentData.joiningRemarks}
                      </p>
                    )}

                    {canApprove && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          type="text"
                          value={workflowNotes[doc.id] || ''}
                          onChange={(e) =>
                            setWorkflowNotes((p) => ({ ...p, [doc.id]: e.target.value }))
                          }
                          placeholder={isBn ? 'মন্তব্য লিখুন...' : 'Approval note...'}
                          className="flex-1 min-w-[140px] px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                        />
                        <button
                          type="button"
                          disabled={busyDocId === doc.id}
                          onClick={() => void handleJoiningReview(doc, 'Approved')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-60"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isBn ? 'অনুমোদন' : 'Approve'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyDocId === doc.id}
                          onClick={() => void handleJoiningReview(doc, 'Rejected')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer disabled:opacity-60"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{isBn ? 'বাতিল' : 'Reject'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Resignation Applications Workflow */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#0f294d]">
                  {isBn ? 'পদত্যাগপত্র আবেদন ও পর্যালোচনা' : 'Resignation Management'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {isBn
                    ? 'কর্মী আবেদন → প্রধান শিক্ষক পর্যালোচনা → অনুমোদনে স্ট্যাটাস Resigned'
                    : 'Staff submits → Principal reviews → Approves/Rejects → Updates HR status'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openCreateModal('resignation_letter')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isBn ? 'পদত্যাগ আবেদন' : 'New Resignation'}</span>
              </button>
            </div>

            {resignations.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                {isBn
                  ? 'কোনো পদত্যাগপত্র আবেদন পাওয়া যায়নি।'
                  : 'No resignation applications submitted yet.'}
              </div>
            ) : (
              <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                {resignations.map((req) => (
                  <div
                    key={req.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-xs text-slate-900">
                          {req.employeeName} ·{' '}
                          <span className="font-normal text-slate-600">{req.designation}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {req.employeeCode} · {req.linkedDocumentNumber || req.id}
                        </div>
                      </div>
                      {renderStatusCell(req.approvalStatus)}
                    </div>

                    <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                      <span>
                        {isBn ? 'আবেদন:' : 'Applied:'} <strong>{formatDate(req.applicationDate)}</strong>
                      </span>
                      <span>
                        {isBn ? 'শেষ কর্মদিবস:' : 'Last Working:'}{' '}
                        <strong>{formatDate(req.proposedLastWorkingDate)}</strong>
                      </span>
                      <span>
                        {isBn ? 'নোটিশ:' : 'Notice:'} <strong>{req.noticePeriod}</strong>
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-800 bg-white p-2 rounded border border-slate-200">
                      {req.resignationReason}
                    </p>

                    {req.principalRemarks && (
                      <div className="text-[11px] text-[#0f294d] bg-blue-50/60 p-2 rounded border border-blue-200">
                        <strong>{isBn ? 'অধ্যক্ষের মন্তব্য:' : 'Principal Remarks:'}</strong>{' '}
                        {req.principalRemarks}
                      </div>
                    )}

                    {canApprove && req.approvalStatus === 'Pending' && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          type="text"
                          value={workflowNotes[req.id] || ''}
                          onChange={(e) =>
                            setWorkflowNotes((p) => ({ ...p, [req.id]: e.target.value }))
                          }
                          placeholder={
                            isBn ? 'প্রধান শিক্ষকের মন্তব্য...' : 'Principal remarks...'
                          }
                          className="flex-1 min-w-[140px] px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                        />
                        <button
                          type="button"
                          disabled={busyDocId === req.id}
                          onClick={() => void handleResignationReview(req, 'Approved')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-60"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isBn ? 'অনুমোদন' : 'Approve'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyDocId === req.id}
                          onClick={() => void handleResignationReview(req, 'Rejected')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer disabled:opacity-60"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{isBn ? 'বাতিল' : 'Reject'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Document Template Designer */}
      {activeSubTab === 'templates' && canDesignTemplates && (
        <HRTemplateDesignerPanel
          schoolId={schoolId}
          schoolProfile={schoolProfile}
          templates={templates}
          sampleStaff={staffList[0] || null}
          sampleDocument={visibleDocuments[0] || null}
          activeRole={activeRole}
          currentUid={actor.uid}
        />
      )}

      {/* Create / Edit HR Document Modal */}
      <HRDocumentEditorModal
        isOpen={editorOpen}
        schoolId={schoolId}
        schoolCode={schoolCode}
        schoolProfile={schoolProfile}
        staffList={staffList}
        templates={templates}
        existingDocuments={documents}
        currentUser={currentUser}
        activeRole={activeRole}
        editingDocument={editingDoc}
        initialDocType={editorInitialType}
        onClose={() => {
          setEditorOpen(false);
          setEditingDoc(null);
          setEditorInitialType(undefined);
        }}
        onSaved={(saved) => {
          setFeedbackBanner({
            type: 'success',
            text: isBn
              ? `ডকুমেন্ট (${saved.documentNumber}) সফলভাবে সংরক্ষিত হয়েছে।`
              : `Document ${saved.documentNumber} saved successfully.`,
          });
          setPreviewDoc(saved);
        }}
      />

      {/* Preview / PDF / Print / Approval Modal */}
      <HRDocumentPreviewModal
        document={previewDoc}
        schoolId={schoolId}
        schoolProfile={schoolProfile}
        templates={templates}
        currentUser={currentUser}
        activeRole={activeRole}
        staffList={staffList}
        onClose={() => setPreviewDoc(null)}
        onUpdated={(updated) => {
          setPreviewDoc(updated);
          setStaffList(StorageService.getStaff());
        }}
        onEdit={(docToEdit) => {
          setEditingDoc(docToEdit);
          setEditorInitialType(docToEdit.documentType);
          setEditorOpen(true);
        }}
      />

      {/* Delete Confirmation Modal */}
      {docPendingDelete && (
        <div className="fixed inset-0 z-[210] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4 text-rose-600" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  {isBn ? 'ডকুমেন্ট স্থায়ীভাবে মুছবেন?' : 'Delete HR Document?'}
                </h4>
                <p className="text-xs text-slate-600 mt-1">
                  {isBn
                    ? `আপনি কি নিশ্চিত যে ${docPendingDelete.employeeName}-এর ডকুমেন্ট (${docPendingDelete.documentNumber}) মুছে ফেলতে চান?`
                    : `Are you sure you want to delete ${docPendingDelete.documentNumber} for ${docPendingDelete.employeeName}?`}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDocPendingDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
              >
                {isBn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer disabled:opacity-60"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isBn ? 'হ্যাঁ, মুছে ফেলুন' : 'Delete Document'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
