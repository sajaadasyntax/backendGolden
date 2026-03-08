-- Add missing index on SalesOrder.warehouseId
CREATE INDEX IF NOT EXISTS "sales_orders_warehouseId_idx" ON "sales_orders"("warehouseId");

-- Add missing indexes on SupplierInvoice.invoiceDate and dueDate
CREATE INDEX IF NOT EXISTS "supplier_invoices_invoiceDate_idx" ON "supplier_invoices"("invoiceDate");
CREATE INDEX IF NOT EXISTS "supplier_invoices_dueDate_idx" ON "supplier_invoices"("dueDate");

-- Add missing index on GoodsReceipt.receiptDate
CREATE INDEX IF NOT EXISTS "goods_receipts_receiptDate_idx" ON "goods_receipts"("receiptDate");
