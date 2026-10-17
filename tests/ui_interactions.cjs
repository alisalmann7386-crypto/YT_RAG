// DOM integration tests; no browser or running API server required.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const html=readFileSync('app/static/index.html','utf8');
const script=readFileSync('app/static/app.js','utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const library=[
 {id:'abcdefghijk',video_id:'abcdefghijk',title:'DP 1. Memoization and Tabulation',playlist_position:1,lecture_label:'DP 1',kind:'lecture',indexed:true,duration:600,chunks:10},
 {id:'zzzzzzzzzzz',video_id:'zzzzzzzzzzz',title:'Ceil in BST',playlist_position:2,kind:'catalog',indexed:false,duration:300,chunks:0}
];
function result(title='Memoization',locationId='zzzzzzzzzzz') {
 return {answer:'Memoization caches computed states. [1]',mode:'evidence',sources:[{number:1,kind:'lecture',video_id:'abcdefghijk',title,playlist_position:1,lecture_label:'DP 1',matched_start:120,seek_seconds:116,start:100,end:170,text:'Memoization caches computed states.',summary:'Memoization caches computed states.',source:'captions',summary_type:'extractive',timestamp_basis:'subtitle segment'}],locations:locationId?[{video_id:locationId,title:'Related '+title,playlist_position:2}]:[]};
}
async function setup(options={}) {
 const {window,document}=parseHTML(html); const requests=[]; const timers=new Set();
 // linkedom omits layout and selected-option mutation, which are browser APIs.
 for(const s of document.querySelectorAll('select'))Object.defineProperty(s,'value',{value:s.querySelector('option').getAttribute('value')||s.querySelector('option').textContent,writable:true});
 window.HTMLElement.prototype.scrollIntoView=function(){};
 window.HTMLElement.prototype.scrollTo=function(){};
 for(const d of document.querySelectorAll('dialog')){d.showModal=function(){this.open=true;this.setAttribute('open','');};d.close=function(){this.open=false;this.removeAttribute('open');};}
 window.innerWidth=1280;
 const memory=options.memory || new Map(Object.entries(options.stored || {})),clipboard=[],downloads=[];
 window.confirm=()=>options.confirm!==false;
 class TestURL extends URL {}
 TestURL.createObjectURL=blob=>{downloads.push(blob);return 'blob:test-download';};TestURL.revokeObjectURL=()=>{};
 for(const name of ['localStorage','sessionStorage']){
  const store={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  Object.defineProperty(window,name,{configurable:true,get(){if(options.blockedStorage)throw new Error('Storage denied');return store;}});
 }
 const context=vm.createContext({window,document,console,AbortController,Blob,URL:TestURL,navigator:{clipboard:{writeText:async text=>{clipboard.push(text);}}},setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();timers.add(t);return t;},clearTimeout,
  fetch:async(path,init)=>{requests.push({path,init});if(path==='/api/stats')return{ok:true,json:async()=>({lectures:1,catalog_lectures:2,unindexed_lectures:1,coverage_percent:50,chunks:10,notes:0,backend:'bm25',llm_provider:'none',corpus:'lecture transcripts'})};if(path==='/api/videos')return{ok:true,json:async()=>({items:options.library || library})};return options.ask?options.ask(path,init):{ok:true,json:async()=>result()};}
 });
 vm.runInContext(script,context); await flush();await flush();
 return {window,document,requests,memory,clipboard,downloads,run:code=>vm.runInContext(code,context),dispose:()=>timers.forEach(clearTimeout)};
}
test('bootstrap, search, bookmarks and coverage details',async t=>{
 const a=await setup();t.after(a.dispose);const $=id=>a.document.getElementById(id);
 assert.equal($('coverage-value').textContent,'50%');assert.equal($('library').querySelectorAll('.library-row').length,2);
 $('library').querySelector('.save-lecture').click();$('tab-saved').click();assert.equal($('library').querySelectorAll('.library-row').length,1);assert.equal($('saved-count').textContent,'1');
 $('tab-all').click();$('library-search').value='ceil';$('library-search').dispatchEvent(new a.window.Event('input'));assert.equal($('library').querySelectorAll('.library-row').length,1);
 $('coverage-details').click();assert.ok($('coverage-dialog').open);assert.equal($('coverage-missing').querySelectorAll('a').length,1);
});
test('selection scopes retrieval and pending captions have no invented timestamp',async t=>{
 const a=await setup();t.after(a.dispose);const $=id=>a.document.getElementById(id);
 $('library').querySelectorAll('.library-item')[1].click();
 assert.match($('selected-lecture').textContent,/captions are pending/);assert.equal($('player').getAttribute('src'),null);
 $('question').value='ceil in BST';await a.run('askQuestion()');
 const body=JSON.parse(a.requests.find(x=>x.path==='/api/ask').init.body);assert.equal(body.video_id,'zzzzzzzzzzz');
 $('clear-filter').click();assert.equal(a.run('state.filter'),null);
});
test('old citations restore their own sources and related lectures',async t=>{
 let n=0;const a=await setup({ask:async()=>({ok:true,json:async()=>result('Answer '+(++n),n===1?'zzzzzzzzzzz':null)})});t.after(a.dispose);const $=id=>a.document.getElementById(id);
 $('question').value='memoization';await a.run('askQuestion()');$('question').value='tabulation';await a.run('askQuestion()');assert.equal($('related-count').textContent,'0');
 a.document.querySelector('.cite').click();assert.equal($('related-count').textContent,'1');assert.match($('evidence-list').textContent,/Answer 1/);assert.match($('player').src,/start=116/);
 $('close-player').click();assert.equal($('player').getAttribute('src'),null);
});
test('stop cancels the request and unlocks the composer',async t=>{
 const a=await setup({ask:(_path,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));})});t.after(a.dispose);const $=id=>a.document.getElementById(id);
 $('question').value='memoization';const task=a.run('askQuestion()');assert.equal($('stop').hidden,false);$('stop').click();await task;
 assert.equal($('send').disabled,false);assert.equal($('stop').hidden,true);assert.match($('messages').textContent,/Response stopped/);assert.equal($('messages').querySelectorAll('.loading').length,0);
});
test('unavailable storage does not prevent startup or session bookmarks',async t=>{
 const a=await setup({blockedStorage:true});t.after(a.dispose);const $=id=>a.document.getElementById(id);
 assert.equal($('stat-indexed').textContent,'1');$('library').querySelector('.save-lecture').click();assert.equal($('saved-count').textContent,'1');assert.match($('toast').textContent,/Browser storage is unavailable/);
});
test('source and model text cannot inject HTML',async t=>{
 const payload=result('<img src=x onerror=alert(1)>');payload.answer='**<script>alert(1)</script>** [1]';
 const a=await setup({ask:async()=>({ok:true,json:async()=>payload})});t.after(a.dispose);a.document.getElementById('question').value='memoization';await a.run('askQuestion()');
 assert.equal(a.document.querySelector('#messages script'),null);assert.equal(a.document.querySelector('#evidence-list img'),null);assert.match(a.document.getElementById('evidence-list').textContent,/<img/);
 assert.equal(a.document.querySelector('#messages strong').textContent,'<script>alert(1)</script>');
});
test('lecture search results emphasize the lecture, title and timestamp',async t=>{
 const payload=result('Binary Search');payload.answer='Playlist #37 · BS 2 · 7:45 — Binary Search\nSearch a sorted array. [1]';
 const a=await setup({ask:async()=>({ok:true,json:async()=>payload})});t.after(a.dispose);a.document.getElementById('question').value='where is binary search taught';await a.run('askQuestion()');
 const body=a.document.querySelector('.message.assistant .message-body');
 assert.equal(body.querySelector('strong.result-heading').textContent,'Playlist #37 · BS 2 · 7:45 — Binary Search');
 assert.equal(body.querySelector('.lecture-reference').textContent,'Playlist #37');
 assert.equal(body.querySelector('.timestamp-reference').textContent,'7:45');
 assert.match(body.textContent,/Search a sorted array/);assert.equal(body.querySelectorAll('.cite').length,1);
});
test('generated emphasis keeps citations clickable and inline code literal',async t=>{
 const payload=result();payload.mode='generated';payload.answer='**Binary search [1]** is in Lecture number 37 at 07:45. Complexity: **O(n * target)**. Use `dp[1]` and `**Lecture 37**`.';
 const a=await setup({ask:async()=>({ok:true,json:async()=>payload})});t.after(a.dispose);const $=id=>a.document.getElementById(id);$('question').value='binary search';await a.run('askQuestion()');
 const body=a.document.querySelector('.message.assistant .message-body');
 assert.match(body.querySelector('strong').textContent,/Binary search/);
 assert.equal(body.querySelector('.lecture-reference').textContent,'Lecture number 37');
 assert.equal(body.querySelector('.timestamp-reference').textContent,'07:45');
 assert.ok([...body.querySelectorAll('strong')].some(s=>s.textContent==='O(n * target)'));
 assert.equal(body.querySelectorAll('.cite').length,1);assert.deepEqual([...body.querySelectorAll('code')].map(c=>c.textContent),['dp[1]','**Lecture 37**']);
 body.querySelector('.cite').click();assert.match($('player').src,/start=116/);
});
test('code blocks preserve numbers and formatting characters without citations',async t=>{
 const payload=result();payload.answer='```python\n# Lecture 37 at 7:45\ndp[1] = "**memoization**"\n```';
 const a=await setup({ask:async()=>({ok:true,json:async()=>payload})});t.after(a.dispose);a.document.getElementById('question').value='code';await a.run('askQuestion()');
 const body=a.document.querySelector('.message.assistant .message-body');
 assert.equal(body.querySelectorAll('strong,.cite').length,0);assert.equal(body.querySelector('pre code').textContent,'# Lecture 37 at 7:45\ndp[1] = "**memoization**"\n');
});
test('keyboard focus preserves chat; explicit new conversation clears it',async t=>{
 const a=await setup();t.after(a.dispose);const $=id=>a.document.getElementById(id);$('question').value='memoization';await a.run('askQuestion()');
 function key(shiftKey){const e=new a.window.Event('keydown',{bubbles:true,cancelable:true});Object.assign(e,{key:'k',ctrlKey:true,shiftKey});$('question').dispatchEvent(e);}
 key(false);assert.equal(a.run('state.history.length'),2);key(true);assert.equal(a.run('state.history.length'),0);assert.equal($('welcome').hidden,false);assert.equal($('messages').childElementCount,0);
});
test('playlist numbers and series labels search precisely',async t=>{
 const extra=[
  {id:'11111111111',video_id:'11111111111',title:'4 Sum',playlist_position:37,lecture_label:null,kind:'lecture',indexed:true,duration:100},
  {id:'22222222222',video_id:'22222222222',title:'Graph DFS',playlist_position:137,lecture_label:'G 12',kind:'lecture',indexed:true,duration:100},
  {id:'33333333333',video_id:'33333333333',title:'Partition Equal Subset Sum',playlist_position:196,lecture_label:'DP 15',kind:'lecture',indexed:true,duration:100}
 ];
 const a=await setup({library:[...library,...extra]});t.after(a.dispose);const input=a.document.getElementById('library-search');
 for(const [query,title] of [['37','4 Sum'],['Lecture 37','4 Sum'],['#37','4 Sum'],['video number 37','4 Sum'],['DP 15','Partition Equal Subset Sum']]){
  input.value=query;input.dispatchEvent(new a.window.Event('input'));const rows=a.document.querySelectorAll('.library-item');assert.equal(rows.length,1,query);assert.match(rows[0].textContent,new RegExp(title));
 }
});
test('history is opt-in and restores answers, controls, topic and citations',async t=>{
 const a=await setup();t.after(a.dispose);const $=id=>a.document.getElementById(id);
 $('mode').value='code';$('mode').dispatchEvent(new a.window.Event('change'));$('code-language').value='C++';$('language').value='Hindi';
 $('question').value='Explain memoization';await a.run('askQuestion()');assert.equal(a.memory.has('a2z-conversations'),false);
 $('remember-history').checked=true;$('remember-history').dispatchEvent(new a.window.Event('change'));
 assert.equal(JSON.parse(a.memory.get('a2z-conversations')).length,1);
 const b=await setup({memory:a.memory});t.after(b.dispose);const doc=b.document;
 assert.equal(b.run('state.history.length'),2);assert.equal(b.run('state.contextQuestion'),'Explain memoization');
 assert.equal(doc.getElementById('mode').value,'code');assert.equal(doc.getElementById('code-language').value,'C++');assert.equal(doc.getElementById('language').value,'Hindi');assert.equal(doc.getElementById('code-label').hidden,false);
 doc.querySelector('.cite').click();assert.match(doc.getElementById('player').src,/start=116/);
 doc.getElementById('question').value='What about its space complexity?';await b.run('askQuestion()');
 const payload=JSON.parse(b.requests.filter(r=>r.path==='/api/ask').at(-1).init.body);assert.equal(payload.context_question,'Explain memoization');
 doc.getElementById('open-history').click();assert.ok(doc.getElementById('history-dialog').open);assert.equal(doc.querySelectorAll('.history-entry').length,1);
});
test('saved conversations remain independently selectable',async t=>{
 let n=0;const a=await setup({stored:{'a2z-history-enabled':'true'},ask:async()=>({ok:true,json:async()=>result('Answer '+(++n))})});t.after(a.dispose);const $=id=>a.document.getElementById(id);
 $('question').value='First topic';await a.run('askQuestion()');$('new-chat').click();$('question').value='Second topic';await a.run('askQuestion()');
 $('open-history').click();const entries=a.document.querySelectorAll('.history-entry');assert.equal(entries.length,2);entries[1].click();
 assert.equal(a.run('state.history[0].content'),'First topic');a.document.querySelector('.cite').click();assert.match($('evidence-list').textContent,/Answer 1/);
});
test('revision progress and continue studying survive reload',async t=>{
 const a=await setup();t.after(a.dispose);const $=id=>a.document.getElementById(id);
 $('library').querySelector('.library-item').click();$('selected-lecture').querySelector('[data-progress-status=completed]').click();
 $('library-view').value='completed';$('library-view').dispatchEvent(new a.window.Event('change'));assert.equal($('library').querySelectorAll('.library-item').length,1);
 $('selected-lecture').querySelector('[data-progress-status=revise]').click();assert.equal($('library').querySelectorAll('.library-item').length,0);
 $('library-view').value='revise';$('library-view').dispatchEvent(new a.window.Event('change'));assert.equal($('library').querySelectorAll('.library-item').length,1);
 const b=await setup({memory:a.memory});t.after(b.dispose);assert.equal(b.document.getElementById('continue-study').hidden,false);b.document.getElementById('continue-button').click();
 assert.equal(b.run('state.filter'),'abcdefghijk');assert.equal(b.document.querySelector('[data-progress-status=revise]').getAttribute('aria-pressed'),'true');
});
test('direct watch links are deduplicated and title-only matches have no timestamp',async t=>{
 const payload=result();payload.sources.push({...payload.sources[0],number:2,seek_seconds:140});
 const a=await setup({ask:async()=>({ok:true,json:async()=>payload})});t.after(a.dispose);a.document.getElementById('question').value='memoization';await a.run('askQuestion()');
 const links=a.document.querySelectorAll('.answer-watch-link');assert.equal(links.length,1);assert.equal(links[0].href,'https://www.youtube.com/watch?v=abcdefghijk&t=116s');assert.match(links[0].textContent,/Watch from 1:56/);
 const b=await setup({ask:async()=>({ok:true,json:async()=>({answer:'Playlist #2 — Ceil in BST',mode:'catalog',sources:[],locations:[{video_id:'zzzzzzzzzzz',title:'Ceil in BST',playlist_position:2}]})})});t.after(b.dispose);b.document.getElementById('question').value='ceil';await b.run('askQuestion()');
 assert.equal(b.document.querySelector('.answer-watch-link').href,'https://www.youtube.com/watch?v=zzzzzzzzzzz');assert.match(b.document.querySelector('.answer-watch-link').textContent,/Open lecture/);
});
test('every study mode and language is sent with the selected code language',async t=>{
 const a=await setup();t.after(a.dispose);const $=id=>a.document.getElementById(id);
 for(const mode of ['explain','locate','summary','hint','compare','complexity','code']) {
  $('mode').value=mode;$('mode').dispatchEvent(new a.window.Event('change'));assert.equal($('code-label').hidden,mode!=='code');assert.ok($('mode-help').textContent);
  for(const language of ['English','Hindi','Hinglish']){
   $('language').value=language;$('code-language').value='Java';$('question').value='binary search';await a.run('askQuestion()');
   const payload=JSON.parse(a.requests.filter(r=>r.path==='/api/ask').at(-1).init.body);assert.equal(payload.mode,mode);assert.equal(payload.language,language);assert.equal(payload.code_language,'Java');assert.ok(payload.history.length<=6);
  }
 }
});
test('comparison tables, code copy and conversation export work without interpreting HTML',async t=>{
 const payload=result();payload.answer='| Approach | Cost |\n| --- | --- |\n| **Binary search** | `O(log n)` |\n| <img src=x> | Constant space |\n\n```python\nvalues[1] = 2\n```\n\n[1]';
 const a=await setup({ask:async()=>({ok:true,json:async()=>payload})});t.after(a.dispose);a.document.getElementById('question').value='compare';await a.run('askQuestion()');
 assert.equal(a.document.querySelectorAll('.answer-table th').length,2);assert.equal(a.document.querySelector('.answer-table img'),null);
 a.document.querySelector('.copy-code').click();await flush();assert.equal(a.clipboard.at(-1),'values[1] = 2\n');
 a.document.getElementById('download-chat').click();assert.equal(a.downloads.length,1);const exported=await a.downloads[0].text();assert.match(exported,/Sources:/);assert.match(exported,/https:\/\/www.youtube.com\/watch/);
});
test('invalid saved state does not break startup',async t=>{
 const a=await setup({stored:{'a2z-history-enabled':'true','a2z-conversations':'{"invalid":true}','a2z-progress':'[]','a2z-last-lecture':'{"id":"<script>"}'}});t.after(a.dispose);
 assert.equal(a.document.getElementById('stat-indexed').textContent,'1');assert.equal(a.run('state.history.length'),0);assert.equal(a.document.getElementById('continue-study').hidden,true);
});
test('cleared history is not resurrected by new chat or a late response',async t=>{
 let finish;const a=await setup({stored:{'a2z-history-enabled':'true'},ask:()=>new Promise(resolve=>finish=()=>resolve({ok:true,json:async()=>result()}))});t.after(a.dispose);const $=id=>a.document.getElementById(id);
 $('question').value='memoization';const pending=a.run('askQuestion()');assert.equal(a.run('state.sessions.length'),1);
 $('clear-history').click();finish();await pending;assert.equal(a.memory.has('a2z-conversations'),false);
 $('new-chat').click();assert.equal(a.run('state.sessions.length'),0);assert.equal(a.memory.has('a2z-conversations'),false);
 $('question').value='tabulation';const next=a.run('askQuestion()');finish();await next;assert.equal(JSON.parse(a.memory.get('a2z-conversations')).length,1);
});
test('malformed saved control values and timestamps fall back safely',async t=>{
 const session={id:'test',title:'Saved topic',updated:1,turns:[{role:'user',content:'binary search'}],mode:'invalid',language:'invalid',codeLanguage:'invalid'};
 const a=await setup({stored:{'a2z-history-enabled':'true','a2z-conversations':JSON.stringify([session]),'a2z-last-lecture':JSON.stringify({id:'abcdefghijk',seconds:'broken'})}});t.after(a.dispose);
 const $=id=>a.document.getElementById(id);assert.equal($('mode').value,'explain');assert.equal($('language').value,'English');assert.equal($('code-language').value,'Python');assert.doesNotMatch($('continue-progress').textContent,/NaN/);
});
test('continue studying restores the last opened playback timestamp',async t=>{
 const a=await setup();t.after(a.dispose);const $=id=>a.document.getElementById(id);
 $('question').value='memoization';await a.run('askQuestion()');a.document.querySelector('.cite').click();
 const b=await setup({memory:a.memory});t.after(b.dispose);b.document.getElementById('continue-button').click();
 assert.match(b.document.getElementById('player').src,/start=116/);assert.equal(b.run('state.lastLecture.seconds'),116);
});
test('revision notes have detail controls, independent copy/download and restorable formatting',async t=>{
 const payload=result('Binary Search');Object.assign(payload,{requested_mode:'summary',revision_detail:'quick',mode:'generated',summary_type:'revision_notes',context_question:'binary search',answer:'### Core idea\n\nHalve the sorted search interval. [1]\n\n### Steps\n1. Compare the middle.\n2. Update the boundary. [1]'});
 const a=await setup({stored:{'a2z-history-enabled':'true'},ask:async()=>({ok:true,json:async()=>payload})});t.after(a.dispose);const $=id=>a.document.getElementById(id);
 $('mode').value='summary';$('mode').dispatchEvent(new a.window.Event('change'));$('revision-detail').value='quick';assert.equal($('revision-label').hidden,false);
 $('question').value='binary search';await a.run('askQuestion()');const body=JSON.parse(a.requests.find(r=>r.path==='/api/ask').init.body);assert.equal(body.revision_detail,'quick');
 assert.equal(a.document.querySelectorAll('.revision-message h3').length,2);assert.equal(a.document.querySelectorAll('.revision-message li').length,2);
 const copy=[...a.document.querySelectorAll('.message-meta button')].find(b=>b.textContent==='Copy notes');copy.click();await flush();assert.match(a.clipboard.at(-1),/Lecture references/);assert.match(a.clipboard.at(-1),/https:\/\/www.youtube.com\/watch/);
 a.document.querySelector('.download-notes').click();assert.equal(a.downloads.length,1);assert.match(await a.downloads[0].text(),/Core idea/);
 const b=await setup({memory:a.memory});t.after(b.dispose);assert.equal(b.document.getElementById('revision-detail').value,'quick');assert.equal(b.document.querySelectorAll('.revision-message h3').length,2);assert.equal(b.document.querySelector('.revision-badge').textContent,'CONCISE REVISION NOTES');
});
test('study actions on an older answer retain that answer topic and lecture',async t=>{
 let n=0;const a=await setup({ask:async()=>{const p=result(++n===1?'Binary Search':'Memoization');p.context_question=n===1?'binary search':'memoization';return{ok:true,json:async()=>p};}});t.after(a.dispose);const $=id=>a.document.getElementById(id);
 $('question').value='binary search';await a.run('askQuestion()');$('question').value='memoization';await a.run('askQuestion()');
 a.document.querySelector('.study-action').click();await flush();await flush();const body=JSON.parse(a.requests.filter(r=>r.path==='/api/ask').at(-1).init.body);
 assert.equal(body.mode,'summary');assert.equal(body.context_question,'binary search');assert.equal(body.video_id,'abcdefghijk');
});
test('S avatar opens an editable profile and shows real local progress',async t=>{
 const a=await setup();t.after(a.dispose);const $=id=>a.document.getElementById(id);
 $('open-profile').click();assert.ok($('profile-dialog').open);$('learner-name').value='Salman Ali';$('learner-goal').value='Revise DP this week';$('profile-form').dispatchEvent(new a.window.Event('submit',{cancelable:true}));assert.equal($('profile-dialog').open,false);assert.equal($('profile-avatar').textContent,'SA');
 $('library').querySelector('.save-lecture').click();$('library').querySelector('.library-item').click();$('selected-lecture').querySelector('[data-progress-status=completed]').click();$('open-profile').click();
 assert.equal($('profile-completed').textContent,'1');assert.equal($('profile-saved').textContent,'1');assert.equal($('profile-progress-label').textContent,'1 of 2 lectures completed');
 const b=await setup({memory:a.memory});t.after(b.dispose);assert.equal(b.document.getElementById('profile-avatar').textContent,'SA');assert.equal(b.document.getElementById('profile-goal-display').textContent,'Revise DP this week');
});
test('profile rendering handles invalid storage and treats the name as text',async t=>{
 const a=await setup({stored:{'a2z-profile':JSON.stringify({name:'<img src=x>',goal:7})}});t.after(a.dispose);assert.equal(a.document.querySelector('#profile-name-label img'),null);assert.equal(a.document.getElementById('profile-goal-display').textContent,'Set a study goal for your next revision.');
 const b=await setup({blockedStorage:true});t.after(b.dispose);b.document.getElementById('open-profile').click();b.document.getElementById('learner-name').value='Learner';b.document.getElementById('profile-form').dispatchEvent(new b.window.Event('submit',{cancelable:true}));assert.match(b.document.getElementById('toast').textContent,/this session/);
});
