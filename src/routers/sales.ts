import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Decimal } from "@prisma/client/runtime/library";
import {
  router,
  protectedProcedure,
  warehouseSalesProcedure,
  shelfSalesProcedure,
  adminProcedure,
} from "../trpc/trpc.js";
import { getOpenDayCycle } from "../lib/dayCycle.js";

export const salesRouter = router({
  // ==================== CUSTOMERS ====================
  customers: router({
    list: protectedProcedure
      .input(
        z.object({
          search: z.string().optional(),
          customerType: z.enum(["WHOLESALE", "RETAIL"]).optional(),
          isActive: z.boolean().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { search, customerType, isActive, page, pageSize } = input;

        const where = {
          ...(customerType && { customerType }),
          ...(isActive !== undefined && { isActive }),
          ...(search && {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { nameAr: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
            ],
          }),
        };

        const [customers, total] = await Promise.all([
          ctx.prisma.customer.findMany({
            where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { name: "asc" },
          }),
          ctx.prisma.customer.count({ where }),
        ]);

        return {
          data: customers,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const customer = await ctx.prisma.customer.findUnique({
          where: { id: input.id },
          include: {
            _count: {
              select: { salesOrders: true, salesInvoices: true },
            },
          },
        });

        if (!customer) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Customer not found",
          });
        }

        return customer;
      }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(2),
          nameAr: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional().or(z.literal("")),
          address: z.string().optional(),
          customerType: z.enum(["WHOLESALE", "RETAIL"]),
          creditLimitSdg: z.number().nonnegative().default(0),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const data = { ...input, email: input.email || null };
        return ctx.prisma.customer.create({ data });
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(2).optional(),
          nameAr: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional().or(z.literal("")),
          address: z.string().optional(),
          customerType: z.enum(["WHOLESALE", "RETAIL"]).optional(),
          creditLimitSdg: z.number().nonnegative().optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const updateData = { ...data, email: data.email || null };
        return ctx.prisma.customer.update({ where: { id }, data: updateData });
      }),
  }),

  // ==================== SALES ORDERS (Warehouse) ====================
  salesOrders: router({
    list: warehouseSalesProcedure
      .input(
        z.object({
          branchId: z.string().uuid(),
          customerId: z.string().uuid().optional(),
          status: z
            .enum([
              "DRAFT",
              "CONFIRMED",
              "PARTIALLY_DELIVERED",
              "FULLY_DELIVERED",
              "INVOICED",
              "CANCELLED",
            ])
            .optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { branchId, customerId, status, startDate, endDate, page, pageSize } =
          input;

        const where = {
          branchId,
          ...(customerId && { customerId }),
          ...(status && { status }),
          ...(startDate && { orderDate: { gte: startDate } }),
          ...(endDate && { orderDate: { lte: endDate } }),
        };

        const [orders, total] = await Promise.all([
          ctx.prisma.salesOrder.findMany({
            where,
            include: {
              customer: true,
              warehouse: true,
              createdBy: { select: { id: true, name: true } },
              _count: { select: { lines: true } },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          ctx.prisma.salesOrder.count({ where }),
        ]);

        return {
          data: orders,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    getById: warehouseSalesProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const order = await ctx.prisma.salesOrder.findUnique({
          where: { id: input.id },
          include: {
            customer: true,
            branch: true,
            warehouse: true,
            dayCycle: true,
            createdBy: { select: { id: true, name: true } },
            lines: { include: { item: { include: { unit: true } } } },
          },
        });

        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sales order not found",
          });
        }

        return order;
      }),

    create: warehouseSalesProcedure
      .input(
        z.object({
          customerId: z.string().uuid(),
          warehouseId: z.string().uuid(),
          notes: z.string().optional(),
          lines: z
            .array(
              z.object({
                itemId: z.string().uuid(),
                qty: z.number().positive(),
                unitPriceUsd: z.number().nonnegative(),
              })
            )
            .min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Get warehouse to find branch
        const warehouse = await ctx.prisma.warehouse.findUnique({
          where: { id: input.warehouseId },
        });

        if (!warehouse) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Warehouse not found",
          });
        }

        // Get open day cycle (auto-closes previous days)
        const dayCycle = await getOpenDayCycle(warehouse.branchId);

        if (!dayCycle) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Day must be open to create sales orders",
          });
        }

        const exchangeRate = Number(dayCycle.exchangeRateUsdSdg);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Generate SO number
        const count = await ctx.prisma.salesOrder.count({
          where: { branchId: warehouse.branchId },
        });
        const soNumber = `SO-${String(count + 1).padStart(6, "0")}`;

        // Calculate totals
        const totalUsd = input.lines.reduce(
          (sum, line) => sum + line.qty * line.unitPriceUsd,
          0
        );
        const totalSdg = totalUsd * exchangeRate;

        const order = await ctx.prisma.salesOrder.create({
          data: {
            soNumber,
            customerId: input.customerId,
            branchId: warehouse.branchId,
            warehouseId: input.warehouseId,
            dayCycleId: dayCycle.id,
            orderDate: today,
            totalUsd,
            totalSdg,
            notes: input.notes,
            createdById: ctx.user.userId,
            lines: {
              create: input.lines.map((line) => ({
                itemId: line.itemId,
                qty: line.qty,
                unitPriceUsd: line.unitPriceUsd,
                unitPriceSdg: line.unitPriceUsd * exchangeRate,
                totalUsd: line.qty * line.unitPriceUsd,
                totalSdg: line.qty * line.unitPriceUsd * exchangeRate,
              })),
            },
          },
          include: {
            customer: true,
            lines: { include: { item: true } },
          },
        });

        return order;
      }),

    confirm: warehouseSalesProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.salesOrder.findUnique({
          where: { id: input.id },
          include: { lines: true, dayCycle: true },
        });

        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sales order not found",
          });
        }

        if (order.status !== "DRAFT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Can only confirm draft orders",
          });
        }

        // Check stock availability
        for (const line of order.lines) {
          const available = await ctx.prisma.batch.aggregate({
            where: {
              itemId: line.itemId,
              warehouseId: order.warehouseId,
              qtyRemaining: { gt: 0 },
            },
            _sum: { qtyRemaining: true },
          });

          if (
            !available._sum.qtyRemaining ||
            Number(available._sum.qtyRemaining) < Number(line.qty)
          ) {
            const item = await ctx.prisma.item.findUnique({
              where: { id: line.itemId },
            });
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Insufficient stock for ${item?.nameEn || line.itemId}`,
            });
          }
        }

        return ctx.prisma.salesOrder.update({
          where: { id: input.id },
          data: { status: "CONFIRMED" },
        });
      }),

    deliver: warehouseSalesProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          lines: z
            .array(
              z.object({
                lineId: z.string().uuid(),
                qtyDelivered: z.number().positive(),
              })
            )
            .min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.salesOrder.findUnique({
          where: { id: input.orderId },
          include: { lines: true, dayCycle: true },
        });

        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sales order not found",
          });
        }

        if (!["CONFIRMED", "PARTIALLY_DELIVERED"].includes(order.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Order must be confirmed to deliver",
          });
        }

        // Process deliveries using FIFO
        await ctx.prisma.$transaction(
          async (tx) => {
          for (const delivery of input.lines) {
            const orderLine = order.lines.find((l) => l.id === delivery.lineId);
            if (!orderLine) continue;

            let remainingQty = delivery.qtyDelivered;

            // Get batches in FIFO order
            const batches = await tx.batch.findMany({
              where: {
                itemId: orderLine.itemId,
                warehouseId: order.warehouseId,
                qtyRemaining: { gt: 0 },
              },
              orderBy: { receivedDate: "asc" },
            });

            for (const batch of batches) {
              if (remainingQty <= 0) break;

              const qtyToConsume = Math.min(
                remainingQty,
                Number(batch.qtyRemaining)
              );

              // Update batch
              await tx.batch.update({
                where: { id: batch.id },
                data: {
                  qtyRemaining: { decrement: qtyToConsume },
                },
              });

              // Create stock movement
              await tx.stockMovement.create({
                data: {
                  batchId: batch.id,
                  qty: -qtyToConsume,
                  movementType: "ISSUE",
                  referenceId: order.id,
                  referenceType: "SalesOrder",
                },
              });

              remainingQty -= qtyToConsume;
            }

            // Update order line
            await tx.salesOrderLine.update({
              where: { id: delivery.lineId },
              data: {
                qtyDelivered: { increment: delivery.qtyDelivered },
              },
            });
          }
          },
          { timeout: 30000 } // 30 seconds for remote database
        );

        // Check if fully delivered
        const updatedLines = await ctx.prisma.salesOrderLine.findMany({
          where: { salesOrderId: input.orderId },
        });

        const isFullyDelivered = updatedLines.every(
          (l) => Number(l.qtyDelivered) >= Number(l.qty)
        );

        // Check if there's a sales invoice linked to this order (for deferred invoices)
        // Note: Sales invoices are typically created separately for shelf sales
        // For warehouse sales orders, we mark the order as delivered
        // If payment wasn't made, the order becomes deferred (أجلة)
        const existingNotes = order.notes || "";
        const deferredNote = existingNotes.includes("أجلة") || existingNotes.includes("deferred")
          ? existingNotes
          : existingNotes
          ? `${existingNotes} - أجلة (Deferred - Payment pending)`
          : "أجلة (Deferred - Payment pending)";

        return ctx.prisma.salesOrder.update({
          where: { id: input.orderId },
          data: {
            status: isFullyDelivered ? "FULLY_DELIVERED" : "PARTIALLY_DELIVERED",
            // Add note indicating deferred status if payment wasn't made
            // In a full implementation, you might want to create a customer receivable invoice here
            notes: deferredNote,
          },
          include: { lines: true },
        });
      }),
  }),

  // ==================== SALES INVOICES (Shelf) ====================
  salesInvoices: router({
    list: shelfSalesProcedure
      .input(
        z.object({
          shelfId: z.string().uuid(),
          customerId: z.string().uuid().optional(),
          invoiceType: z.enum(["WHOLESALE", "RETAIL", "DAILY_AGGREGATE"]).optional(),
          status: z
            .enum(["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"])
            .optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const {
          shelfId,
          customerId,
          invoiceType,
          status,
          startDate,
          endDate,
          page,
          pageSize,
        } = input;

        const where = {
          shelfId,
          ...(customerId && { customerId }),
          ...(invoiceType && { invoiceType }),
          ...(status && { status }),
          ...(startDate && { invoiceDate: { gte: startDate } }),
          ...(endDate && { invoiceDate: { lte: endDate } }),
        };

        const [invoices, total] = await Promise.all([
          ctx.prisma.salesInvoice.findMany({
            where,
            include: {
              customer: true,
              shelf: true,
              createdBy: { select: { id: true, name: true } },
              _count: { select: { lines: true } },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          ctx.prisma.salesInvoice.count({ where }),
        ]);

        return {
          data: invoices,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    // List by branch (for mobile app)
    listByBranch: protectedProcedure
      .input(
        z.object({
          branchId: z.string().uuid(),
          customerId: z.string().uuid().optional(),
          invoiceType: z.enum(["WHOLESALE", "RETAIL", "DAILY_AGGREGATE"]).optional(),
          status: z
            .enum(["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"])
            .optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const {
          branchId,
          customerId,
          invoiceType,
          status,
          startDate,
          endDate,
          page,
          pageSize,
        } = input;

        // Since shelves don't have branchId, we filter by shelf.user.branchId
        const where = {
          ...(customerId && { customerId }),
          ...(invoiceType && { invoiceType }),
          ...(status && { status }),
          ...(startDate && { invoiceDate: { gte: startDate } }),
          ...(endDate && { invoiceDate: { lte: endDate } }),
          shelf: {
            user: {
              branchId
            }
          }
        };

        const [invoices, total] = await Promise.all([
          ctx.prisma.salesInvoice.findMany({
            where,
            include: {
              customer: true,
              shelf: true,
              createdBy: { select: { id: true, name: true } },
              _count: { select: { lines: true } },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          ctx.prisma.salesInvoice.count({ where }),
        ]);

        return {
          data: invoices,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    // Get single invoice by ID
    getById: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const invoice = await ctx.prisma.salesInvoice.findUnique({
          where: { id: input.id },
          include: {
            customer: true,
            shelf: { include: { branch: true } },
            dayCycle: true,
            createdBy: { select: { id: true, name: true } },
            lines: { include: { item: { include: { unit: true } }, batch: true } },
          },
        });

        if (!invoice) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invoice not found",
          });
        }

        return invoice;
      }),

    create: shelfSalesProcedure
      .input(
        z.object({
          customerId: z.string().uuid().optional(),
          shelfId: z.string().uuid(),
          invoiceType: z.enum(["WHOLESALE", "RETAIL"]),
          notes: z.string().optional(),
          lines: z
            .array(
              z.object({
                itemId: z.string().uuid(),
                qty: z.number().positive(),
                unitPriceUsd: z.number().nonnegative(),
              })
            )
            .min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Get shelf to find branch
        const shelf = await ctx.prisma.shelf.findUnique({
          where: { id: input.shelfId },
        });

        if (!shelf) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shelf not found",
          });
        }

        // Get open day cycle (auto-closes previous days)
        const dayCycle = await getOpenDayCycle(shelf.branchId);

        if (!dayCycle) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Day must be open to create invoices. Please open the day cycle with an exchange rate first.",
          });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const exchangeRate = Number(dayCycle.exchangeRateUsdSdg);

        // Validate prices against policy (hidden min check)
        for (const line of input.lines) {
          const policy = await ctx.prisma.pricePolicy.findFirst({
            where: {
              itemId: line.itemId,
              branchId: shelf.branchId,
              effectiveFrom: { lte: today },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
            },
            orderBy: { effectiveFrom: "desc" },
          });

          if (policy) {
            const minPrice = Number(policy.priceRangeMinUsd);
            if (line.unitPriceUsd < minPrice) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Price not allowed for one or more items",
              });
            }
          }
        }

        // Generate invoice number
        const count = await ctx.prisma.salesInvoice.count({
          where: { shelfId: input.shelfId },
        });
        const invoiceNumber = `INV-${shelf.code}-${String(count + 1).padStart(6, "0")}`;

        // Process with FIFO
        const invoice = await ctx.prisma.$transaction(
          async (tx) => {
          const linesData: Array<{
            itemId: string;
            batchId: string;
            qty: number;
            unitPriceUsd: number;
            unitPriceSdg: number;
            unitCostUsd: number;
            totalUsd: number;
            totalSdg: number;
          }> = [];

          for (const line of input.lines) {
            let remainingQty = line.qty;

            const batches = await tx.batch.findMany({
              where: {
                itemId: line.itemId,
                shelfId: input.shelfId,
                qtyRemaining: { gt: 0 },
              },
              orderBy: { receivedDate: "asc" },
            });

            for (const batch of batches) {
              if (remainingQty <= 0) break;

              const qtyToConsume = Math.min(
                remainingQty,
                Number(batch.qtyRemaining)
              );

              // Update batch
              await tx.batch.update({
                where: { id: batch.id },
                data: {
                  qtyRemaining: { decrement: qtyToConsume },
                },
              });

              linesData.push({
                itemId: line.itemId,
                batchId: batch.id,
                qty: qtyToConsume,
                unitPriceUsd: line.unitPriceUsd,
                unitPriceSdg: line.unitPriceUsd * exchangeRate,
                unitCostUsd: Number(batch.unitCostUsd),
                totalUsd: qtyToConsume * line.unitPriceUsd,
                totalSdg: qtyToConsume * line.unitPriceUsd * exchangeRate,
              });

              remainingQty -= qtyToConsume;
            }

            if (remainingQty > 0) {
              const item = await tx.item.findUnique({
                where: { id: line.itemId },
              });
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Insufficient stock for ${item?.nameEn || line.itemId}`,
              });
            }
          }

          const totalUsd = linesData.reduce((sum, l) => sum + l.totalUsd, 0);
          const totalSdg = linesData.reduce((sum, l) => sum + l.totalSdg, 0);

          const inv = await tx.salesInvoice.create({
            data: {
              invoiceNumber,
              customerId: input.customerId,
              shelfId: input.shelfId,
              dayCycleId: dayCycle.id,
              invoiceType: input.invoiceType,
              invoiceDate: today,
              totalUsd,
              totalSdg,
              status: "ISSUED",
              notes: input.notes,
              createdById: ctx.user.userId,
              lines: { create: linesData },
            },
            include: {
              customer: true,
              lines: { include: { item: true } },
            },
          });

          // Create stock movements
          for (const lineData of linesData) {
            await tx.stockMovement.create({
              data: {
                batchId: lineData.batchId,
                qty: -lineData.qty,
                movementType: "ISSUE",
                referenceId: inv.id,
                referenceType: "SalesInvoice",
              },
            });
          }

          // Create journal entry for sales invoice
          // Find accounts: Cash (1000), Sales Revenue (4000), COGS (5000), Inventory (1300)
          const cashAccount = await tx.account.findFirst({ where: { code: "1000", isActive: true } });
          const revenueAccount = await tx.account.findFirst({ where: { code: "4000", isActive: true } });
          const cogsAccount = await tx.account.findFirst({ where: { code: "5000", isActive: true } });
          const inventoryAccount = await tx.account.findFirst({ where: { code: "1300", isActive: true } });

          if (cashAccount && revenueAccount && cogsAccount && inventoryAccount) {
            // Generate journal entry number
            const entryCount = await tx.journalEntry.count({
              where: { dayCycleId: dayCycle.id },
            });
            const entryNumber = `JE-${dayCycle.cycleDate.toISOString().split('T')[0].replace(/-/g, '')}-${String(entryCount + 1).padStart(4, '0')}`;

            // Calculate COGS (total cost of items sold)
            const totalCostUsd = linesData.reduce((sum, l) => sum + (l.qty * l.unitCostUsd), 0);
            const totalCostSdg = totalCostUsd * exchangeRate;

            // Create journal entry
            await tx.journalEntry.create({
              data: {
                entryNumber,
                dayCycleId: dayCycle.id,
                entryDate: today,
                description: `Sales Invoice ${invoiceNumber}`,
                referenceId: inv.id,
                referenceType: "SalesInvoice",
                isPosted: true,
                postedAt: new Date(),
                postedById: ctx.user.userId,
                lines: {
                  create: [
                    // Debit Cash
                    {
                      accountId: cashAccount.id,
                      debitSdg: totalSdg,
                      debitUsd: totalUsd,
                      creditSdg: 0,
                      creditUsd: 0,
                      description: `Cash received from sales - ${invoiceNumber}`,
                    },
                    // Credit Sales Revenue
                    {
                      accountId: revenueAccount.id,
                      debitSdg: 0,
                      debitUsd: 0,
                      creditSdg: totalSdg,
                      creditUsd: totalUsd,
                      description: `Sales revenue - ${invoiceNumber}`,
                    },
                    // Debit COGS
                    {
                      accountId: cogsAccount.id,
                      debitSdg: totalCostSdg,
                      debitUsd: totalCostUsd,
                      creditSdg: 0,
                      creditUsd: 0,
                      description: `Cost of goods sold - ${invoiceNumber}`,
                    },
                    // Credit Inventory
                    {
                      accountId: inventoryAccount.id,
                      debitSdg: 0,
                      debitUsd: 0,
                      creditSdg: totalCostSdg,
                      creditUsd: totalCostUsd,
                      description: `Inventory reduction - ${invoiceNumber}`,
                    },
                  ],
                },
              },
            });
          }

            return inv;
          },
          { timeout: 30000 } // 30 seconds for remote database
        );

        return invoice;
      }),
  }),

  // ==================== DAILY AGGREGATE INVOICE ====================
  dailyAggregate: router({
    getOrCreate: shelfSalesProcedure
      .input(z.object({ shelfId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const shelf = await ctx.prisma.shelf.findUnique({
          where: { id: input.shelfId },
        });

        if (!shelf) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shelf not found",
          });
        }

        // Get open day cycle (auto-closes previous days)
        const dayCycle = await getOpenDayCycle(shelf.branchId);

        if (!dayCycle) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Day must be open. Please open the day cycle with an exchange rate first.",
          });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let aggregate = await ctx.prisma.dailyAggregateInvoice.findFirst({
          where: {
            shelfId: input.shelfId,
            dayCycleId: dayCycle.id,
          },
        });

        if (!aggregate) {
          aggregate = await ctx.prisma.dailyAggregateInvoice.create({
            data: {
              shelfId: input.shelfId,
              dayCycleId: dayCycle.id,
              invoiceDate: today,
              cashTotalSdg: 0,
              cardTotalSdg: 0,
              totalSdg: 0,
              totalUsd: 0,
              itemCount: 0,
              transactionCount: 0,
            },
          });
        }

        return aggregate;
      }),

    update: shelfSalesProcedure
      .input(
        z.object({
          shelfId: z.string().uuid(),
          cashTotalSdg: z.number().nonnegative(),
          cardTotalSdg: z.number().nonnegative(),
          itemCount: z.number().int().nonnegative(),
          transactionCount: z.number().int().nonnegative(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const shelf = await ctx.prisma.shelf.findUnique({
          where: { id: input.shelfId },
        });

        if (!shelf) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shelf not found",
          });
        }

        // Get open day cycle (auto-closes previous days)
        const dayCycle = await getOpenDayCycle(shelf.branchId);

        if (!dayCycle) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Day must be open. Please open the day cycle with an exchange rate first.",
          });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const exchangeRate = Number(dayCycle.exchangeRateUsdSdg);
        const totalSdg = input.cashTotalSdg + input.cardTotalSdg;
        const totalUsd = totalSdg / exchangeRate;

        return ctx.prisma.dailyAggregateInvoice.upsert({
          where: {
            shelfId_dayCycleId: {
              shelfId: input.shelfId,
              dayCycleId: dayCycle.id,
            },
          },
          update: {
            cashTotalSdg: input.cashTotalSdg,
            cardTotalSdg: input.cardTotalSdg,
            totalSdg,
            totalUsd,
            itemCount: input.itemCount,
            transactionCount: input.transactionCount,
          },
          create: {
            shelfId: input.shelfId,
            dayCycleId: dayCycle.id,
            invoiceDate: today,
            cashTotalSdg: input.cashTotalSdg,
            cardTotalSdg: input.cardTotalSdg,
            totalSdg,
            totalUsd,
            itemCount: input.itemCount,
            transactionCount: input.transactionCount,
          },
        });
      }),
  }),

  // ==================== GOODS REQUESTS ====================
  goodsRequests: router({
    list: protectedProcedure
      .input(
        z.object({
          shelfId: z.string().uuid().optional(),
          branchId: z.string().uuid().optional(),
          status: z
            .enum([
              "DRAFT",
              "SUBMITTED",
              "APPROVED",
              "REJECTED",
              "ISSUED",
              "RECEIVED",
              "CANCELLED",
            ])
            .optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { shelfId, branchId, status, page, pageSize } = input;

        const where = {
          ...(shelfId && { shelfId }),
          ...(branchId && { shelf: { branchId } }),
          ...(status && { status }),
        };

        const [requests, total] = await Promise.all([
          ctx.prisma.goodsRequest.findMany({
            where,
            include: {
              shelf: true,
              requestedBy: { select: { id: true, name: true } },
              _count: { select: { lines: true } },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          ctx.prisma.goodsRequest.count({ where }),
        ]);

        return {
          data: requests,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const request = await ctx.prisma.goodsRequest.findUnique({
          where: { id: input.id },
          include: {
            shelf: true,
            requestedBy: { select: { id: true, name: true } },
            lines: { include: { item: { include: { unit: true } } } },
            approvals: {
              include: { approvedBy: { select: { id: true, name: true } } },
            },
          },
        });

        if (!request) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Goods request not found",
          });
        }

        return request;
      }),

    create: shelfSalesProcedure
      .input(
        z.object({
          shelfId: z.string().uuid(),
          notes: z.string().optional(),
          lines: z
            .array(
              z.object({
                itemId: z.string().uuid(),
                qtyRequested: z.number().positive(),
              })
            )
            .min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Generate request number
        const count = await ctx.prisma.goodsRequest.count();
        const requestNumber = `GRQ-${String(count + 1).padStart(6, "0")}`;

        return ctx.prisma.goodsRequest.create({
          data: {
            requestNumber,
            shelfId: input.shelfId,
            requestedById: ctx.user.userId,
            requestDate: new Date(),
            notes: input.notes,
            status: "DRAFT",
            lines: {
              create: input.lines.map((l) => ({
                itemId: l.itemId,
                qtyRequested: l.qtyRequested,
              })),
            },
          },
          include: {
            shelf: true,
            lines: { include: { item: true } },
          },
        });
      }),

    submit: shelfSalesProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const request = await ctx.prisma.goodsRequest.findUnique({
          where: { id: input.id },
        });

        if (!request) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Goods request not found",
          });
        }

        if (request.status !== "DRAFT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Can only submit draft requests",
          });
        }

        return ctx.prisma.goodsRequest.update({
          where: { id: input.id },
          data: { status: "SUBMITTED" },
        });
      }),

    approve: adminProcedure
      .input(
        z.object({
          requestId: z.string().uuid(),
          notes: z.string().optional(),
          lines: z
            .array(
              z.object({
                lineId: z.string().uuid(),
                qtyApproved: z.number().nonnegative(),
              })
            )
            .min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const request = await ctx.prisma.goodsRequest.findUnique({
          where: { id: input.requestId },
        });

        if (!request) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Goods request not found",
          });
        }

        if (request.status !== "SUBMITTED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Can only approve submitted requests",
          });
        }

        await ctx.prisma.$transaction(
          async (tx) => {
            // Update line quantities
            for (const line of input.lines) {
              await tx.goodsRequestLine.update({
                where: { id: line.lineId },
                data: { qtyApproved: line.qtyApproved },
              });
            }

            // Create approval record
            await tx.goodsRequestApproval.create({
              data: {
                requestId: input.requestId,
                approvedById: ctx.user.userId,
                notes: input.notes,
              },
            });

            // Update request status
            await tx.goodsRequest.update({
              where: { id: input.requestId },
              data: { status: "APPROVED" },
            });
          },
          { timeout: 15000 } // 15 seconds for remote database
        );

        return ctx.prisma.goodsRequest.findUnique({
          where: { id: input.requestId },
          include: {
            lines: { include: { item: true } },
            approvals: {
              include: { approvedBy: { select: { id: true, name: true } } },
            },
          },
        });
      }),

    reject: adminProcedure
      .input(
        z.object({
          requestId: z.string().uuid(),
          reason: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const request = await ctx.prisma.goodsRequest.findUnique({
          where: { id: input.requestId },
        });

        if (!request) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Goods request not found",
          });
        }

        return ctx.prisma.goodsRequest.update({
          where: { id: input.requestId },
          data: {
            status: "REJECTED",
            notes: input.reason
              ? `${request.notes || ""}\nRejected: ${input.reason}`
              : request.notes,
          },
        });
      }),

    issue: warehouseSalesProcedure
      .input(
        z.object({
          requestId: z.string().uuid(),
          warehouseId: z.string().uuid(),
          lines: z
            .array(
              z.object({
                lineId: z.string().uuid(),
                qtyIssued: z.number().positive(),
              })
            )
            .min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const request = await ctx.prisma.goodsRequest.findUnique({
          where: { id: input.requestId },
          include: { lines: true, shelf: true },
        });

        if (!request) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Goods request not found",
          });
        }

        if (request.status !== "APPROVED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Request must be approved to issue",
          });
        }

        await ctx.prisma.$transaction(
          async (tx) => {
            for (const issue of input.lines) {
              const line = request.lines.find((l) => l.id === issue.lineId);
              if (!line) continue;

              let remainingQty = issue.qtyIssued;

              // Get batches in FIFO order from warehouse
              const batches = await tx.batch.findMany({
                where: {
                  itemId: line.itemId,
                  warehouseId: input.warehouseId,
                  qtyRemaining: { gt: 0 },
                },
                orderBy: { receivedDate: "asc" },
              });

            for (const batch of batches) {
              if (remainingQty <= 0) break;

              const qtyToTransfer = Math.min(
                remainingQty,
                Number(batch.qtyRemaining)
              );

              // Reduce warehouse batch
              await tx.batch.update({
                where: { id: batch.id },
                data: {
                  qtyRemaining: { decrement: qtyToTransfer },
                },
              });

              // Create movement out
              await tx.stockMovement.create({
                data: {
                  batchId: batch.id,
                  qty: -qtyToTransfer,
                  movementType: "TRANSFER_OUT",
                  referenceId: request.id,
                  referenceType: "GoodsRequest",
                },
              });

              // Create or update shelf batch
              const shelfBatch = await tx.batch.findFirst({
                where: {
                  itemId: line.itemId,
                  shelfId: request.shelfId,
                  unitCostUsd: batch.unitCostUsd,
                  receivedDate: batch.receivedDate,
                },
              });

              if (shelfBatch) {
                await tx.batch.update({
                  where: { id: shelfBatch.id },
                  data: {
                    qtyRemaining: { increment: qtyToTransfer },
                    qtyReceived: { increment: qtyToTransfer },
                  },
                });

                await tx.stockMovement.create({
                  data: {
                    batchId: shelfBatch.id,
                    qty: qtyToTransfer,
                    movementType: "TRANSFER_IN",
                    referenceId: request.id,
                    referenceType: "GoodsRequest",
                  },
                });
              } else {
                const newBatch = await tx.batch.create({
                  data: {
                    itemId: line.itemId,
                    shelfId: request.shelfId,
                    qtyReceived: qtyToTransfer,
                    qtyRemaining: qtyToTransfer,
                    unitCostUsd: batch.unitCostUsd,
                    receivedDate: batch.receivedDate,
                    isConsignment: batch.isConsignment,
                    consignorId: batch.consignorId,
                  },
                });

                await tx.stockMovement.create({
                  data: {
                    batchId: newBatch.id,
                    qty: qtyToTransfer,
                    movementType: "TRANSFER_IN",
                    referenceId: request.id,
                    referenceType: "GoodsRequest",
                  },
                });
              }

              remainingQty -= qtyToTransfer;
            }

              // Update line
              await tx.goodsRequestLine.update({
                where: { id: issue.lineId },
                data: { qtyIssued: issue.qtyIssued },
              });
            }

            // Update request status
            await tx.goodsRequest.update({
              where: { id: input.requestId },
              data: { status: "ISSUED" },
            });
          },
          { timeout: 30000 } // 30 seconds for remote database
        );

        return ctx.prisma.goodsRequest.findUnique({
          where: { id: input.requestId },
          include: { lines: { include: { item: true } } },
        });
      }),

    receive: shelfSalesProcedure
      .input(
        z.object({
          requestId: z.string().uuid(),
          lines: z
            .array(
              z.object({
                lineId: z.string().uuid(),
                qtyReceived: z.number().nonnegative(),
              })
            )
            .min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const request = await ctx.prisma.goodsRequest.findUnique({
          where: { id: input.requestId },
        });

        if (!request) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Goods request not found",
          });
        }

        if (request.status !== "ISSUED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Request must be issued to receive",
          });
        }

        await ctx.prisma.$transaction(
          async (tx) => {
            for (const receive of input.lines) {
              await tx.goodsRequestLine.update({
                where: { id: receive.lineId },
                data: { qtyReceived: receive.qtyReceived },
              });
            }

            await tx.goodsRequest.update({
              where: { id: input.requestId },
              data: { status: "RECEIVED" },
            });
          },
          { timeout: 15000 } // 15 seconds for remote database
        );

        return ctx.prisma.goodsRequest.findUnique({
          where: { id: input.requestId },
          include: { lines: { include: { item: true } } },
        });
      }),
  }),
});

