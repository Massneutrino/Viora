import type { PrismaClient } from "@viora/database";
import {
  scoreTemporalMemoryEdges,
  type MemoryAudience,
  type MemoryEdge,
  type MemoryEntry,
  type MemoryRetrievalExclusion,
  type MemoryUseScope,
} from "@viora/domain";
import type { MemoryAgent } from "@viora/agents";

export type MemoryReason = {
  id: string;
  type: "memory" | "edge";
  title: string;
  detail: string;
  kind: string;
  visibility: string;
  sourceLabel?: string | null;
};

function isWorkerPrivate(memory: Pick<MemoryEntry, "ownerType" | "visibility">) {
  return memory.ownerType === "worker" && memory.visibility === "private";
}

function canShowMemory(memory: MemoryEntry, audience: MemoryAudience): boolean {
  if (audience === "worker" || audience === "owner" || audience === "admin") return true;
  return !isWorkerPrivate(memory) && memory.visibility !== "private";
}

function canShowEdge(edge: MemoryEdge, audience: MemoryAudience): boolean {
  if (audience === "worker" || audience === "owner" || audience === "admin") return true;
  return edge.visibility !== "private";
}

function memoryReason(memory: MemoryEntry): MemoryReason {
  return {
    id: memory.id,
    type: "memory",
    title: memory.title,
    detail: memory.content,
    kind: memory.kind,
    visibility: memory.visibility,
    sourceLabel: memory.sourceLabel,
  };
}

function edgeReason(edge: MemoryEdge): MemoryReason {
  const score = scoreTemporalMemoryEdges([edge]).included[0];
  const evidenceDetail = score
    ? `temporal score ${score.score.toFixed(2)}, recency ${score.recencyMultiplier.toFixed(2)}`
    : `weight ${edge.weight.toFixed(2)}`;
  const recentDetail = edge.lastEvidenceAt ? ` Last evidence ${edge.lastEvidenceAt.toISOString().slice(0, 10)}.` : "";
  return {
    id: edge.id,
    type: "edge",
    title: edge.label,
    detail: `Fit signal ${evidenceDetail} from ${edge.evidenceCount} evidence point(s).${recentDetail}`,
    kind: edge.kind,
    visibility: edge.visibility,
    sourceLabel: edge.sourceType,
  };
}

export async function offerMemoryReasons(input: {
  db: PrismaClient;
  memory: MemoryAgent;
  offerId: string;
  audience: MemoryAudience;
  limit?: number;
}): Promise<{
  reasons: MemoryReason[];
  audit: {
    purpose: MemoryUseScope;
    memoryIds: string[];
    edgeIds: string[];
    excluded: MemoryRetrievalExclusion[];
    useScopes: MemoryUseScope[];
  };
}> {
  const context = await input.memory.getOfferContext(input.offerId, { audience: input.audience });
  const reasons = [
    ...context.entries.filter((entry) => canShowMemory(entry, input.audience)).map(memoryReason),
    ...context.edges.filter((edge) => canShowEdge(edge, input.audience)).map(edgeReason),
  ].slice(0, input.limit ?? 5);
  return {
    reasons,
    audit: {
      purpose: context.audit.purpose,
      memoryIds: reasons.filter((reason) => reason.type === "memory").map((reason) => reason.id),
      edgeIds: reasons.filter((reason) => reason.type === "edge").map((reason) => reason.id),
      excluded: context.audit.excluded,
      useScopes: context.audit.useScopes,
    },
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function latestInfluenceReasons(input: {
  db: PrismaClient;
  entityType: string;
  entityId: string;
  action: string;
  audience: MemoryAudience;
  limit?: number;
}): Promise<MemoryReason[]> {
  const audit = await input.db.auditEvent.findFirst({
    where: {
      action: "memory.influence",
      entityType: input.entityType,
      entityId: input.entityId,
      inputs: { path: ["action"], equals: input.action },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!audit) return [];

  const memoryIds = stringArray((audit.inputs as Record<string, unknown>).memoryIds);
  const edgeIds = stringArray((audit.inputs as Record<string, unknown>).edgeIds);
  const [memories, edges] = await Promise.all([
    memoryIds.length
      ? input.db.memoryEntry.findMany({
          where: { id: { in: memoryIds } },
          orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
        })
      : [],
    edgeIds.length
      ? input.db.memoryEdge.findMany({
          where: { id: { in: edgeIds } },
          orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
        })
      : [],
  ]);

  return [
    ...memories.filter((memory) => canShowMemory(memory, input.audience)).map(memoryReason),
    ...edges.filter((edge) => canShowEdge(edge, input.audience)).map(edgeReason),
  ].slice(0, input.limit ?? 5);
}
