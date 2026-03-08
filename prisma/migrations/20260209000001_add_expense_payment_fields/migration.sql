-- AlterTable: Add paymentMethod and receiptImageUrl to expenses
ALTER TABLE "expenses" ADD COLUMN "paymentMethod" "PaymentMethod";
ALTER TABLE "expenses" ADD COLUMN "receiptImageUrl" TEXT;
