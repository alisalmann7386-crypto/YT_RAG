'use strict';
const $ = id => document.getElementById(id);
const storage = {
 get(kind, key, fallback = '') { try { return window[kind].getItem(key) ?? fallback; } catch { return fallback; } },
 set(kind, key, value) { try { window[kind].setItem(key, value); return true; } catch { return false; } },
 remove(kind, key) { try { window[kind].removeItem(key); } catch { /* In-memory use still works. */ } }
};
let saved;
try { const raw = JSON.parse(storage.get('localStorage', 'a2z-saved', '[]')); saved = new Set(Array.isArray(raw) ? raw.filter(v => typeof v === 'string') : []); } catch { saved = new Set(); }
const state = { stats:null, library:[], history:[], filter:null, busy:false, controller:null, generation:0, savedOnly:false, evidence:null, evidenceTab:'sources', key:storage.get('sessionStorage', 'a2z-access-key') };
function node(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true'); const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', '#i-' + name); svg.append(use); return svg; }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 4500); }
function time(seconds) { if (seconds == null) return ''; const s = Math.max(0, Math.floor(seconds)); return s >= 3600 ? Math.floor(s/3600)+':'+String(Math.floor(s/60)%60).padStart(2,'0')+':'+String(s%60).padStart(2,'0') : Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function validVideo(id) { return /^[A-Za-z0-9_-]{11}$/.test(id || ''); }
function videoLink(id, seconds) { return 'https://www.youtube.com/watch?v='+id+(seconds == null ? '' : '&t='+Math.max(0,Math.floor(seconds))+'s'); }
function external(label, href, cls) { const a = node('a', cls, label); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
async function copy(text, success='Copied.') { try { await navigator.clipboard.writeText(text); toast(success); } catch { toast('Clipboard unavailable. Use the YouTube link or export your conversation.'); } }
async function api(path, body, signal) {
 const response = await fetch(path, {method:body ? 'POST' : 'GET', headers:{'Content-Type':'application/json', ...(state.key ? {'X-API-Key':state.key} : {})}, body:body ? JSON.stringify(body) : undefined, signal});
 let data; try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response. Please retry.'); }
 if (!response.ok) {
  if (response.status === 401 && !$('settings-dialog').open) { $('settings-info').textContent = 'This server requires an access key.'; $('settings-dialog').showModal(); }
  throw new Error(typeof data.detail === 'string' ? data.detail : 'The request could not be completed.');
 }
 return data;
}
function saveButton(id, title) {
 const b = node('button', 'save-lecture'); b.dataset.saveId = id; b.dataset.saveTitle = title;
 b.onclick = () => toggleSaved(id); updateSaveButton(b); return b;
}
function updateSaveButton(b) { const active = saved.has(b.dataset.saveId); b.replaceChildren(icon('save')); b.setAttribute('aria-pressed', String(active)); b.setAttribute('aria-label', (active ? 'Unsave ' : 'Save ') + b.dataset.saveTitle); b.title = active ? 'Remove bookmark' : 'Save for revision'; }
function toggleSaved(id) {
 if (saved.has(id)) saved.delete(id); else saved.add(id);
 if (!storage.set('localStorage', 'a2z-saved', JSON.stringify([...saved]))) toast('Saved for this session. Browser storage is unavailable.');
 renderLibrary(); document.querySelectorAll('[data-save-id]').forEach(updateSaveButton);
}
function setSavedView(value) { state.savedOnly = value; for (const [id, active] of [['tab-all',!value],['tab-saved',value]]) { $(id).classList.toggle('active', active); $(id).setAttribute('aria-pressed', String(active)); } renderLibrary(); }
function renderLibrary() {
 const root = $('library'); root.replaceChildren();
 const query = $('library-search').value.toLowerCase().trim().replace(/dynamic programming/g,'dp'); const terms = query.split(/\s+/).filter(Boolean); const view = $('library-view').value;
 const items = state.library.filter(v => { const title = (v.title+' '+(v.playlist_position || '')+' '+(v.lecture_label || '')).toLowerCase(); return terms.every(t => title.includes(t)) && (view !== 'indexed' || v.kind === 'lecture') && (view !== 'missing' || v.kind === 'catalog') && (!state.savedOnly || saved.has(v.id)); });
 $('saved-count').textContent = state.library.filter(v => saved.has(v.id)).length; $('library-total').textContent = state.library.filter(v => v.video_id).length;
 if (items.length) { const heading = node('div','library-group',state.savedOnly ? 'Saved for revision' : query ? 'Search results' : 'Playlist order'); heading.append(node('span','',items.length+' results')); root.append(heading); }
 for (const v of items) {
  const row = node('div','library-row'); const b = node('button','library-item'+(state.filter === v.video_id && v.video_id ? ' active' : '')); b.setAttribute('aria-pressed', String(!!v.video_id && state.filter === v.video_id));
  b.append(node('span','item-symbol',v.playlist_position ? String(v.playlist_position).padStart(2,'0') : 'N'));
  const text = node('span','item-text'); text.append(node('span','item-title',v.title),node('small',v.kind === 'lecture' ? 'indexed' : '',v.kind === 'lecture' ? time(v.duration)+' · Captions indexed' : v.kind === 'catalog' ? 'Title only · Captions pending' : 'Original study note')); b.append(text);
  b.onclick = () => { if (v.video_id) selectLecture(v); else { $('question').value='Explain '+v.title+'.'; updateQuestion(); $('question').focus(); } closeMenu(); };
  row.append(b); if (v.video_id) row.append(saveButton(v.id, v.title)); root.append(row);
 }
 if (!items.length) root.append(node('p','empty-library',state.savedOnly ? 'No saved lectures match. Use the bookmark beside a lecture to keep it here.' : 'No lectures match these filters. Try a shorter topic or choose All availability.'));
}
function setFilter(id, title='') { state.filter=id; $('filter-label').textContent=id ? 'Lecture: '+title : 'Searching across the playlist'; $('clear-filter').hidden=!id; renderLibrary(); }
function selectLecture(v) {
 setFilter(v.video_id, v.title); setEvidence({sources:[],locations:[]}); const root=$('selected-lecture'); root.replaceChildren(); root.hidden=false; $('empty-evidence').hidden=true;
 const card=node('article','source-card selection-card'); card.append(node('span','selection-label','SELECTED LECTURE'),node('h3','',v.title),node('small','',(v.playlist_position ? 'Playlist #'+v.playlist_position+' · ' : '')+(v.lecture_label || '')+(v.lecture_label ? ' · ' : '')+time(v.duration)));
 card.append(node('p','',v.indexed ? 'Your next question will search the captions in this lecture.' : 'This lecture is searchable by title. Its captions are pending; no in-video time can be verified yet.'));
 const actions=node('div','selection-actions'); actions.append(external('Watch lecture ↗',videoLink(v.video_id),'primary-link'));
 const ask=node('button','primary-link','Revise this lecture'); ask.onclick=()=>{ $('question').value='Give me a short summary of '+v.title; $('mode').value='summary'; updateQuestion(); closeEvidence(); askQuestion(); }; actions.append(ask); card.append(actions); root.append(card); showEvidenceTab('sources'); openEvidence();
 $('question').focus();
}
function renderCoverage() {
 const s=state.stats; if (!s) return;
 $('coverage-summary').textContent=s.lectures+' of '+s.catalog_lectures+' playlist lectures have indexed captions ('+s.coverage_percent+'%). '+s.unindexed_lectures+' remain pending.';
 const root=$('coverage-missing'); root.replaceChildren(); const missing=state.library.filter(v=>v.kind==='catalog');
 if (!missing.length) root.append(node('p','', 'Every catalog lecture has indexed captions.'));
 for (const v of missing) { const a=external('',videoLink(v.video_id)); a.append(node('span','', '#'+v.playlist_position),document.createTextNode(v.title)); root.append(a); }
}
async function load() {
 $('refresh').disabled=true;
 try {
  const [stats,library]=await Promise.all([api('/api/stats'),api('/api/videos')]); state.stats=stats; state.library=library.items; renderLibrary(); renderCoverage();
  $('connection').textContent=stats.llm_provider === 'none' ? 'Evidence mode' : 'RAG connected'; $('connection').classList.remove('offline');
  $('corpus-banner').textContent=stats.lectures+' / '+stats.catalog_lectures+' lectures with captions · '+stats.coverage_percent+'% coverage'+(stats.notes ? ' · '+stats.notes+' original notes' : '');
  for (const [id,value] of [['stat-lectures',stats.catalog_lectures],['stat-indexed',stats.lectures],['stat-chunks',stats.chunks]]) $(id).textContent=Number(value).toLocaleString();
  $('coverage-value').textContent=stats.coverage_percent+'%'; $('coverage-fill').style.width=stats.coverage_percent+'%'; $('coverage-caption').textContent=stats.lectures+' of '+stats.catalog_lectures+' lectures';
  $('settings-info').textContent='Library: '+stats.corpus+'. Retrieval: '+stats.backend+'. Explanations: '+(stats.llm_provider === 'none' ? 'source excerpts; generated answers need a server-side model key' : stats.model)+'.';
 } catch(e) { $('connection').textContent='Connection unavailable'; $('connection').classList.add('offline'); $('corpus-banner').textContent=e.message; toast(e.message); }
 finally { $('refresh').disabled=false; }
}
function openMenu() { $('sidebar').classList.add('open'); $('menu').setAttribute('aria-expanded','true'); $('menu-backdrop').hidden=window.innerWidth>760; closeEvidence(); }
function closeMenu() { $('sidebar').classList.remove('open'); $('menu').setAttribute('aria-expanded','false'); $('menu-backdrop').hidden=true; }
function openEvidence() { $('evidence-panel').classList.add('open'); $('toggle-evidence').setAttribute('aria-expanded','true'); }
function closeEvidence() { $('evidence-panel').classList.remove('open'); $('toggle-evidence').setAttribute('aria-expanded','false'); }
function closePlayer() { $('player-wrapper').hidden=true; $('player').removeAttribute('src'); }
function showEvidenceTab(tab) {
 state.evidenceTab=tab; $('sources-view').hidden=tab!=='sources'; $('lecture-matches').hidden=tab!=='lectures'; $('selected-lecture').hidden=tab!=='sources' || !$('selected-lecture').childElementCount;
 for (const name of ['sources','lectures']) { const b=$('evidence-tab-'+name); b.classList.toggle('active',name===tab); b.setAttribute('aria-pressed',String(name===tab)); }
 if (tab==='lectures') closePlayer();
}
function sourceView(s,card) {
 showEvidenceTab('sources'); document.querySelectorAll('.source-card').forEach(c=>c.classList.remove('active')); if (card) card.classList.add('active');
 if (validVideo(s.video_id)) { const sec=Math.max(0,Math.floor(s.seek_seconds||0)); $('player').src='https://www.youtube-nocookie.com/embed/'+s.video_id+'?start='+sec+'&rel=0'; $('player-wrapper').hidden=false; $('player-link').href=videoLink(s.video_id,sec); }
 else { closePlayer(); if (card) card.querySelector('details').open=true; }
 openEvidence(); if (card) card.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function renderSources(sources) {
 const root=$('evidence-list'); root.replaceChildren(); closePlayer();
 for (const s of sources) {
  const card=node('article','source-card'); card.dataset.number=s.number;
  const top=node('div','source-top'); top.append(node('span','source-number',s.number),node('span','',s.kind==='lecture' ? (s.playlist_position ? '#'+s.playlist_position+' · ' : '')+(s.lecture_label ? s.lecture_label+' · ' : '')+time(s.matched_start??s.start) : 'ORIGINAL STUDY NOTE')); if (s.video_id) top.append(saveButton(s.video_id,s.title));
  card.append(top,node('h3','',s.title),node('p','',s.summary||s.text.slice(0,220)));
  if (s.video_id) { card.append(node('small','timestamp-detail',s.source+' · '+(s.timestamp_basis||'retrieved window')+' match'),node('div','source-range','Excerpt '+time(s.start)+' – '+time(s.end)+' · '+(s.summary_type==='extractive' ? 'Extractive recap' : 'Source excerpt'))); }
  const details=node('details'); details.append(node('summary','',s.video_id ? 'Read full caption excerpt' : 'Read full source note'),node('p','',s.text)); card.append(details);
  const actions=node('div','source-actions'); const watch=node('button','watch-button'); watch.append(icon(s.video_id ? 'play' : 'book'),document.createTextNode(s.video_id ? 'Watch · '+time(s.seek_seconds) : 'Read note')); watch.onclick=()=>sourceView(s,card); actions.append(watch);
  if (validVideo(s.video_id)) { actions.append(external('YouTube ↗',videoLink(s.video_id,s.seek_seconds))); const link=node('button',''); link.append(icon('copy')); link.setAttribute('aria-label','Copy timestamp link'); link.onclick=()=>copy(videoLink(s.video_id,s.seek_seconds),'Timestamp link copied.'); actions.append(link); }
  card.append(actions); root.append(card);
 }
}
function renderLocations(locations) {
 const root=$('lecture-matches'); root.replaceChildren(); root.append(node('p','',locations.length ? 'Playlist title matches. Open the lecture to explore; no timestamp is inferred from its title.' : 'No additional title matches for this question.'));
 for (const v of locations) { const card=node('article','source-card catalog-card'); card.append(node('small','', 'PLAYLIST #'+v.playlist_position+(v.lecture_label ? ' · '+v.lecture_label : '')),node('h3','',v.title)); const actions=node('div','source-actions'); actions.append(external('Open lecture ↗',videoLink(v.video_id)),saveButton(v.video_id,v.title)); card.append(actions); root.append(card); }
}
function setEvidence(data,tab) {
 const sources=data.sources||[], locations=data.locations||[]; state.evidence=data; $('selected-lecture').replaceChildren(); $('selected-lecture').hidden=true;
 for (const id of ['source-count','cited-count']) $(id).textContent=sources.length;
 $('mobile-source-count').textContent=sources.length+locations.length; $('related-count').textContent=locations.length; $('empty-evidence').hidden=!!(sources.length||locations.length);
 renderSources(sources); renderLocations(locations); if (!sources.length && locations.length) $('evidence-list').append(node('p','no-sources','No supporting caption excerpt for this question. See Related lectures for title matches.'));
 showEvidenceTab(tab || (sources.length ? 'sources' : locations.length ? 'lectures' : 'sources'));
}
function inlineText(root,text,data) {
 const sources=data?.sources||[]; let cursor=0;
 for (const match of text.matchAll(/(?<![\w])\[(\d+)\]/g)) {
  root.append(document.createTextNode(text.slice(cursor,match.index))); const id=Number(match[1]),s=sources.find(s=>s.number===id);
  if (s) { const b=node('button','cite',id); b.setAttribute('aria-label','Read source '+id); b.onclick=()=>{ setEvidence(data); sourceView(s,$('evidence-list').querySelector('[data-number="'+id+'"]')); }; root.append(b); } else root.append(document.createTextNode(match[0]));
  cursor=match.index+match[0].length;
 }
 root.append(document.createTextNode(text.slice(cursor)));
}
function renderText(root,text,data) {
 // Render untrusted model/caption text as text nodes, never HTML.
 const parts=text.split(/```[^\n]*\n([\s\S]*?)```/g);
 parts.forEach((part,i)=>{ if(i%2) { const pre=node('pre'); pre.append(node('code','',part)); root.append(pre); } else for(const paragraph of part.split(/\n\n+/)) { if(!paragraph.trim())continue; const p=node('p'); inlineText(p,paragraph,data); root.append(p); } });
}
function scrollConversation() { const scroller=$('conversation-scroll'); scroller.scrollTo({top:scroller.scrollHeight,behavior:'smooth'}); }
function message(role,text,data) {
 const row=node('article','message '+role); const label=node('div','message-label'); label.append(node('span','avatar',role==='user' ? 'S' : 'a²'),document.createTextNode(role==='user' ? 'YOU' : 'A2Z STUDYROOM')); const body=node('div','message-body'); renderText(body,text,data); row.append(label,body);
 if (data?.warning) row.append(node('div','message-warning',data.warning));
 if (data) {
  const meta=node('div','message-meta'); meta.append(node('span','',data.mode==='refusal' ? 'No supporting evidence' : data.mode==='catalog' ? 'Playlist title matches' : data.sources.length+' sources · '+(data.mode==='generated' ? 'Generated explanation' : 'Extractive revision')));
  const b=node('button',''); b.append(icon('copy'),document.createTextNode('Copy')); b.onclick=()=>copy(text,'Answer copied.'); meta.append(b);
  if (data.sources.length||data.locations?.length) { const view=node('button','','View sources ↗'); view.onclick=()=>{setEvidence(data);openEvidence();}; meta.append(view); } row.append(meta);
 }
 $('messages').append(row); scrollConversation(); return row;
}
function updateQuestion() { const q=$('question'); $('character-count').textContent=q.value.length+' / 1200'; q.style.height='auto'; q.style.height=Math.min(130,Math.max(66,q.scrollHeight))+'px'; }
function setBusy(value) { state.busy=value; $('send').disabled=value; $('send').hidden=value; $('stop').hidden=!value; $('messages').setAttribute('aria-busy',String(value)); }
async function askQuestion(event) {
 if (event) event.preventDefault(); const question=$('question').value.trim(); if (!question||state.busy) return;
 const generation=state.generation, controller=new AbortController(); state.controller=controller; setBusy(true); $('welcome').hidden=true;
 const history=state.history.slice(-6).map(h=>({role:h.role,content:h.content.slice(0,3000)})); state.history.push({role:'user',content:question}); message('user',question); $('question').value=''; updateQuestion();
 const pending=message('assistant',''); pending.querySelector('.message-body').append(node('span','loading','Finding the most relevant lecture moments…')); const timeout=setTimeout(()=>controller.abort('timeout'),65000);
 try {
  const data=await api('/api/ask',{question,mode:$('mode').value,language:$('language').value,code_language:$('code-language').value,video_id:state.filter,top_k:6,history},controller.signal);
  if (generation!==state.generation) return; pending.remove(); message('assistant',data.answer,data); setEvidence(data); state.history.push({role:'assistant',content:data.answer,sources:data.sources,locations:data.locations});
 } catch(e) {
  if (generation!==state.generation) return; pending.remove();
  if (controller.signal.aborted) { message('assistant',controller.signal.reason==='timeout' ? 'This request took too long. Please try again.' : 'Response stopped. You can ask another question.'); }
  else { message('assistant',e.message).classList.add('error-message'); toast(e.message); }
 } finally { clearTimeout(timeout); if (generation===state.generation) { setBusy(false); state.controller=null; $('question').focus(); } }
}
function reset() { state.generation++; state.controller?.abort(); state.controller=null; setBusy(false); state.history=[]; $('messages').replaceChildren(); $('welcome').hidden=false; setEvidence({sources:[],locations:[]}); setFilter(null); $('question').value=''; updateQuestion(); closeMenu(); closeEvidence(); $('question').focus(); }
function exportConversation() {
 if (!state.history.length) { toast('Ask a question before exporting.'); return; }
 const text='# A2Z Studyroom conversation\n\n'+state.history.map(h=>'## '+(h.role==='user'?'Question':'Answer')+'\n\n'+h.content+(h.sources?.length ? '\n\nSources:\n'+h.sources.map(s=>'['+s.number+'] '+s.title+(s.url?' — '+s.url:'')).join('\n') : '')+(h.locations?.length ? '\n\nRelated lectures (title matches):\n'+h.locations.map(v=>'#'+v.playlist_position+' '+v.title+' — '+v.url).join('\n') : '')).join('\n\n');
 const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})); const a=node('a'); a.href=url; a.download='a2z-conversation.md'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('question-form').addEventListener('submit',askQuestion);
$('question').addEventListener('input',updateQuestion);
$('question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();askQuestion();}});
$('new-chat').onclick=reset; $('stop').onclick=()=>state.controller?.abort();
$('mode').onchange=()=>{$('code-label').hidden=$('mode').value!=='code';};
$('clear-filter').onclick=()=>{setFilter(null);$('selected-lecture').hidden=true;$('selected-lecture').replaceChildren();if(!state.evidence?.sources?.length&&!state.evidence?.locations?.length)$('empty-evidence').hidden=false;};
$('library-search').oninput=renderLibrary; $('library-view').onchange=renderLibrary; $('tab-all').onclick=()=>setSavedView(false); $('tab-saved').onclick=()=>setSavedView(true);
$('refresh').onclick=load; $('menu').onclick=()=>{$('sidebar').classList.contains('open')?closeMenu():openMenu();}; $('menu-backdrop').onclick=closeMenu;
$('toggle-evidence').onclick=()=>{$('evidence-panel').classList.contains('open')?closeEvidence():openEvidence();}; $('close-evidence').onclick=closeEvidence; $('close-player').onclick=closePlayer;
$('evidence-tab-sources').onclick=()=>showEvidenceTab('sources'); $('evidence-tab-lectures').onclick=()=>showEvidenceTab('lectures');
$('coverage-details').onclick=()=>{renderCoverage();$('coverage-dialog').showModal();}; $('index-help').onclick=()=>{$('coverage-dialog').close();$('help-dialog').showModal();}; $('settings').onclick=()=>$('settings-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
document.querySelectorAll('.prompt-card').forEach(b=>b.onclick=()=>{$('question').value=b.dataset.question;$('mode').value=b.dataset.mode||'explain';$('mode').onchange();updateQuestion();askQuestion();});
document.querySelectorAll('[data-topic]').forEach(b=>b.onclick=()=>{$('library-search').value=b.dataset.topic;setSavedView(false);$('library-view').value='all';renderLibrary();openMenu();$('library-search').focus();});
$('key-form').onsubmit=e=>{e.preventDefault();state.key=$('access-key').value.trim();if(!storage.set('sessionStorage','a2z-access-key',state.key))toast('Access key kept in memory for this session.');$('access-key').value='';$('settings-dialog').close();load();};
$('forget-key').onclick=()=>{state.key='';storage.remove('sessionStorage','a2z-access-key');toast('Access key forgotten.');load();};
$('download-chat').onclick=exportConversation;
document.addEventListener('keydown',e=>{
 const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable;
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(e.shiftKey)reset();else $('question').focus();}
 if(e.key==='/'&&!typing&&!document.querySelector('dialog[open]')){e.preventDefault();openMenu();$('library-search').focus();}
 if(e.key==='Escape'){closeMenu();closeEvidence();}
});
window.addEventListener('resize',()=>{if(window.innerWidth>760)closeMenu();if(window.innerWidth>1080)closeEvidence();});
load();
