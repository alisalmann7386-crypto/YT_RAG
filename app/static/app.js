'use strict';
const $=id=>document.getElementById(id);
const state={stats:null,library:[],history:[],filter:null,busy:false,controller:null,generation:0,key:sessionStorage.getItem('a2z-access-key')||''};
let saved;try{saved=new Set(JSON.parse(localStorage.getItem('a2z-saved')||'[]'));}catch{saved=new Set();}
function toggleSaved(id){if(saved.has(id))saved.delete(id);else saved.add(id);try{localStorage.setItem('a2z-saved',JSON.stringify([...saved]));}catch{toast('Saved for this session only. Browser storage is unavailable.');}renderLibrary();}
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4000);}
async function api(path,body,signal){
 const r=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(state.key?{'X-API-Key':state.key}:{})},body:body?JSON.stringify(body):undefined,signal});
 let data;try{data=await r.json();}catch{throw new Error('The server returned an unreadable response.');}
 if(!r.ok){if(r.status===401&&!$('settings-dialog').open){$('settings-info').textContent='This server requires an access key.';$('settings-dialog').showModal();}throw new Error(typeof data.detail==='string'?data.detail:'The request could not be completed.');}return data;
}
function time(seconds){if(seconds===null||seconds===undefined)return'';const s=Math.floor(seconds);return s>=3600?`${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
function filter(id,title){state.filter=id;$('filter-label').textContent=id?'Lecture: '+title:'Searching all indexed material';$('clear-filter').hidden=!id;renderLibrary();}
function renderLibrary(){
 const root=$('library');root.replaceChildren();const q=$('library-search').value.toLowerCase();const view=$('library-view').value;const items=state.library.filter(v=>(v.title+' '+(v.playlist_position||'')+' '+(v.lecture_label||'')).toLowerCase().includes(q)&&(view!=='indexed'||v.kind==='lecture')&&(view!=='saved'||saved.has(v.id)));
 $('saved-count').textContent=`${saved.size} saved`;
 let last='';for(const v of items){const group=v.kind==='note'?v.topic:'Striver A2Z · playlist order';if(group!==last){root.append(node('div','library-group',group));last=group;}
 const row=node('div','library-row');const b=node('button','library-item'+(state.filter===v.video_id&&v.video_id?' active':''));b.append(node('span','item-symbol',v.video_id?'▷':'▤'));
 const text=node('span','item-title',(v.playlist_position?'#'+v.playlist_position+' · ':'')+v.title);text.append(node('small','',v.kind==='lecture'?`${v.chunks} segments · ${time(v.duration)}`:v.kind==='catalog'?'Title searchable · captions not indexed':'Original study note'));b.append(text);
 b.onclick=()=>{if(v.video_id){filter(v.video_id,v.title);}else{$('question').value='Explain '+v.title.toLowerCase()+'.';$('question').focus();}closeMenu();};row.append(b);
 if(v.video_id){const star=node('button','save-lecture',saved.has(v.id)?'★':'☆');star.setAttribute('aria-label',`${saved.has(v.id)?'Unsave':'Save'} ${v.title}`);star.setAttribute('aria-pressed',String(saved.has(v.id)));star.onclick=()=>toggleSaved(v.id);row.append(star);}root.append(row);
 }if(!items.length)root.append(node('p','muted','No matching indexed material.'));
}
async function load(){
 try{const [stats,library]=await Promise.all([api('/api/stats'),api('/api/videos')]);state.stats=stats;state.library=library.items;renderLibrary();
  $('connection').textContent=stats.llm_provider==='none'?'Evidence mode':'RAG connected';
  $('corpus-banner').textContent=`${stats.catalog_lectures} playlist videos · ${stats.lectures} with indexed captions (${stats.coverage_percent}%)`+(stats.notes?` · ${stats.notes} original revision notes`:'');
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
  const top=node('div','source-top');top.append(node('span','source-number',s.number),node('span','',s.kind==='lecture'?`${s.playlist_position?'#'+s.playlist_position+' · ':''}${s.lecture_label?s.lecture_label+' · ':''}${time(s.matched_start??s.start)}`:'ORIGINAL STUDY NOTE'));card.append(top,node('h3','',s.title),node('p','',s.summary||s.text.slice(0,220)));
  if(s.video_id)card.append(node('small','timestamp-detail',`${s.source} · matched ${s.timestamp_basis||'window'} · link rewinds a few seconds`));
  const details=node('details');details.append(node('summary','', 'Read full excerpt'),node('p','',s.text));card.append(details);
  const actions=node('div','source-actions');const b=node('button','',s.video_id?'▶ Watch from '+time(s.seek_seconds):'Read this note');b.onclick=()=>sourceView(s,card);actions.append(b);
  if(s.video_id&&/^[A-Za-z0-9_-]{11}$/.test(s.video_id)){const a=node('a','', 'YouTube ↗');a.href=`https://www.youtube.com/watch?v=${s.video_id}&t=${Math.floor(s.seek_seconds||0)}s`;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}card.append(actions);root.append(card);
 }
}
function renderLocations(locations=[]){
 const root=$('lecture-matches');root.replaceChildren();root.hidden=!locations.length;if(!locations.length)return;
 root.append(node('h3','','Related A2Z lectures'),node('p','','Matched by title. In-video timestamps and summaries need indexed captions.'));
 for(const v of locations){const card=node('article','source-card catalog-card');card.append(node('small','',`PLAYLIST #${v.playlist_position}${v.lecture_label?' · '+v.lecture_label:''}`),node('h3','',v.title));const a=node('a','primary-link','Open lecture ↗');a.href=`https://www.youtube.com/watch?v=${v.video_id}`;a.target='_blank';a.rel='noopener noreferrer';card.append(a);root.append(card);}
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
 if(data){const meta=node('div','message-meta');meta.append(node('span','',data.mode==='refusal'?'No supporting evidence':data.mode==='catalog'?'Playlist title matches':`${data.sources.length} sources · ${data.mode==='generated'?'Generated explanation':'Extractive revision'}`));
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
  if(generation!==state.generation)return;pending.remove();message('assistant',data.answer,data);renderSources(data.sources);renderLocations(data.locations);state.history.push({role:'user',content:question},{role:'assistant',content:data.answer,sources:data.sources,locations:data.locations});
 }catch(e){if(e.name!=='AbortError'&&generation===state.generation){pending.remove();message('assistant',e.message);toast(e.message);}}
 finally{if(generation===state.generation){state.busy=false;$('send').disabled=false;state.controller=null;$('question').focus();}}
}
function reset(){state.generation++;if(state.controller)state.controller.abort();state.busy=false;state.controller=null;$('send').disabled=false;state.history=[];$('messages').replaceChildren();$('welcome').hidden=false;renderSources([]);renderLocations([]);filter(null,'');$('question').value='';closeMenu();}
$('question-form').addEventListener('submit',ask);
$('question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask();}});
$('new-chat').onclick=reset;
$('mode').onchange=()=>{$('code-label').hidden=$('mode').value!=='code';};
$('clear-filter').onclick=()=>filter(null,'');
$('library-search').oninput=renderLibrary;
$('library-view').onchange=renderLibrary;
$('refresh').onclick=()=>{load();toast('Refreshing library.');};
$('menu').onclick=()=>{const open=$('sidebar').classList.toggle('open');$('menu').setAttribute('aria-expanded',String(open));};
$('index-help').onclick=()=>{$('help-dialog').showModal();};
$('settings').onclick=()=>{$('settings-dialog').showModal();};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
document.querySelectorAll('.prompt-card').forEach(b=>b.onclick=()=>{$('question').value=b.dataset.question;if(b.dataset.mode){$('mode').value=b.dataset.mode;$('mode').onchange();}ask();});
$('key-form').onsubmit=e=>{e.preventDefault();state.key=$('access-key').value.trim();sessionStorage.setItem('a2z-access-key',state.key);$('access-key').value='';$('settings-dialog').close();load();};
$('forget-key').onclick=()=>{state.key='';sessionStorage.removeItem('a2z-access-key');toast('Access key forgotten.');};
$('download-chat').onclick=()=>{if(!state.history.length){toast('Ask a question before exporting your conversation.');return;}const text='# A2Z Studyroom conversation\n\n'+state.history.map(h=>`## ${h.role==='user'?'Question':'Answer'}\n\n${h.content}`+(h.sources?.length?'\n\nSources:\n'+h.sources.map(s=>`[${s.number}] ${s.title}${s.url?' — '+s.url:''}`).join('\n'):'')+(h.locations?.length?'\n\nRelated lectures (title matches):\n'+h.locations.map(v=>`#${v.playlist_position} ${v.title} — ${v.url}`).join('\n'):'' )).join('\n\n');const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=node('a');a.href=url;a.download='a2z-conversation.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();reset();$('question').focus();}if(e.key==='Escape')closeMenu();});
load();
