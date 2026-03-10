-- Add warehouseId to users table
ALTER TABLE "users" ADD COLUMN "warehouseId" TEXT;

-- Add foreign key constraint
ALTER TABLE "users" ADD CONSTRAINT "users_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add index for warehouseId
CREATE INDEX "users_warehouseId_idx" ON "users"("warehouseId");
