-- DropForeignKey
ALTER TABLE "shelves" DROP CONSTRAINT IF EXISTS "shelves_branchId_fkey";

-- AlterTable
-- Make branchId nullable first (in case there are existing rows)
ALTER TABLE "shelves" ALTER COLUMN "branchId" DROP NOT NULL;

-- DropIndex (if exists)
DROP INDEX IF EXISTS "shelves_branchId_idx";

-- DropColumn
ALTER TABLE "shelves" DROP COLUMN IF EXISTS "branchId";
