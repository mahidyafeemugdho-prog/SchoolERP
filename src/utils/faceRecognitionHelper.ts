export interface FaceCandidateInput<T = any> {
  person: T;
  vec: number[];
}

export interface FacePresenceAnalysis {
  hasContrast: boolean;
  hasSkinPresence: boolean;
  skinRatio: number;
  mean: number;
  stdDev: number;
}

export interface FaceMatchOptions {
  isSilentAuto: boolean;
  hasDetectedBox?: boolean;
}

export interface FaceMatchResult<T = any> {
  matched: boolean;
  isAmbiguous: boolean;
  threshold: number;
  bestCandidate: { person: T; similarity: number } | null;
  secondCandidate: { person: T; similarity: number } | null;
  displayConfidence: number;
}

const GRID_SIZE = 16;
const GRID_PIXELS = GRID_SIZE * GRID_SIZE; // 256

// Precompute smooth elliptical center-focus mask (1.0 in center face, 0.25 at outer background corners)
const OVAL_WEIGHTS: Float32Array = (() => {
  const weights = new Float32Array(GRID_PIXELS);
  const cx = (GRID_SIZE - 1) / 2;
  const cy = (GRID_SIZE - 1) / 2;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const nx = (x - cx) / 6.4;
      const ny = (y - cy) / 7.2;
      const rSq = nx * nx + ny * ny;
      // Smoothly taper off corners/background so shirt/wall changes don't dominate face geometry
      const w = rSq <= 1.0 ? 1.0 : Math.max(0.10, 1.0 - (rSq - 1.0) * 0.78);
      weights[y * GRID_SIZE + x] = w;
    }
  }
  return weights;
})();

function normalizeWeightedSection(arr: Float32Array, scaleWeight: number): Float32Array {
  let sum = 0;
  let weightSum = 0;
  for (let i = 0; i < arr.length; i++) {
    const w = arr.length === GRID_PIXELS ? OVAL_WEIGHTS[i] : 1;
    sum += arr[i] * w;
    weightSum += w;
  }
  const mean = weightSum > 0 ? sum / weightSum : 0;

  let normSq = 0;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const w = arr.length === GRID_PIXELS ? OVAL_WEIGHTS[i] : 1;
    const val = (arr[i] - mean) * w;
    out[i] = val;
    normSq += val * val;
  }
  const norm = Math.sqrt(normSq) || 1;
  for (let i = 0; i < arr.length; i++) {
    out[i] = (out[i] / norm) * scaleWeight;
  }
  return out;
}

/**
 * Builds an illumination-invariant facial descriptor vector from a 16x16 RGBA face crop
 * and an optional 8x8 RGBA crop:
 *  - 256 dims: oval-weighted luminance (macro shading)
 *  - 256 dims: oval-weighted horizontal gradient (eye/nose/face contour geometry)
 *  - 256 dims: oval-weighted vertical gradient (brow/eye/lip/chin geometry)
 *  - 192 dims (optional): normalized 8x8 RGB profile (low weight so ambient tint/clothes don't overpower)
 */
export function extractFaceDescriptorFromImageData(
  lumData16x16: ArrayLike<number>,
  rgbData8x8?: ArrayLike<number> | null
): number[] | null {
  if (!lumData16x16 || lumData16x16.length < GRID_PIXELS * 4) return null;

  const rawLum = new Float32Array(GRID_PIXELS);
  for (let i = 0, p = 0; p < GRID_PIXELS; i += 4, p++) {
    rawLum[p] = 0.299 * lumData16x16[i] + 0.587 * lumData16x16[i + 1] + 0.114 * lumData16x16[i + 2];
  }

  const gradX = new Float32Array(GRID_PIXELS);
  const gradY = new Float32Array(GRID_PIXELS);
  for (let y = 0; y < GRID_SIZE; y++) {
    const yUp = Math.max(0, y - 1);
    const yDown = Math.min(GRID_SIZE - 1, y + 1);
    for (let x = 0; x < GRID_SIZE; x++) {
      const xLeft = Math.max(0, x - 1);
      const xRight = Math.min(GRID_SIZE - 1, x + 1);
      const idx = y * GRID_SIZE + x;
      gradX[idx] = rawLum[y * GRID_SIZE + xRight] - rawLum[y * GRID_SIZE + xLeft];
      gradY[idx] = rawLum[yDown * GRID_SIZE + x] - rawLum[yUp * GRID_SIZE + x];
    }
  }

  const hasRgb = Boolean(rgbData8x8 && rgbData8x8.length >= 64 * 4);
  const normLum = normalizeWeightedSection(rawLum, hasRgb ? 0.36 : 0.40);
  const normGx = normalizeWeightedSection(gradX, hasRgb ? 0.28 : 0.31);
  const normGy = normalizeWeightedSection(gradY, hasRgb ? 0.26 : 0.29);

  const outLen = hasRgb ? GRID_PIXELS * 3 + 192 : GRID_PIXELS * 3;
  const finalVec: number[] = new Array(outLen);
  for (let i = 0; i < GRID_PIXELS; i++) {
    finalVec[i] = normLum[i];
    finalVec[GRID_PIXELS + i] = normGx[i];
    finalVec[GRID_PIXELS * 2 + i] = normGy[i];
  }

  if (hasRgb && rgbData8x8) {
    const rgbRaw = new Float32Array(192);
    for (let i = 0, p = 0; p < 192; i += 4, p += 3) {
      rgbRaw[p] = rgbData8x8[i];
      rgbRaw[p + 1] = rgbData8x8[i + 1];
      rgbRaw[p + 2] = rgbData8x8[i + 2];
    }
    const normRgb = normalizeWeightedSection(rgbRaw, 0.10);
    for (let i = 0; i < 192; i++) {
      finalVec[GRID_PIXELS * 3 + i] = normRgb[i];
    }
  }

  return finalVec;
}

