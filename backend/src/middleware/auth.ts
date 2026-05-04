import type { Request, RequestHandler } from "express";

import { User } from "../entity/User";
import { findUserById } from "../repositories/user.repository";
import { HttpError } from "../utils/http-error";
import { asyncHandler } from "../utils/async-handler";
import { isTokenRevoked, verifyAccessToken } from "../services/token-service";

const parseBearerToken = (authorizationHeader: string | undefined): string => {
  if (!authorizationHeader) {
    throw new HttpError(401, "Missing or invalid token", "UNAUTHORIZED");
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new HttpError(401, "Missing or invalid token", "UNAUTHORIZED");
  }

  return token;
};

export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token = parseBearerToken(req.header("Authorization"));
  const verifiedToken = verifyAccessToken(token);

  if (await isTokenRevoked(token)) {
    throw new HttpError(401, "Missing or invalid token", "UNAUTHORIZED");
  }

  const user = await findUserById(verifiedToken.userId);

  if (!user) {
    throw new HttpError(401, "Missing or invalid token", "UNAUTHORIZED");
  }

  req.auth = {
    user,
    token,
    tokenExpiresAt: verifiedToken.expiresAt,
  };

  next();
});

export const getAuthenticatedUser = (req: Request): User => {
  if (!req.auth) {
    throw new HttpError(401, "Missing or invalid token", "UNAUTHORIZED");
  }

  return req.auth.user;
};
