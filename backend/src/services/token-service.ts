import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import { env } from "../config/env";
import {
  findActiveRevokedTokenByHash,
  upsertRevokedToken,
} from "../repositories/revoked-token.repository";
import { HttpError } from "../utils/http-error";

type AccessTokenPayload = jwt.JwtPayload & {
  sub: string;
};

export type VerifiedAccessToken = {
  userId: string;
  expiresAt: Date | null;
};

const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

export const signAccessToken = (userId: string): string =>
  jwt.sign(
    {},
    env.jwtSecret,
    {
      subject: userId,
      expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"],
    },
  );

export const verifyAccessToken = (token: string): VerifiedAccessToken => {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as AccessTokenPayload;

    if (!decoded.sub) {
      throw new HttpError(401, "Missing or invalid token", "UNAUTHORIZED");
    }

    return {
      userId: decoded.sub,
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : null,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(401, "Missing or invalid token", "UNAUTHORIZED");
  }
};

export const isTokenRevoked = async (token: string): Promise<boolean> => {
  const tokenHash = hashToken(token);
  const revokedToken = await findActiveRevokedTokenByHash(tokenHash);

  return Boolean(revokedToken);
};

export const revokeToken = async (
  token: string,
  expiresAt: Date | null,
): Promise<void> => {
  const tokenHash = hashToken(token);
  const fallbackExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await upsertRevokedToken(tokenHash, expiresAt ?? fallbackExpiry);
};
