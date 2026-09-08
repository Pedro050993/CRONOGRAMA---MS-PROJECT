import { describe, expect, it } from 'vitest';
import { isProcessableNow, supportFor } from '../src/formats/index.js';

describe('suporte por formato — limitacao declarada, nao escondida', () => {
  it('PDF e imagem sao processados na Fase 1', () => {
    expect(isProcessableNow('CPM-20.701_RB.pdf')).toBe(true);
    expect(isProcessableNow('planta.TIFF')).toBe(true);
  });

  it('DWG traz mensagem explicita de bloqueio com alternativas', () => {
    const s = supportFor('PLANTA-100.dwg');
    expect(s.level).toBe('REQUIRES_EXTERNAL_SERVICE');
    expect(s.phase).toBe(2);
    expect(s.blockedMessage).toMatch(/proprietario/);
    expect(s.blockedMessage).toMatch(/nao foi interpretado/);
    expect(s.alternatives).toContain('DXF');
    expect(isProcessableNow('PLANTA-100.dwg')).toBe(false);
  });

  it('NWD nao promete leitura nativa e indica caminho alternativo', () => {
    const s = supportFor('modelo.NWD');
    expect(s.level).toBe('REQUIRES_EXTERNAL_SERVICE');
    expect(s.phase).toBe(3);
    expect(s.blockedMessage).toMatch(/nao tem leitura nativa/);
    expect(s.alternatives).toContain('IFC');
  });

  it('formato nao cadastrado e bloqueado com orientacao, nunca processado no escuro', () => {
    const s = supportFor('arquivo.xyz');
    expect(s.level).toBe('UNSUPPORTED');
    expect(s.blockedMessage).toMatch(/nao foi interpretado/);
  });
});
