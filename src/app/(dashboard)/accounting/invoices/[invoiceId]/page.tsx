import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Money } from "@/components/shared/display";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getInvoice, getInvoiceLines } from "@/features/invoices/queries";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Invoice | NextERP",
};

interface PageProps {
  params: Promise<{ invoiceId: string }>;
}

function PartyBlock({
  title,
  party,
}: {
  title: string;
  party: {
    name: string;
    email: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    region?: string;
    postalCode: string;
    countryCode: string;
    companyName?: string;
    phone?: string;
  };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <p className="font-medium">{party.name}</p>
        {party.companyName ? <p>{party.companyName}</p> : null}
        <p>{party.addressLine1}</p>
        {party.addressLine2 ? <p>{party.addressLine2}</p> : null}
        <p>
          {[
            party.city,
            party.region,
            `${party.postalCode} ${party.countryCode}`,
          ]
            .filter(Boolean)
            .join(", ")}
        </p>
        <p className="text-muted-foreground">{party.email}</p>
        {party.phone ? (
          <p className="text-muted-foreground">{party.phone}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

async function InvoiceContent({ invoiceId }: { invoiceId: string }) {
  await connection();

  const invoice = await getInvoice(invoiceId);

  if (!invoice) {
    notFound();
  }

  const lines = await getInvoiceLines(invoiceId);
  const isVoid = invoice.status === "void";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-heading text-lg font-semibold">
            {invoice.invoiceNumber}
          </h2>
          {isVoid ? (
            <Badge variant="destructive">VOID</Badge>
          ) : (
            <Badge variant="success">Issued</Badge>
          )}
        </div>

        <a
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={`/api/invoices/${invoice.id}/pdf`}
          download
        >
          Download PDF
        </a>
      </div>

      {isVoid ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive"
        >
          This invoice is void. It remains viewable for the audit trail, but it
          no longer represents money owed.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <PartyBlock title="From" party={invoice.sellerSnapshot} />
        <PartyBlock title="Bill to" party={invoice.billToSnapshot} />
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              Order:{" "}
              <Link
                className="underline underline-offset-4"
                href={`/sales/orders/${invoice.orderId}`}
              >
                {invoice.orderNumber}
              </Link>
            </p>
            <p>
              Issued:{" "}
              {new Date(invoice.issuedAt).toLocaleDateString(undefined, {
                dateStyle: "medium",
              })}
            </p>
            {invoice.voidedAt !== null ? (
              <p>
                Voided:{" "}
                {new Date(invoice.voidedAt).toLocaleDateString(undefined, {
                  dateStyle: "medium",
                })}
              </p>
            ) : null}
            <p className="mt-2 text-lg font-semibold tabular-nums">
              <Money amountCents={invoice.totalCents} />
            </p>
          </CardContent>
        </Card>
      </div>

      <table className="w-full text-sm">
        <caption className="sr-only">Invoice line snapshots</caption>
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th scope="col" className="py-2 font-medium">
              Product
            </th>
            <th scope="col" className="py-2 font-medium">
              Qty
            </th>
            <th scope="col" className="py-2 font-medium">
              Unit price
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Line total
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-border/60">
              <td className="py-2 pr-4">
                <span className="block font-medium">{line.productName}</span>
                <span className="block text-xs text-muted-foreground">
                  {line.productSku}
                </span>
              </td>
              <td className="py-2 pr-4 tabular-nums">{line.quantity}</td>
              <td className="py-2 pr-4">
                <Money amountCents={line.unitPriceCents} />
              </td>
              <td className="py-2 text-right">
                <Money amountCents={line.lineTotalCents} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="pt-3 text-right font-medium">
              Total due (USD)
            </td>
            <td className="pt-3 text-right font-semibold tabular-nums">
              <Money amountCents={invoice.totalCents} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default async function InvoiceDetailPage(props: PageProps) {
  const { invoiceId } = await props.params;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Invoice</h1>
        <p className="text-sm text-muted-foreground">
          Snapshot billing data captured when the order was confirmed.
        </p>
      </header>

      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <InvoiceContent invoiceId={invoiceId} />
      </Suspense>

      <Link
        className={buttonVariants({ variant: "ghost", size: "sm" })}
        href="/accounting/invoices"
      >
        Back to invoices
      </Link>
    </div>
  );
}
