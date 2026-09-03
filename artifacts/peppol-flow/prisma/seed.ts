import {
  IncidentSeverity,
  IncidentStatus,
  MembershipRole,
  OrganizationPlan,
  PeppolStatus,
  Prisma,
  PrismaClient,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

const organizationId = "org_northstar_accounting";

const users = [
  {
    id: "user_elise_martin",
    name: "Elise Martin",
    email: "elise@northstar-accounting.be",
    avatarInitials: "EM",
  },
  {
    id: "user_lucas_de_smet",
    name: "Lucas De Smet",
    email: "lucas@northstar-accounting.be",
    avatarInitials: "LD",
  },
  {
    id: "user_nora_peeters",
    name: "Nora Peeters",
    email: "nora@northstar-accounting.be",
    avatarInitials: "NP",
  },
] as const;

const companies = [
  {
    id: "company_fjord_logistics",
    name: "Fjord Logistiek",
    legalName: "Fjord Logistiek NV",
    email: "finance@fjordlogistics.be",
    registrationNumber: "BE0798123456",
    accountingPackage: "Exact Online",
    peppolStatus: PeppolStatus.AT_RISK,
    readinessScore: 30,
    lastCheckedAt: new Date("2026-09-03T09:32:00.000Z"),
  },
  {
    id: "company_atelier_noma",
    name: "Atelier Noma",
    legalName: "Atelier Noma BV",
    email: "accounts@ateliernoma.be",
    registrationNumber: "BE0745234567",
    accountingPackage: "Odoo",
    peppolStatus: PeppolStatus.CONFIGURING,
    readinessScore: 85,
    lastCheckedAt: new Date("2026-09-03T08:15:00.000Z"),
  },
  {
    id: "company_green_energy",
    name: "Groene Energie",
    legalName: "Groene Energie Oplossingen NV",
    email: "billing@greenenergy.be",
    registrationNumber: "BE0689345678",
    accountingPackage: "WinBooks",
    peppolStatus: PeppolStatus.READY,
    readinessScore: 100,
    lastCheckedAt: new Date("2026-09-03T07:45:00.000Z"),
  },
  {
    id: "company_design_studio",
    name: "Ontwerpstudio",
    legalName: "Ontwerpstudio BV",
    email: "hello@designstudio.be",
    registrationNumber: "BE0767456789",
    accountingPackage: "Yuki",
    peppolStatus: PeppolStatus.NOT_REGISTERED,
    readinessScore: 0,
    lastCheckedAt: new Date("2026-09-02T16:40:00.000Z"),
  },
  {
    id: "company_marketing_masters",
    name: "Marketingmeesters",
    legalName: "Marketingmeesters BV",
    email: "finance@marketingmasters.be",
    registrationNumber: "BE0712567890",
    accountingPackage: "Exact Online",
    peppolStatus: PeppolStatus.CONFIGURING,
    readinessScore: 65,
    lastCheckedAt: new Date("2026-09-02T14:22:00.000Z"),
  },
] as const;

const readinessScores = [
  {
    id: "score_fjord_aug",
    companyId: "company_fjord_logistics",
    score: 65,
    status: PeppolStatus.CONFIGURING,
    checkedAt: new Date("2026-08-03T09:00:00.000Z"),
    source: "manual_review",
    details: {
      participantRegistered: true,
      receivingAddressConfigured: false,
      peppolCapableSoftware: true,
      certificateValid: true,
      successfulTestInvoice: false,
    },
  },
  {
    id: "score_fjord_sep",
    companyId: "company_fjord_logistics",
    score: 30,
    status: PeppolStatus.AT_RISK,
    checkedAt: new Date("2026-09-03T09:32:00.000Z"),
    source: "readiness_scan",
    details: {
      participantRegistered: true,
      receivingAddressConfigured: false,
      peppolCapableSoftware: false,
      certificateValid: false,
      successfulTestInvoice: false,
    },
  },
  {
    id: "score_noma_aug",
    companyId: "company_atelier_noma",
    score: 65,
    status: PeppolStatus.CONFIGURING,
    checkedAt: new Date("2026-08-03T08:00:00.000Z"),
    source: "readiness_scan",
    details: {
      participantRegistered: true,
      receivingAddressConfigured: true,
      peppolCapableSoftware: false,
      certificateValid: true,
      successfulTestInvoice: false,
    },
  },
  {
    id: "score_noma_sep",
    companyId: "company_atelier_noma",
    score: 85,
    status: PeppolStatus.CONFIGURING,
    checkedAt: new Date("2026-09-03T08:15:00.000Z"),
    source: "readiness_scan",
    details: {
      participantRegistered: true,
      receivingAddressConfigured: true,
      peppolCapableSoftware: true,
      certificateValid: true,
      successfulTestInvoice: false,
    },
  },
  {
    id: "score_green_sep",
    companyId: "company_green_energy",
    score: 100,
    status: PeppolStatus.READY,
    checkedAt: new Date("2026-09-03T07:45:00.000Z"),
    source: "readiness_scan",
    details: {
      participantRegistered: true,
      receivingAddressConfigured: true,
      peppolCapableSoftware: true,
      certificateValid: true,
      successfulTestInvoice: true,
    },
  },
  {
    id: "score_design_sep",
    companyId: "company_design_studio",
    score: 0,
    status: PeppolStatus.NOT_REGISTERED,
    checkedAt: new Date("2026-09-02T16:40:00.000Z"),
    source: "manual_review",
    details: {
      participantRegistered: false,
      receivingAddressConfigured: false,
      peppolCapableSoftware: false,
      certificateValid: false,
      successfulTestInvoice: false,
    },
  },
  {
    id: "score_marketing_sep",
    companyId: "company_marketing_masters",
    score: 65,
    status: PeppolStatus.CONFIGURING,
    checkedAt: new Date("2026-09-02T14:22:00.000Z"),
    source: "readiness_scan",
    details: {
      participantRegistered: true,
      receivingAddressConfigured: true,
      peppolCapableSoftware: false,
      certificateValid: true,
      successfulTestInvoice: false,
    },
  },
] as const;

async function seed() {
  await prisma.organization.upsert({
    where: { id: organizationId },
    update: {
      name: "Northstar Boekhouding",
      slug: "northstar-accounting",
      plan: OrganizationPlan.PROFESSIONAL,
    },
    create: {
      id: organizationId,
      name: "Northstar Boekhouding",
      slug: "northstar-accounting",
      plan: OrganizationPlan.PROFESSIONAL,
    },
  });

  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: user,
      create: user,
    });
  }

  const memberships = [
    {
      id: "membership_elise_owner",
      userId: "user_elise_martin",
      role: MembershipRole.OWNER,
    },
    {
      id: "membership_lucas_admin",
      userId: "user_lucas_de_smet",
      role: MembershipRole.ADMIN,
    },
    {
      id: "membership_nora_member",
      userId: "user_nora_peeters",
      role: MembershipRole.MEMBER,
    },
  ] as const;

  for (const membership of memberships) {
    await prisma.membership.upsert({
      where: { id: membership.id },
      update: {
        role: membership.role,
      },
      create: {
        ...membership,
        organizationId,
      },
    });
  }

  for (const company of companies) {
    await prisma.company.upsert({
      where: { id: company.id },
      update: company,
      create: {
        ...company,
        organizationId,
      },
    });
  }

  for (const readinessScore of readinessScores) {
    await prisma.readinessScore.upsert({
      where: { id: readinessScore.id },
      update: {
        ...readinessScore,
        details: readinessScore.details as Prisma.InputJsonValue,
      },
      create: {
        ...readinessScore,
        details: readinessScore.details as Prisma.InputJsonValue,
      },
    });
  }

  const tasks = [
    {
      id: "task_register_design_studio",
      companyId: "company_design_studio",
      assignedToId: "user_lucas_de_smet",
      createdById: "user_elise_martin",
      title: "Peppol-registratie voltooien",
      description: "Verzamel de registratiegegevens en dien het bedrijfsprofiel in.",
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.URGENT,
      dueDate: new Date("2026-09-05T15:00:00.000Z"),
    },
    {
      id: "task_fix_fjord_endpoint",
      companyId: "company_fjord_logistics",
      assignedToId: "user_nora_peeters",
      createdById: "user_elise_martin",
      title: "Ontvangstendpoint bevestigen",
      description: "Controleer de configuratie van het access point na de geweigerde factuur.",
      status: TaskStatus.OPEN,
      priority: TaskPriority.HIGH,
      dueDate: new Date("2026-09-04T12:00:00.000Z"),
    },
    {
      id: "task_review_noma_software",
      companyId: "company_atelier_noma",
      assignedToId: "user_lucas_de_smet",
      createdById: "user_elise_martin",
      title: "Peppol-geschikte software controleren",
      description: "Bevestig dat de Odoo-connector de vereiste documentstroom ondersteunt.",
      status: TaskStatus.OPEN,
      priority: TaskPriority.MEDIUM,
      dueDate: new Date("2026-09-09T15:00:00.000Z"),
    },
  ] as const;

  for (const task of tasks) {
    await prisma.task.upsert({
      where: { id: task.id },
      update: task,
      create: {
        ...task,
        organizationId,
      },
    });
  }

  const incidents = [
    {
      id: "incident_fjord_rejected",
      companyId: "company_fjord_logistics",
      title: "Factuur geweigerd door access point",
      description: "De ontvangstendpoint heeft de laatste uitgaande factuur geweigerd.",
      severity: IncidentSeverity.CRITICAL,
      status: IncidentStatus.INVESTIGATING,
      occurredAt: new Date("2026-09-03T09:32:00.000Z"),
    },
    {
      id: "incident_noma_certificate",
      companyId: "company_atelier_noma",
      title: "Certificaat van endpoint verloopt binnenkort",
      description: "Het ingestelde certificaat verloopt binnen veertien dagen.",
      severity: IncidentSeverity.WARNING,
      status: IncidentStatus.OPEN,
      occurredAt: new Date("2026-09-03T08:15:00.000Z"),
    },
    {
      id: "incident_green_resolved",
      companyId: "company_green_energy",
      title: "Opzoeken van deelnemer vertraagd",
      description: "De zoektijd voor deelnemers overschreed kort de bewakingsdrempel.",
      severity: IncidentSeverity.INFO,
      status: IncidentStatus.RESOLVED,
      occurredAt: new Date("2026-09-02T11:20:00.000Z"),
      resolvedAt: new Date("2026-09-02T11:42:00.000Z"),
    },
  ] as const;

  for (const incident of incidents) {
    await prisma.incident.upsert({
      where: { id: incident.id },
      update: incident,
      create: {
        ...incident,
        organizationId,
      },
    });
  }

  const auditEvents = [
    {
      id: "audit_company_created_design",
      actorId: "user_elise_martin",
      eventType: "company.created",
      entityType: "company",
      entityId: "company_design_studio",
      metadata: { source: "seed", readinessScore: 18 },
      createdAt: new Date("2026-09-01T10:05:00.000Z"),
    },
    {
      id: "audit_score_updated_fjord",
      actorId: "user_nora_peeters",
      eventType: "readiness.score_updated",
      entityType: "company",
      entityId: "company_fjord_logistics",
      metadata: { previousScore: 55, score: 42 },
      createdAt: new Date("2026-09-03T09:33:00.000Z"),
    },
    {
      id: "audit_task_assigned_fjord",
      actorId: "user_elise_martin",
      eventType: "task.assigned",
      entityType: "task",
      entityId: "task_fix_fjord_endpoint",
      metadata: { assigneeId: "user_nora_peeters" },
      createdAt: new Date("2026-09-03T09:40:00.000Z"),
    },
  ] as const;

  for (const auditEvent of auditEvents) {
    await prisma.auditEvent.upsert({
      where: { id: auditEvent.id },
      update: {
        ...auditEvent,
        metadata: auditEvent.metadata as Prisma.InputJsonValue,
      },
      create: {
        ...auditEvent,
        organizationId,
        metadata: auditEvent.metadata as Prisma.InputJsonValue,
      },
    });
  }
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });