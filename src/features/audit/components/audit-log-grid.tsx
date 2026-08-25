"use client";

import * as React from "react";

import {
  createDataTableColumnHelper,
  DataTable,
} from "@/components/shared/data-table/data-table";
import { DataTablePagination } from "@/components/shared/data-table/data-table-pagination";
import { EmptyState } from "@/components/shared/display";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { AUDIT_ACTIONS } from "@/lib/audit/events";

import { AuditDetailsSheet } from "./audit-details-sheet";

import type { AuditDetailRow, AuditListPage, AuditListRow } from "../schemas";

const columnHelper = createDataTableColumnHelper<AuditListRow>();

interface AuditGridValues {
  action?: string | undefined;
  entityType?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  page: number;
  pageSize: number;
}

const DEFAULTS = { page: 1, pageSize: 20 } as const;

function hrefFor(
  values: AuditGridValues,
  patch: Partial<AuditGridValues>,
): string {
  const merged = { ...values, ...patch };
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(merged)) {
    const isDefault =
      key in DEFAULTS &&
      String(value) === String(DEFAULTS[key as keyof typeof DEFAULTS]);

    if (value !== undefined && value !== "" && !isDefault) {
      params.set(key, String(value));
    }
  }

  const query = params.toString();

  return query === "" ? "/admin/audit-log" : `/admin/audit-log?${query}`;
}

const ENTITY_TYPE_OPTIONS = [
  "auth_session",
  "user",
  "category",
  "product",
  "customer",
  "order",
  "invoice",
  "ledger_journal",
] as const;

/** Admin-only append-only trail. Filters bind to URL state. */
export function AuditLogGrid({
  page,
  urlValues,
}: {
  page: AuditListPage;
  urlValues: AuditGridValues;
}) {
  const [actionInput, setActionInput] = React.useState(urlValues.action ?? "");
  const [entityTypeInput, setEntityTypeInput] = React.useState(
    urlValues.entityType ?? "",
  );
  const [dateFromInput, setDateFromInput] = React.useState(
    urlValues.dateFrom ?? "",
  );
  const [dateToInput, setDateToInput] = React.useState(urlValues.dateTo ?? "");

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<AuditDetailRow | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  async function openDetails(rowId: string): Promise<void> {
    setSelectedId(rowId);

    // Read-through fetch of the sanitized detail payload.
    const response = await fetch(`/api/audit-log/${rowId}`);

    if (response.ok) {
      setDetail((await response.json()) as AuditDetailRow);
    } else {
      setDetail(null);
    }

    setSheetOpen(true);
  }

  const columns = React.useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("createdAt", {
          header: "When",
          cell: (cell) => (
            <time dateTime={cell.getValue()}>
              {new Date(cell.getValue()).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </time>
          ),
        }),
        columnHelper.accessor("actorName", {
          header: "Actor",
          cell: (cell) =>
            cell.getValue() ?? (
              <span className="text-muted-foreground">System</span>
            ),
        }),
        columnHelper.accessor("action", {
          header: "Action",
          cell: (cell) => <Badge variant="outline">{cell.getValue()}</Badge>,
        }),
        columnHelper.accessor("entityType", { header: "Entity" }),
        columnHelper.display({
          id: "details",
          header: () => <span className="sr-only">Details</span>,
          cell: (cell) => (
            <button
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              data-selected={
                selectedId === cell.row.original.id ? "true" : undefined
              }
              onClick={() => {
                void openDetails(cell.row.original.id);
              }}
              type="button"
            >
              View
            </button>
          ),
        }),
      ]),

    [selectedId],
  );

  const hasFilters =
    urlValues.action !== undefined ||
    urlValues.entityType !== undefined ||
    urlValues.dateFrom !== undefined ||
    urlValues.dateTo !== undefined ||
    urlValues.page !== DEFAULTS.page;

  return (
    <>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          window.location.href = hrefFor(urlValues, {
            action: actionInput === "" ? undefined : actionInput,
            entityType: entityTypeInput === "" ? undefined : entityTypeInput,
            dateFrom: dateFromInput === "" ? undefined : dateFromInput,
            dateTo: dateToInput === "" ? undefined : dateToInput,
            page: DEFAULTS.page,
          });
        }}
      >
        <label className="sr-only" htmlFor="audit-action">
          Filter by action
        </label>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          id="audit-action"
          onChange={(event) => {
            setActionInput(event.target.value);
          }}
          value={actionInput}
        >
          <option value="">All actions</option>
          {Object.values(AUDIT_ACTIONS).map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="audit-entity-type">
          Filter by entity type
        </label>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          id="audit-entity-type"
          onChange={(event) => {
            setEntityTypeInput(event.target.value);
          }}
          value={entityTypeInput}
        >
          <option value="">All entities</option>
          {ENTITY_TYPE_OPTIONS.map((entityType) => (
            <option key={entityType} value={entityType}>
              {entityType}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="audit-date-from">
          From date
        </label>
        <input
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          id="audit-date-from"
          max={dateToInput === "" ? undefined : dateToInput}
          onChange={(event) => {
            setDateFromInput(event.target.value);
          }}
          type="date"
          value={dateFromInput}
        />
        <span aria-hidden={true} className="text-sm text-muted-foreground">
          –
        </span>
        <label className="sr-only" htmlFor="audit-date-to">
          To date
        </label>
        <input
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          id="audit-date-to"
          min={dateFromInput === "" ? undefined : dateFromInput}
          onChange={(event) => {
            setDateToInput(event.target.value);
          }}
          type="date"
          value={dateToInput}
        />

        <button
          className={buttonVariants({ variant: "outline", size: "sm" })}
          type="submit"
        >
          Apply
        </button>

        {hasFilters ? (
          <a
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            href="/admin/audit-log"
          >
            Clear filters
          </a>
        ) : null}
      </form>

      {page.rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No results" : "No audit events yet"}
          description={
            hasFilters
              ? ""
              : "Mutations across the system will appear here as they happen."
          }
          filtered={hasFilters}
        />
      ) : (
        <DataTable
          ariaLabel="Audit log"
          columns={columns}
          rows={page.rows}
          sort={{ id: "createdAt", desc: true }}
        />
      )}

      <DataTablePagination
        basePath="/admin/audit-log"
        defaults={DEFAULTS}
        total={page.total}
        values={{ ...urlValues }}
      />

      <AuditDetailsSheet
        detail={detail}
        onOpenChange={setSheetOpen}
        open={sheetOpen}
      />
    </>
  );
}
