import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildStudentAdmissionExportRows,
  buildClassSummaryRows,
  buildStudentAdmissionWorkbook,
} from '../studentExcelExport';
import { Student } from '../../types';

const makeStudent = (overrides: Partial<Student>): Student => ({
  id: 'st_1',
  studentId: 'S-2026-1001',
  admissionNo: 'ADM-1001',
  nameEn: 'Tanvir Ahmed',
  nameBn: 'তানভীর আহমেদ',
  gender: 'Male',
  dob: '2012-05-10',
  bloodGroup: 'Unknown',
  religion: 'Islam',
  className: 'Class 10',
  section: 'A',
  shift: 'Day',
  group: 'Science',
  roll: '01',
  session: '2026',
  fatherNameEn: 'Anwar Hossain',
  fatherNameBn: 'আনোয়ার হোসেন',
  fatherPhone: '01711000001',
  fatherNid: '1980123456789',
  motherNameEn: 'Nasrin Sultana',
  motherNameBn: 'নাসরিন সুলতানা',
  motherNid: '1985123456789',
  guardianName: 'Anwar Hossain',
  guardianPhone: '01711000001',
  guardianRelation: 'Father',
  presentAddress: 'Mirpur, Dhaka',
  permanentAddress: 'Mirpur, Dhaka',
  previousSchool: 'Model Primary School',
  birthCertificateNo: '20122699900011122',
  status: 'active',
  admissionDate: '2026-01-05',
  ...overrides,
});

describe('studentExcelExport', () => {
  it('maps complete admission fields sorted by class and roll', () => {
    const s1 = makeStudent({ id: 'st_2', studentId: 'S-2026-1002', className: 'Class 10', roll: '02', nameEn: 'Rahim' });
    const s2 = makeStudent({ id: 'st_1', studentId: 'S-2026-1001', className: 'Class 9', roll: '01', nameEn: 'Karim', bloodGroup: 'O+' });

    const rows = buildStudentAdmissionExportRows([s1, s2], 'SCH003');
    expect(rows).toHaveLength(2);
    expect(rows[0]['SL']).toBe(1);
    expect(rows[0]['Class']).toBe('Class 9');
    expect(rows[0]['Student ID']).toBe('SCH003-S-2026-1001');
    expect(rows[0]['Blood Group']).toBe('O+');

    expect(rows[1]['SL']).toBe(2);
    expect(rows[1]['Class']).toBe('Class 10');
    expect(rows[1]['Blood Group']).toBe('Unknown');
    expect(rows[1]['Birth Certificate No']).toBe('20122699900011122');
    expect(rows[1]['Documents Attached']).toContain('Birth Certificate');
    expect(rows[1]['Documents Attached']).toContain('Father NID');
  });

  it('builds accurate class summary counts and total row', () => {
    const list = [
      makeStudent({ id: '1', className: 'Class 9', gender: 'Male', shift: 'Morning', status: 'active' }),
      makeStudent({ id: '2', className: 'Class 9', gender: 'Female', shift: 'Day', status: 'active' }),
      makeStudent({ id: '3', className: 'Class 10', gender: 'Male', shift: 'Day', status: 'transferred' }),
    ];

    const summary = buildClassSummaryRows(list);
    expect(summary).toHaveLength(3);
    expect(summary[0]).toMatchObject({
      'Class': 'Class 9',
      'Total Students': 2,
      'Active': 2,
      'Male': 1,
      'Female': 1,
      'Morning Shift': 1,
      'Day Shift': 1,
    });
    expect(summary[2]).toMatchObject({
      'Class': 'TOTAL',
      'Total Students': 3,
      'Active': 2,
    });
  });

  it('generates workbook with All Students, Filtered Students (when filtered), and Class Summary sheets', () => {
    const s1 = makeStudent({ id: '1', className: 'Class 9', roll: '01' });
    const s2 = makeStudent({ id: '2', className: 'Class 10', roll: '01' });

    const wb = buildStudentAdmissionWorkbook({
      allStudents: [s1, s2],
      filteredStudents: [s2],
      schoolCode: 'SCH003',
    });

    expect(wb.SheetNames).toEqual(['All Students', 'Filtered Students', 'Class Summary']);
    const allRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['All Students']);
    const filteredRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Filtered Students']);
    expect(allRows).toHaveLength(2);
    expect(filteredRows).toHaveLength(1);
    expect(filteredRows[0]['Class']).toBe('Class 10');
  });
});
