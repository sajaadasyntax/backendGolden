import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../trpc/trpc.js";
import { hashPassword } from "../lib/auth.js";

const UserRoleEnum = z.enum([
  "ADMIN",
  "MANAGER",
  "WAREHOUSE_SALES",
  "SHELF_SALES",
  "PROCUREMENT",
  "ACCOUNTANT",
]);

export const userRouter = router({
  list: adminProcedure
    .input(
      z.object({
        branchId: z.string().uuid().optional(),
        role: UserRoleEnum.optional(),
        search: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { branchId, role, search, page, pageSize } = input;

      const where = {
        ...(branchId && { branchId }),
        ...(role && { role }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }),
      };

      const [users, total] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          include: { branch: true },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        ctx.prisma.user.count({ where }),
      ]);

      return {
        data: users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          nameAr: u.nameAr,
          role: u.role,
          branchId: u.branchId,
          branch: u.branch,
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }),

  getById: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.id },
        include: { branch: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        nameAr: user.nameAr,
        role: user.role,
        branchId: user.branchId,
        branch: user.branch,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      };
    }),

  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(6),
        name: z.string().min(2),
        nameAr: z.string().optional(),
        role: UserRoleEnum.refine((val) => val !== "ADMIN", {
          message: "Cannot create ADMIN users",
        }),
        branchId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Note: ADMIN role is already prevented by the refine() in the input schema
      // Check if email exists
      const existing = await ctx.prisma.user.findUnique({
        where: { email: input.email },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Email already exists",
        });
      }

      const passwordHash = await hashPassword(input.password);

      // Create user and shelf in a transaction
      const result = await ctx.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            passwordHash,
            name: input.name,
            nameAr: input.nameAr,
            role: input.role,
            ...(input.branchId && { branchId: input.branchId }),
          },
          include: { branch: true },
        });

        // If user is SHELF_SALES, create a shelf for them
        let shelf = null;
        if (input.role === "SHELF_SALES") {
          try {
            // Generate unique shelf code - try user ID first 8 chars, then add counter if needed
            let shelfCode = `SH-${user.id.substring(0, 8).toUpperCase()}`;
            let counter = 1;
            
            // Check if code already exists and generate unique one
            while (await tx.shelf.findUnique({ where: { code: shelfCode } })) {
              shelfCode = `SH-${user.id.substring(0, 6).toUpperCase()}-${counter}`;
              counter++;
            }
            
            // Extract username from email (part before @)
            const username = user.email.split('@')[0];
            
            shelf = await tx.shelf.create({
              data: {
                userId: user.id,
                name: `${username}'s Shelf`,
                nameAr: `رف ${username}`,
                code: shelfCode,
              },
            });
            
            console.log(`✅ Created shelf "${shelf.name}" (${shelf.code}) for user ${user.email}`);
          } catch (shelfError: any) {
            console.error(`❌ Failed to create shelf for user ${user.email}:`, shelfError);
            // Re-throw to rollback transaction
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to create shelf for SHELF_SALES user: ${shelfError.message || 'Unknown error'}`,
            });
          }
        }

        return { user, shelf };
      });

      // Verify shelf was created for SHELF_SALES users (safety check)
      if (input.role === "SHELF_SALES" && !result.shelf) {
        console.warn(`⚠️ Shelf was not created for SHELF_SALES user ${result.user.email}, attempting to create now...`);
        try {
          // Generate unique shelf code
          let shelfCode = `SH-${result.user.id.substring(0, 8).toUpperCase()}`;
          let counter = 1;
          
          while (await ctx.prisma.shelf.findUnique({ where: { code: shelfCode } })) {
            shelfCode = `SH-${result.user.id.substring(0, 6).toUpperCase()}-${counter}`;
            counter++;
          }
          
          const username = result.user.email.split('@')[0];
          result.shelf = await ctx.prisma.shelf.create({
            data: {
              userId: result.user.id,
              name: `${username}'s Shelf`,
              nameAr: `رف ${username}`,
              code: shelfCode,
            },
          });
          console.log(`✅ Created shelf "${result.shelf.name}" (${result.shelf.code}) for user ${result.user.email} (fallback)`);
        } catch (fallbackError: any) {
          console.error(`❌ Fallback shelf creation also failed for user ${result.user.email}:`, fallbackError);
          // Don't throw - user is already created, but log the error
        }
      }

      // Audit log
      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.userId,
          branchId: ctx.user.branchId,
          action: "CREATE",
          entityType: "User",
          entityId: result.user.id,
          newData: { email: input.email, name: input.name, role: input.role },
        },
      });

      return {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        nameAr: result.user.nameAr,
        role: result.user.role,
        branchId: result.user.branchId,
        branch: result.user.branch,
        isActive: result.user.isActive,
        shelf: result.shelf,
      };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        email: z.string().email().optional(),
        name: z.string().min(2).optional(),
        nameAr: z.string().optional(),
        role: UserRoleEnum.optional(),
        branchId: z.string().uuid().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const existing = await ctx.prisma.user.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Check email uniqueness if changing
      if (data.email && data.email !== existing.email) {
        const emailExists = await ctx.prisma.user.findUnique({
          where: { email: data.email },
        });
        if (emailExists) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Email already exists",
          });
        }
      }

      const user = await ctx.prisma.user.update({
        where: { id },
        data,
        include: { branch: true },
      });

      // Audit log
      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.userId,
          branchId: ctx.user.branchId,
          action: "UPDATE",
          entityType: "User",
          entityId: id,
          oldData: { email: existing.email, name: existing.name, role: existing.role },
          newData: { email: user.email, name: user.name, role: user.role },
        },
      });

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        nameAr: user.nameAr,
        role: user.role,
        branchId: user.branchId,
        branch: user.branch,
        isActive: user.isActive,
      };
    }),

  resetPassword: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        newPassword: z.string().min(6),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const passwordHash = await hashPassword(input.newPassword);
      await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { passwordHash },
      });

      // Invalidate all sessions for this user
      await ctx.prisma.session.deleteMany({
        where: { userId: input.userId },
      });

      // Audit log
      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.userId,
          branchId: ctx.user.branchId,
          action: "UPDATE",
          entityType: "User",
          entityId: input.userId,
          newData: { passwordReset: true },
        },
      });

      return { success: true };
    }),
});

