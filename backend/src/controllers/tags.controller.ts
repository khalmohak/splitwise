import type { Request, Response } from "express";

import {
  createGroupTag,
  deleteGroupTag,
  getGroupTags,
  updateGroupTag,
} from "../services/tag.service";
import { validationError } from "../utils/http-error";
import { getTrimmedString, isRecord } from "../utils/request";

const readColor = (body: Record<string, unknown>): string | null | undefined => {
  if (!("color" in body)) return undefined;
  if (body.color === null) return null;
  if (typeof body.color !== "string") throw validationError({ color: "Color must be a string or null" });
  return body.color.trim() || null;
};

export const listGroupTagsHandler = async (req: Request, res: Response): Promise<void> => {
  res.json(await getGroupTags(req.params.groupId as string, req.auth!.user.id));
};

export const createGroupTagHandler = async (req: Request, res: Response): Promise<void> => {
  if (!isRecord(req.body)) throw validationError({ body: "Request body must be an object" });
  const name = getTrimmedString(req.body, "name");
  if (!name) throw validationError({ name: "Name is required" });
  res.status(201).json(
    await createGroupTag(req.params.groupId as string, req.auth!.user.id, {
      name,
      color: readColor(req.body) ?? null,
    }),
  );
};

export const updateGroupTagHandler = async (req: Request, res: Response): Promise<void> => {
  if (!isRecord(req.body)) throw validationError({ body: "Request body must be an object" });
  const input: { name?: string; color?: string | null } = {};
  if ("name" in req.body) {
    const name = getTrimmedString(req.body, "name");
    if (!name) throw validationError({ name: "Name must be a non-empty string" });
    input.name = name;
  }
  const color = readColor(req.body);
  if (color !== undefined) input.color = color;
  res.json(await updateGroupTag(req.params.groupId as string, req.auth!.user.id, req.params.tagId as string, input));
};

export const deleteGroupTagHandler = async (req: Request, res: Response): Promise<void> => {
  await deleteGroupTag(req.params.groupId as string, req.auth!.user.id, req.params.tagId as string);
  res.status(204).send();
};
