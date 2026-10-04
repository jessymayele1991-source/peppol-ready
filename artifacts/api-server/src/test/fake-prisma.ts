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
    readinessChecks: [] as Row[],
    companies: new Map<string, Row>(),
    organizations: new Map<string, Row>(),
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

  let nextId = 0;
  const newId = (prefix: string) => `${prefix}_fake_${(nextId += 1)}`;

  /** Mirrors the unique index on users.email, as Prisma reports it. */
  const uniqueEmailViolation = () =>
    Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), {
      code: "P2002",
      meta: { target: ["email"] },
    });

  /** What the service selects alongside an assessment: its control points and who completed it. */
  const withChecks = (score: Row) => ({
    ...score,
    completedBy:
      typeof score["completedById"] === "string"
        ? { name: (state.users.get(score["completedById"] as string)?.["name"] as string) ?? "Unknown" }
        : null,
    checks: state.readinessChecks
      .filter((check) => check["scoreId"] === score["id"])
      .map((check) => ({
        key: check["key"],
        passed: check["passed"],
        evidence: check["evidence"] ?? null,
      })),
  });

  const prisma = {
    user: {
      findUnique: ({ where }: { where: { email?: string; id?: string } }) =>
        lazy(() => (where.email !== undefined ? userByEmail(where.email) : (state.users.get(where.id ?? "") ?? null))),
      create: ({ data }: { data: { name: string; email: string; passwordHash: string } }) =>
        lazy(() => {
          if (userByEmail(data.email)) throw uniqueEmailViolation();
          const id = newId("user");
          state.users.set(id, { id, ...data, avatarInitials: null, preferredLocale: "nl", memberships: [] });
          return { id };
        }),
    },
    organization: {
      findUnique: ({ where }: { where: { id: string } }) =>
        lazy(() => ({
          id: where.id,
          name: (state.organizations.get(where.id)?.["name"] as string | undefined) ?? `Organization ${where.id}`,
          companies: [...state.companies.values()]
            .filter((company) => company["organizationId"] === where.id)
            .map((company) => ({
              // The dashboard reads the stored score and status, so the fake
              // supplies the same column defaults the database would.
              readinessScore: 0,
              peppolStatus: "NOT_REGISTERED",
              ...company,
              readinessScores: [],
              incidents: [],
            })),
        })),
      create: ({ data }: { data: { name: string; slug: string } }) =>
        lazy(() => {
          const id = newId("org");
          state.organizations.set(id, { id, ...data, plan: "PROFESSIONAL" });
          return { id };
        }),
    },
    membership: {
      create: ({ data }: { data: { organizationId: string; userId: string; role: string } }) =>
        lazy(() => {
          const organization = state.organizations.get(data.organizationId);
          const user = state.users.get(data.userId);
          (user?.["memberships"] as Row[]).push({
            organizationId: data.organizationId,
            role: data.role,
            organization: { id: organization?.["id"], name: organization?.["name"], plan: organization?.["plan"] },
          });
          return data;
        }),
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
      updateMany: ({ where, data }: { where: { id: string; organizationId: string; archivedAt?: null }; data: Row }) =>
        lazy(() => {
          const company = state.companies.get(where.id);
          const matches =
            company !== undefined &&
            company["organizationId"] === where.organizationId &&
            (where.archivedAt === undefined || (company["archivedAt"] ?? null) === null);
          if (matches) Object.assign(company, data);
          return { count: matches ? 1 : 0 };
        }),
    },
    readinessScore: {
      create: ({ data }: { data: Row }) =>
        lazy(() => {
          // The service selects the new id to attach control points to it, so
          // the fake hands out one the way the database would.
          const stored = { id: newId("score"), ...structuredClone(data) };
          state.readinessScores.push(stored);
          return stored;
        }),
      findFirst: ({ where }: { where: { id?: string; companyId: string } }) =>
        lazy(() => {
          // Newest first, as the service orders them; the fake keeps insertion
          // order, so the last match is the newest.
          const score = [...state.readinessScores]
            .reverse()
            .find(
              (stored) =>
                stored["companyId"] === where.companyId &&
                (where.id === undefined || stored["id"] === where.id),
            );
          return score ? withChecks(score) : null;
        }),
      count: ({ where }: { where?: { companyId?: string } } = {}) =>
        lazy(
          () =>
            state.readinessScores.filter(
              (score) => where?.companyId === undefined || score["companyId"] === where.companyId,
            ).length,
        ),
      findMany: ({ where, skip = 0, take }: { where?: { companyId?: string }; skip?: number; take?: number } = {}) =>
        lazy(() => {
          const matching = [...state.readinessScores]
            .filter((score) => where?.companyId === undefined || score["companyId"] === where.companyId)
            .reverse();
          const page = take === undefined ? matching.slice(skip) : matching.slice(skip, skip + take);
          return page.map(withChecks);
        }),
    },
    readinessCheck: {
      createMany: ({ data }: { data: Row[] }) =>
        lazy(() => {
          for (const check of data) state.readinessChecks.push(structuredClone(check));
          return { count: data.length };
        }),
      findMany: ({ where }: { where?: { scoreId?: string } } = {}) =>
        lazy(() =>
          state.readinessChecks.filter(
            (check) => where?.scoreId === undefined || check["scoreId"] === where.scoreId,
          ),
        ),
    },
    incident: { findMany: () => lazy(() => []) },
    /**
     * Array form, as the session store uses, and callback form, as registration
     * uses. The callback form has no rollback here; atomicity of registration is
     * proven against PostgreSQL in the database tests.
     */
    $transaction: async (
      operations: Array<LazyOperation<unknown>> | ((tx: unknown) => Promise<unknown>),
    ): Promise<unknown> => {
      state.transactions += 1;
      if (state.failNextTransaction) {
        state.failNextTransaction = false;
        throw new Error("simulated transaction failure");
      }
      if (typeof operations === "function") return operations(prisma);
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
    state.readinessChecks.length = 0;
    state.transactions = 0;
    state.failNextTransaction = false;
  }

  return { prisma, state, addUser, reset };
}
