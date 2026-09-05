export type DataClass =
  | 'EXTRACTED_FACT' | 'USER_INPUT' | 'AI_INFERENCE' | 'PLANNING_ASSUMPTION'
  | 'CONFIGURABLE_RULE' | 'PENDING_INFO' | 'SOURCE_CONFLICT';

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'CORRECTED' | 'REJECTED' | 'FLAGGED';

export type ProjectRole = 'ADMIN' | 'PLANNER' | 'REVIEWER' | 'VIEWER';

export interface Project {
  id: string;
  name: string;
  client: string | null;
  contract: string | null;
  scopeSummary: string | null;
  site: string | null;
  disciplines: string[];
  definitionOfDone: string | null;
  contractStart: string | null;
  contractFinish: string | null;
  statusDate: string | null;
  mspVersion: string;
  isDemo: boolean;
  version: number;
  myRole?: ProjectRole;
  _count?: Record<string, number>;
}

export interface QuantityItem {
  id: string;
  entityKey: string;
  discipline: string;
  sourceKind: string;
  area: string | null;
  system: string | null;
  lineNumber: string | null;
  pipeClass: string | null;
  schedule: string | null;
  nominalDiameterIn: number | null;
  itemType: string | null;
  qty: number;
  unit: string;
  dataClass: DataClass;
  confidence: number | null;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  note: string | null;
  version: number;
  documentRevision: string | null;
  evidence?: {
    id: string; page: number | null; bbox: number[]; snippet: string | null;
    method: string; confidence: number | null;
  } | null;
  document?: { id: string; fileName: string; documentNumber: string | null } | null;
}

export interface Activity {
  id: string;
  code: string;
  name: string;
  discipline: string | null;
  area: string | null;
  system: string | null;
  step: string | null;
  deliverable: string | null;
  completionCriteria: string | null;
  isMilestone: boolean;
  isContractual: boolean;
  qty: number | null;
  unit: string | null;
  workHH: number | null;
  actualWorkHH: number | null;
  remainingWorkHH: number | null;
  dailyCapacityHH: number | null;
  durationMinutes: number;
  durationStatus: 'CALCULATED' | 'NOT_CALCULABLE';
  missingInputs: { field: string; reason: string }[];
  calcMemo: string[];
  earlyStart: string | null;
  earlyFinish: string | null;
  lateStart: string | null;
  lateFinish: string | null;
  totalFloatMinutes: number | null;
  isCritical: boolean;
  actualStart: string | null;
  actualFinish: string | null;
  percentComplete: number;
  version: number;
  wbsNode?: { id: string; code: string; name: string; type: string } | null;
  productivity?: { value: number; perUnit: string; source: string; sourceDate: string } | null;
}

export interface LogicLink {
  id: string;
  predecessorId: string;
  successorId: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagMinutes: number;
  status: 'SUGGESTED' | 'VALIDATED' | 'REJECTED' | 'MODIFIED';
  reason: string;
  reasonKind: string;
  ruleId: string | null;
  sourceRefs: string[];
  confidence: number;
  version: number;
  predecessor: { id: string; code: string; name: string };
  successor: { id: string; code: string; name: string };
}

export interface WbsNode {
  id: string;
  parentId: string | null;
  type: 'PROJECT' | 'PHASE' | 'CWA' | 'CWP' | 'IWP' | 'ACTIVITY';
  code: string;
  name: string;
  discipline: string | null;
  area: string | null;
  system: string | null;
  scopeIn: string | null;
  scopeOut: string | null;
  deliverable: string | null;
  qty: number | null;
  unit: string | null;
  sortIndex: number;
  version: number;
}

export interface OpenIssue {
  id: string; scope: string; description: string; severity: string;
  status: string; createdAt: string;
}
