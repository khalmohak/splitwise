import type { Request, Response } from "express";

import {
  getPeople,
  getPersonDetail,
  settleWithPerson,
} from "../services/people.service";

export const listPeopleHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(await getPeople(req.auth!.user.id));
};

export const getPersonDetailHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(await getPersonDetail(req.auth!.user.id, req.params.userId as string));
};

export const settleWithPersonHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.status(201).json(await settleWithPerson(req.auth!.user.id, req.params.userId as string));
};
