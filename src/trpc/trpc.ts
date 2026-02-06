import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof Error ? error.cause.message : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

/**
 * Helper to validate that a branchId matches the user's branch.
 * Admins and Managers can access any branch; other roles are restricted to their own.
 */
export function validateBranchAccess(
  userBranchId: string | null,
  userRole: string,
  requestedBranchId: string
): void {
  // ADMIN and MANAGER can access any branch
  if (["ADMIN", "MANAGER"].includes(userRole)) {
    return;
  }
  
  // User without branch can't access branch-specific data
  if (!userBranchId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You must be assigned to a branch to access this resource",
    });
  }
  
  // Other roles can only access their own branch
  if (requestedBranchId !== userBranchId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only access data from your own branch",
    });
  }
}

// Auth middleware
const isAuthed = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to access this resource",
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthed);

// Role-based middleware factory
const hasRole = (allowedRoles: string[]) =>
  middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You must be logged in",
      });
    }

    if (!allowedRoles.includes(ctx.user.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have permission to access this resource",
      });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  });

// Role-specific procedures
export const adminProcedure = t.procedure.use(hasRole(["ADMIN", "MANAGER"]));
export const procurementProcedure = t.procedure.use(
  hasRole(["ADMIN", "MANAGER", "PROCUREMENT"])
);
export const warehouseSalesProcedure = t.procedure.use(
  hasRole(["ADMIN", "MANAGER", "WAREHOUSE_SALES"])
);
export const shelfSalesProcedure = t.procedure.use(
  hasRole(["ADMIN", "MANAGER", "SHELF_SALES"])
);
export const accountingProcedure = t.procedure.use(
  hasRole(["ADMIN", "MANAGER", "ACCOUNTANT"])
);
// Combined procedure for goods receipt (both procurement and warehouse can receive goods)
export const goodsReceiptProcedure = t.procedure.use(
  hasRole(["ADMIN", "MANAGER", "PROCUREMENT", "WAREHOUSE_SALES"])
);

