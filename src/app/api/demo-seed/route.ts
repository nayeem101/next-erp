import { seedDemoCustomers } from "@/features/customers/demo-seed";
import { seedDemoOrders } from "@/features/orders/demo-seed";
import { seedDemoInventoryCatalog } from "@/features/products/demo-seed";
import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";

/**
 * Dev/e2e bootstrap: seeds demo master data and lifecycle-varied orders
 * through the production services. Admin-only and never available in
 * production builds, so the public surface stays clean.
 */

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const context = await getActionContext(
    MODULE_ROLE_REQUIREMENTS.orderAuthoring,
  );

  if (!context.ok) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const customerSeed = await seedDemoCustomers(context.user.id);
  const productSeed = await seedDemoInventoryCatalog(context.user.id);
  const orderSeed = await seedDemoOrders();

  return Response.json({
    customersCreated: customerSeed.created,
    categoriesCreated: productSeed.categoriesCreated,
    productsCreated: productSeed.productsCreated,
    ordersCreated: orderSeed.created,
  });
}
