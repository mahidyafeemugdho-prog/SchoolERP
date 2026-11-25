import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  HRDocumentType,
  SchoolProfile,
  StaffDocumentTemplate,
  StaffHRDocument,
} from '../types';
import { formatRecordDate } from './admissionPrintHelper';
import { escapeHtml, sanitizeSafeMediaUrl } from './htmlSanitizer';
import {
  HR_DOCUMENT_TYPE_MAP,
  createDefaultHRTemplate,
  toBanglaDigits,
} from './hrDocumentHelpers';
import { amountInWords } from './i18n';

function sanitizeCssColor(color: string | undefined, fallback: string): string {
  const clean = (color || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(clean)) return clean;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/.test(clean)) {
    return clean;
  }
  return fallback;
}

function formatMoney(amount: number | undefined, lang: 'bn' | 'en'): string {
  const num = Number(amount || 0);
  const formatted = Number.isFinite(num) ? num.toLocaleString('en-IN') : '0';
  return `৳ ${lang === 'bn' ? toBanglaDigits(formatted) : formatted}`;
}

function formatMultiline(text: string | undefined): string {
  const safe = escapeHtml(text || '');
  return safe.replace(/\r?\n/g, '<br/>');
}

function getThemeColors(template: StaffDocumentTemplate) {
  const defaultNavy = sanitizeCssColor(template.primaryColor, '#0f294d');
  const defaultGold = sanitizeCssColor(template.accentColor, '#b45309');

  switch (template.styleTheme) {
    case 'modern_institutional':
      return {
        primary: sanitizeCssColor(template.primaryColor, '#1e3a8a'),
        accent: sanitizeCssColor(template.accentColor, '#0284c7'),
        bgTint: '#f8fafc',
        borderStyle: '1.5px solid',
      };
    case 'minimal_official':
      return {
        primary: sanitizeCssColor(template.primaryColor, '#1e293b'),
        accent: sanitizeCssColor(template.accentColor, '#475569'),
        bgTint: '#ffffff',
        borderStyle: '1px solid',
      };
    case 'bordered_certificate':
      return {
        primary: sanitizeCssColor(template.primaryColor, '#0f294d'),
        accent: sanitizeCssColor(template.accentColor, '#b45309'),
        bgTint: '#fffdf7',
        borderStyle: '3px double',
      };
    case 'classic_navy_gold':
    default:
      return {
        primary: defaultNavy,
        accent: defaultGold,
        bgTint: '#ffffff',
        borderStyle: '2px solid',
      };
  }
}

export function buildHRDocumentStyles(template: StaffDocumentTemplate): string {
  const colors = getThemeColors(template);
  const marginTop = Math.max(6, Math.min(30, Number(template.marginTopMm ?? 14)));
  const marginRight = Math.max(6, Math.min(30, Number(template.marginRightMm ?? 15)));
  const marginBottom = Math.max(6, Math.min(30, Number(template.marginBottomMm ?? 14)));
  const marginLeft = Math.max(6, Math.min(30, Number(template.marginLeftMm ?? 15)));
  const fontFamily = template.fontFamily || "'Hind Siliguri', 'Noto Sans Bengali', Arial, sans-serif";

  return `
    @page { size: A4 portrait; margin: ${marginTop}mm ${marginRight}mm ${marginBottom}mm ${marginLeft}mm; }
    .hr-print-root {
      background: #ffffff;
      color: #0f172a;
      font-family: ${fontFamily};
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .hr-doc-sheet {
      width: 100%;
      max-width: 794px;
      min-height: 1060px;
      margin: 0 auto;
      background: ${colors.bgTint};
      color: #0f172a;
      box-sizing: border-box;
      padding: ${marginTop}mm ${marginRight}mm ${marginBottom}mm ${marginLeft}mm;
      border: ${colors.borderStyle} ${colors.primary};
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      font-size: 13px;
      line-height: 1.62;
    }
    .hr-inner-gold-frame {
      position: absolute;
      inset: 5px;
      border: 1px solid ${colors.accent};
      pointer-events: none;
    }
    .hr-header {
      border-bottom: 2.5px solid ${colors.primary};
      padding-bottom: 12px;
      margin-bottom: 14px;
      position: relative;
      z-index: 1;
    }
    .hr-header-flex {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .hr-header-center {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 6px;
    }
    .hr-header-right {
      display: flex;
      flex-direction: row-reverse;
      align-items: center;
      gap: 14px;
      text-align: right;
    }
    .hr-logo-box {
      width: 68px;
      height: 68px;
      object-fit: contain;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      padding: 3px;
      flex-shrink: 0;
    }
    .hr-logo-fallback {
      width: 68px;
      height: 68px;
      border-radius: 8px;
      background: ${colors.primary};
      color: #ffffff;
      font-size: 24px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: 2px solid ${colors.accent};
    }
    .hr-school-title {
      margin: 0;
      font-size: 21px;
      font-weight: 800;
      color: ${colors.primary};
      line-height: 1.25;
    }
    .hr-school-sub {
      margin: 2px 0 0 0;
      font-size: 13px;
      font-weight: 700;
      color: ${colors.accent};
    }
    .hr-school-meta {
      margin: 4px 0 0 0;
      font-size: 11px;
      color: #334155;
    }
    .hr-meta-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: #1e293b;
      padding: 6px 10px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      margin-bottom: 14px;
      position: relative;
      z-index: 1;
    }
    .hr-doc-banner {
      text-align: center;
      margin: 6px 0 16px 0;
      position: relative;
      z-index: 1;
    }
    .hr-doc-banner-pill {
      display: inline-block;
      padding: 6px 22px;
      background: ${colors.primary};
      color: #ffffff;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.4px;
      border-radius: 4px;
      border-bottom: 3px solid ${colors.accent};
    }
    .hr-body {
      flex: 1;
      position: relative;
      z-index: 1;
    }
    .hr-emp-header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 14px;
    }
    .hr-emp-photo {
      width: 88px;
      height: 106px;
      object-fit: cover;
      border: 2px solid ${colors.primary};
      border-radius: 6px;
      background: #ffffff;
      flex-shrink: 0;
    }
    .hr-info-table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0 14px 0;
      font-size: 12.5px;
    }
    .hr-info-table th,
    .hr-info-table td {
      border: 1px solid #cbd5e1;
      padding: 6px 10px;
      text-align: left;
      vertical-align: top;
    }
    .hr-info-table th {
      background: #f1f5f9;
      color: ${colors.primary};
      font-weight: 700;
      width: 28%;
    }
    .hr-salary-table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0 14px 0;
      font-size: 12px;
    }
    .hr-salary-table th,
    .hr-salary-table td {
      border: 1px solid #cbd5e1;
      padding: 6px 10px;
    }
    .hr-salary-table th {
      background: ${colors.primary};
      color: #ffffff;
      font-weight: 700;
      text-align: left;
    }
    .hr-num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .hr-section-box {
      margin: 12px 0;
      padding: 10px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
    }
    .hr-section-title {
      margin: 0 0 6px 0;
      font-size: 12.5px;
      font-weight: 800;
      color: ${colors.primary};
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 3px;
    }
    .hr-status-stamp {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      border: 1.5px solid;
    }
    .hr-status-approved { color: #166534; background: #dcfce7; border-color: #16a34a; }
    .hr-status-pending { color: #92400e; background: #fef3c7; border-color: #d97706; }
    .hr-status-rejected { color: #991b1b; background: #fee2e2; border-color: #dc2626; }
    .hr-status-issued { color: #1e3a8a; background: #dbeafe; border-color: #2563eb; }
    .hr-sign-area {
      margin-top: 26px;
      padding-top: 12px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 20px;
      position: relative;
      z-index: 1;
    }
    .hr-sign-col {
      min-width: 170px;
      text-align: center;
    }
    .hr-sign-line {
      border-top: 1.5px solid #334155;
      padding-top: 5px;
      margin-top: 6px;
      font-size: 11.5px;
      font-weight: 700;
      color: #0f172a;
    }
    .hr-seal-circle {
      width: 84px;
      height: 84px;
      border-radius: 9999px;
      border: 2px dashed ${colors.primary};
      color: ${colors.primary};
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 800;
      text-align: center;
      padding: 6px;
      line-height: 1.2;
      background: rgba(255, 255, 255, 0.85);
      transform: rotate(-8deg);
    }
    .hr-footer-bar {
      margin-top: 18px;
      padding-top: 8px;
      border-top: 1px solid #cbd5e1;
      text-align: center;
      font-size: 10.5px;
      color: #64748b;
      position: relative;
      z-index: 1;
    }
  `;
}

