import { ForbiddenAccess } from "@/components/shared/forbidden-access";
import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";

export default async function EditOrderPage() {
  const context = await getActionContext(
    MODULE_ROLE_REQUIREMENTS.orderAuthoring,
  );

  if (!context.ok) {
    return <ForbiddenAccess />;
  }

  return (
    <section>
      <h1 className="text-xl font-semibold">Edit draft order</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Draft editing arrives with the sales order feature phase.
      </p>
    </section>
  );
}
