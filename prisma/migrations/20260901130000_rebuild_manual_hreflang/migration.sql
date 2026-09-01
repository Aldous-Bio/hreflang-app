-- DropForeignKey
ALTER TABLE "HreflangItem" DROP CONSTRAINT "HreflangItem_groupId_fkey";

-- DropForeignKey
ALTER TABLE "MatchingLog" DROP CONSTRAINT "MatchingLog_groupId_fkey";

-- DropTable
DROP TABLE "HreflangGroup";

-- DropTable
DROP TABLE "HreflangItem";

-- DropTable
DROP TABLE "AppSetting";

-- DropTable
DROP TABLE "MatchingLog";

-- CreateTable
CREATE TABLE "Store" (
    "id" SERIAL NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HreflangEntry" (
    "id" SERIAL NOT NULL,
    "resourceType" TEXT NOT NULL,
    "displayId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HreflangEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HreflangLink" (
    "id" SERIAL NOT NULL,
    "entryId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "shopifyGid" TEXT,
    "handle" TEXT,
    "title" TEXT,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HreflangLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_storeId_key" ON "Store"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_shopDomain_key" ON "Store"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "HreflangEntry_resourceType_displayId_key" ON "HreflangEntry"("resourceType", "displayId");

-- CreateIndex
CREATE UNIQUE INDEX "HreflangLink_entryId_storeId_key" ON "HreflangLink"("entryId", "storeId");

-- AddForeignKey
ALTER TABLE "HreflangLink" ADD CONSTRAINT "HreflangLink_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "HreflangEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HreflangLink" ADD CONSTRAINT "HreflangLink_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
