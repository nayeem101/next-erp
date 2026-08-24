import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import { listCategories } from "@/features/categories/queries";
import { ProductForm } from "@/features/products/components/product-form";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New product | NextERP",
};

async function NewProductForm() {
  // No dynamic APIs are read on this route; opt into request time so the
  // static shell prerenders without a database and the form streams once
  // categories resolve.
  await connection();

  const categoriesPage = await listCategories({
    page: 1,
    pageSize: 100,
    status: "active",
    sort: "name",
    search: undefined,
  });

  return (
    <>
      <ProductForm
        mode="create"
        categoryOptions={categoriesPage.rows.map((row) => ({
          id: row.id,
          label: row.name,
        }))}
      />

      <Link
        className={buttonVariants({ variant: "ghost", size: "sm" })}
        href="/inventory/products"
      >
        Back to products
      </Link>
    </>
  );
}

export default function NewProductPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">New product</h1>
        <p className="text-sm text-muted-foreground">
          Create product master data with an optional opening stock balance.
        </p>
      </header>

      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <NewProductForm />
      </Suspense>
    </div>
  );
}
