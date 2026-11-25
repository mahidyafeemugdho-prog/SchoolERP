import { describe, it, expect } from 'vitest';
import {
  HR_DOCUMENT_TYPES,
  buildDefaultHRPayload,
  calculateEmploymentDuration,
  canApproveHRDocuments,
  canCreateHRDocumentType,
  canDeleteHRDocuments,
  canManageAllHRDocuments,
  canViewHRDocument,
  createDefaultHRTemplate,
  formatHRSerialNumber,
  getNextHRSerialNumber,
} from '../hrDocumentHelpers';
import { buildHRDocumentPreviewHtml } from '../hrDocumentPdf';
import { isTabAuthorized } from '../permissions';
import { SchoolProfile, Staff, StaffHRDocument, UserProfile } from '../../types';

const mockSchool: Partial<SchoolProfile> = {
  schoolCode: 'SCH003',
  nameEn: 'Dhaka Model School & College',
  nameBn: 'ঢাকা মডেল স্কুল অ্যান্ড কলেজ',
  addressEn: 'Mirpur-10, Dhaka',
  phone: '+8801942529984',
  email: 'info@dhakamodel.edu.bd',
  eiin: '108245',
  principalNameEn: 'Prof. MD Rafiqul Islam',
  principalNameBn: 'অধ্যাপক মোঃ রফিকুল ইসলাম',
};

const mockStaff: Staff = {
  id: 'st_101',
  employeeId: 'EMP-101',
  nameEn: 'Mahmudul Hasan',
  nameBn: 'মাহমুদুল হাসান',
  gender: 'Male',
  designation: 'Senior Teacher',
  department: 'Science',
  subject: 'Physics',
  role: 'teacher',
  email: 'mahmud@school.edu.bd',
  phone: '01711112222',
  qualification: 'M.Sc in Physics',
  joiningDate: '2022-03-01',
  basicSalary: 30000,
  houseRentAllowance: 8000,
  medicalAllowance: 2000,
  otherAllowance: 1000,
  providentFundDeduction: 3000,
  status: 'active',
};

