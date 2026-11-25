import React, { useEffect, useMemo, useState } from 'react';
import {
  HRApprovalStatus,
  HRDocumentPayload,
  HRDocumentSalaryBreakdown,
  HRDocumentType,
  SchoolProfile,
  Staff,
  StaffDocumentTemplate,
  StaffHRDocument,
  StaffResignationRequest,
  UserProfile,
  UserRole,
} from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import {
  HR_DOCUMENT_TYPE_MAP,
  HR_DOCUMENT_TYPES,
  buildDefaultHRPayload,
  calculateEmploymentDuration,
  canCreateHRDocumentType,
  canManageAllHRDocuments,
  createDefaultHRTemplate,
} from '../../utils/hrDocumentHelpers';
import { buildHRDocumentPreviewHtml } from '../../utils/hrDocumentPdf';
import {
  generateUniqueDocumentNumber,
  makeAuditEntry,
  saveHRDocument,
  submitStaffResignationWorkflow,
} from '../../services/hrDocumentService';
import { formatSchoolScopedId } from '../../utils/schoolIdFormatter';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';

interface HRDocumentEditorModalProps {
  isOpen: boolean;
  schoolId: string;
  schoolCode: string;
  schoolProfile: Partial<SchoolProfile>;
  staffList: Staff[];
  templates: StaffDocumentTemplate[];
  existingDocuments: StaffHRDocument[];
  currentUser: UserProfile | null;
  activeRole: UserRole;
  editingDocument?: StaffHRDocument | null;
  initialDocType?: HRDocumentType;
  onClose: () => void;
  onSaved: (savedDoc: StaffHRDocument) => void;
}

