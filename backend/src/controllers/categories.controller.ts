import type { Request, Response } from "express";

import {
  createGroupCategory,
  deleteGroupCategory,
  getGroupCategories,
  getSystemCategories,
  updateGroupCategory,
} from "../services/category.service";
import { validationError } from "../utils/http-error";
import { getTrimmedString, isRecord } from "../utils/request";

const readOptionalString = (
  body: Record<string, unknown>,
  field: string,
): string | null | undefined => {
  if (!(field in body)) return undefined;
  if (body[field] === null) return null;
  if (typeof body[field] !== "string") throw validationError({ [field]: "Must be a string or null" });
  return body[field].trim() || null;
};

export const listSystemCategoriesHandler = async (_req: Request, res: Response): Promise<void> => {
  res.json(await getSystemCategories());
};

export const listGroupCategoriesHandler = async (req: Request, res: Response): Promise<void> => {
  res.json(await getGroupCategories(req.params.groupId as string, req.auth!.user.id));
};

export const createGroupCategoryHandler = async (req: Request, res: Response): Promise<void> => {
  if (!isRecord(req.body)) throw validationError({ body: "Request body must be an object" });
  const name = getTrimmedString(req.body, "name");
  if (!name) throw validationError({ name: "Name is required" });
  res.status(201).json(
    await createGroupCategory(req.params.groupId as string, req.auth!.user.id, {
      name,
      icon: readOptionalString(req.body, "icon") ?? null,
      color: readOptionalString(req.body, "color") ?? null,
    }),
  );
};

export const updateGroupCategoryHandler = async (req: Request, res: Response): Promise<void> => {
  if (!isRecord(req.body)) throw validationError({ body: "Request body must be an object" });
  const input: { name?: string; icon?: string | null; color?: string | null } = {};
  if ("name" in req.body) {
    const name = getTrimmedString(req.body, "name");
    if (!name) throw validationError({ name: "Name must be a non-empty string" });
    input.name = name;
  }
  const icon = readOptionalString(req.body, "icon");
  const color = readOptionalString(req.body, "color");
  if (icon !== undefined) input.icon = icon;
  if (color !== undefined) input.color = color;
  res.json(await updateGroupCategory(req.params.groupId as string, req.auth!.user.id, req.params.categoryId as string, input));
};

export const deleteGroupCategoryHandler = async (req: Request, res: Response): Promise<void> => {
  await deleteGroupCategory(req.params.groupId as string, req.auth!.user.id, req.params.categoryId as string);
  res.status(204).send();
};
