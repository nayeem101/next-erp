"use client";

import {
  createCoreRowModel,
  createTableHook,
  coreFeatures,
  flexRender,
  tableFeatures,
} from "@tanstack/react-table";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ConfirmUserActiveDialog } from "./confirm-user-active-dialog";
import { RoleAssignmentDialog } from "./role-assignment-dialog";

import type { UserListPage, UserListRow } from "../schemas";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  inventory: "Inventory",
  sales: "Sales",
};

type DialogState =
  | { kind: "none" }
  | { kind: "roles"; user: UserListRow }
  | { kind: "enable"; user: UserListRow }
  | { kind: "disable"; user: UserListRow };

/**
 * TanStack Table v9 module-level hook factory: core features plus the core
 * row model are registered once and shared by every instance of this grid.
 */
const usersTableHook = createTableHook({
  features: tableFeatures({
    ...coreFeatures,
    coreRowModel: createCoreRowModel(),
  }),
});

const createColumnHelper = usersTableHook.createAppColumnHelper;

const columnHelper = createColumnHelper<UserListRow>();

function formatSignedInAt(value: string | null): string {
  if (value === null) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

/**
 * Admin directory grid. Server-fed (one page at a time); the TanStack
 * instance handles row modeling and accessible markup while mutations run
 * through the role/status dialogs.
 */
export function UsersTable({
  page,
  currentUserId,
}: {
  page: UserListPage;
  currentUserId: string;
}) {
  const [dialog, setDialog] = React.useState<DialogState>({ kind: "none" });

  const columns = React.useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("displayName", {
          header: "Name",
          cell: (cell) => (
            <span className="font-medium">
              {cell.getValue()}
              {cell.row.original.id === currentUserId ? (
                <span className="ml-1.5 text-muted-foreground">(you)</span>
              ) : null}
            </span>
          ),
        }),
        columnHelper.accessor("email", { header: "Email" }),
        columnHelper.accessor("roles", {
          header: "Roles",
          cell: (cell) => {
            const roles = cell.getValue();

            if (roles.length === 0) {
              return (
                <span className="text-xs text-muted-foreground">
                  No access yet
                </span>
              );
            }

            return (
              <div className="flex flex-wrap gap-1">
                {roles.map((role) => (
                  <Badge key={role} variant="secondary">
                    {ROLE_LABELS[role] ?? role}
                  </Badge>
                ))}
              </div>
            );
          },
        }),
        columnHelper.accessor("isActive", {
          header: "Status",
          cell: (cell) =>
            cell.getValue() ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="destructive">Disabled</Badge>
            ),
        }),
        columnHelper.accessor("lastSignedInAt", {
          header: "Last sign-in",
          cell: (cell) => (
            <span className="text-sm tabular-nums">
              {formatSignedInAt(cell.getValue())}
            </span>
          ),
        }),
        columnHelper.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          cell: (cell) => {
            const user = cell.row.original;

            return (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDialog({ kind: "roles", user });
                  }}
                >
                  Manage roles
                </Button>
                <Button
                  variant={user.isActive ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => {
                    setDialog({
                      kind: user.isActive ? "disable" : "enable",
                      user,
                    });
                  }}
                >
                  {user.isActive ? "Disable" : "Enable"}
                </Button>
              </div>
            );
          },
        }),
      ]),
    [currentUserId],
  );

  const table = usersTableHook.useAppTable({
    columns,
    data: page.rows,
  });

  if (page.rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">No users found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Identities are provisioned in Supabase Auth; they appear here after
          their first sign-in attempt.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {dialog.kind === "roles" && (
        <RoleAssignmentDialog
          user={dialog.user}
          open
          onOpenChange={(next) => {
            if (!next) {
              setDialog({ kind: "none" });
            }
          }}
        />
      )}

      {(dialog.kind === "disable" || dialog.kind === "enable") && (
        <ConfirmUserActiveDialog
          user={dialog.user}
          isActive={dialog.kind === "enable"}
          open
          onOpenChange={(next) => {
            if (!next) {
              setDialog({ kind: "none" });
            }
          }}
        />
      )}
    </>
  );
}
