import {
  PrismaClient,
  Sector,
  ComplianceStatus,
  AutonomyLevel,
  EmployerRole,
  type Worker,
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

type WorkerSeed = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  homeAddress: string;
  homeCity: string;
  homePostcode: string;
  homeLatitude: number;
  homeLongitude: number;
  roleTypes: string[];
  workRadiusKm: number;
  passport: {
    identityVerified: boolean;
    rightToWorkStatus: ComplianceStatus;
    dbsStatus: ComplianceStatus;
    qtsStatus?: ComplianceStatus | null;
    safeguardingStatus: ComplianceStatus;
    sectorEligibility: Sector[];
    reliabilityScore: number;
  };
  docs: { type: string; status: "verified" | "pending" }[];
};

async function upsertWorker(seed: WorkerSeed): Promise<Worker> {
  const worker = await prisma.worker.upsert({
    where: { email: seed.email },
    update: {
      homeLatitude: seed.homeLatitude,
      homeLongitude: seed.homeLongitude,
      homeAddress: seed.homeAddress,
      homeCity: seed.homeCity,
      homePostcode: seed.homePostcode,
      roleTypes: seed.roleTypes,
      workRadiusKm: seed.workRadiusKm,
    },
    create: {
      id: seed.id,
      firstName: seed.firstName,
      lastName: seed.lastName,
      email: seed.email,
      phone: seed.phone,
      homeAddress: seed.homeAddress,
      homeCity: seed.homeCity,
      homePostcode: seed.homePostcode,
      homeLatitude: seed.homeLatitude,
      homeLongitude: seed.homeLongitude,
      roleTypes: seed.roleTypes,
      workRadiusKm: seed.workRadiusKm,
    },
  });

  const passport = await prisma.passport.upsert({
    where: { workerId: worker.id },
    update: seed.passport,
    create: { workerId: worker.id, ...seed.passport },
  });

  for (const doc of seed.docs) {
    await upsertDoc(passport.id, doc.type, doc.status);
  }

  return worker;
}

async function upsertWorkerPayFloor(workerId: string, payFloor: number, approvedRoleTypes: string[]) {
  await prisma.guardrailPolicy.upsert({
    where: { workerId },
    update: {
      payFloor,
      maxCommuteMinutes: null,
      approvedRoleTypes,
    },
    create: {
      workerId,
      autonomyLevel: AutonomyLevel.L2,
      payFloor,
      approvedRoleTypes,
      workerWhitelist: [],
      workerBlocklist: [],
      escalationContacts: [],
    },
  });
}

async function refreshCanonicalDemoRequest(input: {
  organisationId: string;
  siteId: string;
  workerId: string;
  startAt: Date;
  endAt: Date;
  offerExpiresAt: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const requestId = "demo-booking-request";
    const bookings = await tx.booking.findMany({
      where: { bookingRequestId: requestId },
      select: {
        id: true,
        shift: { select: { id: true } },
      },
    });
    const bookingIds = bookings.map((booking) => booking.id);
    const shiftIds = bookings.flatMap((booking) => (booking.shift ? [booking.shift.id] : []));
    const conversations = await tx.conversation.findMany({
      where: { bookingRequestId: requestId },
      select: { id: true },
    });
    const conversationIds = conversations.map((conversation) => conversation.id);

    if (shiftIds.length > 0) await tx.feedback.deleteMany({ where: { shiftId: { in: shiftIds } } });
    if (bookingIds.length > 0) await tx.timesheet.deleteMany({ where: { bookingId: { in: bookingIds } } });
    if (bookingIds.length > 0) await tx.shift.deleteMany({ where: { bookingId: { in: bookingIds } } });
    if (bookingIds.length > 0) await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await tx.offer.deleteMany({ where: { bookingRequestId: requestId } });
    await tx.match.deleteMany({ where: { bookingRequestId: requestId } });
    if (conversationIds.length > 0) {
      await tx.conversationMessage.deleteMany({ where: { conversationId: { in: conversationIds } } });
      await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    }

    const demoRequest = await tx.bookingRequest.upsert({
      where: { id: requestId },
      update: {
        organisationId: input.organisationId,
        siteId: input.siteId,
        status: "broadcasting",
        roleType: "supply_teacher",
        startAt: input.startAt,
        endAt: input.endAt,
        rateMode: "standard",
        payRate: 150,
        maxPayRate: 170,
        requirements: {},
        rawIntent: "KS2 cover, Year 5, tomorrow 8:15-3:30, up to GBP 170/day",
        channel: "web",
        fillProbability: null,
        broadcastStrategy: "simultaneous_top_n",
      },
      create: {
        id: requestId,
        organisationId: input.organisationId,
        siteId: input.siteId,
        status: "broadcasting",
        roleType: "supply_teacher",
        startAt: input.startAt,
        endAt: input.endAt,
        rateMode: "standard",
        payRate: 150,
        maxPayRate: 170,
        requirements: {},
        rawIntent: "KS2 cover, Year 5, tomorrow 8:15-3:30, up to GBP 170/day",
        channel: "web",
        broadcastStrategy: "simultaneous_top_n",
      },
    });

    await tx.offer.create({
      data: {
        id: "demo-offer",
        bookingRequestId: demoRequest.id,
        workerId: input.workerId,
        status: "pending",
        payRate: 150,
        fitExplanation:
          "Greenfield Primary is a short hop from you and you've covered KS2 here before. Your DBS, QTS and safeguarding are all verified, so V can confirm this instantly.",
        expiresAt: input.offerExpiresAt,
      },
    });

    return demoRequest;
  });
}

type OrgSeed = {
  id: string;
  name: string;
  type: string;
  site: {
    id: string;
    name: string;
    address: string;
    city: string;
    postcode: string;
    latitude: number;
    longitude: number;
    siteInstructions: string;
  };
  employer: {
    id: string;
    email: string;
    name: string;
    role: EmployerRole;
  };
  guardrails: {
    budgetCeiling: number;
    approvedRoleTypes: string[];
    escalationContacts: string[];
  };
};

