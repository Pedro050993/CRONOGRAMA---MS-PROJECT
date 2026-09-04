/**
 * Dados de DEMONSTRACAO.
 *
 * Tudo aqui e ficticio e explicitamente identificado: o projeto recebe o sufixo
 * [DEMONSTRACAO], os documentos recebem [TESTE] e a flag `isDemo` fica ligada,
 * para que a interface exiba a faixa de demonstracao (§23: nao usar dado simulado
 * sem identificacao visivel).
 *
 * Os indices de produtividade abaixo sao PREMISSAS DE DEMONSTRACAO, com fonte
 * declarada como ficticia. Nao use em obra real.
 */
import { prisma } from './db.js';
import { hashPassword } from './lib/auth.js';

const DEMO_SOURCE = 'PREMISSA DE DEMONSTRACAO — valor ficticio, nao aplicavel a obra real';

async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { id: 'demo-org' },
    create: { id: 'demo-org', name: 'Organizacao de Demonstracao' },
    update: {},
  });

  const password = process.env['SEED_PASSWORD'] ?? 'demonstracao-2026';
  const hash = await hashPassword(password);

  const users = await Promise.all([
    ['admin@demo.local', 'Administradora de Demonstracao', 'ADMIN'],
    ['planejador@demo.local', 'Planejador de Demonstracao', 'PLANNER'],
    ['revisor@demo.local', 'Revisor de Demonstracao', 'REVIEWER'],
    ['leitor@demo.local', 'Leitor de Demonstracao', 'VIEWER'],
  ].map(async ([email, name]) =>
    prisma.user.upsert({
      where: { email: email as string },
      create: { organizationId: org.id, email: email as string, name: name as string, passwordHash: hash },
      update: {},
    }),
  ));

  const existing = await prisma.project.findFirst({ where: { organizationId: org.id, isDemo: true } });
  if (existing) {
    console.log(`Projeto de demonstracao ja existe: ${existing.id}`);
    return;
  }

  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      name: 'Ampliacao da Unidade de Refrigeracao — Area 100 [DEMONSTRACAO]',
      client: 'Cliente Ficticio S.A. [TESTE]',
      contract: 'CT-DEMO-2026-001 [TESTE]',
      scopeSummary: 'Montagem eletromecanica de tubulacao de processo da Area 100. Dados ficticios para demonstracao.',
      site: 'Planta de demonstracao',
      disciplines: ['PIPING'],
      definitionOfDone: 'Sistema 12 com test pack aprovado, pendencias liberadas e termo de aceite assinado.',
      contractStart: new Date('2026-03-02T07:00:00Z'),
      contractFinish: new Date('2026-06-30T16:00:00Z'),
      statusDate: new Date('2026-04-06T07:00:00Z'),
      isDemo: true,
      members: {
        create: [
          { userId: users[0]!.id, role: 'ADMIN' },
          { userId: users[1]!.id, role: 'PLANNER' },
          { userId: users[2]!.id, role: 'REVIEWER' },
          { userId: users[3]!.id, role: 'VIEWER' },
        ],
      },
    },
  });

  const dayShifts = [{ start: '07:00', end: '12:00' }, { start: '13:00', end: '16:00' }];
  const calendar = await prisma.workCalendarDef.create({
    data: {
      projectId: project.id, code: 'CAL-5X8', name: 'Padrao 5x8 [DEMONSTRACAO]', isDefault: true,
      workWeek: { 0: [], 1: dayShifts, 2: dayShifts, 3: dayShifts, 4: dayShifts, 5: dayShifts, 6: [] },
      exceptions: [
        { date: '2026-04-03', working: false, name: 'Sexta-feira Santa' },
        { date: '2026-04-21', working: false, name: 'Tiradentes' },
      ],
    },
  });

  const [soldador, montador] = await Promise.all([
    prisma.resourceDef.create({
      data: { projectId: project.id, code: 'SOL', name: 'Soldador', group: 'Tubulacao', maxUnits: 6, productiveHoursPerDay: 6.5 },
    }),
    prisma.resourceDef.create({
      data: { projectId: project.id, code: 'MON', name: 'Montador', group: 'Tubulacao', maxUnits: 8, productiveHoursPerDay: 6.5 },
    }),
  ]);

  const idxMontagem = await prisma.productivityIndex.create({
    data: {
      projectId: project.id, code: 'IDX-MONT-CS', description: 'Montagem de tubulacao carbono [DEMONSTRACAO]',
      value: 0.9, perUnit: 'in-dia', basis: 'BUDGETED', source: DEMO_SOURCE, sourceDate: new Date('2026-01-15'),
    },
  });
  const idxSolda = await prisma.productivityIndex.create({
    data: {
      projectId: project.id, code: 'IDX-SOLD-CS', description: 'Soldagem de tubulacao carbono [DEMONSTRACAO]',
      value: 1.4, perUnit: 'in-dia', basis: 'BUDGETED', source: DEMO_SOURCE, sourceDate: new Date('2026-01-15'),
    },
  });

  // Documento de demonstracao com quantitativos ja validados.
  const doc = await prisma.document.create({
    data: {
      projectId: project.id, fileName: 'LISTA-DE-LINHAS-A100-RB.pdf [TESTE]', folderPath: '/DEMONSTRACAO/LISTAS',
      documentNumber: 'DEMO-LL-A100', discipline: 'PIPING', area: 'A100', system: 'SIS-12',
      suggestedType: 'LINE_LIST', typeConfidence: 0.9, confirmedType: 'LINE_LIST',
      confirmedBy: users[2]!.id, confirmedAt: new Date(), isDemo: true,
    },
  });
  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id, revision: 'B', sha256: 'demo-'.padEnd(64, '0'), byteSize: 1024,
      mimeType: 'application/pdf', storageKey: `projects/${project.id}/originals/demo/lista.pdf`,
      uploadedBy: users[1]!.id, status: 'DONE', pageCount: 1,
      markdown: '<!--@ doc=DEMO-LL-A100 rev=B page=1 method=demo conf=1.0 -->\n\n# Lista de linhas [TESTE]\n',
    },
  });
  await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });

  const lines = [
    { line: '10-P-1201-A1A', dn: 10, joints: 14, meters: 42 },
    { line: '8-P-1202-A1A', dn: 8, joints: 11, meters: 30 },
    { line: '6-P-1203-A1A', dn: 6, joints: 9, meters: 26 },
    { line: '4-P-1204-A1A', dn: 4, joints: 7, meters: 18 },
  ];

  for (const l of lines) {
    const evidence = await prisma.evidence.create({
      data: { versionId: version.id, page: 1, method: 'DEMO_SEED', confidence: 1, snippet: `${l.line} [TESTE]` },
    });
    await prisma.techEntity.create({
      data: {
        projectId: project.id, documentId: doc.id, evidenceId: evidence.id,
        entityKey: `LINE|${l.line}`, kind: 'PIPING_LINE', discipline: 'PIPING', area: 'A100', system: 'SIS-12',
        attributes: {
          lineNumber: l.line, nominalDiameterIn: l.dn, pipeClass: 'A1A', schedule: 'STD',
          testPackId: 'TP-DEMO-01', objectKey: `LINE|${l.line}`,
          ...(l.line !== '10-P-1201-A1A' ? { parentLineNumber: '10-P-1201-A1A' } : {}),
        },
        dataClass: 'USER_INPUT', confidence: 1, reviewStatus: 'APPROVED',
        reviewedBy: users[2]!.id, reviewedAt: new Date(),
      },
    });
    for (const q of [
      { unit: 'jt', qty: l.joints, itemType: 'JUNTA', key: `JOINTS|${l.line}` },
      { unit: 'm', qty: l.meters, itemType: 'TUBO', key: `PIPE|${l.line}` },
    ]) {
      await prisma.quantityItem.create({
        data: {
          projectId: project.id, documentId: doc.id, evidenceId: evidence.id,
          entityKey: q.key, discipline: 'PIPING', sourceKind: 'LINE_LIST', documentRevision: 'B',
          area: 'A100', system: 'SIS-12', lineNumber: l.line, pipeClass: 'A1A', schedule: 'STD',
          nominalDiameterIn: l.dn, itemType: q.itemType, qty: q.qty, unit: q.unit,
          dataClass: 'USER_INPUT', confidence: 1, reviewStatus: 'APPROVED',
          reviewedBy: users[2]!.id, reviewedAt: new Date(),
        },
      });
    }
  }

  // EAP: Projeto > CWA > CWP > IWP > atividades
  const root = await prisma.wbsNode.create({
    data: { projectId: project.id, parentId: null, type: 'PROJECT', code: 'DEMO', name: project.name, sortIndex: 1 },
  });
  const cwa = await prisma.wbsNode.create({
    data: { projectId: project.id, parentId: root.id, type: 'CWA', code: 'DEMO.A100', name: 'Area 100', area: 'A100', sortIndex: 1 },
  });
  const cwp = await prisma.wbsNode.create({
    data: {
      projectId: project.id, parentId: cwa.id, type: 'CWP', code: 'DEMO.A100.TUB',
      name: 'Tubulacao — Sistema 12', discipline: 'PIPING', area: 'A100', system: 'SIS-12', sortIndex: 1,
    },
  });

  const totalInDia = lines.reduce((s, l) => s + l.joints * l.dn, 0);
  const iwp = await prisma.wbsNode.create({
    data: {
      projectId: project.id, parentId: cwp.id, type: 'IWP', code: 'DEMO.A100.TUB.IWP01',
      name: 'IWP 01 — Montagem e soldagem do Sistema 12', discipline: 'PIPING', area: 'A100', system: 'SIS-12',
      deliverable: 'Sistema 12 montado, soldado e com END aprovado',
      scopeIn: 'Montagem, soldagem, inspecao visual e END das linhas 10-P-1201 a 4-P-1204',
      scopeOut: 'Nao inclui pintura, isolamento, suportes definitivos nem test pack',
      qty: totalInDia, unit: 'in-dia',
      acceptanceCriteria: [
        { description: 'Todas as juntas com END aprovado', evidenceRequired: 'Laudo de END por junta' },
        { description: 'Pendencias de montagem liberadas', evidenceRequired: 'Lista de pendencias assinada' },
      ],
      sortIndex: 1,
    },
  });

  const quantityIds = (await prisma.quantityItem.findMany({ where: { projectId: project.id, unit: 'jt' }, select: { id: true } })).map((q) => q.id);

  const montagem = await prisma.activity.create({
    data: {
      projectId: project.id, wbsNodeId: iwp.id, calendarId: calendar.id, productivityId: idxMontagem.id,
      code: 'A-1000', name: 'Montagem das linhas do Sistema 12 [DEMONSTRACAO]',
      discipline: 'PIPING', area: 'A100', system: 'SIS-12', step: 'ERECTION',
      deliverable: 'Linhas posicionadas e ponteadas',
      completionCriteria: 'Todas as linhas montadas e conferidas contra isometrico',
      qty: totalInDia, unit: 'in-dia', quantityItemIds: quantityIds,
      assignments: { create: [{ resourceId: montador.id, count: 6, units: 6, workHH: 0 }] },
    },
  });
  const soldagem = await prisma.activity.create({
    data: {
      projectId: project.id, wbsNodeId: iwp.id, calendarId: calendar.id, productivityId: idxSolda.id,
      code: 'A-1010', name: 'Soldagem das juntas do Sistema 12 [DEMONSTRACAO]',
      discipline: 'PIPING', area: 'A100', system: 'SIS-12', step: 'WELDING',
      deliverable: 'Juntas soldadas conforme EPS',
      completionCriteria: 'Juntas soldadas e liberadas para END',
      qty: totalInDia, unit: 'in-dia', quantityItemIds: quantityIds,
      assignments: { create: [{ resourceId: soldador.id, count: 4, units: 4, workHH: 0 }] },
    },
  });
  const marco = await prisma.activity.create({
    data: {
      projectId: project.id, wbsNodeId: iwp.id, calendarId: calendar.id,
      code: 'M-9000', name: 'Marco: Sistema 12 liberado para teste [DEMONSTRACAO]',
      isMilestone: true, isContractual: true, step: 'PUNCH_CLEARANCE',
      deliverable: 'Sistema 12 pronto para test pack',
      completionCriteria: 'Montagem e soldagem concluidas com END aprovado',
      durationStatus: 'CALCULATED',
    },
  });

  await prisma.logicLink.createMany({
    data: [
      {
        projectId: project.id, predecessorId: montagem.id, successorId: soldagem.id, type: 'FS', lagMinutes: 0,
        status: 'VALIDATED', reasonKind: 'PROCESS',
        reason: 'Mesmo objeto: montagem precede tecnicamente a soldagem.',
        ruleId: 'SEQ.PROCESS_CHAIN', sourceRefs: [doc.id], confidence: 0.95,
        validatedBy: users[1]!.id, validatedAt: new Date(),
      },
      {
        projectId: project.id, predecessorId: soldagem.id, successorId: marco.id, type: 'FS', lagMinutes: 0,
        status: 'VALIDATED', reasonKind: 'QUALITY',
        reason: 'O marco de liberacao depende da conclusao da soldagem e do END.',
        ruleId: 'SEQ.PROCESS_CHAIN', sourceRefs: [doc.id], confidence: 0.9,
        validatedBy: users[1]!.id, validatedAt: new Date(),
      },
    ],
  });

  await prisma.constraintRecord.create({
    data: {
      projectId: project.id, wbsNodeId: iwp.id,
      description: 'Liberacao de material dos spools do Sistema 12 [TESTE]',
      category: 'MATERIAL', owner: 'Suprimentos [TESTE]',
      neededBy: new Date('2026-03-10T00:00:00Z'), promisedBy: new Date('2026-03-08T00:00:00Z'),
      status: 'OPEN', potentialImpact: 'Impede o inicio da montagem do sistema 12.',
      origin: 'Reuniao de restricoes de demonstracao',
    },
  });

  await prisma.assumption.create({
    data: {
      projectId: project.id,
      statement: 'Os indices de produtividade deste projeto sao ficticios e servem apenas a demonstracao.',
      rationale: 'Nenhum historico real foi utilizado.',
      source: DEMO_SOURCE,
    },
  });

  console.log(`Projeto de demonstracao criado: ${project.id}`);
  console.log(`Usuarios: admin@demo.local, planejador@demo.local, revisor@demo.local, leitor@demo.local`);
  console.log(`Senha: ${password}`);
  console.log('Rode POST /api/projects/:id/schedule/compute-durations e depois /schedule/compute para gerar as datas.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
