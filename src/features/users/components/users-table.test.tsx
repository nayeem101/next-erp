import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { UsersTable } from "@/features/users/components/users-table";
import type { UserListPage, UserListRow } from "@/features/users/schemas";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  setUserRolesAction: vi.fn(),
  setUserActiveAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/features/users/actions", () => ({
  setUserRolesAction: mocks.setUserRolesAction,
  setUserActiveAction: mocks.setUserActiveAction,
}));

const admin: UserListRow = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.com",
  displayName: "Ada Admin",
  isActive: true,
  lastSignedInAt: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  roles: ["admin"],
};

const sales: UserListRow = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "sam@example.com",
  displayName: "Sam Sales",
  isActive: false,
  lastSignedInAt: "2026-08-20T08:30:00.000Z",
  createdAt: "2026-08-02T10:00:00.000Z",
  roles: ["sales"],
};

function makePage(rows: UserListRow[]): UserListPage {
  return {
    rows,
    total: rows.length,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  };
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.setUserRolesAction.mockReset();
  mocks.setUserActiveAction.mockReset();
});

describe("UsersTable rendering", () => {
  test("renders identity, status, and sign-in columns", () => {
    render(
      <UsersTable page={makePage([admin, sales])} currentUserId={admin.id} />,
    );

    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("sam@example.com")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText(/Aug 20, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  test("labels the signed-in operator's own row", () => {
    render(<UsersTable page={makePage([admin])} currentUserId={admin.id} />);

    expect(screen.getByText("(you)")).toBeInTheDocument();
  });

  test("shows an explanatory empty state without rows", () => {
    render(<UsersTable page={makePage([])} currentUserId={admin.id} />);

    expect(
      screen.getByText(/identities are provisioned in supabase/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Manage roles")).not.toBeInTheDocument();
  });
});

describe("RoleAssignmentDialog", () => {
  test("opens from the row action with persisted roles checked and saves changes", async () => {
    const user = userEvent.setup();
    mocks.setUserRolesAction.mockResolvedValue({
      ok: true,
      data: { userId: sales.id, roles: ["sales", "inventory"] },
    });

    render(<UsersTable page={makePage([sales])} currentUserId={admin.id} />);

    const row = screen.getByText("Sam Sales").closest("tr");

    if (!row) {
      throw new Error("row not found");
    }

    await user.click(
      within(row).getByRole("button", { name: /manage roles/i }),
    );

    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Manage roles" }),
    ).toBeInTheDocument();

    // Base UI Checkbox wires its own generated ids/aria-labelledby, so
    // query by accessible name rather than label text.
    const salesBox = within(dialog).getByRole("checkbox", {
      name: "Sales",
    });
    const inventoryBox = within(dialog).getByRole("checkbox", {
      name: "Inventory",
    });

    expect(salesBox).toBeChecked();
    expect(inventoryBox).not.toBeChecked();

    await user.click(inventoryBox);
    await user.click(
      within(dialog).getByRole("button", { name: /save roles/i }),
    );

    await waitFor(() => {
      expect(mocks.setUserRolesAction).toHaveBeenCalledWith({
        userId: sales.id,
        roles: ["sales", "inventory"],
      });
    });

    // Success closes the dialog and refreshes server data.
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  test("surfaces the last-admin rejection inline instead of closing", async () => {
    const user = userEvent.setup();
    mocks.setUserRolesAction.mockResolvedValue({
      ok: false,
      error: {
        code: "LAST_ADMIN",
        message:
          "This change would leave the workspace without an active administrator.",
      },
    });

    render(<UsersTable page={makePage([admin])} currentUserId="other-id" />);

    await user.click(screen.getByRole("button", { name: /manage roles/i }));

    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("checkbox", { name: "Admin" }));
    await user.click(
      within(dialog).getByRole("button", { name: /save roles/i }),
    );

    const alert = await within(document.body).findByRole("alert");

    expect(alert).toHaveTextContent(/without an active administrator/i);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("ConfirmUserActiveDialog", () => {
  test("disabling requires confirmation and calls the action with false", async () => {
    const user = userEvent.setup();
    mocks.setUserActiveAction.mockResolvedValue({
      ok: true,
      data: { userId: sales.id, isActive: true },
    });

    render(<UsersTable page={makePage([sales])} currentUserId={admin.id} />);

    const row = screen.getByText("Sam Sales").closest("tr");

    if (!row) {
      throw new Error("row not found");
    }

    await user.click(within(row).getByRole("button", { name: /^enable$/i }));

    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Enable account" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /^enable account$/i }),
    );

    await waitFor(() => {
      expect(mocks.setUserActiveAction).toHaveBeenCalledWith({
        userId: sales.id,
        isActive: true,
      });
    });
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  test("enabling a disabled user targets the enable action state", async () => {
    const user = userEvent.setup();
    mocks.setUserActiveAction.mockResolvedValue({
      ok: true,
      data: { userId: admin.id, isActive: false },
    });

    render(<UsersTable page={makePage([admin])} currentUserId={admin.id} />);

    await user.click(screen.getByRole("button", { name: /^disable$/i }));

    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Disable account" }),
    ).toBeInTheDocument();
    expect(dialog.textContent).toContain("immediately lose access");

    await user.click(
      within(dialog).getByRole("button", { name: /^disable account$/i }),
    );

    await waitFor(() => {
      expect(mocks.setUserActiveAction).toHaveBeenCalledWith({
        userId: admin.id,
        isActive: false,
      });
    });
  });
});
