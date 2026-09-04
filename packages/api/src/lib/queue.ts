/**
 * Fila de processamento em tabela Postgres, com FOR UPDATE SKIP LOCKED.
 *
 * Motivo da escolha (ADR A3): a fila precisa ser consumida por Node E por Python.
 * Uma tabela transacional evita dois brokers e mantem o job na mesma transacao do dado.
 */
import { prisma } from '../db.js';

export type JobKind = 'document.process' | 'document.reprocess' | 'revision.impact' | 'schedule.recompute';

export interface EnqueueInput {
  projectId: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
}

export async function enqueue(input: EnqueueInput): Promise<string> {
  const job = await prisma.processingJob.create({
    data: {
      projectId: input.projectId,
      kind: input.kind,
      payload: input.payload as never,
      priority: input.priority ?? 100,
      maxAttempts: input.maxAttempts ?? 3,
    },
  });
  return job.id;
}

export interface ClaimedJob {
  id: string;
  projectId: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Reivindica um job sem corrida entre consumidores. */
export async function claimNext(workerId: string, kinds?: JobKind[]): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRawUnsafe<ClaimedJob[]>(
    `
    UPDATE "ProcessingJob" j
       SET status = 'RUNNING', "lockedBy" = $1, "lockedAt" = now(),
           "startedAt" = COALESCE(j."startedAt", now()), attempts = j.attempts + 1
     WHERE j.id = (
       SELECT c.id FROM "ProcessingJob" c
        WHERE c.status = 'QUEUED'
          AND c."runAfter" <= now()
          ${kinds && kinds.length ? `AND c.kind = ANY($2::text[])` : ''}
        ORDER BY c.priority ASC, c."createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING j.id, j."projectId", j.kind, j.payload, j.attempts
    `,
    workerId,
    ...(kinds && kinds.length ? [kinds] : []),
  );
  return rows[0] ?? null;
}

export async function reportProgress(jobId: string, progress: number, note?: string): Promise<void> {
  await prisma.processingJob.update({
    where: { id: jobId },
    data: { progress: Math.max(0, Math.min(100, Math.round(progress))), progressNote: note ?? null },
  });
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.processingJob.update({
    where: { id: jobId },
    data: { status: 'DONE', progress: 100, finishedAt: new Date(), lockedBy: null, lockedAt: null },
  });
}

/** Falha com nova tentativa em backoff exponencial ate esgotar maxAttempts. */
export async function failJob(jobId: string, error: string): Promise<{ willRetry: boolean }> {
  const job = await prisma.processingJob.findUniqueOrThrow({ where: { id: jobId } });
  const willRetry = job.attempts < job.maxAttempts;
  const backoffSeconds = 2 ** job.attempts * 15;
  await prisma.processingJob.update({
    where: { id: jobId },
    data: willRetry
      ? {
          status: 'QUEUED', lastError: error, lockedBy: null, lockedAt: null,
          runAfter: new Date(Date.now() + backoffSeconds * 1000),
        }
      : { status: 'FAILED', lastError: error, finishedAt: new Date(), lockedBy: null, lockedAt: null },
  });
  return { willRetry };
}

/** Recoloca na fila um job travado por worker morto. */
export async function reapStale(olderThanMinutes = 30): Promise<number> {
  const r = await prisma.processingJob.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: new Date(Date.now() - olderThanMinutes * 60000) } },
    data: { status: 'QUEUED', lockedBy: null, lockedAt: null, lastError: 'Worker nao respondeu; job recolocado na fila.' },
  });
  return r.count;
}

export async function retryJob(jobId: string): Promise<void> {
  await prisma.processingJob.update({
    where: { id: jobId },
    data: { status: 'QUEUED', attempts: 0, lastError: null, runAfter: new Date(), lockedBy: null, lockedAt: null, progress: 0 },
  });
}
