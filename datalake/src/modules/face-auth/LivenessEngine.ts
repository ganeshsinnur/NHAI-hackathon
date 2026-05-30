export interface LivenessDetails {
  texture: number;
  glare: number;
  movement: number;
  stable: number;
}

export type LivenessStatus = "NO_FACE" | "CHECKING" | "VERIFIED" | "SPOOF_DETECTED" | "SCREEN_DETECTED" | "SPOOF_SUSPECT";

export class FastLivenessEngine {
  private requiredStableFrames: number;
  private stableCount: number = 0;
  private lastFacePosition: { x: number; y: number } | null = null;
  private movementSum: number = 0.0;

  // Threshold configurations directly matching your Python scripts
  private minTextureVariance = 100.0;
  private maxGlareRatio = 0.05;
  private minMovement = 2.0;
  private maxMovement = 80.0;

  constructor(requiredStableFrames = 15) {
    this.requiredStableFrames = requiredStableFrames;
  }

  public reset() {
    this.stableCount = 0;
    this.lastFacePosition = null;
    this.movementSum = 0.0;
  }

  /**
   * NOTE: On mobile edge, full Laplacian texture variance calculation can be heavy inside JS.
   * If you are running this inside a native frame processor, you will pass raw grayscale values.
   */
  public check(
    glareRatio: number, 
    textureVariance: number, 
    faceBox: { x1: number; y1: number; x2: number; y2: number } | null
  ): { status: LivenessStatus; details: LivenessDetails } {
    
    if (!faceBox) {
      return { status: "NO_FACE", details: { texture: 0, glare: 1, movement: 0, stable: this.stableCount } };
    }

    // Micro-movement checking loop logic
    const currentX = (faceBox.x1 + faceBox.x2) / 2;
    const currentY = (faceBox.y1 + faceBox.y2) / 2;
    let movement = 0;

    if (this.lastFacePosition === null) {
      this.lastFacePosition = { x: currentX, y: currentY };
    } else {
      const dx = currentX - this.lastFacePosition.x;
      const dy = currentY - this.lastFacePosition.y;
      movement = Math.sqrt(dx * dx + dy * dy);
      this.lastFacePosition = { x: currentX, y: currentY };
      this.movementSum += movement;
    }

    const textureOk = textureVariance > this.minTextureVariance;
    const glareOk = glareRatio < this.maxGlareRatio;
    const movementOk = this.movementSum > this.minMovement && this.movementSum < this.maxMovement;

    const details: LivenessDetails = {
      texture: Math.round(textureVariance * 10) / 10,
      glare: Math.round(glareRatio * 1000) / 1000,
      movement: Math.round(movement * 10) / 10,
      stable: this.stableCount
    };

    if (textureOk && glareOk) {
      this.stableCount++;
    } else {
      this.stableCount = Math.max(0, this.stableCount - 1);
    }

    if (this.stableCount >= this.requiredStableFrames) {
      return { status: "VERIFIED", details };
    }
    if (!textureOk && !glareOk) {
      return { status: "SPOOF_DETECTED", details };
    } else if (!textureOk) {
      return { status: "SPOOF_SUSPECT", details };
    } else if (!glareOk) {
      return { status: "SCREEN_DETECTED", details };
    }

    return { status: "CHECKING", details };
  }
}