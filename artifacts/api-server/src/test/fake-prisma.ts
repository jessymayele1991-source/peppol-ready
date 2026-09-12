import { hashPassword } from "@workspace/password";

/**
 * In-memory stand-in for the Prisma client, for HTTP tests that run the real
 * Express app.
 *
 * Operations are lazy, like Prisma's own: nothing runs until the operation is
 * awaited or handed to $transaction. That is what lets a test prove atomicity —
 * when a transaction is made to fail, none of its operations ran.
 */

type Row = Record<string, unknown>;

export type AuditRow = {
  organizationId: string;
  actorId: string | null;
  eventType: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
};

type LazyOperation<T> = PromiseLike<T> & {
  run: () => T;
  catch: (onRejected: (reason: unknown) => unknown) => Promise<unknown>;
};

function lazy<T>(run: () => T): LazyOperation<T> {
  const execute = () => Promise.resolve().then(run);
  return {
    run,
    then: (onFulfilled, onRejected) => execute().then(onFulfilled, onRejected),
    catch: (onRejected) => execute().catch(onRejected),
  };
}

export type FakeUser = {
  id: string;
  name: string;
  email: string;
  password: string;
  memberships: Array<{ organizationId: string; organizationName: string; role: string }>;
};

export function createFakePrisma() {
  const state = {
    users: new Map<string, Row>(),
    sessions: new Map<string, { data: unknown; expiresAt: Date }>(),
    audit: [] as AuditRow[],
    companies: new Map<string, Row>(),
    readinessScores: [] as Row[],
    transactions: 0,
    failNextTransaction: false,
  };

  const userByEmail = (email: string) =>
    [...state.users.values()].find((user) => user["email"] === email) ?? null;

  const membershipOf = (userId: string, organizationId: string) => {
    const user = state.users.get(userId);
    const memberships = (user?.["memberships"] as Array<Row> | undefined) ?? [];
    return memberships.find((m) => m["organizationId"] === organizationId) ?? null;
  };

  const prisma = {
    user: {
      findUnique: ({ where }: { where: { email?: string; id?: string } }) =>
        lazy(() => (where.email !== undefined ? userByEmail(where.email) : (state.users.get(where.id ?? "") ?? null))),
    },
    membership: {
      findUnique: ({ where }: { where: { organizationId_userId: { organizationId: string; userId: string } } }) =>
        lazy(() => {
          const { organizationId, userId } = where.organizationId_userId;
          const membership = membershipOf(userId, organizationId);
          return membership ? { id: `m_${userId}_${organizationId}`, role: membership["role"] } : null;
        }),
    },
    userSession: {
      findUnique: ({ where }: { where: { sid: string } }) =>
        lazy(() => {
          const record = state.sessions.get(where.sid);
          return record ? { sid: where.sid, ...record } : null;
        }),
      upsert: ({ where, create }: { where: { sid: string }; create: { data: unknown; expiresAt: Date } }) =>
        lazy(() => {
          // Serialize the way a JSON column would.
          state.sessions.set(where.sid, { data: JSON.parse(JSON.stringify(create.data)), expiresAt: create.expiresAt });
          return {};
        }),
      deleteMany: ({ where }: { where: { sid: string } }) =>
        lazy(() => ({ count: state.sessions.delete(where.sid) ? 1 : 0 })),
      updateMany: () => lazy(() => ({ count: 0 })),
    },
    auditEvent: {
      create: ({ data }: { data: AuditRow }) =>
        lazy(() => {
          state.audit.push(structuredClone(data));
          return data;
        }),
    },
    company: {
      findFirst: ({ where }: { where: { id: string; organizationId: string } }) =>
        lazy(() => {
          const company = state.companies.get(where.id);
          return company && company["organizationId"] === where.organizationId
            ? { id: company["id"], organizationId: company["organizationId"] }
            : null;
        }),
      update: ({ where, data }: { where: { id: string }; data: Row }) =>
        lazy(() => {
          const company = state.companies.get(where.id);
          if (company) Object.assign(company, data);
          return company;
        }),
    },
    readinessScore: {
      create: ({ data }: { data: Row }) =>
        lazy(() => {
          state.readinessScores.push(structuredClone(data));
          return data;
        }),
      findMany: () => lazy(() => []),
    },
    organization: {
      findUnique: ({ where }: { where: { id: string } }) =>
        lazy(() => ({
          id: where.id,
          name: `Organization ${where.id}`,
          companies: [...state.companies.values()]
            .filter((company) => company["organizationId"] === where.id)
            .map((company) => ({ ...company, readinessScores: [], incidents: [] })),
        })),
    },
    incident: { findMany: () => lazy(() => []) },
    $transaction: async (operations: Array<LazyOperation<unknown>>) => {
      state.transactions += 1;
      if (state.failNextTransaction) {
        state.failNextTransaction = false;
        throw new Error("simulated transaction failure");
      }
      return operations.map((operation) => operation.run());
    },
  };

  async function addUser(user: FakeUser) {
    state.users.set(user.id, {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarInitials: null,
      preferredLocale: "nl",
      passwordHash: await hashPassword(user.password),
      memberships: user.memberships.map((membership) => ({
        organizationId: membership.organizationId,
        role: membership.role,
        organization: { id: membership.organizationId, name: membership.organizationName, plan: "PROFESSIONAL" },
      })),
    });
  }

  function reset() {
    state.sessions.clear();
    state.audit.length = 0;
    state.readinessScores.length = 0;
    state.transactions = 0;
    state.failNextTransaction = false;
  }

  return { prisma, state, addUser, reset };
}
