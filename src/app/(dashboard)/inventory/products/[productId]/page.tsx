import { AlertTriangle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/shared/data-table-skeleton";
import { Money } from "@/components/shared/display";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { ProductStatusActions } from "@/features/products/components/product-status-actions";
import { StockMovementTable } from "@/features/products/components/stock-movement-table";
import { getProduct } from "@/features/products/queries";
import { listStockMovements } from "@/features/products/stock-movement-queries";
import { listStockMovementsQuerySchema } from "@/features/products/stock-movement-schemas";
import { getActionContext } from "@/lib/auth/guards";
import { parseListQuery } from "@/lib/list-query/parse";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Product | NextERP",
};

interface PageProps {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function MovementsSection({
  productId,
  searchParams,
}: {
  productId: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Movement tables scope their own URL state to page/pageSize; other
  // parameters are ignored so product filters cannot poison the history.
  const raw = await searchParams;
  const { query } = parseListQuery(raw, listStockMovementsQuerySchema);

  const movementPage = await listStockMovements({
    ...query,
    productId,
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-base font-semibold">Movement history</h2>

      <StockMovementTable
        productId={productId}
        page={movementPage}
        urlValues={{
          page: query.page,
          pageSize: query.pageSize,
        }}
      />
    </section>
  );
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { productId } = await params;

  const [product, context] = await Promise.all([
    getProduct(productId),
    getActionContext(),
  ]);

  if (!product) {
    notFound();
  }

  const isLowStock =
    product.isActive && product.stockOnHand <= product.reorderLevel;

  return (
    <div className="flex flex-col gap-4">
      <Link
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href="/inventory/products"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Back to products
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-xl font-semibold">
              {product.name}
            </h1>
            {product.isActive ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="warning">Archived</Badge>
            )}
            {isLowStock && (
              <Badge variant="destructive">
                <AlertTriangle aria-hidden className="size-3" />
                Low stock
              </Badge>
            )}
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {product.sku} · {product.categoryName}
          </p>
        </div>

        <ProductStatusActions
          product={product}
          currentRoles={context.ok ? [...context.user.roles] : []}
        />
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1">
            <CardDescription>Unit price</CardDescription>
            <Money
              amountCents={product.unitPriceCents}
              className="text-lg font-semibold"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-1">
            <CardDescription>Stock on hand</CardDescription>
            <span
              className={
                isLowStock
                  ? "text-lg font-semibold text-destructive tabular-nums"
                  : "text-lg font-semibold tabular-nums"
              }
            >
              {product.stockOnHand}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-1">
            <CardDescription>Reorder level</CardDescription>
            <span className="text-lg font-semibold tabular-nums">
              {product.reorderLevel}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-1">
            <CardDescription>Status</CardDescription>
            <span className="text-sm">
              {product.isActive ? "Available for orders" : "Hidden from orders"}
            </span>
          </CardContent>
        </Card>
      </div>

      {product.description !== null && (
        <p className="max-w-2xl text-sm text-muted-foreground">
          {product.description}
        </p>
      )}

      <Suspense
        fallback={
          <DataTableSkeleton
            columnLabels={[
              "Type",
              "Delta",
              "Resulting stock",
              "Reference",
              "Reason",
              "Actor",
              "When",
            ]}
            rowCount={5}
          />
        }
      >
        <MovementsSection productId={productId} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
