-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "batchId" TEXT;

-- CreateIndex
CREATE INDEX "Run_batchId_idx" ON "Run"("batchId");
