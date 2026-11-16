import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

// Local esbuild bundles hide broken imports between separately emitted server files.
test('separately compiled puzzle API loads and publishes a puzzle', async () => {
  const root = await mkdtemp(join(process.cwd(), '.test-server-'));
  const keys = ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'AFTERHOURS_DATA_DIR', 'EDITOR_PASSWORD', 'EDITOR_SECRET'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    delete process.env.KV_REST_API_URL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    process.env.AFTERHOURS_DATA_DIR = join(root, 'data');
    process.env.EDITOR_PASSWORD = 'test-password';
    process.env.EDITOR_SECRET = 'test-secret';
    const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
    const {options} = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, '.');
    for (const file of ['api/puzzles.ts', 'api/animations.ts', 'server/auth.ts', 'server/store.ts', 'app/puzzle.ts', 'app/animation.ts']) {
      const output = ts.transpileModule(await readFile(file, 'utf8'), {compilerOptions: options, fileName: file});
      const target = join(root, file.replace(/\.ts$/, '.js'));
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, output.outputText);
    }
    const api = await import(pathToFileURL(join(root, 'api/puzzles.js')));
    const {sessionCookie} = await import(pathToFileURL(join(root, 'server/auth.js')));
    const {sample} = await import(pathToFileURL(join(root, 'app/puzzle.js')));
    assert.deepEqual(await (await api.GET()).json(), {rev: 0, puzzles: null});
    const response = await api.PUT(new Request('https://example.test/api/puzzles', {
      method: 'PUT', headers: {'content-type': 'application/json', cookie: sessionCookie().split(';')[0]},
      body: JSON.stringify({rev: 0, puzzles: [sample]}),
    }));
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.rev, 1);
    assert.equal(saved.puzzles[0].id, sample.id);
    assert.deepEqual(await (await api.GET()).json(), saved);
    const animations = await import(pathToFileURL(join(root, 'api/animations.js')));
    assert.equal((await animations.GET(new Request(`https://example.test/api/animations?id=${'0'.repeat(32)}`))).status, 404);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(root, {recursive: true, force: true});
  }
});
