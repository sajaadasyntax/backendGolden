-- AlterTable
-- Make branchId nullable in users table
ALTER TABLE "users" ALTER COLUMN "branchId" DROP NOT NULL;
