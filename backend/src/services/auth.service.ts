import { compare, hash } from "bcrypt";

import type { User } from "../entity/User";
import {
  createUser,
  findUserByEmail,
  saveUser,
} from "../repositories/user.repository";
import { signAccessToken, revokeToken } from "./token-service";
import { toAuthUserResponse, type AuthUserResponse } from "./user-presenter";
import { HttpError } from "../utils/http-error";
import { sendEmailSafely } from "./email.service";
import { passwordChangedEmail, welcomeEmail } from "./email-templates";

const passwordHashRounds = 12;

export type AuthResponse = {
  token: string;
  user: AuthUserResponse;
};

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export const registerUser = async (input: RegisterInput): Promise<AuthResponse> => {
  const existingUser = await findUserByEmail(input.email);

  if (existingUser) {
    throw new HttpError(409, "Email already registered", "CONFLICT");
  }

  const user = await createUser({
    name: input.name,
    email: input.email,
    passwordHash: await hash(input.password, passwordHashRounds),
    avatarUrl: null,
  });

  sendEmailSafely({
    to: user.email,
    ...welcomeEmail({ name: user.name }),
  });

  return {
    token: signAccessToken(user.id),
    user: toAuthUserResponse(user),
  };
};

export const loginUser = async (input: LoginInput): Promise<AuthResponse> => {
  const user = await findUserByEmail(input.email);

  if (!user || !(await compare(input.password, user.passwordHash))) {
    throw new HttpError(401, "Wrong email or password", "INVALID_CREDENTIALS");
  }

  return {
    token: signAccessToken(user.id),
    user: toAuthUserResponse(user),
  };
};

export const logoutUser = async (
  token: string,
  tokenExpiresAt: Date | null,
): Promise<void> => {
  await revokeToken(token, tokenExpiresAt);
};

export const changePassword = async (
  user: User,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  if (!(await compare(currentPassword, user.passwordHash))) {
    throw new HttpError(401, "Current password is wrong", "INVALID_CREDENTIALS");
  }

  user.passwordHash = await hash(newPassword, passwordHashRounds);
  await saveUser(user);

  sendEmailSafely({
    to: user.email,
    ...passwordChangedEmail({ name: user.name }),
  });
};
