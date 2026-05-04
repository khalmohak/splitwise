import type { User } from "../entity/User";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: User;
        token: string;
        tokenExpiresAt: Date | null;
      };
    }
  }
}

export {};
