-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'WAREHOUSE_SALES', 'SHELF_SALES', 'PROCUREMENT', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "DayCycleStatus" AS ENUM ('OPEN', 'PENDING_CLOSE', 'CLOSED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN_IN', 'RETURN_OUT');

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoodsReceiptType" AS ENUM ('PARTIAL', 'FULL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'OUTSTANDING', 'SCHEDULED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentScheduleStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('WHOLESALE', 'RETAIL');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'FULLY_DELIVERED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesInvoiceType" AS ENUM ('WHOLESALE', 'RETAIL', 'DAILY_AGGREGATE');

-- CreateEnum
CREATE TYPE "SalesInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoodsRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ISSUED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CASH_IN', 'CASH_OUT', 'BANK_IN', 'BANK_OUT', 'TRANSFER', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "role" "UserRole" NOT NULL,
    "branchId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_cycles" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cycleDate" DATE NOT NULL,
    "exchangeRateUsdSdg" DECIMAL(18,6) NOT NULL,
    "status" "DayCycleStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "day_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "isConsignment" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "minStockLevel" DECIMAL(18,4),
    "maxStockLevel" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_policies" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "wholesalePriceUsd" DECIMAL(18,4) NOT NULL,
    "retailPriceUsd" DECIMAL(18,4) NOT NULL,
    "priceRangeMinUsd" DECIMAL(18,4) NOT NULL,
    "priceRangeMaxUsd" DECIMAL(18,4) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelves" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "shelfId" TEXT,
    "qtyReceived" DECIMAL(18,4) NOT NULL,
    "qtyRemaining" DECIMAL(18,4) NOT NULL,
    "unitCostUsd" DECIMAL(18,6) NOT NULL,
    "receivedDate" DATE NOT NULL,
    "goodsReceiptLineId" TEXT,
    "isConsignment" BOOLEAN NOT NULL DEFAULT false,
    "consignorId" TEXT,
    "expiryDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "movementType" "StockMovementType" NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxNumber" TEXT,
    "balanceSdg" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isConsignor" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "expectedDate" DATE,
    "totalSdg" DECIMAL(18,2) NOT NULL,
    "status" "POStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unitPriceSdg" DECIMAL(18,4) NOT NULL,
    "totalSdg" DECIMAL(18,2) NOT NULL,
    "qtyReceived" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "grNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "dayCycleId" TEXT NOT NULL,
    "receiptDate" DATE NOT NULL,
    "receiptType" "GoodsReceiptType" NOT NULL,
    "exchangeRateUsed" DECIMAL(18,6) NOT NULL,
    "notes" TEXT,
    "receivedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyReceived" DECIMAL(18,4) NOT NULL,
    "unitCostSdg" DECIMAL(18,4) NOT NULL,
    "unitCostUsd" DECIMAL(18,6) NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "totalSdg" DECIMAL(18,2) NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paymentMethod" "PaymentMethod",
    "paidDate" DATE,
    "paidAmountSdg" DECIMAL(18,2),
    "transactionNumber" TEXT,
    "receiptImageUrl" TEXT,
    "paidById" TEXT,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_schedules" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountSdg" DECIMAL(18,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "paidDate" DATE,
    "status" "PaymentScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_notices" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "operationNumber" TEXT NOT NULL,
    "bankReference" TEXT,
    "amountSdg" DECIMAL(18,2) NOT NULL,
    "fileUrl" TEXT,
    "isMatched" BOOLEAN NOT NULL DEFAULT false,
    "matchedAt" TIMESTAMP(3),
    "matchedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "customerType" "CustomerType" NOT NULL DEFAULT 'RETAIL',
    "creditLimitSdg" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balanceSdg" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "soNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "dayCycleId" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "totalUsd" DECIMAL(18,4) NOT NULL,
    "totalSdg" DECIMAL(18,2) NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unitPriceUsd" DECIMAL(18,4) NOT NULL,
    "unitPriceSdg" DECIMAL(18,4) NOT NULL,
    "totalUsd" DECIMAL(18,4) NOT NULL,
    "totalSdg" DECIMAL(18,2) NOT NULL,
    "qtyDelivered" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "shelfId" TEXT NOT NULL,
    "dayCycleId" TEXT NOT NULL,
    "invoiceType" "SalesInvoiceType" NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE,
    "totalUsd" DECIMAL(18,4) NOT NULL,
    "totalSdg" DECIMAL(18,2) NOT NULL,
    "paidAmountSdg" DECIMAL(18,2),
    "status" "SalesInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_lines" (
    "id" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unitPriceUsd" DECIMAL(18,4) NOT NULL,
    "unitPriceSdg" DECIMAL(18,4) NOT NULL,
    "unitCostUsd" DECIMAL(18,6) NOT NULL,
    "totalUsd" DECIMAL(18,4) NOT NULL,
    "totalSdg" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_aggregate_invoices" (
    "id" TEXT NOT NULL,
    "shelfId" TEXT NOT NULL,
    "dayCycleId" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "cashTotalSdg" DECIMAL(18,2) NOT NULL,
    "cardTotalSdg" DECIMAL(18,2) NOT NULL,
    "totalSdg" DECIMAL(18,2) NOT NULL,
    "totalUsd" DECIMAL(18,4) NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "transactionCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_aggregate_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_requests" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "shelfId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestDate" DATE NOT NULL,
    "status" "GoodsRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_request_lines" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyRequested" DECIMAL(18,4) NOT NULL,
    "qtyApproved" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qtyIssued" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qtyReceived" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_request_approvals" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "goods_request_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "dayCycleId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "isPosted" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitUsd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "creditUsd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "debitSdg" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "creditSdg" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "dayCycleId" TEXT NOT NULL,
    "transactionType" "TransactionType" NOT NULL,
    "amountSdg" DECIMAL(18,2) NOT NULL,
    "amountUsd" DECIMAL(18,4) NOT NULL,
    "fromAccountId" TEXT,
    "toAccountId" TEXT,
    "description" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "dayCycleId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amountSdg" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_branchId_idx" ON "users"("branchId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "day_cycles_branchId_idx" ON "day_cycles"("branchId");

-- CreateIndex
CREATE INDEX "day_cycles_cycleDate_idx" ON "day_cycles"("cycleDate");

-- CreateIndex
CREATE UNIQUE INDEX "day_cycles_branchId_cycleDate_key" ON "day_cycles"("branchId", "cycleDate");

-- CreateIndex
CREATE UNIQUE INDEX "items_sku_key" ON "items"("sku");

-- CreateIndex
CREATE INDEX "items_categoryId_idx" ON "items"("categoryId");

-- CreateIndex
CREATE INDEX "items_sku_idx" ON "items"("sku");

-- CreateIndex
CREATE INDEX "price_policies_itemId_branchId_idx" ON "price_policies"("itemId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_branchId_code_key" ON "warehouses"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "shelves_branchId_code_key" ON "shelves"("branchId", "code");

-- CreateIndex
CREATE INDEX "batches_itemId_idx" ON "batches"("itemId");

-- CreateIndex
CREATE INDEX "batches_warehouseId_idx" ON "batches"("warehouseId");

-- CreateIndex
CREATE INDEX "batches_shelfId_idx" ON "batches"("shelfId");

-- CreateIndex
CREATE INDEX "batches_receivedDate_idx" ON "batches"("receivedDate");

-- CreateIndex
CREATE INDEX "stock_movements_batchId_idx" ON "stock_movements"("batchId");

-- CreateIndex
CREATE INDEX "stock_movements_referenceId_referenceType_idx" ON "stock_movements"("referenceId", "referenceType");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_poNumber_key" ON "purchase_orders"("poNumber");

-- CreateIndex
CREATE INDEX "purchase_orders_supplierId_idx" ON "purchase_orders"("supplierId");

-- CreateIndex
CREATE INDEX "purchase_orders_branchId_idx" ON "purchase_orders"("branchId");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchaseOrderId_idx" ON "purchase_order_lines"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_grNumber_key" ON "goods_receipts"("grNumber");

-- CreateIndex
CREATE INDEX "goods_receipts_purchaseOrderId_idx" ON "goods_receipts"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "goods_receipts_dayCycleId_idx" ON "goods_receipts"("dayCycleId");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_goodsReceiptId_idx" ON "goods_receipt_lines"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "supplier_invoices_supplierId_idx" ON "supplier_invoices"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_invoices_status_idx" ON "supplier_invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_supplierId_invoiceNumber_key" ON "supplier_invoices"("supplierId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "payment_schedules_invoiceId_idx" ON "payment_schedules"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_schedules_dueDate_idx" ON "payment_schedules"("dueDate");

-- CreateIndex
CREATE INDEX "bank_notices_invoiceId_idx" ON "bank_notices"("invoiceId");

-- CreateIndex
CREATE INDEX "bank_notices_operationNumber_idx" ON "bank_notices"("operationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_soNumber_key" ON "sales_orders"("soNumber");

-- CreateIndex
CREATE INDEX "sales_orders_customerId_idx" ON "sales_orders"("customerId");

-- CreateIndex
CREATE INDEX "sales_orders_branchId_idx" ON "sales_orders"("branchId");

-- CreateIndex
CREATE INDEX "sales_orders_dayCycleId_idx" ON "sales_orders"("dayCycleId");

-- CreateIndex
CREATE INDEX "sales_orders_status_idx" ON "sales_orders"("status");

-- CreateIndex
CREATE INDEX "sales_order_lines_salesOrderId_idx" ON "sales_order_lines"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_invoiceNumber_key" ON "sales_invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "sales_invoices_customerId_idx" ON "sales_invoices"("customerId");

-- CreateIndex
CREATE INDEX "sales_invoices_shelfId_idx" ON "sales_invoices"("shelfId");

-- CreateIndex
CREATE INDEX "sales_invoices_dayCycleId_idx" ON "sales_invoices"("dayCycleId");

-- CreateIndex
CREATE INDEX "sales_invoices_status_idx" ON "sales_invoices"("status");

-- CreateIndex
CREATE INDEX "sales_invoices_dueDate_idx" ON "sales_invoices"("dueDate");

-- CreateIndex
CREATE INDEX "sales_invoice_lines_salesInvoiceId_idx" ON "sales_invoice_lines"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "daily_aggregate_invoices_shelfId_idx" ON "daily_aggregate_invoices"("shelfId");

-- CreateIndex
CREATE INDEX "daily_aggregate_invoices_dayCycleId_idx" ON "daily_aggregate_invoices"("dayCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_aggregate_invoices_shelfId_dayCycleId_key" ON "daily_aggregate_invoices"("shelfId", "dayCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_requests_requestNumber_key" ON "goods_requests"("requestNumber");

-- CreateIndex
CREATE INDEX "goods_requests_shelfId_idx" ON "goods_requests"("shelfId");

-- CreateIndex
CREATE INDEX "goods_requests_status_idx" ON "goods_requests"("status");

-- CreateIndex
CREATE INDEX "goods_request_lines_requestId_idx" ON "goods_request_lines"("requestId");

-- CreateIndex
CREATE INDEX "goods_request_approvals_requestId_idx" ON "goods_request_approvals"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_entryNumber_key" ON "journal_entries"("entryNumber");

-- CreateIndex
CREATE INDEX "journal_entries_dayCycleId_idx" ON "journal_entries"("dayCycleId");

-- CreateIndex
CREATE INDEX "journal_entries_referenceId_referenceType_idx" ON "journal_entries"("referenceId", "referenceType");

-- CreateIndex
CREATE INDEX "journal_lines_journalEntryId_idx" ON "journal_lines"("journalEntryId");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_idx" ON "journal_lines"("accountId");

-- CreateIndex
CREATE INDEX "transactions_branchId_idx" ON "transactions"("branchId");

-- CreateIndex
CREATE INDEX "transactions_dayCycleId_idx" ON "transactions"("dayCycleId");

-- CreateIndex
CREATE INDEX "transactions_transactionType_idx" ON "transactions"("transactionType");

-- CreateIndex
CREATE INDEX "expenses_branchId_idx" ON "expenses"("branchId");

-- CreateIndex
CREATE INDEX "expenses_dayCycleId_idx" ON "expenses"("dayCycleId");

-- CreateIndex
CREATE INDEX "expenses_categoryId_idx" ON "expenses"("categoryId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_branchId_idx" ON "audit_logs"("branchId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_cycles" ADD CONSTRAINT "day_cycles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_cycles" ADD CONSTRAINT "day_cycles_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_cycles" ADD CONSTRAINT "day_cycles_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_policies" ADD CONSTRAINT "price_policies_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_policies" ADD CONSTRAINT "price_policies_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelves" ADD CONSTRAINT "shelves_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_goodsReceiptLineId_fkey" FOREIGN KEY ("goodsReceiptLineId") REFERENCES "goods_receipt_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_consignorId_fkey" FOREIGN KEY ("consignorId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_dayCycleId_fkey" FOREIGN KEY ("dayCycleId") REFERENCES "day_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_notices" ADD CONSTRAINT "bank_notices_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_notices" ADD CONSTRAINT "bank_notices_matchedById_fkey" FOREIGN KEY ("matchedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_dayCycleId_fkey" FOREIGN KEY ("dayCycleId") REFERENCES "day_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelves"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_dayCycleId_fkey" FOREIGN KEY ("dayCycleId") REFERENCES "day_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_aggregate_invoices" ADD CONSTRAINT "daily_aggregate_invoices_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelves"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_aggregate_invoices" ADD CONSTRAINT "daily_aggregate_invoices_dayCycleId_fkey" FOREIGN KEY ("dayCycleId") REFERENCES "day_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_requests" ADD CONSTRAINT "goods_requests_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelves"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_requests" ADD CONSTRAINT "goods_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_request_lines" ADD CONSTRAINT "goods_request_lines_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "goods_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_request_lines" ADD CONSTRAINT "goods_request_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_request_approvals" ADD CONSTRAINT "goods_request_approvals_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "goods_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_request_approvals" ADD CONSTRAINT "goods_request_approvals_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_dayCycleId_fkey" FOREIGN KEY ("dayCycleId") REFERENCES "day_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_dayCycleId_fkey" FOREIGN KEY ("dayCycleId") REFERENCES "day_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_dayCycleId_fkey" FOREIGN KEY ("dayCycleId") REFERENCES "day_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
