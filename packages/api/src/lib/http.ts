export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly details?: unknown) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (m: string, details?: unknown): HttpError => new HttpError(400, m, 'BAD_REQUEST', details);
export const unauthorized = (m = 'Nao autenticado.'): HttpError => new HttpError(401, m, 'UNAUTHORIZED');
export const forbidden = (m: string): HttpError => new HttpError(403, m, 'FORBIDDEN');
export const notFound = (m: string): HttpError => new HttpError(404, m, 'NOT_FOUND');
export const conflict = (m: string, details?: unknown): HttpError => new HttpError(409, m, 'CONFLICT', details);
export const unprocessable = (m: string, details?: unknown): HttpError => new HttpError(422, m, 'UNPROCESSABLE', details);
