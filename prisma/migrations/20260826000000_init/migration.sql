-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HreflangGroup" (
    "id" SERIAL NOT NULL,
    "hreflangId" TEXT,
    "resourceType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "matchCriteria" TEXT,
    "matchConfidence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstMatchAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "HreflangGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HreflangItem" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyGid" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HreflangItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchingLog" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchingLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HreflangGroup_hreflangId_key" ON "HreflangGroup"("hreflangId");

-- CreateIndex
CREATE INDEX "HreflangItem_sku_idx" ON "HreflangItem"("sku");

-- CreateIndex
CREATE INDEX "HreflangItem_storeId_handle_idx" ON "HreflangItem"("storeId", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "HreflangItem_groupId_storeId_key" ON "HreflangItem"("groupId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "HreflangItem_storeId_shopifyGid_key" ON "HreflangItem"("storeId", "shopifyGid");

-- AddForeignKey
ALTER TABLE "HreflangItem" ADD CONSTRAINT "HreflangItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "HreflangGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchingLog" ADD CONSTRAINT "MatchingLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "HreflangGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

