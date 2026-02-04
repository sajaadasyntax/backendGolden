import { prisma } from "./prisma.js";

/**
 * Automatically closes any open day cycles from previous days.
 * This should be called whenever checking for an open day cycle to ensure
 * that day cycles are automatically closed at midnight (00:00 AM).
 * 
 * @param branchId Optional branch ID to only close cycles for a specific branch
 * @returns Number of day cycles that were closed
 */
export async function autoClosePreviousDayCycles(branchId?: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find all open day cycles from previous days
  const where: any = {
    status: "OPEN",
    cycleDate: {
      lt: today, // Less than today (previous days)
    },
  };

  if (branchId) {
    where.branchId = branchId;
  }

  const openPreviousCycles = await prisma.dayCycle.findMany({
    where,
  });

  if (openPreviousCycles.length === 0) {
    return 0;
  }

  // Close all previous day cycles
  // Note: We use a system user ID or null for closedById since this is automatic
  // In a real system, you might want to use a system user ID
  const result = await prisma.dayCycle.updateMany({
    where,
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      // closedById is left as null for auto-closed cycles
      // You could set it to a system user ID if you have one
    },
  });

  // Create audit logs for each closed cycle
  for (const cycle of openPreviousCycles) {
    await prisma.auditLog.create({
      data: {
        userId: cycle.openedById, // Use the user who opened it
        branchId: cycle.branchId,
        action: "AUTO_CLOSE_DAY",
        entityType: "DayCycle",
        entityId: cycle.id,
        newData: {
          closedAt: new Date().toISOString(),
          reason: "Automatic closure at midnight",
        },
      },
    });
  }

  return result.count;
}

/**
 * Gets the open day cycle for today (if it exists).
 * This function will auto-close previous day cycles before checking.
 * 
 * NOTE: This function does NOT create day cycles. Day cycles must be manually opened by an admin.
 * 
 * @param branchId Branch ID to get day cycle for
 * @returns The open day cycle for today, or null if not open
 */
export async function getOpenDayCycle(branchId: string) {
  // First, auto-close any previous day cycles
  await autoClosePreviousDayCycles(branchId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return prisma.dayCycle.findFirst({
    where: {
      branchId,
      cycleDate: today,
      status: "OPEN",
    },
  });
}
