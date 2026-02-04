import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import prisma from "./prisma.js";

// SECURITY WARNING: JWT_SECRET must be set in production environment!
const rawSecret = process.env.JWT_SECRET;
if (!rawSecret) {
  console.warn('\x1b[33m⚠️  WARNING: JWT_SECRET environment variable is not set!\x1b[0m');
  console.warn('\x1b[33m   This is a critical security issue in production.\x1b[0m');
  console.warn('\x1b[33m   Set JWT_SECRET in your .env file or environment variables.\x1b[0m');
}
const JWT_SECRET = new TextEncoder().encode(
  rawSecret || "dev-only-secret-DO-NOT-USE-IN-PRODUCTION"
);

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  branchId: string;
  sessionId: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export async function createToken(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export async function createSession(
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ token: string; expiresAt: Date }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { branch: true },
  });

  if (!user) {
    throw new Error("User not found");
  }

  // Calculate expiration
  const expiresAt = new Date();
  const match = JWT_EXPIRES_IN.match(/^(\d+)([dhms])$/);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case "d":
        expiresAt.setDate(expiresAt.getDate() + value);
        break;
      case "h":
        expiresAt.setHours(expiresAt.getHours() + value);
        break;
      case "m":
        expiresAt.setMinutes(expiresAt.getMinutes() + value);
        break;
      case "s":
        expiresAt.setSeconds(expiresAt.getSeconds() + value);
        break;
    }
  } else {
    expiresAt.setDate(expiresAt.getDate() + 7); // Default 7 days
  }

  // Create session record
  const session = await prisma.session.create({
    data: {
      userId,
      token: crypto.randomUUID(),
      expiresAt,
      ipAddress,
      userAgent,
    },
  });

  // Create JWT token
  const token = await createToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    branchId: user.branchId,
    sessionId: session.id,
  });

  // Update last login
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });

  return { token, expiresAt };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await prisma.session.delete({
    where: { id: sessionId },
  }).catch(() => {
    // Session might already be deleted
  });
}

export async function validateSession(sessionId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session) return false;
  if (session.expiresAt < new Date()) {
    await invalidateSession(sessionId);
    return false;
  }

  return true;
}

export async function cleanupExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}

