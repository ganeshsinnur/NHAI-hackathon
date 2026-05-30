/**
 * Calculates the dot product of two arrays (Cosine Similarity since vectors are normalized)
 */
export function matchFace(liveEmbedding: number[], storedDb: Record<string, { name: string; embedding: number[] }>, threshold = 0.55) {
  let bestId: string | null = null;
  let bestScore = -1;

  const entries = Object.entries(storedDb);
  
  for (const [empId, data] of entries) {
    let dotProduct = 0;
    // Calculate vector multiplication loop inline for blazing speeds
    for (let i = 0; i < liveEmbedding.length; i++) {
      dotProduct += liveEmbedding[i] * data.embedding[i];
    }

    if (dotProduct > bestScore) {
      bestScore = dotProduct;
      bestId = empId;
    }
  }

  if (bestScore >= threshold) {
    return { empId: bestId, score: bestScore };
  }
  return { empId: null, score: bestScore };
}