import type { MemoryAudience, MemoryEdge, MemoryEntry, MemoryUseScope } from "./index.js";
import { scoreTemporalMemoryEdges, type TemporalMemoryEdgeExclusionReason } from "./memory-scoring.js";

export type MemoryRetrievalExclusionReason =
  | "low_confidence"
  | "low_temporal_score"
  | "stale"
  | "ambiguous"
  | TemporalMemoryEdgeExclusionReason;

export type MemoryRetrievalExclusion = {
  id: string;
  type: "memory" | "edge";
  reason: MemoryRetrievalExclusionReason;
  confidence?: number;
  score?: number;
};

export type MemoryRetrievalMetadata = {
  includedMemoryIds: string[];
  includedEdgeIds: string[];
  excluded: MemoryRetrievalExclusion[];
};

type GateableMemoryEntry = Pick<MemoryEntry, "id" | "confidence" | "updatedAt">;
type GateableMemoryEdge = Pick<
  MemoryEdge,
  | "id"
  | "ownerId"
  | "weight"
  | "confidence"
  | "evidenceCount"
  | "status"
  | "visibility"
  | "validFrom"
  | "validUntil"
  | "lastEvidenceAt"
  | "decayPolicy"
  | "supersededByEdgeId"
>;

export type MemoryRetrievalThresholds = {
  entryMinConfidence: number;
  edgeMinConfidence: number;
  minTemporalScore?: number;
  maxEntryAgeDays?: number;
};

export function memoryRetrievalThresholds(purpose: MemoryUseScope): MemoryRetrievalThresholds {
  if (purpose === "intake_default") return { entryMinConfidence: 0.65, edgeMinConfidence: 0.6 };
  if (purpose === "ranking_signal") {
    return {
      entryMinConfidence: 0.75,
      edgeMinConfidence: 0.6,
      minTemporalScore: 0.15,
    };
  }
  return { entryMinConfidence: 0.6, edgeMinConfidence: 0.6 };
}

function daysBetween(later: Date, earlier: Date) {
  return Math.max(0, (later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000));
}

export function filterMemoryRetrieval<
  TEntry extends GateableMemoryEntry,
  TEdge extends GateableMemoryEdge,
>(input: {
  entries: TEntry[];
  edges: TEdge[];
  purpose: MemoryUseScope;
  audience: MemoryAudience;
  now?: Date;
}): { entries: TEntry[]; edges: TEdge[]; metadata: MemoryRetrievalMetadata } {
  const thresholds = memoryRetrievalThresholds(input.purpose);
  const now = input.now ?? new Date();
  const includedEntries: TEntry[] = [];
  const includedEdges: TEdge[] = [];
  const excluded: MemoryRetrievalExclusion[] = [];

  for (const entry of input.entries) {
    if (entry.confidence < thresholds.entryMinConfidence) {
      excluded.push({
        id: entry.id,
        type: "memory",
        reason: "low_confidence",
        confidence: entry.confidence,
      });
      continue;
    }
    if (thresholds.maxEntryAgeDays && daysBetween(now, entry.updatedAt) > thresholds.maxEntryAgeDays) {
      excluded.push({
        id: entry.id,
        type: "memory",
        reason: "stale",
        confidence: entry.confidence,
      });
      continue;
    }
    includedEntries.push(entry);
  }

  const temporalScores = scoreTemporalMemoryEdges(input.edges, now);
  const scoresById = new Map(temporalScores.included.map((score) => [score.edgeId, score]));
  const temporalExclusionsById = new Map(temporalScores.excluded.map((exclusion) => [exclusion.edgeId, exclusion]));

  for (const edge of input.edges) {
    const temporalExclusion = temporalExclusionsById.get(edge.id);
    if (temporalExclusion) {
      excluded.push({
        id: edge.id,
        type: "edge",
        reason: temporalExclusion.reason,
        confidence: edge.confidence,
      });
      continue;
    }

    const temporalScore = scoresById.get(edge.id);
    if (edge.confidence < thresholds.edgeMinConfidence) {
      excluded.push({
        id: edge.id,
        type: "edge",
        reason: "low_confidence",
        confidence: edge.confidence,
        score: temporalScore?.score,
      });
      continue;
    }

    if (
      thresholds.minTemporalScore !== undefined &&
      temporalScore &&
      Math.abs(temporalScore.score) < thresholds.minTemporalScore
    ) {
      excluded.push({
        id: edge.id,
        type: "edge",
        reason: "low_temporal_score",
        confidence: edge.confidence,
        score: temporalScore.score,
      });
      continue;
    }

    includedEdges.push(edge);
  }

  return {
    entries: includedEntries,
    edges: includedEdges,
    metadata: {
      includedMemoryIds: includedEntries.map((entry) => entry.id),
      includedEdgeIds: includedEdges.map((edge) => edge.id),
      excluded,
    },
  };
}
