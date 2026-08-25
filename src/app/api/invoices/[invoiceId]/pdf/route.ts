import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { type ReactElement, createElement } from "react";

// JSX for the document component lives in .tsx-land; keep this file JS-safe.

import { InvoicePdfDocument } from "@/features/invoices/invoice-pdf";
import { getInvoice, getInvoiceLines } from "@/features/invoices/queries";
import { buildInvoiceDocumentData } from "@/features/invoices/view-model";
import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";

import type { NextRequest } from "next/server";

/**
 * Authenticated invoice PDF download. Admin/Sales only (Inventory and
 * anonymous requests get 403/401 without leaking existence). The filename
 * is derived from the validated invoice number — never user input.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ invoiceId: string }> },
) {
  const auth = await getActionContext(MODULE_ROLE_REQUIREMENTS.invoices);

  if (!auth.ok) {
    return new Response("Forbidden", { status: 403 });
  }

  const { invoiceId } = await context.params;

  if (!UUID_PATTERN.test(invoiceId)) {
    return new Response("Not found", { status: 404 });
  }

  const invoice = await getInvoice(invoiceId);

  if (!invoice) {
    return new Response("Not found", { status: 404 });
  }

  const lines = await getInvoiceLines(invoiceId);
  const data = buildInvoiceDocumentData(invoice, lines);

  const element = createElement(InvoicePdfDocument, {
    data,
  }) as unknown as ReactElement<DocumentProps>;

  const buffer = await renderToBuffer(element);

  // Safe filename: the invoice number matches INV-\d{6} from the sequence.
  const filename = `${invoice.invoiceNumber}.pdf`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
