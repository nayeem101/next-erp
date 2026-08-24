import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { listCategories } from "@/features/categories/queries";
import { ProductForm } from "@/features/products/components/product-form";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New product | NextERP",
};

export default async function NewProductPage() {
  const categoriesPage = await listCategories({
    page: 1,
    pageSize: 100,
    status: "active",
    sort: "name",
    search: undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">New product</h1>
        <p className="text-sm text-muted-foreground">
          Create product master data with an optional opening stock balance.
        </p>
      </header>

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
    </div>
  );
}
