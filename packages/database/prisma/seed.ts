import { PrismaClient, Sector, ComplianceStatus, AutonomyLevel } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organisation.upsert({
    where: { id: "demo-org" },
    update: {},
    create: {
      id: "demo-org",
      name: "Greenfield MAT",
      sector: Sector.education,
      type: "mat",
      timezone: "Europe/London",
    },
  });

  const site = await prisma.site.upsert({
    where: { id: "demo-site" },
    update: {},
    create: {
      id: "demo-site",
      organisationId: org.id,
      name: "Greenfield Primary",
      address: "12 School Lane, London",
      latitude: 51.5074,
      longitude: -0.1278,
      siteInstructions: "Sign in at reception. Safeguarding briefing required.",
    },
  });

  await prisma.guardrailPolicy.upsert({
    where: { organisationId: org.id },
    update: {},
    create: {
      organisationId: org.id,
      autonomyLevel: AutonomyLevel.L2,
      budgetCeiling: 200,
      approvedRoleTypes: ["supply_teacher", "cover_supervisor", "teaching_assistant"],
      workerWhitelist: [],
      workerBlocklist: [],
      escalationContacts: ["cover@greenfieldmat.org"],
    },
  });

  const worker = await prisma.worker.upsert({
    where: { email: "demo.worker@viora.dev" },
    update: {},
    create: {
      id: "demo-worker",
      firstName: "Alex",
      lastName: "Taylor",
      email: "demo.worker@viora.dev",
      phone: "+447700900000",
      roleTypes: ["supply_teacher"],
      workRadiusKm: 25,
    },
  });

  await prisma.passport.upsert({
    where: { workerId: worker.id },
    update: {},
    create: {
      workerId: worker.id,
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      qtsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 4.8,
    },
  });

  console.log("Seed complete:", { org: org.name, site: site.name, worker: worker.email });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
