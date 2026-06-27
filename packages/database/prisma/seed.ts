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
      roleTypes: seed.roleTypes,
      workRadiusKm: seed.workRadiusKm,
    },
    create: {
      id: seed.id,
      firstName: seed.firstName,
      lastName: seed.lastName,
      email: seed.email,
      phone: seed.phone,
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
    update: {},
    create: {
      id: seed.site.id,
      organisationId: org.id,
      name: seed.site.name,
      address: seed.site.address,
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
      address: "12 School Lane, London SW1A 1AA",
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
      address: "8 Mornington Crescent, London NW1 7RH",
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
      address: "44 Upper Street, London N1 0PN",
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
      address: "91 Oakwood Road, London SE15 4JN",
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
      address: "200 Thames Street, London E14 9SH",
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
      address: "15 Kingsway, London WC2B 6NH",
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
