import { randomBytes, createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { db, adminUsers, adminSessions } from './db/index.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'admin_session';

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;


let dummyHashPromise: Promise<string> | null = null;
function getDummyHash() {
  return (dummyHashPromise ??= argon2.hash('timing-equalizer-placeholder', ARGON2_OPTS));
}

export function hashPassword(password: string) {
  return argon2.hash(password, ARGON2_OPTS);
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookieOptions(isProd: boolean) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

export async function verifyCredentials(username: string, password: string) {
  const [row] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, username));

  if (!row) {
    await argon2.verify(await getDummyHash(), password).catch(() => false);
    return null;
  }
  const ok = await argon2.verify(row.passwordHash, password).catch(() => false);
  return ok ? row : null;
}

export async function createSession(userId: number) {
  const raw = randomBytes(32).toString('base64url');
  const tokenHash = sha256(raw);
  const now = Date.now();
  await db.insert(adminSessions).values({
    tokenHash,
    userId,
    expiresAt: now + SESSION_TTL_MS,
    createdAt: now,
  });
  return raw;
}

export async function destroySession(raw: string) {
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, sha256(raw)));
}

async function lookupSession(raw: string) {
  const tokenHash = sha256(raw);
  const [row] = await db
    .select({
      userId: adminSessions.userId,
      expiresAt: adminSessions.expiresAt,
      username: adminUsers.username,
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.userId, adminUsers.id))
    .where(eq(adminSessions.tokenHash, tokenHash));

  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
    return null;
  }
  return { userId: row.userId, username: row.username };
}

export interface AdminRequest extends Request {
  admin?: { userId: number; username: string };
}

export function getSessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

export async function readSession(req: Request): Promise<{ userId: number; username: string } | null> {
  const raw = getSessionToken(req);
  if (!raw) return null;
  return lookupSession(raw);
}

export async function requireAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    req.admin = session;
    next();
  } catch (err) {
    console.error('[auth] session check failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// fine for single instance setup
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return next();
  }
  if (entry.count >= LOGIN_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  entry.count++;
  next();
}
