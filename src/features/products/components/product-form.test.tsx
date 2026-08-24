import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ProductForm } from "@/features/products/components/product-form";
import type { ProductListRow } from "@/features/products/schemas";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  createProductAction: vi.fn(),
  updateProductAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/features/products/actions", () => ({
  createProductAction: mocks.createProductAction,
  updateProductAction: mocks.updateProductAction,
}));

const categoryOptions = [
  { id: "11111111-1111-4111-8111-111111111111", label: "Power Tools" },
  { id: "22222222-2222-4222-8222-222222222222", label: "Garden" },
];

function editProduct(): ProductListRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    categoryId: categoryOptions[1]?.id ?? "",
    categoryName: "Garden",
    sku: "SKU-2000",
    name: "Garden Hose",
    description: null,
    unitPriceCents: 4500,
    stockOnHand: 33,
    reorderLevel: 5,
    isActive: true,
    createdAt: "2026-08-01T10:00:00.000Z",
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
});

describe("ProductForm prerequisite state", () => {
  test("create mode without categories shows the prerequisite notice, not the form", () => {
    render(<ProductForm mode="create" categoryOptions={[]} />);

    expect(screen.getByText(/no active categories yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /go to categories/i }),
    ).toHaveAttribute("href", "/inventory/categories");
    expect(screen.queryByLabelText(/sku/i)).not.toBeInTheDocument();
  });
});

describe("ProductForm create mode", () => {
  test("submits normalized values including opening stock", async () => {
    const user = userEvent.setup();

    mocks.createProductAction.mockResolvedValue({
      ok: true,
      data: { productId: "00000000-0000-4000-8000-000000009999" },
    });

    render(<ProductForm mode="create" categoryOptions={categoryOptions} />);

    const categoryInput = screen.getByRole("combobox", { name: "Category" });

    await user.click(categoryInput);
    await user.type(categoryInput, "Garden");
    await user.click(await screen.findByRole("option", { name: "Garden" }));
    await user.type(screen.getByLabelText("SKU"), "hd-200");
    await user.type(screen.getByLabelText("Name"), "Heavy Duty Drill");
    await user.type(screen.getByLabelText("Unit price"), "129.99");
    await user.type(screen.getByLabelText("Reorder level"), "4");
    await user.type(screen.getByLabelText(/opening stock/i), "15");

    await user.click(screen.getByRole("button", { name: /create product/i }));

    await waitFor(() => {
      expect(mocks.createProductAction).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: categoryOptions[1]?.id,
          sku: "HD-200",
          name: "Heavy Duty Drill",
          unitPrice: "129.99",
          reorderLevel: 4,
          openingStock: 15,
        }),
      );
    });
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/inventory/products");
    });
  });

  test("blocks submission and reports client validation errors inline", async () => {
    const user = userEvent.setup();

    render(<ProductForm mode="create" categoryOptions={categoryOptions} />);

    await user.type(screen.getByLabelText("Unit price"), "-3");

    await user.click(screen.getByRole("button", { name: /create product/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mocks.createProductAction).not.toHaveBeenCalled();
  });

  test("maps unique-SKU conflicts onto the SKU field without losing the draft", async () => {
    const user = userEvent.setup();

    mocks.createProductAction.mockResolvedValue({
      ok: false,
      error: {
        code: "UNIQUE_CONFLICT",
        message:
          "A product with this SKU already exists. SKUs are case-insensitive.",
      },
    });

    render(<ProductForm mode="create" categoryOptions={categoryOptions} />);

    const categoryInput = screen.getByRole("combobox", { name: "Category" });

    await user.click(categoryInput);
    await user.type(categoryInput, "Tools");
    await user.click(
      await screen.findByRole("option", { name: /power tools/i }),
    );
    await user.type(screen.getByLabelText("SKU"), "DUP-1");
    await user.type(screen.getByLabelText("Name"), "Duplicate Item");
    await user.type(screen.getByLabelText("Unit price"), "5.00");

    await user.click(screen.getByRole("button", { name: /create product/i }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/already exists/i);
    // Draft survives the failed submit.
    expect(screen.getByLabelText("Name")).toHaveValue("Duplicate Item");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("ProductForm edit mode", () => {
  test("seeds fields from the product and never submits stock fields", async () => {
    const user = userEvent.setup();

    mocks.updateProductAction.mockResolvedValue({
      ok: true,
      data: { productId: editProduct().id },
    });

    render(
      <ProductForm
        mode="edit"
        product={editProduct()}
        categoryOptions={categoryOptions}
      />,
    );

    expect(screen.getByLabelText("SKU")).toHaveValue("SKU-2000");
    expect(screen.getByLabelText("Unit price")).toHaveValue("45.00");
    expect(screen.getByText(/33 units/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/opening stock/i)).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Garden Hose Pro");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(mocks.updateProductAction).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: editProduct().id,
          name: "Garden Hose Pro",
        }),
      );
    });

    const call = mocks.updateProductAction.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(call.openingStock).toBeUndefined();
  });

  test("shows read-only stock copy instead of an input", () => {
    render(
      <ProductForm
        mode="edit"
        product={editProduct()}
        categoryOptions={categoryOptions}
      />,
    );

    expect(screen.getByText(/stock changes only through/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", { name: /stock on hand/i }),
    ).not.toBeInTheDocument();
  });
});