function buildBodyByType(
  doc: StaffHRDocument,
  school: Partial<SchoolProfile>,
  lang: 'bn' | 'en'
): string {
  const p = doc.documentData;
  const isBn = lang === 'bn';
  const schoolDisplay = isBn
    ? school.nameBn || school.nameEn || 'Smart School'
    : school.nameEn || school.nameBn || 'Smart School';

  const empDisplay = isBn
    ? p.employeeNameBn || p.employeeNameEn || doc.employeeName
    : p.employeeNameEn || p.employeeNameBn || doc.employeeName;

  const safeEmpName = escapeHtml(empDisplay);
  const safeEmpCode = escapeHtml(p.employeeCode || doc.employeeCode);
  const safeDesig = escapeHtml(p.designation || '-');
  const safeDept = escapeHtml(p.department || '-');
  const safeSubject = escapeHtml(p.subject || '');
  const safePhone = escapeHtml(p.phone || '-');
  const safeEmail = escapeHtml(p.email || '-');
  const safeAddress = escapeHtml(p.permanentAddress || '-');
  const safePhoto = sanitizeSafeMediaUrl(p.employeePhotoUrl);

  const photoHtml =
    p.includeEmployeePhoto && safePhoto
      ? `<img src="${escapeHtml(safePhoto)}" alt="${safeEmpName}" class="hr-emp-photo" />`
      : '';

  const statusBadgeClass =
    doc.approvalStatus === 'Approved'
      ? 'hr-status-approved'
      : doc.approvalStatus === 'Rejected'
      ? 'hr-status-rejected'
      : doc.approvalStatus === 'Pending'
      ? 'hr-status-pending'
      : 'hr-status-issued';

  const statusLabel = isBn
    ? doc.approvalStatus === 'Approved'
      ? 'অনুমোদিত (Approved)'
      : doc.approvalStatus === 'Rejected'
      ? 'বাতিলকৃত (Rejected)'
      : doc.approvalStatus === 'Pending'
      ? 'অনুমোদন অপেক্ষমাণ (Pending)'
      : 'ইস্যুকৃত (Issued)'
    : doc.approvalStatus;

  const recipientBlock = `
    <div class="hr-emp-header-row">
      <div style="flex: 1;">
        <div style="font-size:13px;font-weight:700;color:#0f172a;">
          ${isBn ? 'বরাবর / প্রাপকঃ' : 'To,'}
        </div>
        <div style="font-size:15px;font-weight:800;color:#0f294d;margin-top:2px;">${safeEmpName}</div>
        <div style="font-size:12px;color:#334155;">
          ${isBn ? 'পদবি:' : 'Designation:'} <strong>${safeDesig}</strong> · ${isBn ? 'বিভাগ:' : 'Department:'} <strong>${safeDept}</strong>
          ${safeSubject ? ` · ${isBn ? 'বিষয়:' : 'Subject:'} <strong>${safeSubject}</strong>` : ''}
        </div>
        <div style="font-size:11.5px;color:#475569;margin-top:2px;">
          ${isBn ? 'স্টাফ আইডি:' : 'Staff ID:'} <strong>${safeEmpCode}</strong> · ${isBn ? 'মোবাইল:' : 'Phone:'} ${safePhone}
          ${p.email ? ` · ${safeEmail}` : ''}
        </div>
        ${p.permanentAddress ? `<div style="font-size:11.5px;color:#475569;">${isBn ? 'ঠিকানা:' : 'Address:'} ${safeAddress}</div>` : ''}
      </div>
      ${photoHtml}
    </div>
  `;

  switch (doc.documentType) {
    case 'appointment_letter': {
      const sb = p.salaryBreakdown;
      const netSalary = sb?.netSalary ?? p.monthlySalary ?? 0;
      return `
        ${recipientBlock}
        <p style="margin:0 0 10px 0;">
          ${
            isBn
              ? `<strong>বিষয়ঃ ${escapeHtml(p.designation)} পদে নিয়োগপত্র।</strong><br/>জনাব/জনাবা ${safeEmpName}, আনন্দের সাথে জানানো যাচ্ছে যে, <strong>${escapeHtml(schoolDisplay)}</strong> কর্তৃপক্ষ আপনার যোগ্যতা ও সাক্ষাৎকার মূল্যায়নের ভিত্তিতে আপনাকে নিম্নবর্ণিত শর্তাবলী সাপেক্ষে <strong>${safeDesig}</strong> পদে নিয়োগ প্রদান করিতেছে।`
              : `<strong>Subject: Letter of Appointment for the post of ${safeDesig}.</strong><br/>Dear ${safeEmpName}, on behalf of <strong>${escapeHtml(schoolDisplay)}</strong>, we are pleased to appoint you to the position of <strong>${safeDesig}</strong> under the following employment terms and conditions:`
          }
        </p>

        <table class="hr-info-table">
          <tr>
            <th>${isBn ? 'পদবি ও বিভাগ' : 'Designation & Department'}</th>
            <td>${safeDesig} (${safeDept})${safeSubject ? ` — ${isBn ? 'বিষয়ঃ' : 'Subject:'} ${safeSubject}` : ''}</td>
          </tr>
          <tr>
            <th>${isBn ? 'চাকুরির ধরন' : 'Employment Type'}</th>
            <td>${escapeHtml(p.employmentType || 'Full-Time Permanent')}</td>
          </tr>
          <tr>
            <th>${isBn ? 'যোগদানের তারিখ' : 'Joining Date'}</th>
            <td><strong>${escapeHtml(formatRecordDate(p.joiningDate, lang))}</strong></td>
          </tr>
          <tr>
            <th>${isBn ? 'শিক্ষানবিশকাল' : 'Probation Period'}</th>
            <td>${escapeHtml(p.probationPeriod || '-')}</td>
          </tr>
          <tr>
            <th>${isBn ? 'কর্মঘণ্টা' : 'Working Hours'}</th>
            <td>${escapeHtml(p.workingHours || '-')}</td>
          </tr>
          <tr>
            <th>${isBn ? 'অব্যাহতি নোটিশকাল' : 'Notice Period'}</th>
            <td>${escapeHtml(p.noticePeriod || '-')}</td>
          </tr>
        </table>

        <table class="hr-salary-table">
          <thead>
            <tr>
              <th>${isBn ? 'মাসিক বেতন কাঠামো (Salary Breakdown)' : 'Monthly Salary Breakdown'}</th>
              <th class="hr-num">${isBn ? 'পরিমাণ (টাকা)' : 'Amount (BDT)'}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${isBn ? 'মূল বেতন (Basic Salary)' : 'Basic Salary'}</td>
              <td class="hr-num">${escapeHtml(formatMoney(sb?.basicSalary ?? netSalary, lang))}</td>
            </tr>
            <tr>
              <td>${isBn ? 'বাড়ি ভাড়া ভাতা (House Rent Allowance)' : 'House Rent Allowance'}</td>
              <td class="hr-num">${escapeHtml(formatMoney(sb?.houseRentAllowance ?? 0, lang))}</td>
            </tr>
            <tr>
              <td>${isBn ? 'চিকিৎসা ভাতা (Medical Allowance)' : 'Medical Allowance'}</td>
              <td class="hr-num">${escapeHtml(formatMoney(sb?.medicalAllowance ?? 0, lang))}</td>
            </tr>
            <tr>
              <td>${isBn ? 'অন্যান্য ভাতা (Other Allowance)' : 'Other Allowance'}</td>
              <td class="hr-num">${escapeHtml(formatMoney(sb?.otherAllowance ?? 0, lang))}</td>
            </tr>
            <tr>
              <td>${isBn ? 'ভবিষ্যৎ তহবিল কর্তন (PF Deduction)' : 'Provident Fund Deduction (-)'}</td>
              <td class="hr-num">- ${escapeHtml(formatMoney(sb?.providentFundDeduction ?? 0, lang))}</td>
            </tr>
            <tr style="background:#f1f5f9;">
              <td><strong>${isBn ? 'সর্বমোট নিট মাসিক বেতন (Net Monthly Salary)' : 'Net Monthly Payable Salary'}</strong></td>
              <td class="hr-num" style="color:#0f294d;font-size:13px;"><strong>${escapeHtml(formatMoney(netSalary, lang))}</strong></td>
            </tr>
          </tbody>
        </table>
        <div style="font-size:11.5px;color:#334155;margin:-6px 0 10px 0;">
          <strong>${isBn ? 'কথায়:' : 'In Words:'}</strong> ${escapeHtml(amountInWords(netSalary, lang))}
        </div>

        ${
          p.jobResponsibilities
            ? `<div class="hr-section-box">
                <h4 class="hr-section-title">${isBn ? 'দায়িত্ব ও কর্তব্যসমূহ (Job Responsibilities)' : 'Job Responsibilities'}</h4>
                <div>${formatMultiline(p.jobResponsibilities)}</div>
              </div>`
            : ''
        }

        ${
          p.termsAndConditions
            ? `<div class="hr-section-box">
                <h4 class="hr-section-title">${isBn ? 'চাকুরির শর্তাবলী (Terms & Conditions)' : 'Terms & Conditions'}</h4>
                <div>${formatMultiline(p.termsAndConditions)}</div>
              </div>`
            : ''
        }
      `;
    }

    case 'joining_letter':
      return `
        <div style="margin-bottom:12px;">
          <div><strong>${isBn ? 'বরাবর,' : 'To,'}</strong></div>
          <div>${escapeHtml(p.principalOrChairmanName || (isBn ? 'প্রধান শিক্ষক / অধ্যক্ষ' : 'The Principal / Headmaster'))}</div>
          <div>${escapeHtml(schoolDisplay)}</div>
        </div>
        <p style="margin:0 0 10px 0;">
          <strong>${isBn ? 'বিষয়ঃ যোগদানপত্র (Joining Letter) দাখিল প্রসঙ্গে।' : 'Subject: Submission of Joining Report.'}</strong>
        </p>
        <p style="margin:0 0 12px 0;">
          ${
            isBn
              ? `মহোদয়,<br/>যথাবিহীত সম্মানপূর্বক নিবেদন এই যে, আপনার প্রতিষ্ঠানের নিয়োগপত্র সূত্র নং <strong>${escapeHtml(p.appointmentRefNumber || 'N/A')}</strong> মোতাবেক আমি <strong>${safeEmpName}</strong> (আইডি: ${safeEmpCode}) অদ্য <strong>${escapeHtml(formatRecordDate(p.joiningDate, lang))}</strong> তারিখে <strong>${safeDesig}</strong> (${safeDept}) পদে সানন্দে যোগদান করিলাম।`
              : `Respected Sir/Madam,<br/>With reference to Appointment Letter Ref. No. <strong>${escapeHtml(p.appointmentRefNumber || 'N/A')}</strong>, I, <strong>${safeEmpName}</strong> (Staff ID: ${safeEmpCode}), hereby formally join my duties as <strong>${safeDesig}</strong> in the <strong>${safeDept}</strong> department on <strong>${escapeHtml(formatRecordDate(p.joiningDate, lang))}</strong>.`
          }
        </p>
        <table class="hr-info-table">
          <tr><th>${isBn ? 'কর্মকর্তা / শিক্ষকের নাম' : 'Employee Name'}</th><td>${safeEmpName}</td></tr>
          <tr><th>${isBn ? 'স্টাফ আইডি' : 'Staff ID'}</th><td>${safeEmpCode}</td></tr>
          <tr><th>${isBn ? 'পদবি ও বিভাগ' : 'Designation & Department'}</th><td>${safeDesig} · ${safeDept}</td></tr>
          <tr><th>${isBn ? 'নিয়োগপত্র সূত্র নম্বর' : 'Appointment Ref. No.'}</th><td>${escapeHtml(p.appointmentRefNumber || '-')}</td></tr>
          <tr><th>${isBn ? 'যোগদানের তারিখ' : 'Official Joining Date'}</th><td><strong>${escapeHtml(formatRecordDate(p.joiningDate, lang))}</strong></td></tr>
          <tr><th>${isBn ? 'দাখিলের তারিখ' : 'Submitted Date'}</th><td>${escapeHtml(formatRecordDate(p.submittedDate || doc.issueDate, lang))}</td></tr>
          <tr><th>${isBn ? 'অনুমোদনের অবস্থা' : 'Approval Status'}</th><td><span class="hr-status-stamp ${statusBadgeClass}">${escapeHtml(statusLabel)}</span></td></tr>
        </table>
        ${
          p.joiningRemarks
            ? `<div class="hr-section-box"><h4 class="hr-section-title">${isBn ? 'যোগদান মন্তব্য' : 'Joining Remarks'}</h4><div>${formatMultiline(p.joiningRemarks)}</div></div>`
            : ''
        }
        ${
          p.employeeSignature
            ? `<div style="margin-top:10px;font-size:12px;"><strong>${isBn ? 'আবেদনকারীর স্বাক্ষর:' : 'Employee Signature:'}</strong> <span style="font-style:italic;font-weight:700;">${escapeHtml(p.employeeSignature)}</span></div>`
            : ''
        }
      `;

    case 'resignation_letter':
      return `
        <div style="margin-bottom:12px;">
          <div><strong>${isBn ? 'বরাবর,' : 'To,'}</strong></div>
          <div>${escapeHtml(p.principalOrChairmanName || (isBn ? 'প্রধান শিক্ষক / অধ্যক্ষ' : 'The Principal / Headmaster'))}</div>
          <div>${escapeHtml(schoolDisplay)}</div>
        </div>
        <p style="margin:0 0 10px 0;">
          <strong>${isBn ? 'বিষয়ঃ চাকুরি হইতে ইস্তফা / পদত্যাগপত্র আবেদন।' : 'Subject: Letter of Resignation.'}</strong>
        </p>
        <p style="margin:0 0 12px 0;">
          ${
            isBn
              ? `মহোদয়,<br/>বিনীত নিবেদন এই যে, আমি <strong>${safeEmpName}</strong> (আইডি: ${safeEmpCode}), অত্র প্রতিষ্ঠানের <strong>${safeDesig}</strong> (${safeDept}) পদে কর্মরত আছি। নিম্নবর্ণিত কারণে আগামী <strong>${escapeHtml(formatRecordDate(p.proposedLastWorkingDate, lang))}</strong> তারিখ হইতে আমার পদ থেকে অব্যাহতি / পদত্যাগ গ্রহণ করার জন্য বিনীত অনুরোধ জানাচ্ছি।`
              : `Dear Sir/Madam,<br/>Please accept this letter as formal notification that I, <strong>${safeEmpName}</strong> (Staff ID: ${safeEmpCode}), am resigning from my position as <strong>${safeDesig}</strong> in the <strong>${safeDept}</strong> department, with my proposed last working day on <strong>${escapeHtml(formatRecordDate(p.proposedLastWorkingDate, lang))}</strong>.`
          }
        </p>
        <table class="hr-info-table">
          <tr><th>${isBn ? 'আবেদনের তারিখ' : 'Application Date'}</th><td>${escapeHtml(formatRecordDate(p.applicationDate || doc.issueDate, lang))}</td></tr>
          <tr><th>${isBn ? 'প্রস্তাবিত শেষ কর্মদিবস' : 'Proposed Last Working Date'}</th><td><strong>${escapeHtml(formatRecordDate(p.proposedLastWorkingDate, lang))}</strong></td></tr>
          <tr><th>${isBn ? 'নোটিশ সময়কাল' : 'Notice Period'}</th><td>${escapeHtml(p.noticePeriod || '-')}</td></tr>
          <tr><th>${isBn ? 'পদত্যাগের কারণ' : 'Resignation Reason'}</th><td>${formatMultiline(p.resignationReason)}</td></tr>
          <tr><th>${isBn ? 'অনুমোদন অবস্থা' : 'Approval Status'}</th><td><span class="hr-status-stamp ${statusBadgeClass}">${escapeHtml(statusLabel)}</span></td></tr>
          ${p.principalRemarks ? `<tr><th>${isBn ? 'অধ্যক্ষ / প্রধান শিক্ষকের মন্তব্য' : 'Principal Remarks'}</th><td>${formatMultiline(p.principalRemarks)}</td></tr>` : ''}
        </table>
        ${
          p.employeeSignature
            ? `<div style="margin-top:10px;font-size:12px;"><strong>${isBn ? 'আবেদনকারীর স্বাক্ষর:' : 'Employee Signature:'}</strong> <span style="font-style:italic;font-weight:700;">${escapeHtml(p.employeeSignature)}</span></div>`
            : ''
        }
      `;

    case 'resignation_acceptance':
      return `
        ${recipientBlock}
        <p style="margin:0 0 12px 0;">
          <strong>${isBn ? 'বিষয়ঃ পদত্যাগপত্র গ্রহণ ও অব্যাহতি অনুমোদন প্রসঙ্গে।' : 'Subject: Acceptance of Resignation Letter.'}</strong>
        </p>
        <p style="margin:0 0 12px 0;">
          ${
            isBn
              ? `জনাব/জনাবা ${safeEmpName}, আপনার দাখিলকৃত পদত্যাগপত্র কর্তৃপক্ষ কর্তৃক পর্যালোচনা ও অনুমোদনক্রমে অদ্য <strong>${escapeHtml(formatRecordDate(p.acceptanceDate || doc.issueDate, lang))}</strong> তারিখে গৃহীত হলো। আপনার চাকুরির শেষ কর্মদিবস হিসেবে <strong>${escapeHtml(formatRecordDate(p.lastWorkingDate, lang))}</strong> তারিখ নির্ধারিত হলো।`
              : `Dear ${safeEmpName}, with reference to your resignation application, management hereby formally accepts your resignation effective from <strong>${escapeHtml(formatRecordDate(p.lastWorkingDate, lang))}</strong> as your final working day.`
          }
        </p>
        <table class="hr-info-table">
          <tr><th>${isBn ? 'পদত্যাগ গ্রহণের তারিখ' : 'Acceptance Date'}</th><td>${escapeHtml(formatRecordDate(p.acceptanceDate || doc.issueDate, lang))}</td></tr>
          <tr><th>${isBn ? 'কার্যকর শেষ কর্মদিবস' : 'Effective Last Working Date'}</th><td><strong>${escapeHtml(formatRecordDate(p.lastWorkingDate, lang))}</strong></td></tr>
          <tr><th>${isBn ? 'কর্তৃপক্ষের মন্তব্য ও ছাড়পত্র নির্দেশনা' : 'Principal Remarks / Handover Notes'}</th><td>${formatMultiline(p.principalRemarks || p.customBodyText)}</td></tr>
        </table>
      `;

    case 'release_letter':
    case 'experience_certificate': {
      const isExp = doc.documentType === 'experience_certificate';
      const durationStr = isBn
        ? p.employmentDurationBn || p.employmentDurationEn || '-'
        : p.employmentDurationEn || p.employmentDurationBn || '-';
      return `
        ${recipientBlock}
        <p style="margin:0 0 12px 0;text-align:center;font-size:14px;font-weight:800;color:#0f294d;text-decoration:underline;">
          ${
            isBn
              ? isExp
                ? 'সংশ্লিষ্ট সকলের অবগতির জন্য প্রত্যয়নপত্র (অভিজ্ঞতার সনদ)'
                : 'দায়িত্ব হইতে অব্যাহতি পত্র (Release Order)'
              : isExp
              ? 'TO WHOM IT MAY CONCERN'
              : 'OFFICIAL RELEASE LETTER'
          }
        </p>
        <p style="margin:0 0 14px 0;">
          ${
            isBn
              ? `এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, জনাব/জনাবা <strong>${safeEmpName}</strong> (স্টাফ আইডি: <strong>${safeEmpCode}</strong>), পিতা/স্বামী/বিভাগ: <strong>${safeDept}</strong>, অত্র <strong>${escapeHtml(schoolDisplay)}</strong>-এ <strong>${escapeHtml(formatRecordDate(p.employmentStartDate, lang))}</strong> তারিখ হইতে <strong>${escapeHtml(formatRecordDate(p.lastWorkingDate, lang))}</strong> তারিখ পর্যন্ত (মোট <strong>${escapeHtml(durationStr)}</strong>) <strong>${safeDesig}</strong> পদে অত্যন্ত নিষ্ঠা ও সততার সাথে দায়িত্ব পালন করিয়াছেন। ${
                  isExp
                    ? 'তাঁহার কর্মদক্ষতা ও আচরণ প্রশংসনীয়।'
                    : 'সকল প্রাতিষ্ঠানিক হিসাব ও দায়িত্ব হস্তান্তর শেষে তাঁহাকে আনুষ্ঠানিকভাবে অব্যাহতি প্রদান করা হলো।'
                }`
              : `This is to certify that <strong>${safeEmpName}</strong> (Staff ID: <strong>${safeEmpCode}</strong>) served in <strong>${escapeHtml(schoolDisplay)}</strong> as <strong>${safeDesig}</strong> in the <strong>${safeDept}</strong> department from <strong>${escapeHtml(formatRecordDate(p.employmentStartDate, lang))}</strong> to <strong>${escapeHtml(formatRecordDate(p.lastWorkingDate, lang))}</strong>, completing a total tenure of <strong>${escapeHtml(durationStr)}</strong>. ${
                  isExp
                    ? 'Their conduct, punctuality, and academic/administrative performance were highly commendable.'
                    : 'Having handed over all institutional responsibilities and completed clearance formalities, they are hereby formally relieved from duty.'
                }`
          }
        </p>
        <table class="hr-info-table">
          <tr><th>${isBn ? 'কর্মকর্তা / শিক্ষকের নাম' : 'Employee Name'}</th><td><strong>${safeEmpName}</strong> (${safeEmpCode})</td></tr>
          <tr><th>${isBn ? 'পদবি ও বিভাগ' : 'Designation & Department'}</th><td>${safeDesig} · ${safeDept}</td></tr>
          <tr><th>${isBn ? 'চাকুরি শুরুর তারিখ' : 'Employment Start Date'}</th><td>${escapeHtml(formatRecordDate(p.employmentStartDate, lang))}</td></tr>
          <tr><th>${isBn ? 'শেষ কর্মদিবস' : 'Last Working Date'}</th><td>${escapeHtml(formatRecordDate(p.lastWorkingDate, lang))}</td></tr>
          <tr><th>${isBn ? 'মোট চাকুরির মেয়াদ' : 'Total Employment Duration'}</th><td><strong>${escapeHtml(durationStr)}</strong></td></tr>
          <tr><th>${isBn ? 'দায়িত্ব ও কর্মদক্ষতা মূল্যায়ন' : 'Work Performance Remarks'}</th><td>${formatMultiline(p.workPerformanceRemarks)}</td></tr>
        </table>
      `;
    }

    case 'promotion_letter':
      return `
        ${recipientBlock}
        <p style="margin:0 0 10px 0;">
          <strong>${isBn ? 'বিষয়ঃ পদোন্নতি প্রদান পত্র।' : 'Subject: Letter of Promotion.'}</strong>
        </p>
        <p style="margin:0 0 12px 0;">
          ${formatMultiline(
            p.workPerformanceRemarks ||
              (isBn
                ? 'আপনার কর্মদক্ষতা ও নিষ্ঠার স্বীকৃতিস্বরূপ কর্তৃপক্ষ আপনাকে পদোন্নতি প্রদান করিতেছে।'
                : 'Management is pleased to promote you based on your exemplary performance and dedication.')
          )}
        </p>
        <table class="hr-info-table">
          <tr><th>${isBn ? 'পূর্ববর্তী পদবি' : 'Previous Designation'}</th><td>${escapeHtml(p.previousDesignation || p.designation)} (${escapeHtml(p.previousDepartment || p.department)})</td></tr>
          <tr><th>${isBn ? 'নতুন পদবি' : 'New Promoted Designation'}</th><td><strong>${escapeHtml(p.newDesignation || '-')}</strong> (${escapeHtml(p.newDepartment || p.department)})</td></tr>
          <tr><th>${isBn ? 'কার্যকর তারিখ' : 'Effective Date'}</th><td><strong>${escapeHtml(formatRecordDate(p.effectiveDate, lang))}</strong></td></tr>
          ${p.newSalary !== undefined ? `<tr><th>${isBn ? 'সংশোধিত মাসিক বেতন' : 'Revised Monthly Salary'}</th><td><strong>${escapeHtml(formatMoney(p.newSalary, lang))}</strong></td></tr>` : ''}
        </table>
      `;

    case 'transfer_letter':
      return `
        ${recipientBlock}
        <p style="margin:0 0 10px 0;">
          <strong>${isBn ? 'বিষয়ঃ বদলি ও দায়িত্ব পুনর্বণ্টন আদেশ।' : 'Subject: Official Transfer Order.'}</strong>
        </p>
        <p style="margin:0 0 12px 0;">${formatMultiline(p.customBodyText)}</p>
        <table class="hr-info-table">
          <tr><th>${isBn ? 'বর্তমান কর্মস্থল / বিভাগ' : 'Current Campus / Department'}</th><td>${escapeHtml(p.previousBranch || p.department)}</td></tr>
          <tr><th>${isBn ? 'নতুন কর্মস্থল / শাখা' : 'New Assigned Campus / Wing'}</th><td><strong>${escapeHtml(p.newBranch || '-')}</strong></td></tr>
          <tr><th>${isBn ? 'কার্যকর তারিখ' : 'Transfer Effective Date'}</th><td><strong>${escapeHtml(formatRecordDate(p.effectiveDate, lang))}</strong></td></tr>
          <tr><th>${isBn ? 'রিপোর্টিং কর্মকর্তা' : 'Reporting Authority'}</th><td>${escapeHtml(p.reportingOfficer || p.principalOrChairmanName || '-')}</td></tr>
        </table>
      `;

    case 'salary_increment_letter':
      return `
        ${recipientBlock}
        <p style="margin:0 0 10px 0;">
          <strong>${isBn ? 'বিষয়ঃ মাসিক বেতন বৃদ্ধি (Salary Increment) অনুমোদন পত্র।' : 'Subject: Salary Increment Notification.'}</strong>
        </p>
        <p style="margin:0 0 12px 0;">${formatMultiline(p.workPerformanceRemarks)}</p>
        <table class="hr-salary-table">
          <thead>
            <tr>
              <th>${isBn ? 'বেতন বিবরণী' : 'Compensation Component'}</th>
              <th class="hr-num">${isBn ? 'পরিমাণ' : 'Amount / Rate'}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${isBn ? 'পূর্ববর্তী মাসিক বেতন' : 'Previous Monthly Salary'}</td>
              <td class="hr-num">${escapeHtml(formatMoney(p.previousSalary ?? 0, lang))}</td>
            </tr>
            <tr>
              <td>${isBn ? 'বেতন বৃদ্ধির পরিমাণ' : 'Monthly Increment Amount'}</td>
              <td class="hr-num">+ ${escapeHtml(formatMoney(p.incrementAmount ?? 0, lang))} (${isBn ? toBanglaDigits(p.incrementPercentage ?? 0) : (p.incrementPercentage ?? 0)}%)</td>
            </tr>
            <tr style="background:#f1f5f9;">
              <td><strong>${isBn ? 'নতুন সংশোধিত মাসিক বেতন' : 'New Revised Monthly Salary'}</strong></td>
              <td class="hr-num" style="color:#0f294d;font-size:13px;"><strong>${escapeHtml(formatMoney(p.newSalary ?? 0, lang))}</strong></td>
            </tr>
          </tbody>
        </table>
        <div style="font-size:12px;">
          <strong>${isBn ? 'কার্যকর তারিখ:' : 'Effective From:'}</strong> ${escapeHtml(formatRecordDate(p.effectiveDate, lang))}
        </div>
      `;

    case 'warning_letter':
      return `
        ${recipientBlock}
        <p style="margin:0 0 10px 0;color:#991b1b;">
          <strong>${isBn ? `বিষয়ঃ আনুষ্ঠানিক সতর্কীকরণ পত্র (${escapeHtml(p.warningLevel || 'Warning')})।` : `Subject: Official Warning Letter (${escapeHtml(p.warningLevel || 'Warning')}).`}</strong>
        </p>
        <table class="hr-info-table">
          <tr><th>${isBn ? 'সতর্কতার স্তর' : 'Warning Level'}</th><td><strong style="color:#991b1b;">${escapeHtml(p.warningLevel || 'First Warning')}</strong></td></tr>
          <tr><th>${isBn ? 'ঘটনার তারিখ' : 'Incident Date'}</th><td>${escapeHtml(formatRecordDate(p.incidentDate, lang))}</td></tr>
          <tr><th>${isBn ? 'অভিযোগ / ঘটনার বিবরণ' : 'Summary of Issue / Violation'}</th><td>${formatMultiline(p.reasonOrAllegation)}</td></tr>
          <tr><th>${isBn ? 'সংশোধনমূলক নির্দেশনা' : 'Required Corrective Action'}</th><td>${formatMultiline(p.correctiveAction)}</td></tr>
        </table>
      `;

    case 'show_cause_notice':
      return `
        ${recipientBlock}
        <p style="margin:0 0 10px 0;color:#991b1b;">
          <strong>${isBn ? 'বিষয়ঃ কারণ দর্শানোর নোটিশ (Show Cause Notice)।' : 'Subject: Official Show Cause Notice.'}</strong>
        </p>
        <table class="hr-info-table">
          <tr><th>${isBn ? 'ঘটনার তারিখ' : 'Incident Date'}</th><td>${escapeHtml(formatRecordDate(p.incidentDate, lang))}</td></tr>
          <tr><th>${isBn ? 'অভিযোগের কারণ ও বিবরণ' : 'Allegation / Grounds'}</th><td>${formatMultiline(p.reasonOrAllegation)}</td></tr>
          <tr><th>${isBn ? 'লিখিত জবাব দাখিলের শেষ তারিখ' : 'Response Deadline'}</th><td><strong style="color:#991b1b;">${escapeHtml(formatRecordDate(p.responseDeadlineDate, lang))} (${isBn ? `${toBanglaDigits(p.responseDeadlineDays ?? 3)} কর্মদিবস` : `${p.responseDeadlineDays ?? 3} Working Days`})</strong></td></tr>
          <tr><th>${isBn ? 'প্রাতিষ্ঠানিক নির্দেশনা' : 'Instructions'}</th><td>${formatMultiline(p.correctiveAction)}</td></tr>
        </table>
      `;
  }
}

