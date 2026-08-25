import { describe, expect, test } from "vitest";

import { buildInvoiceDocumentData } from "./view-model";

const invoice = {
  id: "00000000-0000-4000-8000-00000000aa01",
  invoiceNumber: "INV-001234",
  status: "issued" as const,
  currencyCode: "USD",
  orderId: "00000000-0000-4000-8000-00000000bb01",
  orderNumber: "SO-000100",
  customerId: "00000000-0000-4000-8000-00000000cc01",
  customerName: "Acme Retail",
  sellerSnapshot: {
    name: "NextERP Demo Company",
    email: "billing@example.com",
    addressLine1: "100 Market Street",
    addressLine2: "Suite 4",
    city: "San Francisco",
    region: "CA",
    postalCode: "94105",
    countryCode: "US",
  },
  billToSnapshot: {
    name: "Acme Retail",
    email: "buyer@acme.com",
    addressLine1: "1 Main St",
    city: "Springfield",
    postalCode: "62704",
    countryCode: "US",
    companyName: "Acme Holdings",
    phone: "+1 555-0100",
  },
  subtotalCents: 30_548,
  totalCents: 30_548,
  issuedAt: "2026-08-20T10:00:00.000Z",
  voidedAt: null,
};

const lines = [
  {
    id: "l1",
    productSku: "SKU-1",
    productName: "Cordless Drill",
    quantity: 2,
    unitPriceCents: 12_999,
    lineTotalCents: 25_998,
  },
  {
    id: "l2",
    productSku: "SKU-2",
    productName: "Garden Hose",
    quantity: 1,
    unitPriceCents: 4_550,
    lineTotalCents: 4_550,
  },
];

describe("invoice document view model", () => {
  test("builds a deterministic snapshot-driven projection", () => {
    const data = buildInvoiceDocumentData(invoice, lines);

    expect(data).toEqual({
      title: "Invoice INV-001234",
      invoiceNumber: "INV-001234",
      issuedAt: "2026-08-20",
      voidedAt: null,
      isVoid: false,
      seller: {
        name: "NextERP Demo Company",
        email: "billing@example.com",
        addressLine1: "100 Market Street",
        addressLine2: "Suite 4",
        cityLine: "San Francisco, CA, 94105 US",
      },
      billTo: {
        name: "Acme Retail",
        email: "buyer@acme.com",
        addressLine1: "1 Main St",
        cityLine: "Springfield, 62704 US",
        companyName: "Acme Holdings",
      },
      lines: [
        {
          key: "l1",
          productSku: "SKU-1",
          productName: "Cordless Drill",
          quantity: 2,
          unitPriceCents: 12_999,
          lineTotalCents: 25_998,
        },
        {
          key: "l2",
          productSku: "SKU-2",
          productName: "Garden Hose",
          quantity: 1,
          unitPriceCents: 4_550,
          lineTotalCents: 4_550,
        },
      ],
      totalCents: 30_548,
    });

    // Deterministic: building twice yields identical output.
    expect(buildInvoiceDocumentData(invoice, lines)).toEqual(data);
  });

  test("void invoices carry the marker and their void date", () => {
    const data = buildInvoiceDocumentData(
      {
        ...invoice,
        status: "void",
        voidedAt: "2026-08-22T16:30:00.000Z",
      },
      lines,
    );

    expect(data.isVoid).toBe(true);
    expect(data.voidedAt).toBe("2026-08-22");
  });
});
