import { beforeEach, describe, expect, test, vi } from "vitest";

import type { CurrentUserResult, RoleKey } from "@/lib/auth/current-user";
import {
  getActionContext,
  requireAnyRole,
  requireUser,
} from "@/lib/auth/guards";

const mocks = vi.hoisted(() => ({
  currentUserResult: { status: "unauthenticated" },
}));

vi.mock("@/lib/auth/current-user", async (importOriginal) => {
  const actualModule = await importOriginal<{
    getCurrentUser: unknown;
  }>();

  return {
    ...actualModule,
    getCurrentUser: vi.fn((): Promise<CurrentUserResult> =>
      Promise.resolve(mocks.currentUserResult as CurrentUserResult),
    ),
  };
});

function givenCurrentUser(result: CurrentUserResult): void {
  mocks.currentUserResult = result;
}

interface TestUser {
  id: string;
  email: string;
  displayName: string;
  roles: RoleKey[];
}

function authenticatedUser(user: TestUser): CurrentUserResult {
  return { status: "authenticated", user };
}

beforeEach(() => {
  givenCurrentUser({ status: "unauthenticated" });
});

describe("requireUser", () => {
  test.each([
    ["unauthenticated", { status: "unauthenticated" }],
    ["inactive", { status: "inactive" }],
    ["unprovisioned", { status: "unprovisioned", authUserId: "auth-1" }],
  ] as const)("%s callers are rejected", (_label, status) => {
    givenCurrentUser(status);

    const expectedCode =
      status.status === "unauthenticated" ? "UNAUTHENTICATED" : "FORBIDDEN";

    return expect(requireUser()).resolves.toMatchObject({
      ok: false,
      error: { code: expectedCode },
    });
  });

  test("authenticated callers receive their context plus a correlation ID", async () => {
    givenCurrentUser(
      authenticatedUser({
        id: "u-1",
        email: "ada@example.com",
        displayName: "Ada",
        roles: ["admin"],
      }),
    );

    const guard = await requireUser();

    expect(guard.ok).toBe(true);

    if (guard.ok) {
      expect(guard.user.id).toBe("u-1");
      expect(guard.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe("requireAnyRole", () => {
  const admin = {
    id: "u-1",
    email: "a@e.co",
    displayName: "A",
    roles: ["admin"] as RoleKey[],
  };
  const sales = {
    id: "u-2",
    email: "s@e.co",
    displayName: "S",
    roles: ["sales"] as RoleKey[],
  };
  const inventory = {
    id: "u-3",
    email: "i@e.co",
    displayName: "I",
    roles: ["inventory"] as RoleKey[],
  };

  test("allows each required role", () => {
    expect(requireAnyRole(admin, ["admin", "inventory"]).ok).toBe(true);
    expect(requireAnyRole(inventory, ["admin", "inventory"]).ok).toBe(true);
    expect(requireAnyRole(sales, ["admin", "sales"]).ok).toBe(true);
  });

  test("rejects users outside the requirement with FORBIDDEN", () => {
    for (const [user, allowed] of [
      [sales, ["admin"]],
      [inventory, ["admin", "sales"]],
      [admin, []],
    ] as const) {
      const guard = requireAnyRole(user, [...allowed]);

      expect(guard.ok).toBe(false);

      if (!guard.ok) {
        expect(guard.error.code).toBe("FORBIDDEN");
      }
    }
  });
});

describe("getActionContext", () => {
  test("chains verification and role checks", async () => {
    givenCurrentUser({ status: "inactive" });

    const denied = await getActionContext(["admin"]);

    expect(denied.ok).toBe(false);

    givenCurrentUser(
      authenticatedUser({
        id: "u-9",
        email: "x@example.com",
        displayName: "X",
        roles: ["inventory"],
      }),
    );

    const allowed = await getActionContext(["admin", "inventory"]);
    const roleDenied = await getActionContext(["admin"]);

    expect(allowed).toMatchObject({
      ok: true,
      user: { id: "u-9" },
    });
    if (allowed.ok) {
      expect(typeof allowed.correlationId).toBe("string");
    }

    expect(roleDenied).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
