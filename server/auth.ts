import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Editor mode: a case-insensitive password (EDITOR_PASSWORD) exchanged for a signed, HttpOnly cookie.
 * The cookie is `<expiry>.<HMAC(expiry)>` keyed by EDITOR_SECRET, so no server-side session store is needed.
 */
const COOKIE = 'ah_editor', MAX_AGE = 60 * 60 * 24 * 30;

export const editorConfigured = () => Boolean(process.env.EDITOR_PASSWORD && process.env.EDITOR_SECRET);

const mac = (value: string) => createHmac('sha256', process.env.EDITOR_SECRET!).update(value).digest();

export function passwordMatches(input: unknown) {
  if (typeof input !== 'string' || !editorConfigured()) return false;
  const normalize = (s: string) => mac(`password:${s.trim().toLowerCase()}`);
  return timingSafeEqual(normalize(input), normalize(process.env.EDITOR_PASSWORD!));
}

export function sessionCookie() {
  const expires = String(Date.now() + MAX_AGE * 1000);
  return `${COOKIE}=${expires}.${mac(expires).toString('base64url')}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}

export const clearedCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

export function isEditor(request: Request) {
  if (!editorConfigured()) return false;
  const raw = request.headers.get('cookie')?.split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const [expires, signature] = raw?.split('.') ?? [];
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const given = Buffer.from(signature, 'base64url'), expected = mac(expires);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
