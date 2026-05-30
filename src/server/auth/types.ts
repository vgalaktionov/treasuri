export type AuthUser = {
  email: string;
  groups: readonly string[];
  name: string;
  sub: string;
};

declare module "express-session" {
  interface SessionData {
    authUser?: AuthUser;
  }
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}
