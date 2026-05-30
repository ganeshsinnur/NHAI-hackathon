/**
 * BlazeFace Short Range TFLite output decoder.
 * Decodes raw SSD tensors (regressors + classifiers) into face bounding boxes.
 * All functions are worklet-safe — pure math, no external dependencies.
 */

export interface FaceDetection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

/**
 * Decode BlazeFace Short Range model output tensors into face bounding boxes.
 * Handles anchor generation, box decoding, sigmoid scoring, and NMS internally.
 *
 * The model outputs two tensors whose order may vary between builds:
 *   - Regressors  [1, 896, 16]  →  14 336 float32 values
 *   - Classifiers [1, 896, 1]   →    896 float32 values
 * We auto-detect which is which by buffer length.
 *
 * @param output0 First output tensor ArrayBuffer
 * @param output1 Second output tensor ArrayBuffer
 * @returns Detected face boxes in normalised [0, 1] coords, sorted by confidence
 */
export function decodeFaces(
  output0: ArrayBuffer,
  output1: ArrayBuffer,
  isThrottledFrame?: boolean,
): FaceDetection[] {
  'worklet';

  const buf0 = new Float32Array(output0);
  const buf1 = new Float32Array(output1);

  // Auto-detect tensor roles by element count
  let regressors: Float32Array;
  let classifiers: Float32Array;
  if (buf0.length > buf1.length) {
    regressors = buf0;
    classifiers = buf1;
  } else {
    regressors = buf1;
    classifiers = buf0;
  }

  const INPUT_SIZE = 128;
  const SCORE_THRESH = 0.45; // Lowered from 0.65 to 0.45 for much higher detection sensitivity under varied lighting/angles
  const IOU_THRESH = 0.3;

  // ── Generate 896 SSD anchors inline (<0.5 ms) ──────────────
  // BlazeFace Short Range: stride 8 → 2 anchors/loc, stride 16 → 6 anchors/loc
  const anchorX: number[] = [];
  const anchorY: number[] = [];

  // Layer 0  stride=8  grid=16×16  2 anchors → 512
  const grid0 = 16;
  for (let gy = 0; gy < grid0; gy++) {
    for (let gx = 0; gx < grid0; gx++) {
      const ax = (gx + 0.5) / grid0;
      const ay = (gy + 0.5) / grid0;
      anchorX.push(ax);
      anchorY.push(ay);
      anchorX.push(ax);
      anchorY.push(ay);
    }
  }

  // Layer 1  stride=16  grid=8×8  6 anchors → 384
  const grid1 = 8;
  for (let gy = 0; gy < grid1; gy++) {
    for (let gx = 0; gx < grid1; gx++) {
      const ax = (gx + 0.5) / grid1;
      const ay = (gy + 0.5) / grid1;
      for (let n = 0; n < 6; n++) {
        anchorX.push(ax);
        anchorY.push(ay);
      }
    }
  }

  // ── Decode detections above score threshold ────────────────
  const candidates: FaceDetection[] = [];
  const numAnchors = anchorX.length; // 896
  let maxScore = -1;

  for (let i = 0; i < numAnchors; i++) {
    const rawScore = classifiers[i];
    const score = 1.0 / (1.0 + Math.exp(-rawScore)); // sigmoid
    if (score > maxScore) {
      maxScore = score;
    }
    if (score < SCORE_THRESH) continue;

    const off = i * 16;
    // Regressor layout: [y_center, x_center, height, width, ...6 keypoints]
    const yCtr = anchorY[i] + regressors[off] / INPUT_SIZE;
    const xCtr = anchorX[i] + regressors[off + 1] / INPUT_SIZE;
    const h = regressors[off + 2] / INPUT_SIZE;
    const w = regressors[off + 3] / INPUT_SIZE;

    candidates.push({
      x1: Math.max(0, xCtr - w / 2),
      y1: Math.max(0, yCtr - h / 2),
      x2: Math.min(1, xCtr + w / 2),
      y2: Math.min(1, yCtr + h / 2),
      score,
    });
  }

  if (isThrottledFrame) {
    console.log(
      '[FaceAuth] [Decoder] Tensors size: Regressors=' + regressors.length + ', Classifiers=' + classifiers.length + 
      ' | Max Anchor Score found in frame: ' + maxScore.toFixed(4) + ' (threshold is ' + SCORE_THRESH + ')' +
      ' | Passed candidates: ' + candidates.length
    );
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // ── Non-Maximum Suppression ────────────────────────────────
  const kept: FaceDetection[] = [];
  const suppressed = new Array(candidates.length).fill(false);

  for (let i = 0; i < candidates.length; i++) {
    if (suppressed[i]) continue;
    kept.push(candidates[i]);

    for (let j = i + 1; j < candidates.length; j++) {
      if (suppressed[j]) continue;

      const xi1 = Math.max(candidates[i].x1, candidates[j].x1);
      const yi1 = Math.max(candidates[i].y1, candidates[j].y1);
      const xi2 = Math.min(candidates[i].x2, candidates[j].x2);
      const yi2 = Math.min(candidates[i].y2, candidates[j].y2);

      const inter = Math.max(0, xi2 - xi1) * Math.max(0, yi2 - yi1);
      const areaI =
        (candidates[i].x2 - candidates[i].x1) *
        (candidates[i].y2 - candidates[i].y1);
      const areaJ =
        (candidates[j].x2 - candidates[j].x1) *
        (candidates[j].y2 - candidates[j].y1);
      const iou = inter / (areaI + areaJ - inter + 1e-6);

      if (iou > IOU_THRESH) suppressed[j] = true;
    }
  }

  return kept;
}
