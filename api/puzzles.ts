import { parsePuzzle, validate, type Puzzle } from '../app/puzzle.js';
import { isEditor, json } from '../server/auth.js';
import { getStore } from '../server/store.js';

const MAX_PUZZLES = 100;

/** The site's published puzzles, in display order. `puzzles` is null until an editor first saves. */
export async function GET() {
  return json(await getStore().read());
}

/** Replace the whole ordered list (`{rev, puzzles}`); editor only. Covers publish, edit, remove and reorder. */
export async function PUT(request: Request) {
  if (!isEditor(request)) return json({ error: 'Your editor session ended. Log in again to change the site.' }, 401);
  const body = (await request.json().catch(() => null)) as { rev?: unknown; puzzles?: unknown } | null;
  if (!body || !Number.isInteger(body.rev) || !Array.isArray(body.puzzles)) return json({ error: 'Send {rev, puzzles}.' }, 400);
  if (body.puzzles.length > MAX_PUZZLES) return json({ error: `The site holds up to ${MAX_PUZZLES} puzzles.` }, 400);
  let puzzles: Puzzle[];
  try {
    puzzles = body.puzzles.map(value => {
      const puzzle = parsePuzzle(value), issues = validate(puzzle);
      if (issues.length) throw new Error(`“${puzzle.title || 'Untitled'}” isn’t finished yet. ${issues[0]}`);
      return puzzle;
    });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
  if (new Set(puzzles.map(p => p.id)).size !== puzzles.length) return json({ error: 'Two puzzles share the same id.' }, 400);
  const store = getStore(), saved = await store.write(body.rev as number, puzzles);
  if (!saved) return json({ error: 'The site was changed somewhere else, so the latest list was loaded. Make your change again.', ...(await store.read()) }, 409);
  return json(saved);
}
