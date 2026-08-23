import { ForbiddenAccess } from "@/components/shared/forbidden-access";
import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";

export default async function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.orders);

  if (!context.ok) {
    return <ForbiddenAccess />;
  }

  return <>{children}</>;
}
