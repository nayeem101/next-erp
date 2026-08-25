import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { InvoiceDocumentData } from "./view-model";

/**
 * Deterministic invoice PDF document. Every value comes from the snapshot
 * view model — mutable customer/product data is never consulted at render
 * time, so the same invoice always produces identical content.
 */

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
  },
  meta: {
    textAlign: "right",
    color: "#6b7280",
  },
  partyRow: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 24,
  },
  party: {
    flex: 1,
    lineHeight: 1.5,
  },
  partyTitle: {
    fontSize: 9,
    color: "#6b7280",
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
    paddingBottom: 6,
    marginBottom: 6,
    fontSize: 9,
    color: "#6b7280",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 6,
  },
  colProduct: { width: "45%" },
  colQty: { width: "15%" },
  colUnit: { width: "20%", textAlign: "right" },
  colTotal: { width: "20%", textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
    gap: 12,
  },
  totalLabel: {
    fontFamily: "Helvetica-Bold",
  },
  voidBanner: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#dc2626",
    color: "#dc2626",
    padding: 8,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
  },
});

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
  }).format(cents / 100);
}

export function InvoicePdfDocument({ data }: { data: InvoiceDocumentData }) {
  return (
    <Document title={data.title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>INVOICE</Text>
            <Text>{data.invoiceNumber}</Text>
          </View>
          <View style={styles.meta}>
            <Text>Issued: {data.issuedAt}</Text>
            {data.voidedAt !== null ? (
              <Text>Voided: {data.voidedAt}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.partyRow}>
          <View style={styles.party}>
            <Text style={styles.partyTitle}>From</Text>
            <Text>{data.seller.name}</Text>
            <Text>{data.seller.addressLine1}</Text>
            {data.seller.addressLine2 ? (
              <Text>{data.seller.addressLine2}</Text>
            ) : null}
            <Text>{data.seller.cityLine}</Text>
            <Text>{data.seller.email}</Text>
          </View>
          <View style={styles.party}>
            <Text style={styles.partyTitle}>Bill to</Text>
            <Text>{data.billTo.name}</Text>
            {data.billTo.companyName ? (
              <Text>{data.billTo.companyName}</Text>
            ) : null}
            <Text>{data.billTo.addressLine1}</Text>
            <Text>{data.billTo.cityLine}</Text>
            <Text>{data.billTo.email}</Text>
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.colProduct}>Product</Text>
          <Text style={styles.colQty}>Qty</Text>
          <Text style={styles.colUnit}>Unit price</Text>
          <Text style={styles.colTotal}>Line total</Text>
        </View>

        {data.lines.map((line) => (
          <View key={line.key} style={styles.row}>
            <Text style={styles.colProduct}>
              {line.productName} ({line.productSku})
            </Text>
            <Text style={styles.colQty}>{line.quantity}</Text>
            <Text style={styles.colUnit}>
              {formatMoney(line.unitPriceCents)}
            </Text>
            <Text style={styles.colTotal}>
              {formatMoney(line.lineTotalCents)}
            </Text>
          </View>
        ))}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total due (USD):</Text>
          <Text style={styles.totalLabel}>{formatMoney(data.totalCents)}</Text>
        </View>

        {data.isVoid ? (
          <Text style={styles.voidBanner} fixed>
            VOID — This invoice no longer represents money owed.
          </Text>
        ) : null}
      </Page>
    </Document>
  );
}
