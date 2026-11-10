import test from 'node:test';
import assert from 'node:assert/strict';
import {derive,generate,parsePairs,parsePuzzle,progressKey,sample,validate} from '../app/puzzle.ts';
const meta={id:'custom',title:'Friends',author:'Trevor'};
test('generator preserves every placed answer and clue without accidental runs',()=>{
 const pairs=parsePairs('SPOTIFY | Wrapped\nPLAYLIST | Mixtape\nRENT | Monthly\nLATTE | Espresso\nMEME | Comedy\nRAMEN | Dinner\nERA | Self-care\nAPP | Streak');
 const {puzzle,unplaced}=generate(pairs,meta);
 assert.deepEqual(unplaced,[]);assert.deepEqual(validate(puzzle),[]);
 assert.equal(derive(puzzle).entries.length,pairs.length);
 for(const pair of pairs)assert.ok(derive(puzzle).entries.some(e=>e.answer===pair.answer&&e.clue===pair.clue));
 assert.notEqual(puzzle.size,7);
});
test('unplaceable answers are explicitly reported',()=>{
 const result=generate(parsePairs('AAA | First\nBBB | Second'),meta);
 assert.equal(result.unplaced.length,1);assert.deepEqual(validate(result.puzzle),[]);
});
test('JSON roundtrip, malformed input, invalid drafts, and puzzle-specific progress',()=>{
 assert.deepEqual(parsePuzzle(JSON.parse(JSON.stringify(sample))),sample);
 assert.throws(()=>parsePuzzle({...sample,size:22}));assert.throws(()=>parsePuzzle({...sample,cells:['A']}));
 assert.throws(()=>parsePairs('ANSWER missing separator'));assert.throws(()=>parsePairs('AAA | One\nAAA | Two'));
 assert.ok(validate({...sample,title:'',cells:sample.cells.map(c=>c==='#'?'#':'')}).length);
 assert.ok(validate({...sample,clues:{}}).some(s=>s.includes('clues')));
 const custom={...sample,id:'custom'};
 assert.notEqual(progressKey(custom),progressKey(sample));
 assert.notEqual(progressKey({...custom,cells:custom.cells.map(c=>c==='A'?'B':c)}),progressKey(custom));
});
test('rebus cells are preserved and single-direction freeform cells have an entry',()=>{
 const p={...meta,version:1,size:3,cells:['#','#','#','HI','A','T','#','#','#'],clues:{'3Across':'Rebus greeting plus AT'}};
 assert.deepEqual(validate(p),[]);assert.equal(derive(p).entries[0].answer,'HIAT');assert.deepEqual(parsePuzzle(p),p);
});

import {sample12} from '../app/examples.ts';
test('12×12 example has complete, connected, unique and correctly clued answers',()=>{
 assert.equal(sample12.size,12);assert.equal(sample12.cells.length,144);
 assert.deepEqual(validate(sample12),[]);const entries=derive(sample12).entries;
 assert.equal(entries.length,20);assert.equal(new Set(entries.map(e=>e.answer)).size,20);
 assert.ok(entries.every(e=>e.clue.trim()&&e.cells.length>=3));
 assert.notEqual(progressKey(sample12),progressKey(sample));
});
