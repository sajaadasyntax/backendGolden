-- Add CREDIT and MIXED to PaymentMethod enum
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CREDIT';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MIXED';

-- Add paymentMethod to sales_invoices
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "paymentMethod" "PaymentMethod";
