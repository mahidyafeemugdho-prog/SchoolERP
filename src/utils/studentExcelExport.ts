import * as XLSX from 'xlsx';
import { AdmissionEnquiry, Student } from '../types';
import { compareStudentsByClassAndRoll } from './studentSort';
import { formatSchoolScopedId } from './schoolIdFormatter';

export interface StudentAdmissionExportRow {
  'SL': number;
  'Student ID': string;
  'Admission No': string;
  'Admission Date': string;
  'Session': string;
  'Class': string;
  'Section': string;
  'Shift': string;
  'Group': string;
  'Roll No': string;
  'Student Name (English)': string;
  'Student Name (Bangla)': string;
  'Gender': string;
  'Date of Birth': string;
  'Blood Group': string;
  'Religion': string;
  'Father Name (English)': string;
  'Father Name (Bangla)': string;
  'Father Mobile': string;
  'Father NID': string;
  'Mother Name (English)': string;
  'Mother Name (Bangla)': string;
  'Mother Mobile': string;
  'Mother NID': string;
  'Guardian Name': string;
  'Guardian Relation': string;
  'Guardian Mobile': string;
  'Present Address': string;
  'Permanent Address': string;
  'Previous School': string;
  'Birth Certificate No': string;
  'Documents Attached': string;
  'Email': string;
  'Medical Notes': string;
  'Status': string;
}

const getAttachedDocsSummary = (s: Student): string => {
  const docs: string[] = [];
  if (s.photoUrl) docs.push('Photo');
  if (s.birthCertificateUrl || s.birthCertificateNo) docs.push('Birth Certificate');
  if (s.fatherNidUrl || s.fatherNid) docs.push('Father NID');
  if (s.motherNidUrl || s.motherNid) docs.push('Mother NID');
  if (s.transferCertificateUrl) docs.push('TC');
  if (Array.isArray(s.documents) && s.documents.length > 0) {
    s.documents.forEach((d) => {
      const label = d.title || d.type;
      if (label && !docs.includes(label)) docs.push(label);
    });
  }
  return docs.length > 0 ? docs.join(', ') : 'None';
};

export const buildStudentAdmissionExportRows = (
  students: Student[],
  schoolCode?: string
): StudentAdmissionExportRow[] => {
  const sorted = [...students].sort(compareStudentsByClassAndRoll);
  return sorted.map((s, idx) => ({
    'SL': idx + 1,
    'Student ID': formatSchoolScopedId(s.studentId, schoolCode) || s.studentId || '',
    'Admission No': s.admissionNo || formatSchoolScopedId(s.studentId, schoolCode) || '',
    'Admission Date': s.admissionDate || '',
    'Session': s.session || '',
    'Class': s.className || '',
    'Section': s.section || '',
    'Shift': s.shift || '',
    'Group': s.group || 'General',
    'Roll No': s.roll || '',
    'Student Name (English)': s.nameEn || '',
    'Student Name (Bangla)': s.nameBn || '',
    'Gender': s.gender || '',
    'Date of Birth': s.dob || '',
    'Blood Group': s.bloodGroup || 'Unknown',
    'Religion': s.religion || '',
    'Father Name (English)': s.fatherNameEn || '',
    'Father Name (Bangla)': s.fatherNameBn || '',
    'Father Mobile': s.fatherPhone || '',
    'Father NID': s.fatherNid || '',
    'Mother Name (English)': s.motherNameEn || '',
    'Mother Name (Bangla)': s.motherNameBn || '',
    'Mother Mobile': s.motherPhone || '',
    'Mother NID': s.motherNid || '',
    'Guardian Name': s.guardianName || '',
    'Guardian Relation': s.guardianRelation || '',
    'Guardian Mobile': s.guardianPhone || '',
    'Present Address': s.presentAddress || '',
    'Permanent Address': s.permanentAddress || '',
    'Previous School': s.previousSchool || '',
    'Birth Certificate No': s.birthCertificateNo || '',
    'Documents Attached': getAttachedDocsSummary(s),
    'Email': s.email || '',
    'Medical Notes': s.medicalNotes || '',
    'Status': s.status || 'active',
  }));
};

const computeAutoColWidths = (rows: Record<string, unknown>[], headers: string[]): XLSX.ColInfo[] => {
  return headers.map((header) => {
    let maxLen = header.length;
    for (const row of rows) {
      const val = row[header];
      const len = val !== undefined && val !== null ? String(val).length : 0;
      if (len > maxLen) maxLen = len;
    }
    return { wch: Math.min(Math.max(maxLen + 3, 10), 42) };
  });
};

const createWorksheetFromRows = (rows: Record<string, unknown>[], emptyFallbackHeaders?: string[]): XLSX.WorkSheet => {
  if (rows.length === 0) {
    const headers = emptyFallbackHeaders || ['Message'];
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 4, 14) }));
    return ws;
  }
  const headers = Object.keys(rows[0]);
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  ws['!cols'] = computeAutoColWidths(rows, headers);
  return ws;
};

export interface StudentSummaryRow {
  'Class': string;
  'Total Students': number;
  'Active': number;
  'Male': number;
  'Female': number;
  'Morning Shift': number;
  'Day Shift': number;
}