export function buildHRDocumentContentMarkup(
  doc: StaffHRDocument,
  school: Partial<SchoolProfile>,
  template?: StaffDocumentTemplate | null
): string {
  const tpl = template || createDefaultHRTemplate(doc.schoolId);
  const lang = doc.language || tpl.language || 'bn';
  const isBn = lang === 'bn';
  const meta = HR_DOCUMENT_TYPE_MAP[doc.documentType];

  const schoolNameMain = isBn
    ? school.nameBn || school.nameEn || 'Smart School'
    : school.nameEn || school.nameBn || 'Smart School';
  const schoolNameAlt = isBn ? school.nameEn || '' : school.nameBn || '';
  const schoolAddress = isBn
    ? school.addressBn || school.addressEn || ''
    : school.addressEn || school.addressBn || '';
  const safeLogoUrl = sanitizeSafeMediaUrl(school.logoUrl);

  const logoBlock = tpl.showLogo
    ? safeLogoUrl
      ? `<img src="${escapeHtml(safeLogoUrl)}" alt="School Logo" class="hr-logo-box" />`
      : `<div class="hr-logo-fallback">${escapeHtml((school.nameEn || 'S').charAt(0).toUpperCase())}</div>`
    : '';

  const headerLayoutClass =
    tpl.logoPosition === 'center'
      ? 'hr-header-center'
      : tpl.logoPosition === 'right'
      ? 'hr-header-right'
      : 'hr-header-flex';

  const headerHtml = tpl.showHeader
    ? `
      <header class="hr-header">
        <div class="${headerLayoutClass}">
          ${logoBlock}
          <div style="flex:1;">
            <h1 class="hr-school-title">${escapeHtml(schoolNameMain)}</h1>
            ${schoolNameAlt ? `<div class="hr-school-sub">${escapeHtml(schoolNameAlt)}</div>` : ''}
            ${tpl.headerSubtitle ? `<div class="hr-school-meta">${escapeHtml(tpl.headerSubtitle)}</div>` : ''}
            <div class="hr-school-meta">
              ${schoolAddress ? `${escapeHtml(schoolAddress)} · ` : ''}
              ${school.phone ? `${isBn ? 'ফোন:' : 'Phone:'} ${escapeHtml(school.phone)} · ` : ''}
              ${school.email ? `${isBn ? 'ইমেইল:' : 'Email:'} ${escapeHtml(school.email)}` : ''}
              ${school.eiin ? ` · EIIN: ${escapeHtml(school.eiin)}` : ''}
            </div>
          </div>
        </div>
      </header>
    `
    : '';

  const docTitle = isBn ? `${meta.labelBn} (${meta.labelEn})` : meta.labelEn;
  const issueFormatted = formatRecordDate(doc.issueDate, lang);

  const sigImgUrl = sanitizeSafeMediaUrl(
    doc.documentData.authorizedSignatureUrl || school.principalSignatureUrl
  );
  const principalName =
    doc.documentData.principalOrChairmanName ||
    (isBn ? school.principalNameBn || school.principalNameEn : school.principalNameEn || school.principalNameBn) ||
    (isBn ? 'প্রধান শিক্ষক / অধ্যক্ষ' : 'Principal / Headmaster');
  const principalTitle =
    doc.documentData.principalOrChairmanTitle ||
    (isBn ? 'প্রধান শিক্ষক / সভাপতি' : 'Principal / Chairman');

  const sigBlockHtml = `
    <div class="hr-sign-col">
      ${
        sigImgUrl
          ? `<img src="${escapeHtml(sigImgUrl)}" alt="Authorized Signature" style="max-height:42px;max-width:155px;object-fit:contain;display:block;margin:0 auto 2px auto;" />`
          : `<div style="height:28px;font-style:italic;font-weight:800;font-size:13px;color:#0f294d;display:flex;align-items:flex-end;justify-content:center;">${escapeHtml(principalName)}</div>`
      }
      <div class="hr-sign-line">
        <div>${escapeHtml(principalName)}</div>
        <div style="font-size:10.5px;font-weight:600;color:#475569;">${escapeHtml(principalTitle)}</div>
        <div style="font-size:10px;font-weight:500;color:#64748b;">${escapeHtml(schoolNameMain)}</div>
      </div>
    </div>
  `;

  const showSeal = tpl.showSeal && doc.documentData.includeSchoolSeal !== false;
  const sealBlockHtml = showSeal
    ? `
      <div class="hr-seal-circle">
        <span>${escapeHtml(tpl.sealLabel || (isBn ? 'অফিসিয়াল সিল' : 'OFFICIAL SEAL'))}</span>
        <span style="font-size:7.5px;margin-top:2px;color:#475569;">${escapeHtml((school.schoolCode || 'SSBD').toUpperCase())}</span>
      </div>
    `
    : '<div style="width:84px;"></div>';

  // Arrange seal + signature columns cleanly based on signaturePosition and sealPosition
  let footerBlocks: string[] = [];
  if (tpl.signaturePosition === 'left') {
    footerBlocks =
      tpl.sealPosition === 'center'
        ? [sigBlockHtml, sealBlockHtml, '<div style="width:120px;"></div>']
        : [sigBlockHtml, '<div style="width:80px;"></div>', sealBlockHtml];
  } else if (tpl.signaturePosition === 'center') {
    footerBlocks =
      tpl.sealPosition === 'left'
        ? [sealBlockHtml, sigBlockHtml, '<div style="width:84px;"></div>']
        : ['<div style="width:84px;"></div>', sigBlockHtml, sealBlockHtml];
  } else {
    footerBlocks =
      tpl.sealPosition === 'center'
        ? ['<div style="width:120px;"></div>', sealBlockHtml, sigBlockHtml]
        : [sealBlockHtml, '<div style="width:80px;"></div>', sigBlockHtml];
  }

  return `
    <div class="hr-print-root">
      <div class="hr-doc-sheet">
        ${tpl.styleTheme === 'classic_navy_gold' || tpl.styleTheme === 'bordered_certificate' ? '<div class="hr-inner-gold-frame"></div>' : ''}
        <div>
          ${headerHtml}
          <div class="hr-meta-bar">
            <span><strong>${isBn ? 'স্মারক / সিরিয়াল নং:' : 'Serial / Ref No:'}</strong> <span style="font-family:monospace;font-weight:700;">${escapeHtml(doc.documentNumber)}</span></span>
            <span><strong>${isBn ? 'তারিখ:' : 'Issue Date:'}</strong> ${escapeHtml(issueFormatted)}</span>
          </div>
          <div class="hr-doc-banner">
            <span class="hr-doc-banner-pill">${escapeHtml(docTitle)}</span>
          </div>
          <div class="hr-body">
            ${buildBodyByType(doc, school, lang)}
          </div>
        </div>
        <div>
          <div class="hr-sign-area">
            ${footerBlocks.join('\n')}
          </div>
          ${
            tpl.showFooter
              ? `<div class="hr-footer-bar">${escapeHtml(tpl.footerText || '')}</div>`
              : ''
          }
        </div>
      </div>
    </div>
  `;
}

