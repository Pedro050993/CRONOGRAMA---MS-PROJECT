import { conflict } from './http.js';

/**
 * Concorrencia otimista (§16): a alteracao carrega a versao que o cliente leu.
 * Divergiu, devolvemos 409 com o estado atual — nunca sobrescrita silenciosa.
 */
export function assertVersion(
  entityLabel: string,
  current: { version: number; updatedAt?: Date | null },
  expected: number | undefined,
): void {
  if (expected === undefined) {
    throw conflict(
      `${entityLabel}: a alteracao precisa informar a versao lida (cabecalho If-Match ou campo "version"). ` +
      'Sem isso, duas pessoas poderiam sobrescrever uma a outra sem perceber.',
    );
  }
  if (current.version !== expected) {
    throw conflict(
      `${entityLabel} foi alterado por outra pessoa (versao atual ${current.version}, voce leu ${expected}). ` +
      'Recarregue, compare e reenvie.',
      { currentVersion: current.version, updatedAt: current.updatedAt },
    );
  }
}
