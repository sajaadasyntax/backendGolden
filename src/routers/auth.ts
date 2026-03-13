import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../trpc/trpc.js";
import {
  hashPassword,
  verifyPassword,
  createSession,
  invalidateSession,
} from "../lib/auth.js";

export const authRouter = router({
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(4),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { email: input.email },
        include: { branch: true, shelf: { where: { isActive: true } } },
      });

      if (!user || !user.isActive) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password",
        });
      }

      const isValid = await verifyPassword(input.password, user.passwordHash);
      if (!isValid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password",
        });
      }

      const ipAddress = ctx.req.ip || ctx.req.socket.remoteAddress;
      const userAgent = ctx.req.headers["user-agent"];

      const { token, expiresAt } = await createSession(
        user.id,
        ipAddress,
        userAgent
      );

      // Create audit log
      if (user.branchId) {
        await ctx.prisma.auditLog.create({
          data: {
            userId: user.id,
            branchId: user.branchId,
            action: "LOGIN",
            entityType: "User",
            entityId: user.id,
          },
        });
      }

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          nameAr: user.nameAr,
          role: user.role,
          branchId: user.branchId,
          branch: user.branch,
          shelf: user.shelf && user.shelf.length > 0 ? user.shelf[0] : null,
        },
        token,
        expiresAt,
      };
    }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    await invalidateSession(ctx.user.sessionId);

    // Create audit log
    if (ctx.user.branchId) {
      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.userId,
          branchId: ctx.user.branchId,
          action: "LOGOUT",
          entityType: "User",
          entityId: ctx.user.userId,
        },
      });
    }

    return { success: true };
  }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.userId },
      include: { branch: true, shelf: { where: { isActive: true } } },
    });

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    // Return wrapped in { user } to match mobile expectations
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nameAr: user.nameAr,
        role: user.role,
        branchId: user.branchId,
        branch: user.branch,
        lastLoginAt: user.lastLoginAt,
        shelf: user.shelf && user.shelf.length > 0 ? user.shelf[0] : null,
      },
    };
  }),

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(6),
        newPassword: z.string().min(6),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.userId },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const isValid = await verifyPassword(
        input.currentPassword,
        user.passwordHash
      );
      if (!isValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Current password is incorrect",
        });
      }

      const newHash = await hashPassword(input.newPassword);
      await ctx.prisma.user.update({
        where: { id: ctx.user.userId },
        data: { passwordHash: newHash },
      });

      return { success: true };
    }),

  sessions: protectedProcedure.query(async ({ ctx }) => {
    const sessions = await ctx.prisma.session.findMany({
      where: {
        userId: ctx.user.userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    return sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      isCurrent: s.id === ctx.user.sessionId,
    }));
  }),

  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.findUnique({
        where: { id: input.sessionId },
      });

      if (!session || session.userId !== ctx.user.userId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      await invalidateSession(input.sessionId);
      return { success: true };
    }),
});