export function buildHRDocumentPreviewHtml(
  doc: StaffHRDocument,
  school: Partial<SchoolProfile>,
  template?: StaffDocumentTemplate | null
): string {
  const tpl = template || createDefaultHRTemplate(doc.schoolId);
  const lang = doc.language || tpl.language || 'bn';
  const styles = buildHRDocumentStyles(tpl);
  const markup = buildHRDocumentContentMarkup(doc, school, tpl);
  const meta = HR_DOCUMENT_TYPE_MAP[doc.documentType];

  return `<!DOCTYPE html>
<html lang="${lang === 'bn' ? 'bn' : 'en'}">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(meta.labelEn)} - ${escapeHtml(doc.employeeName)} (${escapeHtml(doc.documentNumber)})</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Hind+Siliguri:wght@400;500;600;700&family=Noto+Sans+Bengali:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet" />
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; }
      ${styles}
      @media screen {
        body { padding: 12px; background: #f1f5f9; }
        .hr-doc-sheet { box-shadow: 0 6px 20px rgba(15, 23, 42, 0.12); }
      }
      @media print {
        body { padding: 0; background: #ffffff; }
        .hr-doc-sheet { border: none; box-shadow: none; min-height: auto; }
      }
    </style>
  </head>
  <body>
    ${markup}
  </body>
</html>`;
}

