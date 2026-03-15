-- Add warehouseId and shelfId to price_policies for per-location pricing
ALTER TABLE "price_policies" ADD COLUMN "warehouseId" TEXT;
ALTER TABLE "price_policies" ADD COLUMN "shelfId" TEXT;

-- Add foreign key constraints
ALTER TABLE "price_policies" ADD CONSTRAINT "price_policies_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "price_policies" ADD CONSTRAINT "price_policies_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add indexes for faster lookups
CREATE INDEX "price_policies_warehouseId_idx" ON "price_policies"("warehouseId");
CREATE INDEX "price_policies_shelfId_idx" ON "price_policies"("shelfId");
