import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, accountingProcedure, adminProcedure, procurementProcedure, validateBranchAccess } from "../trpc/trpc.js";
import { getOpenDayCycle } from "../lib/dayCycle.js";

export const accountingRouter = router({
  // ==================== ACCOUNTS ====================
  accounts: router({
    list: protectedProcedure
      .input(
        z.object({
          accountType: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]).optional(),
          parentId: z.string().uuid().optional(),
          isActive: z.boolean().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const { accountType, parentId, isActive } = input;

        return ctx.prisma.account.findMany({
          where: {
            ...(accountType && { accountType }),
            ...(parentId && { parentId }),
            ...(isActive !== undefined && { isActive }),
          },
          include: { parent: true, _count: { select: { children: true } } },
          orderBy: { code: "asc" },
        });
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const account = await ctx.prisma.account.findUnique({
          where: { id: input.id },
          include: { parent: true, children: true },
        });

        if (!account) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
        }

        return account;
      }),

    create: adminProcedure
      .input(
        z.object({
          code: z.string().min(1).max(20),
          nameEn: z.string().min(2),
          nameAr: z.string().min(2),
          accountType: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
          parentId: z.string().uuid().optional(),
          description: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.prisma.account.findUnique({
          where: { code: input.code },
        });

        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "Account code already exists" });
        }

        return ctx.prisma.account.create({ data: input });
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          code: z.string().min(1).max(20).optional(),
          nameEn: z.string().min(2).optional(),
          nameAr: z.string().min(2).optional(),
          parentId: z.string().uuid().nullable().optional(),
          description: z.string().optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        return ctx.prisma.account.update({ where: { id }, data });
      }),
  }),

  // ==================== TRANSACTIONS ====================
  transactions: router({
    list: accountingProcedure
      .input(
        z.object({
          branchId: z.string().uuid(),
          transactionType: z.enum(["CASH_IN", "CASH_OUT", "BANK_IN", "BANK_OUT", "TRANSFER", "ADJUSTMENT"]).optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        // Validate branch access
        validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
        
        const { branchId, transactionType, startDate, endDate, page, pageSize } = input;

        const where = {
          branchId,
          ...(transactionType && { transactionType }),
          ...(startDate && { createdAt: { gte: startDate } }),
          ...(endDate && { createdAt: { lte: endDate } }),
        };

        const [transactions, total] = await Promise.all([
          ctx.prisma.transaction.findMany({
            where,
            include: {
              fromAccount: true,
              toAccount: true,
              createdBy: { select: { id: true, name: true } },
              dayCycle: true,
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          ctx.prisma.transaction.count({ where }),
        ]);

        return { data: transactions, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
      }),

    create: accountingProcedure
      .input(
        z.object({
          transactionType: z.enum(["CASH_IN", "CASH_OUT", "BANK_IN", "BANK_OUT", "TRANSFER", "ADJUSTMENT"]),
          amountSdg: z.number().positive(),
          fromAccountId: z.string().uuid().optional(),
          toAccountId: z.string().uuid().optional(),
          description: z.string().min(1),
          referenceNumber: z.string().optional(),
          receiptImages: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.branchId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "User must be assigned to a branch" });
        }

        // Get open day cycle (auto-closes previous days)
        const dayCycle = await getOpenDayCycle(ctx.user.branchId);

        if (!dayCycle) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Day must be open. Please open the day cycle with an exchange rate first." });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const exchangeRate = Number(dayCycle.exchangeRateUsdSdg);
        const amountUsd = input.amountSdg / exchangeRate;

        // Create transaction and journal entry in a transaction
        return ctx.prisma.$transaction(async (tx) => {
          // Create the transaction
          const transaction = await tx.transaction.create({
            data: {
              branchId: ctx.user.branchId!,  // Already checked above
              dayCycleId: dayCycle.id,
              transactionType: input.transactionType,
              amountSdg: input.amountSdg,
              amountUsd,
              fromAccountId: input.fromAccountId,
              toAccountId: input.toAccountId,
              description: input.description,
              referenceNumber: input.referenceNumber,
              receiptImages: input.receiptImages || [],
              createdById: ctx.user.userId,
            },
            include: { fromAccount: true, toAccount: true },
          });

          // Generate journal entry number
          const entryCount = await tx.journalEntry.count({
            where: { dayCycleId: dayCycle.id },
          });
          const entryNumber = `JE-${dayCycle.cycleDate.toISOString().split('T')[0].replace(/-/g, '')}-${String(entryCount + 1).padStart(4, '0')}`;

          // Determine accounts based on transaction type
          let debitAccountId: string | null = null;
          let creditAccountId: string | null = null;

          if (input.transactionType === "CASH_IN") {
            debitAccountId = input.toAccountId || null; // Cash account
            creditAccountId = input.fromAccountId || null; // Revenue or other income source
          } else if (input.transactionType === "CASH_OUT") {
            debitAccountId = input.fromAccountId || null; // Expense or other account
            creditAccountId = input.toAccountId || null; // Cash account
          } else if (input.transactionType === "BANK_IN") {
            debitAccountId = input.toAccountId || null; // Bank account
            creditAccountId = input.fromAccountId || null; // Revenue or other income source
          } else if (input.transactionType === "BANK_OUT") {
            debitAccountId = input.fromAccountId || null; // Expense or other account
            creditAccountId = input.toAccountId || null; // Bank account
          } else if (input.transactionType === "TRANSFER") {
            // Transfer: debit destination, credit source
            debitAccountId = input.toAccountId || null;
            creditAccountId = input.fromAccountId || null;
          } else if (input.transactionType === "ADJUSTMENT") {
            // Adjustment: use provided accounts
            debitAccountId = input.fromAccountId || null;
            creditAccountId = input.toAccountId || null;
          }

          // If accounts are not provided, try to find them by code
          if (!debitAccountId || !creditAccountId) {
            const cashAccount = input.transactionType.includes("CASH") 
              ? await tx.account.findFirst({ where: { code: "1000", isActive: true } })
              : null;
            const bankAccount = input.transactionType.includes("BANK")
              ? await tx.account.findFirst({ where: { code: "1100", isActive: true } })
              : null;

            if (input.transactionType === "CASH_IN" && !debitAccountId) {
              debitAccountId = cashAccount?.id || null;
            } else if (input.transactionType === "CASH_OUT" && !creditAccountId) {
              creditAccountId = cashAccount?.id || null;
            } else if (input.transactionType === "BANK_IN" && !debitAccountId) {
              debitAccountId = bankAccount?.id || null;
            } else if (input.transactionType === "BANK_OUT" && !creditAccountId) {
              creditAccountId = bankAccount?.id || null;
            } else if (input.transactionType === "TRANSFER") {
              if (!debitAccountId && input.toAccountId) {
                const toAccount = await tx.account.findUnique({ where: { id: input.toAccountId } });
                debitAccountId = toAccount?.id || null;
              }
              if (!creditAccountId && input.fromAccountId) {
                const fromAccount = await tx.account.findUnique({ where: { id: input.fromAccountId } });
                creditAccountId = fromAccount?.id || null;
              }
            }
          }

          // Create journal entry with lines
          if (debitAccountId && creditAccountId) {
            const journalEntry = await tx.journalEntry.create({
              data: {
                entryNumber,
                dayCycleId: dayCycle.id,
                entryDate: today,
                description: input.description,
                referenceId: transaction.id,
                referenceType: "Transaction",
                isPosted: true,
                postedAt: new Date(),
                postedById: ctx.user.userId,
                lines: {
                  create: [
                    {
                      accountId: debitAccountId,
                      debitSdg: input.amountSdg,
                      debitUsd: amountUsd,
                      creditSdg: 0,
                      creditUsd: 0,
                      description: input.description,
                    },
                    {
                      accountId: creditAccountId,
                      debitSdg: 0,
                      debitUsd: 0,
                      creditSdg: input.amountSdg,
                      creditUsd: amountUsd,
                      description: input.description,
                    },
                  ],
                },
              },
            });
          }

          return transaction;
        });
      }),
  }),

  // ==================== EXPENSES ====================
  expenses: router({
    categories: router({
      list: protectedProcedure.query(async ({ ctx }) => {
        return ctx.prisma.expenseCategory.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
        });
      }),

      create: adminProcedure
        .input(z.object({ name: z.string().min(2), nameAr: z.string().min(2) }))
        .mutation(async ({ ctx, input }) => {
          return ctx.prisma.expenseCategory.create({ data: input });
        }),
    }),

    list: accountingProcedure
      .input(
        z.object({
          branchId: z.string().uuid(),
          categoryId: z.string().uuid().optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        // Validate branch access
        validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
        
        const { branchId, categoryId, startDate, endDate, page, pageSize } = input;

        const where = {
          branchId,
          ...(categoryId && { categoryId }),
          ...(startDate && { createdAt: { gte: startDate } }),
          ...(endDate && { createdAt: { lte: endDate } }),
        };

        const [expenses, total] = await Promise.all([
          ctx.prisma.expense.findMany({
            where,
            include: {
              category: true,
              createdBy: { select: { id: true, name: true } },
              approvedBy: { select: { id: true, name: true } },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          ctx.prisma.expense.count({ where }),
        ]);

        return { data: expenses, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
      }),

    create: accountingProcedure
      .input(
        z.object({
          categoryId: z.string().uuid(),
          amountSdg: z.number().positive(),
          description: z.string().min(1),
          paymentMethod: z.enum(["CASH", "BANK_TRANSFER"]).optional(),
          receiptImageUrl: z.string().url().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.branchId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "User must be assigned to a branch" });
        }

        const dayCycle = await getOpenDayCycle(ctx.user.branchId);

        if (!dayCycle) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Day must be open. Please open the day cycle with an exchange rate first." });
        }

        return ctx.prisma.expense.create({
          data: {
            branchId: ctx.user.branchId,
            dayCycleId: dayCycle.id,
            categoryId: input.categoryId,
            amountSdg: input.amountSdg,
            description: input.description,
            ...(input.paymentMethod && { paymentMethod: input.paymentMethod as any }),
            ...(input.receiptImageUrl && { receiptImageUrl: input.receiptImageUrl }),
            createdById: ctx.user.userId,
          },
          include: { category: true },
        });
      }),

    approve: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.expense.update({
          where: { id: input.id },
          data: { approvedById: ctx.user.userId, approvedAt: new Date() },
        });
      }),
  }),

  // ==================== REPORTS ====================
  reports: router({
    liquidAssets: accountingProcedure
      .input(z.object({ branchId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        // Validate branch access
        validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
        
        const accounts = await ctx.prisma.account.findMany({
          where: { accountType: "ASSET", isActive: true },
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dayCycle = await ctx.prisma.dayCycle.findFirst({
          where: { branchId: input.branchId, cycleDate: today },
        });

        const exchangeRate = dayCycle ? Number(dayCycle.exchangeRateUsdSdg) : 1;

        // Calculate balances from journal entries
        const balances = await Promise.all(
          accounts.map(async (account) => {
            const result = await ctx.prisma.journalLine.aggregate({
              where: { accountId: account.id, journalEntry: { isPosted: true } },
              _sum: { debitSdg: true, creditSdg: true, debitUsd: true, creditUsd: true },
            });

            const balanceSdg = Number(result._sum.debitSdg || 0) - Number(result._sum.creditSdg || 0);
            const balanceUsd = Number(result._sum.debitUsd || 0) - Number(result._sum.creditUsd || 0);

            return { account, balanceSdg, balanceUsd };
          })
        );

        // Calculate inventory value from all batches in shelves and warehouses
        const shelves = await ctx.prisma.shelf.findMany({
          where: { isActive: true },
          select: { id: true },
        });

        const warehouses = await ctx.prisma.warehouse.findMany({
          where: { isActive: true },
          select: { id: true },
        });

        const shelfIds = shelves.map(s => s.id);
        const warehouseIds = warehouses.map(w => w.id);

        // Get all batches with remaining quantity in shelves and warehouses
        const batches = await ctx.prisma.batch.findMany({
          where: {
            OR: [
              { shelfId: { in: shelfIds } },
              { warehouseId: { in: warehouseIds } },
            ],
            qtyRemaining: { gt: 0 },
          },
          select: {
            qtyRemaining: true,
            unitCostUsd: true,
          },
        });

        // Calculate total inventory value in SDG
        const inventoryValueUsd = batches.reduce((sum, batch) => {
          return sum + (Number(batch.qtyRemaining) * Number(batch.unitCostUsd));
        }, 0);
        const inventoryValueSdg = inventoryValueUsd * exchangeRate;

        // Find cash account (code "1000" or name containing "Cash")
        const cashAccount = accounts.find(
          acc => acc.code === "1000" || 
          acc.nameEn.toLowerCase().includes("cash") || 
          acc.nameAr?.toLowerCase().includes("نقد")
        );
        const cashBalance = cashAccount 
          ? balances.find(b => b.account.id === cashAccount.id)?.balanceSdg || 0
          : 0;

        // Find Bank of Khartoum account (name containing "Bank" and "Khartoum" or similar)
        const bankAccount = accounts.find(
          acc => 
          (acc.nameEn.toLowerCase().includes("bank") && acc.nameEn.toLowerCase().includes("khartoum")) ||
          (acc.nameAr?.toLowerCase().includes("بنك") && acc.nameAr?.toLowerCase().includes("خرطوم")) ||
          acc.code === "1100" // Default bank account code
        );
        const bankBalance = bankAccount
          ? balances.find(b => b.account.id === bankAccount.id)?.balanceSdg || 0
          : 0;

        const totalSdg = balances.reduce((sum, b) => sum + b.balanceSdg, 0) + inventoryValueSdg;
        const totalUsd = balances.reduce((sum, b) => sum + b.balanceUsd, 0) + inventoryValueUsd;

        // Calculate today's income and expenses from journal entries
        const todayStart = new Date(today);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(today);
        todayEnd.setHours(23, 59, 59, 999);

        // Find revenue account (code "4000")
        const revenueAccount = await ctx.prisma.account.findFirst({
          where: { code: "4000", isActive: true },
        });

        // Find expense accounts
        const expenseAccounts = await ctx.prisma.account.findMany({
          where: { accountType: "EXPENSE", isActive: true },
        });

        // Calculate today's income (revenue credits)
        let todayIncome = 0;
        if (revenueAccount) {
          const revenueResult = await ctx.prisma.journalLine.aggregate({
            where: {
              accountId: revenueAccount.id,
              journalEntry: {
                isPosted: true,
                entryDate: { gte: todayStart, lte: todayEnd },
              },
            },
            _sum: { creditSdg: true },
          });
          todayIncome = Number(revenueResult._sum.creditSdg || 0);
        }

        // Calculate today's expenses (expense debits)
        let todayExpenses = 0;
        if (expenseAccounts.length > 0) {
          const expenseAccountIds = expenseAccounts.map(acc => acc.id);
          const expenseResult = await ctx.prisma.journalLine.aggregate({
            where: {
              accountId: { in: expenseAccountIds },
              journalEntry: {
                isPosted: true,
                entryDate: { gte: todayStart, lte: todayEnd },
              },
            },
            _sum: { debitSdg: true },
          });
          todayExpenses = Number(expenseResult._sum.debitSdg || 0);
        }

        // Also check expense records for today
        const todayExpenseRecords = await ctx.prisma.expense.aggregate({
          where: {
            branchId: input.branchId,
            createdAt: { gte: todayStart, lte: todayEnd },
          },
          _sum: { amountSdg: true },
        });
        todayExpenses += Number(todayExpenseRecords._sum.amountSdg || 0);

        // Calculate Accounts Receivable (ذمم مدينة) - from customer balances
        const accountsReceivableAccount = await ctx.prisma.account.findFirst({
          where: { code: "1200", isActive: true },
        });
        let accountsReceivable = 0;
        if (accountsReceivableAccount) {
          const arResult = await ctx.prisma.journalLine.aggregate({
            where: {
              accountId: accountsReceivableAccount.id,
              journalEntry: { isPosted: true },
            },
            _sum: { debitSdg: true, creditSdg: true },
          });
          accountsReceivable = Number(arResult._sum.debitSdg || 0) - Number(arResult._sum.creditSdg || 0);
        }

        // Also get from customer balances directly
        const customers = await ctx.prisma.customer.findMany({
          where: { isActive: true },
          select: { balanceSdg: true },
        });
        const customerBalances = customers.reduce((sum, c) => sum + Number(c.balanceSdg || 0), 0);
        if (customerBalances > 0) {
          accountsReceivable = customerBalances;
        }

        return { 
          accounts: balances, 
          totalSdg, 
          totalUsd, 
          exchangeRate,
          inventoryValue: {
            valueSdg: inventoryValueSdg,
            valueUsd: inventoryValueUsd,
          },
          cash: {
            balanceSdg: cashBalance,
            account: cashAccount,
          },
          bankOfKhartoum: {
            balanceSdg: bankBalance,
            account: bankAccount,
          },
          dailyStats: {
            income: todayIncome,
            expenses: todayExpenses,
          },
          accountsReceivable: accountsReceivable,
        };
      }),

    // Using procurementProcedure so PROCUREMENT users can view outstanding supplier invoices
    outstandingPayables: procurementProcedure
      .input(z.object({ 
        branchId: z.string().uuid().optional(),
        supplierId: z.string().uuid().optional() 
      }))
      .query(async ({ ctx, input }) => {
        // Determine which branch to query - user's branch by default, or specified if admin/manager
        const branchId = input.branchId || ctx.user.branchId;
        
        if (!branchId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Branch ID is required" });
        }
        
        validateBranchAccess(ctx.user.branchId, ctx.user.role, branchId);
        
        // Filter by branch through purchase order relation
        const invoices = await ctx.prisma.supplierInvoice.findMany({
          where: {
            status: { in: ["OUTSTANDING", "SCHEDULED"] },
            ...(input.supplierId && { supplierId: input.supplierId }),
            // Filter by branch through purchase order
            purchaseOrder: { branchId },
          },
          include: { supplier: true, paymentSchedules: true, purchaseOrder: { select: { branchId: true } } },
          orderBy: { dueDate: "asc" },
        });

        // Calculate total remaining payables (total - paid) for all outstanding invoices
        // Ensure paidAmountSdg is treated as 0 if null
        const totalOutstanding = invoices.reduce((sum, inv) => {
          const totalAmount = Number(inv.totalSdg || 0);
          const paidAmount = Number(inv.paidAmountSdg || 0);
          const remaining = totalAmount - paidAmount;
          
          // Debug logging for invoices with 0 remaining
          if (remaining <= 0 && totalAmount > 0) {
            console.log(`Invoice ${inv.invoiceNumber} has 0 remaining: total=${totalAmount}, paid=${paidAmount}`);
          }
          
          return sum + (remaining > 0 ? remaining : 0);
        }, 0);

        // Group by aging
        const today = new Date();
        const aging = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };

        for (const inv of invoices) {
          const daysDiff = Math.floor((today.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24));
          const amount = Number(inv.totalSdg) - Number(inv.paidAmountSdg || 0);

          if (daysDiff <= 0) aging.current += amount;
          else if (daysDiff <= 30) aging.days30 += amount;
          else if (daysDiff <= 60) aging.days60 += amount;
          else if (daysDiff <= 90) aging.days90 += amount;
          else aging.over90 += amount;
        }

        console.log(`Outstanding Payables: Found ${invoices.length} invoices, Total: ${totalOutstanding} SDG`);
        return { invoices, totalPayables: totalOutstanding, totalOutstanding, aging };
      }),

    outstandingReceivables: accountingProcedure
      .input(z.object({ 
        branchId: z.string().uuid().optional(),
        customerId: z.string().uuid().optional() 
      }))
      .query(async ({ ctx, input }) => {
        // Determine which branch to query - user's branch by default, or specified if admin/manager
        const branchId = input.branchId || ctx.user.branchId;
        
        if (!branchId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Branch ID is required" });
        }
        
        validateBranchAccess(ctx.user.branchId, ctx.user.role, branchId);
        
        // Get all outstanding invoices - filter by branch through shelf.user.branchId
        const invoices = await ctx.prisma.salesInvoice.findMany({
          where: {
            status: { in: ["ISSUED", "PARTIALLY_PAID"] },
            ...(input.customerId && { customerId: input.customerId }),
            // Filter by branch through shelf's user
            shelf: {
              user: {
                branchId
              }
            }
          },
          include: { 
            customer: true, 
            shelf: { 
              include: { 
                user: { 
                  select: { branchId: true } 
                } 
              } 
            } 
          },
          orderBy: { invoiceDate: "asc" },
        });

        // Calculate total remaining receivables (total - paid) for all outstanding invoices
        // Ensure paidAmountSdg is treated as 0 if null
        const totalReceivables = invoices.reduce((sum, inv) => {
          const totalAmount = Number(inv.totalSdg || 0);
          const paidAmount = Number(inv.paidAmountSdg || 0);
          const remaining = totalAmount - paidAmount;
          
          // Debug logging for invoices with 0 remaining
          if (remaining <= 0 && totalAmount > 0) {
            console.log(`Invoice ${inv.invoiceNumber} has 0 remaining: total=${totalAmount}, paid=${paidAmount}`);
          }
          
          return sum + (remaining > 0 ? remaining : 0);
        }, 0);

        console.log(`Outstanding Receivables: Found ${invoices.length} invoices, Total: ${totalReceivables} SDG`);
        return { invoices, totalReceivables };
      }),

    balanceSheet: accountingProcedure
      .input(
        z.object({
          branchId: z.string().uuid(),
          asOfDate: z.coerce.date().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        // Validate branch access
        validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
        
        const asOfDate = input.asOfDate || new Date();

        const accounts = await ctx.prisma.account.findMany({
          where: { isActive: true },
          orderBy: { code: "asc" },
        });

        const balances = await Promise.all(
          accounts.map(async (account) => {
            const result = await ctx.prisma.journalLine.aggregate({
              where: {
                accountId: account.id,
                journalEntry: {
                  isPosted: true,
                  entryDate: { lte: asOfDate },
                },
              },
              _sum: { debitSdg: true, creditSdg: true, debitUsd: true, creditUsd: true },
            });

            let balanceSdg = Number(result._sum.debitSdg || 0) - Number(result._sum.creditSdg || 0);
            let balanceUsd = Number(result._sum.debitUsd || 0) - Number(result._sum.creditUsd || 0);

            // For liability, equity, revenue - credit increases balance
            if (["LIABILITY", "EQUITY", "REVENUE"].includes(account.accountType)) {
              balanceSdg = -balanceSdg;
              balanceUsd = -balanceUsd;
            }

            return { ...account, balanceSdg, balanceUsd };
          })
        );

        // Group by type
        const assets = balances.filter((a) => a.accountType === "ASSET");
        const liabilities = balances.filter((a) => a.accountType === "LIABILITY");
        const equity = balances.filter((a) => a.accountType === "EQUITY");
        const revenue = balances.filter((a) => a.accountType === "REVENUE");
        const expenses = balances.filter((a) => a.accountType === "EXPENSE");

        const totalAssets = assets.reduce((sum, a) => sum + a.balanceSdg, 0);
        const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balanceSdg, 0);
        const totalEquity = equity.reduce((sum, a) => sum + a.balanceSdg, 0);
        const totalRevenue = revenue.reduce((sum, a) => sum + a.balanceSdg, 0);
        const totalExpenses = expenses.reduce((sum, a) => sum + a.balanceSdg, 0);
        const netIncome = totalRevenue - totalExpenses;

        return {
          asOfDate,
          assets: { accounts: assets, total: totalAssets },
          liabilities: { accounts: liabilities, total: totalLiabilities },
          equity: { accounts: equity, total: totalEquity },
          revenue: { accounts: revenue, total: totalRevenue },
          expenses: { accounts: expenses, total: totalExpenses },
          netIncome,
          liabilitiesAndEquity: totalLiabilities + totalEquity + netIncome,
        };
      }),

    userSalesProfit: adminProcedure
      .input(
        z.object({
          dateFrom: z.coerce.date().optional(),
          dateTo: z.coerce.date().optional(),
          userId: z.string().uuid().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const { dateFrom, dateTo, userId } = input;

        const whereInvoice: any = {};
        if (dateFrom) whereInvoice.invoiceDate = { ...(whereInvoice.invoiceDate || {}), gte: dateFrom };
        if (dateTo) whereInvoice.invoiceDate = { ...(whereInvoice.invoiceDate || {}), lte: dateTo };
        if (userId) whereInvoice.createdById = userId;

        const invoices = await ctx.prisma.salesInvoice.findMany({
          where: whereInvoice,
          include: {
            createdBy: { select: { id: true, name: true, nameAr: true, email: true } },
            lines: true,
          },
        });

        const userMap = new Map<string, {
          user: { id: string; name: string; nameAr: string | null; email: string };
          totalSalesUsd: number;
          totalSalesSdg: number;
          totalCOGS: number;
          grossProfit: number;
          invoiceCount: number;
          itemsSold: number;
        }>();

        for (const inv of invoices) {
          const uid = inv.createdById;
          if (!userMap.has(uid)) {
            userMap.set(uid, {
              user: inv.createdBy,
              totalSalesUsd: 0,
              totalSalesSdg: 0,
              totalCOGS: 0,
              grossProfit: 0,
              invoiceCount: 0,
              itemsSold: 0,
            });
          }
          const entry = userMap.get(uid)!;
          entry.invoiceCount++;
          entry.totalSalesUsd += Number(inv.totalUsd);
          entry.totalSalesSdg += Number(inv.totalSdg);
          for (const line of inv.lines) {
            const qty = Number(line.qty);
            const revenue = Number(line.unitPriceUsd) * qty;
            const cost = Number(line.unitCostUsd) * qty;
            entry.totalCOGS += cost;
            entry.grossProfit += revenue - cost;
            entry.itemsSold += qty;
          }
        }

        const results = Array.from(userMap.values()).sort((a, b) => b.grossProfit - a.grossProfit);
        const totalRevenue = results.reduce((s, r) => s + r.totalSalesUsd, 0);
        const totalCOGS = results.reduce((s, r) => s + r.totalCOGS, 0);
        const totalProfit = results.reduce((s, r) => s + r.grossProfit, 0);

        return {
          users: results,
          summary: {
            totalRevenue,
            totalCOGS,
            totalProfit,
            profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
          },
        };
      }),

    dashboard: protectedProcedure
      .input(z.object({ branchId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        // Validate branch access
        validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dayCycle = await ctx.prisma.dayCycle.findFirst({
          where: { branchId: input.branchId, cycleDate: today },
        });

        const [pendingOrders, pendingRequests, lowStockItems, todaySales, todayExpenses, outstandingPayables, outstandingReceivables] = await Promise.all([
          ctx.prisma.salesOrder.count({ where: { branchId: input.branchId, status: "DRAFT" } }),
          ctx.prisma.goodsRequest.count({ where: { status: "SUBMITTED" } }),
          ctx.prisma.item.count({ where: { isActive: true, minStockLevel: { not: null } } }), // Simplified
          dayCycle
            ? ctx.prisma.salesInvoice.aggregate({
                where: { dayCycleId: dayCycle.id },
                _sum: { totalSdg: true },
              })
            : { _sum: { totalSdg: null } },
          dayCycle
            ? ctx.prisma.expense.aggregate({
                where: { dayCycleId: dayCycle.id },
                _sum: { amountSdg: true },
              })
            : { _sum: { amountSdg: null } },
          ctx.prisma.supplierInvoice.aggregate({
            where: {
              status: { in: ["OUTSTANDING", "SCHEDULED"] },
              purchaseOrder: { branchId: input.branchId },
            },
            _sum: { totalSdg: true },
          }),
          ctx.prisma.salesInvoice.aggregate({
            where: {
              status: { in: ["ISSUED", "PARTIALLY_PAID"] },
              shelf: { user: { branchId: input.branchId } },
            },
            _sum: { totalSdg: true },
          }),
        ]);

        return {
          dayCycle,
          pendingOrders,
          pendingRequests,
          lowStockItems,
          todaySales: Number(todaySales._sum.totalSdg || 0),
          todayExpenses: Number(todayExpenses._sum.amountSdg || 0),
          outstandingPayables: Number(outstandingPayables._sum?.totalSdg || 0),
          outstandingReceivables: Number(outstandingReceivables._sum?.totalSdg || 0),
        };
      }),
  }),

  // ==================== BUDGET ====================
  budget: router({
    list: accountingProcedure
      .input(
        z.object({
          branchId: z.string().uuid(),
          period: z.string().optional(), // YYYY-MM format
        })
      )
      .query(async ({ ctx, input }) => {
        // Validate branch access
        validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
        
        const { branchId, period } = input;
        
        // Calculate date range
        let startDate: Date;
        let endDate: Date;
        
        if (period) {
          const [year, month] = period.split('-').map(Number);
          startDate = new Date(year, month - 1, 1);
          endDate = new Date(year, month, 0);
        } else {
          // Current month
          const now = new Date();
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        }
        
        // Get expenses for the period grouped by category
        const expenses = await ctx.prisma.expense.groupBy({
          by: ['categoryId'],
          where: {
            branchId,
            createdAt: { gte: startDate, lte: endDate },
          },
          _sum: { amountSdg: true },
        });
        
        // Get category details
        const categories = await ctx.prisma.expenseCategory.findMany({
          where: { isActive: true },
        });
        
        // Get day cycle for exchange rate
        const dayCycle = await ctx.prisma.dayCycle.findFirst({
          where: { branchId },
          orderBy: { cycleDate: 'desc' },
        });
        const exchangeRate = dayCycle ? Number(dayCycle.exchangeRateUsdSdg) : 1;
        
        // Map expenses with categories
        const budgetItems = categories.map(cat => {
          const expense = expenses.find(e => e.categoryId === cat.id);
          const spentSdg = Number(expense?._sum?.amountSdg || 0);
          return {
            categoryId: cat.id,
            categoryName: cat.name,
            categoryNameAr: cat.nameAr,
            allocatedSdg: 0, // Can be enhanced with budget allocation table
            spentSdg,
            spentUsd: spentSdg / exchangeRate,
            remainingSdg: 0 - spentSdg,
          };
        });
        
        const totalSpentSdg = budgetItems.reduce((sum, item) => sum + item.spentSdg, 0);
        
        return {
          period: period || `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`,
          startDate,
          endDate,
          items: budgetItems,
          totalSpentSdg,
          totalSpentUsd: totalSpentSdg / exchangeRate,
          exchangeRate,
        };
      }),

    getPreviousPeriods: accountingProcedure
      .input(
        z.object({
          branchId: z.string().uuid(),
          months: z.number().int().positive().default(6),
        })
      )
      .query(async ({ ctx, input }) => {
        // Validate branch access
        validateBranchAccess(ctx.user.branchId, ctx.user.role, input.branchId);
        
        const { branchId, months } = input;
        
        const periods = [];
        const now = new Date();
        
        for (let i = 1; i <= months; i++) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
          const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
          
          const totalExpenses = await ctx.prisma.expense.aggregate({
            where: {
              branchId,
              createdAt: { gte: startDate, lte: endDate },
            },
            _sum: { amountSdg: true },
          });
          
          periods.push({
            period: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`,
            monthName: startDate.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
            monthNameAr: startDate.toLocaleString('ar-SA', { month: 'long', year: 'numeric' }),
            totalSdg: Number(totalExpenses._sum.amountSdg || 0),
          });
        }
        
        return periods;
      }),
  }),

  // ==================== PAYMENT SCHEDULES ====================
  paymentSchedules: router({
    list: accountingProcedure
      .input(
        z.object({
          status: z.enum(["PENDING", "PAID", "OVERDUE", "CANCELLED"]).optional(),
          supplierId: z.string().uuid().optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { status, supplierId, startDate, endDate, page, pageSize } = input;
        
        const where: any = {
          ...(status && { status }),
          ...(startDate && { dueDate: { gte: startDate } }),
          ...(endDate && { dueDate: { lte: endDate } }),
        };
        
        if (supplierId) {
          where.invoice = { supplierId };
        }
        
        const [schedules, total] = await Promise.all([
          ctx.prisma.paymentSchedule.findMany({
            where,
            include: {
              invoice: {
                include: { supplier: true },
              },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { dueDate: 'asc' },
          }),
          ctx.prisma.paymentSchedule.count({ where }),
        ]);
        
        // Calculate totals
        const totalPending = schedules.filter(s => s.status === 'PENDING').reduce((sum, s) => sum + Number(s.amountSdg), 0);
        const totalOverdue = schedules.filter(s => s.status === 'OVERDUE').reduce((sum, s) => sum + Number(s.amountSdg), 0);
        
        return { data: schedules, total, page, pageSize, totalPages: Math.ceil(total / pageSize), totalPending, totalOverdue };
      }),

    create: accountingProcedure
      .input(
        z.object({
          invoiceId: z.string().uuid(),
          amountSdg: z.number().positive(),
          dueDate: z.coerce.date(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.paymentSchedule.create({
          data: input,
          include: { invoice: true },
        });
      }),

    markPaid: accountingProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.paymentSchedule.update({
          where: { id: input.id },
          data: { status: 'PAID', paidDate: new Date() },
        });
      }),

    updateOverdue: protectedProcedure.mutation(async ({ ctx }) => {
      // Mark all pending schedules past due date as overdue
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      await ctx.prisma.paymentSchedule.updateMany({
        where: {
          status: 'PENDING',
          dueDate: { lt: today },
        },
        data: { status: 'OVERDUE' },
      });
      
      return { success: true };
    }),
  }),

  // ==================== BANK NOTICES (Match Operation) ====================
  bankNotices: router({
    list: accountingProcedure
      .input(
        z.object({
          isMatched: z.boolean().optional(),
          supplierId: z.string().uuid().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { isMatched, supplierId, page, pageSize } = input;
        
        const where: any = {
          ...(isMatched !== undefined && { isMatched }),
        };
        
        if (supplierId) {
          where.invoice = { supplierId };
        }
        
        const [notices, total] = await Promise.all([
          ctx.prisma.bankNotice.findMany({
            where,
            include: {
              invoice: {
                include: { supplier: true },
              },
              matchedBy: { select: { id: true, name: true } },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: 'desc' },
          }),
          ctx.prisma.bankNotice.count({ where }),
        ]);
        
        return { data: notices, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
      }),

    create: accountingProcedure
      .input(
        z.object({
          invoiceId: z.string().uuid(),
          operationNumber: z.string().min(1),
          bankReference: z.string().optional(),
          amountSdg: z.number().positive(),
          fileUrl: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.bankNotice.create({
          data: input,
          include: { invoice: { include: { supplier: true } } },
        });
      }),

    match: accountingProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          operationNumber: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Find the bank notice
        const notice = await ctx.prisma.bankNotice.findUnique({
          where: { id: input.id },
          include: { invoice: true },
        });
        
        if (!notice) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Bank notice not found" });
        }
        
        if (notice.isMatched) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Notice already matched" });
        }
        
        // Update notice as matched
        const updated = await ctx.prisma.bankNotice.update({
          where: { id: input.id },
          data: {
            isMatched: true,
            matchedAt: new Date(),
            matchedById: ctx.user.userId,
          },
          include: { invoice: { include: { supplier: true } }, matchedBy: { select: { id: true, name: true } } },
        });
        
        // Determine if invoice is fully paid by summing all matched notices
        const allMatchedNotices = await ctx.prisma.bankNotice.findMany({
          where: { invoiceId: notice.invoiceId, isMatched: true },
        });
        const totalPaid = allMatchedNotices.reduce((sum, n) => sum + Number(n.amountSdg), 0) + Number(notice.amountSdg);
        const invoiceTotal = Number(notice.invoice.totalSdg);
        const newStatus = totalPaid >= invoiceTotal ? 'PAID' : 'OUTSTANDING';

        await ctx.prisma.supplierInvoice.update({
          where: { id: notice.invoiceId },
          data: {
            status: newStatus,
            paidAmountSdg: totalPaid,
          },
        });
        
        return updated;
      }),

    unmatch: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.bankNotice.update({
          where: { id: input.id },
          data: {
            isMatched: false,
            matchedAt: null,
            matchedById: null,
          },
        });
      }),
  }),

  // ==================== SUPPLIER INVOICES (for consignment/deferred/issued) ====================
  // Note: Using procurementProcedure to allow PROCUREMENT users to view supplier invoices
  supplierInvoices: router({
    list: procurementProcedure
      .input(
        z.object({
          status: z.enum(["DRAFT", "CONFIRMED", "OUTSTANDING", "SCHEDULED", "PAID", "CANCELLED"]).optional(),
          supplierId: z.string().uuid().optional(),
          isConsignment: z.boolean().optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { status, supplierId, isConsignment, startDate, endDate, page, pageSize } = input;
        
        const where: any = {
          ...(status && { status }),
          ...(supplierId && { supplierId }),
          ...(startDate && { invoiceDate: { gte: startDate } }),
          ...(endDate && { invoiceDate: { lte: endDate } }),
        };
        
        // For consignment invoices, filter by supplier isConsignor
        if (isConsignment !== undefined) {
          where.supplier = { isConsignor: isConsignment };
        }
        
        const [invoices, total] = await Promise.all([
          ctx.prisma.supplierInvoice.findMany({
            where,
            include: {
              supplier: true,
              purchaseOrder: true,
              paymentSchedules: true,
              bankNotices: true,
              createdBy: { select: { id: true, name: true } },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { invoiceDate: 'desc' },
          }),
          ctx.prisma.supplierInvoice.count({ where }),
        ]);
        
        return { data: invoices, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
      }),

    // Get deferred invoices (OUTSTANDING or SCHEDULED status)
    listDeferred: procurementProcedure
      .input(
        z.object({
          supplierId: z.string().uuid().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { supplierId, page, pageSize } = input;
        
        const where = {
          status: { in: ['OUTSTANDING', 'SCHEDULED'] as ['OUTSTANDING', 'SCHEDULED'] },
          ...(supplierId && { supplierId }),
        };
        
        const [invoices, total] = await Promise.all([
          ctx.prisma.supplierInvoice.findMany({
            where,
            include: {
              supplier: true,
              paymentSchedules: { orderBy: { dueDate: 'asc' } },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { dueDate: 'asc' },
          }),
          ctx.prisma.supplierInvoice.count({ where }),
        ]);
        
        const totalAmount = invoices.reduce((sum, inv) => sum + Number(inv.totalSdg), 0);
        
        return { data: invoices, total, page, pageSize, totalPages: Math.ceil(total / pageSize), totalAmount };
      }),

    // Get issued invoices (CONFIRMED status)
    listIssued: procurementProcedure
      .input(
        z.object({
          supplierId: z.string().uuid().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { supplierId, page, pageSize } = input;
        
        const where = {
          status: 'CONFIRMED' as const,
          ...(supplierId && { supplierId }),
        };
        
        const [invoices, total] = await Promise.all([
          ctx.prisma.supplierInvoice.findMany({
            where,
            include: {
              supplier: true,
              purchaseOrder: true,
              createdBy: { select: { id: true, name: true } },
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { invoiceDate: 'desc' },
          }),
          ctx.prisma.supplierInvoice.count({ where }),
        ]);
        
        return { data: invoices, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
      }),

    // Get consignment invoices
    listConsignment: procurementProcedure
      .input(
        z.object({
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { page, pageSize } = input;
        
        const where = {
          supplier: { isConsignor: true },
        };
        
        const [invoices, total] = await Promise.all([
          ctx.prisma.supplierInvoice.findMany({
            where,
            include: {
              supplier: true,
              purchaseOrder: true,
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { invoiceDate: 'desc' },
          }),
          ctx.prisma.supplierInvoice.count({ where }),
        ]);
        
        return { data: invoices, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
      }),

    updateStatus: procurementProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.enum(["DRAFT", "CONFIRMED", "OUTSTANDING", "SCHEDULED", "PAID", "CANCELLED"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.supplierInvoice.update({
          where: { id: input.id },
          data: { status: input.status },
          include: { supplier: true },
        });
      }),

    // Pay invoice - Admin only (supports full and partial payments)
    payInvoice: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          paymentMethod: z.enum(["CASH", "BANK_TRANSFER"]),
          transactionNumber: z.string().optional(),
          receiptImageUrl: z.string().optional(),
          paidAmountSdg: z.number().positive().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // For bank transfer, require transaction number (receipt image is optional for now)
        if (input.paymentMethod === "BANK_TRANSFER") {
          if (!input.transactionNumber) {
            throw new TRPCError({ 
              code: "BAD_REQUEST", 
              message: "Transaction number is required for bank transfer" 
            });
          }
        }

        const invoice = await ctx.prisma.supplierInvoice.findUnique({
          where: { id: input.id },
        });

        if (!invoice) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        }

        const totalAmount = Number(invoice.totalSdg);
        const previouslyPaid = Number(invoice.paidAmountSdg) || 0;
        const newPaymentAmount = input.paidAmountSdg || (totalAmount - previouslyPaid);
        const totalPaid = previouslyPaid + newPaymentAmount;
        
        // Determine if invoice is fully paid or partially paid
        const isFullyPaid = totalPaid >= totalAmount;
        const newStatus = isFullyPaid ? "PAID" : "OUTSTANDING";

        return ctx.prisma.supplierInvoice.update({
          where: { id: input.id },
          data: {
            status: newStatus,
            paymentMethod: input.paymentMethod,
            paidDate: isFullyPaid ? new Date() : null,
            paidAmountSdg: totalPaid,
            transactionNumber: input.transactionNumber,
            receiptImageUrl: input.receiptImageUrl,
            paidById: ctx.user.userId,
          },
          include: { supplier: true, purchaseOrder: true },
        });
      }),

    // Mark invoice as outstanding (ready for goods receipt)
    markOutstanding: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.supplierInvoice.update({
          where: { id: input.id },
          data: { status: "OUTSTANDING" },
          include: { supplier: true },
        });
      }),

    // Get single invoice by ID
    getById: procurementProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const invoice = await ctx.prisma.supplierInvoice.findUnique({
          where: { id: input.id },
          include: { 
            supplier: true, 
            purchaseOrder: {
              include: {
                lines: {
                  include: { item: true }
                }
              }
            }
          },
        });

        if (!invoice) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        }

        return invoice;
      }),
  }),

  // ==================== BANK ACCOUNTS ====================
  bankAccounts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return ctx.prisma.bankAccount.findMany({
        where: { isActive: true },
        orderBy: { bankName: "asc" },
      });
    }),

    create: adminProcedure
      .input(
        z.object({
          bankName: z.string().min(2),
          bankNameAr: z.string().optional(),
          accountNumber: z.string().min(1),
          iban: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.bankAccount.create({ data: input });
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          bankName: z.string().min(2).optional(),
          bankNameAr: z.string().optional(),
          accountNumber: z.string().min(1).optional(),
          iban: z.string().optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        return ctx.prisma.bankAccount.update({ where: { id }, data });
      }),

    delete: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.bankAccount.update({
          where: { id: input.id },
          data: { isActive: false },
        });
      }),
  }),

  // ==================== BANK PAYMENTS ====================
  bankPayments: router({
    submit: protectedProcedure
      .input(
        z.object({
          bankAccountId: z.string().uuid(),
          amountSdg: z.number().positive(),
          transactionId: z.string().optional(),
          receiptImageUrl: z.string().min(1),
          description: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (input.transactionId) {
          const existing = await ctx.prisma.bankPayment.findFirst({
            where: { transactionId: input.transactionId },
          });
          if (existing) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A payment with this transaction ID already exists",
            });
          }
        }

        return ctx.prisma.bankPayment.create({
          data: {
            userId: ctx.user.userId,
            bankAccountId: input.bankAccountId,
            amountSdg: input.amountSdg,
            transactionId: input.transactionId,
            receiptImageUrl: input.receiptImageUrl,
            description: input.description,
          },
          include: { bankAccount: true, user: { select: { id: true, name: true } } },
        });
      }),

    list: adminProcedure
      .input(
        z.object({
          status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
          userId: z.string().uuid().optional(),
          bankAccountId: z.string().uuid().optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { status, userId, bankAccountId, startDate, endDate, page, pageSize } = input;

        const where: any = {
          ...(status && { status }),
          ...(userId && { userId }),
          ...(bankAccountId && { bankAccountId }),
        };
        if (startDate || endDate) {
          where.createdAt = {};
          if (startDate) where.createdAt.gte = startDate;
          if (endDate) where.createdAt.lte = endDate;
        }

        const [payments, total] = await Promise.all([
          ctx.prisma.bankPayment.findMany({
            where,
            include: {
              user: { select: { id: true, name: true, email: true } },
              bankAccount: true,
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          ctx.prisma.bankPayment.count({ where }),
        ]);

        return { data: payments, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
      }),

    updateStatus: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.enum(["APPROVED", "REJECTED"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.bankPayment.update({
          where: { id: input.id },
          data: { status: input.status },
          include: { bankAccount: true, user: { select: { id: true, name: true } } },
        });
      }),
  }),

  // ==================== AUDIT LOGS ====================
  auditLogs: router({
    list: adminProcedure
      .input(
        z.object({
          branchId: z.string().uuid().optional(),
          userId: z.string().uuid().optional(),
          entityType: z.string().optional(),
          action: z.string().optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(50),
        })
      )
      .query(async ({ ctx, input }) => {
        const { branchId, userId, entityType, action, startDate, endDate, page, pageSize } = input;

        const where = {
          ...(branchId && { branchId }),
          ...(userId && { userId }),
          ...(entityType && { entityType }),
          ...(action && { action }),
          ...(startDate && { createdAt: { gte: startDate } }),
          ...(endDate && { createdAt: { lte: endDate } }),
        };

        const [logs, total] = await Promise.all([
          ctx.prisma.auditLog.findMany({
            where,
            include: { user: { select: { id: true, name: true, email: true } }, branch: true },
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          ctx.prisma.auditLog.count({ where }),
        ]);

        return { data: logs, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
      }),
  }),
});

