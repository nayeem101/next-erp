import { notFound } from "next/navigation";

import { listCategories } from "@/features/categories/queries";
import { ProductForm } from "@/features/products/components/product-form";
import { getProduct } from "@/features/products/queries";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Edit product | NextERP",
};

interface PageProps {
  params: Promise<{ productId: string }>;
}

export default async function EditProductPage({ params }: PageProps) {
  const { productId } = await params;

  const [product, categoriesPage] = await Promise.all([
    getProduct(productId),
    listCategories({
      page: 1,
      pageSize: 100,
      status: "active",
      sort: "name",
      search: undefined,
    }),
  ]);

  if (!product) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Edit product</h1>
        <p className="text-sm text-muted-foreground">
          Update master data for {product.sku}. Stock never changes here.
        </p>
      </header>

      <ProductForm
        mode="edit"
        product={product}
        categoryOptions={categoriesPage.rows.map((row) => ({
          id: row.id,
          label: row.name,
        }))}
      />
    </div>
  );
}
