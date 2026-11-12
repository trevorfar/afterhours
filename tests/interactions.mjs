import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const window=new Window({url:'http://localhost:3000',settings:{enableJavaScriptEvaluation:true}});
window.fetch=()=>Promise.reject(new Error('offline'))
window.document.body.innerHTML='<div id="root"></div>';
window.eval(readFileSync('dist/client.js','utf8'));
const wait=()=>new Promise(r=>setTimeout(r,25));await wait();
const doc=window.document;
const q=s=>doc.querySelector(s);
const click=async el=>{assert.ok(el);el.click();await wait()};
const key=async(k,extra={})=>{q('.grid').dispatchEvent(new window.KeyboardEvent('keydown',{key:k,bubbles:true,...extra}));await wait()};
const textButton=t=>[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()===t);
const selected=()=>[...doc.querySelectorAll('.square')].indexOf(q('.selected'));
// With no server the bundled site puzzles load, Crossword #1 first; open the 7×7 sample from the list.
assert.match(q('.puzzle-label').textContent,/Crossword #1/)
await click(textButton('My Puzzles'))
await click([...doc.querySelectorAll('.puzzle-card')].find(card=>card.textContent.includes('Twenty-something')).querySelector('.primary'))
assert.equal(doc.querySelectorAll('.square').length,41);
await key('a');assert.equal(q('.square .letter').textContent,'A');
await key('Tab');assert.match(q('.clue-banner').textContent,/self-care/);
await key('Tab',{shiftKey:true});assert.match(q('.clue-banner').textContent,/dating/);
await key(' ');assert.match(q('.clue-banner').textContent,/Carpenter/);
await key('Home');await key('z');await key('z',{ctrlKey:true});assert.equal(doc.querySelectorAll('.square')[1].querySelector('.letter').textContent,'');
await key('z',{ctrlKey:true,shiftKey:true});assert.equal(doc.querySelectorAll('.square')[1].querySelector('.letter').textContent,'Z');
await click(textButton('Check'));assert.equal(doc.querySelectorAll('.wrong').length,1);const wrongCell=[...doc.querySelectorAll('.square')].indexOf(q('.wrong'));
await key('Home');await key('Delete');assert.equal(q('.selected .letter').textContent,'');assert.equal(textButton('Check').getAttribute('aria-pressed'),'true');assert.equal(doc.querySelectorAll('.wrong').length,0);await key('Home');await key('z');assert.ok(doc.querySelectorAll('.square')[wrongCell].classList.contains('wrong'));await key('Home');await key('Delete');assert.equal(doc.querySelectorAll('.wrong').length,0);
await key('+');await key('p');assert.ok(doc.querySelectorAll('.penciled').length);
await key('Insert');assert.ok(q('.rebus-input'));const input=q('.rebus-input');const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(input,'HI');input.dispatchEvent(new window.Event('input',{bubbles:true}));await wait();await click(q('.close'));
await click(q('[aria-label="Pause puzzle"]'));assert.ok(q('.pause-overlay'));await click(textButton('Resume puzzle →'));assert.equal(q('.pause-overlay'),null);
const saved=JSON.parse(window.localStorage.getItem('after-hours-v1'));assert.ok(saved.board.letters.some(Boolean));
await click(textButton('Reveal ⌄'));await click(textButton('Reveal puzzle'));await click(textButton('Reveal answers'));assert.match(q('.modal').textContent,/That’s a wrap/);assert.equal(doc.querySelectorAll('.revealed').length,41);
await click(textButton('Back to the puzzle'));await click(q('[aria-label="Puzzle settings"]'));await click(textButton('Reset this puzzle'));await click(textButton('Reset puzzle'));assert.ok([...doc.querySelectorAll('.letter')].every(el=>!el.textContent));
await click(q('.clue'));await key('Tab');const second=q('.clue-banner').textContent;for(const _ of q('.grid').querySelectorAll('.square.word'))await key('x');await click(q('.clue'));await key('Tab');assert.notEqual(q('.clue-banner').textContent,second);for(let i=0;i<41;i++)await key('z');assert.match(q('.toast').textContent,/Every square is filled/);assert.match(q('.board-footer').textContent,/Not quite/);
console.log('PASS: typing, next/previous clue, direction, undo/redo, checks, erasing, pencil, rebus dialog, pause/resume, saved progress, reveal/completion, reset, Tab skips filled clues, full-grid feedback.');
await window.happyDOM.abort();window.close();
