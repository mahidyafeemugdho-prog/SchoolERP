import {
  HRDocumentPayload,
  HRDocumentSalaryBreakdown,
  HRDocumentType,
  SchoolProfile,
  Staff,
  StaffDocumentTemplate,
  StaffHRDocument,
  UserProfile,
  UserRole,
} from '../types';
import { formatRecordDate } from './admissionPrintHelper';
import { formatSchoolScopedId, resolveSchoolCode } from './schoolIdFormatter';

export interface HRDocumentTypeMeta {
  type: HRDocumentType;
  code: string;
  labelEn: string;
  labelBn: string;
  shortEn: string;
  shortBn: string;
  requiresApproval: boolean;
  staffCanSubmit: boolean;
  isSalarySensitive: boolean;
  defaultStatusOnAdminCreate: 'Issued' | 'Pending' | 'Approved';
}

export const HR_DOCUMENT_TYPES: HRDocumentTypeMeta[] = [
  {
    type: 'appointment_letter',
    code: 'APPT',
    labelEn: 'Appointment Letter',
    labelBn: 'নিয়োগপত্র',
    shortEn: 'Appointment',
    shortBn: 'নিয়োগপত্র',
    requiresApproval: false,
    staffCanSubmit: false,
    isSalarySensitive: true,
    defaultStatusOnAdminCreate: 'Issued',
  },
  {
    type: 'joining_letter',
    code: 'JOIN',
    labelEn: 'Joining Letter',
    labelBn: 'যোগদানপত্র',
    shortEn: 'Joining',
    shortBn: 'যোগদানপত্র',
    requiresApproval: true,
    staffCanSubmit: true,
    isSalarySensitive: false,
    defaultStatusOnAdminCreate: 'Pending',
  },
  {
    type: 'resignation_letter',
    code: 'RESIGN',
    labelEn: 'Resignation Letter',
    labelBn: 'পদত্যাগপত্র',
    shortEn: 'Resignation',
    shortBn: 'পদত্যাগপত্র',
    requiresApproval: true,
    staffCanSubmit: true,
    isSalarySensitive: false,
    defaultStatusOnAdminCreate: 'Pending',
  },
  {
    type: 'resignation_acceptance',
    code: 'RESIGN_ACC',
    labelEn: 'Resignation Acceptance Letter',
    labelBn: 'পদত্যাগ গ্রহণপত্র',
    shortEn: 'Resignation Acceptance',
    shortBn: 'পদত্যাগ গ্রহণ',
    requiresApproval: false,
    staffCanSubmit: false,
    isSalarySensitive: false,
    defaultStatusOnAdminCreate: 'Issued',
  },
  {
    type: 'release_letter',
    code: 'REL',
    labelEn: 'Release Letter',
    labelBn: 'অব্যাহতি পত্র',
    shortEn: 'Release',
    shortBn: 'অব্যাহতি পত্র',
    requiresApproval: false,
    staffCanSubmit: false,
    isSalarySensitive: false,
    defaultStatusOnAdminCreate: 'Issued',
  },
  {
    type: 'experience_certificate',
    code: 'EXP',
    labelEn: 'Experience Certificate',
    labelBn: 'অভিজ্ঞতার সনদ',
    shortEn: 'Experience',
    shortBn: 'অভিজ্ঞতার সনদ',
    requiresApproval: false,
    staffCanSubmit: false,
    isSalarySensitive: false,
    defaultStatusOnAdminCreate: 'Issued',
  },
  {
    type: 'promotion_letter',
    code: 'PROM',
    labelEn: 'Promotion Letter',
    labelBn: 'পদোন্নতি পত্র',
    shortEn: 'Promotion',
    shortBn: 'পদোন্নতি',
    requiresApproval: false,
    staffCanSubmit: false,
    isSalarySensitive: true,
    defaultStatusOnAdminCreate: 'Issued',
  },
  {
    type: 'transfer_letter',
    code: 'TRANS',
    labelEn: 'Transfer Letter',
    labelBn: 'বদলি পত্র',
    shortEn: 'Transfer',
    shortBn: 'বদলি পত্র',
    requiresApproval: false,
    staffCanSubmit: false,
    isSalarySensitive: false,
    defaultStatusOnAdminCreate: 'Issued',
  },
  {
    type: 'salary_increment_letter',
    code: 'INCR',
    labelEn: 'Salary Increment Letter',
    labelBn: 'বেতন বৃদ্ধির পত্র',
    shortEn: 'Increment',
    shortBn: 'বেতন বৃদ্ধি',
    requiresApproval: false,
    staffCanSubmit: false,
    isSalarySensitive: true,
    defaultStatusOnAdminCreate: 'Issued',
  },
  {
    type: 'warning_letter',
    code: 'WARN',
    labelEn: 'Warning Letter',
    labelBn: 'সতর্কীকরণ পত্র',
    shortEn: 'Warning',
    shortBn: 'সতর্কীকরণ',
    requiresApproval: false,
    staffCanSubmit: false,
    isSalarySensitive: false,
    defaultStatusOnAdminCreate: 'Issued',
  },
  {
    type: 'show_cause_notice',
    code: 'SCN',
    labelEn: 'Show Cause Notice',
    labelBn: 'কারণ দর্শানোর নোটিশ',
    shortEn: 'Show Cause',
    shortBn: 'কারণ দর্শানো',
    requiresApproval: false,
    staffCanSubmit: false,
    isSalarySensitive: false,
    defaultStatusOnAdminCreate: 'Issued',
  },
];

