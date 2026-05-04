import type { Request, Response } from "express";

import { getGroupDashboard, getUserDashboard } from "../services/analytics.service";

export const userDashboardHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(await getUserDashboard(req.auth!.user.id));
};

export const groupDashboardHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(await getGroupDashboard(req.params.groupId as string, req.auth!.user.id));
};
