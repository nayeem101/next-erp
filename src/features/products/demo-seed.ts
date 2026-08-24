import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { categories, products } from "@/db/schema";
import { slugify } from "@/features/categories/schemas";
import { createCategory } from "@/features/categories/service";
import { createProduct } from "@/features/products/service";

/**
 * Demo inventory catalog.
 *
 * Definitions are fixed so repeated runs are no-ops: existence is checked by
 * the derived category slug and the normalized SKU before delegating to the
 * production services, which supply validation, audit events, and opening
 * movements. The stock mix deliberately includes low-stock rows so grid
 * treatments have data to render.
 */

interface DemoCategory {
  name: string;
}

interface DemoProduct {
  sku: string;
  name: string;
  categoryName: string;
  unitPrice: string;
  reorderLevel: number;
  openingStock: number;
}

const DEMO_CATEGORIES: DemoCategory[] = [
  { name: "Power Tools" },
  { name: "Garden Outdoor" },
  { name: "Hand Tools" },
  { name: "Safety Gear" },
];

const DEMO_PRODUCTS: DemoProduct[] = [
  // Power Tools
  {
    categoryName: "Power Tools",
    name: "Cordless Drill",
    reorderLevel: 10,
    sku: "DEMO-DRILL-18V",
    unitPrice: "129.99",
    openingStock: 40,
  },
  {
    categoryName: "Power Tools",
    name: "Impact Driver",
    reorderLevel: 8,
    sku: "DEMO-IMPACT-20V",
    unitPrice: "149.50",
    openingStock: 25,
  },
  {
    categoryName: "Power Tools",
    name: "Angle Grinder",
    reorderLevel: 6,
    sku: "DEMO-GRINDER-900",
    unitPrice: "79.00",
    openingStock: 5,
  },
  {
    categoryName: "Power Tools",
    name: "Orbital Sander",
    reorderLevel: 5,
    sku: "DEMO-SANDER-5IN",
    unitPrice: "59.99",
    openingStock: 18,
  },
  {
    categoryName: "Power Tools",
    name: "Reciprocating Saw",
    reorderLevel: 4,
    sku: "DEMO-RECIP-12A",
    unitPrice: "119.00",
    openingStock: 0,
  },
  // Garden Outdoor
  {
    categoryName: "Garden Outdoor",
    name: "Garden Hose 25m",
    reorderLevel: 12,
    sku: "DEMO-HOSE-25M",
    unitPrice: "34.90",
    openingStock: 30,
  },
  {
    categoryName: "Garden Outdoor",
    name: "Hedge Trimmer",
    reorderLevel: 6,
    sku: "DEMO-HEDGE-550W",
    unitPrice: "89.95",
    openingStock: 14,
  },
  {
    categoryName: "Garden Outdoor",
    name: "Lawn Sprinkler",
    reorderLevel: 15,
    sku: "DEMO-SPRINKLER-O",
    unitPrice: "19.99",
    openingStock: 3,
  },
  {
    categoryName: "Garden Outdoor",
    name: "Wheelbarrow",
    reorderLevel: 5,
    sku: "DEMO-WHEEL-90L",
    unitPrice: "74.00",
    openingStock: 9,
  },
  {
    categoryName: "Garden Outdoor",
    name: "Pruning Shears",
    reorderLevel: 20,
    sku: "DEMO-PRUNER-BYP",
    unitPrice: "24.50",
    openingStock: 45,
  },
  // Hand Tools
  {
    categoryName: "Hand Tools",
    name: "Claw Hammer",
    reorderLevel: 25,
    sku: "DEMO-HAMMER-16OZ",
    unitPrice: "14.99",
    openingStock: 60,
  },
  {
    categoryName: "Hand Tools",
    name: "Screwdriver Set",
    reorderLevel: 15,
    sku: "DEMO-SCREW-12PC",
    unitPrice: "29.99",
    openingStock: 35,
  },
  {
    categoryName: "Hand Tools",
    name: "Adjustable Wrench",
    reorderLevel: 10,
    sku: "DEMO-WRENCH-10IN",
    unitPrice: "17.25",
    openingStock: 22,
  },
  {
    categoryName: "Hand Tools",
    name: "Tape Measure 5m",
    reorderLevel: 30,
    sku: "DEMO-TAPE-5M",
    unitPrice: "9.99",
    openingStock: 80,
  },
  {
    categoryName: "Hand Tools",
    name: "Utility Knife",
    reorderLevel: 20,
    sku: "DEMO-KNIFE-RET",
    unitPrice: "12.75",
    openingStock: 2,
  },
  // Safety Gear
  {
    categoryName: "Safety Gear",
    name: "Safety Goggles",
    reorderLevel: 25,
    sku: "DEMO-GOGGLE-CLE",
    unitPrice: "11.50",
    openingStock: 50,
  },
  {
    categoryName: "Safety Gear",
    name: "Work Gloves L",
    reorderLevel: 30,
    sku: "DEMO-GLOVE-L",
    unitPrice: "8.99",
    openingStock: 70,
  },
  {
    categoryName: "Safety Gear",
    name: "Hard Hat",
    reorderLevel: 15,
    sku: "DEMO-HARDHAT-W",
    unitPrice: "21.00",
    openingStock: 26,
  },
  {
    categoryName: "Safety Gear",
    name: "Ear Protection",
    reorderLevel: 12,
    sku: "DEMO-EAR-32DB",
    unitPrice: "27.90",
    openingStock: 11,
  },
  {
    categoryName: "Safety Gear",
    name: "Hi-Vis Vest",
    reorderLevel: 18,
    sku: "DEMO-VEST-YL2X",
    unitPrice: "13.40",
    openingStock: 33,
  },
];