export const HRDocumentEditorModal: React.FC<HRDocumentEditorModalProps> = ({
  isOpen,
  schoolId,
  schoolCode,
  schoolProfile,
  staffList,
  templates,
  existingDocuments,
  currentUser,
  activeRole,
  editingDocument,
  initialDocType,
  onClose,
  onSaved,
}) => {
  const { language, toBnNumber, formatTaka } = useLanguage();
  const isBn = language === 'bn';
  const isHrManager = canManageAllHRDocuments(activeRole, currentUser);

  const allowedTypes = useMemo(
    () => HR_DOCUMENT_TYPES.filter((meta) => canCreateHRDocumentType(meta.type, activeRole, currentUser)),
    [activeRole, currentUser]
  );

  // Resolve current staff profile for self-service submissions
  const ownStaffRecord = useMemo<Staff | null>(() => {
    if (!currentUser) return null;
    const found = staffList.find(
      (s) =>
        (currentUser.linkedStaffId && s.id === currentUser.linkedStaffId) ||
        (s.authUid && (s.authUid === currentUser.authUid || s.authUid === currentUser.id)) ||
        (s.email && currentUser.email && s.email.toLowerCase() === currentUser.email.toLowerCase())
    );
    if (found) return found;
    return {
      id: currentUser.linkedStaffId || currentUser.id || currentUser.authUid || 'staff_self',
      employeeId: currentUser.linkedStaffId || currentUser.username || 'STAFF-001',
      nameEn: currentUser.name || 'Staff Member',
      nameBn: currentUser.nameBn || currentUser.name || 'কর্মকর্তা / শিক্ষক',
      gender: 'Male',
      designation: activeRole.replace('_', ' '),
      department: 'Administration',
      role: activeRole,
      email: currentUser.email || '',
      phone: currentUser.phone || '',
      qualification: '',
      joiningDate: new Date().toISOString().split('T')[0],
      basicSalary: 0,
      houseRentAllowance: 0,
      medicalAllowance: 0,
      otherAllowance: 0,
      providentFundDeduction: 0,
      status: 'active',
    };
  }, [currentUser, staffList, activeRole]);

  const selectableStaff = useMemo(() => {
    if (isHrManager) return staffList;
    return ownStaffRecord ? [ownStaffRecord] : [];
  }, [isHrManager, staffList, ownStaffRecord]);

  const defaultTemplate = useMemo(
    () => templates.find((t) => t.isDefault) || templates[0] || createDefaultHRTemplate(schoolId),
    [templates, schoolId]
  );

  const [documentType, setDocumentType] = useState<HRDocumentType>('appointment_letter');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [templateId, setTemplateId] = useState<string>(defaultTemplate.id);
  const [docLang, setDocLang] = useState<'bn' | 'en'>(defaultTemplate.language || 'bn');
  const [documentNumber, setDocumentNumber] = useState<string>('');
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [payload, setPayload] = useState<HRDocumentPayload>({
    employeeNameEn: '',
    employeeCode: '',
    designation: '',
    department: '',
  });
  const [showLivePreview, setShowLivePreview] = useState<boolean>(true);
  const [isGeneratingSerial, setIsGeneratingSerial] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Initialize state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');

    if (editingDocument) {
      setDocumentType(editingDocument.documentType);
      setSelectedEmployeeId(editingDocument.employeeId);
      setTemplateId(editingDocument.templateId || defaultTemplate.id);
      setDocLang(editingDocument.language || 'bn');
      setDocumentNumber(editingDocument.documentNumber);
      setIssueDate(editingDocument.issueDate);
      setPayload(editingDocument.documentData);
      return;
    }

    const fallbackType =
      initialDocType && allowedTypes.some((t) => t.type === initialDocType)
        ? initialDocType
        : allowedTypes[0]?.type || 'joining_letter';
    const firstStaff = selectableStaff[0] || ownStaffRecord;
    const today = new Date().toISOString().split('T')[0];

    setDocumentType(fallbackType);
    setSelectedEmployeeId(firstStaff?.id || '');
    setTemplateId(defaultTemplate.id);
    setDocLang(defaultTemplate.language || 'bn');
    setIssueDate(today);

    if (firstStaff) {
      setPayload(
        buildDefaultHRPayload({
          documentType: fallbackType,
          staff: firstStaff,
          school: schoolProfile,
          schoolId,
          language: defaultTemplate.language || 'bn',
          existingDocs: existingDocuments,
        })
      );
    }

    void (async () => {
      setIsGeneratingSerial(true);
      try {
        const serial = await generateUniqueDocumentNumber({
          schoolId,
          schoolCode,
          documentType: fallbackType,
          issueDate: today,
          cachedDocs: existingDocuments,
        });
        setDocumentNumber(serial);
      } finally {
        setIsGeneratingSerial(false);
      }
    })();
  }, [
    isOpen,
    editingDocument,
    initialDocType,
    allowedTypes,
    selectableStaff,
    ownStaffRecord,
    defaultTemplate,
    schoolProfile,
    schoolId,
    schoolCode,
    existingDocuments,
  ]);

  const activeStaff = useMemo(
    () =>
      selectableStaff.find((s) => s.id === selectedEmployeeId) ||
      staffList.find((s) => s.id === selectedEmployeeId) ||
      ownStaffRecord,
    [selectableStaff, staffList, selectedEmployeeId, ownStaffRecord]
  );

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) || defaultTemplate,
    [templates, templateId, defaultTemplate]
  );

  const employeeAppointmentDocs = useMemo(() => {
    if (!activeStaff) return [];
    const scopedCode = formatSchoolScopedId(activeStaff.employeeId, schoolCode);
    return existingDocuments.filter(
      (d) =>
        d.documentType === 'appointment_letter' &&
        (d.employeeId === activeStaff.id || d.employeeCode === scopedCode || d.employeeCode === activeStaff.employeeId)
    );
  }, [existingDocuments, activeStaff, schoolCode]);

  const refreshPayloadFromProfile = (
    nextType: HRDocumentType,
    nextStaff: Staff | null,
    nextLang: 'bn' | 'en'
  ) => {
    if (!nextStaff) return;
    setPayload(
      buildDefaultHRPayload({
        documentType: nextType,
        staff: nextStaff,
        school: schoolProfile,
        schoolId,
        language: nextLang,
        existingDocs: existingDocuments,
      })
    );
  };

  const handleRegenerateSerial = async (nextType: HRDocumentType = documentType, nextDate: string = issueDate) => {
    setIsGeneratingSerial(true);
    try {
      const serial = await generateUniqueDocumentNumber({
        schoolId,
        schoolCode,
        documentType: nextType,
        issueDate: nextDate,
        cachedDocs: existingDocuments,
      });
      setDocumentNumber(serial);
    } finally {
      setIsGeneratingSerial(false);
    }
  };

  const handleTypeChange = (nextType: HRDocumentType) => {
    setDocumentType(nextType);
    if (!editingDocument) {
      refreshPayloadFromProfile(nextType, activeStaff, docLang);
      void handleRegenerateSerial(nextType, issueDate);
    }
  };

  const handleEmployeeChange = (staffId: string) => {
    setSelectedEmployeeId(staffId);
    const chosen = selectableStaff.find((s) => s.id === staffId) || staffList.find((s) => s.id === staffId) || null;
    if (!editingDocument && chosen) {
      refreshPayloadFromProfile(documentType, chosen, docLang);
    }
  };

  const handleLanguageChange = (nextLang: 'bn' | 'en') => {
    setDocLang(nextLang);
    if (!editingDocument && activeStaff) {
      refreshPayloadFromProfile(documentType, activeStaff, nextLang);
    }
  };

  const updateField = <K extends keyof HRDocumentPayload>(key: K, value: HRDocumentPayload[K]) => {
    setPayload((prev) => {
      const next: HRDocumentPayload = { ...prev, [key]: value };
      // Auto-recompute employment duration for Release Letter & Experience Certificate
      if (
        (documentType === 'release_letter' || documentType === 'experience_certificate') &&
        (key === 'employmentStartDate' || key === 'lastWorkingDate')
      ) {
        const dur = calculateEmploymentDuration(
          key === 'employmentStartDate' ? String(value || '') : next.employmentStartDate,
          key === 'lastWorkingDate' ? String(value || '') : next.lastWorkingDate
        );
        next.employmentDurationEn = dur.labelEn;
        next.employmentDurationBn = dur.labelBn;
      }
      // Auto-recompute show-cause deadline date when days change
      if (documentType === 'show_cause_notice' && key === 'responseDeadlineDays') {
        const days = Math.max(1, Number(value || 1));
        const baseTs = issueDate ? new Date(`${issueDate}T00:00:00Z`).getTime() : Date.now();
        if (!Number.isNaN(baseTs)) {
          next.responseDeadlineDate = new Date(baseTs + days * 86_400_000).toISOString().split('T')[0];
        }
      }
      return next;
    });
  };

  const updateSalaryField = (field: keyof HRDocumentSalaryBreakdown, rawValue: string) => {
    const val = Math.max(0, Number(rawValue) || 0);
    setPayload((prev) => {
      const current = prev.salaryBreakdown || {
        basicSalary: 0,
        houseRentAllowance: 0,
        medicalAllowance: 0,
        otherAllowance: 0,
        providentFundDeduction: 0,
        grossSalary: 0,
        netSalary: 0,
      };
      const updated = { ...current, [field]: val };
      const gross =
        Number(updated.basicSalary || 0) +
        Number(updated.houseRentAllowance || 0) +
        Number(updated.medicalAllowance || 0) +
        Number(updated.otherAllowance || 0);
      const net = Math.max(0, gross - Number(updated.providentFundDeduction || 0));
      updated.grossSalary = gross;
      updated.netSalary = net;
      return {
        ...prev,
        salaryBreakdown: updated,
        monthlySalary: net,
      };
    });
  };

  const updateIncrementNumbers = (mode: 'amount' | 'percent', rawVal: string) => {
    const val = Math.max(0, Number(rawVal) || 0);
    setPayload((prev) => {
      const prevSalary = Number(prev.previousSalary || 0);
      let incrementAmount = Number(prev.incrementAmount || 0);
      let incrementPercentage = Number(prev.incrementPercentage || 0);
      if (mode === 'amount') {
        incrementAmount = val;
        incrementPercentage = prevSalary > 0 ? Math.round((val / prevSalary) * 1000) / 10 : 0;
      } else {
        incrementPercentage = val;
        incrementAmount = Math.round((prevSalary * val) / 100);
      }
      return {
        ...prev,
        incrementAmount,
        incrementPercentage,
        newSalary: prevSalary + incrementAmount,
      };
    });
  };

  // Build synthetic doc object for Live Preview & Save
  const previewDocument: StaffHRDocument = useMemo(() => {
    const now = new Date().toISOString();
    const meta = HR_DOCUMENT_TYPE_MAP[documentType];
    const actorUid = currentUser?.authUid || currentUser?.id || 'system';
    const actorName = currentUser?.name || 'Admin';
    const defaultStatus: HRApprovalStatus = editingDocument
      ? editingDocument.approvalStatus
      : meta.defaultStatusOnAdminCreate;

    return {
      id: editingDocument?.id || `hrdoc_preview`,
      schoolId: schoolId || 'default',
      employeeId: activeStaff?.id || selectedEmployeeId || payload.employeeCode || 'staff',
      employeeAuthUid: activeStaff?.authUid || currentUser?.authUid || undefined,
      employeeCode: payload.employeeCode || activeStaff?.employeeId || 'STAFF-001',
      employeeName: payload.employeeNameEn || payload.employeeNameBn || activeStaff?.nameEn || 'Employee',
      documentType,
      documentNumber: documentNumber || 'SSBD/DOC/2026/0001',
      issueDate,
      language: docLang,
      templateId,
      approvalStatus: defaultStatus,
      createdByUid: editingDocument?.createdByUid || actorUid,
      createdBy: editingDocument?.createdBy || actorName,
      createdByRole: editingDocument?.createdByRole || activeRole,
      createdAt: editingDocument?.createdAt || now,
      updatedAt: now,
      documentData: payload,
      auditLogs: editingDocument?.auditLogs || [],
    };
  }, [
    editingDocument,
    documentType,
    schoolId,
    activeStaff,
    selectedEmployeeId,
    payload,
    documentNumber,
    issueDate,
    docLang,
    templateId,
    currentUser,
    activeRole,
  ]);

  const previewHtml = useMemo(
    () => buildHRDocumentPreviewHtml(previewDocument, schoolProfile, selectedTemplate),
    [previewDocument, schoolProfile, selectedTemplate]
  );

  const computedDuration = useMemo(
    () => calculateEmploymentDuration(payload.employmentStartDate, payload.lastWorkingDate),
    [payload.employmentStartDate, payload.lastWorkingDate]
  );

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!activeStaff && !payload.employeeNameEn.trim()) {
      setErrorMsg(isBn ? 'অনুগ্রহ করে একজন শিক্ষক/কর্মচারী নির্বাচন করুন।' : 'Please select an employee.');
      return;
    }
    if (!documentNumber.trim()) {
      setErrorMsg(isBn ? 'ডকুমেন্ট সিরিয়াল নম্বর প্রয়োজন।' : 'Document serial number is required.');
      return;
    }
    if (documentType === 'resignation_letter' && !(payload.resignationReason || '').trim()) {
      setErrorMsg(isBn ? 'পদত্যাগের কারণ উল্লেখ করুন।' : 'Please provide a resignation reason.');
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const actor = {
        uid: currentUser?.authUid || currentUser?.id || 'system',
        name: currentUser?.name || currentUser?.email || 'User',
        role: activeRole,
      };
      const meta = HR_DOCUMENT_TYPE_MAP[documentType];

      const docId = editingDocument?.id || `hrdoc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const isSelfResignationCreate = !editingDocument && documentType === 'resignation_letter';
      const nextStatus: HRApprovalStatus = editingDocument
        ? editingDocument.approvalStatus
        : meta.requiresApproval
        ? 'Pending'
        : meta.defaultStatusOnAdminCreate;

      const auditEntry = makeAuditEntry(
        editingDocument
          ? 'updated'
          : meta.requiresApproval
          ? 'submitted'
          : 'created',
        actor
      );

      const finalDoc: StaffHRDocument = {
        id: docId,
        schoolId,
        employeeId: activeStaff?.id || selectedEmployeeId || payload.employeeCode || 'staff',
        employeeAuthUid: activeStaff?.authUid || currentUser?.authUid || undefined,
        employeeCode: (payload.employeeCode || activeStaff?.employeeId || 'STAFF-001').trim(),
        employeeName: (payload.employeeNameEn || payload.employeeNameBn || activeStaff?.nameEn || 'Staff').trim(),
        documentType,
        documentNumber: documentNumber.trim(),
        issueDate,
        language: docLang,
        templateId: selectedTemplate.id,
        approvalStatus: nextStatus,
        ...(editingDocument?.approvalNote ? { approvalNote: editingDocument.approvalNote } : {}),
        ...(editingDocument?.approvedByUid ? { approvedByUid: editingDocument.approvedByUid } : {}),
        ...(editingDocument?.approvedByName ? { approvedByName: editingDocument.approvedByName } : {}),
        ...(editingDocument?.approvedAt ? { approvedAt: editingDocument.approvedAt } : {}),
        createdByUid: editingDocument?.createdByUid || actor.uid,
        createdBy: editingDocument?.createdBy || actor.name,
        createdByRole: editingDocument?.createdByRole || activeRole,
        createdAt: editingDocument?.createdAt || now,
        updatedAt: now,
        documentData: {
          ...payload,
          ...(isSelfResignationCreate ? { resignationId: `resign_${Date.now()}` } : {}),
        },
        auditLogs: [...(editingDocument?.auditLogs || []), auditEntry].slice(-50),
      };

      if (isSelfResignationCreate) {
        const resignationId = finalDoc.documentData.resignationId || `resign_${Date.now()}`;
        const resignationReq: StaffResignationRequest = {
          id: resignationId,
          schoolId,
          employeeId: finalDoc.employeeId,
          employeeAuthUid: finalDoc.employeeAuthUid,
          employeeCode: finalDoc.employeeCode,
          employeeName: finalDoc.employeeName,
          employeeNameBn: payload.employeeNameBn,
          designation: payload.designation || '-',
          department: payload.department || '-',
          resignationReason: (payload.resignationReason || '').trim(),
          applicationDate: payload.applicationDate || issueDate,
          proposedLastWorkingDate: payload.proposedLastWorkingDate || issueDate,
          noticePeriod: payload.noticePeriod || '30 Days',
          employeeSignature: payload.employeeSignature || finalDoc.employeeName,
          approvalStatus: 'Pending',
          linkedDocumentId: finalDoc.id,
          linkedDocumentNumber: finalDoc.documentNumber,
          createdByUid: actor.uid,
          createdAt: now,
          updatedAt: now,
          auditLogs: [auditEntry],
        };
        const res = await submitStaffResignationWorkflow({
          schoolId,
          resignation: resignationReq,
          linkedDocument: finalDoc,
        });
        onSaved(res.document);
      } else {
        const saved = await saveHRDocument(schoolId, finalDoc);
        onSaved(saved);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || (isBn ? 'সংরক্ষণ করতে সমস্যা হয়েছে।' : 'Failed to save HR document.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[190] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto print:hidden">
      <div className="w-full max-w-[1280px] max-h-[94vh] bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#0f294d] text-white flex items-center justify-between border-b-2 border-amber-500">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-amber-300" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold truncate">
                {editingDocument
                  ? isBn
                    ? `ডকুমেন্ট সম্পাদনা — ${editingDocument.documentNumber}`
                    : `Edit Document — ${editingDocument.documentNumber}`
                  : isBn
                  ? 'নতুন এইচআর ও স্টাফ ডকুমেন্ট তৈরি করুন'
                  : 'Create Official HR & Staff Document'}
              </h3>
              <p className="text-[11px] text-slate-300 truncate">
                {HR_DOCUMENT_TYPE_MAP[documentType].labelBn} · {HR_DOCUMENT_TYPE_MAP[documentType].labelEn}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowLivePreview((prev) => !prev)}
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-colors cursor-pointer"
            >
              {showLivePreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>
                {showLivePreview
                  ? isBn
                    ? 'প্রিভিউ লুকান'
                    : 'Hide A4 Preview'
                  : isBn
                  ? 'লাইভ প্রিভিউ দেখুন'
                  : 'Show A4 Preview'}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body Split */}
        <form onSubmit={handleSave} className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* Left Form Pane */}
          <div className={`${showLivePreview ? 'lg:w-[54%]' : 'w-full'} overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-50/70`}>
            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Document Metadata & Auto-populate Controls */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#0f294d] uppercase tracking-wide">
                  {isBn ? '১. ডকুমেন্ট সেটআপ ও কর্মী নির্বাচন' : '1. Document Setup & Employee'}
                </span>
                {activeStaff && !editingDocument && (
                  <button
                    type="button"
                    onClick={() => refreshPayloadFromProfile(documentType, activeStaff, docLang)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-800 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>{isBn ? 'প্রোফাইল থেকে অটো-ফিল' : 'Auto-fill from Profile'}</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isBn ? 'ডকুমেন্টের ধরন *' : 'Document Type *'}
                  </label>
                  <select
                    value={documentType}
                    disabled={Boolean(editingDocument)}
                    onChange={(e) => handleTypeChange(e.target.value as HRDocumentType)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0f294d] disabled:bg-slate-100"
                  >
                    {allowedTypes.map((meta) => (
                      <option key={meta.type} value={meta.type}>
                        {meta.labelBn} ({meta.labelEn})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isBn ? 'শিক্ষক / কর্মচারী *' : 'Teacher / Staff Member *'}
                  </label>
                  <select
                    value={selectedEmployeeId}
                    disabled={Boolean(editingDocument) || !isHrManager}
                    onChange={(e) => handleEmployeeChange(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0f294d] disabled:bg-slate-100"
                  >
                    {selectableStaff.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.nameEn} ({formatSchoolScopedId(st.employeeId, schoolCode)}) — {st.designation}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isBn ? 'সিরিয়াল / স্মারক নম্বর *' : 'Document Serial Number *'}
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={documentNumber}
                      onChange={(e) => setDocumentNumber(e.target.value)}
                      className="flex-1 px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0f294d]"
                      required
                    />
                    {!editingDocument && (
                      <button
                        type="button"
                        onClick={() => void handleRegenerateSerial()}
                        disabled={isGeneratingSerial}
                        title={isBn ? 'নতুন সিরিয়াল তৈরি করুন' : 'Generate Next Serial'}
                        className="px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingSerial ? 'animate-spin' : ''}`} />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isBn ? 'ইস্যুর তারিখ *' : 'Issue Date *'}
                  </label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0f294d]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isBn ? 'ডকুমেন্ট টেমপ্লেট' : 'Letterhead Template'}
                  </label>
                  <select
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0f294d]"
                  >
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} {tpl.isDefault ? '★' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isBn ? 'ডকুমেন্টের ভাষা' : 'Document Language'}
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleLanguageChange('bn')}
                      className={`py-2 px-3 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                        docLang === 'bn'
                          ? 'bg-[#0f294d] text-white border-[#0f294d]'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      বাংলা (Bangla)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLanguageChange('en')}
                      className={`py-2 px-3 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                        docLang === 'en'
                          ? 'bg-[#0f294d] text-white border-[#0f294d]'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      English
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Employee Snapshot Info */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <span className="block text-xs font-bold text-[#0f294d] uppercase tracking-wide">
                {isBn ? '২. কর্মকর্তা / শিক্ষকের তথ্য' : '2. Employee Snapshot Details'}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'নাম (English)' : 'Employee Name (English)'}
                  </label>
                  <input
                    type="text"
                    value={payload.employeeNameEn || ''}
                    onChange={(e) => updateField('employeeNameEn', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'নাম (বাংলা)' : 'Employee Name (Bangla)'}
                  </label>
                  <input
                    type="text"
                    value={payload.employeeNameBn || ''}
                    onChange={(e) => updateField('employeeNameBn', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'স্টাফ আইডি' : 'Staff / Employee ID'}
                  </label>
                  <input
                    type="text"
                    value={payload.employeeCode || ''}
                    onChange={(e) => updateField('employeeCode', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'পদবি' : 'Designation'}
                  </label>
                  <input
                    type="text"
                    value={payload.designation || ''}
                    onChange={(e) => updateField('designation', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'বিভাগ' : 'Department'}
                  </label>
                  <input
                    type="text"
                    value={payload.department || ''}
                    onChange={(e) => updateField('department', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'পাঠদানের বিষয় (শিক্ষকদের জন্য)' : 'Subject (For Teachers)'}
                  </label>
                  <input
                    type="text"
                    value={payload.subject || ''}
                    onChange={(e) => updateField('subject', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            </div>

            {/* Type-Specific Form Fields */}
            {documentType === 'appointment_letter' && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <span className="block text-xs font-bold text-[#0f294d] uppercase tracking-wide">
                  {isBn ? '৩. নিয়োগপত্র ও বেতন কাঠামো' : '3. Appointment & Salary Details'}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'চাকুরির ধরন' : 'Employment Type'}
                    </label>
                    <select
                      value={payload.employmentType || 'Full-Time Permanent'}
                      onChange={(e) =>
                        updateField('employmentType', e.target.value as HRDocumentPayload['employmentType'])
                      }
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="Full-Time Permanent">Full-Time Permanent</option>
                      <option value="Probationary">Probationary</option>
                      <option value="Contractual">Contractual</option>
                      <option value="Part-Time">Part-Time</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'যোগদানের তারিখ' : 'Joining Date'}
                    </label>
                    <input
                      type="date"
                      value={payload.joiningDate || ''}
                      onChange={(e) => updateField('joiningDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'শিক্ষানবিশকাল' : 'Probation Period'}
                    </label>
                    <input
                      type="text"
                      value={payload.probationPeriod || ''}
                      onChange={(e) => updateField('probationPeriod', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'কর্মঘণ্টা' : 'Working Hours'}
                    </label>
                    <input
                      type="text"
                      value={payload.workingHours || ''}
                      onChange={(e) => updateField('workingHours', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'অব্যাহতি নোটিশকাল' : 'Notice Period'}
                    </label>
                    <input
                      type="text"
                      value={payload.noticePeriod || ''}
                      onChange={(e) => updateField('noticePeriod', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div className="flex items-center gap-4 pt-4">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(payload.includeEmployeePhoto)}
                        onChange={(e) => updateField('includeEmployeePhoto', e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>{isBn ? 'কর্মীর ছবি যুক্ত করুন' : 'Include Employee Photo'}</span>
                    </label>
                  </div>
                </div>

                {/* Salary Breakdown Editor */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-bold text-[#0f294d]">
                    <span>{isBn ? 'মাসিক বেতন বিভাজন (BDT)' : 'Salary Breakdown (BDT)'}</span>
                    <span className="tabular-nums text-emerald-700">
                      {isBn ? 'নিট বেতন:' : 'Net Monthly:'}{' '}
                      {formatTaka(payload.salaryBreakdown?.netSalary ?? payload.monthlySalary ?? 0)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">Basic</label>
                      <input
                        type="number"
                        min={0}
                        value={payload.salaryBreakdown?.basicSalary ?? 0}
                        onChange={(e) => updateSalaryField('basicSalary', e.target.value)}
                        className="w-full px-2 py-1.5 text-xs tabular-nums border border-slate-200 rounded bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">House Rent</label>
                      <input
                        type="number"
                        min={0}
                        value={payload.salaryBreakdown?.houseRentAllowance ?? 0}
                        onChange={(e) => updateSalaryField('houseRentAllowance', e.target.value)}
                        className="w-full px-2 py-1.5 text-xs tabular-nums border border-slate-200 rounded bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">Medical</label>
                      <input
                        type="number"
                        min={0}
                        value={payload.salaryBreakdown?.medicalAllowance ?? 0}
                        onChange={(e) => updateSalaryField('medicalAllowance', e.target.value)}
                        className="w-full px-2 py-1.5 text-xs tabular-nums border border-slate-200 rounded bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">Other Allow.</label>
                      <input
                        type="number"
                        min={0}
                        value={payload.salaryBreakdown?.otherAllowance ?? 0}
                        onChange={(e) => updateSalaryField('otherAllowance', e.target.value)}
                        className="w-full px-2 py-1.5 text-xs tabular-nums border border-slate-200 rounded bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-rose-700 mb-0.5">PF Deduct (-)</label>
                      <input
                        type="number"
                        min={0}
                        value={payload.salaryBreakdown?.providentFundDeduction ?? 0}
                        onChange={(e) => updateSalaryField('providentFundDeduction', e.target.value)}
                        className="w-full px-2 py-1.5 text-xs tabular-nums border border-slate-200 rounded bg-white"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'দায়িত্ব ও কর্তব্যসমূহ' : 'Job Responsibilities'}
                  </label>
                  <textarea
                    rows={3}
                    value={payload.jobResponsibilities || ''}
                    onChange={(e) => updateField('jobResponsibilities', e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'চাকুরির শর্তাবলী' : 'Terms and Conditions'}
                  </label>
                  <textarea
                    rows={3}
                    value={payload.termsAndConditions || ''}
                    onChange={(e) => updateField('termsAndConditions', e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            )}

            {documentType === 'joining_letter' && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <span className="block text-xs font-bold text-[#0f294d] uppercase tracking-wide">
                  {isBn ? '৩. যোগদানপত্র তথ্য' : '3. Joining Letter Details'}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'নিয়োগপত্র সূত্র নম্বর' : 'Appointment Letter Reference No.'}
                    </label>
                    <input
                      type="text"
                      list="hr-appointment-refs"
                      value={payload.appointmentRefNumber || ''}
                      onChange={(e) => updateField('appointmentRefNumber', e.target.value)}
                      placeholder="e.g. SCH001/APPT/2026/0001"
                      className="w-full px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                    />
                    <datalist id="hr-appointment-refs">
                      {employeeAppointmentDocs.map((appt) => (
                        <option key={appt.id} value={appt.documentNumber}>
                          {appt.documentNumber} ({appt.issueDate})
                        </option>
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'যোগদানের তারিখ *' : 'Joining Date *'}
                    </label>
                    <input
                      type="date"
                      value={payload.joiningDate || ''}
                      onChange={(e) => updateField('joiningDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'দাখিলের তারিখ' : 'Submitted Date'}
                    </label>
                    <input
                      type="date"
                      value={payload.submittedDate || issueDate}
                      onChange={(e) => updateField('submittedDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'আবেদনকারীর স্বাক্ষর' : 'Employee Signature'}
                    </label>
                    <input
                      type="text"
                      value={payload.employeeSignature || ''}
                      onChange={(e) => updateField('employeeSignature', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'যোগদান সংক্রান্ত মন্তব্য' : 'Joining Remarks'}
                  </label>
                  <textarea
                    rows={3}
                    value={payload.joiningRemarks || ''}
                    onChange={(e) => updateField('joiningRemarks', e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                  {isBn
                    ? 'নোটঃ যোগদানপত্রটি প্রিন্সিপাল/অ্যাডমিন অনুমোদন করলে কর্মীর অফিশিয়াল যোগদানের তারিখ ও সক্রিয় স্ট্যাটাস স্বয়ংক্রিয়ভাবে আপডেট হবে।'
                    : 'Note: Upon Principal/Admin approval, the employee official Joining Date and Active status are automatically synced in the Staff Directory.'}
                </div>
              </div>
            )}

            {documentType === 'resignation_letter' && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <span className="block text-xs font-bold text-[#0f294d] uppercase tracking-wide">
                  {isBn ? '৩. পদত্যাগপত্র আবেদন' : '3. Resignation Application'}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'আবেদনের তারিখ' : 'Application Date'}
                    </label>
                    <input
                      type="date"
                      value={payload.applicationDate || issueDate}
                      onChange={(e) => updateField('applicationDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'প্রস্তাবিত শেষ কর্মদিবস *' : 'Proposed Last Working Date *'}
                    </label>
                    <input
                      type="date"
                      value={payload.proposedLastWorkingDate || ''}
                      onChange={(e) => updateField('proposedLastWorkingDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'নোটিশ সময়কাল' : 'Notice Period'}
                    </label>
                    <input
                      type="text"
                      value={payload.noticePeriod || ''}
                      onChange={(e) => updateField('noticePeriod', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'কর্মীর স্বাক্ষর' : 'Employee Signature'}
                    </label>
                    <input
                      type="text"
                      value={payload.employeeSignature || ''}
                      onChange={(e) => updateField('employeeSignature', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'পদত্যাগের কারণ *' : 'Resignation Reason *'}
                  </label>
                  <textarea
                    rows={3}
                    value={payload.resignationReason || ''}
                    onChange={(e) => updateField('resignationReason', e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                    required
                  />
                </div>
              </div>
            )}

            {documentType === 'resignation_acceptance' && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <span className="block text-xs font-bold text-[#0f294d] uppercase tracking-wide">
                  {isBn ? '৩. পদত্যাগ গ্রহণপত্র তথ্য' : '3. Resignation Acceptance Details'}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'গ্রহণের তারিখ' : 'Acceptance Date'}
                    </label>
                    <input
                      type="date"
                      value={payload.acceptanceDate || issueDate}
                      onChange={(e) => updateField('acceptanceDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'চূড়ান্ত শেষ কর্মদিবস' : 'Effective Last Working Date'}
                    </label>
                    <input
                      type="date"
                      value={payload.lastWorkingDate || ''}
                      onChange={(e) => updateField('lastWorkingDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'অধ্যক্ষের মন্তব্য / ছাড়পত্র নির্দেশনা' : 'Principal Remarks & Handover Instructions'}
                  </label>
                  <textarea
                    rows={3}
                    value={payload.principalRemarks || ''}
                    onChange={(e) => updateField('principalRemarks', e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            )}

            {(documentType === 'release_letter' || documentType === 'experience_certificate') && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#0f294d] uppercase tracking-wide">
                    {isBn ? '৩. চাকুরির মেয়াদ ও অভিজ্ঞতা মূল্যায়ন' : '3. Service Tenure & Performance'}
                  </span>
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md tabular-nums">
                    {isBn ? computedDuration.labelBn : computedDuration.labelEn}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'চাকুরি শুরুর তারিখ *' : 'Employment Start Date *'}
                    </label>
                    <input
                      type="date"
                      value={payload.employmentStartDate || ''}
                      onChange={(e) => updateField('employmentStartDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'শেষ কর্মদিবস *' : 'Last Working Date *'}
                    </label>
                    <input
                      type="date"
                      value={payload.lastWorkingDate || ''}
                      onChange={(e) => updateField('lastWorkingDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'কর্মদক্ষতা ও আচরণগত মন্তব্য' : 'Work Performance Remarks'}
                  </label>
                  <textarea
                    rows={3}
                    value={payload.workPerformanceRemarks || ''}
                    onChange={(e) => updateField('workPerformanceRemarks', e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            )}

            {documentType === 'promotion_letter' && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <span className="block text-xs font-bold text-[#0f294d] uppercase tracking-wide">
                  {isBn ? '৩. পদোন্নতি তথ্য' : '3. Promotion Details'}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'পূর্ববর্তী পদবি' : 'Previous Designation'}
                    </label>
                    <input
                      type="text"
                      value={payload.previousDesignation || ''}
                      onChange={(e) => updateField('previousDesignation', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'নতুন পদোন্নতিপ্রাপ্ত পদবি *' : 'New Designation *'}
                    </label>
                    <input
                      type="text"
                      value={payload.newDesignation || ''}
                      onChange={(e) => updateField('newDesignation', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'নতুন বিভাগ' : 'New Department'}
                    </label>
                    <input
                      type="text"
                      value={payload.newDepartment || ''}
                      onChange={(e) => updateField('newDepartment', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'সংশোধিত মাসিক বেতন (BDT)' : 'Revised Monthly Salary (BDT)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={payload.newSalary ?? 0}
                      onChange={(e) => updateField('newSalary', Number(e.target.value) || 0)}
                      className="w-full px-3 py-1.5 text-xs tabular-nums border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'কার্যকর তারিখ' : 'Effective Date'}
                    </label>
                    <input
                      type="date"
                      value={payload.effectiveDate || issueDate}
                      onChange={(e) => updateField('effectiveDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'পদোন্নতির প্রশংসাপত্র / মন্তব্য' : 'Promotion Remarks'}
                  </label>
                  <textarea
                    rows={3}
                    value={payload.workPerformanceRemarks || ''}
                    onChange={(e) => updateField('workPerformanceRemarks', e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            )}

            {documentType === 'transfer_letter' && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <span className="block text-xs font-bold text-[#0f294d] uppercase tracking-wide">
                  {isBn ? '৩. বদলি আদেশ তথ্য' : '3. Transfer Order Details'}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'বর্তমান শাখা / কর্মস্থল' : 'Current Campus / Branch'}
                    </label>
                    <input
                      type="text"
                      value={payload.previousBranch || ''}
                      onChange={(e) => updateField('previousBranch', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'নতুন নির্ধারিত শাখা *' : 'New Assigned Campus / Branch *'}
                    </label>
                    <input
                      type="text"
                      value={payload.newBranch || ''}
                      onChange={(e) => updateField('newBranch', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'কার্যকর তারিখ' : 'Effective Date'}
                    </label>
                    <input
                      type="date"
                      value={payload.effectiveDate || issueDate}
                      onChange={(e) => updateField('effectiveDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'রিপোর্টিং কর্মকর্তা' : 'Reporting Officer'}
                    </label>
                    <input
                      type="text"
                      value={payload.reportingOfficer || ''}
                      onChange={(e) => updateField('reportingOfficer', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'আদেশের বিবরণ' : 'Transfer Order Text'}
                  </label>
                  <textarea
                    rows={3}
                    value={payload.customBodyText || ''}
                    onChange={(e) => updateField('customBodyText', e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            )}

            {documentType === 'salary_increment_letter' && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <span className="block text-xs font-bold text-[#0f294d] uppercase tracking-wide">
                  {isBn ? '৩. বেতন বৃদ্ধি বিবরণী' : '3. Salary Increment Details'}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'পূর্ববর্তী মাসিক বেতন' : 'Previous Monthly Salary'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={payload.previousSalary ?? 0}
                      onChange={(e) => {
                        const prevSalary = Math.max(0, Number(e.target.value) || 0);
                        const incAmt = Number(payload.incrementAmount || 0);
                        setPayload((prev) => ({
                          ...prev,
                          previousSalary: prevSalary,
                          incrementPercentage:
                            prevSalary > 0 ? Math.round((incAmt / prevSalary) * 1000) / 10 : 0,
                          newSalary: prevSalary + incAmt,
                        }));
                      }}
                      className="w-full px-3 py-1.5 text-xs tabular-nums border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'কার্যকর তারিখ' : 'Effective Date'}
                    </label>
                    <input
                      type="date"
                      value={payload.effectiveDate || issueDate}
                      onChange={(e) => updateField('effectiveDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'বেতন বৃদ্ধির পরিমাণ (BDT)' : 'Increment Amount (BDT)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={payload.incrementAmount ?? 0}
                      onChange={(e) => updateIncrementNumbers('amount', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs tabular-nums border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'শতকরা হার (%)' : 'Increment Percentage (%)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={payload.incrementPercentage ?? 0}
                      onChange={(e) => updateIncrementNumbers('percent', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs tabular-nums border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center justify-between">
                  <span>{isBn ? 'নতুন সংশোধিত মাসিক বেতন:' : 'New Revised Monthly Salary:'}</span>
                  <span className="tabular-nums">{formatTaka(payload.newSalary ?? 0)}</span>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'মূল্যায়ন মন্তব্য' : 'Performance & Appraisal Note'}
                  </label>
                  <textarea
                    rows={2}
                    value={payload.workPerformanceRemarks || ''}
                    onChange={(e) => updateField('workPerformanceRemarks', e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            )}

            {(documentType === 'warning_letter' || documentType === 'show_cause_notice') && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <span className="block text-xs font-bold text-rose-800 uppercase tracking-wide">
                  {documentType === 'warning_letter'
                    ? isBn
                      ? '৩. সতর্কীকরণ তথ্য'
                      : '3. Warning Letter Details'
                    : isBn
                    ? '৩. কারণ দর্শানোর নোটিশ তথ্য'
                    : '3. Show Cause Notice Details'}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {isBn ? 'ঘটনার তারিখ' : 'Incident Date'}
                    </label>
                    <input
                      type="date"
                      value={payload.incidentDate || issueDate}
                      onChange={(e) => updateField('incidentDate', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  {documentType === 'warning_letter' ? (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {isBn ? 'সতর্কতার স্তর' : 'Warning Level'}
                      </label>
                      <select
                        value={payload.warningLevel || 'First Warning'}
                        onChange={(e) =>
                          updateField('warningLevel', e.target.value as HRDocumentPayload['warningLevel'])
                        }
                        className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="First Warning">First Warning</option>
                        <option value="Second Warning">Second Warning</option>
                        <option value="Final Warning">Final Warning</option>
                      </select>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          {isBn ? 'জবাবের সময়সীমা (কর্মদিবস)' : 'Response Window (Days)'}
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={payload.responseDeadlineDays ?? 3}
                          onChange={(e) => updateField('responseDeadlineDays', Number(e.target.value) || 3)}
                          className="w-full px-3 py-1.5 text-xs tabular-nums border border-slate-200 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          {isBn ? 'জবাব দাখিলের শেষ তারিখ' : 'Response Deadline Date'}
                        </label>
                        <input
                          type="date"
                          value={payload.responseDeadlineDate || ''}
                          onChange={(e) => updateField('responseDeadlineDate', e.target.value)}
                          className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                        />
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'অভিযোগ / ঘটনার বিবরণ *' : 'Allegation / Reason *'}
                  </label>
                  <textarea
                    rows={3}
                    value={payload.reasonOrAllegation || ''}
                    onChange={(e) => updateField('reasonOrAllegation', e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'সংশোধনমূলক নির্দেশনা' : 'Instructions / Corrective Action'}
                  </label>
                  <textarea
                    rows={2}
                    value={payload.correctiveAction || ''}
                    onChange={(e) => updateField('correctiveAction', e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            )}

            {/* Signatory & Seal Options */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <span className="block text-xs font-bold text-[#0f294d] uppercase tracking-wide">
                {isBn ? '৪. স্বাক্ষর ও সিলমোহর সেটিংস' : '4. Authorized Signatory & Seal'}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'প্রধান শিক্ষক / সভাপতির নাম' : 'Principal / Chairman Name'}
                  </label>
                  <input
                    type="text"
                    value={payload.principalOrChairmanName || ''}
                    onChange={(e) => updateField('principalOrChairmanName', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isBn ? 'স্বাক্ষরকারীর পদবি' : 'Signatory Title'}
                  </label>
                  <input
                    type="text"
                    value={payload.principalOrChairmanTitle || ''}
                    onChange={(e) => updateField('principalOrChairmanTitle', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={payload.includeSchoolSeal !== false}
                  onChange={(e) => updateField('includeSchoolSeal', e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>{isBn ? 'ডকুমেন্টে বিদ্যালয়ের সিলমোহর দেখান' : 'Show Official School Seal Stamp'}</span>
              </label>
            </div>
          </div>

          {/* Right Live A4 Portrait Preview Pane */}
          {showLivePreview && (
            <div className="hidden lg:flex lg:w-[46%] flex-col bg-slate-200/80 border-l border-slate-200">
              <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-[11px] font-bold text-slate-700">
                <span>
                  {isBn ? 'লাইভ A4 প্রিন্ট প্রিভিউ' : 'Live A4 Portrait Preview'} ({selectedTemplate.name})
                </span>
                <span className="font-mono text-[#0f294d]">{toBnNumber(documentNumber)}</span>
              </div>
              <div className="flex-1 p-2 overflow-hidden">
                <iframe
                  title="HR Document Live A4 Preview"
                  sandbox="allow-same-origin"
                  srcDoc={previewHtml}
                  className="w-full h-full rounded-lg border border-slate-300 bg-white"
                />
              </div>
            </div>
          )}
        </form>

        {/* Footer Action Bar */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 hidden sm:block">
            {isBn
              ? 'ডকুমেন্ট সংরক্ষণের পর সাথে সাথে A4 PDF ডাউনলোড বা প্রিন্ট করা যাবে।'
              : 'Ready for instant A4 PDF download or print immediately after saving.'}
          </div>
          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer"
            >
              {isBn ? 'বাতিল' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-[#0f294d] hover:bg-[#163a6b] text-white shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{isBn ? 'সংরক্ষণ হচ্ছে...' : 'Saving...'}</span>
                </>
              ) : (
                <>
                  {editingDocument ? <Save className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>
                    {editingDocument
                      ? isBn
                        ? 'আপডেট সংরক্ষণ করুন'
                        : 'Save Changes'
                      : HR_DOCUMENT_TYPE_MAP[documentType].requiresApproval
                      ? isBn
                        ? 'অনুমোদনের জন্য দাখিল করুন'
                        : 'Submit for Approval'
                      : isBn
                      ? 'ডকুমেন্ট তৈরি ও সংরক্ষণ'
                      : 'Generate & Save Document'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
