import type { Prisma, PrismaClient } from "@viora/database";

type AuditActorType = "user" | "agent" | "system" | "admin";

interface WriteAuditEventInput {
  actorType: AuditActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  inputs: Prisma.InputJsonValue;
  outputs: Prisma.InputJsonValue;
  outcome: string;
}

export async function writeAuditEvent(
  db: PrismaClient | Prisma.TransactionClient,
  event: WriteAuditEventInput,
) {
  return db.auditEvent.create({ data: event });
}
