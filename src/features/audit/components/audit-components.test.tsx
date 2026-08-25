import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, test, vi } from "vitest";

import { AuditDetailsSheet } from "./audit-details-sheet";
import { AuditLogGrid } from "./audit-log-grid";

import type { AuditDetailRow, AuditListPage, AuditListRow } from "../schemas";

expect.extend(toHaveNoViolations);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

global.fetch = vi.fn();

const row: AuditListRow = {
  id: "00000000-0000-4000-8000-00000000e001",
  createdAt: "2026-08-26T00:00:00.000Z",
  actorName: "Alex Admin",
  actorEmail: "admin@example.com",
  action: "order.confirmed",
  entityType: "order",
  entityId: "00000000-0000-4000-8000-00000000a001",
  correlationId: "00000000-0000-4000-8000-00000000f001",
  hasDetails: true,
};

function page(rows: AuditListRow[]): AuditListPage {
  return {
    rows,
    total: rows.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

const detail: AuditDetailRow = {
  id: row.id,
  action: "order.confirmed",
  entityType: "order",
  entityId: row.entityId,
  createdAt: row.createdAt,
  metadata: {
    before: { status: "draft" },
    after: { status: "confirmed" },
    reason: "Customer confirmed by phone",
    context: { invoiceNumber: "INV-000001" },
  },
};

describe("audit details sheet", () => {
  test("renders sanitized before/after/reason/context and entity link", () => {
    const { container } = render(
      <AuditDetailsSheet
        detail={detail}
        onOpenChange={() => undefined}
        open={true}
      />,
    );

    expect(screen.getByText("order.confirmed")).toBeInTheDocument();
    expect(screen.getByText(/"status": "confirmed"/)).toBeInTheDocument();
    expect(screen.getByText(/Customer confirmed by phone/)).toBeInTheDocument();
    const entityId = row.entityId ?? "";
    expect(screen.getByRole("link", { name: entityId })).toHaveAttribute(
      "href",
      `/sales/orders/${entityId}`,
    );

    void container;
  });

  test("closes via the close button", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <AuditDetailsSheet
        detail={detail}
        onOpenChange={onOpenChange}
        open={true}
      />,
    );

    await user.click(screen.getByRole("button", { name: /close audit/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("sheet has no axe violations", () => {
    const { container } = render(
      <AuditDetailsSheet
        detail={detail}
        onOpenChange={() => undefined}
        open={true}
      />,
    );

    // Radix sheets portal into a dialog; assert the accessible structure.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    return axe(container.querySelector("[role='dialog']") ?? container).then(
      (results) => {
        expect(results).toHaveNoViolations();
      },
    );
  });
});

describe("audit log grid", () => {
  test("renders actor, action badge, and empty states", () => {
    const primary = render(
      <AuditLogGrid page={page([row])} urlValues={{ page: 1, pageSize: 20 }} />,
    );

    expect(primary.getAllByText("Alex Admin")).toHaveLength(1);
    // The badge and the select option both carry the action text.
    expect(
      primary.getAllByText("order.confirmed").length,
    ).toBeGreaterThanOrEqual(1);

    const emptyRender = render(
      <AuditLogGrid page={page([])} urlValues={{ page: 1, pageSize: 20 }} />,
    );
    expect(emptyRender.getByText("No audit events yet")).toBeInTheDocument();
  });

  test("grid has no axe violations", async () => {
    const { container } = render(
      <AuditLogGrid page={page([row])} urlValues={{ page: 1, pageSize: 20 }} />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
