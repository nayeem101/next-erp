"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import type { AuditDetailRow } from "../schemas";

const ENTITY_HREFS: Record<string, (id: string) => string> = {
  order: (id) => `/sales/orders/${id}`,
  invoice: (id) => `/accounting/invoices/${id}`,
  customer: (id) => `/customers/${id}`,
  product: (id) => `/inventory/products/${id}`,
  user: () => "/admin/users",
};

function MetadataSection({ title, value }: { title: string; value: unknown }) {
  if (value === undefined) {
    return null;
  }

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/**
 * Accessible details sheet for one audit event. Renders the sanitized
 * before/after/context metadata recorded at write time.
 */
export function AuditDetailsSheet({
  detail,
  open,
  onOpenChange,
}: {
  detail: AuditDetailRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const entityHref =
    detail !== null
      ? (ENTITY_HREFS[detail.entityType]?.(detail.entityId ?? "") ?? undefined)
      : undefined;

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent aria-describedby="audit-sheet-description">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-sm">
            {detail?.action ?? "Audit event"}
            {detail ? (
              <Badge variant="outline">{detail.entityType}</Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription id="audit-sheet-description" className="text-xs">
            {detail
              ? new Date(detail.createdAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : ""}
          </SheetDescription>
        </SheetHeader>

        {detail ? (
          <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-6">
            {detail.entityId ? (
              <p className="text-xs break-all text-muted-foreground">
                Entity ID:{" "}
                {entityHref ? (
                  <a className="underline underline-offset-4" href={entityHref}>
                    {detail.entityId}
                  </a>
                ) : (
                  detail.entityId
                )}
              </p>
            ) : null}

            <MetadataSection title="Before" value={detail.metadata.before} />
            <MetadataSection title="After" value={detail.metadata.after} />
            {detail.metadata.reason !== undefined &&
            typeof detail.metadata.reason === "string" ? (
              <p className="text-sm">
                <span className="font-medium">Reason: </span>
                {detail.metadata.reason}
              </p>
            ) : null}
            <MetadataSection title="Context" value={detail.metadata.context} />
          </div>
        ) : null}

        <button
          aria-label="Close audit details"
          className={`${buttonVariants({ variant: "ghost", size: "sm" })} mt-auto`}
          onClick={() => {
            onOpenChange(false);
          }}
          type="button"
        >
          Close
        </button>
      </SheetContent>
    </Sheet>
  );
}
