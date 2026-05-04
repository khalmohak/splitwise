import type { Request, Response } from "express";

import {
  changePassword,
  loginUser,
  logoutUser,
  registerUser,
} from "../services/auth.service";
import { HttpError, validationError } from "../utils/http-error";
import { getTrimmedString, isRecord, normalizeEmail } from "../utils/request";

const validateEmail = (email: string | undefined): string | undefined => {
  if (!email) {
    return undefined;
  }

  const normalizedEmail = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ? normalizedEmail
    : undefined;
};

const validatePassword = (password: unknown): string | undefined =>
  typeof password === "string" && password.length >= 8 ? password : undefined;

export const register = async (req: Request, res: Response): Promise<void> => {
  if (!isRecord(req.body)) {
    throw validationError({ body: "Request body must be an object" });
  }

  const name = getTrimmedString(req.body, "name");
  const email = validateEmail(getTrimmedString(req.body, "email"));
  const password = validatePassword(req.body.password);
  const details: Record<string, string> = {};

  if (!name) {
    details.name = "Name is required";
  }

  if (!email) {
    details.email = "Valid email is required";
  }

  if (!password) {
    details.password = "Password must be at least 8 characters";
  }

  if (!name || !email || !password) {
    throw validationError(details);
  }

  const response = await registerUser({ name, email, password });
  res.status(201).json(response);
};

export const login = async (req: Request, res: Response): Promise<void> => {
  if (!isRecord(req.body)) {
    throw validationError({ body: "Request body must be an object" });
  }

  const email = validateEmail(getTrimmedString(req.body, "email"));
  const password =
    typeof req.body.password === "string" ? req.body.password : undefined;

  if (!email || !password) {
    throw new HttpError(401, "Wrong email or password", "INVALID_CREDENTIALS");
  }

  res.json(await loginUser({ email, password }));
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  await logoutUser(req.auth!.token, req.auth!.tokenExpiresAt);
  res.status(204).send();
};

export const updatePassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!isRecord(req.body)) {
    throw validationError({ body: "Request body must be an object" });
  }

  const currentPassword =
    typeof req.body.currentPassword === "string"
      ? req.body.currentPassword
      : undefined;
  const newPassword = validatePassword(req.body.newPassword);
  const details: Record<string, string> = {};

  if (!currentPassword) {
    details.currentPassword = "Current password is required";
  }

  if (!newPassword) {
    details.newPassword = "New password must be at least 8 characters";
  }

  if (!currentPassword || !newPassword) {
    throw validationError(details);
  }

  await changePassword(req.auth!.user, currentPassword, newPassword);
  res.status(204).send();
};
