-- Add transactionNumber and receiptImageUrls to SalesInvoice
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "transactionNumber" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "receiptImageUrls" TEXT[] NOT NULL DEFAULT '{}';

-- Create DailyInvoiceDraft table
CREATE TABLE IF NOT EXISTS "daily_invoice_drafts" (
    "id" TEXT NOT NULL,
    "shelfId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_invoice_drafts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "daily_invoice_drafts_shelfId_key" ON "daily_invoice_drafts"("shelfId");
ALTER TABLE "daily_invoice_drafts" ADD CONSTRAINT "daily_invoice_drafts_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelves"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create DailyInvoiceDraftLine table
CREATE TABLE IF NOT EXISTS "daily_invoice_draft_lines" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT,
    "qty" INTEGER NOT NULL,
    "unitPriceUsd" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_invoice_draft_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "daily_invoice_draft_lines_draftId_idx" ON "daily_invoice_draft_lines"("draftId");
ALTER TABLE "daily_invoice_draft_lines" ADD CONSTRAINT "daily_invoice_draft_lines_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "daily_invoice_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_invoice_draft_lines" ADD CONSTRAINT "daily_invoice_draft_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
