-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('ADMIN', 'PLANNER', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CONTRACT', 'SPECIFICATION', 'PID', 'PFD', 'LINE_LIST', 'PIPING_ISOMETRIC', 'PIPING_PLAN', 'PLANIMETRIC', 'LOCATION_PLAN', 'MODEL_3D', 'MATERIAL_LIST', 'DATASHEET', 'EQUIPMENT_LIST', 'SUPPORT_DRAWING', 'STRUCTURAL_DRAWING', 'SINGLE_LINE_DIAGRAM', 'CABLE_ROUTING', 'CABLE_LIST', 'INSTRUMENT_LIST', 'AUTOMATION_ARCHITECTURE', 'LOOP_DIAGRAM', 'INSTALLATION_DRAWING', 'PROCEDURE', 'INSPECTION_PLAN', 'COMMISSIONING_PLAN', 'EXISTING_SCHEDULE', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'BLOCKED_UNSUPPORTED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "PageKind" AS ENUM ('VECTOR', 'SCANNED', 'MIXED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DataClass" AS ENUM ('EXTRACTED_FACT', 'USER_INPUT', 'AI_INFERENCE', 'PLANNING_ASSUMPTION', 'CONFIGURABLE_RULE', 'PENDING_INFO', 'SOURCE_CONFLICT');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'CORRECTED', 'REJECTED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "WbsType" AS ENUM ('PROJECT', 'PHASE', 'CWA', 'CWP', 'IWP', 'ACTIVITY');

-- CreateEnum
CREATE TYPE "DurationStatus" AS ENUM ('CALCULATED', 'NOT_CALCULABLE');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('SUGGESTED', 'VALIDATED', 'REJECTED', 'MODIFIED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "orgRole" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client" TEXT,
    "contract" TEXT,
    "scopeSummary" TEXT,
    "site" TEXT,
    "disciplines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "definitionOfDone" TEXT,
    "contractStart" TIMESTAMP(3),
    "contractFinish" TIMESTAMP(3),
    "statusDate" TIMESTAMP(3),
    "mspVersion" TEXT NOT NULL DEFAULT '2016',
    "allowExternalAi" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "folderId" TEXT,
    "fileName" TEXT NOT NULL,
    "folderPath" TEXT NOT NULL,
    "documentNumber" TEXT,
    "discipline" TEXT,
    "area" TEXT,
    "system" TEXT,
    "suggestedType" "DocumentType" NOT NULL DEFAULT 'UNCLASSIFIED',
    "typeConfidence" DOUBLE PRECISION,
    "confirmedType" "DocumentType",
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "currentVersionId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revision" TEXT,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "markdown" TEXT,
    "markdownKey" TEXT,
    "pageCount" INTEGER,
    "extractionJson" JSONB,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPage" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "sheet" TEXT,
    "kind" "PageKind" NOT NULL DEFAULT 'UNKNOWN',
    "widthPt" DOUBLE PRECISION,
    "heightPt" DOUBLE PRECISION,
    "markdown" TEXT,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "DocumentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "page" INTEGER,
    "sheet" TEXT,
    "bbox" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "layer" TEXT,
    "objectId" TEXT,
    "snippet" TEXT,
    "method" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechEntity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT,
    "evidenceId" TEXT,
    "entityKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "area" TEXT,
    "system" TEXT,
    "subsystem" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "dataClass" "DataClass" NOT NULL DEFAULT 'EXTRACTED_FACT',
    "confidence" DOUBLE PRECISION,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityRelation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuantityItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "entityId" TEXT,
    "documentId" TEXT,
    "evidenceId" TEXT,
    "wbsNodeId" TEXT,
    "entityKey" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "documentRevision" TEXT,
    "area" TEXT,
    "system" TEXT,
    "subsystem" TEXT,
    "lineNumber" TEXT,
    "tag" TEXT,
    "material" TEXT,
    "pipeClass" TEXT,
    "schedule" TEXT,
    "nominalDiameterIn" DOUBLE PRECISION,
    "itemType" TEXT,
    "controlUnit" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "calcMemo" JSONB,
    "dataClass" "DataClass" NOT NULL DEFAULT 'EXTRACTED_FACT',
    "confidence" DOUBLE PRECISION,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuantityItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assumption" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "rationale" TEXT,
    "source" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceConflict" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sides" JSONB NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByRule" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WbsNode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "WbsType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discipline" TEXT,
    "area" TEXT,
    "system" TEXT,
    "subsystem" TEXT,
    "scopeIn" TEXT,
    "scopeOut" TEXT,
    "deliverable" TEXT,
    "qty" DOUBLE PRECISION,
    "unit" TEXT,
    "documentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptanceCriteria" JSONB NOT NULL DEFAULT '[]',
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WbsNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkCalendarDef" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workWeek" JSONB NOT NULL,
    "exceptions" JSONB NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkCalendarDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceDef" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'WORK',
    "group" TEXT,
    "maxUnits" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "productiveHoursPerDay" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductivityIndex" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "perUnit" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceDate" TIMESTAMP(3) NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductivityIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsNodeId" TEXT,
    "calendarId" TEXT,
    "productivityId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discipline" TEXT,
    "area" TEXT,
    "system" TEXT,
    "step" TEXT,
    "deliverable" TEXT,
    "completionCriteria" TEXT,
    "isMilestone" BOOLEAN NOT NULL DEFAULT false,
    "isContractual" BOOLEAN NOT NULL DEFAULT false,
    "qty" DOUBLE PRECISION,
    "unit" TEXT,
    "workHH" DOUBLE PRECISION,
    "actualWorkHH" DOUBLE PRECISION DEFAULT 0,
    "remainingWorkHH" DOUBLE PRECISION,
    "dailyCapacityHH" DOUBLE PRECISION,
    "durationMinutes" INTEGER NOT NULL DEFAULT 0,
    "durationStatus" "DurationStatus" NOT NULL DEFAULT 'NOT_CALCULABLE',
    "missingInputs" JSONB NOT NULL DEFAULT '[]',
    "calcMemo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "constraintType" TEXT,
    "constraintDate" TIMESTAMP(3),
    "constraintJustification" TEXT,
    "earlyStart" TIMESTAMP(3),
    "earlyFinish" TIMESTAMP(3),
    "lateStart" TIMESTAMP(3),
    "lateFinish" TIMESTAMP(3),
    "totalFloatMinutes" INTEGER,
    "freeFloatMinutes" INTEGER,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "actualStart" TIMESTAMP(3),
    "actualFinish" TIMESTAMP(3),
    "percentComplete" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogicLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FS',
    "lagMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "LinkStatus" NOT NULL DEFAULT 'SUGGESTED',
    "reason" TEXT NOT NULL,
    "reasonKind" TEXT NOT NULL,
    "ruleId" TEXT,
    "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogicLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "workHH" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Baseline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "Baseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaselineRow" (
    "id" TEXT NOT NULL,
    "baselineId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "finish" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "workHH" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BaselineRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlMapItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "controlKey" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "stages" JSONB NOT NULL DEFAULT '{}',
    "plannedHH" DOUBLE PRECISION,
    "actualHH" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlMapItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstraintRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsNodeId" TEXT,
    "activityId" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "neededBy" TIMESTAMP(3) NOT NULL,
    "promisedBy" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "removalEvidence" TEXT,
    "potentialImpact" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConstraintRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessAssessment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsNodeId" TEXT,
    "activityId" TEXT,
    "dimension" TEXT NOT NULL,
    "verdict" TEXT NOT NULL DEFAULT 'NOT_ASSESSED',
    "assessedBy" TEXT,
    "assessedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "ReadinessAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressNote" TEXT,
    "lastError" TEXT,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "justification" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "validation" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_projectId_path_key" ON "Folder"("projectId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "Document_currentVersionId_key" ON "Document"("currentVersionId");

-- CreateIndex
CREATE INDEX "Document_projectId_documentNumber_idx" ON "Document"("projectId", "documentNumber");

-- CreateIndex
CREATE INDEX "DocumentVersion_sha256_idx" ON "DocumentVersion"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_sha256_key" ON "DocumentVersion"("documentId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPage_versionId_pageNumber_key" ON "DocumentPage"("versionId", "pageNumber");

-- CreateIndex
CREATE INDEX "TechEntity_projectId_discipline_idx" ON "TechEntity"("projectId", "discipline");

-- CreateIndex
CREATE UNIQUE INDEX "TechEntity_projectId_entityKey_documentId_key" ON "TechEntity"("projectId", "entityKey", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityRelation_fromId_toId_kind_key" ON "EntityRelation"("fromId", "toId", "kind");

-- CreateIndex
CREATE INDEX "QuantityItem_projectId_entityKey_idx" ON "QuantityItem"("projectId", "entityKey");

-- CreateIndex
CREATE INDEX "QuantityItem_projectId_discipline_area_idx" ON "QuantityItem"("projectId", "discipline", "area");

-- CreateIndex
CREATE INDEX "Decision_projectId_targetId_idx" ON "Decision"("projectId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "WbsNode_projectId_code_key" ON "WbsNode"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCalendarDef_projectId_code_key" ON "WorkCalendarDef"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceDef_projectId_code_key" ON "ResourceDef"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductivityIndex_projectId_code_key" ON "ProductivityIndex"("projectId", "code");

-- CreateIndex
CREATE INDEX "Activity_projectId_area_discipline_idx" ON "Activity"("projectId", "area", "discipline");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_projectId_code_key" ON "Activity"("projectId", "code");

-- CreateIndex
CREATE INDEX "LogicLink_projectId_status_idx" ON "LogicLink"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LogicLink_predecessorId_successorId_key" ON "LogicLink"("predecessorId", "successorId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_activityId_resourceId_key" ON "Assignment"("activityId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Baseline_projectId_number_key" ON "Baseline"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "BaselineRow_baselineId_activityId_key" ON "BaselineRow"("baselineId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlMapItem_projectId_mapId_controlKey_key" ON "ControlMapItem"("projectId", "mapId", "controlKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReadinessAssessment_wbsNodeId_activityId_dimension_key" ON "ReadinessAssessment"("wbsNodeId", "activityId", "dimension");

-- CreateIndex
CREATE INDEX "ProcessingJob_status_runAfter_priority_idx" ON "ProcessingJob"("status", "runAfter", "priority");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "Comment_projectId_entity_entityId_idx" ON "Comment"("projectId", "entity", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPage" ADD CONSTRAINT "DocumentPage_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechEntity" ADD CONSTRAINT "TechEntity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechEntity" ADD CONSTRAINT "TechEntity_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechEntity" ADD CONSTRAINT "TechEntity_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "TechEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "TechEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityItem" ADD CONSTRAINT "QuantityItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityItem" ADD CONSTRAINT "QuantityItem_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "TechEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityItem" ADD CONSTRAINT "QuantityItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityItem" ADD CONSTRAINT "QuantityItem_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityItem" ADD CONSTRAINT "QuantityItem_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WbsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenIssue" ADD CONSTRAINT "OpenIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assumption" ADD CONSTRAINT "Assumption_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceConflict" ADD CONSTRAINT "SourceConflict_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WbsNode" ADD CONSTRAINT "WbsNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WbsNode" ADD CONSTRAINT "WbsNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WbsNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCalendarDef" ADD CONSTRAINT "WorkCalendarDef_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceDef" ADD CONSTRAINT "ResourceDef_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductivityIndex" ADD CONSTRAINT "ProductivityIndex_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WbsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "WorkCalendarDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_productivityId_fkey" FOREIGN KEY ("productivityId") REFERENCES "ProductivityIndex"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogicLink" ADD CONSTRAINT "LogicLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogicLink" ADD CONSTRAINT "LogicLink_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogicLink" ADD CONSTRAINT "LogicLink_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ResourceDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Baseline" ADD CONSTRAINT "Baseline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineRow" ADD CONSTRAINT "BaselineRow_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "Baseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineRow" ADD CONSTRAINT "BaselineRow_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlMapItem" ADD CONSTRAINT "ControlMapItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstraintRecord" ADD CONSTRAINT "ConstraintRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstraintRecord" ADD CONSTRAINT "ConstraintRecord_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WbsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstraintRecord" ADD CONSTRAINT "ConstraintRecord_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessAssessment" ADD CONSTRAINT "ReadinessAssessment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessAssessment" ADD CONSTRAINT "ReadinessAssessment_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WbsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessAssessment" ADD CONSTRAINT "ReadinessAssessment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportRecord" ADD CONSTRAINT "ExportRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
