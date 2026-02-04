-- AlterTable
ALTER TABLE "shelves" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "shelves_userId_idx" ON "shelves"("userId");

-- AddForeignKey
ALTER TABLE "shelves" ADD CONSTRAINT "shelves_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
