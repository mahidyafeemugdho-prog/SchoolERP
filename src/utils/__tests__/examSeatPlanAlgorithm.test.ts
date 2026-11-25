import { describe, it, expect } from 'vitest';
import { allocateExamSeats } from '../examSeatPlanAlgorithm';
import { ExamSeatRoom, ShiftType, Student } from '../../types';

const makeStudent = (
  id: string,
  roll: string,
  className = 'Class 10',
  section = 'A',
  shift: ShiftType = 'Day'
): Student => ({
  id,
  studentId: `S-${id}`,
  nameEn: `Student ${roll}`,
  nameBn: `শিক্ষার্থী ${roll}`,
  className,
  section,
  shift,
  roll,
  session: '2026',
  gender: 'Male',
  dob: '2010-01-01',
  bloodGroup: 'A+',
  religion: 'Islam',
  fatherNameEn: 'Father',
  fatherNameBn: 'পিতা',
  motherNameEn: 'Mother',
  motherNameBn: 'মাতা',
  guardianName: 'Guardian',
  guardianPhone: '01700000000',
  guardianRelation: 'Father',
  presentAddress: 'Dhaka',
  permanentAddress: 'Dhaka',
  status: 'active',
  admissionDate: '2026-01-01',
});

const twoSeatRoom: ExamSeatRoom = {
  id: 'room_101',
  roomNo: 'Room 101',
  building: 'Academic Building',
  columns: 1,
  benchesPerColumn: 5,
  seatsPerBench: 2,
};

const threeSeatRoom: ExamSeatRoom = {
  id: 'room_102',
  roomNo: 'Room 102',
  building: 'Academic Building',
  columns: 1,
  benchesPerColumn: 4,
  seatsPerBench: 3,
};

describe('allocateExamSeats (all 3 strategies)', () => {
  const sixSingleClassStudents = [
    makeStudent('1', '01'),
    makeStudent('2', '02'),
    makeStudent('3', '03'),
    makeStudent('4', '04'),
    makeStudent('5', '05'),
    makeStudent('6', '06'),
  ];

  it('1. sequential seats students strictly in roll order', () => {
    const result = allocateExamSeats({
      examId: 'exam_1',
      rooms: [twoSeatRoom],
      eligibleStudents: sixSingleClassStudents,
      strategy: 'sequential',
    });

    const benches = [
      result.filter((a) => a.benchNumber === 1).map((a) => a.roll),
      result.filter((a) => a.benchNumber === 2).map((a) => a.roll),
      result.filter((a) => a.benchNumber === 3).map((a) => a.roll),
    ];
    expect(benches).toEqual([
      ['01', '02'],
      ['03', '04'],
      ['05', '06'],
    ]);
  });

  it('2. zigzag_class alternates two classes side-by-side and front/back', () => {
    const mixedClassStudents = [
      makeStudent('c9_1', '01', 'Class 9'),
      makeStudent('c9_2', '02', 'Class 9'),
      makeStudent('c9_3', '03', 'Class 9'),
      makeStudent('c10_1', '01', 'Class 10'),
      makeStudent('c10_2', '02', 'Class 10'),
      makeStudent('c10_3', '03', 'Class 10'),
    ];

    const result = allocateExamSeats({
      examId: 'exam_1',
      rooms: [twoSeatRoom],
      eligibleStudents: mixedClassStudents,
      strategy: 'zigzag_class',
    });

    const benches = [
      result.filter((a) => a.benchNumber === 1).map((a) => `${a.className}:${a.roll}`),
      result.filter((a) => a.benchNumber === 2).map((a) => `${a.className}:${a.roll}`),
      result.filter((a) => a.benchNumber === 3).map((a) => `${a.className}:${a.roll}`),
    ];

    expect(benches).toEqual([
      ['Class 9:01', 'Class 10:01'],
      ['Class 10:02', 'Class 9:02'],
      ['Class 9:03', 'Class 10:03'],
    ]);
  });

  it('2b. zigzag_class separates rolls in checkerboard pattern even with single class and single section', () => {
    const result = allocateExamSeats({
      examId: 'exam_1',
      rooms: [twoSeatRoom],
      eligibleStudents: sixSingleClassStudents,
      strategy: 'zigzag_class',
    });

    const benches = [
      result.filter((a) => a.benchNumber === 1).map((a) => a.roll),
      result.filter((a) => a.benchNumber === 2).map((a) => a.roll),
      result.filter((a) => a.benchNumber === 3).map((a) => a.roll),
    ];

    expect(benches).toEqual([
      ['01', '04'],
      ['05', '02'],
      ['03', '06'],
    ]);
  });

  it('3. zigzag_roll (Split Half Interleaved) pairs distant rolls on 2-seat benches', () => {
    const result = allocateExamSeats({
      examId: 'exam_1',
      rooms: [twoSeatRoom],
      eligibleStudents: sixSingleClassStudents,
      strategy: 'zigzag_roll',
    });

    const benches = [
      result.filter((a) => a.benchNumber === 1).map((a) => a.roll),
      result.filter((a) => a.benchNumber === 2).map((a) => a.roll),
      result.filter((a) => a.benchNumber === 3).map((a) => a.roll),
    ];

    expect(benches).toEqual([
      ['01', '04'],
      ['02', '05'],
      ['03', '06'],
    ]);
  });

  it('3b. zigzag_roll adapts to 3-seat benches so consecutive rolls do not sit together', () => {
    const nineStudents = Array.from({ length: 9 }, (_, i) =>
      makeStudent(String(i + 1), String(i + 1).padStart(2, '0'))
    );

    const result = allocateExamSeats({
      examId: 'exam_1',
      rooms: [threeSeatRoom],
      eligibleStudents: nineStudents,
      strategy: 'zigzag_roll',
    });

    const benches = [
      result.filter((a) => a.benchNumber === 1).map((a) => a.roll),
      result.filter((a) => a.benchNumber === 2).map((a) => a.roll),
      result.filter((a) => a.benchNumber === 3).map((a) => a.roll),
    ];

    expect(benches).toEqual([
      ['01', '04', '07'],
      ['02', '05', '08'],
      ['03', '06', '09'],
    ]);
  });

  it('stops cleanly at room capacity when students overflow', () => {
    const smallRoom: ExamSeatRoom = { ...twoSeatRoom, benchesPerColumn: 2 }; // 4 seats max
    const result = allocateExamSeats({
      examId: 'exam_1',
      rooms: [smallRoom],
      eligibleStudents: sixSingleClassStudents,
      strategy: 'zigzag_roll',
    });

    expect(result).toHaveLength(4);
  });
});
