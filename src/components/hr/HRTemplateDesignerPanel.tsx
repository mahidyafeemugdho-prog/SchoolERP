import React, { useEffect, useMemo, useState } from 'react';
import {
  HRTemplateAlignment,
  HRTemplateStyle,
  SchoolProfile,
  Staff,
  StaffDocumentTemplate,
  StaffHRDocument,
  UserRole,
} from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import {
  HR_FONT_OPTIONS,
  buildDefaultHRPayload,
  canDeleteHRDocuments,
  createDefaultHRTemplate,
} from '../../utils/hrDocumentHelpers';
import { buildHRDocumentPreviewHtml } from '../../utils/hrDocumentPdf';
import { deleteHRTemplate, saveHRTemplate } from '../../services/hrDocumentService';
import {
  CheckCircle2,
  CopyPlus,
  LayoutTemplate,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';

interface HRTemplateDesignerPanelProps {
  schoolId: string;
  schoolProfile: Partial<SchoolProfile>;
  templates: StaffDocumentTemplate[];
  sampleStaff?: Staff | null;
  sampleDocument?: StaffHRDocument | null;
  activeRole: UserRole;
  currentUid: string;
}

const THEME_PRESETS: {
  id: HRTemplateStyle;
  labelEn: string;
  labelBn: string;
  primary: string;
  accent: string;
}[] = [
  {
    id: 'classic_navy_gold',
    labelEn: 'Classic Navy & Gold (BD School Default)',
    labelBn: 'ক্লাসিক নেভি ও গোল্ড (ডিফল্ট)',
    primary: '#0f294d',
    accent: '#b45309',
  },
  {
    id: 'modern_institutional',
    labelEn: 'Modern Institutional Blue',
    labelBn: 'মডার্ন প্রাতিষ্ঠানিক ব্লু',
    primary: '#1e3a8a',
    accent: '#0284c7',
  },
  {
    id: 'bordered_certificate',
    labelEn: 'Formal Double-Bordered Certificate',
    labelBn: 'ডাবল-বর্ডার অফিসিয়াল সনদ',
    primary: '#0f294d',
    accent: '#b45309',
  },
  {
    id: 'minimal_official',
    labelEn: 'Minimal Official Slate',
    labelBn: 'মিনিমাল অফিশিয়াল লেটারহেড',
    primary: '#1e293b',
    accent: '#475569',
  },
];

export const HRTemplateDesignerPanel: React.FC<HRTemplateDesignerPanelProps> = ({
  schoolId,
  schoolProfile,
  templates,
  sampleStaff,
  sampleDocument,
  activeRole,
  currentUid,
}) => {
  const { language } = useLanguage();
  const isBn = language === 'bn';

  const [selectedId, setSelectedId] = useState<string>(
    () => (templates.find((t) => t.isDefault) || templates[0] || createDefaultHRTemplate(schoolId)).id
  );
  const [draft, setDraft] = useState<StaffDocumentTemplate>(
    () => templates.find((t) => t.isDefault) || templates[0] || createDefaultHRTemplate(schoolId)
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [statusNote, setStatusNote] = useState<string>('');
  const [errorNote, setErrorNote] = useState<string>('');

  useEffect(() => {
    const matched = templates.find((t) => t.id === selectedId);
    if (matched) {
      setDraft(matched);
    } else if (templates[0]) {
      setSelectedId(templates[0].id);
      setDraft(templates[0]);
    }
  }, [templates, selectedId]);

  const previewDoc: StaffHRDocument = useMemo(() => {
    if (sampleDocument) {
      return {
        ...sampleDocument,
        language: draft.language,
      };
    }
    const fallbackStaff: Staff = sampleStaff || {
      id: 'sample_staff',
      employeeId: 'EMP-101',
      nameEn: 'Md. Mahmudul Hasan',
      nameBn: 'মোঃ মাহমুদুল হাসান',
      gender: 'Male',
      designation: 'Senior Assistant Teacher',
      department: 'Science',
      subject: 'Physics & Mathematics',
      role: 'teacher',
      email: 'mahmudul@school.edu.bd',
      phone: '01711-000000',
      qualification: 'M.Sc, B.Ed',
      joiningDate: '2026-01-15',
      basicSalary: 32000,
      houseRentAllowance: 8000,
      medicalAllowance: 2000,
      otherAllowance: 1000,
      providentFundDeduction: 3200,
      status: 'active',
    };
    const today = new Date().toISOString().split('T')[0];
    return {
      id: 'sample_preview_doc',
      schoolId: schoolId || 'default',
      employeeId: fallbackStaff.id,
      employeeCode: fallbackStaff.employeeId,
      employeeName: fallbackStaff.nameEn,
      documentType: 'appointment_letter',
      documentNumber: 'SSBD/APPT/2026/0001',
      issueDate: today,
      language: draft.language,
      templateId: draft.id,
      approvalStatus: 'Issued',
      createdByUid: currentUid || 'system',
      createdBy: 'Principal',
      createdByRole: activeRole,
      createdAt: today,
      updatedAt: today,
      documentData: buildDefaultHRPayload({
        documentType: 'appointment_letter',
        staff: fallbackStaff,
        school: schoolProfile,
        schoolId,
        language: draft.language,
      }),
      auditLogs: [],
    };
  }, [sampleDocument, sampleStaff, schoolId, draft.language, draft.id, currentUid, activeRole, schoolProfile]);

  const previewHtml = useMemo(
    () => buildHRDocumentPreviewHtml(previewDoc, schoolProfile, draft),
    [previewDoc, schoolProfile, draft]
  );

  const handleCreateNewTemplate = () => {
    const base = createDefaultHRTemplate(schoolId);
    const now = new Date().toISOString();
    const next: StaffDocumentTemplate = {
      ...base,
      id: `tpl_${Date.now()}`,
      name: isBn ? `কাস্টম টেমপ্লেট #${templates.length + 1}` : `Custom Template #${templates.length + 1}`,
      isDefault: false,
      createdByUid: currentUid,
      createdAt: now,
      updatedAt: now,
    };
    setDraft(next);
    setSelectedId(next.id);
    setStatusNote('');
    setErrorNote('');
  };

  const handleDuplicateTemplate = () => {
    const now = new Date().toISOString();
    const copy: StaffDocumentTemplate = {
      ...draft,
      id: `tpl_${Date.now()}`,
      name: `${draft.name} (Copy)`,
      isDefault: false,
      createdByUid: currentUid,
      createdAt: now,
      updatedAt: now,
    };
    setDraft(copy);
    setSelectedId(copy.id);
    setStatusNote('');
    setErrorNote('');
  };

  const handleSaveTemplate = async () => {
    if (!draft.name.trim()) {
      setErrorNote(isBn ? 'টেমপ্লেটের নাম লিখুন।' : 'Template name is required.');
      return;
    }
    setIsSaving(true);
    setStatusNote('');
    setErrorNote('');
    try {
      const saved = await saveHRTemplate(schoolId, {
        ...draft,
        name: draft.name.trim(),
        createdByUid: draft.createdByUid || currentUid,
      });
      setSelectedId(saved.id);
      setStatusNote(isBn ? 'টেমপ্লেট সফলভাবে সংরক্ষিত হয়েছে।' : 'Template saved successfully.');
    } catch (err: any) {
      setErrorNote(err?.message || (isBn ? 'টেমপ্লেট সংরক্ষণ ব্যর্থ হয়েছে।' : 'Failed to save template.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (templates.length <= 1) {
      setErrorNote(
        isBn
          ? 'অন্তত একটি সক্রিয় টেমপ্লেট থাকতে হবে।'
          : 'At least one template must remain active.'
      );
      return;
    }
    setIsDeleting(true);
    setStatusNote('');
    setErrorNote('');
    try {
      await deleteHRTemplate(schoolId, draft.id);
      const remaining = templates.filter((t) => t.id !== draft.id);
      if (remaining[0]) {
        setSelectedId(remaining[0].id);
        setDraft(remaining[0]);
      }
      setStatusNote(isBn ? 'টেমপ্লেট মুছে ফেলা হয়েছে।' : 'Template deleted.');
    } catch (err: any) {
      setErrorNote(err?.message || (isBn ? 'মুছে ফেলা সম্ভব হয়নি।' : 'Delete failed.'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left Config Column */}
      <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="w-4 h-4 text-[#0f294d]" />
            <h3 className="text-sm font-bold text-slate-900">
              {isBn ? 'ডকুমেন্ট টেমপ্লেট ডিজাইনার' : 'Document Template Designer'}
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleDuplicateTemplate}
              title={isBn ? 'কপি তৈরি করুন' : 'Duplicate Template'}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 cursor-pointer"
            >
              <CopyPlus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCreateNewTemplate}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isBn ? 'নতুন' : 'New'}</span>
            </button>
          </div>
        </div>

        {/* Saved Templates Selector */}
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">
            {isBn ? 'সংরক্ষিত টেমপ্লেট নির্বাচন করুন' : 'Select Saved Template'}
          </label>
          <select
            value={selectedId}
            onChange={(e) => {
              const found = templates.find((t) => t.id === e.target.value);
              if (found) {
                setSelectedId(found.id);
                setDraft(found);
              }
            }}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900"
          >
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} {tpl.isDefault ? (isBn ? '(ডিফল্ট ★)' : '(Default ★)') : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'টেমপ্লেটের নাম' : 'Template Name'}
            </label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'লেটারহেড থিম' : 'Letterhead Theme Style'}
            </label>
            <select
              value={draft.styleTheme}
              onChange={(e) => {
                const styleTheme = e.target.value as HRTemplateStyle;
                const preset = THEME_PRESETS.find((t) => t.id === styleTheme);
                setDraft((p) => ({
                  ...p,
                  styleTheme,
                  primaryColor: preset?.primary || p.primaryColor,
                  accentColor: preset?.accent || p.accentColor,
                }));
              }}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              {THEME_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {isBn ? preset.labelBn : preset.labelEn}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'প্রাথমিক রং (Primary)' : 'Primary Color (Navy)'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.primaryColor}
                onChange={(e) => setDraft((p) => ({ ...p, primaryColor: e.target.value }))}
                className="w-9 h-8 rounded border border-slate-200 cursor-pointer"
              />
              <input
                type="text"
                value={draft.primaryColor}
                onChange={(e) => setDraft((p) => ({ ...p, primaryColor: e.target.value }))}
                className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'অ্যাকসেন্ট রং (Gold Accent)' : 'Accent Color (Gold)'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.accentColor}
                onChange={(e) => setDraft((p) => ({ ...p, accentColor: e.target.value }))}
                className="w-9 h-8 rounded border border-slate-200 cursor-pointer"
              />
              <input
                type="text"
                value={draft.accentColor}
                onChange={(e) => setDraft((p) => ({ ...p, accentColor: e.target.value }))}
                className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'ডিফল্ট ভাষা' : 'Default Language'}
            </label>
            <select
              value={draft.language}
              onChange={(e) => setDraft((p) => ({ ...p, language: e.target.value as 'bn' | 'en' }))}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="bn">বাংলা (Bangla)</option>
              <option value="en">English</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'ফন্ট নির্বাচন' : 'Font Family'}
            </label>
            <select
              value={draft.fontFamily}
              onChange={(e) => setDraft((p) => ({ ...p, fontFamily: e.target.value }))}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              {HR_FONT_OPTIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'লোগো অবস্থান' : 'Logo Position'}
            </label>
            <select
              value={draft.logoPosition}
              onChange={(e) =>
                setDraft((p) => ({ ...p, logoPosition: e.target.value as HRTemplateAlignment }))
              }
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="left">{isBn ? 'বাম (Left)' : 'Left'}</option>
              <option value="center">{isBn ? 'মাঝখান (Center)' : 'Center'}</option>
              <option value="right">{isBn ? 'ডান (Right)' : 'Right'}</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'স্বাক্ষর অবস্থান' : 'Signature Position'}
            </label>
            <select
              value={draft.signaturePosition}
              onChange={(e) =>
                setDraft((p) => ({ ...p, signaturePosition: e.target.value as HRTemplateAlignment }))
              }
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="right">{isBn ? 'ডান (Right)' : 'Right'}</option>
              <option value="center">{isBn ? 'মাঝখান (Center)' : 'Center'}</option>
              <option value="left">{isBn ? 'বাম (Left)' : 'Left'}</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'সিলমোহর অবস্থান' : 'Seal Position'}
            </label>
            <select
              value={draft.sealPosition}
              onChange={(e) =>
                setDraft((p) => ({ ...p, sealPosition: e.target.value as HRTemplateAlignment }))
              }
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="left">{isBn ? 'বাম (Left)' : 'Left'}</option>
              <option value="center">{isBn ? 'মাঝখান (Center)' : 'Center'}</option>
              <option value="right">{isBn ? 'ডান (Right)' : 'Right'}</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'সিলমোহর লেবেল' : 'Seal Stamp Text'}
            </label>
            <input
              type="text"
              value={draft.sealLabel || ''}
              onChange={(e) => setDraft((p) => ({ ...p, sealLabel: e.target.value }))}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
            />
          </div>
        </div>

        {/* Header & Footer Text */}
        <div className="space-y-2.5 pt-1">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'হেডার সাব-টাইটেল' : 'Letterhead Subtitle'}
            </label>
            <input
              type="text"
              value={draft.headerSubtitle || ''}
              onChange={(e) => setDraft((p) => ({ ...p, headerSubtitle: e.target.value }))}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {isBn ? 'ফুটার টেক্সট' : 'Footer Note Text'}
            </label>
            <input
              type="text"
              value={draft.footerText || ''}
              onChange={(e) => setDraft((p) => ({ ...p, footerText: e.target.value }))}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
            />
          </div>
        </div>

        {/* A4 Margin Settings (mm) */}
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <div className="text-[11px] font-bold text-slate-700">
            {isBn ? 'A4 পেজ মার্জিন (মিলিমিটার / mm)' : 'A4 Page Margins (mm)'}
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] text-slate-500">Top</label>
              <input
                type="number"
                min={6}
                max={30}
                value={draft.marginTopMm}
                onChange={(e) => setDraft((p) => ({ ...p, marginTopMm: Number(e.target.value) || 14 }))}
                className="w-full px-2 py-1 text-xs tabular-nums border border-slate-200 rounded bg-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500">Right</label>
              <input
                type="number"
                min={6}
                max={30}
                value={draft.marginRightMm}
                onChange={(e) => setDraft((p) => ({ ...p, marginRightMm: Number(e.target.value) || 15 }))}
                className="w-full px-2 py-1 text-xs tabular-nums border border-slate-200 rounded bg-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500">Bottom</label>
              <input
                type="number"
                min={6}
                max={30}
                value={draft.marginBottomMm}
                onChange={(e) => setDraft((p) => ({ ...p, marginBottomMm: Number(e.target.value) || 14 }))}
                className="w-full px-2 py-1 text-xs tabular-nums border border-slate-200 rounded bg-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500">Left</label>
              <input
                type="number"
                min={6}
                max={30}
                value={draft.marginLeftMm}
                onChange={(e) => setDraft((p) => ({ ...p, marginLeftMm: Number(e.target.value) || 15 }))}
                className="w-full px-2 py-1 text-xs tabular-nums border border-slate-200 rounded bg-white"
              />
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.showLogo}
              onChange={(e) => setDraft((p) => ({ ...p, showLogo: e.target.checked }))}
              className="rounded border-slate-300"
            />
            <span>{isBn ? 'লোগো দেখান' : 'Show School Logo'}</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.showHeader}
              onChange={(e) => setDraft((p) => ({ ...p, showHeader: e.target.checked }))}
              className="rounded border-slate-300"
            />
            <span>{isBn ? 'হেডার দেখান' : 'Show Header'}</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.showFooter}
              onChange={(e) => setDraft((p) => ({ ...p, showFooter: e.target.checked }))}
              className="rounded border-slate-300"
            />
            <span>{isBn ? 'ফুটার দেখান' : 'Show Footer'}</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.showSeal}
              onChange={(e) => setDraft((p) => ({ ...p, showSeal: e.target.checked }))}
              className="rounded border-slate-300"
            />
            <span>{isBn ? 'সিলমোহর দেখান' : 'Show Seal'}</span>
          </label>
          <label className="col-span-2 inline-flex items-center gap-2 font-semibold text-[#0f294d] cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={Boolean(draft.isDefault)}
              onChange={(e) => setDraft((p) => ({ ...p, isDefault: e.target.checked }))}
              className="rounded border-slate-300"
            />
            <span>{isBn ? 'ডিফল্ট টেমপ্লেট হিসেবে সেট করুন' : 'Set as Default School HR Template'}</span>
          </label>
        </div>

        {statusNote && (
          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{statusNote}</span>
          </div>
        )}
        {errorNote && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
            {errorNote}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200">
          {canDeleteHRDocuments(activeRole) && templates.length > 1 ? (
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => void handleDeleteTemplate()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-rose-200 text-rose-700 hover:bg-rose-50 cursor-pointer disabled:opacity-60"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isBn ? 'মুছে ফেলুন' : 'Delete'}</span>
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSaveTemplate()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#0f294d] hover:bg-[#163a6b] text-white cursor-pointer disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isBn ? 'টেমপ্লেট সংরক্ষণ করুন' : 'Save Template'}</span>
          </button>
        </div>
      </div>

      {/* Right Live A4 Portrait Preview */}
      <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden min-h-[680px]">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700">
          <span>
            {isBn ? 'লাইভ A4 পোর্ট্রেট প্রিভিউ' : 'Live A4 Portrait Letterhead Preview'}
          </span>
          <span className="text-[11px] font-mono text-[#0f294d]">
            {draft.marginTopMm}/{draft.marginRightMm}/{draft.marginBottomMm}/{draft.marginLeftMm} mm
          </span>
        </div>
        <div className="flex-1 p-3 bg-slate-200/75">
          <iframe
            title="Template Designer A4 Live Preview"
            sandbox="allow-same-origin"
            srcDoc={previewHtml}
            className="w-full h-full min-h-[620px] rounded-xl border border-slate-300 bg-white"
          />
        </div>
      </div>
    </div>
  );
};