export const buildClassSummaryRows = (students: Student[]): StudentSummaryRow[] => {
  const classOrder = [
    'Nursery',
    'KG',
    'Class 1',
    'Class 2',
    'Class 3',
    'Class 4',
    'Class 5',
    'Class 6',
    'Class 7',
    'Class 8',
    'Class 9',
    'Class 10',
  ];
  const map = new Map<string, Student[]>();
  for (const s of students) {
    const cls = s.className || 'Other';
    if (!map.has(cls)) map.set(cls, []);
    map.get(cls)!.push(s);
  }
  const orderedClasses = [
    ...classOrder.filter((c) => map.has(c)),
    ...[...map.keys()].filter((c) => !classOrder.includes(c)),
  ];

  const rows: StudentSummaryRow[] = orderedClasses.map((cls) => {
    const list = map.get(cls) || [];
    return {
      'Class': cls,
      'Total Students': list.length,
      'Active': list.filter((s) => s.status === 'active').length,
      'Male': list.filter((s) => s.gender === 'Male').length,
      'Female': list.filter((s) => s.gender === 'Female').length,
      'Morning Shift': list.filter((s) => s.shift === 'Morning').length,
      'Day Shift': list.filter((s) => s.shift === 'Day').length,
    };
  });

  rows.push({
    'Class': 'TOTAL',
    'Total Students': students.length,
    'Active': students.filter((s) => s.status === 'active').length,
    'Male': students.filter((s) => s.gender === 'Male').length,
    'Female': students.filter((s) => s.gender === 'Female').length,
    'Morning Shift': students.filter((s) => s.shift === 'Morning').length,
    'Day Shift': students.filter((s) => s.shift === 'Day').length,
  });

  return rows;
};

export interface ExportStudentsExcelParams {
  allStudents: Student[];
  filteredStudents?: Student[];
  schoolName?: string;
  schoolCode?: string;
}

export const buildStudentAdmissionWorkbook = ({
  allStudents,
  filteredStudents,
  schoolCode,
}: ExportStudentsExcelParams): XLSX.WorkBook => {
  const wb = XLSX.utils.book_new();
  const allRows = buildStudentAdmissionExportRows(allStudents, schoolCode);
  const allHeaders = [
    'SL',
    'Student ID',
    'Admission No',
    'Admission Date',
    'Session',
    'Class',
    'Section',
    'Shift',
    'Group',
    'Roll No',
    'Student Name (English)',
    'Student Name (Bangla)',
    'Gender',
    'Date of Birth',
    'Blood Group',
    'Religion',
    'Father Name (English)',
    'Father Name (Bangla)',
    'Father Mobile',
    'Father NID',
    'Mother Name (English)',
    'Mother Name (Bangla)',
    'Mother Mobile',
    'Mother NID',
    'Guardian Name',
    'Guardian Relation',
    'Guardian Mobile',
    'Present Address',
    'Permanent Address',
    'Previous School',
    'Birth Certificate No',
    'Documents Attached',
    'Email',
    'Medical Notes',
    'Status',
  ];

  const allSheet = createWorksheetFromRows(allRows as unknown as Record<string, unknown>[], allHeaders);
  XLSX.utils.book_append_sheet(wb, allSheet, 'All Students');

  if (filteredStudents && filteredStudents.length !== allStudents.length) {
    const filteredRows = buildStudentAdmissionExportRows(filteredStudents, schoolCode);
    const filteredSheet = createWorksheetFromRows(
      filteredRows as unknown as Record<string, unknown>[],
      allHeaders
    );
    XLSX.utils.book_append_sheet(wb, filteredSheet, 'Filtered Students');
  }

  const summaryRows = buildClassSummaryRows(allStudents);
  const summarySheet = createWorksheetFromRows(summaryRows as unknown as Record<string, unknown>[]);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Class Summary');

  return wb;
};

export const exportStudentsAdmissionExcel = ({
  allStudents,
  filteredStudents,
  schoolName,
  schoolCode,
}: ExportStudentsExcelParams): string => {
  const wb = buildStudentAdmissionWorkbook({
    allStudents,
    filteredStudents,
    schoolName,
    schoolCode,
  });

  const safePrefix = (schoolName || 'school')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'school';
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `${safePrefix}_all_students_admission_info_${dateStamp}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
};

export const exportAdmissionEnquiriesExcel = (
  enquiries: AdmissionEnquiry[],
  schoolName?: string
): string => {
  const wb = XLSX.utils.book_new();
  const rows = enquiries.map((enq, idx) => ({
    'SL': idx + 1,
    'Application No': enq.applicationNo || '',
    'Applied Date': enq.appliedDate || '',
    'Applying Class': enq.applyingClass || '',
    'Applicant Name (English)': enq.applicantNameEn || '',
    'Applicant Name (Bangla)': enq.applicantNameBn || '',
    'Gender': enq.gender || '',
    'Date of Birth': enq.dob || '',
    'Blood Group': enq.bloodGroup || 'Unknown',
    'Guardian Name': enq.guardianName || '',
    'Phone': enq.phone || '',
    'Email': enq.email || '',
    'Address': enq.address || '',
    'Previous School': enq.previousSchool || '',
    'Previous GPA': enq.gpa || '',
    'Status': enq.status || 'Pending',
    'Remarks': enq.remarks || '',
  }));

  const ws = createWorksheetFromRows(rows as unknown as Record<string, unknown>[], [
    'SL',
    'Application No',
    'Applied Date',
    'Applying Class',
    'Applicant Name (English)',
    'Applicant Name (Bangla)',
    'Gender',
    'Date of Birth',
    'Blood Group',
    'Guardian Name',
    'Phone',
    'Email',
    'Address',
    'Previous School',
    'Previous GPA',
    'Status',
    'Remarks',
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Admission Enquiries');

  const safePrefix = (schoolName || 'school')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'school';
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `${safePrefix}_admission_applications_${dateStamp}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
};
