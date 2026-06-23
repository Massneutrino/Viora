import {
  PrismaClient,
  Sector,
  ComplianceStatus,
  AutonomyLevel,
  EmployerRole,
} from "@prisma/client";

const prisma = new PrismaClient();

async function upsertDoc(
  passportId: string,
  documentType: string,
  status: "verified" | "pending",
) {
  const existing = await prisma.complianceDocument.findFirst({
    where: { passportId, documentType },
  });
  if (existing) {
    await prisma.complianceDocument.update({
      where: { id: existing.id },
      data: {
        status,
        verifiedAt: status === "verified" ? new Date() : null,
        verifiedBy: status === "verified" ? "seed" : null,
      },
    });
  } else {
    await prisma.complianceDocument.create({
      data: {
        passportId,
        documentType,
        status,
        verifiedAt: status === "verified" ? new Date() : undefined,
        verifiedBy: status === "verified" ? "seed" : undefined,
      },
    });
  }
}

async function main() {
  // ── Organisation ─────────────────────────────────────────────────────────
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

  // ── Site ─────────────────────────────────────────────────────────────────
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

  // ── Guardrail policy ─────────────────────────────────────────────────────
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

  // ── Employer: Sarah Johnson (cover manager) ───────────────────────────────
  await prisma.employerUser.upsert({
    where: { email: "sarah.johnson@greenfieldmat.org" },
    update: {},
    create: {
      id: "demo-employer",
      organisationId: org.id,
      email: "sarah.johnson@greenfieldmat.org",
      name: "Sarah Johnson",
      role: EmployerRole.cover_manager,
    },
  });

  // ── Alex Taylor — supply_teacher, fully verified (~0.4 km) ───────────────
  const alex = await prisma.worker.upsert({
    where: { email: "demo.worker@viora.dev" },
    update: { homeLatitude: 51.51, homeLongitude: -0.13 },
    create: {
      id: "demo-worker",
      firstName: "Alex",
      lastName: "Taylor",
      email: "demo.worker@viora.dev",
      phone: "+447700900000",
      homeLatitude: 51.51,
      homeLongitude: -0.13,
      roleTypes: ["supply_teacher"],
      workRadiusKm: 25,
    },
  });

  const alexPassport = await prisma.passport.upsert({
    where: { workerId: alex.id },
    update: {},
    create: {
      workerId: alex.id,
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      qtsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 4.8,
    },
  });
  await upsertDoc(alexPassport.id, "references", "verified");
  await upsertDoc(alexPassport.id, "prohibition_check", "verified");

  // ── Priya Sharma — supply_teacher, fully verified (~1.7 km) ─────────────
  const priya = await prisma.worker.upsert({
    where: { email: "priya.sharma@viora.dev" },
    update: {},
    create: {
      id: "demo-worker-2",
      firstName: "Priya",
      lastName: "Sharma",
      email: "priya.sharma@viora.dev",
      phone: "+447700900001",
      homeLatitude: 51.52,
      homeLongitude: -0.12,
      roleTypes: ["supply_teacher"],
      workRadiusKm: 25,
    },
  });

  const priyaPassport = await prisma.passport.upsert({
    where: { workerId: priya.id },
    update: {},
    create: {
      workerId: priya.id,
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      qtsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 4.2,
    },
  });
  await upsertDoc(priyaPassport.id, "references", "verified");
  await upsertDoc(priyaPassport.id, "prohibition_check", "verified");

  // ── James Mitchell — cover_supervisor, safeguarding PENDING (~0.5 km) ────
  // Fails education gate: safeguardingStatus = pending.
  // Pending safeguarding doc surfaces in GET /v1/admin/compliance/queue.
  const james = await prisma.worker.upsert({
    where: { email: "james.mitchell@viora.dev" },
    update: {},
    create: {
      id: "demo-worker-3",
      firstName: "James",
      lastName: "Mitchell",
      email: "james.mitchell@viora.dev",
      phone: "+447700900002",
      homeLatitude: 51.505,
      homeLongitude: -0.135,
      roleTypes: ["cover_supervisor"],
      workRadiusKm: 25,
    },
  });

  const jamesPassport = await prisma.passport.upsert({
    where: { workerId: james.id },
    update: {},
    create: {
      workerId: james.id,
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.pending,
      sectorEligibility: [],
      reliabilityScore: 3.5,
    },
  });
  await upsertDoc(jamesPassport.id, "references", "verified");
  await upsertDoc(jamesPassport.id, "prohibition_check", "verified");
  await upsertDoc(jamesPassport.id, "safeguarding", "pending");

  // ── Maria Chen — teaching_assistant, fully verified (~1.5 km) ────────────
  const maria = await prisma.worker.upsert({
    where: { email: "maria.chen@viora.dev" },
    update: {},
    create: {
      id: "demo-worker-4",
      firstName: "Maria",
      lastName: "Chen",
      email: "maria.chen@viora.dev",
      phone: "+447700900003",
      homeLatitude: 51.515,
      homeLongitude: -0.115,
      roleTypes: ["teaching_assistant"],
      workRadiusKm: 25,
    },
  });

  const mariaPassport = await prisma.passport.upsert({
    where: { workerId: maria.id },
    update: {},
    create: {
      workerId: maria.id,
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 3.9,
    },
  });
  await upsertDoc(mariaPassport.id, "references", "verified");
  await upsertDoc(mariaPassport.id, "prohibition_check", "verified");

  // ── Tom Blake — supply_teacher, DBS PENDING (~3.7 km) ───────────────────
  // Fails education gate: dbsStatus = pending.
  // Verify his DBS via POST /v1/admin/compliance/documents/:id/verify to unlock.
  const tom = await prisma.worker.upsert({
    where: { email: "tom.blake@viora.dev" },
    update: {},
    create: {
      id: "demo-worker-5",
      firstName: "Tom",
      lastName: "Blake",
      email: "tom.blake@viora.dev",
      phone: "+447700900004",
      homeLatitude: 51.54,
      homeLongitude: -0.11,
      roleTypes: ["supply_teacher"],
      workRadiusKm: 25,
    },
  });

  const tomPassport = await prisma.passport.upsert({
    where: { workerId: tom.id },
    update: {},
    create: {
      workerId: tom.id,
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.pending,
      qtsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [],
      reliabilityScore: 4.5,
    },
  });
  await upsertDoc(tomPassport.id, "references", "verified");
  await upsertDoc(tomPassport.id, "prohibition_check", "verified");
  await upsertDoc(tomPassport.id, "enhanced_dbs", "pending");

  // ── Demo offer for the worker swipe deck ─────────────────────────────────
  // Gives demo-worker (Alex) a populated shift card out of the box, without
  // needing an employer intake + broadcast first. expiresAt is set far ahead so
  // the offer keeps surfacing; the card's countdown is cosmetic.
  const shiftStart = new Date();
  shiftStart.setDate(shiftStart.getDate() + 1);
  shiftStart.setHours(8, 15, 0, 0);
  const shiftEnd = new Date(shiftStart);
  shiftEnd.setHours(15, 30, 0, 0);
  const offerExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const demoRequest = await prisma.bookingRequest.upsert({
    where: { id: "demo-booking-request" },
    update: { startAt: shiftStart, endAt: shiftEnd },
    create: {
      id: "demo-booking-request",
      organisationId: org.id,
      siteId: site.id,
      status: "broadcasting",
      roleType: "supply_teacher",
      startAt: shiftStart,
      endAt: shiftEnd,
      payRate: 150,
      maxPayRate: 170,
      rawIntent: "KS2 cover, Year 5, tomorrow 8:15–3:30, up to £170/day",
    },
  });

  await prisma.offer.upsert({
    where: { id: "demo-offer" },
    update: { expiresAt: offerExpiry, status: "pending" },
    create: {
      id: "demo-offer",
      bookingRequestId: demoRequest.id,
      workerId: alex.id,
      status: "pending",
      payRate: 150,
      fitExplanation:
        "Greenfield Primary is a short hop from you and you've covered KS2 here before. Your DBS, QTS and safeguarding are all verified, so V can confirm this instantly.",
      expiresAt: offerExpiry,
    },
  });

  console.log("Seed complete:", {
    org: org.name,
    site: site.name,
    employer: "sarah.johnson@greenfieldmat.org (cover_manager)",
    workers: [
      `${alex.id}: Alex Taylor       supply_teacher    fully verified  4.8★`,
      `${priya.id}: Priya Sharma    supply_teacher    fully verified  4.2★`,
      `${james.id}: James Mitchell  cover_supervisor  safeguarding⚠   3.5★`,
      `${maria.id}: Maria Chen      teaching_asst     fully verified  3.9★`,
      `${tom.id}: Tom Blake         supply_teacher    DBS pending⚠    4.5★`,
    ],
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
