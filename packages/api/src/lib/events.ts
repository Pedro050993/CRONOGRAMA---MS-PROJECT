/**
 * Barramento de eventos por projeto, entregue via SSE.
 * Escolhemos SSE em vez de WebSocket porque o fluxo e servidor -> cliente,
 * atravessa proxy corporativo e reconecta sozinho.
 */
import type { FastifyReply } from 'fastify';

export type ProjectEventKind =
  | 'document.uploaded' | 'document.processing' | 'document.processed' | 'document.failed'
  | 'entity.updated' | 'quantity.approved' | 'quantity.updated'
  | 'wbs.changed' | 'link.updated' | 'schedule.recalculated'
  | 'revision.impact.ready' | 'export.ready' | 'constraint.updated' | 'comment.added';

export interface ProjectEvent {
  kind: ProjectEventKind;
  projectId: string;
  at: string;
  by?: string;
  payload: Record<string, unknown>;
}

type Client = { id: number; reply: FastifyReply };

const clients = new Map<string, Client[]>();
let nextId = 1;

export function subscribe(projectId: string, reply: FastifyReply): () => void {
  const id = nextId++;
  const list = clients.get(projectId) ?? [];
  list.push({ id, reply });
  clients.set(projectId, list);
  return () => {
    const cur = clients.get(projectId) ?? [];
    clients.set(projectId, cur.filter((c) => c.id !== id));
  };
}

export function publish(event: Omit<ProjectEvent, 'at'>): void {
  const full: ProjectEvent = { ...event, at: new Date().toISOString() };
  const data = `event: ${full.kind}\ndata: ${JSON.stringify(full)}\n\n`;
  for (const c of clients.get(full.projectId) ?? []) {
    try { c.reply.raw.write(data); } catch { /* cliente desconectado; limpeza ocorre no unsubscribe */ }
  }
}

export function subscriberCount(projectId: string): number {
  return (clients.get(projectId) ?? []).length;
}