async function upsertEducationOrg(seed: OrgSeed) {
  const org = await prisma.organisation.upsert({
    where: { id: seed.id },
    update: { name: seed.name, type: seed.type },
    create: {
      id: seed.id,
      name: seed.name,
      sector: Sector.education,
      type: seed.type,
      timezone: "Europe/London",
    },
  });

  const site = await prisma.site.upsert({
    where: { id: seed.site.id },
    update: {
      name: seed.site.name,
      address: seed.site.address,
      city: seed.site.city,
      postcode: seed.site.postcode,
      latitude: seed.site.latitude,
      longitude: seed.site.longitude,
      siteInstructions: seed.site.siteInstructions,
    },
    create: {
      id: seed.site.id,
      organisationId: org.id,
      name: seed.site.name,
      address: seed.site.address,
      city: seed.site.city,
      postcode: seed.site.postcode,
      latitude: seed.site.latitude,
      longitude: seed.site.longitude,
      siteInstructions: seed.site.siteInstructions,
    },
  });

  await prisma.guardrailPolicy.upsert({
    where: { organisationId: org.id },
    update: {
      budgetCeiling: seed.guardrails.budgetCeiling,
      approvedRoleTypes: seed.guardrails.approvedRoleTypes,
      escalationContacts: seed.guardrails.escalationContacts,
    },
    create: {
      organisationId: org.id,
      autonomyLevel: AutonomyLevel.L2,
      budgetCeiling: seed.guardrails.budgetCeiling,
      approvedRoleTypes: seed.guardrails.approvedRoleTypes,
      workerWhitelist: [],
      workerBlocklist: [],
      escalationContacts: seed.guardrails.escalationContacts,
    },
  });

  await prisma.employerUser.upsert({
    where: { email: seed.employer.email },
    update: {},
    create: {
      id: seed.employer.id,
      organisationId: org.id,
      email: seed.employer.email,
      name: seed.employer.name,
      role: seed.employer.role,
    },
  });

  return { org, site };
}

const VERIFIED_DOCS = [
  { type: "references", status: "verified" as const },
  { type: "prohibition_check", status: "verified" as const },
];

type DemoBookingFixture = {
  key: string;
  organisationId: string;
  siteId: string;
  workerId: string;
  roleType: string;
  offsetDays: number;
  startHour: number;
  endHour: number;
  payRate: number;
  status: "completed" | "confirmed";
  approvedTimesheet?: boolean;
};

type DemoOfferFixture = {
  key: string;
  organisationId: string;
  siteId: string;
  workerId: string;
  roleType: string;
  offsetDays: number;
  payRate: number;
  status: "pending" | "declined";
  explanation: string;
};

