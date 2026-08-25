import "server-only";

import { eq, like, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { customers, orders, products } from "@/db/schema";
import { confirmOrder } from "@/features/orders/confirm";
import { cancelOrder, fulfillOrder } from "@/features/orders/lifecycle";
import { createDraftOrder } from "@/features/orders/service";

/**
 * Demo sales orders covering every lifecycle outcome.
 *
 * Idempotent by the fixed `DEMO-` notes marker: a second run finds the
 * orders already present and does nothing. All data flows through the
 * production services, so invoices, stock movements, journals, and audit
 * events are exactly what real usage produces.
 */

const DEMO_MARKER = "DEMO-";

export interface DemoOrdersResult {
  created: number;
}

interface DemoOrderPlan {
  key: string;
  customerEmail: string;
  productSku: string;
  quantity: number;
  /** Final lifecycle state reached through legal transitions. */
  outcome: "draft" | "confirmed" | "fulfilled" | "cancelled-confirmed";
  notes: string;
}

const DEMO_ORDERS: DemoOrderPlan[] = [
  {
    key: "draft",
    customerEmail: "buying@acmeretail.example",
    productSku: "DEMO-DRILL-18V",
    quantity: 2,
    outcome: "draft",
    notes: `${DEMO_MARKER} awaiting review`,
  },
  {
    key: "confirmed",
    customerEmail: "orders@brighthardware.example",
    productSku: "DEMO-HOSE-25M",
    quantity: 5,
    outcome: "confirmed",
    notes: `${DEMO_MARKER} confirmed sale`,
  },
  {
    key: "fulfilled",
    customerEmail: "ap@cedarsons.example",
    productSku: "DEMO-DRILL-18V",
    quantity: 1,
    outcome: "fulfilled",
    notes: `${DEMO_MARKER} delivered`,
  },
  {
    key: "cancelled",
    customerEmail: "hello@everettgarden.example",
    productSku: "DEMO-HOSE-25M",
    quantity: 3,
    outcome: "cancelled-confirmed",
    notes: `${DEMO_MARKER} reversed duplicate`,
  },
];

async function resolveDemoActor(): Promise<string | null> {
  const db = getDb();

  // The admin user owns demo writes; look up any admin role holder.
  const rows = (await db.execute(sql`
    select user_id as id from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where r.key = 'admin'
    order by ur.created_at asc
    limit 1
  `)) as unknown as { id: string }[];

  return rows[0]?.id ?? null;
}

/** Idempotently seeds lifecycle-varied demo orders via real services. */
export async function seedDemoOrders(): Promise<DemoOrdersResult> {
  const actorId = await resolveDemoActor();

  if (!actorId) {
    // No provisioned admin yet — nothing we can attribute writes to.
    return { created: 0 };
  }

  const db = getDb();

  const existing = await db
    .select({ id: orders.id })
    .from(orders)
    .where(like(orders.notes, `${DEMO_MARKER}%`))
    .limit(1);

  if (existing.length > 0) {
    return { created: 0 };
  }

  let created = 0;

  for (const plan of DEMO_ORDERS) {
    const customerRows = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, plan.customerEmail))
      .limit(1);

    const customerId = customerRows[0]?.id;

    if (!customerId) {
      continue;
    }

    const productRows = await db
      .select({
        id: products.id,
        stockOnHand: products.stockOnHand,
        unitPriceCents: products.unitPriceCents,
      })
      .from(products)
      .where(eq(products.sku, plan.productSku))
      .limit(1);

    const product = productRows[0];

    if (!product || product.stockOnHand < plan.quantity) {
      continue;
    }

    const draft = await createDraftOrder(
      {
        customerId,
        lines: [{ productId: product.id, quantity: plan.quantity }],
        notes: plan.notes,
      },
      actorId,
      crypto.randomUUID(),
    );

    if (plan.outcome === "draft") {
      created += 1;

      continue;
    }

    const confirmed = await confirmOrder(
      { orderId: draft.orderId, version: draft.version },
      actorId,
      crypto.randomUUID(),
    );

    if (plan.outcome === "confirmed") {
      created += 1;

      continue;
    }

    if (plan.outcome === "fulfilled") {
      await fulfillOrder(
        { orderId: confirmed.orderId, version: confirmed.version },
        actorId,
        crypto.randomUUID(),
      );
      created += 1;

      continue;
    }

    // cancelled-confirmed: exercises restock + void + reversal journal.
    await cancelOrder(
      {
        orderId: confirmed.orderId,
        version: confirmed.version,
        reason: "Demo reversal of a confirmed order.",
      },
      actorId,
      crypto.randomUUID(),
    );
    created += 1;
  }

  return { created };
}
