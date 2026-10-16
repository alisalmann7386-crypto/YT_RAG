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
 const memory=new Map();
 for(const name of ['localStorage','sessionStorage']){
  const store={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  Object.defineProperty(window,name,{configurable:true,get(){if(options.blockedStorage)throw new Error('Storage denied');return store;}});
 }
 const context=vm.createContext({window,document,console,AbortController,Blob,URL,navigator:{clipboard:{writeText:async()=>{}}},setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();timers.add(t);return t;},clearTimeout,
  fetch:async(path,init)=>{requests.push({path,init});if(path==='/api/stats')return{ok:true,json:async()=>({lectures:1,catalog_lectures:2,unindexed_lectures:1,coverage_percent:50,chunks:10,notes:0,backend:'bm25',llm_provider:'none',corpus:'lecture transcripts'})};if(path==='/api/videos')return{ok:true,json:async()=>({items:library})};return options.ask?options.ask(path,init):{ok:true,json:async()=>result()};}
 });
 vm.runInContext(script,context); await flush();await flush();
 return {window,document,requests,run:code=>vm.runInContext(code,context),dispose:()=>timers.forEach(clearTimeout)};
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
 const payload=result('<img src=x onerror=alert(1)>');payload.answer='<script>alert(1)</script> [1]';
 const a=await setup({ask:async()=>({ok:true,json:async()=>payload})});t.after(a.dispose);a.document.getElementById('question').value='memoization';await a.run('askQuestion()');
 assert.equal(a.document.querySelector('#messages script'),null);assert.equal(a.document.querySelector('#evidence-list img'),null);assert.match(a.document.getElementById('evidence-list').textContent,/<img/);
});
test('keyboard focus preserves chat; explicit new conversation clears it',async t=>{
 const a=await setup();t.after(a.dispose);const $=id=>a.document.getElementById(id);$('question').value='memoization';await a.run('askQuestion()');
 function key(shiftKey){const e=new a.window.Event('keydown',{bubbles:true,cancelable:true});Object.assign(e,{key:'k',ctrlKey:true,shiftKey});$('question').dispatchEvent(e);}
 key(false);assert.equal(a.run('state.history.length'),2);key(true);assert.equal(a.run('state.history.length'),0);assert.equal($('welcome').hidden,false);assert.equal($('messages').childElementCount,0);
});
