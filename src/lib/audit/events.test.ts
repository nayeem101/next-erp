import { describe, expect, test } from "vitest";

import {
  AUDIT_ACTION_VALUES,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  redactAuditMetadata,
} from "./events";

describe("audit event vocabulary", () => {
  test("matches the documented API_SPEC action list exactly", () => {
    expect([...AUDIT_ACTION_VALUES].sort()).toEqual(
      [
        "auth.signed_in",
        "user.roles_changed",
        "user.enabled",
        "user.disabled",
        "category.created",
        "category.updated",
        "category.archived",
        "category.restored",
        "product.created",
        "product.updated",
        "product.archived",
        "product.restored",
        "product.stock_adjusted",
        "customer.created",
        "customer.updated",
        "customer.archived",
        "customer.restored",
        "order.draft_created",
        "order.draft_updated",
        "order.confirmed",
        "order.fulfilled",
        "order.cancelled",
        "invoice.issued",
        "invoice.voided",
        "ledger.sale_posted",
        "ledger.sale_reversed",
      ].sort(),
    );
  });

  test("every action is namespaced `entity.verb`", () => {
    for (const action of AUDIT_ACTION_VALUES) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  test("entity types match the documented vocabulary", () => {
    expect([...AUDIT_ENTITY_TYPES].sort()).toEqual(
      [
        "auth_session",
        "category",
        "customer",
        "invoice",
        "ledger_journal",
        "order",
        "product",
        "user",
      ].sort(),
    );
  });

  test("constants are stable references used by writers", () => {
    expect(AUDIT_ACTIONS.orderConfirmed).toBe("order.confirmed");
    expect(AUDIT_ACTIONS.ledgerSalePosted).toBe("ledger.sale_posted");
  });
});

describe("metadata redaction", () => {
  test("strips credential-shaped keys at any depth", () => {
    const input = {
      orderNumber: "SO-000100",
      context: {
        authorization: "Bearer abc",
        password: "hunter2",
        nested: { apiToken: "xyz", totalCents: 1000 },
      },
    };

    const output = redactAuditMetadata(input);

    expect(output.orderNumber).toBe("SO-000100");
    const context = output.context as Record<string, unknown>;
    expect(context.authorization).toBe("[redacted]");
    expect(context.password).toBe("[redacted]");
    const nested = context.nested as Record<string, unknown>;
    expect(nested.apiToken).toBe("[redacted]");
    expect(nested.totalCents).toBe(1000);
  });

  test("caps oversized strings and deep structures", () => {
    const long = "x".repeat(2000);
    const output = redactAuditMetadata({ long });

    expect((output.long as string).length).toBeLessThan(600);
    expect(output.long as string).toContain("[truncated]");
  });

  test("is idempotent", () => {
    const once = redactAuditMetadata({ password: "a", note: "ok" });
    const twice = redactAuditMetadata(once);

    expect(twice).toEqual(once);
  });
});
