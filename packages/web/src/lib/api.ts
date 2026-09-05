/**
 * Cliente da API.
 *
 * Nenhuma chave de servico trafega pelo frontend (§19): o navegador so conhece a
 * URL da API e o token de sessao do proprio usuario.
 */
const TOKEN_KEY = 'cronograma.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isConflict(): boolean { return this.status === 409; }
}

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* navegador sem storage: a sessao dura a aba */ }
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });

  if (res.status === 401) {
    setToken(null);
    if (!location.pathname.startsWith('/login')) location.href = '/login';
    throw new ApiError(401, 'Sessao expirada. Entre novamente.');
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    let payload: { message?: string; error?: string; details?: unknown } = {};
    if (contentType.includes('json')) payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload.message ?? `Falha na requisicao (${res.status}).`, payload.error, payload.details);
  }
  if (res.status === 204) return undefined as T;
  if (contentType.includes('json')) return res.json() as Promise<T>;
  return res.text() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form, true),
  download: async (path: string, fileName: string): Promise<void> => {
    const token = getToken();
    const res = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ message: `Falha ao exportar (${res.status}).` }));
      throw new ApiError(res.status, payload.message ?? 'Falha ao exportar.', payload.error, payload);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  },
};
