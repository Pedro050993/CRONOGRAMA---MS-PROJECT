import type { DataClass, ReviewStatus } from '../lib/types';

const LABEL: Record<DataClass, { text: string; cls: string; help: string }> = {
  EXTRACTED_FACT: { text: 'FATO', cls: 'badge--fact', help: 'Extraido de documento, com evidencia localizavel.' },
  USER_INPUT: { text: 'INFORMADO', cls: 'badge--user', help: 'Digitado ou corrigido por usuario identificado.' },
  AI_INFERENCE: { text: 'IA', cls: 'badge--ai', help: 'Inferencia da IA. Nao alimenta plano aprovado sem revisao humana.' },
  PLANNING_ASSUMPTION: { text: 'PREMISSA', cls: 'badge--assumption', help: 'Condicao adotada para permitir a analise.' },
  CONFIGURABLE_RULE: { text: 'REGRA', cls: 'badge--rule', help: 'Resultado de regra configuravel do sistema.' },
  PENDING_INFO: { text: 'PENDENTE', cls: 'badge--pending', help: 'Falta o dado. Nenhum valor foi assumido.' },
  SOURCE_CONFLICT: { text: 'CONFLITO', cls: 'badge--conflict', help: 'Fontes divergem e nenhuma foi eleita.' },
};

/**
 * Selo de origem (§15). Todo valor exibido carrega o seu.
 * Sem selo, o numero na tela nao diz de onde veio — e e assim que um chute vira "dado".
 */
export function ProvenanceBadge({ dataClass, title }: { dataClass: DataClass; title?: string }): JSX.Element {
  const l = LABEL[dataClass] ?? LABEL.PENDING_INFO;
  return <span className={`badge ${l.cls}`} title={title ?? l.help}>{l.text}</span>;
}

const REVIEW: Record<ReviewStatus, { text: string; cls: string }> = {
  PENDING: { text: 'AGUARDA REVISAO', cls: 'badge--pending' },
  APPROVED: { text: 'APROVADO', cls: 'badge--fact' },
  CORRECTED: { text: 'CORRIGIDO', cls: 'badge--user' },
  REJECTED: { text: 'REJEITADO', cls: 'badge--conflict' },
  FLAGGED: { text: 'SINALIZADO', cls: 'badge--assumption' },
};

export function ReviewBadge({ status }: { status: ReviewStatus }): JSX.Element {
  const r = REVIEW[status] ?? REVIEW.PENDING;
  return <span className={`badge ${r.cls}`}>{r.text}</span>;
}

export function Confidence({ value }: { value: number | null | undefined }): JSX.Element {
  if (value === null || value === undefined) {
    return <span className="muted small" title="Sem confianca declarada.">—</span>;
  }
  const pct = Math.round(value * 100);
  const tone = pct >= 80 ? 'GREEN' : pct >= 55 ? 'YELLOW' : 'RED';
  return (
    <span className={`sem sem--${tone}`} title={`Confianca da extracao: ${pct}%. Abaixo de 55% priorize a revisao manual.`}>
      {pct}%
    </span>
  );
}

export function Semaphore({ level, rule }: { level: string; rule?: string }): JSX.Element {
  const text = { GREEN: 'VERDE', YELLOW: 'AMARELO', RED: 'VERMELHO', GREY: 'SEM BASE' }[level] ?? level;
  return <span className={`sem sem--${level}`} title={rule ?? 'Regra do semaforo nao informada.'}>{text}</span>;
}
