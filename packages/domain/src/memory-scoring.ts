import type { MemoryEdge, MemoryStatus, MemoryVisibility } from "./index.js";

export type TemporalMemoryEdgeExclusionReason =
  | "inactive"
  | "private"
  | "future_valid"
  | "expired"
  | "superseded"
  | "unsupported_decay_policy";

export interface TemporalMemoryEdgeScore {
  edgeId: string;
  ownerId: string;
  score: number;
  rawScore: number;
  recencyMultiplier: number;
  evidenceMultiplier: number;
  confidence: number;
  weight: number;
  evidenceCount: number;
  decayPolicy: string;
  lastEvidenceAt?: string | null;
}

export interface TemporalMemoryEdgeExclusion {
  edgeId: string;
  ownerId: string;
  reason: TemporalMemoryEdgeExclusionReason;
}

export interface TemporalMemoryEdgeScoringResult {
  included: TemporalMemoryEdgeScore[];
  excluded: TemporalMemoryEdgeExclusion[];
}

type ScorableEdge = Pick<
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EMPLOYER_VISIBLE: MemoryVisibility[] = ["operational", "shared"];
const ACTIVE_STATUS: MemoryStatus = "active";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function daysSince(date: Date, now: Date) {
  return Math.max(0, (now.getTime() - date.getTime()) / MS_PER_DAY);
}

function recencyMultiplier(edge: ScorableEdge, now: Date) {
  const evidenceAt = edge.lastEvidenceAt ?? edge.validFrom;
  const ageDays = daysSince(evidenceAt, now);
  if (edge.decayPolicy === "none") return 1;
  if (edge.decayPolicy === "linear_180d") return clamp(1 - ageDays / 180, 0.2, 1);
  if (edge.decayPolicy === "linear_365d") return clamp(1 - ageDays / 365, 0.35, 1);
  return null;
}

function evidenceMultiplier(edge: ScorableEdge) {
  return clamp(0.75 + Math.log1p(Math.max(0, edge.evidenceCount - 1)) * 0.12, 0.75, 1.15);
}

export function scoreTemporalMemoryEdges(edges: ScorableEdge[], now = new Date()): TemporalMemoryEdgeScoringResult {
  const included: TemporalMemoryEdgeScore[] = [];
  const excluded: TemporalMemoryEdgeExclusion[] = [];

  for (const edge of edges) {
    if (edge.status !== ACTIVE_STATUS) {
      excluded.push({ edgeId: edge.id, ownerId: edge.ownerId, reason: "inactive" });
      continue;
    }
    if (!EMPLOYER_VISIBLE.includes(edge.visibility)) {
      excluded.push({ edgeId: edge.id, ownerId: edge.ownerId, reason: "private" });
      continue;
    }
    if (edge.validFrom && edge.validFrom.getTime() > now.getTime()) {
      excluded.push({ edgeId: edge.id, ownerId: edge.ownerId, reason: "future_valid" });
      continue;
    }
    if (edge.validUntil && edge.validUntil.getTime() <= now.getTime()) {
      excluded.push({ edgeId: edge.id, ownerId: edge.ownerId, reason: "expired" });
      continue;
    }
    if (edge.supersededByEdgeId) {
      excluded.push({ edgeId: edge.id, ownerId: edge.ownerId, reason: "superseded" });
      continue;
    }

    const recency = recencyMultiplier(edge, now);
    if (recency === null) {
      excluded.push({ edgeId: edge.id, ownerId: edge.ownerId, reason: "unsupported_decay_policy" });
      continue;
    }

    const evidence = evidenceMultiplier(edge);
    const rawScore = edge.weight * edge.confidence * recency * evidence;
    included.push({
      edgeId: edge.id,
      ownerId: edge.ownerId,
      score: clamp(rawScore, -1, 1),
      rawScore,
      recencyMultiplier: recency,
      evidenceMultiplier: evidence,
      confidence: edge.confidence,
      weight: edge.weight,
      evidenceCount: edge.evidenceCount,
      decayPolicy: edge.decayPolicy,
      lastEvidenceAt: edge.lastEvidenceAt?.toISOString() ?? null,
    });
  }

  return { included, excluded };
}
