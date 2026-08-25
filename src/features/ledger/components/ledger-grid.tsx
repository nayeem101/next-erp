"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Money } from "@/components/shared/display";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { LedgerListPage } from "../schemas";

interface LedgerGridValues {
  journalType: string;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  reference?: string | undefined;
  page: number;
  pageSize: number;
}

const DEFAULTS = {
  journalType: "all",
  page: 1,
  pageSize: 10,
} as const;

function hrefFor(
  values: LedgerGridValues,
  patch: Partial<LedgerGridValues>,
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

  return query === "" ? "/accounting/ledger" : `/accounting/ledger?${query}`;
}

/**
 * Read-only ledger. Journals render as grouped cards with debit/credit
 * columns; the balance indicator must read "Balanced" for every group —
 * an unbalanced journal throws upstream and never reaches this grid.
 */
export function LedgerGrid({
  page,
  urlValues,
}: {
  page: LedgerListPage;
  urlValues: LedgerGridValues;
}) {
  const router = useRouter();

  const [reference, setReference] = React.useState(urlValues.reference ?? "");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Filter by journal type"
          className="flex rounded-md border"
        >
          {(["sale", "sale_reversal", "all"] as const).map((type) => {
            const isCurrent = urlValues.journalType === type;

            return (
              <Link
                key={type}
                aria-current={isCurrent ? "page" : undefined}
                className={
                  isCurrent
                    ? "bg-primary px-3 py-1.5 text-sm text-primary-foreground first:rounded-l-md last:rounded-r-md"
                    : "px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md hover:bg-muted"
                }
                href={hrefFor(urlValues, {
                  journalType: type,
                  page: DEFAULTS.page,
                })}
              >
                {type === "sale"
                  ? "Sales"
                  : type === "sale_reversal"
                    ? "Reversals"
                    : "All"}
              </Link>
            );
          })}
        </nav>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(
              hrefFor(urlValues, {
                reference: reference.trim() || undefined,
                page: DEFAULTS.page,
              }),
            );
          }}
        >
          <label htmlFor="ledger-reference" className="sr-only">
            Filter by order reference
          </label>
          <input
            id="ledger-reference"
            value={reference}
            placeholder="Order number…"
            onChange={(event) => {
              setReference(event.target.value);
            }}
            className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <button
            className={buttonVariants({ variant: "outline", size: "sm" })}
            type="submit"
          >
            Filter
          </button>
        </form>
      </div>

      {page.journals.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No journals match the current filters.
        </p>
      ) : (
        <ul className="space-y-3">
          {page.journals.map((journal) => {
            const balanced =
              journal.debitTotalCents === journal.creditTotalCents;

            return (
              <li key={journal.journalId}>
                <Card>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      {journal.journalType === "sale_reversal" ? (
                        <Badge variant="warning">Reversal</Badge>
                      ) : (
                        <Badge variant="default">Sale</Badge>
                      )}
                      {journal.description}
                    </CardTitle>
                    {balanced ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <span aria-hidden={true}>✓</span> Balanced
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-destructive">
                        Unbalanced — do not trust these books
                      </span>
                    )}
                  </CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <caption className="sr-only">
                        Journal legs for {journal.orderNumber}
                      </caption>
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th scope="col" className="py-1 font-medium">
                            Account
                          </th>
                          <th
                            scope="col"
                            className="py-1 text-right font-medium"
                          >
                            Debit
                          </th>
                          <th
                            scope="col"
                            className="py-1 text-right font-medium"
                          >
                            Credit
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {journal.legs.map((leg, index) => (
                          <tr
                            key={`${leg.account}-${String(index)}`}
                            className="border-b border-border/50"
                          >
                            <td className="py-1.5">
                              {leg.account.replaceAll("_", " ")}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {leg.side === "debit" ? (
                                <Money amountCents={leg.amountCents} />
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {leg.side === "credit" ? (
                                <Money amountCents={leg.amountCents} />
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Order:{" "}
                        <Link
                          className="underline underline-offset-4 hover:underline"
                          href={`/sales/orders/${journal.orderId}`}
                        >
                          {journal.orderNumber}
                        </Link>
                      </span>
                      <span>Invoice: {journal.invoiceNumber}</span>
                      <span>
                        Posted:{" "}
                        {new Date(journal.postedAt).toLocaleDateString(
                          undefined,
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </span>
                    </p>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <nav
        aria-label="Ledger pagination"
        className="flex items-center justify-between"
      >
        <span className="text-sm text-muted-foreground">
          Showing journals {(urlValues.page - 1) * urlValues.pageSize + 1}–
          {Math.min(urlValues.page * urlValues.pageSize, page.total)} of{" "}
          {page.total}
        </span>
        <div className="flex gap-2">
          <Link
            aria-disabled={urlValues.page <= 1 || undefined}
            className={
              urlValues.page <= 1
                ? `${buttonVariants({ variant: "outline", size: "sm" })} pointer-events-none opacity-50`
                : buttonVariants({ variant: "outline", size: "sm" })
            }
            href={hrefFor(urlValues, { page: Math.max(urlValues.page - 1, 1) })}
          >
            Previous
          </Link>
          <Link
            aria-disabled={urlValues.page >= page.totalPages || undefined}
            className={
              urlValues.page >= page.totalPages
                ? `${buttonVariants({ variant: "outline", size: "sm" })} pointer-events-none opacity-50`
                : buttonVariants({ variant: "outline", size: "sm" })
            }
            href={hrefFor(urlValues, {
              page: Math.min(urlValues.page + 1, page.totalPages),
            })}
          >
            Next
          </Link>
        </div>
      </nav>
    </div>
  );
}
