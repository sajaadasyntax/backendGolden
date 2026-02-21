import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure, validateBranchAccess } from "../trpc/trpc.js";

export const inventoryRouter = router({
  // ==================== CATEGORIES ====================
  categories: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return ctx.prisma.itemCategory.findMany({
        where: { isActive: true },
        include: { parent: true, _count: { select: { items: true } } },
        orderBy: { name: "asc" },
      });
    }),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(2),
          nameAr: z.string().min(2),
          parentId: z.string().uuid().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.itemCategory.create({ data: input });
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(2).optional(),
          nameAr: z.string().min(2).optional(),
          parentId: z.string().uuid().nullable().optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        return ctx.prisma.itemCategory.update({ where: { id }, data });
      }),
  }),

  // ==================== UNITS ====================
  units: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return ctx.prisma.unit.findMany({ orderBy: { name: "asc" } });
    }),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          nameAr: z.string().min(1),
          symbol: z.string().min(1).max(10),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.unit.create({ data: input });
      }),
  }),

  // ==================== ITEMS ====================
  items: router({
    list: protectedProcedure
      .input(
        z.object({
          categoryId: z.string().uuid().optional(),
          search: z.string().optional(),
          isActive: z.boolean().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(500).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { categoryId, search, isActive, page, pageSize } = input;

        const where = {
          ...(categoryId && { categoryId }),
          ...(isActive !== undefined && { isActive }),
          ...(search && {
            OR: [
              { nameEn: { contains: search, mode: "insensitive" as const } },
              { nameAr: { contains: search, mode: "insensitive" as const } },
              { sku: { contains: search, mode: "insensitive" as const } },
            ],
          }),
        };

        const [items, total] = await Promise.all([
          ctx.prisma.item.findMany({
            where,
            include: { category: true, unit: true },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          ctx.prisma.item.count({ where }),
        ]);

        return {
          data: items,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.item.findUnique({
          where: { id: input.id },
          include: {
            category: true,
            unit: true,
            pricePolicies: {
              where: {
                OR: [
                  { effectiveTo: null },
                  { effectiveTo: { gte: new Date() } },
                ],
              },
              orderBy: { effectiveFrom: "desc" },
            },
          },
        });

        if (!item) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
        }

        return item;
      }),

    create: adminProcedure
      .input(
        z.object({
          sku: z.string().min(2).max(50),
          nameEn: z.string().min(2),
          nameAr: z.string().min(2),
          description: z.string().optional(),
          categoryId: z.string().uuid(),
          unitId: z.string().uuid(),
          isConsignment: z.boolean().default(false),
          minStockLevel: z.number().nonnegative().optional(),
          maxStockLevel: z.number().nonnegative().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Check SKU uniqueness
        const existing = await ctx.prisma.item.findUnique({
          where: { sku: input.sku },
        });

        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "SKU already exists",
          });
        }

        return ctx.prisma.item.create({
          data: input,
          include: { category: true, unit: true },
        });
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          sku: z.string().min(2).max(50).optional(),
          nameEn: z.string().min(2).optional(),
          nameAr: z.string().min(2).optional(),
          description: z.string().optional(),
          categoryId: z.string().uuid().optional(),
          unitId: z.string().uuid().optional(),
          isConsignment: z.boolean().optional(),
          isActive: z.boolean().optional(),
          minStockLevel: z.number().nonnegative().nullable().optional(),
          maxStockLevel: z.number().nonnegative().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;

        const existing = await ctx.prisma.item.findUnique({ where: { id } });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
        }

        // Check SKU uniqueness if changing
        if (data.sku && data.sku !== existing.sku) {
          const skuExists = await ctx.prisma.item.findUnique({
            where: { sku: data.sku },
          });
          if (skuExists) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "SKU already exists",
            });
          }
        }

        return ctx.prisma.item.update({
          where: { id },
          data,
          include: { category: true, unit: true },
        });
      }),
  }),

  // ==================== PRICE POLICIES ====================
  pricePolicies: router({
    getForItem: protectedProcedure
      .input(
        z.object({
          itemId: z.string().uuid(),
          branchId: z.string().uuid(),
        })
      )
      .query(async ({ ctx, input }) => {
        // Validate branch access
        validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
        
        const policy = await ctx.prisma.pricePolicy.findFirst({
          where: {
            itemId: input.itemId,
            branchId: input.branchId,
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: new Date() } },
            ],
            effectiveFrom: { lte: new Date() },
          },
          orderBy: { effectiveFrom: "desc" },
        });

        if (!policy) {
          return null;
        }

        // Hide priceRangeMinUsd for non-admin users
        const isAdmin = ["ADMIN", "MANAGER"].includes(ctx.user?.role || "");
        
        return {
          ...policy,
          priceRangeMinUsd: isAdmin ? policy.priceRangeMinUsd : null,
        };
      }),

    list: adminProcedure
      .input(
        z.object({
          branchId: z.string().uuid(),
          itemId: z.string().uuid().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(500).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        // Validate branch access
        validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
        
        const { branchId, itemId, page, pageSize } = input;

        const where = {
          branchId,
          ...(itemId && { itemId }),
        };

        const [policies, total] = await Promise.all([
          ctx.prisma.pricePolicy.findMany({
            where,
            include: { item: true },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { effectiveFrom: "desc" },
          }),
          ctx.prisma.pricePolicy.count({ where }),
        ]);

        return {
          data: policies,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    create: adminProcedure
      .input(
        z.object({
          itemId: z.string().uuid(),
          branchId: z.string().uuid(),
          wholesalePriceUsd: z.number().nonnegative(),
          retailPriceUsd: z.number().nonnegative(),
          priceRangeMinUsd: z.number().nonnegative(),
          priceRangeMaxUsd: z.number().nonnegative(),
          effectiveFrom: z.coerce.date(),
          effectiveTo: z.coerce.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (input.priceRangeMinUsd > input.priceRangeMaxUsd) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Min price must be less than or equal to max price",
          });
        }

        return ctx.prisma.pricePolicy.create({
          data: input,
          include: { item: true },
        });
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          wholesalePriceUsd: z.number().nonnegative().optional(),
          retailPriceUsd: z.number().nonnegative().optional(),
          priceRangeMinUsd: z.number().nonnegative().optional(),
          priceRangeMaxUsd: z.number().nonnegative().optional(),
          effectiveTo: z.coerce.date().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        return ctx.prisma.pricePolicy.update({
          where: { id },
          data,
          include: { item: true },
        });
      }),
  }),

  // ==================== WAREHOUSES ====================
  warehouses: router({
    list: protectedProcedure
      .query(async ({ ctx }) => {
        return ctx.prisma.warehouse.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
        });
      }),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(2),
          nameAr: z.string().min(2),
          code: z.string().min(2).max(10),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.warehouse.create({ data: input });
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(2).optional(),
          nameAr: z.string().min(2).optional(),
          code: z.string().min(2).max(10).optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        return ctx.prisma.warehouse.update({ where: { id }, data });
      }),
  }),

  // ==================== SHELVES ====================
  shelves: router({
    list: protectedProcedure
      .query(async ({ ctx }) => {
        return ctx.prisma.shelf.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
        });
      }),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(2),
          nameAr: z.string().min(2),
          code: z.string().min(2).max(10),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.shelf.create({ data: input });
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(2).optional(),
          nameAr: z.string().min(2).optional(),
          code: z.string().min(2).max(10).optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        return ctx.prisma.shelf.update({ where: { id }, data });
      }),
  }),

  // ==================== STOCK ====================
  stock: router({
    getWarehouseStock: protectedProcedure
      .input(
        z.object({
          warehouseId: z.string().uuid(),
          categoryId: z.string().uuid().optional(),
          search: z.string().optional(),
          lowStock: z.boolean().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(500).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { warehouseId, categoryId, search, page, pageSize } = input;

        // Get aggregated stock by item
        const batches = await ctx.prisma.batch.groupBy({
          by: ["itemId"],
          where: {
            warehouseId,
            qtyRemaining: { gt: 0 },
          },
          _sum: { qtyRemaining: true },
          _count: true,
          _min: { receivedDate: true },
        });

        const itemIds = batches.map((b) => b.itemId);

        // Apply filters
        let whereItem: Record<string, unknown> = { id: { in: itemIds } };
        if (categoryId) whereItem.categoryId = categoryId;
        if (search) {
          whereItem.OR = [
            { nameEn: { contains: search, mode: "insensitive" } },
            { nameAr: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
          ];
        }

        const items = await ctx.prisma.item.findMany({
          where: whereItem,
          include: { category: true, unit: true },
          skip: (page - 1) * pageSize,
          take: pageSize,
        });

        const total = await ctx.prisma.item.count({ where: whereItem });

        // Map stock data
        const stockData = items.map((item) => {
          const batch = batches.find((b) => b.itemId === item.id);
          return {
            item,
            totalQty: batch?._sum.qtyRemaining || 0,
            batchCount: batch?._count || 0,
            oldestBatchDate: batch?._min.receivedDate,
          };
        });

        return {
          data: stockData,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    getShelfStock: protectedProcedure
      .input(
        z.object({
          shelfId: z.string().uuid(),
          categoryId: z.string().uuid().optional(),
          search: z.string().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(500).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { shelfId, categoryId, search, page, pageSize } = input;

        const batches = await ctx.prisma.batch.groupBy({
          by: ["itemId"],
          where: {
            shelfId,
            qtyRemaining: { gt: 0 },
          },
          _sum: { qtyRemaining: true },
          _count: true,
          _min: { receivedDate: true },
        });

        const itemIds = batches.map((b) => b.itemId);

        let whereItem: Record<string, unknown> = { id: { in: itemIds } };
        if (categoryId) whereItem.categoryId = categoryId;
        if (search) {
          whereItem.OR = [
            { nameEn: { contains: search, mode: "insensitive" } },
            { nameAr: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
          ];
        }

        const items = await ctx.prisma.item.findMany({
          where: whereItem,
          include: { category: true, unit: true },
          skip: (page - 1) * pageSize,
          take: pageSize,
        });

        const total = await ctx.prisma.item.count({ where: whereItem });

        const stockData = items.map((item) => {
          const batch = batches.find((b) => b.itemId === item.id);
          return {
            item,
            totalQty: batch?._sum.qtyRemaining || 0,
            batchCount: batch?._count || 0,
            oldestBatchDate: batch?._min.receivedDate,
          };
        });

        return {
          data: stockData,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    getBatches: protectedProcedure
      .input(
        z.object({
          itemId: z.string().uuid(),
          warehouseId: z.string().uuid().optional(),
          shelfId: z.string().uuid().optional(),
          includeEmpty: z.boolean().default(false),
        })
      )
      .query(async ({ ctx, input }) => {
        const { itemId, warehouseId, shelfId, includeEmpty } = input;

        return ctx.prisma.batch.findMany({
          where: {
            itemId,
            ...(warehouseId && { warehouseId }),
            ...(shelfId && { shelfId }),
            ...(!includeEmpty && { qtyRemaining: { gt: 0 } }),
          },
          include: {
            item: true,
            warehouse: true,
            shelf: true,
            consignor: true,
          },
          orderBy: { receivedDate: "asc" },
        });
      }),

    getMovements: protectedProcedure
      .input(
        z.object({
          batchId: z.string().uuid().optional(),
          itemId: z.string().uuid().optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(50),
        })
      )
      .query(async ({ ctx, input }) => {
        const { batchId, itemId, startDate, endDate, page, pageSize } = input;

        const where = {
          ...(batchId && { batchId }),
          ...(itemId && { batch: { itemId } }),
          ...(startDate && { createdAt: { gte: startDate } }),
          ...(endDate && { createdAt: { lte: endDate } }),
        };

        const [movements, total] = await Promise.all([
          ctx.prisma.stockMovement.findMany({
            where,
            include: { batch: { include: { item: true } } },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          ctx.prisma.stockMovement.count({ where }),
        ]);

        return {
          data: movements,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),
  }),
});

