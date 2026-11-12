import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {progressKey,sample} from '../app/puzzle.ts';
const window=new Window({url:'http://localhost:3000',settings:{enableJavaScriptEvaluation:true}});
window.structuredClone=globalThis.structuredClone;
window.fetch=()=>Promise.reject(new Error('offline'));
// A saved puzzle whose 0.3-second animation plays once 10% of the squares (5 of 41) are filled.
const animation={version:1,name:'Flash',size:4,fps:10,trigger:10,background:'#ffffff',palette:{b:'#326da9'},frames:[['b...','....','....','....'],['bb..','bb..','....','....'],['bbbb','bbbb','bbbb','bbbb']]};
const puzzle={...sample,id:'animated',title:'Animated one',animation},saveKey=progressKey(puzzle);
const finale={...puzzle,id:'finale',title:'Finale',animation:{...animation,trigger:100}};
window.localStorage.setItem('after-hours-library',JSON.stringify([puzzle,finale]));
window.document.body.innerHTML='<div id="root"></div>';window.eval(readFileSync('dist/client.js','utf8'));
const wait=(ms=30)=>new Promise(r=>setTimeout(r,ms));await wait();
const doc=window.document,q=s=>doc.querySelector(s);
const button=t=>[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()===t);
const click=async el=>{assert.ok(el,'button exists');el.click();await wait()};
const key=async k=>{q('.grid').dispatchEvent(new window.KeyboardEvent('keydown',{key:k,bubbles:true}));await wait()};
const letters=()=>[...doc.querySelectorAll('.square .letter')].map(el=>el.textContent);
const stored=()=>JSON.parse(window.localStorage.getItem(saveKey));
const card=()=>[...doc.querySelectorAll('.puzzle-card')].find(c=>c.textContent.includes('Animated one'));

await click(button('My Puzzles'));assert.match(card().textContent,/ANIMATED/);await click(card().querySelector('.primary'));
for(const l of 'ABCD')await key(l);
assert.equal(q('.animation-stage'),null,'does not play before the trigger');
await key('E');
assert.ok(q('.grid-wrap .animation-stage canvas'),'plays inside the grid once 10% is filled');assert.ok(q('.animation-blocker'),'blocks clicks while playing');
assert.equal(stored().board.letters.filter(Boolean).length,5,'progress is saved before the animation plays');
const before=letters();
await key('Q');await key('Backspace');
assert.deepEqual(letters(),before,'typing is ignored while it plays');
await wait(450);
assert.equal(q('.animation-stage'),null,'the animation ends on its own');assert.equal(q('.animation-blocker'),null);
assert.deepEqual(letters(),before,'the board is exactly as the solver left it');
assert.deepEqual(stored().board.letters.filter(Boolean),['A','B','C','D','E']);assert.equal(stored().animated,true);
await key('F');assert.equal(letters().filter(Boolean).length,6,'solving continues');
await key('Backspace');await key('Backspace');await key('G');await key('H');
assert.equal(q('.animation-stage'),null,'plays only once, even when the trigger is crossed again');

const progress=stored().board.letters.filter(Boolean).length;

// At 100% the animation comes first, then the completion message.
await click(button('My Puzzles'));await click([...doc.querySelectorAll('.puzzle-card')].find(c=>c.textContent.includes('Finale')).querySelector('.primary'));
await click(button('Reveal ⌄'));await click(button('Reveal puzzle'));await click(button('Reveal answers'));
assert.ok(q('.animation-stage'));assert.equal(q('.modal'),null,'the completion message waits for the animation');
await wait(450);assert.equal(q('.animation-stage'),null);assert.match(q('.modal').textContent,/That’s a wrap/);
assert.equal(doc.querySelectorAll('.revealed').length,41);await click(button('Back to the puzzle'));

// The studio: draw, add a frame, and save it with the puzzle without touching the solve.
await click(button('Animation Studio'));
assert.equal(doc.querySelectorAll('.pixel-pad > div').length,256,'starts with a blank 16 × 16 canvas');
const setValue=async(el,value)=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));await wait()};
await setValue(q('[aria-label="Hex color"]'),'#ff8800');
const paint=async i=>{doc.querySelectorAll('.pixel-pad > div')[i].dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true}));window.dispatchEvent(new window.Event('pointerup'));await wait()};
await paint(17);
let draft=JSON.parse(window.localStorage.getItem('after-hours-animation-draft'));
assert.deepEqual(draft.palette,{0:'#ff8800'});assert.equal(draft.frames[0][1],'.0..............');
await click(button('◻ Erase'));await paint(17);await click(button('↶ Undo'));
await click(button('+ New frame'));await click(button('▧ Fill'));await paint(0);
await setValue(q('[aria-label="Canvas size"]'),'8');await click(button('New blank canvas'));await click(button('Cancel'));
draft=JSON.parse(window.localStorage.getItem('after-hours-animation-draft'));
assert.equal(draft.frames.length,2);assert.equal(draft.frames[0][1],'.0..............');assert.ok(draft.frames[1].every(row=>row==='0'.repeat(16)));
assert.equal(doc.querySelectorAll('.frame').length,2);
await click(button('▶ Preview'));assert.ok(q('.pixel-wrap .animation-stage'));await click(button('■ Stop'));assert.equal(q('.pixel-wrap .animation-stage'),null);
await click(button('Save with puzzle →'));
const saved=JSON.parse(window.localStorage.getItem('after-hours-library')).find(p=>p.id==='animated');
assert.ok(saved,'saved with the selected puzzle');assert.equal(saved.animation.size,16);assert.equal(saved.animation.frames.length,2);assert.deepEqual(saved.cells,sample.cells);
assert.equal(stored().board.letters.filter(Boolean).length,progress,'saving an animation keeps solving progress');
console.log('PASS: animation plays once at the trigger, blocks input, restores and keeps progress; studio draws, fills, undoes, adds frames, previews, and saves with the puzzle.');
await window.happyDOM.abort();window.close();
