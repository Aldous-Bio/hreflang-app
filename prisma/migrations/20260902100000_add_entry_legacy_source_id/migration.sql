-- AlterTable
ALTER TABLE "HreflangEntry" ADD COLUMN     "legacySourceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "HreflangEntry_resourceType_legacySourceId_key" ON "HreflangEntry"("resourceType", "legacySourceId");
