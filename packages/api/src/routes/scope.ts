import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  detectDoubleCount, deriveWeldInchDiameter, rollup,
  type QuantityItem as CoreQuantityItem, type RollupDimension,
} from '@cronograma/core';
import { currentUser } from '../app.js';
import { prisma } from '../db.js';
import { requireMembership } from '../lib/rbac.js';

/** Converte a linha do banco para o tipo do dominio, preservando proveniencia. */
function toCore(q: {
  id: string; entityKey: string; discipline: string; sourceKind: string; documentId: string | null;
  documentRevision: string | null; area: string | null; system: string | null; subsystem: string | null;
  lineNumber: string | null; tag: string | null; material: string | null; pipeClass: string | null;
  schedule: string | null; nominalDiameterIn: number | null; itemType: string | null; controlUnit: string | null;
  wbsNodeId: string | null; qty: number; unit: string; dataClass: string; confidence: number | null;
  reviewStatus: string; reviewedBy: string | null; reviewedAt: Date | null; note: string | null; createdAt: Date;
}): CoreQuantityItem {
  return {
    id: q.id,
    entityKey: q.entityKey,
    discipline: q.discipline as CoreQuantityItem['discipline'],
    sourceKind: q.sourceKind as CoreQuantityItem['sourceKind'],
    documentId: q.documentId ?? '(sem documento)',
    ...(q.documentRevision ? { documentRevision: q.documentRevision } : {}),
    ...(q.area ? { area: q.area } : {}),
    ...(q.system ? { system: q.system } : {}),
    ...(q.subsystem ? { subsystem: q.subsystem } : {}),
    ...(q.lineNumber ? { lineNumber: q.lineNumber } : {}),
    ...(q.tag ? { tag: q.tag } : {}),
    ...(q.material ? { material: q.material } : {}),
    ...(q.pipeClass ? { pipeClass: q.pipeClass } : {}),
    ...(q.schedule ? { schedule: q.schedule } : {}),
    ...(q.nominalDiameterIn !== null ? { nominalDiameterIn: q.nominalDiameterIn } : {}),
    ...(q.itemType ? { itemType: q.itemType } : {}),
    ...(q.controlUnit ? { controlUnit: q.controlUnit } : {}),
    ...(q.wbsNodeId ? { workPackageId: q.wbsNodeId } : {}),
    measure: { qty: q.qty, unit: q.unit },
    provenance: {
      dataClass: q.dataClass as never,
      method: 'TABLE_PARSER',
      ...(q.confidence !== null ? { confidence: q.confidence } : {}),
      evidence: q.documentId ? [{ documentId: q.documentId }] : [],
      processedAt: q.createdAt.toISOString(),
      reviewStatus: q.reviewStatus as never,
      ...(q.reviewedBy ? { reviewedBy: q.reviewedBy } : {}),
      ...(q.reviewedAt ? { reviewedAt: q.reviewedAt.toISOString() } : {}),
      ...(q.note ? { note: q.note } : {}),
    },
  };
}

