import type { Request, Response } from "express";

import { GroupType, MemberRole } from "../entity/enums";
import {
  addMember,
  createGroupForUser,
  deleteGroup,
  getGroupDetail,
  listGroupsForUser,
  removeMember,
  updateGroup,
  updateMemberRole,
} from "../services/group.service";
import { validationError } from "../utils/http-error";
import { getTrimmedString, isRecord, normalizeEmail } from "../utils/request";

const parseGroupType = (value: unknown, fallback = GroupType.HOUSEHOLD): GroupType => {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === GroupType.HOUSEHOLD || value === GroupType.PERSONAL) return value;
  throw validationError({ type: "Type must be household or personal" });
};

const parseRole = (value: unknown, fallback = MemberRole.MEMBER): MemberRole => {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === MemberRole.ADMIN || value === MemberRole.MEMBER) return value;
  throw validationError({ role: "Role must be admin or member" });
};

export const createGroup = async (req: Request, res: Response): Promise<void> => {
  if (!isRecord(req.body)) throw validationError({ body: "Request body must be an object" });
  const name = getTrimmedString(req.body, "name");
  if (!name) throw validationError({ name: "Name is required" });

  res.status(201).json(
    await createGroupForUser(req.auth!.user.id, {
      name,
      description: getTrimmedString(req.body, "description") ?? null,
      type: parseGroupType(req.body.type),
    }),
  );
};

export const listGroups = async (req: Request, res: Response): Promise<void> => {
  const type =
    req.query.type === undefined ? undefined : parseGroupType(req.query.type, GroupType.HOUSEHOLD);
  res.json(await listGroupsForUser(req.auth!.user.id, type));
};

export const getGroup = async (req: Request, res: Response): Promise<void> => {
  res.json(await getGroupDetail(req.params.groupId as string, req.auth!.user.id));
};

export const updateGroupHandler = async (req: Request, res: Response): Promise<void> => {
  if (!isRecord(req.body)) throw validationError({ body: "Request body must be an object" });
  const input: { name?: string; description?: string | null } = {};
  if ("name" in req.body) {
    const name = getTrimmedString(req.body, "name");
    if (!name) throw validationError({ name: "Name must be a non-empty string" });
    input.name = name;
  }
  if ("description" in req.body) {
    input.description = req.body.description === null ? null : getTrimmedString(req.body, "description") ?? null;
  }
  res.json(await updateGroup(req.params.groupId as string, req.auth!.user.id, input));
};

export const deleteGroupHandler = async (req: Request, res: Response): Promise<void> => {
  await deleteGroup(req.params.groupId as string, req.auth!.user.id);
  res.status(204).send();
};

export const addMemberHandler = async (req: Request, res: Response): Promise<void> => {
  if (!isRecord(req.body)) throw validationError({ body: "Request body must be an object" });
  const email = getTrimmedString(req.body, "email");
  if (!email) throw validationError({ email: "Email is required" });
  res.json(
    await addMember(req.params.groupId as string, req.auth!.user.id, {
      email: normalizeEmail(email),
      role: parseRole(req.body.role),
    }),
  );
};

export const updateMemberRoleHandler = async (req: Request, res: Response): Promise<void> => {
  if (!isRecord(req.body)) throw validationError({ body: "Request body must be an object" });
  res.json(
    await updateMemberRole(
      req.params.groupId as string,
      req.auth!.user.id,
      req.params.userId as string,
      parseRole(req.body.role),
    ),
  );
};

export const removeMemberHandler = async (req: Request, res: Response): Promise<void> => {
  await removeMember(req.params.groupId as string, req.auth!.user.id, req.params.userId as string);
  res.status(204).send();
};
