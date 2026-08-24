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
  setUserActiveSchema,
  setUserRolesSchema,
  userListQuerySchema,
  type SetUserActiveInput,
  type SetUserActiveResult,
  type SetUserRolesInput,
  type SetUserRolesResult,
  type UserListPage,
  type UserListQuery,
} from "./schemas";
import { setUserActive, setUserRoles } from "./service";

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

/** Admin-only role replacement with last-active-Admin protection. */
export async function setUserRolesAction(
  input: SetUserRolesInput,
): Promise<ActionResult<SetUserRolesResult>> {
  const parsed = setUserRolesSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(["admin"]);

  if (!context.ok) {
    return context;
  }

  try {
    const result = await setUserRoles(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin-only enable/disable with last-active-Admin protection. */
export async function setUserActiveAction(
  input: SetUserActiveInput,
): Promise<ActionResult<SetUserActiveResult>> {
  const parsed = setUserActiveSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(["admin"]);

  if (!context.ok) {
    return context;
  }

  try {
    const result = await setUserActive(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}
