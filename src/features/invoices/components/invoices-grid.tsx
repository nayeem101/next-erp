"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import {
  createDataTableColumnHelper,
  DataTable,
  type DataTableSort,
} from "@/components/shared/data-table/data-table";
import { DataTablePagination } from "@/components/shared/data-table/data-table-pagination";
import { EmptyState, Money } from "@/components/shared/display";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

import type { InvoiceListPage, InvoiceListRow } from "../queries";

const columnHelper = createDataTableColumnHelper<InvoiceListRow>();

interface InvoiceGridValues {
  status: string;
  customerId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  page: number;
  pageSize: number;
}

export interface InvoiceCustomerOption {
  id: string;
  name: string;
}

const DEFAULTS = {
  status: "all",
  page: 1,
  pageSize: 20,
} as const;

function hrefFor(
  values: InvoiceGridValues,
  patch: Partial<InvoiceGridValues>,
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

  return query === ""
    ? "/accounting/invoices"
    : `/accounting/invoices?${query}`;
}

/**
 * Invoice register. Admin/Sales only (route guard enforces it); rows link
 * to the server-rendered detail and the PDF download endpoint.
 */
export function InvoicesGrid({
  page,
  urlValues,
  customerOptions,
}: {
  page: InvoiceListPage;
  urlValues: InvoiceGridValues;
  customerOptions: InvoiceCustomerOption[];
}) {
  const router = useRouter();

  const [customerInput, setCustomerInput] = React.useState(
    urlValues.customerId ?? "",
  );
  const [dateFromInput, setDateFromInput] = React.useState(
    urlValues.dateFrom ?? "",
  );
  const [dateToInput, setDateToInput] = React.useState(urlValues.dateTo ?? "");

  function applyFilters(event: React.SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();

    router.push(
      hrefFor(urlValues, {
        customerId: customerInput === "" ? undefined : customerInput,
        dateFrom: dateFromInput === "" ? undefined : dateFromInput,
        dateTo: dateToInput === "" ? undefined : dateToInput,
        page: DEFAULTS.page,
      }),
    );
  }

  function handleSortChange(sort: DataTableSort | null): void {
    if (!sort?.id || !sort.desc || sort.id !== "issuedAt") {
      // Newest-first only for the register.
      return;
    }

    router.push(hrefFor(urlValues, {}));
  }

  const columns = React.useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("invoiceNumber", {
          header: "Invoice",
          cell: (cell) => (
            <Link
              className="font-medium underline-offset-4 hover:underline"
              href={`/accounting/invoices/${cell.row.original.id}`}
            >
              {cell.getValue()}
            </Link>
          ),
        }),
        columnHelper.accessor("status", {
          header: "Status",
          cell: (cell) =>
            cell.getValue() === "void" ? (
              <Badge variant="destructive">Void</Badge>
            ) : (
              <Badge variant="success">Issued</Badge>
            ),
        }),
        columnHelper.accessor("customerName", { header: "Customer" }),
        columnHelper.display({
          id: "order",
          header: "Order",
          cell: (cell) => (
            <Link
              className="underline-offset-4 hover:underline"
              href={`/sales/orders/${cell.row.original.orderId}`}
            >
              {cell.row.original.orderNumber}
            </Link>
          ),
        }),
        columnHelper.accessor("totalCents", {
          id: "totalCents",
          header: "Total",
          cell: (cell) => <Money amountCents={cell.getValue()} />,
        }),
        columnHelper.accessor("issuedAt", {
          id: "issuedAt",
          header: "Issued",
          cell: (cell) => (
            <time dateTime={cell.getValue()}>
              {new Date(cell.getValue()).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
          ),
        }),
        columnHelper.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          cell: (cell) => (
            <a
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={`/api/invoices/${cell.row.original.id}/pdf`}
              download
            >
              Download
            </a>
          ),
        }),
      ]),
    [],
  );

  const isEmpty = page.rows.length === 0;
  const hasFilters =
    urlValues.status !== DEFAULTS.status ||
    urlValues.customerId !== undefined ||
    urlValues.dateFrom !== undefined ||
    urlValues.dateTo !== undefined ||
    urlValues.page !== DEFAULTS.page;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Filter by invoice status"
          className="flex rounded-md border"
        >
          {(["issued", "void", "all"] as const).map((status) => {
            const isCurrent = urlValues.status === status;

            return (
              <Link
                key={status}
                aria-current={isCurrent ? "page" : undefined}
                className={
                  isCurrent
                    ? "bg-primary px-3 py-1.5 text-sm text-primary-foreground first:rounded-l-md last:rounded-r-md"
                    : "px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md hover:bg-muted"
                }
                href={hrefFor(urlValues, { status, page: DEFAULTS.page })}
              >
                {status === "all"
                  ? "All"
                  : status === "void"
                    ? "Void"
                    : "Issued"}
              </Link>
            );
          })}
        </nav>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={applyFilters}
        >
          <label htmlFor="invoice-customer-filter" className="sr-only">
            Filter by customer
          </label>
          <select
            id="invoice-customer-filter"
            value={customerInput}
            onChange={(event) => {
              setCustomerInput(event.target.value);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <option value="">All customers</option>
            {customerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>

          <label htmlFor="invoice-date-from" className="sr-only">
            Issued from
          </label>
          <input
            id="invoice-date-from"
            type="date"
            value={dateFromInput}
            max={dateToInput === "" ? undefined : dateToInput}
            onChange={(event) => {
              setDateFromInput(event.target.value);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <span aria-hidden={true} className="text-sm text-muted-foreground">
            –
          </span>
          <label htmlFor="invoice-date-to" className="sr-only">
            Issued to
          </label>
          <input
            id="invoice-date-to"
            type="date"
            value={dateToInput}
            min={dateFromInput === "" ? undefined : dateFromInput}
            onChange={(event) => {
              setDateToInput(event.target.value);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />

          <button
            className={buttonVariants({ variant: "outline", size: "sm" })}
            type="submit"
          >
            Apply
          </button>

          {hasFilters && urlValues.customerId !== undefined ? (
            <Link
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href={hrefFor(urlValues, {
                customerId: undefined,
                dateFrom: undefined,
                dateTo: undefined,
                page: DEFAULTS.page,
              })}
            >
              Clear filters
            </Link>
          ) : null}
        </form>
      </div>

      {isEmpty && !hasFilters ? (
        <EmptyState
          title="No invoices yet"
          description="Invoices appear here when orders are confirmed."
        />
      ) : isEmpty && hasFilters ? (
        <EmptyState title="No results" description="" filtered />
      ) : (
        <DataTable
          ariaLabel="Invoices"
          columns={columns}
          rows={page.rows}
          sort={{ id: "issuedAt", desc: true }}
          onSortChange={handleSortChange}
        />
      )}

      <DataTablePagination
        basePath="/accounting/invoices"
        values={{
          ...urlValues,
          search: undefined,
          sort: undefined,
          status: urlValues.status,
        }}
        defaults={DEFAULTS}
        total={page.total}
      />
    </>
  );
}