/**
 * Checks whether a 16x16 center ROI contains real contrast AND human skin chrominance
 * (used when browser lacks native window.FaceDetector so blank walls/QR cards don't false-trigger).
 */
export function analyzeCenterFacePresence(rgba16x16: ArrayLike<number>): FacePresenceAnalysis {
  if (!rgba16x16 || rgba16x16.length < GRID_PIXELS * 4) {
    return { hasContrast: false, hasSkinPresence: false, skinRatio: 0, mean: 0, stdDev: 0 };
  }

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < GRID_PIXELS * 4; i += 4) {
    const lum = 0.299 * rgba16x16[i] + 0.587 * rgba16x16[i + 1] + 0.114 * rgba16x16[i + 2];
    sum += lum;
    sumSq += lum * lum;
  }

  const mean = sum / GRID_PIXELS;
  const stdDev = Math.sqrt(Math.max(0, sumSq / GRID_PIXELS - mean * mean));
  const hasContrast = stdDev >= 14 && mean >= 20 && mean <= 244;

  // Check inner face core (rows 2..13, cols 3..12 -> 120 pixels) using YCbCr skin chrominance
  let corePixels = 0;
  let skinPixels = 0;
  for (let y = 2; y <= 13; y++) {
    for (let x = 3; x <= 12; x++) {
      corePixels++;
      const idx = (y * GRID_SIZE + x) * 4;
      const r = rgba16x16[idx];
      const g = rgba16x16[idx + 1];
      const b = rgba16x16[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

      if (
        luma >= 28 &&
        luma <= 245 &&
        r > 40 &&
        g > 25 &&
        b > 12 &&
        r - Math.min(g, b) >= 12 &&
        r >= g * 0.95 &&
        r >= b * 0.95 &&
        cb >= 72 &&
        cb <= 136 &&
        cr >= 133 &&
        cr <= 182
      ) {
        skinPixels++;
      }
    }
  }

  const skinRatio = corePixels > 0 ? skinPixels / corePixels : 0;
  return {
    hasContrast,
    hasSkinPresence: hasContrast && skinRatio >= 0.10,
    skinRatio,
    mean,
    stdDev,
  };
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export function matchFaceDescriptor<T>(
  liveVectors: number[][],
  candidates: FaceCandidateInput<T>[],
  options: FaceMatchOptions
): FaceMatchResult<T> {
  let bestCandidate: { person: T; similarity: number } | null = null;
  let secondCandidate: { person: T; similarity: number } | null = null;

  if (liveVectors.length > 0 && candidates.length > 0) {
    for (const c of candidates) {
      let maxSim = -1;
      for (let i = 0; i < liveVectors.length; i++) {
        const sim = cosineSimilarity(liveVectors[i], c.vec);
        if (sim > maxSim) maxSim = sim;
      }
      if (!bestCandidate || maxSim > bestCandidate.similarity) {
        secondCandidate = bestCandidate;
        bestCandidate = { person: c.person, similarity: maxSim };
      } else if (!secondCandidate || maxSim > secondCandidate.similarity) {
        secondCandidate = { person: c.person, similarity: maxSim };
      }
    }
  }

  const count = candidates.length;
  const threshold = options.isSilentAuto
    ? options.hasDetectedBox
      ? count === 1
        ? 0.68
        : 0.71
      : count === 1
      ? 0.74
      : 0.76
    : count === 1
    ? 0.60
    : 0.65;

  const isAmbiguous = Boolean(
    bestCandidate &&
      secondCandidate &&
      count >= 2 &&
      (options.isSilentAuto
        ? bestCandidate.similarity < 0.84 && bestCandidate.similarity - secondCandidate.similarity < 0.035
        : bestCandidate.similarity < 0.78 && bestCandidate.similarity - secondCandidate.similarity < 0.025)
  );

  const matched = Boolean(bestCandidate && bestCandidate.similarity >= threshold && !isAmbiguous);
  const rawSim = bestCandidate ? bestCandidate.similarity : 0;
  const displayConfidence = Number(Math.min(99.4, Math.max(50, 62 + rawSim * 36)).toFixed(1));

  return {
    matched,
    isAmbiguous,
    threshold,
    bestCandidate,
    secondCandidate,
    displayConfidence,
  };
}
