import type { Puzzle } from './puzzle';

/** Browser side of api/puzzles.ts and api/session.ts. */
export type SiteList = { rev: number; puzzles: Puzzle[] | null };
export type SiteError = Error & { status?: number; body?: SiteList };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Couldn’t reach the server. Try again.'), { status: response.status, body });
  return body as T;
}

export const loadSite = () => call<SiteList>('/api/puzzles');
export const saveSite = (rev: number, puzzles: Puzzle[]) => call<SiteList>('/api/puzzles', { method: 'PUT', body: JSON.stringify({ rev, puzzles }) });
export const checkEditor = () => call<{ editor: boolean }>('/api/session').then(s => s.editor, () => false);
export const logIn = (password: string) => call<{ editor: boolean }>('/api/session', { method: 'POST', body: JSON.stringify({ password }) });
export const logOut = () => call<{ editor: boolean }>('/api/session', { method: 'DELETE' });
