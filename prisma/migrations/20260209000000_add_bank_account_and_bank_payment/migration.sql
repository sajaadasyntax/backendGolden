-- CreateEnum
CREATE TYPE "BankPaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankNameAr" TEXT,
    "accountNumber" TEXT NOT NULL,
    "iban" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amountSdg" DECIMAL(18,2) NOT NULL,
    "transactionId" TEXT,
    "transactionNumber" TEXT,
    "receiptImageUrl" TEXT NOT NULL,
    "receiptImageUrls" TEXT[] NOT NULL DEFAULT '{}',
    "description" TEXT,
    "status" "BankPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_payments_userId_idx" ON "bank_payments"("userId");
CREATE INDEX "bank_payments_transactionNumber_idx" ON "bank_payments"("transactionNumber");

-- CreateIndex
CREATE INDEX "bank_payments_bankAccountId_idx" ON "bank_payments"("bankAccountId");

-- CreateIndex
CREATE INDEX "bank_payments_transactionId_idx" ON "bank_payments"("transactionId");

-- AddForeignKey
ALTER TABLE "bank_payments" ADD CONSTRAINT "bank_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payments" ADD CONSTRAINT "bank_payments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
