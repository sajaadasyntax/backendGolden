import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../trpc/trpc.js";

export const branchRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const branches = await ctx.prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    return branches;
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const branch = await ctx.prisma.branch.findUnique({
        where: { id: input.id },
        include: {
          warehouses: { where: { isActive: true } },
          shelves: { where: { isActive: true } },
          _count: {
            select: {
              users: true,
              purchaseOrders: true,
              salesOrders: true,
            },
          },
        },
      });

      if (!branch) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Branch not found",
        });
      }

      return branch;
    }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(2),
        nameAr: z.string().min(2),
        code: z.string().min(2).max(10),
        address: z.string().optional(),
        phone: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if code already exists
      const existing = await ctx.prisma.branch.findUnique({
        where: { code: input.code },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Branch code already exists",
        });
      }

      // Extract username from email (part before @)
      const username = ctx.user.email.split('@')[0];

      const branch = await ctx.prisma.branch.create({
        data: {
          ...input,
          name: username,
          nameAr: username,
        },
      });

      // Audit log
      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.userId,
          branchId: branch.id,
          action: "CREATE",
          entityType: "Branch",
          entityId: branch.id,
          newData: input as object,
        },
      });

      return branch;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(2).optional(),
        nameAr: z.string().min(2).optional(),
        code: z.string().min(2).max(10).optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const existing = await ctx.prisma.branch.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Branch not found",
        });
      }

      // Check code uniqueness if changing
      if (data.code && data.code !== existing.code) {
        const codeExists = await ctx.prisma.branch.findUnique({
          where: { code: data.code },
        });
        if (codeExists) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Branch code already exists",
          });
        }
      }

      const branch = await ctx.prisma.branch.update({
        where: { id },
        data,
      });

      // Audit log
      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.userId,
          branchId: id,
          action: "UPDATE",
          entityType: "Branch",
          entityId: id,
          oldData: existing as object,
          newData: branch as object,
        },
      });

      return branch;
    }),
});

