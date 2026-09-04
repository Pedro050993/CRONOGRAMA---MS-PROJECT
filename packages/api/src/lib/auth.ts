/**
 * Autenticacao sem dependencia nativa: scrypt (node:crypto) para senha e
 * JWT HS256 assinado localmente. Escolha deliberada para manter build reproduzivel.
 */
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../env.js';

const scryptAsync = promisify(scrypt) as (p: string, s: Buffer, k: number) => Promise<Buffer>;
const KEYLEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 10) throw new Error('A senha deve ter ao menos 10 caracteres.');
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const derived = await scryptAsync(plain, Buffer.from(saltB64, 'base64'), KEYLEN);
  const expected = Buffer.from(hashB64, 'base64');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface JwtPayload {
  sub: string;
  org: string;
  email: string;
  exp: number;
  iat: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function parseDuration(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s.trim());
  if (!m || !m[1] || !m[2]) throw new Error(`JWT_EXPIRES_IN invalido: "${s}". Use ex.: 8h, 30m, 7d.`);
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]]!;
  return Number(m[1]) * mult;
}

export function signToken(payload: Omit<JwtPayload, 'exp' | 'iat'>): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + parseDuration(env.jwtExpiresIn);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat, exp }));
  const sig = createHmac('sha256', env.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token malformado.');
  const [header, body, sig] = parts as [string, string, string];
  const expected = createHmac('sha256', env.jwtSecret).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Assinatura invalida.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload;
  if (payload.exp * 1000 < Date.now()) throw new Error('Token expirado.');
  return payload;
}
