import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, API_BASE, getToken } from './api';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | Error | null;
  reload: () => void;
}

/** Busca dados com estados explicitos de carregando, vazio e erro (§15). */
export function useApi<T>(path: string | null, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<T>(path)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setError(e as ApiError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

export interface ProjectEvent {
  kind: string;
  projectId: string;
  at: string;
  by?: string;
  payload: Record<string, unknown>;
}

/**
 * Assina o canal de eventos do projeto.
 * O EventSource nao envia cabecalho de autorizacao, entao o token vai na query e a
 * API o valida do mesmo modo. A conexao reconecta sozinha.
 */
export function useProjectEvents(projectId: string | undefined, onEvent: (e: ProjectEvent) => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!projectId) return;
    const token = getToken();
    if (!token) return;

    const source = new EventSource(`${API_BASE}/api/projects/${projectId}/events?token=${encodeURIComponent(token)}`);
    const kinds = [
      'connected', 'document.uploaded', 'document.processing', 'document.processed', 'document.failed',
      'entity.updated', 'quantity.approved', 'quantity.updated', 'wbs.changed', 'link.updated',
      'schedule.recalculated', 'revision.impact.ready', 'export.ready', 'constraint.updated', 'comment.added',
    ];
    const listeners: [string, EventListener][] = kinds.map((kind) => {
      const fn: EventListener = (ev) => {
        setConnected(true);
        if (kind === 'connected') return;
        try { handler.current(JSON.parse((ev as MessageEvent).data) as ProjectEvent); } catch { /* payload invalido */ }
      };
      source.addEventListener(kind, fn);
      return [kind, fn];
    });
    source.onerror = () => setConnected(false);

    return () => {
      for (const [kind, fn] of listeners) source.removeEventListener(kind, fn);
      source.close();
    };
  }, [projectId]);

  return { connected };
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch { return initial; }
  });
  const set = useCallback((v: T) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sem storage */ }
  }, [key]);
  return [value, set];
}