export function buildHRDocumentFullHtml(
  doc: StaffHRDocument,
  school: Partial<SchoolProfile>,
  template?: StaffDocumentTemplate | null
): string {
  const previewHtml = buildHRDocumentPreviewHtml(doc, school, template);
  return previewHtml.replace(
    '</body>',
    `<script>
      window.addEventListener('load', function() {
        setTimeout(function() { window.focus(); window.print(); }, 350);
      });
    </script>
  </body>`
  );
}

export function printHRDocument(
  doc: StaffHRDocument,
  school: Partial<SchoolProfile>,
  template?: StaffDocumentTemplate | null
): void {
  const html = buildHRDocumentFullHtml(doc, school, template);
  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1040');
  if (!win) {
    throw new Error('Popup blocked by browser. Please allow popups to print this document.');
  }
  win.opener = null;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

export async function downloadHRDocumentPdf(
  doc: StaffHRDocument,
  school: Partial<SchoolProfile>,
  template?: StaffDocumentTemplate | null
): Promise<void> {
  const tpl = template || createDefaultHRTemplate(doc.schoolId);
  const styles = buildHRDocumentStyles(tpl);
  const markup = buildHRDocumentContentMarkup(doc, school, tpl);

  // Wait for Bengali & English webfonts to finish loading so Bangla glyphs render cleanly
  if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
    try {
      await (document as any).fonts.ready;
    } catch {
      // ignore
    }
  }

  // Create isolated off-screen wrapper attached to body using hex/rgb colors only (prevents Tailwind v4 oklch parsing errors)
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = '794px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#0f172a';
  container.style.zIndex = '-9999';

  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  container.appendChild(styleEl);

  const inner = document.createElement('div');
  inner.innerHTML = markup;
  container.appendChild(inner);
  document.body.appendChild(container);

  try {
    // Allow images inside offscreen DOM to decode
    const imgs = Array.from(container.querySelectorAll('img'));
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) return resolve();
            const timer = setTimeout(resolve, 2500);
            img.onload = () => {
              clearTimeout(timer);
              resolve();
            };
            img.onerror = () => {
              clearTimeout(timer);
              resolve();
            };
          })
      )
    );

    const targetEl = (container.querySelector('.hr-doc-sheet') as HTMLElement) || container;
    const canvas = await html2canvas(targetEl, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: targetEl.scrollWidth,
      height: targetEl.scrollHeight,
    });

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const pageWidthMm = pdf.internal.pageSize.getWidth();
    const pageHeightMm = pdf.internal.pageSize.getHeight();
    const imgWidthMm = pageWidthMm;
    const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;
    const imgData = canvas.toDataURL('image/png');

    let heightLeft = imgHeightMm;
    let positionY = 0;

    pdf.addImage(imgData, 'PNG', 0, positionY, imgWidthMm, imgHeightMm, undefined, 'FAST');
    heightLeft -= pageHeightMm;

    while (heightLeft > 2) {
      positionY = heightLeft - imgHeightMm;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, positionY, imgWidthMm, imgHeightMm, undefined, 'FAST');
      heightLeft -= pageHeightMm;
    }

    const cleanSerial = (doc.documentNumber || doc.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanName = (doc.employeeName || 'Staff').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32);
    pdf.save(`${cleanSerial}_${cleanName}.pdf`);
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
