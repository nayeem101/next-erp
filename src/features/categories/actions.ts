"use server";

import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";
import {
  actionSuccess,
  type ActionResult,
  validationFailure,
} from "@/lib/errors/action-result";
import { mapActionError } from "@/lib/errors/map-action-error";

import { listCategories } from "./queries";
import {
  listCategoriesQuerySchema,
  type CategoryListPage,
  type ListCategoriesQueryInput,
} from "./schemas";

/**
 * Paginated category directory for the inventory grid. Admin and Inventory
 * roles per the module access matrix.
 */
export async function listCategoriesAction(
  input: ListCategoriesQueryInput,
): Promise<ActionResult<CategoryListPage>> {
  const parsed = listCategoriesQuerySchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.inventory);

  if (!context.ok) {
    return context;
  }

  try {
    const page = await listCategories(parsed.data);

    return actionSuccess(page);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}