function cryptoRandomUuid(): string {
  return globalThis.crypto.randomUUID();
}

export interface DemoSeedResult {
  categoriesCreated: number;
  productsCreated: number;
  /** Stable ids keyed by normalized SKU for repeat-run assertions. */
  productIdsBySku: Map<string, string>;
}

async function ensureDemoCategories(
  actorId: string,
): Promise<{ idsByName: Map<string, string>; created: number }> {
  const db = getDb();
  const idsByName = new Map<string, string>();
  let created = 0;

  for (const definition of DEMO_CATEGORIES) {
    const slug = slugify(definition.name);

    const existingRows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1);

    const existing = existingRows[0];

    if (existing) {
      idsByName.set(definition.name, existing.id);

      continue;
    }

    const result = await createCategory(
      { name: definition.name, description: undefined },
      actorId,
      cryptoRandomUuid(),
    );

    idsByName.set(definition.name, result.categoryId);
    created += 1;
  }

  return { idsByName, created };
}

/**
 * Applies the Phase 2 demo catalog through the production services. Safe to
 * run repeatedly: every definition is keyed on its natural identity (slug /
 * SKU) and skipped when present, so audit history reflects only the first
 * application.
 */
export async function seedDemoInventoryCatalog(
  actorId: string,
): Promise<DemoSeedResult> {
  const db = getDb();
  const { idsByName, created: categoriesCreated } =
    await ensureDemoCategories(actorId);

  let productsCreated = 0;
  const productIdsBySku = new Map<string, string>();

  for (const definition of DEMO_PRODUCTS) {
    const categoryId = idsByName.get(definition.categoryName);

    if (!categoryId) {
      throw new Error(
        `demo category missing after seeding: ${definition.categoryName}`,
      );
    }

    const sku = definition.sku.toUpperCase();

    const existingRows = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.sku, sku))
      .limit(1);

    const existing = existingRows[0];

    if (existing) {
      productIdsBySku.set(sku, existing.id);

      continue;
    }

    const result = await createProduct(
      {
        categoryId,
        sku,
        name: definition.name,
        description: undefined,
        unitPrice: definition.unitPrice,
        reorderLevel: definition.reorderLevel,
        openingStock: definition.openingStock,
      },
      actorId,
      cryptoRandomUuid(),
    );

    productIdsBySku.set(sku, result.productId);
    productsCreated += 1;
  }

  return { categoriesCreated, productsCreated, productIdsBySku };
}
