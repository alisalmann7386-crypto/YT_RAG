'use strict';
const $=id=>document.getElementById(id);
const state={stats:null,library:[],history:[],filter:null,busy:false,controller:null,generation:0,key:sessionStorage.getItem('a2z-access-key')||''};
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4000);}
async function api(path,body,signal){
 const r=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(state.key?{'X-API-Key':state.key}:{})},body:body?JSON.stringify(body):undefined,signal});
 let data;try{data=await r.json();}catch{throw new Error('The server returned an unreadable response.');}
 if(!r.ok){if(r.status===401&&!$('settings-dialog').open){$('settings-info').textContent='This server requires an access key.';$('settings-dialog').showModal();}throw new Error(typeof data.detail==='string'?data.detail:'The request could not be completed.');}return data;
}
function time(seconds){if(seconds===null||seconds===undefined)return'';const s=Math.floor(seconds);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
function filter(id,title){state.filter=id;$('filter-label').textContent=id?'Lecture: '+title:'Searching all indexed material';$('clear-filter').hidden=!id;renderLibrary();}
function renderLibrary(){
 const root=$('library');root.replaceChildren();const q=$('library-search').value.toLowerCase();const items=state.library.filter(v=>v.title.toLowerCase().includes(q));
 let last='';for(const v of items){const group=v.kind==='note'?v.topic:'Indexed lectures';if(group!==last){root.append(node('div','library-group',group));last=group;}
 const b=node('button','library-item'+(state.filter===v.video_id&&v.video_id?' active':''));b.append(node('span','item-symbol',v.kind==='lecture'?'▷':'▤'));
 const text=node('span','item-title',v.title);text.append(node('small','',v.kind==='lecture'?`${v.chunks} segments · ${time(v.duration)}`:'Original study note'));b.append(text);
 b.onclick=()=>{if(v.video_id){filter(v.video_id,v.title);}else{$('question').value='Explain '+v.title.toLowerCase()+'.';$('question').focus();}closeMenu();};root.append(b);
 }if(!items.length)root.append(node('p','muted','No matching indexed material.'));
}
async function load(){
 try{const [stats,library]=await Promise.all([api('/api/stats'),api('/api/videos')]);state.stats=stats;state.library=library.items;renderLibrary();
  $('connection').textContent=stats.llm_provider==='none'?'Evidence mode':'RAG connected';
  $('corpus-banner').textContent=stats.lectures?`${stats.lectures} indexed lectures · ${stats.chunks} segments · ${stats.backend.toUpperCase()} retrieval`:`Demo library · ${stats.notes} original notes · No lecture transcripts yet`;
  $('settings-info').textContent=`Library: ${stats.corpus}. Retrieval: ${stats.backend}. Explanations: ${stats.llm_provider==='none'?'evidence only':stats.model}.`;
 }catch(e){$('connection').textContent='Connection unavailable';$('corpus-banner').textContent=e.message;toast(e.message);}
}
function closeMenu(){$('sidebar').classList.remove('open');$('menu').setAttribute('aria-expanded','false');}
function sourceView(s,card){
 document.querySelectorAll('.source-card').forEach(c=>c.classList.remove('active'));if(card)card.classList.add('active');
 if(s.video_id&&/^[A-Za-z0-9_-]{11}$/.test(s.video_id)){
  const sec=Math.max(0,Math.floor(s.seek_seconds||0));$('player').src=`https://www.youtube-nocookie.com/embed/${s.video_id}?start=${sec}&rel=0`;$('player-wrapper').hidden=false;
  $('player-link').href=`https://www.youtube.com/watch?v=${s.video_id}&t=${sec}s`;
 }else{$('player-wrapper').hidden=true;$('player').removeAttribute('src');if(card)card.querySelector('details').open=true;}
 if(window.innerWidth<990)$('evidence-list').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderSources(sources){
 const root=$('evidence-list');root.replaceChildren();$('source-count').textContent=sources.length;$('empty-evidence').hidden=!!sources.length;$('player-wrapper').hidden=true;$('player').removeAttribute('src');
 for(const s of sources){const card=node('article','source-card');card.dataset.number=s.number;
  const top=node('div','source-top');top.append(node('span','source-number',s.number),node('span','',s.kind==='lecture'?`${s.source.toUpperCase()} · ${time(s.start)}`:'ORIGINAL STUDY NOTE'));card.append(top,node('h3','',s.title),node('p','',s.text.slice(0,220)+(s.text.length>220?'…':'')));
  const details=node('details');details.append(node('summary','', 'Read full excerpt'),node('p','',s.text));card.append(details);
  const actions=node('div','source-actions');const b=node('button','',s.video_id?'▶ Watch from '+time(s.seek_seconds):'Read this note');b.onclick=()=>sourceView(s,card);actions.append(b);
  if(s.video_id&&/^[A-Za-z0-9_-]{11}$/.test(s.video_id)){const a=node('a','', 'YouTube ↗');a.href=`https://www.youtube.com/watch?v=${s.video_id}&t=${Math.floor(s.seek_seconds||0)}s`;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}card.append(actions);root.append(card);
 }
}
function inlineText(root,text,sources){
 let cursor=0;for(const match of text.matchAll(/(?<![\w])\[(\d+)\]/g)){root.append(document.createTextNode(text.slice(cursor,match.index)));const id=Number(match[1]),s=sources.find(s=>s.number===id);
  if(s){const b=node('button','cite',id);b.setAttribute('aria-label',`Read source ${id}`);b.onclick=()=>{renderSources(sources);sourceView(s,$('evidence-list').querySelector(`[data-number="${id}"]`));};root.append(b);}else root.append(document.createTextNode(match[0]));cursor=match.index+match[0].length;
 }root.append(document.createTextNode(text.slice(cursor)));
}
function renderText(root,text,sources=[]){
 // Plain text and fenced code only. Never insert LLM or transcript output using innerHTML.
 const parts=text.split(/```[^\n]*\n([\s\S]*?)```/g);parts.forEach((part,i)=>{if(i%2){const pre=node('pre');pre.append(node('code','',part));root.append(pre);}else{for(const paragraph of part.split(/\n\n+/)){if(!paragraph.trim())continue;const p=node('p');inlineText(p,paragraph,sources);root.append(p);}}});
}
function message(role,text,data){
 const row=node('article','message '+role);const label=node('div','message-label');label.append(node('span','avatar',role==='user'?'S':'a'),document.createTextNode(role==='user'?'YOU':'A2Z STUDYROOM'));const body=node('div','message-body');renderText(body,text,data?.sources||[]);row.append(label,body);
 if(data?.warning)row.append(node('div','message-warning',data.warning));
 if(data){const meta=node('div','message-meta');meta.append(node('span','',data.mode==='refusal'?'No supporting evidence':`${data.sources.length} sources · ${data.mode==='generated'?'Generated explanation':'Retrieved excerpts'}`));
  const copy=node('button','', 'Copy');copy.onclick=async()=>{try{await navigator.clipboard.writeText(text);toast('Copied answer.');}catch{toast('Copy is unavailable in this browser. Use Download conversation.');}};meta.append(copy);row.append(meta);
 }
 $('messages').append(row);row.scrollIntoView({block:'end',behavior:'smooth'});return row;
}
async function ask(event){
 if(event)event.preventDefault();const question=$('question').value.trim();if(!question||state.busy)return;
 state.busy=true;state.controller=new AbortController();const generation=state.generation;$('send').disabled=true;$('welcome').hidden=true;$('question').value='';
 message('user',question);const pending=message('assistant','');pending.querySelector('.message-body').append(node('span','loading','Finding the most relevant evidence'));
 const history=state.history.slice(-6).map(h=>({role:h.role,content:h.content.slice(0,3000)}));
 try{const data=await api('/api/ask',{question,mode:$('mode').value,language:$('language').value,code_language:$('code-language').value,video_id:state.filter,top_k:6,history},state.controller.signal);
  if(generation!==state.generation)return;pending.remove();message('assistant',data.answer,data);renderSources(data.sources);state.history.push({role:'user',content:question},{role:'assistant',content:data.answer});
 }catch(e){if(e.name!=='AbortError'&&generation===state.generation){pending.remove();message('assistant',e.message);toast(e.message);}}
 finally{if(generation===state.generation){state.busy=false;$('send').disabled=false;state.controller=null;$('question').focus();}}
}
function reset(){state.generation++;if(state.controller)state.controller.abort();state.busy=false;state.controller=null;$('send').disabled=false;state.history=[];$('messages').replaceChildren();$('welcome').hidden=false;renderSources([]);filter(null,'');$('question').value='';closeMenu();}
$('question-form').addEventListener('submit',ask);
$('question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask();}});
$('new-chat').onclick=reset;
$('mode').onchange=()=>{$('code-label').hidden=$('mode').value!=='code';};
$('clear-filter').onclick=()=>filter(null,'');
$('library-search').oninput=renderLibrary;
$('refresh').onclick=()=>{load();toast('Refreshing library.');};
$('menu').onclick=()=>{const open=$('sidebar').classList.toggle('open');$('menu').setAttribute('aria-expanded',String(open));};
$('index-help').onclick=()=>{$('help-dialog').showModal();};
$('settings').onclick=()=>{$('settings-dialog').showModal();};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
document.querySelectorAll('.prompt-card').forEach(b=>b.onclick=()=>{$('question').value=b.dataset.question;if(b.dataset.mode){$('mode').value=b.dataset.mode;$('mode').onchange();}ask();});
$('key-form').onsubmit=e=>{e.preventDefault();state.key=$('access-key').value.trim();sessionStorage.setItem('a2z-access-key',state.key);$('access-key').value='';$('settings-dialog').close();load();};
$('forget-key').onclick=()=>{state.key='';sessionStorage.removeItem('a2z-access-key');toast('Access key forgotten.');};
$('download-chat').onclick=()=>{if(!state.history.length){toast('Ask a question before exporting your conversation.');return;}const text='# A2Z Studyroom conversation\n\n'+state.history.map(h=>`## ${h.role==='user'?'Question':'Answer'}\n\n${h.content}`).join('\n\n');const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=node('a');a.href=url;a.download='a2z-conversation.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();reset();$('question').focus();}if(e.key==='Escape')closeMenu();});
load();
