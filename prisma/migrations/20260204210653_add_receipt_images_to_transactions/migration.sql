/*
  Warnings:

  - You are about to drop the column `branchId` on the `warehouses` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[code]` on the table `shelves` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code]` on the table `warehouses` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_branchId_fkey";

-- DropForeignKey
ALTER TABLE "warehouses" DROP CONSTRAINT "warehouses_branchId_fkey";

-- DropIndex
DROP INDEX "warehouses_branchId_code_key";

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "receiptImages" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "warehouses" DROP COLUMN "branchId";

-- CreateIndex
CREATE UNIQUE INDEX "shelves_code_key" ON "shelves"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
