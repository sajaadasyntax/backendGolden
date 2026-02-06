import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure, validateBranchAccess } from "../trpc/trpc.js";
import { getOpenDayCycle, autoClosePreviousDayCycles } from "../lib/dayCycle.js";

export const dayCycleRouter = router({
  getCurrent: protectedProcedure
    .input(z.object({ branchId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Validate branch access
      validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
      
      // Auto-close previous day cycles before getting current
      await autoClosePreviousDayCycles(input.branchId);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const dayCycle = await ctx.prisma.dayCycle.findFirst({
        where: {
          branchId: input.branchId,
          cycleDate: today,
        },
        include: {
          branch: true,
          openedBy: { select: { id: true, name: true } },
          closedBy: { select: { id: true, name: true } },
        },
      });

      return dayCycle;
    }),

  getByDate: protectedProcedure
    .input(
      z.object({
        branchId: z.string().uuid(),
        date: z.coerce.date(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Validate branch access
      validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
      
      const dayCycle = await ctx.prisma.dayCycle.findFirst({
        where: {
          branchId: input.branchId,
          cycleDate: input.date,
        },
        include: {
          branch: true,
          openedBy: { select: { id: true, name: true } },
          closedBy: { select: { id: true, name: true } },
        },
      });

      return dayCycle;
    }),

  list: protectedProcedure
    .input(
      z.object({
        branchId: z.string().uuid(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      // Validate branch access
      validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
      
      const { branchId, startDate, endDate, page, pageSize } = input;

      const where = {
        branchId,
        ...(startDate && { cycleDate: { gte: startDate } }),
        ...(endDate && { cycleDate: { lte: endDate } }),
      };

      const [dayCycles, total] = await Promise.all([
        ctx.prisma.dayCycle.findMany({
          where,
          include: {
            openedBy: { select: { id: true, name: true } },
            closedBy: { select: { id: true, name: true } },
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { cycleDate: "desc" },
        }),
        ctx.prisma.dayCycle.count({ where }),
      ]);

      return {
        data: dayCycles,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }),

  open: adminProcedure
    .input(
      z.object({
        branchId: z.string().uuid(),
        exchangeRateUsdSdg: z.number().positive(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Validate branch access (admin/manager already checked by adminProcedure)
      validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Check if day cycle already exists for today
      const existing = await ctx.prisma.dayCycle.findFirst({
        where: {
          branchId: input.branchId,
          cycleDate: today,
        },
      });

      if (existing) {
        if (existing.status === "OPEN") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Day is already open for this branch",
          });
        } else {
          // Day exists but is closed - user should use reopen instead
          throw new TRPCError({
            code: "CONFLICT",
            message: "Day was already opened and closed. Use reopen to open it again.",
          });
        }
      }

      const dayCycle = await ctx.prisma.dayCycle.create({
        data: {
          branchId: input.branchId,
          cycleDate: today,
          exchangeRateUsdSdg: input.exchangeRateUsdSdg,
          status: "OPEN",
          openedById: ctx.user.userId,
          notes: input.notes,
        },
        include: {
          branch: true,
          openedBy: { select: { id: true, name: true } },
        },
      });

      // Audit log
      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.userId,
          branchId: input.branchId,
          action: "OPEN_DAY",
          entityType: "DayCycle",
          entityId: dayCycle.id,
          newData: {
            exchangeRate: input.exchangeRateUsdSdg,
            date: today.toISOString(),
          },
        },
      });

      return dayCycle;
    }),

  updateExchangeRate: adminProcedure
    .input(
      z.object({
        dayCycleId: z.string().uuid(),
        exchangeRateUsdSdg: z.number().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const dayCycle = await ctx.prisma.dayCycle.findUnique({
        where: { id: input.dayCycleId },
      });

      if (!dayCycle) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Day cycle not found",
        });
      }

      if (dayCycle.status !== "OPEN") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only update exchange rate for open day",
        });
      }

      const oldRate = dayCycle.exchangeRateUsdSdg;

      const updated = await ctx.prisma.dayCycle.update({
        where: { id: input.dayCycleId },
        data: { exchangeRateUsdSdg: input.exchangeRateUsdSdg },
      });

      // Audit log
      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.userId,
          branchId: dayCycle.branchId,
          action: "UPDATE",
          entityType: "DayCycle",
          entityId: input.dayCycleId,
          oldData: { exchangeRate: oldRate.toString() },
          newData: { exchangeRate: input.exchangeRateUsdSdg },
        },
      });

      return updated;
    }),

  getPendingItems: adminProcedure
    .input(z.object({ dayCycleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const dayCycle = await ctx.prisma.dayCycle.findUnique({
        where: { id: input.dayCycleId },
      });

      if (!dayCycle) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Day cycle not found",
        });
      }

      // Get counts of pending items
      const [draftSalesOrders, draftInvoices, draftRequests, unpostedJournals] =
        await Promise.all([
          ctx.prisma.salesOrder.count({
            where: { dayCycleId: input.dayCycleId, status: "DRAFT" },
          }),
          ctx.prisma.salesInvoice.count({
            where: { dayCycleId: input.dayCycleId, status: "DRAFT" },
          }),
          ctx.prisma.goodsRequest.count({
            where: {
              shelf: { user: { branchId: dayCycle.branchId } },
              status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] },
            },
          }),
          ctx.prisma.journalEntry.count({
            where: { dayCycleId: input.dayCycleId, isPosted: false },
          }),
        ]);

      return {
        draftSalesOrders,
        draftInvoices,
        draftRequests,
        unpostedJournals,
        total: draftSalesOrders + draftInvoices + draftRequests + unpostedJournals,
      };
    }),

  close: adminProcedure
    .input(
      z.object({
        dayCycleId: z.string().uuid(),
        force: z.boolean().default(false),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const dayCycle = await ctx.prisma.dayCycle.findUnique({
        where: { id: input.dayCycleId },
      });

      if (!dayCycle) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Day cycle not found",
        });
      }

      if (dayCycle.status === "CLOSED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Day is already closed",
        });
      }

      // Check for pending items unless force is true
      if (!input.force) {
        const pendingCount = await ctx.prisma.salesOrder.count({
          where: { dayCycleId: input.dayCycleId, status: "DRAFT" },
        });

        if (pendingCount > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot close day with ${pendingCount} pending items. Use force to override.`,
          });
        }
      }

      const updated = await ctx.prisma.dayCycle.update({
        where: { id: input.dayCycleId },
        data: {
          status: "CLOSED",
          closedById: ctx.user.userId,
          closedAt: new Date(),
          notes: input.notes
            ? dayCycle.notes
              ? `${dayCycle.notes}\n${input.notes}`
              : input.notes
            : dayCycle.notes,
        },
        include: {
          branch: true,
          openedBy: { select: { id: true, name: true } },
          closedBy: { select: { id: true, name: true } },
        },
      });

      // Audit log
      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.userId,
          branchId: dayCycle.branchId,
          action: "CLOSE_DAY",
          entityType: "DayCycle",
          entityId: input.dayCycleId,
          newData: { closedAt: new Date().toISOString() },
        },
      });

      return updated;
    }),

  reopen: adminProcedure
    .input(
      z.object({
        dayCycleId: z.string().uuid(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const dayCycle = await ctx.prisma.dayCycle.findUnique({
        where: { id: input.dayCycleId },
      });

      if (!dayCycle) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Day cycle not found",
        });
      }

      if (dayCycle.status !== "CLOSED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only reopen a closed day",
        });
      }

      const updated = await ctx.prisma.dayCycle.update({
        where: { id: input.dayCycleId },
        data: {
          status: "OPEN",
          closedById: null,
          closedAt: null,
          notes: input.notes
            ? `${dayCycle.notes || ""}\nReopened: ${input.notes}`
            : dayCycle.notes,
        },
      });

      // Audit log
      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.userId,
          branchId: dayCycle.branchId,
          action: "UPDATE",
          entityType: "DayCycle",
          entityId: input.dayCycleId,
          newData: { reopened: true, notes: input.notes },
        },
      });

      return updated;
    }),
});

