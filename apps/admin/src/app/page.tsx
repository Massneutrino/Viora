import type { ApprovalQueueItem } from "./approvals-queue";
import type { BookingOpsItem } from "./bookings-ops";
import { ConsoleShell } from "./console-shell";
import type { ComplianceQueueItem } from "./compliance-queue";
import type { PendingTimesheet } from "./timesheets-queue";
import {
  EMPTY_MEMORY_IMPACT,
  EMPTY_STATS,
  type MemoryImpactStats,
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
  const [unfilledData, marketHealth, complianceData, approvalsData, memoryData, pilotLeadData, auditData, negotiationsData, stats, memoryImpact, memoryLab, timesheetsData, bookingOpsData] =
    await Promise.all([
      getJson<{ unfilled: UnfilledShift[] }>("/v1/admin/ops/unfilled", { unfilled: [] }),
      getJson<MarketHealth>("/v1/admin/ops/market-health", {}),
      getJson<{ pending: ComplianceQueueItem[] }>("/v1/admin/compliance/queue", { pending: [] }),
      getJson<{ approvals: ApprovalQueueItem[] }>("/v1/admin/approvals", { approvals: [] }),
      getJson<{ memories: MemoryReviewItem[] }>("/v1/admin/memory/pending", { memories: [] }),
      getJson<{ leads: PilotLead[] }>("/v1/admin/pilot/leads", { leads: [] }),
      getJson<{ events: AuditEvent[] }>("/v1/admin/audit", { events: [] }),
      getJson<{ negotiations: DynamicRateRecord[] }>("/v1/admin/negotiations", { negotiations: [] }),
      getJson<OpsStats>("/v1/admin/ops/stats", EMPTY_STATS),
      getJson<MemoryImpactStats>("/v1/admin/ops/memory-impact", EMPTY_MEMORY_IMPACT),
      getJson<MemoryLabState>("/v1/admin/sandbox/memory-lab/state", {
        organisations: [],
        workers: [],
        bookingRequests: [],
        memories: [],
        edges: [],
        pending: [],
        audit: [],
      }),
      getJson<{ pending: PendingTimesheet[] }>("/v1/admin/timesheets/pending", { pending: [] }),
      getJson<{ bookings: BookingOpsItem[] }>("/v1/admin/bookings/ops", { bookings: [] }),
    ]);

  return (
    <ConsoleShell
      data={{
        unfilled: unfilledData.unfilled,
        marketHealth,
        compliance: complianceData.pending,
        approvals: approvalsData.approvals,
        memory: memoryData.memories,
        pilotLeads: pilotLeadData.leads,
        audit: auditData.events,
        negotiations: negotiationsData.negotiations,
        stats,
        memoryImpact,
        memoryLab,
        pendingTimesheets: timesheetsData.pending,
        bookingOps: bookingOpsData.bookings,
      }}
    />
  );
}
