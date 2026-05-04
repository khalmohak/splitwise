import type { Request, Response } from "express";

import { getGroupActivity, getUserActivity } from "../services/activity.service";
import { parsePagination } from "../utils/pagination";

export const groupActivityHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupActivity(
      req.params.groupId as string,
      req.auth!.user.id,
      parsePagination(req.query),
    ),
  );
};

export const userActivityHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getUserActivity(
      req.auth!.user.id,
      parsePagination(req.query),
      typeof req.query.groupId === "string" ? req.query.groupId : undefined,
    ),
  );
};
