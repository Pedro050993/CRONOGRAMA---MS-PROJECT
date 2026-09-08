import { prisma } from '../db.js';

export interface AuditInput {
  projectId?: string | null;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  justification?: string | null;
  ip?: string | null;
}

/**
 * Registro de auditoria. Toda alteracao relevante grava valor anterior e novo.
 * Nao ha caminho de escrita "silencioso" nas rotas de mutacao.
 */
export async function audit(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      projectId: input.projectId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      before: (input.before ?? null) as never,
      after: (input.after ?? null) as never,
      justification: input.justification ?? null,
      ip: input.ip ?? null,
    },
  });
}