function demoDate(offsetDays: number, hour: number, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function fixtureHours(startAt: Date, endAt: Date) {
  return Number(((endAt.getTime() - startAt.getTime()) / (60 * 60 * 1000)).toFixed(2));
}

function vioraFee(payRate: number) {
  return Number((payRate * 0.18).toFixed(2));
}

async function refreshDemoMemories() {
  const memories = [
    {
      id: "demo-memory-org-greenfield-ks2",
      ownerType: "organisation" as const,
      ownerId: "demo-org",
      subjectType: "site" as const,
      subjectId: "demo-site",
      kind: "instruction" as const,
      key: "demo.greenfield.ks2.briefing",
      title: "KS2 arrival routine",
      content: "Supply staff should arrive by 08:00, collect the Year 5 plan from reception, and check the safeguarding folder before registration.",
      visibility: "operational" as const,
      useScopes: ["intake_default", "briefing", "explanation"] as const,
    },
    {
      id: "demo-memory-org-daycare-ratio",
      ownerType: "organisation" as const,
      ownerId: "demo-org-daycare",
      subjectType: "site" as const,
      subjectId: "demo-site-daycare",
      kind: "instruction" as const,
      key: "demo.daycare.ratio",
      title: "Under-2 ratio",
      content: "Prefer workers with early-years experience for under-2 cover and keep the under-2 room at a 1:3 ratio.",
      visibility: "operational" as const,
      useScopes: ["ranking_signal", "briefing"] as const,
    },
    {
      id: "demo-memory-worker-alex-ks2",
      ownerType: "worker" as const,
      ownerId: "demo-worker",
      subjectType: "worker" as const,
      subjectId: "demo-worker",
      kind: "fit_signal" as const,
      key: "demo.worker.alex.ks2",
      title: "Strong KS2 fit",
      content: "Alex prefers KS2 cover within central London and has repeatedly accepted Greenfield shifts.",
      visibility: "operational" as const,
      useScopes: ["profile", "ranking_signal", "explanation"] as const,
    },
    {
      id: "demo-memory-worker-sophie-cover",
      ownerType: "worker" as const,
      ownerId: "demo-worker-8",
      subjectType: "worker" as const,
      subjectId: "demo-worker-8",
      kind: "fit_signal" as const,
      key: "demo.worker.sophie.cover",
      title: "Primary cover specialist",
      content: "Sophie is strongest for primary supply and confident stepping into cover-supervisor work when needed.",
      visibility: "operational" as const,
      useScopes: ["profile", "ranking_signal", "explanation"] as const,
    },
    {
      id: "demo-memory-worker-amina-early-years",
      ownerType: "worker" as const,
      ownerId: "demo-worker-6",
      subjectType: "worker" as const,
      subjectId: "demo-worker-6",
      kind: "preference" as const,
      key: "demo.worker.amina.early-years",
      title: "Early-years preference",
      content: "Amina prefers daycare and nursery support shifts near Camden.",
      visibility: "private" as const,
      useScopes: ["profile", "ranking_signal"] as const,
    },
    {
      id: "demo-memory-worker-alex-cpd",
      ownerType: "worker" as const,
      ownerId: "demo-worker",
      subjectType: "worker" as const,
      subjectId: "demo-worker",
      kind: "fit_signal" as const,
      key: "demo.worker.alex.cpd",
      title: "Completed safeguarding CPD",
      content: "Alex completed safeguarding refresher CPD and reported it improved confidence on KS2 cover.",
      visibility: "operational" as const,
      useScopes: ["profile", "ranking_signal", "briefing", "explanation"] as const,
      value: {
        valueType: "cpd_training_signal",
        signalType: "completed_cpd",
        title: "Safeguarding refresher",
        provider: "Viora demo CPD",
        completedAt: new Date().toISOString(),
        impact: "Improved confidence on KS2 cover.",
      },
    },
    {
      id: "demo-memory-org-greenfield-import",
      ownerType: "organisation" as const,
      ownerId: "demo-org",
      subjectType: "site" as const,
      subjectId: "demo-site",
      kind: "briefing_note" as const,
      key: "demo.greenfield.imported.parking",
      title: "Imported parking note",
      content: "Imported note awaiting review: visiting staff should use the north gate car park before 08:15.",
      visibility: "operational" as const,
      useScopes: ["briefing", "explanation", "connector_export"] as const,
      status: "pending_confirmation" as const,
      connectorType: "manual_json" as const,
      connectorRef: "demo-import-greenfield-parking",
      sourceLabel: "Seeded connector import",
    },
  ];

  for (const memory of memories) {
    await prisma.memoryEntry.upsert({
      where: { id: memory.id },
      update: {
        title: memory.title,
        content: memory.content,
        visibility: memory.visibility,
        status: memory.status ?? "active",
        useScopes: [...memory.useScopes],
        sensitivity: memory.visibility === "private" ? "sensitive" : "standard",
        value: "value" in memory ? memory.value : undefined,
        connectorType: "connectorType" in memory ? memory.connectorType : undefined,
        connectorRef: "connectorRef" in memory ? memory.connectorRef : undefined,
        sourceLabel: "sourceLabel" in memory ? memory.sourceLabel : "Seed",
        confidence: 0.9,
        confirmedAt: memory.status === "pending_confirmation" ? null : new Date(),
        confirmedBy: memory.status === "pending_confirmation" ? null : "seed",
      },
      create: {
        ...memory,
        sourceType: "system_event",
        sourceRefType: "connectorType" in memory ? "MemoryConnector" : "Seed",
        sourceRefId: "connectorRef" in memory ? memory.connectorRef : "demo-fixtures",
        status: memory.status ?? "active",
        useScopes: [...memory.useScopes],
        sensitivity: memory.visibility === "private" ? "sensitive" : "standard",
        sourceLabel: "sourceLabel" in memory ? memory.sourceLabel : "Seed",
        confidence: 0.9,
        confirmedAt: memory.status === "pending_confirmation" ? undefined : new Date(),
        confirmedBy: memory.status === "pending_confirmation" ? undefined : "seed",
      },
    });
  }
}

async function refreshDemoOperationalFixtures() {
  const bookingFixtures: DemoBookingFixture[] = [
    { key: "greenfield-alex", organisationId: "demo-org", siteId: "demo-site", workerId: "demo-worker", roleType: "supply_teacher", offsetDays: -18, startHour: 8, endHour: 15, payRate: 150, status: "completed", approvedTimesheet: true },
    { key: "greenfield-priya", organisationId: "demo-org", siteId: "demo-site", workerId: "demo-worker-2", roleType: "supply_teacher", offsetDays: -2, startHour: 8, endHour: 15, payRate: 155, status: "completed", approvedTimesheet: false },
    { key: "greenfield-maria", organisationId: "demo-org", siteId: "demo-site", workerId: "demo-worker-4", roleType: "teaching_assistant", offsetDays: -12, startHour: 9, endHour: 15, payRate: 105, status: "completed", approvedTimesheet: true },
    { key: "daycare-amina", organisationId: "demo-org-daycare", siteId: "demo-site-daycare", workerId: "demo-worker-6", roleType: "teaching_assistant", offsetDays: -5, startHour: 8, endHour: 16, payRate: 95, status: "completed", approvedTimesheet: true },
    { key: "nursery-oliver", organisationId: "demo-org-nursery", siteId: "demo-site-nursery", workerId: "demo-worker-7", roleType: "learning_support_assistant", offsetDays: -4, startHour: 8, endHour: 15, payRate: 92, status: "completed", approvedTimesheet: true },
    { key: "oakwood-sophie", organisationId: "demo-org-primary", siteId: "demo-site-primary", workerId: "demo-worker-8", roleType: "supply_teacher", offsetDays: -8, startHour: 8, endHour: 15, payRate: 165, status: "completed", approvedTimesheet: true },
    { key: "secondary-kwame", organisationId: "demo-org-secondary", siteId: "demo-site-secondary", workerId: "demo-worker-13", roleType: "cover_supervisor", offsetDays: -7, startHour: 8, endHour: 15, payRate: 130, status: "completed", approvedTimesheet: true },
    { key: "university-elena", organisationId: "demo-org-university", siteId: "demo-site-university", workerId: "demo-worker-10", roleType: "invigilator", offsetDays: -6, startHour: 9, endHour: 17, payRate: 120, status: "completed", approvedTimesheet: true },
    { key: "daycare-grace", organisationId: "demo-org-daycare", siteId: "demo-site-daycare", workerId: "demo-worker-12", roleType: "teaching_assistant", offsetDays: -10, startHour: 8, endHour: 13, payRate: 88, status: "completed", approvedTimesheet: true },
    { key: "nursery-fatima", organisationId: "demo-org-nursery", siteId: "demo-site-nursery", workerId: "demo-worker-15", roleType: "learning_support_assistant", offsetDays: -9, startHour: 10, endHour: 16, payRate: 96, status: "completed", approvedTimesheet: true },
    { key: "greenfield-daniel", organisationId: "demo-org", siteId: "demo-site", workerId: "demo-worker-9", roleType: "supply_teacher", offsetDays: 3, startHour: 8, endHour: 15, payRate: 145, status: "confirmed" },
  ];

  const offerFixtures: DemoOfferFixture[] = [
    { key: "secondary-james", organisationId: "demo-org-secondary", siteId: "demo-site-secondary", workerId: "demo-worker-3", roleType: "cover_supervisor", offsetDays: 1, payRate: 135, status: "pending", explanation: "Riverside needs a cover supervisor; safeguarding is still being reviewed before this can become a booking." },
    { key: "greenfield-tom", organisationId: "demo-org", siteId: "demo-site", workerId: "demo-worker-5", roleType: "supply_teacher", offsetDays: 4, payRate: 150, status: "declined", explanation: "Tom is a strong match, but the seeded demo keeps DBS pending to show compliance blocking." },
    { key: "greenfield-raj", organisationId: "demo-org", siteId: "demo-site", workerId: "demo-worker-11", roleType: "supply_teacher", offsetDays: 5, payRate: 150, status: "declined", explanation: "Raj would be considered once right-to-work is verified." },
    { key: "oakwood-yuki", organisationId: "demo-org-primary", siteId: "demo-site-primary", workerId: "demo-worker-14", roleType: "supply_teacher", offsetDays: 6, payRate: 150, status: "declined", explanation: "Yuki is visible in the demo history while QTS remains pending." },
  ];

  const allRequestIds = [
    ...bookingFixtures.map((fixture) => `demo-fixture-br-${fixture.key}`),
    ...offerFixtures.map((fixture) => `demo-fixture-br-${fixture.key}`),
  ];
  const bookingIds = bookingFixtures.map((fixture) => `demo-fixture-booking-${fixture.key}`);
  const shiftIds = bookingFixtures.map((fixture) => `demo-fixture-shift-${fixture.key}`);
  const timesheetIds = bookingFixtures.map((fixture) => `demo-fixture-timesheet-${fixture.key}`);
  const invoiceIds = [
    "demo-fixture-invoice-demo-org",
    "demo-fixture-invoice-demo-org-daycare",
    "demo-fixture-invoice-demo-org-nursery",
    "demo-fixture-invoice-demo-org-primary",
    "demo-fixture-invoice-demo-org-secondary",
    "demo-fixture-invoice-demo-org-university",
  ];

  await prisma.$transaction(async (tx) => {
    await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await tx.timesheet.deleteMany({ where: { id: { in: timesheetIds } } });
    await tx.shift.deleteMany({ where: { id: { in: shiftIds } } });
    await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await tx.negotiationRecord.deleteMany({ where: { bookingRequestId: { in: allRequestIds } } });
    await tx.offer.deleteMany({ where: { bookingRequestId: { in: allRequestIds } } });
    await tx.match.deleteMany({ where: { bookingRequestId: { in: allRequestIds } } });
    await tx.bookingRequest.deleteMany({ where: { id: { in: allRequestIds } } });

    for (const fixture of bookingFixtures) {
      const startAt = demoDate(fixture.offsetDays, fixture.startHour, 15);
      const endAt = demoDate(fixture.offsetDays, fixture.endHour, 30);
      const requestId = `demo-fixture-br-${fixture.key}`;
      const matchId = `demo-fixture-match-${fixture.key}`;
      const offerId = `demo-fixture-offer-${fixture.key}`;
      const bookingId = `demo-fixture-booking-${fixture.key}`;
      const shiftId = `demo-fixture-shift-${fixture.key}`;
      const fee = vioraFee(fixture.payRate);

      await tx.bookingRequest.create({
        data: {
          id: requestId,
          organisationId: fixture.organisationId,
          siteId: fixture.siteId,
          status: "filled",
          roleType: fixture.roleType,
          startAt,
          endAt,
          rateMode: "standard",
          payRate: fixture.payRate,
          maxPayRate: Number((fixture.payRate + 25).toFixed(2)),
          requirements: { fixture: true },
          rawIntent: `[demo-fixture] ${fixture.roleType} cover for ${fixture.key}`,
          channel: "web",
          fillProbability: 0.92,
          broadcastStrategy: "simultaneous_top_n",
        },
      });
      await tx.match.create({
        data: {
          id: matchId,
          bookingRequestId: requestId,
          workerId: fixture.workerId,
          rank: 1,
          acceptanceProbability: fixture.status === "completed" ? 0.91 : 0.82,
          reasoning: "Seeded demo fixture showing a realistic booking lifecycle.",
          scores: { fixture: true, roleFit: 0.9, distance: 0.8 },
        },
      });
      await tx.offer.create({
        data: {
          id: offerId,
          bookingRequestId: requestId,
          workerId: fixture.workerId,
          matchId,
          status: "accepted",
          payRate: fixture.payRate,
          fitExplanation: "Seeded demo offer accepted to populate booking, shift, timesheet and finance views.",
          expiresAt: demoDate(fixture.offsetDays - 1, 18),
        },
      });
      await tx.booking.create({
        data: {
          id: bookingId,
          bookingRequestId: requestId,
          organisationId: fixture.organisationId,
          siteId: fixture.siteId,
          workerId: fixture.workerId,
          offerId,
          status: fixture.status,
          roleType: fixture.roleType,
          startAt,
          endAt,
          payRate: fixture.payRate,
          vioraFee: fee,
          totalCost: Number((fixture.payRate + fee).toFixed(2)),
          backupWorkerIds: fixture.status === "confirmed" ? ["demo-worker", "demo-worker-2"] : [],
          complianceSnapshot: { fixture: true, eligible: true, checkedAt: new Date().toISOString() },
        },
      });
      await tx.shift.create({
        data: {
          id: shiftId,
          bookingId,
          status: fixture.status === "completed" ? "checked_out" : "scheduled",
          checkedInAt: fixture.status === "completed" ? demoDate(fixture.offsetDays, fixture.startHour, 5) : null,
          checkedOutAt: fixture.status === "completed" ? demoDate(fixture.offsetDays, fixture.endHour, 35) : null,
          checkInLatitude: fixture.status === "completed" ? 51.5074 : null,
          checkInLongitude: fixture.status === "completed" ? -0.1278 : null,
        },
      });
      if (fixture.status === "completed") {
        const hoursWorked = fixtureHours(startAt, endAt);
        await tx.timesheet.create({
          data: {
            id: `demo-fixture-timesheet-${fixture.key}`,
            shiftId,
            bookingId,
            workerId: fixture.workerId,
            organisationId: fixture.organisationId,
            hoursWorked,
            approved: Boolean(fixture.approvedTimesheet),
            approvedAt: fixture.approvedTimesheet ? demoDate(fixture.offsetDays + 1, 10) : null,
            approvedBy: fixture.approvedTimesheet ? "seed-admin" : null,
          },
        });
      }
    }

    for (const fixture of offerFixtures) {
      const startAt = demoDate(fixture.offsetDays, 8, 30);
      const endAt = demoDate(fixture.offsetDays, 15, 30);
      const requestId = `demo-fixture-br-${fixture.key}`;
      const matchId = `demo-fixture-match-${fixture.key}`;

      await tx.bookingRequest.create({
        data: {
          id: requestId,
          organisationId: fixture.organisationId,
          siteId: fixture.siteId,
          status: "broadcasting",
          roleType: fixture.roleType,
          startAt,
          endAt,
          rateMode: "standard",
          payRate: fixture.payRate,
          maxPayRate: Number((fixture.payRate + 25).toFixed(2)),
          requirements: { fixture: true },
          rawIntent: `[demo-fixture] Open ${fixture.roleType} request for ${fixture.key}`,
          channel: "web",
          fillProbability: 0.66,
          broadcastStrategy: "simultaneous_top_n",
        },
      });
      await tx.match.create({
        data: {
          id: matchId,
          bookingRequestId: requestId,
          workerId: fixture.workerId,
          rank: 1,
          acceptanceProbability: fixture.status === "pending" ? 0.71 : 0.28,
          reasoning: fixture.explanation,
          scores: { fixture: true, roleFit: 0.75 },
        },
      });
      await tx.offer.create({
        data: {
          id: `demo-fixture-offer-${fixture.key}`,
          bookingRequestId: requestId,
          workerId: fixture.workerId,
          matchId,
          status: fixture.status,
          payRate: fixture.payRate,
          fitExplanation: fixture.explanation,
          expiresAt: demoDate(fixture.offsetDays - 1, 18),
        },
      });
    }

    const approvedTimesheets = await tx.timesheet.findMany({
      where: {
        id: { in: timesheetIds },
        approved: true,
      },
      include: { booking: true },
    });
    const byOrg = new Map<string, typeof approvedTimesheets>();
    for (const timesheet of approvedTimesheets) {
      const rows = byOrg.get(timesheet.organisationId) ?? [];
      rows.push(timesheet);
      byOrg.set(timesheet.organisationId, rows);
    }

    for (const [organisationId, rows] of byOrg.entries()) {
      const workerPayTotal = rows.reduce((sum, row) => sum + row.booking.payRate * row.hoursWorked, 0);
      const vioraFeeTotal = rows.reduce((sum, row) => sum + row.booking.vioraFee * row.hoursWorked, 0);
      await tx.invoice.create({
        data: {
          id: `demo-fixture-invoice-${organisationId}`,
          organisationId,
          periodStart: new Date(Math.min(...rows.map((row) => row.booking.startAt.getTime()))),
          periodEnd: new Date(Math.max(...rows.map((row) => row.booking.endAt.getTime()))),
          workerPayTotal: Number(workerPayTotal.toFixed(2)),
          vioraFeeTotal: Number(vioraFeeTotal.toFixed(2)),
          totalAmount: Number((workerPayTotal + vioraFeeTotal).toFixed(2)),
          status: "draft",
        },
      });
    }
  });

  await refreshDemoMemories();
}

async function refreshDemoScheduleAvailability() {
  const tomorrowUnavailableStart = demoDate(2, 16, 0);
  const tomorrowUnavailableEnd = demoDate(2, 18, 0);
  const nextWeekUnavailableStart = demoDate(8, 9, 0);
  const nextWeekUnavailableEnd = demoDate(8, 12, 0);

  await prisma.workerAvailabilityPattern.upsert({
    where: { workerId: "demo-worker" },
    update: {
      timezone: "Europe/London",
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: "08:00",
      endTime: "17:00",
    },
    create: {
      workerId: "demo-worker",
      timezone: "Europe/London",
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: "08:00",
      endTime: "17:00",
    },
  });

  await Promise.all([
    prisma.workerAvailabilityBlock.upsert({
      where: { id: "demo-availability-alex-after-school" },
      update: {
        startAt: tomorrowUnavailableStart,
        endAt: tomorrowUnavailableEnd,
        note: "After-school appointment",
      },
      create: {
        id: "demo-availability-alex-after-school",
        workerId: "demo-worker",
        startAt: tomorrowUnavailableStart,
        endAt: tomorrowUnavailableEnd,
        note: "After-school appointment",
      },
    }),
    prisma.workerAvailabilityBlock.upsert({
      where: { id: "demo-availability-alex-training" },
      update: {
        startAt: nextWeekUnavailableStart,
        endAt: nextWeekUnavailableEnd,
        note: "CPD training",
      },
      create: {
        id: "demo-availability-alex-training",
        workerId: "demo-worker",
        startAt: nextWeekUnavailableStart,
        endAt: nextWeekUnavailableEnd,
        note: "CPD training",
      },
    }),
  ]);
}

async function main() {
  const educationRoles = [
    "supply_teacher",
    "cover_supervisor",
    "teaching_assistant",
    "learning_support_assistant",
    "invigilator",
  ];

  // ── Education settings (day care → university) ───────────────────────────
  const { org: matOrg, site: primarySite } = await upsertEducationOrg({
    id: "demo-org",
    name: "Greenfield MAT",
    type: "mat",
    site: {
      id: "demo-site",
      name: "Greenfield Primary",
      address: "12 School Lane",
      city: "London",
      postcode: "SW1A 1AA",
      latitude: 51.5074,
      longitude: -0.1278,
      siteInstructions: "Sign in at reception. Safeguarding briefing required.",
    },
    employer: {
      id: "demo-employer",
      email: "sarah.johnson@greenfieldmat.org",
      name: "Sarah Johnson",
      role: EmployerRole.cover_manager,
    },
    guardrails: {
      budgetCeiling: 200,
      approvedRoleTypes: educationRoles,
      escalationContacts: ["cover@greenfieldmat.org"],
    },
  });

  const { site: daycareSite } = await upsertEducationOrg({
    id: "demo-org-daycare",
    name: "Little Sprouts Day Care",
    type: "daycare",
    site: {
      id: "demo-site-daycare",
      name: "Little Sprouts — Camden",
      address: "8 Mornington Crescent",
      city: "London",
      postcode: "NW1 7RH",
      latitude: 51.5342,
      longitude: -0.1389,
      siteInstructions: "Ring the green doorbell. Ratio 1:3 for under-2s.",
    },
    employer: {
      id: "demo-employer-daycare",
      email: "emma.walsh@littlesprouts.co.uk",
      name: "Emma Walsh",
      role: EmployerRole.cover_manager,
    },
    guardrails: {
      budgetCeiling: 120,
      approvedRoleTypes: ["teaching_assistant", "learning_support_assistant"],
      escalationContacts: ["emma.walsh@littlesprouts.co.uk"],
    },
  });

  const { site: nurserySite } = await upsertEducationOrg({
    id: "demo-org-nursery",
    name: "Rainbow Nursery Group",
    type: "nursery",
    site: {
      id: "demo-site-nursery",
      name: "Rainbow Nursery — Islington",
      address: "44 Upper Street",
      city: "London",
      postcode: "N1 0PN",
      latitude: 51.5362,
      longitude: -0.1032,
      siteInstructions: "Collect fob from office. Outdoor play until 11:00.",
    },
    employer: {
      id: "demo-employer-nursery",
      email: "david.okonkwo@rainbownursery.org",
      name: "David Okonkwo",
      role: EmployerRole.organisation_admin,
    },
    guardrails: {
      budgetCeiling: 110,
      approvedRoleTypes: ["teaching_assistant", "learning_support_assistant", "cover_supervisor"],
      escalationContacts: ["david.okonkwo@rainbownursery.org"],
    },
  });

  const { site: oakwoodSite } = await upsertEducationOrg({
    id: "demo-org-primary",
    name: "Oakwood Primary School",
    type: "primary",
    site: {
      id: "demo-site-primary",
      name: "Oakwood Primary",
      address: "91 Oakwood Road",
      city: "London",
      postcode: "SE15 4JN",
      latitude: 51.4789,
      longitude: -0.0621,
      siteInstructions: "Report to the school office. Visitor badge required.",
    },
    employer: {
      id: "demo-employer-primary",
      email: "helen.patel@oakwoodprimary.sch.uk",
      name: "Helen Patel",
      role: EmployerRole.cover_manager,
    },
    guardrails: {
      budgetCeiling: 185,
      approvedRoleTypes: ["supply_teacher", "cover_supervisor", "teaching_assistant"],
      escalationContacts: ["helen.patel@oakwoodprimary.sch.uk"],
    },
  });

  const { site: secondarySite } = await upsertEducationOrg({
    id: "demo-org-secondary",
    name: "Riverside Academy Trust",
    type: "secondary",
    site: {
      id: "demo-site-secondary",
      name: "Riverside Academy",
      address: "200 Thames Street",
      city: "London",
      postcode: "E14 9SH",
      latitude: 51.5055,
      longitude: -0.0235,
      siteInstructions: "Staff entrance on Dock Road. Bring photo ID.",
    },
    employer: {
      id: "demo-employer-secondary",
      email: "marcus.thompson@riversideacademy.org",
      name: "Marcus Thompson",
      role: EmployerRole.cover_manager,
    },
    guardrails: {
      budgetCeiling: 220,
      approvedRoleTypes: ["supply_teacher", "cover_supervisor", "teaching_assistant", "invigilator"],
      escalationContacts: ["marcus.thompson@riversideacademy.org"],
    },
  });

  const { site: universitySite } = await upsertEducationOrg({
    id: "demo-org-university",
    name: "Kingsbridge University",
    type: "university",
    site: {
      id: "demo-site-university",
      name: "Kingsbridge — South Campus",
      address: "15 Kingsway",
      city: "London",
      postcode: "WC2B 6NH",
      latitude: 51.5155,
      longitude: -0.1172,
      siteInstructions: "Faculty building, room B12. Parking via permit only.",
    },
    employer: {
      id: "demo-employer-university",
      email: "fiona.nguyen@kingsbridge.ac.uk",
      name: "Dr Fiona Nguyen",
      role: EmployerRole.organisation_admin,
    },
    guardrails: {
      budgetCeiling: 280,
      approvedRoleTypes: ["supply_teacher", "invigilator", "learning_support_assistant"],
      escalationContacts: ["fiona.nguyen@kingsbridge.ac.uk"],
    },
  });

  // ── Workers (15 total — varied roles, compliance, distance) ─────────────
  const alex = await upsertWorker({
    id: "demo-worker",
    firstName: "Alex",
    lastName: "Taylor",
    email: "demo.worker@viora.dev",
    phone: "+447700900000",
    homeAddress: "22 Great Peter Street",
    homeCity: "London",
    homePostcode: "SW1P 2BN",
    homeLatitude: 51.51,
    homeLongitude: -0.13,
    roleTypes: ["supply_teacher"],
    workRadiusKm: 25,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      qtsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 4.8,
    },
    docs: VERIFIED_DOCS,
  });

  const priya = await upsertWorker({
    id: "demo-worker-2",
    firstName: "Priya",
    lastName: "Sharma",
    email: "priya.sharma@viora.dev",
    phone: "+447700900001",
    homeAddress: "14 Lamb's Conduit Street",
    homeCity: "London",
    homePostcode: "WC1N 3LE",
    homeLatitude: 51.52,
    homeLongitude: -0.12,
    roleTypes: ["supply_teacher"],
    workRadiusKm: 25,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      qtsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 4.2,
    },
    docs: VERIFIED_DOCS,
  });

  const james = await upsertWorker({
    id: "demo-worker-3",
    firstName: "James",
    lastName: "Mitchell",
    email: "james.mitchell@viora.dev",
    phone: "+447700900002",
    homeAddress: "6 Strutton Ground",
    homeCity: "London",
    homePostcode: "SW1P 2HP",
    homeLatitude: 51.505,
    homeLongitude: -0.135,
    roleTypes: ["cover_supervisor"],
    workRadiusKm: 25,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.pending,
      sectorEligibility: [],
      reliabilityScore: 3.5,
    },
    docs: [
      ...VERIFIED_DOCS,
      { type: "safeguarding", status: "pending" },
    ],
  });

  const maria = await upsertWorker({
    id: "demo-worker-4",
    firstName: "Maria",
    lastName: "Chen",
    email: "maria.chen@viora.dev",
    phone: "+447700900003",
    homeAddress: "31 Exmouth Market",
    homeCity: "London",
    homePostcode: "EC1R 4QL",
    homeLatitude: 51.515,
    homeLongitude: -0.115,
    roleTypes: ["teaching_assistant"],
    workRadiusKm: 25,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 3.9,
    },
    docs: VERIFIED_DOCS,
  });

  const tom = await upsertWorker({
    id: "demo-worker-5",
    firstName: "Tom",
    lastName: "Blake",
    email: "tom.blake@viora.dev",
    phone: "+447700900004",
    homeAddress: "73 Canonbury Road",
    homeCity: "London",
    homePostcode: "N1 2DG",
    homeLatitude: 51.54,
    homeLongitude: -0.11,
    roleTypes: ["supply_teacher"],
    workRadiusKm: 25,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.pending,
      qtsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [],
      reliabilityScore: 4.5,
    },
    docs: [
      ...VERIFIED_DOCS,
      { type: "enhanced_dbs", status: "pending" },
    ],
  });

  const amina = await upsertWorker({
    id: "demo-worker-6",
    firstName: "Amina",
    lastName: "Hassan",
    email: "amina.hassan@viora.dev",
    phone: "+447700900005",
    homeAddress: "19 Arlington Road",
    homeCity: "London",
    homePostcode: "NW1 7ER",
    homeLatitude: 51.533,
    homeLongitude: -0.141,
    roleTypes: ["teaching_assistant", "learning_support_assistant"],
    workRadiusKm: 15,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 4.6,
    },
    docs: VERIFIED_DOCS,
  });

  const oliver = await upsertWorker({
    id: "demo-worker-7",
    firstName: "Oliver",
    lastName: "Bennett",
    email: "oliver.bennett@viora.dev",
    phone: "+447700900006",
    homeAddress: "58 Essex Road",
    homeCity: "London",
    homePostcode: "N1 8LR",
    homeLatitude: 51.537,
    homeLongitude: -0.105,
    roleTypes: ["learning_support_assistant"],
    workRadiusKm: 12,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 4.0,
    },
    docs: VERIFIED_DOCS,
  });

  const sophie = await upsertWorker({
    id: "demo-worker-8",
    firstName: "Sophie",
    lastName: "Williams",
    email: "sophie.williams@viora.dev",
    phone: "+447700900007",
    homeAddress: "26 Bellenden Road",
    homeCity: "London",
    homePostcode: "SE15 4BY",
    homeLatitude: 51.482,
    homeLongitude: -0.058,
    roleTypes: ["supply_teacher", "cover_supervisor"],
    workRadiusKm: 30,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      qtsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 4.9,
    },
    docs: VERIFIED_DOCS,
  });

  const daniel = await upsertWorker({
    id: "demo-worker-9",
    firstName: "Daniel",
    lastName: "Okafor",
    email: "daniel.okafor@viora.dev",
    phone: "+447700900008",
    homeAddress: "42 Westferry Road",
    homeCity: "London",
    homePostcode: "E14 8LW",
    homeLatitude: 51.508,
    homeLongitude: -0.025,
    roleTypes: ["supply_teacher"],
    workRadiusKm: 20,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      qtsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 3.2,
    },
    docs: VERIFIED_DOCS,
  });

  const elena = await upsertWorker({
    id: "demo-worker-10",
    firstName: "Elena",
    lastName: "Vasquez",
    email: "elena.vasquez@viora.dev",
    phone: "+447700900009",
    homeAddress: "10 Sardinia Street",
    homeCity: "London",
    homePostcode: "WC2A 3LZ",
    homeLatitude: 51.516,
    homeLongitude: -0.118,
    roleTypes: ["invigilator", "learning_support_assistant"],
    workRadiusKm: 18,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 4.3,
    },
    docs: VERIFIED_DOCS,
  });

  const raj = await upsertWorker({
    id: "demo-worker-11",
    firstName: "Raj",
    lastName: "Mehta",
    email: "raj.mehta@viora.dev",
    phone: "+447700900010",
    homeAddress: "88 King Street",
    homeCity: "London",
    homePostcode: "W6 0QW",
    homeLatitude: 51.501,
    homeLongitude: -0.19,
    roleTypes: ["supply_teacher"],
    workRadiusKm: 40,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.pending,
      dbsStatus: ComplianceStatus.verified,
      qtsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [],
      reliabilityScore: 4.1,
    },
    docs: VERIFIED_DOCS,
  });

  const grace = await upsertWorker({
    id: "demo-worker-12",
    firstName: "Grace",
    lastName: "Murphy",
    email: "grace.murphy@viora.dev",
    phone: "+447700900011",
    homeAddress: "35 Stoke Newington Road",
    homeCity: "London",
    homePostcode: "N16 8BJ",
    homeLatitude: 51.549,
    homeLongitude: -0.075,
    roleTypes: ["teaching_assistant"],
    workRadiusKm: 10,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 3.7,
    },
    docs: VERIFIED_DOCS,
  });

  const kwame = await upsertWorker({
    id: "demo-worker-13",
    firstName: "Kwame",
    lastName: "Asante",
    email: "kwame.asante@viora.dev",
    phone: "+447700900012",
    homeAddress: "7 Lupus Street",
    homeCity: "London",
    homePostcode: "SW1V 3AS",
    homeLatitude: 51.492,
    homeLongitude: -0.148,
    roleTypes: ["cover_supervisor", "invigilator"],
    workRadiusKm: 22,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 4.4,
    },
    docs: VERIFIED_DOCS,
  });

  const yuki = await upsertWorker({
    id: "demo-worker-14",
    firstName: "Yuki",
    lastName: "Tanaka",
    email: "yuki.tanaka@viora.dev",
    phone: "+447700900013",
    homeAddress: "64 Gloucester Avenue",
    homeCity: "London",
    homePostcode: "NW1 8JD",
    homeLatitude: 51.528,
    homeLongitude: -0.155,
    roleTypes: ["supply_teacher"],
    workRadiusKm: 25,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      qtsStatus: ComplianceStatus.pending,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [],
      reliabilityScore: 3.0,
    },
    docs: VERIFIED_DOCS,
  });

  const fatima = await upsertWorker({
    id: "demo-worker-15",
    firstName: "Fatima",
    lastName: "Al-Rashid",
    email: "fatima.alrashid@viora.dev",
    phone: "+447700900014",
    homeAddress: "21 Queen Victoria Street",
    homeCity: "London",
    homePostcode: "EC4N 4SA",
    homeLatitude: 51.511,
    homeLongitude: -0.095,
    roleTypes: ["learning_support_assistant", "teaching_assistant"],
    workRadiusKm: 14,
    passport: {
      identityVerified: true,
      rightToWorkStatus: ComplianceStatus.verified,
      dbsStatus: ComplianceStatus.verified,
      safeguardingStatus: ComplianceStatus.verified,
      sectorEligibility: [Sector.education],
      reliabilityScore: 4.7,
    },
    docs: VERIFIED_DOCS,
  });

  // ── Demo offer for the worker swipe deck ─────────────────────────────────
  // Worker pay floors support the dedicated Dynamic Rate sandbox scenario.
  await Promise.all([
    upsertWorkerPayFloor(alex.id, 150, alex.roleTypes),
    upsertWorkerPayFloor(priya.id, 155, priya.roleTypes),
    upsertWorkerPayFloor(sophie.id, 165, sophie.roleTypes),
    upsertWorkerPayFloor(daniel.id, 145, daniel.roleTypes),
  ]);

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
      organisationId: matOrg.id,
      siteId: primarySite.id,
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

  await refreshCanonicalDemoRequest({
    organisationId: matOrg.id,
    siteId: primarySite.id,
    workerId: alex.id,
    startAt: shiftStart,
    endAt: shiftEnd,
    offerExpiresAt: offerExpiry,
  });
  await refreshDemoOperationalFixtures();
  await refreshDemoScheduleAvailability();

  console.log("Seed complete:", {
    organisations: [
      `${matOrg.id}: Greenfield MAT (mat) → ${primarySite.name}`,
      `demo-org-daycare: Little Sprouts Day Care → ${daycareSite.name}`,
      `demo-org-nursery: Rainbow Nursery Group → ${nurserySite.name}`,
      `demo-org-primary: Oakwood Primary School → ${oakwoodSite.name}`,
      `demo-org-secondary: Riverside Academy Trust → ${secondarySite.name}`,
      `demo-org-university: Kingsbridge University → ${universitySite.name}`,
    ],
    employers: 6,
    workers: [
      `${alex.id}: Alex Taylor          supply_teacher           verified  4.8★`,
      `${priya.id}: Priya Sharma       supply_teacher           verified  4.2★`,
      `${james.id}: James Mitchell     cover_supervisor         safeguarding⚠ 3.5★`,
      `${maria.id}: Maria Chen         teaching_assistant       verified  3.9★`,
      `${tom.id}: Tom Blake            supply_teacher           DBS pending⚠ 4.5★`,
      `${amina.id}: Amina Hassan       TA / LSA (early years)   verified  4.6★`,
      `${oliver.id}: Oliver Bennett    LSA (nursery)            verified  4.0★`,
      `${sophie.id}: Sophie Williams   supply / cover           verified  4.9★`,
      `${daniel.id}: Daniel Okafor     supply_teacher (sec)     verified  3.2★`,
      `${elena.id}: Elena Vasquez     invigilator / LSA (uni)  verified  4.3★`,
      `${raj.id}: Raj Mehta            supply_teacher           RTW pending⚠ 4.1★`,
      `${grace.id}: Grace Murphy       teaching_assistant       verified  3.7★`,
      `${kwame.id}: Kwame Asante       cover / invigilator      verified  4.4★`,
      `${yuki.id}: Yuki Tanaka         supply_teacher           QTS pending⚠ 3.0★`,
      `${fatima.id}: Fatima Al-Rashid  LSA / TA                 verified  4.7★`,
    ],
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
