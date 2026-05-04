import type { User } from "../entity/User";

export type AuthUserResponse = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
};

export type UserProfileResponse = AuthUserResponse & {
  updatedAt: string;
};

export const toAuthUserResponse = (user: User): AuthUserResponse => ({
  id: user.id,
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl,
  createdAt: user.createdAt.toISOString(),
});

export const toUserProfileResponse = (user: User): UserProfileResponse => ({
  ...toAuthUserResponse(user),
  updatedAt: user.updatedAt.toISOString(),
});
