import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { verifyToken, validateSession, type JWTPayload } from "../lib/auth.js";
import prisma from "../lib/prisma.js";

export interface Context {
  user: JWTPayload | null;
  prisma: typeof prisma;
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
}

export async function createContext({
  req,
  res,
}: CreateExpressContextOptions): Promise<Context> {
  let user: JWTPayload | null = null;

  // Extract token from Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = await verifyToken(token);

    if (payload) {
      // Validate session is still active
      const isValid = await validateSession(payload.sessionId);
      if (isValid) {
        user = payload;
      }
    }
  }

  return {
    user,
    prisma,
    req,
    res,
  };
}

export type { Context as TRPCContext };

