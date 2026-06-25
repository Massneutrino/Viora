import { ConsoleShell } from "./console-shell";
import type { ComplianceQueueItem } from "./compliance-queue";
import {
  EMPTY_STATS,
  type AuditEvent,
  type DynamicRateRecord,
  type MarketHealth,
  type MemoryReviewItem,
  type MemoryLabState,
  type PilotLead,
  type UnfilledShift,
} from "./sections";
import type { OpsStats } from "./ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export default async function AdminConsole() {
  const [unfilledData, marketHealth, complianceData, memoryData, pilotLeadData, auditData, negotiationsData, stats, memoryLab] =
    await Promise.all([
      getJson<{ unfilled: UnfilledShift[] }>("/v1/admin/ops/unfilled", { unfilled: [] }),
      getJson<MarketHealth>("/v1/admin/ops/market-health", {}),
      getJson<{ pending: ComplianceQueueItem[] }>("/v1/admin/compliance/queue", { pending: [] }),
      getJson<{ memories: MemoryReviewItem[] }>("/v1/admin/memory/pending", { memories: [] }),
      getJson<{ leads: PilotLead[] }>("/v1/admin/pilot/leads", { leads: [] }),
      getJson<{ events: AuditEvent[] }>("/v1/admin/audit", { events: [] }),
      getJson<{ negotiations: DynamicRateRecord[] }>("/v1/admin/negotiations", { negotiations: [] }),
      getJson<OpsStats>("/v1/admin/ops/stats", EMPTY_STATS),
      getJson<MemoryLabState>("/v1/admin/sandbox/memory-lab/state", {
        organisations: [],
        workers: [],
        bookingRequests: [],
        memories: [],
        edges: [],
        pending: [],
        audit: [],
      }),
    ]);

  return (
    <ConsoleShell
      data={{
        unfilled: unfilledData.unfilled,
        marketHealth,
        compliance: complianceData.pending,
        memory: memoryData.memories,
        pilotLeads: pilotLeadData.leads,
        audit: auditData.events,
        negotiations: negotiationsData.negotiations,
        stats,
        memoryLab,
      }}
    />
  );
}
