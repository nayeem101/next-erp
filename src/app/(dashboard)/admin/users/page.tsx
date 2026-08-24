import { UsersTable } from "@/features/users/components/users-table";
import { listUsers } from "@/features/users/queries";
import { userListQuerySchema } from "@/features/users/schemas";
import { getActionContext } from "@/lib/auth/guards";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Users | NextERP",
};

export default async function AdminUsersPage() {
  const context = await getActionContext(["admin"]);

  if (!context.ok) {
    return null;
  }

  // The directory renders one server-fed page at a time; URL-driven
  // pagination and filters arrive with the shared DataTable infrastructure.
  const page = await listUsers(userListQuerySchema.parse({ pageSize: 50 }));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Assign application roles and manage console access for provisioned
          identities.
        </p>
      </header>

      <UsersTable page={page} currentUserId={context.user.id} />
    </div>
  );
}
