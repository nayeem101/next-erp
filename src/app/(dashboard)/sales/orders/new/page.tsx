import { ForbiddenAccess } from "@/components/shared/forbidden-access";
import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";

/** Authoring a draft is an Admin/Sales activity; Inventory reaches this
 * route only through the read-only operations queue. */
export default async function NewOrderPage() {
  const context = await getActionContext(
    MODULE_ROLE_REQUIREMENTS.orderAuthoring,
  );

  if (!context.ok) {
    return <ForbiddenAccess />;
  }

  return (
    <section>
      <h1 className="text-xl font-semibold">New order</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The order wizard arrives with the sales order feature phase.
      </p>
    </section>
  );
}
