import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ProductStatusActions } from "@/features/products/components/product-status-actions";
import type { ProductListRow } from "@/features/products/schemas";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  setProductActiveAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/features/products/actions", () => ({
  setProductActiveAction: mocks.setProductActiveAction,
}));

function product(overrides: Partial<ProductListRow>): ProductListRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    categoryId: "00000000-0000-4000-8000-00000000e001",
    categoryName: "Power Tools",
    sku: overrides.sku ?? "SKU-1000",
    name: overrides.name ?? "Cordless Drill",
    description: null,
    unitPriceCents: 8999,
    stockOnHand: 40,
    reorderLevel: 10,
    isActive: overrides.isActive ?? true,
    createdAt: "2026-08-01T10:00:00.000Z",
  };
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.setProductActiveAction.mockReset();
});

describe("ProductStatusActions", () => {
  test("renders nothing for roles without manage rights", () => {
    const { container } = render(
      <ProductStatusActions product={product({})} currentRoles={["sales"]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("edit links to the product edit route", () => {
    render(
      <ProductStatusActions
        product={product({})}
        currentRoles={["inventory"]}
      />,
    );

    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/inventory/products/00000000-0000-4000-8000-000000000001/edit",
    );
  });

  test("archive confirms then calls the action and refreshes", async () => {
    const user = userEvent.setup();

    mocks.setProductActiveAction.mockResolvedValue({
      ok: true,
      data: { productId: product({}).id, isActive: false },
    });

    render(
      <ProductStatusActions product={product({})} currentRoles={["admin"]} />,
    );

    await user.click(screen.getByRole("button", { name: /^archive$/i }));

    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Archive product" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /^archive$/i }),
    );

    await waitFor(() => {
      expect(mocks.setProductActiveAction).toHaveBeenCalledWith({
        productId: product({}).id,
        isActive: false,
      });
    });
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  test("restore conflicts surface inline without closing the dialog", async () => {
    const user = userEvent.setup();

    mocks.setProductActiveAction.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "Restore the product's category before restoring the product.",
      },
    });

    render(
      <ProductStatusActions
        product={product({ isActive: false })}
        currentRoles={["admin"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^restore$/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^restore$/i,
      }),
    );

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/restore the product's category/i);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
