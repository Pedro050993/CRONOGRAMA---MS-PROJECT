-- CreateEnum
CREATE TYPE "IndexApproval" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "ProductivityIndex" ADD COLUMN     "approvalStatus" "IndexApproval" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "discipline" TEXT,
ADD COLUMN     "importId" TEXT,
ADD COLUMN     "importRow" INTEGER,
ADD COLUMN     "importSheet" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "scopeNote" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ProductivityImport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sheetName" TEXT,
    "declaredBasis" TEXT,
    "declaredSourceDate" TIMESTAMP(3),
    "importedBy" TEXT NOT NULL,
    "candidatesCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedRows" JSONB NOT NULL DEFAULT '[]',
    "columnMap" JSONB NOT NULL DEFAULT '{}',
    "suppliedByUser" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ProcessingStatus" NOT NULL DEFAULT 'DONE',
    "statusMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductivityImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductivityImport_projectId_createdAt_idx" ON "ProductivityImport"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductivityIndex_projectId_approvalStatus_idx" ON "ProductivityIndex"("projectId", "approvalStatus");

-- AddForeignKey
ALTER TABLE "ProductivityIndex" ADD CONSTRAINT "ProductivityIndex_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ProductivityImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductivityImport" ADD CONSTRAINT "ProductivityImport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