describe('hrDocumentHelpers', () => {
  it('supports all 11 official Bangladeshi school HR document types', () => {
    expect(HR_DOCUMENT_TYPES).toHaveLength(11);
    const types = HR_DOCUMENT_TYPES.map((t) => t.type);
    expect(types).toEqual([
      'appointment_letter',
      'joining_letter',
      'resignation_letter',
      'resignation_acceptance',
      'release_letter',
      'experience_certificate',
      'promotion_letter',
      'transfer_letter',
      'salary_increment_letter',
      'warning_letter',
      'show_cause_notice',
    ]);
  });

  it('generates sequential school & year scoped HR serial numbers', () => {
    expect(formatHRSerialNumber('sch003', 'appointment_letter', 2026, 7)).toBe(
      'SCH003/APPT/2026/0007'
    );

    const existing: StaffHRDocument[] = [
      {
        id: 'd1',
        schoolId: 'SCH003',
        employeeId: 'st_1',
        employeeCode: 'SCH003-EMP-101',
        employeeName: 'A',
        documentType: 'appointment_letter',
        documentNumber: 'SCH003/APPT/2026/0004',
        issueDate: '2026-02-10',
        language: 'bn',
        approvalStatus: 'Issued',
        createdByUid: 'u1',
        createdBy: 'Admin',
        createdByRole: 'admin',
        createdAt: '2026-02-10T00:00:00Z',
        updatedAt: '2026-02-10T00:00:00Z',
        documentData: { employeeNameEn: 'A', employeeCode: 'E1', designation: 'T', department: 'S' },
        auditLogs: [],
      },
      {
        id: 'd2',
        schoolId: 'SCH003',
        employeeId: 'st_2',
        employeeCode: 'SCH003-EMP-102',
        employeeName: 'B',
        documentType: 'joining_letter',
        documentNumber: 'SCH003/JOIN/2026/0012',
        issueDate: '2026-02-11',
        language: 'bn',
        approvalStatus: 'Pending',
        createdByUid: 'u2',
        createdBy: 'Teacher',
        createdByRole: 'teacher',
        createdAt: '2026-02-11T00:00:00Z',
        updatedAt: '2026-02-11T00:00:00Z',
        documentData: { employeeNameEn: 'B', employeeCode: 'E2', designation: 'T', department: 'S' },
        auditLogs: [],
      },
    ];

    expect(
      getNextHRSerialNumber(existing, 'SCH003', 'SCH003', 'appointment_letter', '2026-05-01')
    ).toBe('SCH003/APPT/2026/0005');
    expect(
      getNextHRSerialNumber(existing, 'SCH003', 'SCH003', 'experience_certificate', '2026-05-01')
    ).toBe('SCH003/EXP/2026/0001');
  });

  it('calculates exact employment duration in Years, Months, and Days (EN & BN)', () => {
    const exactTwoYears = calculateEmploymentDuration('2022-03-01', '2024-03-01');
    expect(exactTwoYears.years).toBe(2);
    expect(exactTwoYears.months).toBe(0);
    expect(exactTwoYears.days).toBe(0);
    expect(exactTwoYears.labelEn).toBe('2 Years');
    expect(exactTwoYears.labelBn).toBe('২ বছর');

    const mixed = calculateEmploymentDuration('2022-01-20', '2025-04-05');
    expect(mixed.years).toBe(3);
    expect(mixed.months).toBe(2);
    expect(mixed.days).toBe(16);
    expect(mixed.labelEn).toBe('3 Years, 2 Months, 16 Days');

    const invalid = calculateEmploymentDuration('2026-05-01', '2025-01-01');
    expect(invalid.totalDays).toBe(0);
    expect(invalid.labelEn).toBe('0 Days');
  });

  it('auto-populates Appointment Letter salary breakdown & profile fields', () => {
    const payload = buildDefaultHRPayload({
      documentType: 'appointment_letter',
      staff: mockStaff,
      school: mockSchool,
      schoolId: 'SCH003',
      language: 'en',
    });

    expect(payload.employeeNameEn).toBe('Mahmudul Hasan');
    expect(payload.designation).toBe('Senior Teacher');
    expect(payload.subject).toBe('Physics');
    expect(payload.salaryBreakdown?.grossSalary).toBe(41000);
    expect(payload.salaryBreakdown?.netSalary).toBe(38000);
    expect(payload.monthlySalary).toBe(38000);
    expect(payload.principalOrChairmanName).toBe('Prof. MD Rafiqul Islam');
  });

  it('enforces RBAC rules across MasterAdmin, SuperAdmin, Admin, HR, Teacher, Accountant, and Gatekeeper', () => {
    const basePerms = {
      manageStudents: false,
      manageAttendance: false,
      manageExams: false,
      manageFees: false,
      manageRoutine: false,
      manageHomework: false,
      manageLibrary: false,
    };
    const adminUser: UserProfile = {
      id: 'u_admin',
      name: 'Principal',
      nameBn: 'অধ্যক্ষ',
      email: 'principal@school.edu.bd',
      role: 'admin',
      username: 'principal',
    };
    const hrReceptionist: UserProfile = {
      id: 'u_hr',
      name: 'HR Staff',
      nameBn: 'এইচআর স্টাফ',
      email: 'hr@school.edu.bd',
      role: 'receptionist',
      username: 'hr_staff',
      permissions: { ...basePerms, manageHrDocuments: true },
    };
    const teacherUser: UserProfile = {
      id: 'u_teacher',
      authUid: 'uid_teacher',
      name: 'Mahmudul Hasan',
      nameBn: 'মাহমুদুল হাসান',
      email: 'mahmud@school.edu.bd',
      role: 'teacher',
      username: 'mahmud',
      linkedStaffId: 'st_101',
    };
    const accountantAllowed: UserProfile = {
      id: 'u_acc1',
      name: 'Accountant',
      nameBn: 'হিসাবরক্ষক',
      email: 'acc@school.edu.bd',
      role: 'accountant',
      username: 'acc',
      permissions: { ...basePerms, viewSalaryDocuments: true, manageFees: true },
    };
    const accountantBlocked: UserProfile = {
      id: 'u_acc2',
      name: 'Blocked Accountant',
      nameBn: 'সীমিত হিসাবরক্ষক',
      email: 'acc2@school.edu.bd',
      role: 'accountant',
      username: 'acc2',
      permissions: { ...basePerms, viewSalaryDocuments: false, manageFees: false, manageHrDocuments: false },
    };
    const gatekeeperUser: UserProfile = {
      id: 'u_gate',
      name: 'Gate Kiosk',
      nameBn: 'গেট কিওস্ক',
      email: 'gate@school.edu.bd',
      role: 'gatekeeper',
      username: 'gate',
      permissions: { ...basePerms, onlyQrAttendanceKiosk: true },
    };

    expect(isTabAuthorized('staff_documents', 'super_admin', adminUser)).toBe(true);
    expect(isTabAuthorized('staff_documents', 'admin', adminUser)).toBe(true);
    expect(isTabAuthorized('staff_documents', 'teacher', teacherUser)).toBe(true);
    expect(isTabAuthorized('staff_documents', 'accountant', accountantAllowed)).toBe(true);
    expect(isTabAuthorized('staff_documents', 'accountant', accountantBlocked)).toBe(false);
    expect(isTabAuthorized('staff_documents', 'gatekeeper', gatekeeperUser)).toBe(false);

    expect(canManageAllHRDocuments('receptionist', hrReceptionist)).toBe(true);
    expect(canApproveHRDocuments('receptionist')).toBe(false);
    expect(canApproveHRDocuments('admin')).toBe(true);
    expect(canDeleteHRDocuments('receptionist')).toBe(false);
    expect(canDeleteHRDocuments('super_admin')).toBe(true);

    // Teachers can only submit Joining and Resignation self-service documents
    expect(canCreateHRDocumentType('joining_letter', 'teacher', teacherUser)).toBe(true);
    expect(canCreateHRDocumentType('resignation_letter', 'teacher', teacherUser)).toBe(true);
    expect(canCreateHRDocumentType('appointment_letter', 'teacher', teacherUser)).toBe(false);
    expect(canCreateHRDocumentType('warning_letter', 'teacher', teacherUser)).toBe(false);

    const apptDoc: StaffHRDocument = {
      id: 'doc_appt',
      schoolId: 'SCH003',
      employeeId: 'st_101',
      employeeCode: 'SCH003-EMP-101',
      employeeName: 'Mahmudul Hasan',
      documentType: 'appointment_letter',
      documentNumber: 'SCH003/APPT/2026/0001',
      issueDate: '2026-03-01',
      language: 'en',
      approvalStatus: 'Issued',
      createdByUid: 'u_admin',
      createdBy: 'Principal',
      createdByRole: 'admin',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
      documentData: { employeeNameEn: 'Mahmudul Hasan', employeeCode: 'SCH003-EMP-101', designation: 'Teacher', department: 'Science' },
      auditLogs: [],
    };
    const warnOtherDoc: StaffHRDocument = {
      ...apptDoc,
      id: 'doc_warn',
      employeeId: 'st_999',
      employeeCode: 'SCH003-EMP-999',
      employeeName: 'Other Staff',
      documentType: 'warning_letter',
      documentNumber: 'SCH003/WARN/2026/0001',
    };

    // Teacher sees own Appointment Letter, never someone else's Warning Letter
    expect(canViewHRDocument(apptDoc, 'teacher', teacherUser, [mockStaff])).toBe(true);
    expect(canViewHRDocument(warnOtherDoc, 'teacher', teacherUser, [mockStaff])).toBe(false);

    // Accountant with salary permission sees Appointment/Increment docs, never Warning Letters
    expect(canViewHRDocument(apptDoc, 'accountant', accountantAllowed)).toBe(true);
    expect(canViewHRDocument(warnOtherDoc, 'accountant', accountantAllowed)).toBe(false);
    expect(canViewHRDocument(apptDoc, 'accountant', accountantBlocked)).toBe(false);
  });

  it('escapes HTML & blocks javascript: media URLs inside A4 HTML preview', () => {
    const template = createDefaultHRTemplate('SCH003');
    const maliciousDoc: StaffHRDocument = {
      id: 'doc_xss',
      schoolId: 'SCH003',
      employeeId: 'st_101',
      employeeCode: 'EMP-101',
      employeeName: '<script>alert(1)</script>Bad Name',
      documentType: 'warning_letter',
      documentNumber: 'SCH003/WARN/2026/0001',
      issueDate: '2026-05-01',
      language: 'en',
      approvalStatus: 'Issued',
      createdByUid: 'u1',
      createdBy: 'Admin',
      createdByRole: 'admin',
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
      documentData: {
        employeeNameEn: '<script>alert(1)</script>Bad Name',
        employeeCode: 'EMP-101',
        designation: 'Teacher',
        department: 'Science',
        employeePhotoUrl: 'javascript:alert(1)',
        includeEmployeePhoto: true,
        reasonOrAllegation: '<img src=x onerror=alert(2)>',
      },
      auditLogs: [],
    };

    const html = buildHRDocumentPreviewHtml(maliciousDoc, mockSchool, template);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
