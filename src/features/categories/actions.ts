"use server";

import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";
import { invalidateTags } from "@/lib/cache/invalidate";
import { CACHE_TAGS } from "@/lib/cache/tags";
import {
  actionSuccess,
  type ActionResult,
  validationFailure,
} from "@/lib/errors/action-result";
import { mapActionError } from "@/lib/errors/map-action-error";

import { listCategories } from "./queries";
import {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesQuerySchema,
  type CategoryListPage,
  type CreateCategoryArgs,
  type CreateCategoryResult,
  type UpdateCategoryInput,
  type UpdateCategoryResult,
  type ListCategoriesQueryInput,
} from "./schemas";
import { createCategory, updateCategory } from "./service";

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

/** Admin/Inventory category creation with derived stable slug. */
export async function createCategoryAction(
  input: CreateCategoryArgs,
): Promise<ActionResult<CreateCategoryResult>> {
  const parsed = createCategorySchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.inventory);

  if (!context.ok) {
    return context;
  }

  try {
    const result = await createCategory(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(CACHE_TAGS.categories, CACHE_TAGS.auditLog);

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Inventory category update with diff-based audit. */
export async function updateCategoryAction(
  input: UpdateCategoryInput,
): Promise<ActionResult<UpdateCategoryResult>> {
  const parsed = updateCategorySchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.inventory);

  if (!context.ok) {
    return context;
  }

  try {
    const result = await updateCategory(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(CACHE_TAGS.categories, CACHE_TAGS.auditLog);

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}
