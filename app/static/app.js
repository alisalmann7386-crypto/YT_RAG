'use strict';
const $ = id => document.getElementById(id);
const storage = {
 get(kind, key, fallback = '') { try { return window[kind].getItem(key) ?? fallback; } catch { return fallback; } },
 set(kind, key, value) { try { window[kind].setItem(key, value); return true; } catch { return false; } },
 remove(kind, key) { try { window[kind].removeItem(key); } catch { /* In-memory use still works. */ } }
};
let saved;
try { const raw = JSON.parse(storage.get('localStorage', 'a2z-saved', '[]')); saved = new Set(Array.isArray(raw) ? raw.filter(v => typeof v === 'string') : []); } catch { saved = new Set(); }
const state = { stats:null, library:[], history:[], filter:null, busy:false, controller:null, generation:0, savedOnly:false, evidence:null, evidenceTab:'sources', key:storage.get('sessionStorage', 'a2z-access-key'), contextQuestion:'', sessionId:'', sessionTitle:'', remember:false, sessions:[], progress:{}, lastLecture:null, pauseHistorySave:false, profile:{name:'',goal:''} };
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
 renderProfile();
}
function setSavedView(value) { state.savedOnly = value; for (const [id, active] of [['tab-all',!value],['tab-saved',value]]) { $(id).classList.toggle('active', active); $(id).setAttribute('aria-pressed', String(active)); } renderLibrary(); }
function readStored(key,fallback) { try { return JSON.parse(storage.get('localStorage',key,JSON.stringify(fallback))); } catch { return fallback; } }
function profileInitials(){return state.profile.name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(s=>Array.from(s)[0]).join('').toLocaleUpperCase() || 'S';}
function renderProfile(){
 const initials=profileInitials();$('profile-avatar').textContent=initials;$('profile-large-avatar').textContent=initials;
 const label=$('profile-name-label');label.replaceChildren(document.createTextNode(state.profile.name || 'Your learning space'),node('small','','View your profile and progress'));
 $('profile-display-name').textContent=state.profile.name || 'DSA learner';$('profile-goal-display').textContent=state.profile.goal || 'Set a study goal for your next revision.';
 const ids=new Set(state.library.map(v=>v.video_id).filter(validVideo)),completed=[...ids].filter(id=>state.progress[id]?.status==='completed').length,revise=[...ids].filter(id=>state.progress[id]?.status==='revise').length;
 $('profile-completed').textContent=completed;$('profile-revise').textContent=revise;$('profile-saved').textContent=state.library.filter(v=>saved.has(v.id)).length;
 $('profile-progress').max=Math.max(1,ids.size);$('profile-progress').value=completed;$('profile-progress-label').textContent=completed+' of '+ids.size+' lectures completed';
 document.querySelectorAll('.message.user .avatar').forEach(a=>a.textContent=initials);
}
function initializeProfile(){const raw=readStored('a2z-profile',{});state.profile={name:typeof raw?.name==='string' ? raw.name.trim().slice(0,60) : '',goal:typeof raw?.goal==='string' ? raw.goal.trim().slice(0,140) : ''};renderProfile();}
function newSessionId() { return 'chat-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9); }
function progressLabel(id) { return {completed:'Completed',revise:'Revise again',learning:'In progress'}[state.progress[id]?.status] || ''; }
function saveProgress() {
 if (!storage.set('localStorage','a2z-progress',JSON.stringify(state.progress)) || !storage.set('localStorage','a2z-last-lecture',JSON.stringify(state.lastLecture))) toast('Progress kept for this session. Browser storage is unavailable.');
 renderLibrary(); renderContinue();renderProfile();
 document.querySelectorAll('[data-progress-id]').forEach(b=>b.setAttribute('aria-pressed',String(state.progress[b.dataset.progressId]?.status===b.dataset.progressStatus)));
}
function rememberLecture(v,seconds) {
 const id=v.video_id || v.id; if (!validVideo(id)) return;
 state.lastLecture={id,title:v.title,seconds:Number.isFinite(seconds) ? Math.max(0,Math.floor(seconds)) : null};
 state.progress[id]={status:state.progress[id]?.status || 'learning',updated:Date.now()}; saveProgress();
}
function revisionControls(v) {
 const root=node('div','revision-actions'),id=v.video_id || v.id;
 for (const [status,label] of [['completed','✓ Completed'],['revise','↻ Revise again']]) {
  const b=node('button','revision-button',label); b.dataset.progressId=id; b.dataset.progressStatus=status;
  b.setAttribute('aria-pressed',String(state.progress[id]?.status===status));
  b.onclick=()=>{state.progress[id]={status:state.progress[id]?.status===status ? 'learning' : status,updated:Date.now()}; saveProgress();}; root.append(b);
 }
 return root;
}
function renderContinue() {
 const last=state.lastLecture,v=last && state.library.find(v=>v.video_id===last.id);
 $('continue-study').hidden=!v; if (!v) return;
 $('continue-title').textContent=v.title; $('continue-progress').textContent=progressLabel(v.video_id)+(last.seconds == null ? '' : ' · Last opened at '+time(last.seconds));
 $('continue-button').onclick=()=>{selectLecture(v);if(Number.isFinite(last.seconds))sourceView({...v,seek_seconds:last.seconds});closeMenu();};
}
function cleanTurn(turn) {
 if (!turn || !['user','assistant'].includes(turn.role) || typeof turn.content!=='string') return null;
 const result={role:turn.role,content:turn.content.slice(0,20000)};
 if (turn.role==='assistant') {
  const data=turn.data || turn;
  const sources=Array.isArray(data.sources) ? data.sources.filter(s=>s && Number.isInteger(s.number) && s.number>0 && typeof s.title==='string' && typeof s.text==='string').slice(0,10) : [];
  const locations=Array.isArray(data.locations) ? data.locations.filter(v=>v && validVideo(v.video_id) && typeof v.title==='string').slice(0,10) : [];
  result.data={answer:result.content,mode:['generated','evidence','catalog','refusal'].includes(data.mode) ? data.mode : 'evidence',sources,locations,warning:typeof data.warning==='string' ? data.warning : null,summary_type:data.summary_type,requested_mode:data.requested_mode,revision_detail:data.revision_detail,context_question:typeof data.context_question==='string' ? data.context_question.slice(0,1200) : ''};
  result.sources=sources;result.locations=locations;
 }
 return result;
}
function persistConversation() {
 if (!state.remember || state.pauseHistorySave || !state.history.length) return;
 let turns=state.history.slice(-40).map(cleanTurn).filter(Boolean); while(turns[0]?.role==='assistant')turns.shift();
 if (!turns.length) return;
 const session={id:state.sessionId,title:state.sessionTitle || turns.find(t=>t.role==='user')?.content.slice(0,90) || 'Study conversation',updated:Date.now(),turns,contextQuestion:state.contextQuestion,filter:state.filter,mode:$('mode').value,language:$('language').value,codeLanguage:$('code-language').value,revisionDetail:$('revision-detail').value};
 let sessions=[session,...state.sessions.filter(s=>s.id!==session.id)].slice(0,8);
 while(sessions.length>1 && JSON.stringify(sessions).length>1200000)sessions.pop();
 state.sessions=sessions;
 if (!storage.set('localStorage','a2z-conversations',JSON.stringify(sessions))) toast('Conversation kept in memory. Browser storage is unavailable or full.');
 renderHistory();
}
function renderHistory() {
 const root=$('history-list');root.replaceChildren();$('clear-history').hidden=!state.sessions.length;
 $('history-info').textContent=state.remember ? 'Saved on this device. Choose a conversation to resume it with its sources.' : 'History is off. Enable it in Settings to save and resume conversations on this device.';
 if (!state.remember) return;
 if (!state.sessions.length) root.append(node('p','history-empty','Your saved conversations will appear here after you ask a question.'));
 for (const session of state.sessions) {
  const b=node('button','history-entry'); b.append(node('strong','',session.title),node('small','',new Date(session.updated).toLocaleString()+' · '+session.turns.filter(t=>t.role==='user').length+' questions'));
  b.onclick=()=>{persistConversation();restoreConversation(session);$('history-dialog').close();};root.append(b);
 }
}
function restoreConversation(session) {
 state.generation++;state.controller?.abort();state.controller=null;setBusy(false);closePlayer();
 state.pauseHistorySave=false;state.sessionId=session.id;state.sessionTitle=session.title;state.contextQuestion=session.contextQuestion || '';
 state.history=session.turns.map(cleanTurn).filter(Boolean);$('messages').replaceChildren();$('welcome').hidden=!!state.history.length;
 $('mode').value=['explain','locate','summary','hint','compare','complexity','code'].includes(session.mode) ? session.mode : 'explain';$('language').value=['English','Hindi','Hinglish'].includes(session.language) ? session.language : 'English';$('code-language').value=['Python','C++','Java'].includes(session.codeLanguage) ? session.codeLanguage : 'Python'; updateMode();
 $('revision-detail').value=['quick','detailed'].includes(session.revisionDetail) ? session.revisionDetail : 'detailed';
 setFilter(validVideo(session.filter) ? session.filter : null,state.library.find(v=>v.video_id===session.filter)?.title || 'Selected lecture');
 for (const turn of state.history) message(turn.role,turn.content,turn.data);
 const last=[...state.history].reverse().find(t=>t.data);setEvidence(last?.data || {sources:[],locations:[]});
 $('question').value='';updateQuestion();closeMenu();closeEvidence();$('question').focus();
}
function initializeRevision() {
 state.sessionId=newSessionId();state.remember=storage.get('localStorage','a2z-history-enabled')==='true';$('remember-history').checked=state.remember;
 const raw=readStored('a2z-conversations',[]);
 state.sessions=Array.isArray(raw) ? raw.filter(s=>s && typeof s.id==='string' && typeof s.title==='string' && Number.isFinite(s.updated) && Array.isArray(s.turns)).slice(0,8).map(s=>({...s,turns:s.turns.slice(-40).map(cleanTurn).filter(Boolean),contextQuestion:typeof s.contextQuestion==='string' ? s.contextQuestion.slice(0,1200) : ''})) : [];
 const progress=readStored('a2z-progress',{});
 if (progress && typeof progress==='object' && !Array.isArray(progress)) for (const [id,value] of Object.entries(progress)) if(validVideo(id) && ['learning','completed','revise'].includes(value?.status))state.progress[id]={status:value.status,updated:Number(value.updated)||0};
 const last=readStored('a2z-last-lecture',null);if(last && validVideo(last.id))state.lastLecture={id:last.id,seconds:Number.isFinite(last.seconds) ? Math.max(0,Math.floor(last.seconds)) : null};
 renderHistory();if(state.remember && state.sessions.length)restoreConversation(state.sessions[0]);
}
function libraryReference(query) {
 const p=query.match(/\b(?:lecture|video|playlist)(?:\s+(?:number|no\.?))?\s*#?\s*(\d+)\b/i) || query.match(/^\s*#?\s*(\d+)\s*$/);
 if(p)return {position:Number(p[1])};
 const s=query.match(/^\s*(DP|BS|G|L|Re|T|BT|BST|LL|SL|S)\s*[.\-]?\s*(\d+)\s*$/i);
 return s ? {label:s[1].toLowerCase()+' '+Number(s[2])} : null;
}
function renderLibrary() {
 const root = $('library'); root.replaceChildren();
 const normalize=text=>text.toLowerCase().replace(/dynamic programming/g,'dp').replace(/linkedlist/g,'linked list').replace(/binarysearch/g,'binary search').replace(/dijsktra|djikstra/g,'dijkstra');
 const query=normalize($('library-search').value.trim()),reference=libraryReference(query),terms=query.split(/\s+/).filter(Boolean),view=$('library-view').value;
 const items = state.library.filter(v => { const title = normalize(v.title+' '+(v.playlist_position || '')+' '+(v.lecture_label || '')); const matches=reference ? reference.position ? v.playlist_position===reference.position : (v.lecture_label || '').toLowerCase()===reference.label : terms.every(t=>title.includes(t)); return matches && (view !== 'indexed' || v.kind === 'lecture') && (view !== 'missing' || v.kind === 'catalog') && (!['completed','revise'].includes(view) || state.progress[v.video_id]?.status===view) && (!state.savedOnly || saved.has(v.id)); });
 $('saved-count').textContent = state.library.filter(v => saved.has(v.id)).length; $('library-total').textContent = state.library.filter(v => v.video_id).length;
 if (items.length) { const heading = node('div','library-group',state.savedOnly ? 'Saved for revision' : query ? 'Search results' : 'Playlist order'); heading.append(node('span','',items.length+' results')); root.append(heading); }
 for (const v of items) {
  const row = node('div','library-row'); const b = node('button','library-item'+(state.filter === v.video_id && v.video_id ? ' active' : '')); b.setAttribute('aria-pressed', String(!!v.video_id && state.filter === v.video_id));
  b.append(node('span','item-symbol',v.playlist_position ? String(v.playlist_position).padStart(2,'0') : 'N'));
  const text = node('span','item-text'); text.append(node('span','item-title',v.title),node('small',v.kind === 'lecture' ? 'indexed' : '',v.kind === 'lecture' ? time(v.duration)+' · Captions indexed' : v.kind === 'catalog' ? 'Title only · Captions pending' : 'Original study note')); if (progressLabel(v.video_id))text.append(node('small','progress-label '+state.progress[v.video_id].status,progressLabel(v.video_id))); b.append(text);
  b.onclick = () => { if (v.video_id) selectLecture(v); else { $('question').value='Explain '+v.title+'.'; updateQuestion(); $('question').focus(); } closeMenu(); };
  row.append(b); if (v.video_id) row.append(saveButton(v.id, v.title)); root.append(row);
 }
 if (!items.length) root.append(node('p','empty-library',state.savedOnly ? 'No saved lectures match. Use the bookmark beside a lecture to keep it here.' : 'No lectures match these filters. Try a shorter topic or choose All availability.'));
}
function setFilter(id, title='') { state.filter=id; $('filter-label').textContent=id ? 'Lecture: '+title : 'Searching across the playlist'; $('clear-filter').hidden=!id; renderLibrary(); }
function selectLecture(v) {
 state.contextQuestion='Explain '+v.title;rememberLecture(v);
 setFilter(v.video_id, v.title); setEvidence({sources:[],locations:[]}); const root=$('selected-lecture'); root.replaceChildren(); root.hidden=false; $('empty-evidence').hidden=true;
 const card=node('article','source-card selection-card'); card.append(node('span','selection-label','SELECTED LECTURE'),node('h3','',v.title),node('small','',(v.playlist_position ? 'Playlist #'+v.playlist_position+' · ' : '')+(v.lecture_label || '')+(v.lecture_label ? ' · ' : '')+time(v.duration)));
 card.append(node('p','',v.indexed ? 'Your next question will search the captions in this lecture.' : 'This lecture is searchable by title. Its captions are pending; no in-video time can be verified yet.'));
 const actions=node('div','selection-actions'); actions.append(external('Watch lecture ↗',videoLink(v.video_id),'primary-link'));
 const ask=node('button','primary-link','Make revision notes'); ask.onclick=()=>{if(state.busy)return; $('question').value='Create revision notes for '+v.title; $('mode').value='summary'; updateMode();updateQuestion(); closeEvidence(); askQuestion(); }; actions.append(ask); card.append(actions,revisionControls(v)); root.append(card); showEvidenceTab('sources'); openEvidence();
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
  const [stats,library]=await Promise.all([api('/api/stats'),api('/api/videos')]); state.stats=stats; state.library=library.items; renderLibrary(); renderCoverage();renderContinue(); if(state.filter)setFilter(state.filter,state.library.find(v=>v.video_id===state.filter)?.title || 'Selected lecture');
  $('connection').textContent=stats.llm_provider === 'none' ? 'Evidence mode' : 'RAG connected'; $('connection').classList.remove('offline');
  $('corpus-banner').textContent=stats.lectures+' / '+stats.catalog_lectures+' lectures with captions · '+stats.coverage_percent+'% coverage'+(stats.notes ? ' · '+stats.notes+' original notes' : '');
  for (const [id,value] of [['stat-lectures',stats.catalog_lectures],['stat-indexed',stats.lectures],['stat-chunks',stats.chunks]]) $(id).textContent=Number(value).toLocaleString();
  $('coverage-value').textContent=stats.coverage_percent+'%'; $('coverage-fill').style.width=stats.coverage_percent+'%'; $('coverage-caption').textContent=stats.lectures+' of '+stats.catalog_lectures+' lectures';
  $('settings-info').textContent='Library: '+stats.corpus+'. Retrieval: '+stats.backend+'. Explanations: '+(stats.llm_provider === 'none' ? 'source excerpts; generated answers need a server-side model key' : stats.model)+'.';
 } catch(e) { $('connection').textContent='Connection unavailable'; $('connection').classList.add('offline'); $('corpus-banner').textContent=e.message; toast(e.message); }
 finally { $('refresh').disabled=false;renderProfile(); }
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
 if (validVideo(s.video_id)) { const sec=Math.max(0,Math.floor(s.seek_seconds||0)); rememberLecture(s,sec);$('player').src='https://www.youtube-nocookie.com/embed/'+s.video_id+'?start='+sec+'&rel=0'; $('player-wrapper').hidden=false; $('player-link').href=videoLink(s.video_id,sec); }
 else { closePlayer(); if (card) card.querySelector('details').open=true; }
 openEvidence(); if (card) card.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function renderSources(sources,mode) {
 const root=$('evidence-list'); root.replaceChildren(); closePlayer();
 for (const s of sources) {
  const card=node('article','source-card'); card.dataset.number=s.number;
  const top=node('div','source-top'); top.append(node('span','source-number',s.number),node('span','',s.kind==='lecture' ? (s.playlist_position ? '#'+s.playlist_position+' · ' : '')+(s.lecture_label ? s.lecture_label+' · ' : '')+time(s.matched_start??s.start) : 'ORIGINAL STUDY NOTE')); if (s.video_id) top.append(saveButton(s.video_id,s.title));
  if(s===sources[0])card.append(node('span','source-best',mode==='generated' ? 'Primary source' : 'Best match'));
  card.append(top,node('h3','',s.title),node('p','',s.summary || 'Read the full source passage below.'));
  if (s.video_id) { card.append(node('small','timestamp-detail','Caption match at '+time(s.matched_start??s.start)+(s.seek_seconds<(s.matched_start??s.start) ? ' · Playback starts '+Math.round((s.matched_start??s.start)-s.seek_seconds)+' seconds earlier for context.' : '')),node('div','source-range','Excerpt '+time(s.start)+' – '+time(s.end)+' · '+(s.summary_type==='title_overview' ? 'Overview from lecture title' : 'Source recap'))); }
  const details=node('details'); details.append(node('summary','',s.video_id ? 'Read full caption excerpt' : 'Read full source note'),node('p','',s.text)); card.append(details);
  const actions=node('div','source-actions'); const watch=node('button','watch-button'); watch.append(icon(s.video_id ? 'play' : 'book'),document.createTextNode(s.video_id ? 'Watch · '+time(s.seek_seconds) : 'Read note')); watch.onclick=()=>sourceView(s,card); actions.append(watch);
  if (validVideo(s.video_id)) { actions.append(external('YouTube ↗',videoLink(s.video_id,s.seek_seconds))); const link=node('button',''); link.append(icon('copy')); link.setAttribute('aria-label','Copy timestamp link'); link.onclick=()=>copy(videoLink(s.video_id,s.seek_seconds),'Timestamp link copied.'); actions.append(link); }
  card.append(actions);if(validVideo(s.video_id))card.append(revisionControls(s)); root.append(card);
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
 renderSources(sources,data.mode); renderLocations(locations); if (!sources.length && locations.length) $('evidence-list').append(node('p','no-sources','No supporting caption excerpt for this question. See Related lectures for title matches.'));
 showEvidenceTab(tab || (sources.length ? 'sources' : locations.length ? 'lectures' : 'sources'));
}
function inlineText(root,text,data,allowEmphasis=true) {
 const sources=data?.sources||[]; let cursor=0;
 // A small text-only renderer: formatting never evaluates model/caption HTML.
 const pattern=/\*\*((?:[^*\n]|\*(?!\*))+?)\*\*|`([^`\n]+)`|(?<![\w])\[(\d+)\]|(\b(?:Playlist\s*#\s*\d+|(?:lecture|video)(?:\s+number)?\s*#?\s*\d+|(?:DP|BS|G|L)\s*\.?\s*\d+)\b|#\s*\d+\b)|(\b\d{1,3}:[0-5]\d(?::[0-5]\d)?\b)/gi;
 for (const match of text.matchAll(pattern)) {
  root.append(document.createTextNode(text.slice(cursor,match.index)));
  if (match[1] && allowEmphasis && data) { const strong=node('strong'); inlineText(strong,match[1],data,false); root.append(strong); }
  else if (match[2] && data) root.append(node('code','',match[2]));
  else if (match[3]) {
   const id=Number(match[3]),s=sources.find(s=>s.number===id);
   if (s) { const b=node('button','cite',id); b.setAttribute('aria-label','Read source '+id); b.onclick=()=>{ setEvidence(data); sourceView(s,$('evidence-list').querySelector('[data-number="'+id+'"]')); }; root.append(b); }
   else root.append(document.createTextNode(match[0]));
  } else if (data && (match[4] || match[5])) root.append(node('strong',match[4] ? 'lecture-reference' : 'timestamp-reference',match[0]));
  else root.append(document.createTextNode(match[0]));
  cursor=match.index+match[0].length;
 }
 root.append(document.createTextNode(text.slice(cursor)));
}
function renderText(root,text,data) {
 // Render untrusted model/caption text as text nodes, never HTML.
 const parts=text.split(/```[^\n]*\n([\s\S]*?)```/g);
 parts.forEach((part,i)=>{ if(i%2) { const wrap=node('div','code-block'),pre=node('pre'),button=node('button','copy-code','Copy code');pre.append(node('code','',part));button.onclick=()=>copy(part,'Code copied.');wrap.append(button,pre);root.append(wrap); } else for(const paragraph of part.split(/\n\n+/)) {
  if(!paragraph.trim())continue;
  const lines=paragraph.trim().split('\n');
  if(data && lines.length>=2 && /^\s*\|?\s*:?-{3,}/.test(lines[1])) {
   const wrap=node('div','answer-table'),table=node('table'),head=node('thead'),body=node('tbody');
   const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(s=>s.trim());
   for(const [i,line] of lines.entries()) {if(i===1)continue;const row=node('tr');for(const cell of cells(line)){const c=node(i===0?'th':'td');if(i===0)c.setAttribute('scope','col');inlineText(c,cell,data);row.append(c);}(i===0?head:body).append(row);}
   table.append(head,body);wrap.append(table);root.append(wrap);continue;
  }
  if(data && lines.every(line=>/^\s*(?:[-*]|\d+[.)])\s+/.test(line))) {
   const list=node(/^\s*\d/.test(lines[0]) ? 'ol' : 'ul');for(const line of lines){const li=node('li');inlineText(li,line.replace(/^\s*(?:[-*]|\d+[.)])\s+/,''),data);list.append(li);}root.append(list);continue;
  }
  if(data && /^#{1,3}\s+/.test(lines[0])){const heading=node('h3');inlineText(heading,lines[0].replace(/^#{1,3}\s+/,''),data);root.append(heading);if(lines.length>1)renderText(root,lines.slice(1).join('\n'),data);continue;}
  const p=node('p'),lineEnd=paragraph.indexOf('\n'),heading=lineEnd<0 ? paragraph : paragraph.slice(0,lineEnd);
  if ((data?.mode==='evidence' || data?.mode==='catalog') && /^Playlist\s*#\d+\b/.test(heading)) {
   const title=node('strong','result-heading'); inlineText(title,heading,data); p.append(title);
   if (lineEnd>=0) inlineText(p,paragraph.slice(lineEnd+1),data);
  } else inlineText(p,paragraph,data);
  root.append(p);
 } });
}
function scrollConversation() { const scroller=$('conversation-scroll'); scroller.scrollTo({top:scroller.scrollHeight,behavior:'smooth'}); }
function answerLectures(data) {
 const root=node('div','answer-lectures'),seen=new Set(),sources=data.sources || [],items=sources.length ? sources : data.locations || [];
 for(const item of items) {
  if(!validVideo(item.video_id) || seen.has(item.video_id))continue;seen.add(item.video_id);
  const timed=Number.isFinite(item.seek_seconds),card=node('div','answer-lecture');
  card.append(node('span','answer-match-label',seen.size===1 ? data.mode==='generated' ? 'Primary lecture' : 'Best match' : 'Also relevant'));
  const a=external((item.playlist_position ? 'Playlist #'+item.playlist_position : 'Lecture')+(item.lecture_label ? ' · '+item.lecture_label : '')+' · '+(timed ? 'Watch from '+time(item.seek_seconds) : 'Open lecture')+' ↗',videoLink(item.video_id,timed ? item.seek_seconds : null),'answer-watch-link');a.title=item.title;a.onclick=()=>rememberLecture(item,item.seek_seconds);card.append(a);root.append(card);
  if(seen.size===3)break;
 }
 return root;
}
function message(role,text,data) {
 const revision=data?.requested_mode==='summary',row=node('article','message '+role+(revision ? ' revision-message' : '')); const label=node('div','message-label'); label.append(node('span','avatar',role==='user' ? profileInitials() : 'a²'),document.createTextNode(role==='user' ? 'YOU' : 'A2Z STUDYROOM')); const body=node('div','message-body');
 if(revision){const badge=node('div','revision-badge',data.mode==='generated' ? (data.revision_detail==='quick' ? 'CONCISE REVISION NOTES' : 'EXAM-READY REVISION NOTES') : data.mode==='catalog' ? 'CAPTIONS PENDING' : data.mode==='refusal' ? 'NO MATCHING EVIDENCE' : 'LECTURE EXCERPTS');body.append(badge);}
 renderText(body,text,data); row.append(label,body);
 if (data?.warning) row.append(node('div','message-warning',data.warning));
 if (data) {
  const links=answerLectures(data);if(links.childElementCount)row.append(links);
  const meta=node('div','message-meta'); meta.append(node('span','',data.mode==='refusal' ? 'No supporting evidence' : data.mode==='catalog' ? 'Playlist title matches' : data.sources.length+' sources · '+(data.mode==='generated' ? revision ? 'Revision notes' : 'Generated explanation' : data.summary_type==='revision_extracts' ? 'Original lecture excerpts' : data.summary_type==='title_overview' ? 'Lecture overview' : 'Extractive revision')));
  const b=node('button',''); b.append(icon('copy'),document.createTextNode(revision ? 'Copy notes' : 'Copy')); b.onclick=()=>copy(revision ? notesMarkdown(text,data) : text,revision ? 'Notes copied with source links.' : 'Answer copied.'); meta.append(b);
  if(revision && data.sources.length){const download=node('button','download-notes','Download notes');download.onclick=()=>downloadMarkdown('a2z-revision-notes.md',notesMarkdown(text,data));meta.append(download);}
  if (data.sources.length||data.locations?.length) { const view=node('button','','View sources ↗'); view.onclick=()=>{setEvidence(data);openEvidence();}; meta.append(view); } row.append(meta);
  if(data.sources.length && data.mode!=='refusal'){
   const actions=node('div','study-actions');
   for(const [mode,title,q] of (revision ? [['explain','Explain a step','Explain the key steps of this topic with a small example.'],['code','Show code','Show code for this topic.']] : [['summary','Make revision notes','Create revision notes for this topic.'],['complexity','Time & space','Explain the time and space complexity of this topic.']])){
    const action=node('button','study-action',title);action.disabled=state.busy;action.onclick=()=>{if(state.busy)return;const primary=data.sources.find(s=>validVideo(s.video_id));state.contextQuestion=data.context_question || primary?.title || state.contextQuestion;if(primary)setFilter(primary.video_id,primary.title);$('mode').value=mode;updateMode();$('question').value=q;updateQuestion();askQuestion();};actions.append(action);
   }row.append(actions);
  }
 }
 $('messages').append(row); scrollConversation(); return row;
}
function updateQuestion() { const q=$('question'); $('character-count').textContent=q.value.length+' / 1200'; q.style.height='auto'; q.style.height=Math.min(130,Math.max(66,q.scrollHeight))+'px'; }
function updateMode() {
 const mode=$('mode').value;
 $('code-label').hidden=mode!=='code';
 $('revision-label').hidden=mode!=='summary';
 const info={explain:['Explain an idea using the retrieved lecture evidence.','Explain binary search with a small example…'],locate:['Find the lecture and a caption-backed moment to watch.','Where is partition equal subset sum taught?'],summary:['Study notes: goal, intuition, steps, example, complexity and recall questions. Choose concise or exam-ready notes.','Create revision notes for sliding window…'],hint:['Ask about a specific problem for a hint without the full solution.','Give me a hint for longest substring without repeating characters…'],compare:['Name both approaches you want to compare.','Compare memoization and tabulation…'],complexity:['Ask for time and auxiliary space, with the relevant lecture sources.','What is the time and space complexity of binary search?'],code:['Choose Python, C++ or Java for code derived from the lecture evidence.','Show code for binary search and explain its complexity…']}[mode];
 if(info){$('mode-help').textContent=info[0];$('question').placeholder=info[1];}
}
function setBusy(value) { state.busy=value; $('send').disabled=value; $('send').hidden=value; $('stop').hidden=!value; $('messages').setAttribute('aria-busy',String(value));document.querySelectorAll('.study-action').forEach(b=>b.disabled=value); }
async function askQuestion(event) {
 if (event) event.preventDefault(); const question=$('question').value.trim(); if (!question||state.busy) return;
 const generation=state.generation, controller=new AbortController(); state.controller=controller;state.pauseHistorySave=false; setBusy(true); $('welcome').hidden=true;
 const history=state.history.slice(-6).map(h=>({role:h.role,content:h.content.slice(0,3000)}));if(!state.sessionTitle)state.sessionTitle=question.slice(0,90); state.history.push({role:'user',content:question}); message('user',question); $('question').value=''; updateQuestion();persistConversation();
 const pending=message('assistant',''); pending.querySelector('.message-body').append(node('span','loading','Finding relevant captions and preparing your answer…')); const timeout=setTimeout(()=>controller.abort('timeout'),65000);
 try {
  const data=await api('/api/ask',{question,mode:$('mode').value,language:$('language').value,code_language:$('code-language').value,revision_detail:$('revision-detail').value,video_id:state.filter,context_question:state.contextQuestion || null,top_k:6,history},controller.signal);
  if (generation!==state.generation) return; pending.remove(); message('assistant',data.answer,data); setEvidence(data);state.contextQuestion=data.context_question || state.contextQuestion || question; state.history.push({role:'assistant',content:data.answer,sources:data.sources,locations:data.locations,data});persistConversation();
 } catch(e) {
  if (generation!==state.generation) return; pending.remove();
  if (controller.signal.aborted) { message('assistant',controller.signal.reason==='timeout' ? 'This request took too long. Please try again.' : 'Response stopped. You can ask another question.'); }
  else { message('assistant',e.message).classList.add('error-message'); toast(e.message); }
 } finally { clearTimeout(timeout); if (generation===state.generation) { setBusy(false); state.controller=null; $('question').focus(); } }
}
function reset() { persistConversation();state.generation++; state.controller?.abort(); state.controller=null; setBusy(false); state.history=[];state.contextQuestion='';state.sessionId=newSessionId();state.sessionTitle=''; $('messages').replaceChildren(); $('welcome').hidden=false; setEvidence({sources:[],locations:[]}); setFilter(null); $('question').value=''; updateQuestion();renderContinue(); closeMenu(); closeEvidence(); $('question').focus(); }
function exportConversation() {
 if (!state.history.length) { toast('Ask a question before exporting.'); return; }
 const text='# A2Z Studyroom conversation\n\n'+state.history.map(h=>'## '+(h.role==='user'?'Question':'Answer')+'\n\n'+h.content+(h.sources?.length ? '\n\nSources:\n'+h.sources.map(s=>'['+s.number+'] '+s.title+(validVideo(s.video_id)?' — '+videoLink(s.video_id,s.seek_seconds):'')).join('\n') : '')+(h.locations?.length ? '\n\nRelated lectures (title matches):\n'+h.locations.map(v=>'#'+v.playlist_position+' '+v.title+(validVideo(v.video_id)?' — '+videoLink(v.video_id):'')).join('\n') : '')).join('\n\n');
 downloadMarkdown('a2z-conversation.md',text);
}
function notesMarkdown(text,data){
 const sources=(data.sources || []).map(s=>'['+s.number+'] '+s.title+(validVideo(s.video_id) ? ' — '+videoLink(s.video_id,s.seek_seconds) : '')).join('\n');
 return '# A2Z Studyroom revision notes\n\n'+text+'\n\n## Lecture references\n\n'+sources+(data.warning ? '\n\nNote: '+data.warning : '');
}
function downloadMarkdown(filename,text){
 try { const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})); const a=node('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
 catch { toast('Download unavailable in this browser. Use Copy beside each answer instead.'); }
}
$('question-form').addEventListener('submit',askQuestion);
$('question').addEventListener('input',updateQuestion);
$('question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();askQuestion();}});
$('new-chat').onclick=reset; $('stop').onclick=()=>state.controller?.abort();
$('mode').onchange=updateMode;
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
$('open-history').onclick=()=>{renderHistory();$('history-dialog').showModal();};
$('history-settings').onclick=()=>{$('history-dialog').close();$('settings-dialog').showModal();};
$('open-profile').onclick=()=>{renderProfile();$('learner-name').value=state.profile.name;$('learner-goal').value=state.profile.goal;$('profile-dialog').showModal();};
$('profile-form').onsubmit=e=>{e.preventDefault();state.profile={name:$('learner-name').value.trim().slice(0,60),goal:$('learner-goal').value.trim().slice(0,140)};const stored=storage.set('localStorage','a2z-profile',JSON.stringify(state.profile));renderProfile();$('profile-dialog').close();toast(stored ? 'Profile updated.' : 'Profile updated for this session. Browser storage is unavailable.');};
$('remember-history').onchange=()=>{state.remember=$('remember-history').checked;storage.set('localStorage','a2z-history-enabled',String(state.remember));if(state.remember)persistConversation();renderHistory();};
$('clear-history').onclick=()=>{if(!window.confirm('Clear all saved conversations on this device?'))return;state.sessions=[];state.pauseHistorySave=true;storage.remove('localStorage','a2z-conversations');renderHistory();toast('Saved conversations cleared. The open chat stays unsaved until you ask another question.');};
document.addEventListener('keydown',e=>{
 const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable;
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(e.shiftKey)reset();else $('question').focus();}
 if(e.key==='/'&&!typing&&!document.querySelector('dialog[open]')){e.preventDefault();openMenu();$('library-search').focus();}
 if(e.key==='Escape'){closeMenu();closeEvidence();}
});
window.addEventListener('resize',()=>{if(window.innerWidth>760)closeMenu();if(window.innerWidth>1080)closeEvidence();});
initializeProfile();initializeRevision();updateMode();load();
