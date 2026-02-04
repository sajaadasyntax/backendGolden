import prisma from "../lib/prisma.js";
import { Decimal } from "@prisma/client/runtime/library";

interface ConsumeResult {
  batchId: string;
  itemId: string;
  qty: number;
  unitCostUsd: number;
  totalCostUsd: number;
}

/**
 * FIFO Inventory Service
 * Handles batch consumption using First-In-First-Out methodology
 */
export class FIFOService {
  /**
   * Consume stock from warehouse using FIFO
   */
  static async consumeFromWarehouse(
    itemId: string,
    warehouseId: string,
    qty: number,
    referenceId: string,
    referenceType: string
  ): Promise<ConsumeResult[]> {
    const results: ConsumeResult[] = [];
    let remainingQty = qty;

    // Get batches in FIFO order (oldest first)
    const batches = await prisma.batch.findMany({
      where: {
        itemId,
        warehouseId,
        qtyRemaining: { gt: 0 },
      },
      orderBy: { receivedDate: "asc" },
    });

    for (const batch of batches) {
      if (remainingQty <= 0) break;

      const available = Number(batch.qtyRemaining);
      const toConsume = Math.min(remainingQty, available);

      // Update batch
      await prisma.batch.update({
        where: { id: batch.id },
        data: {
          qtyRemaining: { decrement: toConsume },
        },
      });

      // Create stock movement
      await prisma.stockMovement.create({
        data: {
          batchId: batch.id,
          qty: -toConsume,
          movementType: "ISSUE",
          referenceId,
          referenceType,
        },
      });

      results.push({
        batchId: batch.id,
        itemId: batch.itemId,
        qty: toConsume,
        unitCostUsd: Number(batch.unitCostUsd),
        totalCostUsd: toConsume * Number(batch.unitCostUsd),
      });

      remainingQty -= toConsume;
    }

    if (remainingQty > 0) {
      throw new Error(`Insufficient stock. Short by ${remainingQty} units.`);
    }

    return results;
  }

  /**
   * Consume stock from shelf using FIFO
   */
  static async consumeFromShelf(
    itemId: string,
    shelfId: string,
    qty: number,
    referenceId: string,
    referenceType: string
  ): Promise<ConsumeResult[]> {
    const results: ConsumeResult[] = [];
    let remainingQty = qty;

    const batches = await prisma.batch.findMany({
      where: {
        itemId,
        shelfId,
        qtyRemaining: { gt: 0 },
      },
      orderBy: { receivedDate: "asc" },
    });

    for (const batch of batches) {
      if (remainingQty <= 0) break;

      const available = Number(batch.qtyRemaining);
      const toConsume = Math.min(remainingQty, available);

      await prisma.batch.update({
        where: { id: batch.id },
        data: {
          qtyRemaining: { decrement: toConsume },
        },
      });

      await prisma.stockMovement.create({
        data: {
          batchId: batch.id,
          qty: -toConsume,
          movementType: "ISSUE",
          referenceId,
          referenceType,
        },
      });

      results.push({
        batchId: batch.id,
        itemId: batch.itemId,
        qty: toConsume,
        unitCostUsd: Number(batch.unitCostUsd),
        totalCostUsd: toConsume * Number(batch.unitCostUsd),
      });

      remainingQty -= toConsume;
    }

    if (remainingQty > 0) {
      throw new Error(`Insufficient stock on shelf. Short by ${remainingQty} units.`);
    }

    return results;
  }

  /**
   * Transfer stock from warehouse to shelf using FIFO
   */
  static async transferToShelf(
    itemId: string,
    warehouseId: string,
    shelfId: string,
    qty: number,
    referenceId: string
  ): Promise<void> {
    let remainingQty = qty;

    const batches = await prisma.batch.findMany({
      where: {
        itemId,
        warehouseId,
        qtyRemaining: { gt: 0 },
      },
      orderBy: { receivedDate: "asc" },
    });

    for (const batch of batches) {
      if (remainingQty <= 0) break;

      const available = Number(batch.qtyRemaining);
      const toTransfer = Math.min(remainingQty, available);

      // Reduce warehouse batch
      await prisma.batch.update({
        where: { id: batch.id },
        data: {
          qtyRemaining: { decrement: toTransfer },
        },
      });

      // Create movement out
      await prisma.stockMovement.create({
        data: {
          batchId: batch.id,
          qty: -toTransfer,
          movementType: "TRANSFER_OUT",
          referenceId,
          referenceType: "GoodsRequest",
        },
      });

      // Find or create shelf batch
      const shelfBatch = await prisma.batch.findFirst({
        where: {
          itemId,
          shelfId,
          unitCostUsd: batch.unitCostUsd,
          receivedDate: batch.receivedDate,
        },
      });

      if (shelfBatch) {
        await prisma.batch.update({
          where: { id: shelfBatch.id },
          data: {
            qtyRemaining: { increment: toTransfer },
            qtyReceived: { increment: toTransfer },
          },
        });

        await prisma.stockMovement.create({
          data: {
            batchId: shelfBatch.id,
            qty: toTransfer,
            movementType: "TRANSFER_IN",
            referenceId,
            referenceType: "GoodsRequest",
          },
        });
      } else {
        const newBatch = await prisma.batch.create({
          data: {
            itemId,
            shelfId,
            qtyReceived: toTransfer,
            qtyRemaining: toTransfer,
            unitCostUsd: batch.unitCostUsd,
            receivedDate: batch.receivedDate,
            isConsignment: batch.isConsignment,
            consignorId: batch.consignorId,
          },
        });

        await prisma.stockMovement.create({
          data: {
            batchId: newBatch.id,
            qty: toTransfer,
            movementType: "TRANSFER_IN",
            referenceId,
            referenceType: "GoodsRequest",
          },
        });
      }

      remainingQty -= toTransfer;
    }

    if (remainingQty > 0) {
      throw new Error(`Insufficient warehouse stock. Short by ${remainingQty} units.`);
    }
  }

  /**
   * Get available stock quantity for an item in a location
   */
  static async getAvailableQty(
    itemId: string,
    warehouseId?: string,
    shelfId?: string
  ): Promise<number> {
    const result = await prisma.batch.aggregate({
      where: {
        itemId,
        ...(warehouseId && { warehouseId }),
        ...(shelfId && { shelfId }),
        qtyRemaining: { gt: 0 },
      },
      _sum: { qtyRemaining: true },
    });

    return Number(result._sum.qtyRemaining) || 0;
  }

  /**
   * Get FIFO cost for a quantity
   */
  static async getFIFOCost(
    itemId: string,
    qty: number,
    warehouseId?: string,
    shelfId?: string
  ): Promise<number> {
    const batches = await prisma.batch.findMany({
      where: {
        itemId,
        ...(warehouseId && { warehouseId }),
        ...(shelfId && { shelfId }),
        qtyRemaining: { gt: 0 },
      },
      orderBy: { receivedDate: "asc" },
    });

    let remainingQty = qty;
    let totalCost = 0;

    for (const batch of batches) {
      if (remainingQty <= 0) break;

      const available = Number(batch.qtyRemaining);
      const toUse = Math.min(remainingQty, available);

      totalCost += toUse * Number(batch.unitCostUsd);
      remainingQty -= toUse;
    }

    return totalCost;
  }

  /**
   * Check if quantity is available
   */
  static async isAvailable(
    itemId: string,
    qty: number,
    warehouseId?: string,
    shelfId?: string
  ): Promise<boolean> {
    const available = await this.getAvailableQty(itemId, warehouseId, shelfId);
    return available >= qty;
  }
}

export default FIFOService;

