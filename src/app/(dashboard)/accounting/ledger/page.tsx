import { Suspense } from "react";

import { LedgerGrid } from "@/features/ledger/components/ledger-grid";
import { listLedgerJournals } from "@/features/ledger/queries";
import { listLedgerQuerySchema } from "@/features/ledger/schemas";
import { parseListQuery } from "@/lib/list-query/parse";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ledger | NextERP",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function LedgerContent({ searchParams }: PageProps) {
  const raw = await searchParams;

  // Hostile or malformed URLs degrade to defaults and rewrite nothing here.
  const { query: rawQuery } = parseListQuery(raw, listLedgerQuerySchema);
  const page = await listLedgerJournals(rawQuery);

  return (
    <LedgerGrid
      page={page}
      urlValues={{
        journalType: rawQuery.journalType,
        dateFrom: rawQuery.dateFrom,
        dateTo: rawQuery.dateTo,
        reference: rawQuery.reference,
        page: rawQuery.page,
        pageSize: rawQuery.pageSize,
      }}
    />
  );
}

export default function LedgerPage(props: PageProps) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">General ledger</h1>
        <p className="text-sm text-muted-foreground">
          Append-only journals posted by order confirmations and reversals.
          Every group must balance to zero.
        </p>
      </header>

      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <LedgerContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