export async function registerScopeRoutes(app: FastifyInstance): Promise<void> {
  /** Quadro quantitativo consolidado, com selo de origem e confianca por linha. */
  app.get('/api/projects/:id/quantities/rollup', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const q = z.object({
      groupBy: z.string().default('discipline'),
      unit: z.string().default('m'),
      onlyApproved: z.coerce.boolean().default(false),
      discipline: z.string().optional(),
      area: z.string().optional(),
      system: z.string().optional(),
    }).parse(req.query);

    const rows = await prisma.quantityItem.findMany({
      where: {
        projectId: id,
        ...(q.discipline ? { discipline: q.discipline } : {}),
        ...(q.area ? { area: q.area } : {}),
        ...(q.system ? { system: q.system } : {}),
        ...(q.onlyApproved ? { reviewStatus: { in: ['APPROVED', 'CORRECTED'] } } : {}),
      },
    });
    const items = rows.map(toCore);
    const groupBy = q.groupBy.split(',').map((s) => s.trim()).filter(Boolean) as RollupDimension[];
    const result = rollup(items, { groupBy, targetUnit: q.unit, includePendingReview: !q.onlyApproved });
    return {
      ...result,
      excluded: result.excluded.map((e) => ({ itemId: e.item.id, entityKey: e.item.entityKey, unit: e.item.measure.unit, reason: e.reason })),
    };
  });

  /** Verificacao anti-dupla-contagem entre lista de linhas, isometrico, MTO e modelo. */
  app.get('/api/projects/:id/quantities/double-count', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const rows = await prisma.quantityItem.findMany({ where: { projectId: id } });
    const findings = detectDoubleCount(rows.map(toCore), null);
    return {
      findings,
      summary: {
        confirmed: findings.filter((f) => f.severity === 'CONFIRMED').length,
        suspected: findings.filter((f) => f.severity === 'SUSPECTED').length,
      },
      note:
        'Nenhuma fonte foi eleita vencedora automaticamente. Configure e aprove uma regra de precedencia ' +
        'documental para resolver os conflitos confirmados (§7.5).',
    };
  });

  app.get('/api/projects/:id/quantities/weld-inch', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const rows = await prisma.quantityItem.findMany({ where: { projectId: id, unit: 'jt' } });
    const r = deriveWeldInchDiameter(rows.map(toCore));
    return {
      total: r.total, unit: r.unit, memo: r.memo,
      skipped: r.skipped.map((s) => ({ itemId: s.id, entityKey: s.entityKey, reason: 'Junta sem DN identificado — nao entra no total.' })),
    };
  });

  /** Reconciliacao entre fontes (§7.5). Divergencias sao expostas, nunca resolvidas em silencio. */
  app.get('/api/projects/:id/reconciliation', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);

    const items = await prisma.quantityItem.findMany({ where: { projectId: id } });
    const byLine = new Map<string, typeof items>();
    for (const it of items) {
      if (!it.lineNumber) continue;
      const arr = byLine.get(it.lineNumber) ?? [];
      arr.push(it);
      byLine.set(it.lineNumber, arr);
    }

    const pairs: [string, string][] = [
      ['LINE_LIST', 'PIPING_ISOMETRIC'], ['PIPING_ISOMETRIC', 'MTO'], ['PID', 'LINE_LIST'],
    ];
    const divergences: unknown[] = [];
    const omissions: unknown[] = [];

    for (const [line, group] of byLine) {
      const sources = new Set(group.map((g) => g.sourceKind));
      for (const [a, b] of pairs) {
        if (sources.has(a) && !sources.has(b)) {
          omissions.push({ lineNumber: line, presentIn: a, missingIn: b, message: `Linha "${line}" aparece em ${a} mas nao em ${b}.` });
        }
      }
      const lengths = group.filter((g) => g.unit === 'm');
      if (lengths.length > 1) {
        const distinct = [...new Set(lengths.map((l) => l.qty))];
        if (distinct.length > 1) {
          divergences.push({
            lineNumber: line, field: 'comprimento', unit: 'm',
            values: lengths.map((l) => ({ sourceKind: l.sourceKind, documentId: l.documentId, qty: l.qty })),
            message: `Comprimento da linha "${line}" diverge entre fontes: ${distinct.join(' | ')} m.`,
          });
        }
      }
      const classes = [...new Set(group.map((g) => g.pipeClass).filter(Boolean))];
      if (classes.length > 1) {
        divergences.push({
          lineNumber: line, field: 'classe', values: classes,
          message: `Classe da linha "${line}" diverge entre fontes: ${classes.join(' | ')}.`,
        });
      }
    }

    return {
      linesAnalyzed: byLine.size,
      divergences,
      omissions,
      note: 'Nenhuma fonte vencedora foi escolhida. Cada divergencia exige decisao humana ou regra de precedencia aprovada.',
    };
  });

  /** Resumo executivo do escopo (§9), com grau de confianca declarado. */
  app.get('/api/projects/:id/scope-summary', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);

    const project = await prisma.project.findUniqueOrThrow({ where: { id } });
    const [docs, quantities, issues, conflicts, wbsCount, activityCount] = await Promise.all([
      prisma.document.findMany({
        where: { projectId: id },
        select: { id: true, confirmedType: true, suggestedType: true, area: true, system: true, discipline: true, currentVersion: { select: { status: true } } },
      }),
      prisma.quantityItem.findMany({ where: { projectId: id } }),
      prisma.openIssue.findMany({ where: { projectId: id, status: 'OPEN' } }),
      prisma.sourceConflict.count({ where: { projectId: id, status: 'OPEN' } }),
      prisma.wbsNode.count({ where: { projectId: id } }),
      prisma.activity.count({ where: { projectId: id } }),
    ]);

    const approved = quantities.filter((q) => q.reviewStatus === 'APPROVED' || q.reviewStatus === 'CORRECTED');
    const approvalRate = quantities.length > 0 ? approved.length / quantities.length : 0;
    const confidences = quantities.map((q) => q.confidence).filter((c): c is number => c !== null);
    const avgConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
    const blockedDocs = docs.filter((d) => d.currentVersion?.status === 'BLOCKED_UNSUPPORTED').length;
    const failedDocs = docs.filter((d) => d.currentVersion?.status === 'FAILED').length;
    const unclassified = docs.filter((d) => !d.confirmedType).length;

    const byDiscipline = new Map<string, { count: number; units: Set<string> }>();
    for (const q of quantities) {
      const e = byDiscipline.get(q.discipline) ?? { count: 0, units: new Set<string>() };
      e.count += 1;
      e.units.add(q.unit);
      byDiscipline.set(q.discipline, e);
    }

    // Grau de confianca da base: media ponderada entre aprovacao humana, confianca da
    // extracao e ausencia de bloqueios. Formula visivel, nao um numero magico.
    const docHealth = docs.length > 0 ? 1 - (blockedDocs + failedDocs + unclassified) / (docs.length * 3) : 0;
    const baseScore = quantities.length === 0 ? 0 : (approvalRate * 0.5 + (avgConfidence ?? 0) * 0.3 + docHealth * 0.2);
    const confidenceLevel = baseScore >= 0.75 ? 'ALTO' : baseScore >= 0.45 ? 'MEDIO' : 'BAIXO';

    const sufficiency: string[] = [];
    if (quantities.length === 0) sufficiency.push('Nao ha quantitativo extraido: a base nao permite planejar.');
    if (approvalRate < 0.8) sufficiency.push(`Apenas ${(approvalRate * 100).toFixed(0)}% dos quantitativos passaram por validacao humana.`);
    if (issues.length > 0) sufficiency.push(`${issues.length} pendencia(s) aberta(s) de informacao.`);
    if (conflicts > 0) sufficiency.push(`${conflicts} conflito(s) entre fontes sem resolucao.`);
    if (blockedDocs > 0) sufficiency.push(`${blockedDocs} documento(s) em formato nao interpretavel nesta fase.`);
    if (unclassified > 0) sufficiency.push(`${unclassified} documento(s) sem tipo confirmado por humano.`);

    return {
      project: {
        name: project.name, client: project.client, contract: project.contract, site: project.site,
        scopeSummary: project.scopeSummary, definitionOfDone: project.definitionOfDone,
        contractStart: project.contractStart, contractFinish: project.contractFinish,
        isDemo: project.isDemo,
      },
      areas: [...new Set(docs.map((d) => d.area).filter(Boolean))],
      systems: [...new Set(docs.map((d) => d.system).filter(Boolean))],
      disciplines: [...new Set([...project.disciplines, ...docs.map((d) => d.discipline).filter((x): x is string => Boolean(x))])],
      documents: {
        total: docs.length, unclassified, blocked: blockedDocs, failed: failedDocs,
      },
      quantities: {
        total: quantities.length, approved: approved.length,
        approvalRate: Number(approvalRate.toFixed(4)),
        avgConfidence: avgConfidence === null ? null : Number(avgConfidence.toFixed(4)),
        byDiscipline: [...byDiscipline.entries()].map(([d, v]) => ({ discipline: d, items: v.count, units: [...v.units] })),
      },
      structure: { wbsNodes: wbsCount, activities: activityCount },
      openIssues: issues,
      sourceConflicts: conflicts,
      baseConfidence: {
        score: Number(baseScore.toFixed(4)),
        level: confidenceLevel,
        formula: 'score = 0,5 × taxa_de_aprovacao + 0,3 × confianca_media_extracao + 0,2 × saude_documental',
      },
      readyToPlan: sufficiency.length === 0,
      whatIsMissing: sufficiency,
    };
  });
}
