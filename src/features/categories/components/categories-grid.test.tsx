import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { CategoriesGrid } from "@/features/categories/components/categories-grid";
import type {
  CategoryListPage,
  CategoryListRow,
} from "@/features/categories/schemas";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  setCategoryActiveAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/features/categories/actions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setCategoryActiveAction: mocks.setCategoryActiveAction,
}));

function row(overrides: Partial<CategoryListRow>): CategoryListRow {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000001",
    name: overrides.name ?? "Power Tools",
    slug: overrides.slug ?? "power-tools",
    description: overrides.description ?? null,
    isActive: overrides.isActive ?? true,
    activeProductCount: overrides.activeProductCount ?? 3,
    createdAt: overrides.createdAt ?? "2026-08-01T10:00:00.000Z",
  };
}

const urlValues = {
  search: undefined,
  status: "active",
  sort: "name",
  page: 1,
  pageSize: 20,
} as const;

function makePage(rows: CategoryListRow[]): CategoryListPage {
  return {
    rows,
    total: rows.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.setCategoryActiveAction.mockReset();
});

describe("CategoriesGrid rendering", () => {
  test("renders names, slugs, product counts, and status badges", () => {
    render(
      <CategoriesGrid
        page={makePage([
          row({}),
          row({
            id: "00000000-0000-4000-8000-000000000002",
            name: "Legacy Items",
            slug: "legacy-items",
            isActive: false,
            status: undefined,
          } as never),
        ])}
        currentRoles={["admin"]}
        urlValues={{ ...urlValues, status: "all" }}
      />,
    );

    expect(screen.getByText("Power Tools")).toBeInTheDocument();
    expect(screen.getByText("/power-tools")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Categories" });

    expect(
      within(table).getByRole("columnheader", { name: /products/i }),
    ).toHaveAttribute("scope", "col");
  });

  test("shows the unfiltered empty state for a fresh workspace", () => {
    render(
      <CategoriesGrid
        page={makePage([])}
        currentRoles={["admin"]}
        urlValues={{ ...urlValues }}
      />,
    );

    expect(screen.getByText(/create the first category/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("shows the filtered empty state when filters hide everything", () => {
    render(
      <CategoriesGrid
        page={makePage([])}
        currentRoles={["admin"]}
        urlValues={{ ...urlValues, search: "zzz" }}
      />,
    );

    expect(screen.getByText(/adjust or reset them/i)).toBeInTheDocument();
  });
});

describe("role-aware actions", () => {
  test("hides archive controls from roles without manage rights", () => {
    render(
      <CategoriesGrid
        page={makePage([row({})])}
        currentRoles={["sales"]}
        urlValues={{ ...urlValues }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /archive/i }),
    ).not.toBeInTheDocument();
  });

  test("archive flow confirms then calls the action with false", async () => {
    const user = userEvent.setup();

    mocks.setCategoryActiveAction.mockResolvedValue({
      ok: true,
      data: { categoryId: row({}).id, isActive: false },
    });

    const view = render(
      <CategoriesGrid
        page={makePage([row({})])}
        currentRoles={["inventory"]}
        urlValues={{ ...urlValues }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^archive$/i }));

    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Archive category" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /^archive$/i }),
    );

    await waitFor(() => {
      expect(mocks.setCategoryActiveAction).toHaveBeenCalledWith({
        categoryId: row({}).id,
        isActive: false,
      });
    });
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalled();
    });

    view.rerender(
      <CategoriesGrid
        page={makePage([row({})])}
        currentRoles={["inventory"]}
        urlValues={{ ...urlValues }}
      />,
    );
  });

  test("restore variant targets the enable path", async () => {
    const user = userEvent.setup();

    mocks.setCategoryActiveAction.mockResolvedValue({
      ok: true,
      data: { categoryId: row({}).id, isActive: true },
    });

    render(
      <CategoriesGrid
        page={makePage([row({ isActive: false, status: undefined } as never)])}
        currentRoles={["admin"]}
        urlValues={{ ...urlValues, status: "all" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^restore$/i }));

    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Restore category" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /^restore$/i }),
    );

    await waitFor(() => {
      expect(mocks.setCategoryActiveAction).toHaveBeenCalledWith({
        categoryId: row({}).id,
        isActive: true,
      });
    });
  });

  test("surfaces conflicts inline without closing the dialog", async () => {
    const user = userEvent.setup();

    mocks.setCategoryActiveAction.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message:
          "Move or archive this category's active products before archiving it.",
      },
    });

    render(
      <CategoriesGrid
        page={makePage([row({})])}
        currentRoles={["admin"]}
        urlValues={{ ...urlValues }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^archive$/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^archive$/i,
      }),
    );

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/active products/i);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("URL-state wiring", () => {
  test("sort clicks navigate to canonical hrefs", async () => {
    const user = userEvent.setup();

    render(
      <CategoriesGrid
        page={makePage([row({})])}
        currentRoles={["admin"]}
        urlValues={{ ...urlValues, sort: "name" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /name/i }));

    // First click on the active asc column requests descending.
    expect(mocks.push).toHaveBeenCalledWith(
      "/inventory/categories?sort=name_desc",
    );
  });

  test("pagination renders server totals and navigates pages", async () => {
    const user = userEvent.setup();

    render(
      <CategoriesGrid
        page={{
          ...makePage([row({})]),
          total: 45,
          totalPages: 3,
        }}
        currentRoles={["admin"]}
        urlValues={{ ...urlValues, page: 2 }}
      />,
    );

    expect(screen.getByText(/showing 21–40 of 45/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /go to page 3/i }));

    expect(mocks.push).toHaveBeenCalledWith("/inventory/categories?page=3");
  });
});
