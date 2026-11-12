import {build} from 'esbuild';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['client.tsx'],bundle:true,outdir:'dist',minify:true,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},target:'es2022'});
await writeFile('dist/index.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#fafbf7"><meta name="description" content="An original crossword for your early twenties. A little less scrolling, a little more solving."><title>After Hours — The Crossword</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/client.css"></head><body><div id="root"></div><script type="module" src="/client.js"></script></body></html>');
await copyFile('public/favicon.svg','dist/favicon.svg');
// Local copies of the Vercel Functions in api/, for serve.mjs and the API tests. Vercel builds api/ itself.
await build({entryPoints:['api/puzzles.ts','api/session.ts'],bundle:true,outdir:'.server/api',outExtension:{'.js':'.mjs'},platform:'node',format:'esm',packages:'external',target:'node22'});
console.log('Built After Hours to dist/');
