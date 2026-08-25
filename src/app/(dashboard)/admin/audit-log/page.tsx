import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/shared/data-table-skeleton";
import { AuditLogGrid } from "@/features/audit/components/audit-log-grid";
import { listAuditEvents } from "@/features/audit/queries";
import { auditListQuerySchema } from "@/features/audit/schemas";
import { parseListQuery } from "@/lib/list-query/parse";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Audit log | NextERP",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function AuditTable({ searchParams }: PageProps) {
  const raw = await searchParams;

  // Hostile or malformed URLs degrade to defaults and rewrite nothing here.
  const { query } = parseListQuery(raw, auditListQuerySchema);
  const page = await listAuditEvents(query);

  return (
    <AuditLogGrid
      page={page}
      urlValues={{
        action: query.action,
        entityType: query.entityType,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        page: query.page,
        pageSize: query.pageSize,
      }}
    />
  );
}

export default function AuditLogPage(props: PageProps) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Append-only trail of every security-sensitive and business mutation.
          Entries cannot be edited or deleted.
        </p>
      </header>

      <Suspense
        fallback={
          <DataTableSkeleton
            columnLabels={["When", "Actor", "Action", "Entity", "Details"]}
            rowCount={10}
          />
        }
      >
        <AuditTable searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
