import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Decimal } from "@prisma/client/runtime/library";
import {
  router,
  protectedProcedure,
  procurementProcedure,
  adminProcedure,
  goodsReceiptProcedure,
  validateBranchAccess,
} from "../trpc/trpc.js";
import { getOpenDayCycle } from "../lib/dayCycle.js";

export const procurementRouter = router({
  // ==================== SUPPLIERS ====================
  suppliers: router({
    list: protectedProcedure
      .input(
        z.object({
          search: z.string().optional(),
          isConsignor: z.boolean().optional(),
          isActive: z.boolean().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { search, isConsignor, isActive, page, pageSize } = input;

        const where = {
          ...(isConsignor !== undefined && { isConsignor }),
          ...(isActive !== undefined && { isActive }),
          ...(search && {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { nameAr: { contains: search, mode: "insensitive" as const } },
            ],
          }),
        };

        const [suppliers, total] = await Promise.all([
          ctx.prisma.supplier.findMany({
            where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { name: "asc" },
          }),
          ctx.prisma.supplier.count({ where }),
        ]);

        return {
          data: suppliers,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const supplier = await ctx.prisma.supplier.findUnique({
          where: { id: input.id },
          include: {
            _count: {
              select: {
                purchaseOrders: true,
                supplierInvoices: true,
              },
            },
          },
        });

        if (!supplier) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Supplier not found",
          });
        }

        return supplier;
      }),

    create: procurementProcedure
      .input(
        z.object({
          name: z.string().min(2),
          nameAr: z.string().optional(),
          contactPerson: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional().or(z.literal("")),
          address: z.string().optional(),
          taxNumber: z.string().optional(),
          isConsignor: z.boolean().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const data = { ...input, email: input.email || null };
        return ctx.prisma.supplier.create({ data });
      }),

    update: procurementProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(2).optional(),
          nameAr: z.string().optional(),
          contactPerson: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional().or(z.literal("")),
          address: z.string().optional(),
          taxNumber: z.string().optional(),
          isConsignor: z.boolean().optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const updateData = { ...data, email: data.email || null };
        return ctx.prisma.supplier.update({ where: { id }, data: updateData });
      }),
  }),

  // ==================== PURCHASE ORDERS ====================
  purchaseOrders: router({
    // Using goodsReceiptProcedure to allow both PROCUREMENT and WAREHOUSE_SALES to view PO list
    list: goodsReceiptProcedure
      .input(
        z.object({
          branchId: z.string().uuid(),
          supplierId: z.string().uuid().optional(),
          status: z
            .enum([
              "DRAFT",
              "APPROVED",
              "PARTIALLY_RECEIVED",
              "FULLY_RECEIVED",
              "CLOSED",
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
        // Validate branch access
        validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
        
        const { branchId, supplierId, status, startDate, endDate, page, pageSize } =
          input;

        const where = {
          branchId,
          ...(supplierId && { supplierId }),
          ...(status && { status }),
          ...(startDate && { orderDate: { gte: startDate } }),
          ...(endDate && { orderDate: { lte: endDate } }),
        };

        const [orders, total] = await Promise.all([
          ctx.prisma.purchaseOrder.findMany({
            where,
            include: {
              supplier: true,
              createdBy: { select: { id: true, name: true } },
              _count: { select: { lines: true, goodsReceipts: true } },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          ctx.prisma.purchaseOrder.count({ where }),
        ]);

        return {
          data: orders,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    // Using goodsReceiptProcedure to allow both PROCUREMENT and WAREHOUSE_SALES to view PO details
    getById: goodsReceiptProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const order = await ctx.prisma.purchaseOrder.findUnique({
          where: { id: input.id },
          include: {
            supplier: true,
            branch: true,
            createdBy: { select: { id: true, name: true } },
            approvedBy: { select: { id: true, name: true } },
            lines: { include: { item: { include: { unit: true } } } },
            goodsReceipts: {
              include: {
                receivedBy: { select: { id: true, name: true } },
                lines: true,
              },
            },
            supplierInvoices: {
              select: {
                id: true,
                invoiceNumber: true,
                totalSdg: true,
                paidAmountSdg: true,
                status: true,
                dueDate: true,
              },
            },
          },
        });

        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Purchase order not found",
          });
        }

        return order;
      }),

    create: procurementProcedure
      .input(
        z.object({
          supplierId: z.string().uuid(),
          branchId: z.string().uuid(),
          expectedDate: z.coerce.date().optional(),
          notes: z.string().optional(),
          isConsignment: z.boolean().default(false),
          lines: z
            .array(
              z.object({
                itemId: z.string().uuid(),
                qty: z.number().positive(),
                unitPriceSdg: z.number().nonnegative(),
              })
            )
            .min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Validate branch access
        validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);

        // Enforce day cycle
        const poDayCycle = await getOpenDayCycle(input.branchId);
        if (!poDayCycle) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Day is closed. Please open the day cycle before creating a purchase order.",
          });
        }

        // Generate PO number
        const count = await ctx.prisma.purchaseOrder.count({
          where: { branchId: input.branchId },
        });
        const poNumber = `PO-${String(count + 1).padStart(6, "0")}`;

        // Calculate total
        const totalSdg = input.lines.reduce(
          (sum, line) => sum + line.qty * line.unitPriceSdg,
          0
        );

        // Use transaction to create PO and optionally supplier invoice
        // Increase timeout to 15 seconds to handle multiple operations
        const result = await ctx.prisma.$transaction(
          async (tx) => {
            // If consignment, mark supplier as consignor
            if (input.isConsignment) {
              await tx.supplier.update({
                where: { id: input.supplierId },
                data: { isConsignor: true },
              });
            }

            // Create purchase order
            const order = await tx.purchaseOrder.create({
              data: {
                poNumber,
                supplierId: input.supplierId,
                branchId: input.branchId,
                orderDate: new Date(),
                expectedDate: input.expectedDate,
                totalSdg,
                notes: input.notes,
                createdById: ctx.user.userId,
                lines: {
                  create: input.lines.map((line) => ({
                    itemId: line.itemId,
                    qty: line.qty,
                    unitPriceSdg: line.unitPriceSdg,
                    totalSdg: line.qty * line.unitPriceSdg,
                  })),
                },
              },
              include: {
                supplier: true,
                lines: { include: { item: true } },
              },
            });

            // Create supplier invoice automatically
            const invoiceNumber = `INV-${poNumber.replace('PO-', '')}`;
            const dueDate = input.expectedDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days

            await tx.supplierInvoice.create({
              data: {
                invoiceNumber,
                supplierId: input.supplierId,
                purchaseOrderId: order.id,
                totalSdg,
                invoiceDate: new Date(),
                dueDate,
                status: "CONFIRMED", // Issued status - awaiting goods receipt
                notes: input.isConsignment 
                  ? `Consignment from ${order.supplier.name}` 
                  : `Purchase from ${order.supplier.name}`,
                createdById: ctx.user.userId,
              },
            });

            return order;
          },
          {
            maxWait: 10000, // Maximum time to wait for a transaction slot (10 seconds)
            timeout: 15000, // Maximum time the transaction can run (15 seconds)
          }
        );

        return result;
      }),

    approve: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.purchaseOrder.findUnique({
          where: { id: input.id },
        });

        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Purchase order not found",
          });
        }

        if (order.status !== "DRAFT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Can only approve draft orders",
          });
        }

        return ctx.prisma.purchaseOrder.update({
          where: { id: input.id },
          data: {
            status: "APPROVED",
            approvedById: ctx.user.userId,
            approvedAt: new Date(),
          },
        });
      }),

    cancel: procurementProcedure
      .input(z.object({ id: z.string().uuid(), reason: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.purchaseOrder.findUnique({
          where: { id: input.id },
        });

        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Purchase order not found",
          });
        }

        if (!["DRAFT", "APPROVED"].includes(order.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot cancel order with receipts",
          });
        }

        return ctx.prisma.purchaseOrder.update({
          where: { id: input.id },
          data: {
            status: "CANCELLED",
            notes: input.reason
              ? `${order.notes || ""}\nCancelled: ${input.reason}`
              : order.notes,
          },
        });
      }),
  }),

  // ==================== GOODS RECEIPTS ====================
  goodsReceipts: router({
    // Using goodsReceiptProcedure to allow both PROCUREMENT and WAREHOUSE_SALES to receive goods
    create: goodsReceiptProcedure
      .input(
        z.object({
          purchaseOrderId: z.string().uuid(),
          warehouseId: z.string().uuid(),
          notes: z.string().optional(),
          lines: z
            .array(
              z.object({
                purchaseOrderLineId: z.string().uuid(),
                itemId: z.string().uuid(),
                qtyReceived: z.number().positive(),
                unitCostSdg: z.number().nonnegative(),
                expiryDate: z.coerce.date().optional(),
              })
            )
            .min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Get open day cycle for branch
        const order = await ctx.prisma.purchaseOrder.findUnique({
          where: { id: input.purchaseOrderId },
          include: { lines: true, supplier: true },
        });

        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Purchase order not found",
          });
        }

        if (order.status === "CANCELLED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot receive goods for a cancelled purchase order",
          });
        }

        if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Order must be approved to receive goods",
          });
        }

        // Reject if all linked supplier invoices are cancelled
        const linkedInvoices = await ctx.prisma.supplierInvoice.findMany({
          where: { purchaseOrderId: input.purchaseOrderId },
          select: { id: true, status: true },
        });
        if (
          linkedInvoices.length > 0 &&
          linkedInvoices.every((inv) => inv.status === "CANCELLED")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot receive goods: all linked supplier invoices have been cancelled",
          });
        }

        // Get open day cycle (auto-closes previous days)
        const dayCycle = await getOpenDayCycle(order.branchId);

        if (!dayCycle) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Day must be open to receive goods. Please open the day cycle with an exchange rate first.",
          });
        }

        // Get today's date for receipt
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const exchangeRate = Number(dayCycle.exchangeRateUsdSdg);

        // Generate GR number
        const count = await ctx.prisma.goodsReceipt.count();
        const grNumber = `GR-${String(count + 1).padStart(6, "0")}`;

        // Check if all lines will be fully received
        let isFullyReceived = true;
        for (const line of input.lines) {
          const poLine = order.lines.find(
            (l) => l.id === line.purchaseOrderLineId
          );
          if (!poLine) continue;
          const remainingQty =
            Number(poLine.qty) - Number(poLine.qtyReceived) - line.qtyReceived;
          if (remainingQty > 0) {
            isFullyReceived = false;
            break;
          }
        }

        // Create goods receipt with batches
        // Increase timeout for remote database operations (default 5s is not enough for Neon)
        const receipt = await ctx.prisma.$transaction(
          async (tx) => {
            const gr = await tx.goodsReceipt.create({
            data: {
              grNumber,
              purchaseOrderId: input.purchaseOrderId,
              dayCycleId: dayCycle.id,
              receiptDate: today,
              receiptType: isFullyReceived ? "FULL" : "PARTIAL",
              exchangeRateUsed: exchangeRate,
              notes: input.notes,
              receivedById: ctx.user.userId,
              lines: {
                create: input.lines.map((line) => ({
                  purchaseOrderLineId: line.purchaseOrderLineId,
                  itemId: line.itemId,
                  qtyReceived: line.qtyReceived,
                  unitCostSdg: line.unitCostSdg,
                  unitCostUsd: line.unitCostSdg / exchangeRate,
                  warehouseId: input.warehouseId,
                })),
              },
            },
            include: { lines: true },
          });

          // Create batches for each line
          for (const line of gr.lines) {
            // Find the input line to get expiry date
            const inputLine = input.lines.find(
              (l) => l.purchaseOrderLineId === line.purchaseOrderLineId
            );
            
            await tx.batch.create({
              data: {
                itemId: line.itemId,
                warehouseId: input.warehouseId,
                qtyReceived: line.qtyReceived,
                qtyRemaining: line.qtyReceived,
                unitCostUsd: line.unitCostUsd,
                receivedDate: today,
                goodsReceiptLineId: line.id,
                expiryDate: inputLine?.expiryDate,
              },
            });

            // Create stock movement
            await tx.stockMovement.create({
              data: {
                batchId: (
                  await tx.batch.findFirst({
                    where: { goodsReceiptLineId: line.id },
                  })
                )!.id,
                qty: line.qtyReceived,
                movementType: "RECEIPT",
                referenceId: gr.id,
                referenceType: "GoodsReceipt",
              },
            });

            // Update PO line qty received
            await tx.purchaseOrderLine.update({
              where: { id: line.purchaseOrderLineId },
              data: {
                qtyReceived: {
                  increment: line.qtyReceived,
                },
              },
            });
          }

          // Update PO status
          await tx.purchaseOrder.update({
            where: { id: input.purchaseOrderId },
            data: {
              status: isFullyReceived ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED",
            },
          });

          // Handle supplier invoice: create or update to OUTSTANDING (أجلة) if not fully paid
          const existingInvoices = await tx.supplierInvoice.findMany({
            where: {
              purchaseOrderId: input.purchaseOrderId,
            },
          });

          if (existingInvoices.length === 0) {
            // No invoice exists, create one with OUTSTANDING status (أجلة)
            const invoiceNumber = `INV-${order.poNumber.replace('PO-', '')}`;
            const dueDate = order.expectedDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days
            
            await tx.supplierInvoice.create({
              data: {
                invoiceNumber,
                supplierId: order.supplierId,
                purchaseOrderId: order.id,
                totalSdg: order.totalSdg,
                invoiceDate: today,
                dueDate,
                status: "OUTSTANDING", // أجلة - deferred invoice
                notes: `Goods received without full payment - ${order.poNumber}`,
                createdById: ctx.user.userId,
              },
            });
          } else {
            // Update existing invoices to OUTSTANDING only if not fully paid
            for (const invoice of existingInvoices) {
              const totalAmount = Number(invoice.totalSdg);
              const paidAmount = Number(invoice.paidAmountSdg) || 0;
              const isFullyPaid = paidAmount >= totalAmount;

              if (!isFullyPaid && invoice.status !== "PAID" && invoice.status !== "CANCELLED") {
                await tx.supplierInvoice.update({
                  where: { id: invoice.id },
                  data: {
                    status: "OUTSTANDING", // أجلة - deferred invoice
                  },
                });
              }
            }
          }

            return gr;
          },
          { timeout: 30000 } // 30 seconds for remote database
        );

        return receipt;
      }),

    getByPO: goodsReceiptProcedure
      .input(z.object({ purchaseOrderId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        return ctx.prisma.goodsReceipt.findMany({
          where: { purchaseOrderId: input.purchaseOrderId },
          include: {
            receivedBy: { select: { id: true, name: true } },
            lines: { include: { item: true, warehouse: true } },
          },
          orderBy: { createdAt: "desc" },
        });
      }),
  }),

  // ==================== SUPPLIER INVOICES ====================
  supplierInvoices: router({
    list: procurementProcedure
      .input(
        z.object({
          supplierId: z.string().uuid().optional(),
          status: z
            .enum([
              "DRAFT",
              "CONFIRMED",
              "OUTSTANDING",
              "SCHEDULED",
              "PAID",
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
        const { supplierId, status, startDate, endDate, page, pageSize } = input;

        const where = {
          ...(supplierId && { supplierId }),
          ...(status && { status }),
          ...(startDate && { invoiceDate: { gte: startDate } }),
          ...(endDate && { invoiceDate: { lte: endDate } }),
        };

        const [invoices, total] = await Promise.all([
          ctx.prisma.supplierInvoice.findMany({
            where,
            include: {
              supplier: true,
              purchaseOrder: true,
              _count: { select: { paymentSchedules: true, bankNotices: true } },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { invoiceDate: "desc" },
          }),
          ctx.prisma.supplierInvoice.count({ where }),
        ]);

        return {
          data: invoices,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }),

    create: procurementProcedure
      .input(
        z.object({
          supplierId: z.string().uuid(),
          purchaseOrderId: z.string().uuid().optional(),
          invoiceNumber: z.string().min(1),
          totalSdg: z.number().nonnegative(),
          invoiceDate: z.coerce.date(),
          dueDate: z.coerce.date(),
          notes: z.string().optional(),
          status: z.enum(["DRAFT", "CONFIRMED", "OUTSTANDING", "SCHEDULED", "PAID", "CANCELLED"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        let branchId = ctx.user.branchId;
        if (!branchId && input.purchaseOrderId) {
          const po = await ctx.prisma.purchaseOrder.findUnique({
            where: { id: input.purchaseOrderId },
            select: { branchId: true },
          });
          branchId = po?.branchId || null;
        }
        if (branchId) {
          const openCycle = await getOpenDayCycle(branchId);
          if (!openCycle) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Day is closed. Please open the day cycle before creating a supplier invoice." });
          }
        }
        const { status, ...data } = input;
        return ctx.prisma.supplierInvoice.create({
          data: {
            ...data,
            // Default to CONFIRMED (issued) when created from procurement workflow
            status: status || "CONFIRMED",
            createdById: ctx.user.userId,
          },
          include: { supplier: true },
        });
      }),

    confirm: procurementProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const invoice = await ctx.prisma.supplierInvoice.findUnique({
          where: { id: input.id },
        });

        if (!invoice) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invoice not found",
          });
        }

        if (invoice.status !== "DRAFT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Can only confirm draft invoices",
          });
        }

        return ctx.prisma.supplierInvoice.update({
          where: { id: input.id },
          data: { status: "OUTSTANDING" },
        });
      }),

    addPaymentSchedule: procurementProcedure
      .input(
        z.object({
          invoiceId: z.string().uuid(),
          schedules: z
            .array(
              z.object({
                amountSdg: z.number().positive(),
                dueDate: z.coerce.date(),
                notes: z.string().optional(),
              })
            )
            .min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const invoice = await ctx.prisma.supplierInvoice.findUnique({
          where: { id: input.invoiceId },
        });

        if (!invoice) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invoice not found",
          });
        }

        // Create schedules
        await ctx.prisma.paymentSchedule.createMany({
          data: input.schedules.map((s) => ({
            invoiceId: input.invoiceId,
            ...s,
          })),
        });

        // Update invoice status
        await ctx.prisma.supplierInvoice.update({
          where: { id: input.invoiceId },
          data: { status: "SCHEDULED" },
        });

        return ctx.prisma.paymentSchedule.findMany({
          where: { invoiceId: input.invoiceId },
        });
      }),

    // Admin-only: marking payments as complete requires admin approval
    markSchedulePaid: adminProcedure
      .input(z.object({ scheduleId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const schedule = await ctx.prisma.paymentSchedule.update({
          where: { id: input.scheduleId },
          data: { status: "PAID", paidDate: new Date() },
        });

        // Check if all schedules are paid
        const unpaidCount = await ctx.prisma.paymentSchedule.count({
          where: {
            invoiceId: schedule.invoiceId,
            status: { not: "PAID" },
          },
        });

        if (unpaidCount === 0) {
          await ctx.prisma.supplierInvoice.update({
            where: { id: schedule.invoiceId },
            data: { status: "PAID" },
          });
        }

        return schedule;
      }),

    addBankNotice: procurementProcedure
      .input(
        z.object({
          invoiceId: z.string().uuid(),
          operationNumber: z.string().min(1),
          bankReference: z.string().optional(),
          amountSdg: z.number().positive(),
          fileUrl: z.string().url().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const invoice = await ctx.prisma.supplierInvoice.findUnique({
          where: { id: input.invoiceId },
          include: { purchaseOrder: { select: { branchId: true } } },
        });
        const branchId = ctx.user.branchId || invoice?.purchaseOrder?.branchId;
        if (branchId) {
          const openCycle = await getOpenDayCycle(branchId);
          if (!openCycle) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Day is closed. Please open the day cycle before adding a bank notice." });
          }
        }
        return ctx.prisma.bankNotice.create({
          data: input,
        });
      }),

    getUnmatchedNotices: procurementProcedure.query(async ({ ctx }) => {
      return ctx.prisma.bankNotice.findMany({
        where: { isMatched: false },
        include: { invoice: { include: { supplier: true } } },
        orderBy: { createdAt: "desc" },
      });
    }),
  }),
});

