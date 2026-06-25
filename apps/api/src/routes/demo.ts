import type { FastifyPluginAsync } from "fastify";
import type { Passport } from "@prisma/client";

function complianceLabel(
  passport: Pick<
    Passport,
    | "identityVerified"
    | "rightToWorkStatus"
    | "dbsStatus"
    | "qtsStatus"
    | "safeguardingStatus"
  > | null,
  roleTypes: string[],
): string {
  if (!passport) return "no passport";
  if (passport.dbsStatus === "pending") return "DBS pending";
  if (passport.rightToWorkStatus === "pending") return "RTW pending";
  if (passport.safeguardingStatus === "pending") return "safeguarding pending";
  if (roleTypes.includes("supply_teacher") && passport.qtsStatus === "pending") {
    return "QTS pending";
  }
  if (!passport.identityVerified) return "identity pending";
  return "verified";
}

export const demoRoutes: FastifyPluginAsync = async (app) => {
  app.get("/demo/directory", async () => {
    const [organisations, workers] = await Promise.all([
      app.db.organisation.findMany({
        where: { sector: "education" },
        orderBy: { name: "asc" },
        include: {
          sites: { take: 1, orderBy: { name: "asc" } },
          users: { take: 1, orderBy: { name: "asc" } },
        },
      }),
      app.db.worker.findMany({
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { passport: true },
      }),
    ]);

    return {
      organisations: organisations.map((org) => {
        const site = org.sites[0];
        const employer = org.users[0];
        return {
          id: org.id,
          name: org.name,
          type: org.type,
          site: site
            ? { id: site.id, name: site.name, address: site.address }
            : null,
          employer: employer
            ? {
                id: employer.id,
                name: employer.name,
                email: employer.email,
                role: employer.role,
              }
            : null,
        };
      }),
      workers: workers.map((worker) => ({
        id: worker.id,
        firstName: worker.firstName,
        lastName: worker.lastName,
        email: worker.email,
        roleTypes: worker.roleTypes,
        reliabilityScore: worker.passport?.reliabilityScore ?? null,
        complianceLabel: complianceLabel(worker.passport, worker.roleTypes),
      })),
    };
  });
};