export const HR_DOCUMENT_TYPE_MAP: Record<HRDocumentType, HRDocumentTypeMeta> = HR_DOCUMENT_TYPES.reduce(
  (acc, item) => {
    acc[item.type] = item;
    return acc;
  },
  {} as Record<HRDocumentType, HRDocumentTypeMeta>
);

export const HR_FONT_OPTIONS = [
  { id: "'Hind Siliguri', 'Noto Sans Bengali', Arial, sans-serif", label: 'Hind Siliguri (বাংলা + English)' },
  { id: "'Noto Sans Bengali', 'Hind Siliguri', Arial, sans-serif", label: 'Noto Sans Bengali (বাংলা + English)' },
  { id: "'Plus Jakarta Sans', 'Noto Sans Bengali', sans-serif", label: 'Plus Jakarta Sans (Modern English + বাংলা)' },
  { id: "'DM Sans', 'Noto Sans Bengali', sans-serif", label: 'DM Sans (Clean Official)' },
  { id: "Georgia, 'Noto Sans Bengali', serif", label: 'Georgia Classic Serif (Formal)' },
];

export function createDefaultHRTemplate(schoolId: string): StaffDocumentTemplate {
  const now = new Date().toISOString();
  return {
    id: `tpl_default_${schoolId || 'school'}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    schoolId: schoolId || 'default',
    name: 'Bangladeshi School Official Navy & Gold Letterhead',
    styleTheme: 'classic_navy_gold',
    language: 'bn',
    fontFamily: "'Hind Siliguri', 'Noto Sans Bengali', Arial, sans-serif",
    logoPosition: 'left',
    showLogo: true,
    showHeader: true,
    headerSubtitle: 'স্থাপিত ও পরিচালিতঃ শিক্ষাবোর্ড ও সরকারি বিধি মোতাবেক | অফিসিয়াল দপ্তর',
    showFooter: true,
    footerText: 'এই পত্রটি বিদ্যালয়ের অফিসিয়াল মানবসম্পদ ব্যবস্থাপনা (HR) পোর্টাল হতে সংরক্ষিত ও যাচাইকৃত।',
    signaturePosition: 'right',
    sealPosition: 'left',
    showSeal: true,
    sealLabel: 'অফিসিয়াল সিলমোহর',
    primaryColor: '#0f294d',
    accentColor: '#b45309',
    marginTopMm: 14,
    marginRightMm: 15,
    marginBottomMm: 14,
    marginLeftMm: 15,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function formatHRSerialNumber(
  schoolCode: string,
  documentType: HRDocumentType,
  year: number | string,
  sequence: number
): string {
  const cleanCode = (schoolCode || 'SSBD')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10) || 'SSBD';
  const typeMeta = HR_DOCUMENT_TYPE_MAP[documentType];
  const typeCode = typeMeta?.code || 'DOC';
  const seqStr = String(Math.max(1, Math.floor(sequence))).padStart(4, '0');
  return `${cleanCode}/${typeCode}/${year}/${seqStr}`;
}

export function getNextHRSerialNumber(
  existingDocs: StaffHRDocument[],
  schoolId: string,
  schoolCode: string,
  documentType: HRDocumentType,
  issueDate?: string
): string {
  const yearMatch = (issueDate || '').match(/^(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
  const typeCode = HR_DOCUMENT_TYPE_MAP[documentType]?.code || 'DOC';
  const prefixSuffix = `/${typeCode}/${year}/`;

  let maxSeq = 0;
  for (const docItem of existingDocs) {
    if (docItem.schoolId && schoolId && docItem.schoolId !== schoolId) continue;
    if (docItem.documentType !== documentType) continue;
    const num = docItem.documentNumber || '';
    const idx = num.indexOf(prefixSuffix);
    if (idx !== -1) {
      const tail = num.slice(idx + prefixSuffix.length);
      const parsed = Number.parseInt(tail, 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  }
  return formatHRSerialNumber(schoolCode, documentType, year, maxSeq + 1);
}

export interface EmploymentDurationResult {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  labelEn: string;
  labelBn: string;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBanglaDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

export function calculateEmploymentDuration(
  startDateStr?: string | null,
  endDateStr?: string | null
): EmploymentDurationResult {
  const empty: EmploymentDurationResult = {
    years: 0,
    months: 0,
    days: 0,
    totalDays: 0,
    labelEn: '0 Days',
    labelBn: '০ দিন',
  };

  if (!startDateStr || !endDateStr) return empty;
  const startMatch = startDateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  const endMatch = endDateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!startMatch || !endMatch) return empty;

  const sYear = Number(startMatch[1]);
  const sMonth = Number(startMatch[2]) - 1;
  const sDay = Number(startMatch[3]);
  const eYear = Number(endMatch[1]);
  const eMonth = Number(endMatch[2]) - 1;
  const eDay = Number(endMatch[3]);

  const startDate = new Date(Date.UTC(sYear, sMonth, sDay));
  const endDate = new Date(Date.UTC(eYear, eMonth, eDay));
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return empty;
  }

  const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);

  let years = eYear - sYear;
  let months = eMonth - sMonth;
  let days = eDay - sDay;

  if (days < 0) {
    months -= 1;
    // Days in previous month relative to endDate
    const prevMonthLastDay = new Date(Date.UTC(eYear, eMonth, 0)).getUTCDate();
    days += prevMonthLastDay;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const partsEn: string[] = [];
  if (years > 0) partsEn.push(`${years} ${years === 1 ? 'Year' : 'Years'}`);
  if (months > 0) partsEn.push(`${months} ${months === 1 ? 'Month' : 'Months'}`);
  if (days > 0 || partsEn.length === 0) partsEn.push(`${days} ${days === 1 ? 'Day' : 'Days'}`);

  const partsBn: string[] = [];
  if (years > 0) partsBn.push(`${toBanglaDigits(years)} বছর`);
  if (months > 0) partsBn.push(`${toBanglaDigits(months)} মাস`);
  if (days > 0 || partsBn.length === 0) partsBn.push(`${toBanglaDigits(days)} দিন`);

  return {
    years,
    months,
    days,
    totalDays,
    labelEn: partsEn.join(', '),
    labelBn: partsBn.join(', '),
  };
}

export function buildSalaryBreakdownFromStaff(staff?: Partial<Staff> | null): HRDocumentSalaryBreakdown {
  const basic = Number(staff?.basicSalary || 0);
  const house = Number(staff?.houseRentAllowance || 0);
  const medical = Number(staff?.medicalAllowance || 0);
  const other = Number(staff?.otherAllowance || 0);
  const pf = Number(staff?.providentFundDeduction || 0);
  const gross = basic + house + medical + other;
  const net = Math.max(0, gross - pf);
  return {
    basicSalary: basic,
    houseRentAllowance: house,
    medicalAllowance: medical,
    otherAllowance: other,
    providentFundDeduction: pf,
    grossSalary: gross,
    netSalary: net,
  };
}

export function buildDefaultHRPayload(params: {
  documentType: HRDocumentType;
  staff: Staff;
  school: Partial<SchoolProfile>;
  schoolId?: string;
  language: 'bn' | 'en';
  existingDocs?: StaffHRDocument[];
}): HRDocumentPayload {
  const { documentType, staff, school, schoolId, language, existingDocs = [] } = params;
  const schoolCode = resolveSchoolCode(schoolId, school);
  const scopedCode = formatSchoolScopedId(staff.employeeId, schoolCode);
  const today = new Date().toISOString().split('T')[0];
  const salaryBreakdown = buildSalaryBreakdownFromStaff(staff);
  const principalName =
    language === 'bn'
      ? school.principalNameBn || school.principalNameEn || 'প্রধান শিক্ষক'
      : school.principalNameEn || school.principalNameBn || 'Headmaster / Principal';

  const latestAppointment = existingDocs.find(
    (d) =>
      d.documentType === 'appointment_letter' &&
      (d.employeeId === staff.id || d.employeeCode === scopedCode || d.employeeCode === staff.employeeId)
  );

  const startDate = staff.joiningDate || today;
  const duration = calculateEmploymentDuration(startDate, today);

  const base: HRDocumentPayload = {
    employeeNameEn: staff.nameEn || '',
    employeeNameBn: staff.nameBn || staff.nameEn || '',
    employeeCode: scopedCode || staff.employeeId || '',
    employeePhotoUrl: staff.photoUrl || '',
    includeEmployeePhoto: Boolean(staff.photoUrl),
    designation: staff.designation || '',
    department: staff.department || '',
    subject: staff.subject || (staff.assignedSubjects || []).join(', ') || '',
    phone: staff.phone || '',
    email: staff.email || '',
    permanentAddress: staff.permanentAddress || '',
    qualification: staff.qualification || '',
    joiningDate: startDate,
    monthlySalary: salaryBreakdown.netSalary,
    salaryBreakdown,
    principalOrChairmanName: principalName,
    principalOrChairmanTitle:
      language === 'bn' ? 'প্রধান শিক্ষক / অধ্যক্ষ' : 'Principal / Headmaster',
    authorizedSignatureUrl: school.principalSignatureUrl || '',
    includeSchoolSeal: true,
  };

  switch (documentType) {
    case 'appointment_letter':
      return {
        ...base,
        employmentType: 'Full-Time Permanent',
        probationPeriod: language === 'bn' ? '৬ মাস (শিক্ষানবিশকাল)' : '6 Months Probation',
        workingHours:
          language === 'bn'
            ? 'সকাল ৮:৩০ ঘটিকা হতে বিকাল ৪:০০ ঘটিকা'
            : '08:30 AM to 04:00 PM (School Working Days)',
        jobResponsibilities:
          language === 'bn'
            ? '১. নির্ধারিত শ্রেণি ও বিষয় অনুযায়ী নিয়মিত পাঠদান, পাঠ-পরিকল্পনা প্রণয়ন ও পরীক্ষার খাতা মূল্যায়ন।\n২. প্রতিষ্ঠানের শৃঙ্খলা, শিক্ষার্থী উপস্থিতি তদারকি ও সহ-শিক্ষা কার্যক্রমে অংশগ্রহণ।\n৩. প্রধান শিক্ষক ও কর্তৃপক্ষ কর্তৃক অর্পিত প্রাতিষ্ঠানিক দায়িত্ব নিষ্ঠার সাথে পালন।'
            : '1. Conduct scheduled classes, prepare lesson plans, and evaluate student examinations faithfully.\n2. Maintain institutional discipline, student attendance tracking, and co-curricular mentorship.\n3. Perform academic and administrative duties assigned by the Principal and Governing Body.',
        noticePeriod: language === 'bn' ? '১ মাস (৩০ দিন) পূর্ব নোটিশ' : '1 Month (30 Days) Written Notice',
        termsAndConditions:
          language === 'bn'
            ? '১. প্রতিষ্ঠানের প্রচলিত চাকুরি বিধিমালা ও আচরণবিধি কঠোরভাবে অনুসরণ করতে হবে।\n২. শিক্ষানবিশকাল সন্তোষজনকভাবে সমাপ্তির পর স্থায়ীকরণ বিবেচনা করা হবে।\n৩. উভয় পক্ষের মধ্যে ১ মাসের লিখিত নোটিশ অথবা সমপরিমাণ মূল বেতন পরিশোধ সাপেক্ষে চাকুরি অব্যাহতি কার্যকর হবে।'
            : '1. You shall strictly abide by the school service rules, code of conduct, and academic calendar.\n2. Confirmation of service is subject to satisfactory performance during the probation period.\n3. Separation requires 1 month prior written notice or salary in lieu of notice from either party.',
      };

    case 'joining_letter':
      return {
        ...base,
        appointmentRefNumber: latestAppointment?.documentNumber || '',
        submittedDate: today,
        employeeSignature: staff.nameEn || staff.nameBn || '',
        joiningRemarks:
          language === 'bn'
            ? `নিয়োগপত্র অনুযায়ী অদ্য ${formatRecordDate(startDate, 'bn')} তারিখে আমি স্ব-পদে যোগদান করিলাম।`
            : `In accordance with my appointment letter, I hereby report for duty and join my position on ${formatRecordDate(startDate, 'en')}.`,
      };

    case 'resignation_letter':
      return {
        ...base,
        applicationDate: today,
        proposedLastWorkingDate: today,
        noticePeriod: language === 'bn' ? '৩০ দিন' : '30 Days',
        employeeSignature: staff.nameEn || staff.nameBn || '',
        resignationReason:
          language === 'bn'
            ? 'ব্যক্তিগত ও পারিবারিক কারণে আমি উক্ত পদ থেকে অব্যাহতি নিতে ইচ্ছুক।'
            : 'Due to personal reasons, I respectfully request to tender my resignation from my current role.',
      };

    case 'resignation_acceptance':
      return {
        ...base,
        acceptanceDate: today,
        lastWorkingDate: today,
        principalRemarks:
          language === 'bn'
            ? 'আপনার পদত্যাগপত্র কর্তৃপক্ষ কর্তৃক সদয়ভাবে গৃহীত হলো। দায়িত্ব হস্তান্তর সম্পন্ন করে অব্যাহতি গ্রহণের অনুরোধ করা হলো।'
            : 'Your resignation application has been formally accepted by the school authority. Please complete handover formalities prior to your last working day.',
      };

    case 'release_letter':
    case 'experience_certificate':
      return {
        ...base,
        employmentStartDate: startDate,
        lastWorkingDate: today,
        employmentDurationEn: duration.labelEn,
        employmentDurationBn: duration.labelBn,
        workPerformanceRemarks:
          language === 'bn'
            ? 'চাকরিকালীন সময়ে তাঁহার কর্মদক্ষতা, নিয়মানুবর্তিতা, চারিত্রিক গুণাবলী ও শিক্ষার্থীদের প্রতি দায়িত্ববোধ ছিল অত্যন্ত সন্তোষজনক। আমরা তাঁহার উত্তরোত্তর সাফল্য ও মঙ্গল কামনা করি।'
            : 'During the tenure of service, their conduct, punctuality, teaching integrity, and commitment to students have been exemplary. We wish them every success in future endeavors.',
      };

    case 'promotion_letter':
      return {
        ...base,
        previousDesignation: staff.designation || '',
        newDesignation: staff.designation || '',
        previousDepartment: staff.department || '',
        newDepartment: staff.department || '',
        effectiveDate: today,
        newSalary: salaryBreakdown.netSalary,
        workPerformanceRemarks:
          language === 'bn'
            ? 'আপনার নিরলস পরিশ্রম, নিষ্ঠা ও একাডেমিক সাফল্যের স্বীকৃতিস্বরূপ কর্তৃপক্ষ আপনাকে পদোন্নতি প্রদান করিতেছে।'
            : 'In recognition of your dedicated service, exemplary performance, and institutional contribution, management is pleased to promote you.',
      };

    case 'transfer_letter':
      return {
        ...base,
        previousBranch: staff.department || (language === 'bn' ? 'মূল শাখা' : 'Main Campus'),
        newBranch: language === 'bn' ? 'প্রভাতি / দিবা শাখা' : 'Morning / Day Wing',
        effectiveDate: today,
        reportingOfficer: principalName,
        customBodyText:
          language === 'bn'
            ? 'প্রাতিষ্ঠানিক প্রয়োজনে আপনাকে নির্ধারিত শাখা ও বিভাগে বদলি/পুনর্নিয়োগ করা হলো। নির্ধারিত তারিখে নতুন দায়িত্বভার গ্রহণের নির্দেশ প্রদান করা হলো।'
            : 'In the interest of institutional administration, you are hereby transferred to the assigned wing/department and instructed to report on the effective date.',
      };

    case 'salary_increment_letter':
      return {
        ...base,
        previousSalary: salaryBreakdown.netSalary,
        incrementAmount: 2000,
        incrementPercentage:
          salaryBreakdown.netSalary > 0
            ? Math.round((2000 / salaryBreakdown.netSalary) * 1000) / 10
            : 0,
        newSalary: salaryBreakdown.netSalary + 2000,
        effectiveDate: today,
        workPerformanceRemarks:
          language === 'bn'
            ? 'বার্ষিক মূল্যায়ন ও কর্মদক্ষতার ভিত্তিতে আপনার মাসিক বেতন বৃদ্ধি অনুমোদন করা হলো।'
            : 'Based on your annual performance appraisal and dedicated service, management is pleased to revise your monthly compensation.',
      };

    case 'warning_letter':
      return {
        ...base,
        incidentDate: today,
        warningLevel: 'First Warning',
        reasonOrAllegation:
          language === 'bn'
            ? 'বিলম্বে উপস্থিতি / দায়িত্ব পালনে অবহেলা পরিলক্ষিত হয়েছে।'
            : 'Repeated late attendance / non-compliance with scheduled institutional responsibilities.',
        correctiveAction:
          language === 'bn'
            ? 'ভবিষ্যতে প্রতিষ্ঠানের শৃঙ্খলা ও সময়ানুবর্তিতা কঠোরভাবে মেনে চলার নির্দেশ দেওয়া হলো; অন্যথায় প্রাতিষ্ঠানিক বিধি অনুযায়ী ব্যবস্থা নেওয়া হবে।'
            : 'You are advised to ensure immediate improvement and strict compliance with school rules; failure to comply may result in further disciplinary action.',
      };

    case 'show_cause_notice':
      return {
        ...base,
        incidentDate: today,
        responseDeadlineDays: 3,
        responseDeadlineDate: new Date(Date.now() + 3 * 86_400_000).toISOString().split('T')[0],
        reasonOrAllegation:
          language === 'bn'
            ? 'পূর্বানুমতি ব্যতীত কর্মস্থলে অনুপস্থিতি / প্রাতিষ্ঠানিক নির্দেশনা অমান্য করার অভিযোগ।'
            : 'Unauthorized absence from duty / non-compliance with official administrative directives.',
        correctiveAction:
          language === 'bn'
            ? 'নোটিশ প্রাপ্তির ৩ (তিন) কর্মদিবসের মধ্যে নিম্নস্বাক্ষরকারীর নিকট লিখিত জবাব দাখিল করার নির্দেশ দেওয়া হলো।'
            : 'You are hereby directed to submit a written explanation within 3 working days as to why disciplinary action should not be initiated against you.',
      };
  }
}

export function isStaffOwnerOfRecord(
  record: { employeeId?: string; employeeCode?: string; employeeAuthUid?: string; createdByUid?: string },
  user?: UserProfile | null,
  staffList: Staff[] = []
): boolean {
  if (!user) return false;
  if (record.createdByUid && (record.createdByUid === user.authUid || record.createdByUid === user.id)) {
    return true;
  }
  if (record.employeeAuthUid && (record.employeeAuthUid === user.authUid || record.employeeAuthUid === user.id)) {
    return true;
  }
  if (user.linkedStaffId && record.employeeId === user.linkedStaffId) {
    return true;
  }
  const matchedStaff = staffList.find(
    (s) =>
      (user.linkedStaffId && s.id === user.linkedStaffId) ||
      (s.authUid && (s.authUid === user.authUid || s.authUid === user.id)) ||
      (s.email && user.email && s.email.toLowerCase() === user.email.toLowerCase())
  );
  if (matchedStaff) {
    return record.employeeId === matchedStaff.id || record.employeeCode === matchedStaff.employeeId;
  }
  return false;
}

export function canManageAllHRDocuments(role: UserRole, user?: UserProfile | null): boolean {
  if (role === 'master_admin' || role === 'super_admin' || role === 'admin') return true;
  if (role === 'receptionist') return user?.permissions?.manageHrDocuments !== false;
  return Boolean(user?.permissions?.manageHrDocuments);
}

export function canApproveHRDocuments(role: UserRole): boolean {
  return role === 'master_admin' || role === 'super_admin' || role === 'admin';
}

export function canDeleteHRDocuments(role: UserRole): boolean {
  return role === 'master_admin' || role === 'super_admin' || role === 'admin';
}

export function canManageHRTemplates(role: UserRole, user?: UserProfile | null): boolean {
  return canManageAllHRDocuments(role, user);
}

export function canAccountantViewSalaryHRDocs(role: UserRole, user?: UserProfile | null): boolean {
  if (role !== 'accountant') return false;
  const perms = user?.permissions;
  if (!perms) return true;
  return Boolean(perms.viewSalaryDocuments || perms.manageFees || perms.manageHrDocuments);
}

export function canViewHRDocument(
  doc: StaffHRDocument,
  role: UserRole,
  user?: UserProfile | null,
  staffList: Staff[] = []
): boolean {
  if (canManageAllHRDocuments(role, user)) return true;
  if (isStaffOwnerOfRecord(doc, user, staffList)) return true;
  if (role === 'accountant' && canAccountantViewSalaryHRDocs(role, user)) {
    return doc.documentType === 'appointment_letter' || doc.documentType === 'salary_increment_letter';
  }
  return false;
}

export function canCreateHRDocumentType(
  documentType: HRDocumentType,
  role: UserRole,
  user?: UserProfile | null
): boolean {
  if (canManageAllHRDocuments(role, user)) return true;
  const meta = HR_DOCUMENT_TYPE_MAP[documentType];
  if (!meta) return false;
  // Teachers, accountants, librarians, staff can submit self-service Joining or Resignation letters
  return meta.staffCanSubmit && ['teacher', 'accountant', 'librarian', 'receptionist'].includes(role);
}
