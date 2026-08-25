/**
 * Shared view model between the PDF document and its deterministic tests.
 * Everything is pre-formatted/serialized so the renderer stays dumb and
 * the same invoice always yields byte-identical content.
 */

export interface InvoiceDocumentParty {
  name: string;
  email: string;
  addressLine1: string;
  addressLine2?: string;
  cityLine: string;
  companyName?: string;
}

export interface InvoiceDocumentLine {
  key: string;
  productSku: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface InvoiceDocumentData {
  title: string;
  invoiceNumber: string;
  issuedAt: string;
  voidedAt: string | null;
  isVoid: boolean;
  seller: InvoiceDocumentParty;
  billTo: InvoiceDocumentParty;
  lines: InvoiceDocumentLine[];
  totalCents: number;
}

interface PartySnapshot {
  name: string;
  email: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  region?: string | undefined;
  postalCode: string;
  countryCode: string;
  companyName?: string | undefined;
  phone?: string | undefined;
}

function partyFromSnapshot(snapshot: PartySnapshot): InvoiceDocumentParty {
  return {
    name: snapshot.name,
    email: snapshot.email,
    addressLine1: snapshot.addressLine1,
    ...(snapshot.addressLine2 !== undefined
      ? { addressLine2: snapshot.addressLine2 }
      : {}),
    cityLine: [
      snapshot.city,
      snapshot.region,
      `${snapshot.postalCode} ${snapshot.countryCode}`,
    ]
      .filter(Boolean)
      .join(", "),
    ...(snapshot.companyName !== undefined
      ? { companyName: snapshot.companyName }
      : {}),
  };
}

function formatDate(value: string): string {
  // Deterministic UTC formatting — never locale/timezone dependent.
  const date = new Date(value);

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${String(year)}-${month}-${day}`;
}

export function buildInvoiceDocumentData(
  invoice: {
    invoiceNumber: string;
    status: "issued" | "void";
    totalCents: number;
    issuedAt: string;
    voidedAt: string | null;
    sellerSnapshot: PartySnapshot;
    billToSnapshot: PartySnapshot;
  },
  lines: {
    id: string;
    productSku: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }[],
): InvoiceDocumentData {
  return {
    title: `Invoice ${invoice.invoiceNumber}`,
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: formatDate(invoice.issuedAt),
    voidedAt: invoice.voidedAt === null ? null : formatDate(invoice.voidedAt),
    isVoid: invoice.status === "void",
    seller: partyFromSnapshot(invoice.sellerSnapshot),
    billTo: partyFromSnapshot(invoice.billToSnapshot),
    lines: lines.map((line) => ({
      key: line.id,
      productSku: line.productSku,
      productName: line.productName,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
    })),
    totalCents: invoice.totalCents,
  };
}
