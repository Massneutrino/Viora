export type ScheduleAudience = "worker" | "organisation";

export type ScheduleGranularity = "day" | "hour";

export type ScheduleEventKind =
  | "confirmed_shift"
  | "pending_offer"
  | "open_request"
  | "unavailable_block";

export type ScheduleEventStatus =
  | "confirmed"
  | "pending"
  | "open"
  | "unavailable"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "at_risk";

export interface ScheduleEventMeta {
  bookingId?: string;
  bookingRequestId?: string;
  offerId?: string;
  shiftId?: string;
  availabilityBlockId?: string;
  organisationId?: string;
  organisationName?: string;
  siteId?: string;
  siteName?: string;
  siteAddress?: string;
  workerId?: string;
  workerName?: string;
  roleType?: string;
  payRate?: number;
  rateMode?: "standard" | "dynamic";
  timesheetApproved?: boolean;
  note?: string;
}

export interface ScheduleEvent {
  id: string;
  kind: ScheduleEventKind;
  audience: ScheduleAudience;
  startAt: string;
  endAt: string;
  timezone: string;
  title: string;
  subtitle?: string;
  status: ScheduleEventStatus;
  meta: ScheduleEventMeta;
}

export interface ScheduleDay {
  key: string;
  label: string;
  dateLabel: string;
  events: ScheduleEvent[];
}

export interface ScheduleHourBucket {
  key: string;
  label: string;
  startAt: string;
  endAt: string;
  events: ScheduleEvent[];
}

export interface ScheduleSummary {
  confirmed: number;
  pending: number;
  open: number;
  unavailable: number;
}

export interface ScheduleResponse {
  range: {
    from: string;
    to: string;
    timezone: string;
    granularity: ScheduleGranularity;
  };
  summary: ScheduleSummary;
  events: ScheduleEvent[];
  days: ScheduleDay[];
  hours?: ScheduleHourBucket[];
}

export const DEFAULT_SCHEDULE_TIMEZONE = "Europe/London";
export const MAX_SCHEDULE_RANGE_DAYS = 90;
export const DEFAULT_SCHEDULE_RANGE_DAYS = 28;

function dateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: byType.year,
    month: byType.month,
    day: byType.day,
  };
}

export function scheduleDayKey(date: Date | string, timezone = DEFAULT_SCHEDULE_TIMEZONE): string {
  const value = typeof date === "string" ? new Date(date) : date;
  const parts = dateParts(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatScheduleDateLabel(date: Date | string, timezone = DEFAULT_SCHEDULE_TIMEZONE): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(value);
}

export function formatScheduleHourLabel(date: Date | string, timezone = DEFAULT_SCHEDULE_TIMEZONE): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function groupScheduleEventsByDay(
  events: ScheduleEvent[],
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
): ScheduleDay[] {
  const grouped = new Map<string, ScheduleEvent[]>();
  for (const event of events) {
    const key = scheduleDayKey(event.startAt, timezone);
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, dayEvents]) => {
      const first = dayEvents[0]!;
      return {
        key,
        label: formatScheduleDateLabel(first.startAt, timezone),
        dateLabel: key,
        events: dayEvents.sort((a, b) => a.startAt.localeCompare(b.startAt)),
      };
    });
}

export function summarizeScheduleEvents(events: ScheduleEvent[]): ScheduleSummary {
  return events.reduce<ScheduleSummary>(
    (summary, event) => {
      if (event.kind === "confirmed_shift") summary.confirmed += 1;
      if (event.kind === "pending_offer") summary.pending += 1;
      if (event.kind === "open_request") summary.open += 1;
      if (event.kind === "unavailable_block") summary.unavailable += 1;
      return summary;
    },
    { confirmed: 0, pending: 0, open: 0, unavailable: 0 },
  );
}

export function buildHourlyScheduleBuckets(
  events: ScheduleEvent[],
  from: Date,
  to: Date,
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
): ScheduleHourBucket[] {
  const buckets: ScheduleHourBucket[] = [];
  const cursor = new Date(from);
  cursor.setUTCMinutes(0, 0, 0);
  if (cursor < from) cursor.setUTCHours(cursor.getUTCHours() + 1);

  while (cursor < to) {
    const start = new Date(cursor);
    const end = new Date(start);
    end.setUTCHours(end.getUTCHours() + 1);
    const slotEnd = end < to ? end : to;
    const slotEvents = events.filter((event) => {
      const eventStart = new Date(event.startAt);
      const eventEnd = new Date(event.endAt);
      return eventStart < slotEnd && eventEnd > start;
    });
    buckets.push({
      key: start.toISOString(),
      label: formatScheduleHourLabel(start, timezone),
      startAt: start.toISOString(),
      endAt: slotEnd.toISOString(),
      events: slotEvents,
    });
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }

  return buckets;
}

export function buildScheduleResponse(input: {
  events: ScheduleEvent[];
  from: Date;
  to: Date;
  timezone?: string;
  granularity?: ScheduleGranularity;
}): ScheduleResponse {
  const timezone = input.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
  const granularity = input.granularity ?? "day";
  const events = [...input.events].sort((a, b) => a.startAt.localeCompare(b.startAt));
  return {
    range: {
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      timezone,
      granularity,
    },
    summary: summarizeScheduleEvents(events),
    events,
    days: groupScheduleEventsByDay(events, timezone),
    hours: granularity === "hour"
      ? buildHourlyScheduleBuckets(events, input.from, input.to, timezone)
      : undefined,
  };
}
