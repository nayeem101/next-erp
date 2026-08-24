import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createDataTableColumnHelper,
  DataTable,
  type DataTableSort,
} from "./data-table";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}));

interface Person {
  email: string;
  name: string;
}

const helper = createDataTableColumnHelper<Person>();

const columns = helper.columns([
  helper.accessor("name", { header: "Name" }),
  helper.accessor("email", { header: "Email" }),
]);

const rows: Person[] = [
  { name: "Ada Lovelace", email: "ada@example.com" },
  { name: "Grace Hopper", email: "grace@example.com" },
];

beforeEach(() => {
  mocks.push.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DataTable", () => {
  test("renders accessible column headers and row content", () => {
    render(
      <DataTable ariaLabel="People directory" columns={columns} rows={rows} />,
    );

    const table = screen.getByRole("table", { name: "People directory" });

    expect(table).toBeInTheDocument();

    for (const header of ["Name", "Email"]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toHaveAttribute("scope", "col");
    }

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("grace@example.com")).toBeInTheDocument();
  });

  test("header click emits a server sort descriptor and aria-sort reflects state", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();

    const view = render(
      <DataTable
        ariaLabel="People directory"
        columns={columns}
        rows={rows}
        onSortChange={onSortChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /name/i }));

    expect(onSortChange).toHaveBeenCalledWith({
      desc: false,
      id: "name",
    });

    // Rerender with the applied sort to verify the controlled contract.
    view.rerender(
      <DataTable
        ariaLabel="People directory"
        columns={columns}
        rows={rows}
        sort={{ desc: false, id: "name" } satisfies DataTableSort}
        onSortChange={onSortChange}
      />,
    );

    expect(screen.getByRole("columnheader", { name: /name/i })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  test("shows empty state instead of a table when no rows", () => {
    render(
      <DataTable
        ariaLabel="People directory"
        columns={columns}
        rows={[]}
        emptyState={<p>No people match your filters.</p>}
      />,
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByText("No people match your filters."),
    ).toBeInTheDocument();
  });
});

describe("DataTablePagination", () => {
  test("renders result count and disables prev on the first page", () => {
    render(
      <DataTablePagination
        basePath="/admin/users"
        values={{ page: 1, pageSize: 20 }}
        total={45}
      />,
    );

    expect(screen.getByText(/showing 1–20 of 45/i)).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /go to page 0/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /go to page 2/i })).toBeEnabled();
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
  });

  test("navigates to canonical hrefs on page changes", async () => {
    const user = userEvent.setup();

    render(
      <DataTablePagination
        basePath="/admin/users"
        values={{ page: 2, pageSize: 20 }}
        defaults={{ page: 1, pageSize: 20 }}
        total={45}
      />,
    );

    await user.click(screen.getByRole("button", { name: /go to page 3/i }));

    expect(mocks.push).toHaveBeenCalledWith("/admin/users?page=3");

    await user.click(screen.getByRole("button", { name: /go to page 1/i }));

    // Page 1 is the default, so it disappears from the href entirely.
    expect(mocks.push).toHaveBeenCalledWith("/admin/users");
  });
});

describe("DataTableToolbar", () => {
  test("exposes a labelled search field and a columns menu trigger", () => {
    render(
      <DataTableToolbar
        basePath="/admin/users"
        values={{}}
        searchPlaceholder="Search users"
        columns={{ name: "Name", email: "Email" }}
      />,
    );

    expect(screen.getByLabelText("Search users")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
    expect(
      screen.queryByRole("button", { name: /reset/i }),
    ).not.toBeInTheDocument();
  });

  test("debounces search input into a canonical href navigation", async () => {
    vi.useFakeTimers();

    render(
      <DataTableToolbar
        basePath="/admin/users"
        values={{}}
        searchPlaceholder="Search users"
        searchDebounceMs={300}
        columns={{}}
      />,
    );

    // fireEvent keeps timer control fully with the test: userEvent's own
    // async waits interact badly with fake timers.
    fireEvent.change(screen.getByLabelText("Search users"), {
      target: { value: "ada" },
    });

    // The effect reschedules on every keystroke; only the final timer
    // survives and fires a single navigation.
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/admin/users?search=ada");
  });

  test("reset appears for active filters and clears them except pageSize", async () => {
    const user = userEvent.setup();

    render(
      <DataTableToolbar
        basePath="/admin/users"
        values={{ page: "3", pageSize: "50", search: "ada" }}
        columns={{}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /reset/i }));

    expect(mocks.push).toHaveBeenCalledWith("/admin/users?pageSize=50");
  });
});
