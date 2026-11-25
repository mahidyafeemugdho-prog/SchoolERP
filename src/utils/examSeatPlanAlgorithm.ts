import { ExamSeatAssignment, ExamSeatRoom, Student } from '../types';

export type SeatStrategy = 'sequential' | 'zigzag_class' | 'zigzag_roll';

/**
 * Generates an ordered bench-by-bench seat allocation queue across rooms.
 * Supports:
 * - 'sequential': Strict class & roll ascending order
 * - 'zigzag_class': Anti-copy interleaving across classes -> sections -> shifts -> split-half fallback,
 *   with checkerboard alternating bench seat positions so front/back & side neighbors differ.
 * - 'zigzag_roll': Split-N roll interleaving matching room bench capacity (halves for 2-seat benches,
 *   thirds for 3-seat benches) so consecutive rolls never share the same bench.
 */
export function allocateExamSeats(params: {
  examId: string;
  rooms: ExamSeatRoom[];
  eligibleStudents: Student[];
  strategy: SeatStrategy;
  selectedClassesCount?: number;
}): ExamSeatAssignment[] {
  const { examId, rooms, eligibleStudents, strategy } = params;
  if (!rooms.length || !eligibleStudents.length) return [];

  // Pre-build global ordered queue for sequential & split-half roll strategies,
  // or per-bench seat assignment so each room's seatsPerBench is respected accurately.
  const totalStudents = eligibleStudents.length;

  // Determine buckets for zigzag_class
  const buildZigZagBuckets = (): Student[][] => {
    // 1. Bucket by class if >1 distinct classes present
    const classBuckets = new Map<string, Student[]>();
    eligibleStudents.forEach((st) => {
      const k = st.className || 'Class';
      if (!classBuckets.has(k)) classBuckets.set(k, []);
      classBuckets.get(k)!.push(st);
    });
    if (classBuckets.size > 1) {
      return Array.from(classBuckets.values());
    }

    // 2. Bucket by section if >1 distinct sections present
    const sectionBuckets = new Map<string, Student[]>();
    eligibleStudents.forEach((st) => {
      const k = `${st.className}_${st.section || 'A'}`;
      if (!sectionBuckets.has(k)) sectionBuckets.set(k, []);
      sectionBuckets.get(k)!.push(st);
    });
    if (sectionBuckets.size > 1) {
      return Array.from(sectionBuckets.values());
    }

    // 3. Bucket by shift if >1 distinct shifts present
    const shiftBuckets = new Map<string, Student[]>();
    eligibleStudents.forEach((st) => {
      const k = st.shift || 'Day';
      if (!shiftBuckets.has(k)) shiftBuckets.set(k, []);
      shiftBuckets.get(k)!.push(st);
    });
    if (shiftBuckets.size > 1) {
      return Array.from(shiftBuckets.values());
    }

    // 4. Single class + single section + single shift fallback: split into 2 halves so Anti-Copy still separates consecutive rolls
    const half = Math.ceil(totalStudents / 2);
    const first = eligibleStudents.slice(0, half);
    const second = eligibleStudents.slice(half);
    return second.length > 0 ? [first, second] : [first];
  };

  // Build N-way split slices for split-half / split-N roll interleaving
  const buildSplitInterleavedQueue = (slicesCount: number): Student[] => {
    const groups = Math.max(2, slicesCount);
    const chunkSize = Math.ceil(totalStudents / groups);
    const chunks: Student[][] = [];
    for (let g = 0; g < groups; g++) {
      const slice = eligibleStudents.slice(g * chunkSize, (g + 1) * chunkSize);
      if (slice.length > 0) chunks.push(slice);
    }
    const queue: Student[] = [];
    let idx = 0;
    let added = true;
    while (added) {
      added = false;
      for (const ch of chunks) {
        if (idx < ch.length) {
          queue.push(ch[idx]);
          added = true;
        }
      }
      idx++;
    }
    return queue;
  };

  const generated: ExamSeatAssignment[] = [];

  if (strategy === 'sequential') {
    let cursor = 0;
    for (const room of rooms) {
      if (cursor >= totalStudents) break;
      let benchCounter = 1;
      for (let col = 1; col <= room.columns; col++) {
        for (let row = 1; row <= room.benchesPerColumn; row++) {
          const currentBenchNo = benchCounter++;
          for (let seatPos = 1; seatPos <= room.seatsPerBench; seatPos++) {
            if (cursor >= totalStudents) break;
            const st = eligibleStudents[cursor++];
            generated.push(
              createAssignment(examId, room, col, currentBenchNo, seatPos, st)
            );
          }
        }
      }
    }
    return generated;
  }

  if (strategy === 'zigzag_roll') {
    // Use dominant seatsPerBench from rooms (or first room) to ensure no adjacent same-bench consecutive rolls
    const primaryBenchSeats = rooms[0]?.seatsPerBench || 2;
    const queue = buildSplitInterleavedQueue(primaryBenchSeats);
    let cursor = 0;
    for (const room of rooms) {
      if (cursor >= queue.length) break;
      let benchCounter = 1;
      for (let col = 1; col <= room.columns; col++) {
        for (let row = 1; row <= room.benchesPerColumn; row++) {
          const currentBenchNo = benchCounter++;
          for (let seatPos = 1; seatPos <= room.seatsPerBench; seatPos++) {
            if (cursor >= queue.length) break;
            const st = queue[cursor++];
            generated.push(
              createAssignment(examId, room, col, currentBenchNo, seatPos, st)
            );
          }
        }
      }
    }
    return generated;
  }

  // Strategy: 'zigzag_class' — Checkerboard / Zig-Zag rotation across benches
  const buckets = buildZigZagBuckets();
  const cursors = buckets.map(() => 0);
  const totalRemaining = () =>
    buckets.reduce((sum, list, idx) => sum + (list.length - cursors[idx]), 0);

  const pickNextFromBucket = (bucketIdx: number): Student | null => {
    const list = buckets[bucketIdx];
    if (cursors[bucketIdx] < list.length) {
      return list[cursors[bucketIdx]++];
    }
    // Fallback to any non-empty bucket (round-robin from next bucket)
    for (let offset = 1; offset < buckets.length; offset++) {
      const altIdx = (bucketIdx + offset) % buckets.length;
      if (cursors[altIdx] < buckets[altIdx].length) {
        return buckets[altIdx][cursors[altIdx]++];
      }
    }
    return null;
  };

  let globalBenchIndex = 0;
  for (const room of rooms) {
    if (totalRemaining() === 0) break;
    let benchCounter = 1;
    for (let col = 1; col <= room.columns; col++) {
      for (let row = 1; row <= room.benchesPerColumn; row++) {
        const currentBenchNo = benchCounter++;
        const benchOrderShift = globalBenchIndex % buckets.length;
        globalBenchIndex++;
        for (let seatPos = 1; seatPos <= room.seatsPerBench; seatPos++) {
          if (totalRemaining() === 0) break;
          // Shift starting bucket on every alternating bench so front/back neighbors differ too!
          const targetBucket = (benchOrderShift + (seatPos - 1)) % buckets.length;
          const st = pickNextFromBucket(targetBucket);
          if (!st) break;
          generated.push(
            createAssignment(examId, room, col, currentBenchNo, seatPos, st)
          );
        }
      }
    }
  }

  return generated;
}

function createAssignment(
  examId: string,
  room: ExamSeatRoom,
  columnIndex: number,
  benchNumber: number,
  seatPosition: number,
  st: Student
): ExamSeatAssignment {
  const seatLetter = seatPosition === 1 ? 'A' : seatPosition === 2 ? 'B' : 'C';
  return {
    id: `seat_${examId}_${room.id}_${benchNumber}_${seatPosition}`,
    examId,
    roomId: room.id,
    roomNo: room.roomNo,
    columnIndex,
    benchNumber,
    seatPosition,
    seatLabel: `${room.roomNo}-B${benchNumber}-${seatLetter}`,
    studentId: st.id,
    studentCode: st.studentId,
    studentNameEn: st.nameEn,
    studentNameBn: st.nameBn || st.nameEn,
    className: st.className,
    section: st.section,
    shift: st.shift,
    group: st.group,
    roll: st.roll,
  };
}
