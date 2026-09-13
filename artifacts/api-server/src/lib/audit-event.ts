import type { Prisma } from "@prisma/client";

export type AuditEventInput = Prisma.AuditEventUncheckedCreateInput;

/**
 * The one shape every audit row is built through, so events stay comparable
 * across features: who acted, in which organization, on which entity.
 *
 * Metadata must never carry personal data or secrets — identifiers and field
 * names, not values. Callers write the returned row in the same transaction as
 * the change it records.
 */
export function auditEvent(input: {
  eventType: string;
  organizationId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonObject;
}): AuditEventInput {
  return {
    organizationId: input.organizationId,
    actorId: input.actorId,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
  };
}
