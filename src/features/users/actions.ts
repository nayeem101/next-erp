"use server";

import { getActionContext } from "@/lib/auth/guards";
import {
  actionSuccess,
  type ActionResult,
  validationFailure,
} from "@/lib/errors/action-result";
import { mapActionError } from "@/lib/errors/map-action-error";

import { listUsers } from "./queries";
import {
  userListQuerySchema,
  type UserListPage,
  type UserListQuery,
} from "./schemas";

/** Admin-only paginated user directory backing the Users grid. */
export async function listUsersAction(
  input: UserListQuery,
): Promise<ActionResult<UserListPage>> {
  const parsed = userListQuerySchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(["admin"]);

  if (!context.ok) {
    return context;
  }

  try {
    const page = await listUsers(parsed.data);

    return actionSuccess(page);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}
