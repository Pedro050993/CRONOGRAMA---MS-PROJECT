export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';

export type LinkStatus = 'SUGGESTED' | 'VALIDATED' | 'REJECTED' | 'MODIFIED';

/** Motivo fisico/contratual/operacional da precedencia (§12.3). Sem motivo, o vinculo nao entra. */
export interface LinkRationale {
  reasonKind: 'PHYSICAL' | 'PROCESS' | 'CONTRACTUAL' | 'OPERATIONAL' | 'SAFETY' | 'RESOURCE' | 'QUALITY';
  reason: string;
  ruleId?: string;
  sourceRefs: string[];
  confidence: number;
}

export interface Link {
  id: string;
  predecessorId: string;
  successorId: string;
  type: LinkType;
  /** Defasagem em minutos de trabalho. Negativa = antecipacao. */
  lagMinutes: number;
  status: LinkStatus;
  rationale: LinkRationale;
  validatedBy?: string;
  validatedAt?: string;
}

export type ConstraintType =
  | 'ASAP' | 'ALAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';

export interface ScheduleConstraint {
  type: ConstraintType;
  date?: string;
  /** Restricao rigida sem justificativa e apontada pelo verificador de qualidade. */
  justification?: string;
}

export interface NetworkActivity {
  id: string;
  name: string;
  /** Duracao em minutos de trabalho. 0 = marco. */
  durationMinutes: number;
  calendarId: string;
  isMilestone: boolean;
  constraint?: ScheduleConstraint;
  /** Datas reais informadas na atualizacao. */
  actualStart?: string;
  actualFinish?: string;
  percentComplete?: number;
}

export interface CpmActivityResult {
  id: string;
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  totalFloatMinutes: number;
  freeFloatMinutes: number;
  isCritical: boolean;
}

export interface CpmResult {
  activities: Record<string, CpmActivityResult>;
  projectStart: string;
  projectFinish: string;
  criticalPath: string[];
  /** Ciclos detectados. Com ciclo, o CPM nao roda. */
  cycles: string[][];
}
