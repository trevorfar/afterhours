import { clearedCookie, editorConfigured, isEditor, json, passwordMatches, sessionCookie } from '../server/auth.js';
import { getStore } from '../server/store.js';

const ATTEMPTS = 10, WINDOW_SECONDS = 15 * 60;

/** Whether this browser is in editor mode. */
export function GET(request: Request) {
  return json({ editor: isEditor(request) });
}

/** Log in with `{password}`. */
export async function POST(request: Request) {
  if (!editorConfigured()) return json({ error: 'Editor mode isn’t set up on this server.' }, 503);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  if ((await getStore().hit(`login:${ip}`, WINDOW_SECONDS)) > ATTEMPTS) return json({ error: 'Too many tries. Wait 15 minutes and try again.' }, 429);
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  if (!passwordMatches(body?.password)) return json({ error: 'That’s not it. Try again.' }, 401);
  return json({ editor: true }, 200, { 'Set-Cookie': sessionCookie() });
}

/** Leave editor mode. */
export function DELETE() {
  return json({ editor: false }, 200, { 'Set-Cookie': clearedCookie });
}
