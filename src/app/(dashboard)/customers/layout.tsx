import { ForbiddenAccess } from "@/components/shared/forbidden-access";
import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";

export default async function CustomersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.customers);

  if (!context.ok) {
    return <ForbiddenAccess />;
  }

  return <>{children}</>;
}
