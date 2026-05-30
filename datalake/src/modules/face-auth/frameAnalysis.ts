/**
 * Lightweight frame analysis utilities for liveness detection.
 * Worklet-safe — pure math operating on the RGB float32 buffer
 * returned by vision-camera-resize-plugin.
 *
 * These are *proxy* heuristics (not full Laplacian / histogram):
 *   - computeTextureProxy  → variance of sampled luminance (higher = more real texture)
 *   - computeGlareProxy    → ratio of very bright pixels   (lower  = less screen glare)
 *
 * Both sample every 2nd pixel in each axis for speed (~200–400 samples on a 128×128 crop).
 */

/**
 * Compute texture variance as a Laplacian proxy.
 * Real faces exhibit higher pixel-level variance than flat photos / screens.
 *
 * @param buffer  RGB float32 interleaved buffer [0.0–1.0], from resize plugin
 * @param width   Buffer width in pixels
 * @param height  Buffer height in pixels
 * @param faceBox Normalised [0,1] bounding box
 * @returns Variance scaled to 0–255² range (matches LivenessEngine.minTextureVariance = 100)
 */
export function computeTextureProxy(
  buffer: ArrayBufferLike,
  width: number,
  height: number,
  faceBox: { x1: number; y1: number; x2: number; y2: number },
): number {
  'worklet';

  const pixels = new Float32Array(buffer);

  const startX = Math.max(0, Math.floor(faceBox.x1 * width));
  const startY = Math.max(0, Math.floor(faceBox.y1 * height));
  const endX = Math.min(width, Math.ceil(faceBox.x2 * width));
  const endY = Math.min(height, Math.ceil(faceBox.y2 * height));

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = startY; y < endY; y += 2) {
    for (let x = startX; x < endX; x += 2) {
      const idx = (y * width + x) * 3;
      // BT.601 luminance scaled to [0, 255]
      const lum =
        pixels[idx] * 76.245 +
        pixels[idx + 1] * 149.685 +
        pixels[idx + 2] * 29.07;
      sum += lum;
      sumSq += lum * lum;
      count++;
    }
  }

  if (count < 4) return 0;

  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/**
 * Compute glare ratio — proportion of overly bright pixels in the face region.
 * Screens and glossy printouts produce higher ratios than real faces.
 *
 * @param buffer  RGB float32 interleaved buffer [0.0–1.0]
 * @param width   Buffer width
 * @param height  Buffer height
 * @param faceBox Normalised [0,1] bounding box
 * @returns Ratio 0.0–1.0. Threshold: < 0.05 for real faces.
 */
export function computeGlareProxy(
  buffer: ArrayBufferLike,
  width: number,
  height: number,
  faceBox: { x1: number; y1: number; x2: number; y2: number },
): number {
  'worklet';

  const pixels = new Float32Array(buffer);

  const startX = Math.max(0, Math.floor(faceBox.x1 * width));
  const startY = Math.max(0, Math.floor(faceBox.y1 * height));
  const endX = Math.min(width, Math.ceil(faceBox.x2 * width));
  const endY = Math.min(height, Math.ceil(faceBox.y2 * height));

  const BRIGHT_THRESHOLD = 0.94; // ≈ 240 / 255
  let brightCount = 0;
  let totalCount = 0;

  for (let y = startY; y < endY; y += 2) {
    for (let x = startX; x < endX; x += 2) {
      const idx = (y * width + x) * 3;
      const lum =
        pixels[idx] * 0.299 +
        pixels[idx + 1] * 0.587 +
        pixels[idx + 2] * 0.114;
      if (lum > BRIGHT_THRESHOLD) brightCount++;
      totalCount++;
    }
  }

  return totalCount === 0 ? 0 : brightCount / totalCount;
}
