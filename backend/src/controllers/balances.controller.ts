import type { Request, Response } from "express";

import {
  getGroupBalances,
  getMyGroupBalances,
  getSimplifiedGroupBalances,
} from "../services/balance.service";

export const getGroupBalancesHandler = async (req: Request, res: Response): Promise<void> => {
  res.json(await getGroupBalances(req.params.groupId as string, req.auth!.user.id));
};

export const getSimplifiedGroupBalancesHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(await getSimplifiedGroupBalances(req.params.groupId as string, req.auth!.user.id));
};

export const getMyGroupBalancesHandler = async (req: Request, res: Response): Promise<void> => {
  res.json(await getMyGroupBalances(req.params.groupId as string, req.auth!.user.id));
};
