import type { ProjectRole } from '@prisma/client';
import { prisma } from '../db.js';
import { forbidden, notFound } from './http.js';

/** Ordem de poder. ADMIN inclui tudo; VIEWER apenas le. */
const RANK: Record<ProjectRole, number> = { VIEWER: 0, REVIEWER: 1, PLANNER: 2, ADMIN: 3 };

export type Capability =
  | 'project.read' | 'project.write' | 'project.admin'
  | 'document.upload' | 'document.classify'
  | 'validation.approve'
  | 'schedule.write' | 'baseline.create' | 'actual.write'
  | 'export.create';

/**
 * Mapa de capacidade -> papel minimo.
 * REVIEWER aprova extracoes mas nao edita o cronograma; PLANNER edita mas nao
 * altera o realizado sem ser ADMIN (§4.3).
 */
const REQUIRED: Record<Capability, ProjectRole> = {
  'project.read': 'VIEWER',
  'project.write': 'PLANNER',
  'project.admin': 'ADMIN',
  'document.upload': 'PLANNER',
  'document.classify': 'REVIEWER',
  'validation.approve': 'REVIEWER',
  'schedule.write': 'PLANNER',
  'baseline.create': 'ADMIN',
  'actual.write': 'ADMIN',
  'export.create': 'VIEWER',
};

export async function requireMembership(userId: string, projectId: string): Promise<ProjectRole> {
  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (!m) {
    // Nao revelamos se o projeto existe: isolamento entre projetos (§16).
    throw notFound('Projeto nao encontrado ou sem acesso.');
  }
  return m.role;
}

export async function requireCapability(userId: string, projectId: string, cap: Capability): Promise<ProjectRole> {
  const role = await requireMembership(userId, projectId);
  if (RANK[role] < RANK[REQUIRED[cap]]) {
    throw forbidden(`Acao "${cap}" exige papel ${REQUIRED[cap]} ou superior. Seu papel neste projeto e ${role}.`);
  }
  return role;
}

export function can(role: ProjectRole, cap: Capability): boolean {
  return RANK[role] >= RANK[REQUIRED[cap]];
}
