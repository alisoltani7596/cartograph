/**
 * Long receipts are much taller than they are wide. Vision models downscale big
 * images, which makes small print unreadable, so tall images are cut into tiles.
 * Cuts are placed on blank horizontal bands so no printed line is split in half.
 */
export const MAX_LONG_EDGE = 2400;
export const MAX_WIDTH = 1100;

export interface TilePlan {
  /** Scale to apply to the source before cutting. */
  scale: number;
  /** [startY, endY) in scaled pixels. */
  tiles: [number, number][];
}

/**
 * @param rowInk per-row darkness of the scaled image, 0 (blank) .. 1 (all ink)
 */
export function planTiles(width: number, height: number, rowInkAt: (y: number) => number): TilePlan {
  const scale = Math.min(1, MAX_WIDTH / width);
  const h = Math.round(height * scale);
  const maxTile = MAX_LONG_EDGE;
  if (h <= maxTile) return { scale, tiles: [[0, h]] };
  const tiles: [number, number][] = [];
  let start = 0;
  while (h - start > maxTile) {
    const target = start + maxTile;
    const searchFrom = Math.max(start + Math.floor(maxTile * 0.6), 0);
    let best = target;
    let bestInk = Infinity;
    // Prefer the blank row closest to the limit (scan upward from the limit).
    for (let y = target; y >= searchFrom; y--) {
      const ink = rowInkAt(Math.floor(y / scale));
      if (ink < bestInk - 1e-6) {
        bestInk = ink;
        best = y;
      }
      if (ink === 0) break;
    }
    tiles.push([start, best]);
    start = best;
  }
  tiles.push([start, h]);
  return { scale, tiles };
}

/**
 * Per-row "ink" measured as the share of strong horizontal edges, so a dark table
 * or background around a photographed receipt still counts as blank.
 */
export function rowInkProfile(gray: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let edges = 0;
    const o = y * width;
    for (let x = 1; x < width; x++) if (Math.abs(gray[o + x] - gray[o + x - 1]) > 48) edges++;
    out[y] = edges <= 6 ? 0 : edges / width;
  }
  return out;
}
