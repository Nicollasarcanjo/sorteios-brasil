import crypto from 'node:crypto';
import type {Request, Response, NextFunction} from 'express';

export interface SessionPayload {
  sub: string;
  role: 'buyer' | 'admin';
  email?: string;
  exp: number;
}

const ADMIN_COOKIE_NAME = 'leonida_admin_token';
const BUYER_COOKIE_NAME = 'leonida_buyer_token';

// Ephemeral fallback secret for local preview if SESSION_SECRET is unset
const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 16 && !configured.startsWith('CHANGE_ME')) {
    return configured;
  }
  return EPHEMERAL_SECRET;
}

// Default dev credentials (salted scrypt hash generated on boot if ADMIN_PASSWORD not overridden)
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@leonida.vi').toLowerCase().trim();
const DEFAULT_DEV_PASS = 'LeonidaAdmin#2026';
const DEV_SALT = crypto.randomBytes(16).toString('hex');
const ACTIVE_PASS =
  process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD.startsWith('CHANGE_ME')
    ? process.env.ADMIN_PASSWORD
    : DEFAULT_DEV_PASS;
const ACTIVE_PASS_HASH = crypto.scryptSync(ACTIVE_PASS, DEV_SALT, 64);

export function verifyAdminCredentials(email: string, password: string): boolean {
  const normalizedEmail = email.toLowerCase().trim();
  const emailBuf = Buffer.from(normalizedEmail, 'utf8');
  const expectedEmailBuf = Buffer.from(ADMIN_EMAIL, 'utf8');
  const emailMatch =
    emailBuf.length === expectedEmailBuf.length &&
    crypto.timingSafeEqual(emailBuf, expectedEmailBuf);

  const candidateHash = crypto.scryptSync(password, DEV_SALT, 64);
  const passMatch = crypto.timingSafeEqual(candidateHash, ACTIVE_PASS_HASH);

  return emailMatch && passMatch;
}

export function getAdminEmailConfigured(): string {
  return ADMIN_EMAIL;
}

export function isCustomAdminConfigured(): boolean {
  const hasCustomEmail =
    Boolean(process.env.ADMIN_EMAIL) &&
    process.env.ADMIN_EMAIL!.toLowerCase().trim() !== 'admin@leonida.vi';
  const hasCustomPass =
    Boolean(process.env.ADMIN_PASSWORD) &&
    !process.env.ADMIN_PASSWORD!.startsWith('CHANGE_ME');
  return hasCustomEmail || hasCustomPass;
}

export function getMaskedAdminEmailHint(): string {
  return maskContact(ADMIN_EMAIL);
}

export function signSessionToken(payload: SessionPayload): string {
  const headerB64 = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  const sigBuf = Buffer.from(sigB64);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionPayload;
    if (!decoded || typeof decoded.sub !== 'string' || typeof decoded.exp !== 'number') {
      return null;
    }
    if (Date.now() > decoded.exp) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function isHttpsRequest(req: Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.includes('https')) return true;
  return Boolean(req.secure);
}

export function setAuthCookie(
  req: Request,
  res: Response,
  name: string,
  token: string,
  maxAgeSeconds: number,
): void {
  const https = isHttpsRequest(req);
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
    https ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (https) {
    parts.push('Secure');
  }
  res.append('Set-Cookie', parts.join('; '));
}

export function clearAuthCookie(req: Request, res: Response, name: string): void {
  const https = isHttpsRequest(req);
  const parts = [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    https ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (https) {
    parts.push('Secure');
  }
  res.append('Set-Cookie', parts.join('; '));
}

export function getOrCreateBuyerSession(
  req: Request,
  res: Response,
): {session: SessionPayload; token: string} {
  const headerToken =
    typeof req.headers['x-buyer-token'] === 'string'
      ? req.headers['x-buyer-token'].trim()
      : undefined;
  const cookies = parseCookies(req);
  const rawToken = headerToken || cookies[BUYER_COOKIE_NAME];
  const existing = verifySessionToken(rawToken);
  if (existing && existing.role === 'buyer' && rawToken) {
    return {session: existing, token: rawToken};
  }
  const newSession: SessionPayload = {
    sub: `buyer_${crypto.randomBytes(12).toString('hex')}`,
    role: 'buyer',
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  };
  const token = signSessionToken(newSession);
  setAuthCookie(req, res, BUYER_COOKIE_NAME, token, 30 * 24 * 60 * 60);
  return {session: newSession, token};
}

export function readBuyerSession(req: Request): SessionPayload | null {
  const headerToken =
    typeof req.headers['x-buyer-token'] === 'string'
      ? req.headers['x-buyer-token'].trim()
      : undefined;
  const cookies = parseCookies(req);
  const session = verifySessionToken(headerToken || cookies[BUYER_COOKIE_NAME]);
  return session && session.role === 'buyer' ? session : null;
}

export function readAdminSession(req: Request): SessionPayload | null {
  const authHeader = req.headers.authorization;
  let bearerToken: string | undefined;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req);
  const cookieToken = cookies[ADMIN_COOKIE_NAME];
  const session = verifySessionToken(bearerToken || cookieToken);
  if (session && session.role === 'admin') {
    return session;
  }
  return null;
}

export function setAdminSessionCookie(req: Request, res: Response, email: string): string {
  const session: SessionPayload = {
    sub: `admin_${crypto.createHash('sha256').update(email).digest('hex').slice(0, 12)}`,
    role: 'admin',
    email,
    exp: Date.now() + 4 * 60 * 60 * 1000, // 4 hours
  };
  const token = signSessionToken(session);
  setAuthCookie(req, res, ADMIN_COOKIE_NAME, token, 4 * 60 * 60);
  return token;
}

export function clearAdminSessionCookie(req: Request, res: Response): void {
  clearAuthCookie(req, res, ADMIN_COOKIE_NAME);
}

export function requireAdminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const session = readAdminSession(req);
  if (!session) {
    res.status(401).json({
      error: 'Acesso negado: autenticação administrativa obrigatória (RBAC).',
    });
    return;
  }
  (req as Request & {adminSession?: SessionPayload}).adminSession = session;
  next();
}

// Sliding-window rate limiter for admin login brute-force protection
const loginAttempts = new Map<string, number[]>();

export function checkLoginRateLimit(ip: string): {allowed: boolean; retryAfterSec: number} {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 8;
  const recent = (loginAttempts.get(ip) || []).filter((ts) => now - ts < windowMs);
  if (recent.length >= maxAttempts) {
    const oldest = recent[0];
    const retryAfterSec = Math.ceil((windowMs - (now - oldest)) / 1000);
    loginAttempts.set(ip, recent);
    return {allowed: false, retryAfterSec};
  }
  return {allowed: true, retryAfterSec: 0};
}

export function recordFailedLoginAttempt(ip: string): void {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const recent = (loginAttempts.get(ip) || []).filter((ts) => now - ts < windowMs);
  recent.push(now);
  loginAttempts.set(ip, recent);
}

export function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

export function maskContact(contact: string): string {
  const trimmed = contact.trim();
  if (trimmed.includes('@')) {
    const [user, domain] = trimmed.split('@');
    return `${user.slice(0, 2)}***@${domain}`;
  }
  if (trimmed.length >= 6) {
    return `${trimmed.slice(0, 4)}***${trimmed.slice(-2)}`;
  }
  return '***';
}

export function maskBuyerDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] || 'Participante';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

export function isValidSlug(slug: unknown): slug is string {
  return (
    typeof slug === 'string' &&
    slug.length >= 3 &&
    slug.length <= 96 &&
    /^[a-z0-9-]+$/.test(slug)
  );
}
