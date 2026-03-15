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
        // Get warehouse
        const warehouse = await ctx.prisma.warehouse.findUnique({
          where: { id: input.warehouseId },
        });

        if (!warehouse) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Warehouse not found",
          });
        }

        if (!ctx.user.branchId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "User must be assigned to a branch",
          });
        }

        // Get open day cycle (auto-closes previous days)
        const dayCycle = await getOpenDayCycle(ctx.user.branchId);

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
          where: { branchId: ctx.user.branchId },
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
            branchId: ctx.user.branchId,
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

        // Enforce day cycle
        const deliverBranchId = order.branchId || ctx.user.branchId;
        if (deliverBranchId) {
          const openCycle = await getOpenDayCycle(deliverBranchId);
          if (!openCycle) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Day is closed. Please open the day cycle before delivering goods.",
            });
          }
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
            shelf: { include: { user: { select: { id: true, branchId: true, branch: true } } } },
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

        // Non-admin users can only view invoices from their own branch
        const isAdmin = ["ADMIN", "MANAGER", "ACCOUNTANT"].includes(ctx.user.role);
        if (!isAdmin && ctx.user.branchId) {
          const invoiceBranchId = invoice.shelf?.user?.branchId;
          if (invoiceBranchId && invoiceBranchId !== ctx.user.branchId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this invoice" });
          }
        }

        return invoice;
      }),

    void: shelfSalesProcedure
      .input(z.object({ id: z.string().uuid(), reason: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const invoice = await ctx.prisma.salesInvoice.findUnique({
          where: { id: input.id },
          include: { lines: { include: { batch: true } }, shelf: { include: { user: { select: { branchId: true } } } }, dayCycle: true },
        });

        if (!invoice) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        }

        if (invoice.status === "CANCELLED") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice is already cancelled" });
        }

        if (invoice.status === "PAID") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot void a fully paid invoice" });
        }

        const branchId = invoice.shelf?.user?.branchId;

        // Enforce day cycle
        if (branchId) {
          const openCycle = await getOpenDayCycle(branchId);
          if (!openCycle) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Day is closed. Please open the day cycle before voiding an invoice.",
            });
          }
        }

        return ctx.prisma.$transaction(async (tx) => {
          // Reverse stock movements (restore batch quantities)
          for (const line of invoice.lines) {
            await tx.batch.update({
              where: { id: line.batchId },
              data: { qtyRemaining: { increment: Number(line.qty) } },
            });
            await tx.stockMovement.create({
              data: {
                batchId: line.batchId,
                qty: Number(line.qty),
                movementType: "RETURN_IN",
                referenceId: invoice.id,
                referenceType: "SalesInvoiceVoid",
              },
            });
          }

          // Create reversal journal entry
          if (!branchId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot void invoice: branch information missing" });
          }

          const cashAccount = await tx.account.findFirst({ where: { code: "1000", isActive: true } });
          const arAccount = await tx.account.findFirst({ where: { code: "1200", isActive: true } });
          const revenueAccount = await tx.account.findFirst({ where: { code: "4000", isActive: true } });
          const cogsAccount = await tx.account.findFirst({ where: { code: "5000", isActive: true } });
          const inventoryAccount = await tx.account.findFirst({ where: { code: "1300", isActive: true } });

          if (!revenueAccount || !cogsAccount || !inventoryAccount) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cannot void invoice: required chart of accounts entries missing (Revenue/COGS/Inventory)" });
          }

          // Determine debit account based on original payment method
          const isCreditSale = invoice.paymentMethod === "CREDIT";
          const debitAccount = isCreditSale ? arAccount : cashAccount;

          if (!debitAccount) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Cannot void invoice: ${isCreditSale ? 'AR account (1200)' : 'Cash account (1000)'} not found` });
          }

          const entryCount = await tx.journalEntry.count({ where: { dayCycleId: invoice.dayCycleId } });
          const entryNumber = `JE-VOID-${invoice.dayCycle.cycleDate.toISOString().split('T')[0].replace(/-/g, '')}-${String(entryCount + 1).padStart(4, '0')}`;
          const totalUsd = Number(invoice.totalUsd);
          const totalSdg = Number(invoice.totalSdg);
          const exchangeRate = Number(invoice.dayCycle.exchangeRateUsdSdg);
          const totalCostUsd = invoice.lines.reduce((sum, l) => sum + (Number(l.qty) * Number(l.unitCostUsd || 0)), 0);
          const totalCostSdg = totalCostUsd * exchangeRate;

          const reversalLines: any[] = [
            { accountId: revenueAccount.id, debitSdg: totalSdg, debitUsd: totalUsd, creditSdg: 0, creditUsd: 0, description: `Void sales revenue - ${invoice.invoiceNumber}` },
            { accountId: inventoryAccount.id, debitSdg: totalCostSdg, debitUsd: totalCostUsd, creditSdg: 0, creditUsd: 0, description: `Void inventory restoration - ${invoice.invoiceNumber}` },
            { accountId: debitAccount.id, debitSdg: 0, debitUsd: 0, creditSdg: totalSdg, creditUsd: totalUsd, description: `Void debit reversal - ${invoice.invoiceNumber}` },
            { accountId: cogsAccount.id, debitSdg: 0, debitUsd: 0, creditSdg: totalCostSdg, creditUsd: totalCostUsd, description: `Void COGS reversal - ${invoice.invoiceNumber}` },
          ];

          await tx.journalEntry.create({
            data: {
              entryNumber,
              dayCycleId: invoice.dayCycleId,
              entryDate: new Date(),
              description: `Void Sales Invoice ${invoice.invoiceNumber}${input.reason ? ` - ${input.reason}` : ''}`,
              referenceId: invoice.id,
              referenceType: "SalesInvoiceVoid",
              isPosted: true,
              postedAt: new Date(),
              postedById: ctx.user.userId,
              lines: { create: reversalLines },
            },
          });

          // Cancel the invoice
          return tx.salesInvoice.update({
            where: { id: invoice.id },
            data: {
              status: "CANCELLED",
              notes: invoice.notes ? `${invoice.notes} | VOIDED: ${input.reason || 'No reason'}` : `VOIDED: ${input.reason || 'No reason'}`,
            },
          });
        });
      }),

    create: shelfSalesProcedure
      .input(
        z.object({
          customerId: z.string().uuid().optional(),
          shelfId: z.string().uuid(),
          invoiceType: z.enum(["WHOLESALE", "RETAIL"]),
          paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CREDIT", "MIXED"]).optional().default("CASH"),
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
        // Get shelf with user to find branch
        const shelf = await ctx.prisma.shelf.findUnique({
          where: { id: input.shelfId },
          include: { user: { select: { branchId: true } } },
        });

        if (!shelf) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shelf not found",
          });
        }

        if (!shelf.user?.branchId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Shelf must be assigned to a user with a branch",
          });
        }

        // Get open day cycle (auto-closes previous days)
        const dayCycle = await getOpenDayCycle(shelf.user.branchId);

        if (!dayCycle) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Day must be open to create invoices. Please open the day cycle with an exchange rate first.",
          });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const exchangeRate = Number(dayCycle.exchangeRateUsdSdg);

        // Validate prices against policy
        for (const line of input.lines) {
          const policy = await ctx.prisma.pricePolicy.findFirst({
            where: {
              itemId: line.itemId,
              branchId: shelf.user.branchId,
              effectiveFrom: { lte: today },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
            },
            orderBy: { effectiveFrom: "desc" },
          });

          if (policy) {
            const expectedPrice = input.invoiceType === "WHOLESALE"
              ? Number(policy.wholesalePriceUsd)
              : Number(policy.retailPriceUsd);
            if (Math.abs(line.unitPriceUsd - expectedPrice) > 0.001) {
              const item = await ctx.prisma.item.findUnique({ where: { id: line.itemId }, select: { nameEn: true } });
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Price for ${item?.nameEn || line.itemId} must be $${expectedPrice.toFixed(2)} for ${input.invoiceType} invoice`,
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

          const isCredit = input.paymentMethod === "CREDIT";
          const invoiceStatus = isCredit ? "ISSUED" : "PAID";

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
              paidAmountSdg: isCredit ? 0 : totalSdg,
              paymentMethod: input.paymentMethod as any,
              status: invoiceStatus,
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
          const cashAccount = await tx.account.findFirst({ where: { code: "1000", isActive: true } });
          const arAccount = await tx.account.findFirst({ where: { code: "1200", isActive: true } });
          const revenueAccount = await tx.account.findFirst({ where: { code: "4000", isActive: true } });
          const cogsAccount = await tx.account.findFirst({ where: { code: "5000", isActive: true } });
          const inventoryAccount = await tx.account.findFirst({ where: { code: "1300", isActive: true } });

          const debitAccount = isCredit ? arAccount : cashAccount;

          if (debitAccount && revenueAccount && cogsAccount && inventoryAccount) {
            const entryCount = await tx.journalEntry.count({
              where: { dayCycleId: dayCycle.id },
            });
            const entryNumber = `JE-${dayCycle.cycleDate.toISOString().split('T')[0].replace(/-/g, '')}-${String(entryCount + 1).padStart(4, '0')}`;

            const totalCostUsd = linesData.reduce((sum, l) => sum + (l.qty * l.unitCostUsd), 0);
            const totalCostSdg = totalCostUsd * exchangeRate;

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
                    // Debit Cash or AR depending on payment method
                    {
                      accountId: debitAccount.id,
                      debitSdg: totalSdg,
                      debitUsd: totalUsd,
                      creditSdg: 0,
                      creditUsd: 0,
                      description: `${isCredit ? 'AR' : 'Cash'} from sales - ${invoiceNumber}`,
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
          include: { user: { select: { branchId: true } } },
        });

        if (!shelf) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shelf not found",
          });
        }

        if (!shelf.user?.branchId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Shelf must be assigned to a user with a branch",
          });
        }

        // Get open day cycle (auto-closes previous days)
        const dayCycle = await getOpenDayCycle(shelf.user.branchId);

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
          include: { user: { select: { branchId: true } } },
        });

        if (!shelf) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shelf not found",
          });
        }

        if (!shelf.user?.branchId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Shelf must be assigned to a user with a branch",
          });
        }

        // Get open day cycle (auto-closes previous days)
        const dayCycle = await getOpenDayCycle(shelf.user.branchId);

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
          ...(branchId && { shelf: { user: { branchId } } }),
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
          include: { lines: true, shelf: { include: { user: true } } },
        });

        if (!request) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Goods request not found",
          });
        }

        // Enforce day cycle
        const issueBranchId = (request.shelf as any)?.user?.branchId || ctx.user.branchId;
        if (issueBranchId) {
          const openCycle = await getOpenDayCycle(issueBranchId);
          if (!openCycle) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Day is closed. Please open the day cycle before issuing goods.",
            });
          }
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
          include: { shelf: { include: { user: true } } },
        });

        if (!request) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Goods request not found",
          });
        }

        // Enforce day cycle
        const receiveBranchId = (request.shelf as any)?.user?.branchId || ctx.user.branchId;
        if (receiveBranchId) {
          const openCycle = await getOpenDayCycle(receiveBranchId);
          if (!openCycle) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Day is closed. Please open the day cycle before receiving goods.",
            });
          }
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

  // ==================== DAILY INVOICE DRAFT ====================
  dailyInvoiceDraft: router({
    getOrCreate: shelfSalesProcedure
      .input(z.object({ shelfId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const draft = await ctx.prisma.dailyInvoiceDraft.upsert({
          where: { shelfId: input.shelfId },
          create: { shelfId: input.shelfId },
          update: {},
          include: {
            lines: {
              include: { item: { include: { unit: true, pricePolicies: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
        });
        return draft;
      }),

    addLine: shelfSalesProcedure
      .input(
        z.object({
          shelfId: z.string().uuid(),
          itemId: z.string().uuid(),
          qty: z.number().int().positive(),
          unitPriceUsd: z.number().nonnegative(),
          batchId: z.string().uuid().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const draft = await ctx.prisma.dailyInvoiceDraft.upsert({
          where: { shelfId: input.shelfId },
          create: { shelfId: input.shelfId },
          update: {},
          select: { id: true },
        });

        const line = await ctx.prisma.dailyInvoiceDraftLine.create({
          data: {
            draftId: draft.id,
            itemId: input.itemId,
            qty: input.qty,
            unitPriceUsd: input.unitPriceUsd,
            batchId: input.batchId,
          },
          include: { item: { include: { unit: true } } },
        });

        return line;
      }),

    removeLine: shelfSalesProcedure
      .input(z.object({ lineId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.prisma.dailyInvoiceDraftLine.delete({
          where: { id: input.lineId },
        });
        return { success: true };
      }),

    updateLineQty: shelfSalesProcedure
      .input(
        z.object({
          lineId: z.string().uuid(),
          qty: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const line = await ctx.prisma.dailyInvoiceDraftLine.update({
          where: { id: input.lineId },
          data: { qty: input.qty },
          include: { item: { include: { unit: true } } },
        });
        return line;
      }),

    clearDraft: shelfSalesProcedure
      .input(z.object({ shelfId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const draft = await ctx.prisma.dailyInvoiceDraft.findUnique({
          where: { shelfId: input.shelfId },
          select: { id: true },
        });
        if (draft) {
          await ctx.prisma.dailyInvoiceDraftLine.deleteMany({
            where: { draftId: draft.id },
          });
        }
        return { success: true };
      }),

    checkout: shelfSalesProcedure
      .input(
        z.object({
          shelfId: z.string().uuid(),
          paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "MIXED"]),
          cashAmountSdg: z.number().nonnegative().optional().default(0),
          cardAmountSdg: z.number().nonnegative().optional().default(0),
          transactionNumber: z.string().regex(/^\d{6}$/).optional(),
          receiptImageUrls: z.array(z.string()).optional().default([]),
          customerId: z.string().uuid().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Validate 6-digit transaction number uniqueness
        if (input.transactionNumber) {
          const existing = await ctx.prisma.bankPayment.findFirst({
            where: { transactionNumber: input.transactionNumber },
            select: { id: true, transactionNumber: true },
          });
          if (existing) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `DUPLICATE_TXN:${existing.id}`,
            });
          }
          // Also check SalesInvoice
          const existingInv = await ctx.prisma.salesInvoice.findFirst({
            where: { transactionNumber: input.transactionNumber },
            select: { id: true, invoiceNumber: true },
          });
          if (existingInv) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `DUPLICATE_TXN:${existingInv.id}`,
            });
          }
        }

        // Get draft with lines
        const draft = await ctx.prisma.dailyInvoiceDraft.findUnique({
          where: { shelfId: input.shelfId },
          include: {
            lines: { include: { item: true } },
          },
        });

        if (!draft || draft.lines.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Draft is empty. Add items before checkout.",
          });
        }

        // Get shelf and branch
        const shelf = await ctx.prisma.shelf.findUnique({
          where: { id: input.shelfId },
          include: { user: { select: { branchId: true } } },
        });

        if (!shelf || !shelf.user?.branchId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Shelf not assigned to a user with a branch",
          });
        }

        const dayCycle = await getOpenDayCycle(shelf.user.branchId);
        if (!dayCycle) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Day must be open to checkout",
          });
        }

        const exchangeRate = Number(dayCycle.exchangeRateUsdSdg);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Validate prices against policy (enforce retail prices)
        // Resolution order: shelf > warehouse > branch (same as getForItem)
        for (const line of draft.lines) {
          const candidates = [
            { itemId: line.itemId, branchId: shelf.user.branchId, shelfId: input.shelfId, effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
            { itemId: line.itemId, branchId: shelf.user.branchId, shelfId: null, warehouseId: null, effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
          ];
          let policy = null;
          for (const where of candidates) {
            policy = await ctx.prisma.pricePolicy.findFirst({
              where,
              orderBy: { effectiveFrom: "desc" },
            });
            if (policy) break;
          }
          if (policy) {
            const expectedPrice = Number(policy.retailPriceUsd);
            if (Math.abs(Number(line.unitPriceUsd) - expectedPrice) > 0.001) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Price for ${line.item.nameEn} must be $${expectedPrice.toFixed(2)} for RETAIL invoice`,
              });
            }
          }
        }

        const count = await ctx.prisma.salesInvoice.count({
          where: { shelfId: input.shelfId },
        });
        const invoiceNumber = `INV-${shelf.code}-${String(count + 1).padStart(6, "0")}`;

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

            for (const line of draft.lines) {
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
                const qtyToConsume = Math.min(remainingQty, Number(batch.qtyRemaining));
                await tx.batch.update({
                  where: { id: batch.id },
                  data: { qtyRemaining: { decrement: qtyToConsume } },
                });
                linesData.push({
                  itemId: line.itemId,
                  batchId: batch.id,
                  qty: qtyToConsume,
                  unitPriceUsd: Number(line.unitPriceUsd),
                  unitPriceSdg: Number(line.unitPriceUsd) * exchangeRate,
                  unitCostUsd: Number(batch.unitCostUsd),
                  totalUsd: qtyToConsume * Number(line.unitPriceUsd),
                  totalSdg: qtyToConsume * Number(line.unitPriceUsd) * exchangeRate,
                });
                remainingQty -= qtyToConsume;
              }

              if (remainingQty > 0) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Insufficient stock for ${line.item.nameEn}`,
                });
              }
            }

            const totalUsd = linesData.reduce((s, l) => s + l.totalUsd, 0);
            const totalSdg = linesData.reduce((s, l) => s + l.totalSdg, 0);
            const paidAmountSdg = (input.cashAmountSdg ?? 0) + (input.cardAmountSdg ?? 0);
            const invoiceStatus = "PAID";

            const inv = await tx.salesInvoice.create({
              data: {
                invoiceNumber,
                customerId: input.customerId,
                shelfId: input.shelfId,
                dayCycleId: dayCycle.id,
                invoiceType: "RETAIL",
                invoiceDate: today,
                totalUsd,
                totalSdg,
                paidAmountSdg: totalSdg,
                paymentMethod: input.paymentMethod as any,
                transactionNumber: input.transactionNumber,
                receiptImageUrls: input.receiptImageUrls,
                status: invoiceStatus,
                createdById: ctx.user.userId,
                lines: { create: linesData },
              },
              include: {
                lines: { include: { item: true } },
              },
            });

            // Stock movements
            for (const ld of linesData) {
              await tx.stockMovement.create({
                data: {
                  batchId: ld.batchId,
                  qty: -ld.qty,
                  movementType: "ISSUE",
                  referenceId: inv.id,
                  referenceType: "SalesInvoice",
                },
              });
            }

            // Journal entries
            const cashAccount = await tx.account.findFirst({ where: { code: "1000", isActive: true } });
            const bankAccount = await tx.account.findFirst({ where: { code: "1100", isActive: true } });
            const revenueAccount = await tx.account.findFirst({ where: { code: "4000", isActive: true } });
            const cogsAccount = await tx.account.findFirst({ where: { code: "5000", isActive: true } });
            const inventoryAccount = await tx.account.findFirst({ where: { code: "1300", isActive: true } });

            if (revenueAccount && cogsAccount && inventoryAccount) {
              const entryCount = await tx.journalEntry.count({ where: { dayCycleId: dayCycle.id } });
              const entryNumber = `JE-${dayCycle.cycleDate.toISOString().split("T")[0].replace(/-/g, "")}-${String(entryCount + 1).padStart(4, "0")}`;
              const totalCostUsd = linesData.reduce((s, l) => s + l.qty * l.unitCostUsd, 0);
              const totalCostSdg = totalCostUsd * exchangeRate;

              const journalLines = [];
              if (input.paymentMethod === "CASH" && cashAccount) {
                journalLines.push({ accountId: cashAccount.id, debitSdg: totalSdg, debitUsd: totalUsd, creditSdg: 0, creditUsd: 0, description: `Cash from daily sale - ${invoiceNumber}` });
              } else if (input.paymentMethod === "BANK_TRANSFER" && bankAccount) {
                journalLines.push({ accountId: bankAccount.id, debitSdg: totalSdg, debitUsd: totalUsd, creditSdg: 0, creditUsd: 0, description: `Bank transfer from daily sale - ${invoiceNumber}` });
              } else if (input.paymentMethod === "MIXED") {
                if (cashAccount && (input.cashAmountSdg ?? 0) > 0) {
                  journalLines.push({ accountId: cashAccount.id, debitSdg: input.cashAmountSdg ?? 0, debitUsd: (input.cashAmountSdg ?? 0) / exchangeRate, creditSdg: 0, creditUsd: 0, description: `Cash portion - ${invoiceNumber}` });
                }
                if (bankAccount && (input.cardAmountSdg ?? 0) > 0) {
                  journalLines.push({ accountId: bankAccount.id, debitSdg: input.cardAmountSdg ?? 0, debitUsd: (input.cardAmountSdg ?? 0) / exchangeRate, creditSdg: 0, creditUsd: 0, description: `Bank portion - ${invoiceNumber}` });
                }
              }
              journalLines.push({ accountId: revenueAccount.id, debitSdg: 0, debitUsd: 0, creditSdg: totalSdg, creditUsd: totalUsd, description: `Sales revenue - ${invoiceNumber}` });
              journalLines.push({ accountId: cogsAccount.id, debitSdg: totalCostSdg, debitUsd: totalCostUsd, creditSdg: 0, creditUsd: 0, description: `COGS - ${invoiceNumber}` });
              journalLines.push({ accountId: inventoryAccount.id, debitSdg: 0, debitUsd: 0, creditSdg: totalCostSdg, creditUsd: totalCostUsd, description: `Inventory reduction - ${invoiceNumber}` });

              await tx.journalEntry.create({
                data: {
                  entryNumber,
                  dayCycleId: dayCycle.id,
                  entryDate: today,
                  description: `Daily Invoice Checkout ${invoiceNumber}`,
                  referenceId: inv.id,
                  referenceType: "SalesInvoice",
                  isPosted: true,
                  postedAt: new Date(),
                  postedById: ctx.user.userId,
                  lines: { create: journalLines },
                },
              });
            }

            // Clear draft lines after successful checkout
            await tx.dailyInvoiceDraftLine.deleteMany({
              where: { draftId: draft.id },
            });

            return inv;
          },
          { timeout: 30000 }
        );

        return invoice;
      }),
  }),
});

