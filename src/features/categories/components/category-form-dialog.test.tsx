import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { CategoryFormDialog } from "@/features/categories/components/category-form-dialog";
import type { CategoryListRow } from "@/features/categories/schemas";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  createCategoryAction: vi.fn(),
  updateCategoryAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/features/categories/actions", () => ({
  createCategoryAction: mocks.createCategoryAction,
  updateCategoryAction: mocks.updateCategoryAction,
}));

const existing: CategoryListRow = {
  id: "00000000-0000-4000-8000-000000000009",
  name: "Fasteners",
  slug: "fasteners",
  description: "Screws and bolts.",
  isActive: true,
  activeProductCount: 4,
  createdAt: "2026-08-01T10:00:00.000Z",
};

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.createCategoryAction.mockReset();
  mocks.updateCategoryAction.mockReset();
});

describe("CategoryFormDialog (create)", () => {
  test("blocks submission with inline field errors when name is blank", async () => {
    const user = userEvent.setup();

    render(<CategoryFormDialog mode="create" open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /create category/i }));

    expect(mocks.createCategoryAction).not.toHaveBeenCalled();
    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
  });

  test("submits trimmed values and closes on success", async () => {
    const user = userEvent.setup();

    mocks.createCategoryAction.mockResolvedValue({
      ok: true,
      data: { categoryId: "x", slug: "power-tools" },
    });

    const onOpenChange = vi.fn();

    render(
      <CategoryFormDialog mode="create" open onOpenChange={onOpenChange} />,
    );

    await user.type(screen.getByLabelText("Name"), "Power Tools");
    await user.type(
      screen.getByLabelText(/description/i),
      "Everything with a plug.",
    );
    await user.click(screen.getByRole("button", { name: /create category/i }));

    await waitFor(() => {
      expect(mocks.createCategoryAction).toHaveBeenCalledWith({
        name: "Power Tools",
        description: "Everything with a plug.",
      });
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  test("renders UNIQUE_CONFLICT inline without losing the draft", async () => {
    const user = userEvent.setup();

    mocks.createCategoryAction.mockResolvedValue({
      ok: false,
      error: {
        code: "UNIQUE_CONFLICT",
        message:
          "A category with this name already exists. Choose a different name.",
      },
    });

    render(<CategoryFormDialog mode="create" open onOpenChange={vi.fn()} />);

    const nameInput = screen.getByLabelText("Name");

    await user.type(nameInput, "Garden");
    await user.click(screen.getByRole("button", { name: /create category/i }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/already exists/i);
    expect(nameInput).toHaveValue("Garden");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("CategoryFormDialog (edit)", () => {
  test("prefills fields and submits with the category id", async () => {
    const user = userEvent.setup();

    mocks.updateCategoryAction.mockResolvedValue({
      ok: true,
      data: { categoryId: existing.id },
    });

    render(
      <CategoryFormDialog
        mode="edit"
        category={existing}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Name")).toHaveValue("Fasteners");

    const description = screen.getByLabelText(/description/i);

    await user.clear(description);
    await user.type(description, "Updated copy.");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(mocks.updateCategoryAction).toHaveBeenCalledWith({
        categoryId: existing.id,
        name: "Fasteners",
        description: "Updated copy.",
      });
    });
  });

  test("keeps the heading anchored to the edited entity", () => {
    render(
      <CategoryFormDialog
        mode="edit"
        category={existing}
        open
        onOpenChange={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Edit category" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/update details for fasteners/i),
    ).toBeInTheDocument();
  });
});
