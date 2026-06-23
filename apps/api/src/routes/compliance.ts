import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Prisma } from "@viora/database";
import { writeAuditEvent } from "../audit.js";

const verifyDocumentSchema = z.object({
  adminId: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});

const rejectDocumentSchema = z.object({
  adminId: z.string().min(1),
});

function passportUpdateForDocType(
  documentType: string,
  verified: boolean,
): Prisma.PassportUpdateInput {
  switch (documentType) {
    case "enhanced_dbs":
      return { dbsStatus: verified ? "verified" : "rejected" };
    case "right_to_work":
      return { rightToWorkStatus: verified ? "verified" : "rejected" };
    case "safeguarding":
      return { safeguardingStatus: verified ? "verified" : "rejected" };
    case "qts":
      return { qtsStatus: verified ? "verified" : "rejected" };
    case "identity":
      return { identityVerified: verified };
    default:
      return {};
  }
}

export const complianceAdminRoutes: FastifyPluginAsync = async (app) => {
  /** POST /v1/admin/compliance/documents/:id/verify */
  app.post("/compliance/documents/:id/verify", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = verifyDocumentSchema.parse(request.body);

    const existing = await app.db.complianceDocument.findUnique({
      where: { id },
      include: { passport: true },
    });

    if (!existing) return reply.code(404).send({ error: "Compliance document not found." });
    if (existing.status === "verified") {
      return reply.code(409).send({ error: "Document already verified." });
    }

    const passportUpdate = passportUpdateForDocType(existing.documentType, true);
    const hasPassportUpdate = Object.keys(passportUpdate).length > 0;

    const document = await app.db.$transaction(async (tx) => {
      const updated = await tx.complianceDocument.update({
        where: { id },
        data: {
          status: "verified",
          verifiedBy: body.adminId,
          verifiedAt: new Date(),
          ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
        },
      });

      if (hasPassportUpdate) {
        await tx.passport.update({
          where: { id: existing.passportId },
          data: passportUpdate,
        });
      }

      await writeAuditEvent(tx, {
        actorType: "admin",
        actorId: body.adminId,
        action: "compliance.document.verify",
        entityType: "ComplianceDocument",
        entityId: id,
        inputs: {
          documentId: id,
          documentType: existing.documentType,
          adminId: body.adminId,
          expiresAt: body.expiresAt ?? null,
        } as Prisma.InputJsonValue,
        outputs: {
          passportId: existing.passportId,
          workerId: existing.passport.workerId,
          passportUpdated: hasPassportUpdate,
          passportFields: passportUpdate as Record<string, unknown>,
        } as Prisma.InputJsonValue,
        outcome: "verified",
      });

      return updated;
    });

    return reply.send({ document });
  });

  /** POST /v1/admin/compliance/documents/:id/reject */
  app.post("/compliance/documents/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = rejectDocumentSchema.parse(request.body);

    const existing = await app.db.complianceDocument.findUnique({
      where: { id },
      include: { passport: true },
    });

    if (!existing) return reply.code(404).send({ error: "Compliance document not found." });
    if (existing.status === "rejected") {
      return reply.code(409).send({ error: "Document already rejected." });
    }

    const passportUpdate = passportUpdateForDocType(existing.documentType, false);
    const hasPassportUpdate = Object.keys(passportUpdate).length > 0;

    const document = await app.db.$transaction(async (tx) => {
      const updated = await tx.complianceDocument.update({
        where: { id },
        data: {
          status: "rejected",
          verifiedBy: body.adminId,
          verifiedAt: new Date(),
        },
      });

      if (hasPassportUpdate) {
        await tx.passport.update({
          where: { id: existing.passportId },
          data: passportUpdate,
        });
      }

      await writeAuditEvent(tx, {
        actorType: "admin",
        actorId: body.adminId,
        action: "compliance.document.reject",
        entityType: "ComplianceDocument",
        entityId: id,
        inputs: {
          documentId: id,
          documentType: existing.documentType,
          adminId: body.adminId,
        } as Prisma.InputJsonValue,
        outputs: {
          passportId: existing.passportId,
          workerId: existing.passport.workerId,
          passportUpdated: hasPassportUpdate,
          passportFields: passportUpdate as Record<string, unknown>,
        } as Prisma.InputJsonValue,
        outcome: "rejected",
      });

      return updated;
    });

    return reply.send({ document });
  });
};
