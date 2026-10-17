'use strict';
// Personal study data is independent of optional conversation history.
const study={notes:[],cards:[],selected:null,queue:[],index:0,busy:false,controller:null};
function studyId(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);}
function studyData(raw){
 if(!raw || typeof raw.answer!=='string' || !Array.isArray(raw.sources))return null;
 const turn=cleanTurn({role:'assistant',content:raw.answer,data:raw});if(!turn)return null;
 const d=turn.data;d.sources=d.sources.filter(s=>validVideo(s.video_id)).map(s=>({number:s.number,title:s.title.slice(0,500),text:s.text.slice(0,5000),kind:'lecture',video_id:s.video_id,playlist_position:Number.isInteger(s.playlist_position)?s.playlist_position:null,lecture_label:typeof s.lecture_label==='string'?s.lecture_label.slice(0,40):null,seek_seconds:Number.isFinite(s.seek_seconds)?Math.max(0,s.seek_seconds):null,start:Number.isFinite(s.start)?Math.max(0,s.start):null,end:Number.isFinite(s.end)?Math.max(0,s.end):null}));
 d.locations=[];d.language=['English','Hindi','Hinglish'].includes(raw.language)?raw.language:'English';return d.sources.length ? d : null;
}
function cleanNote(n){
 const data=studyData(n?.data);if(!data || typeof n?.id!=='string' || !n.id || n.id.length>100)return null;
 return {id:n.id,title:typeof n.title==='string'?n.title.slice(0,500):data.sources[0].title,category:typeof n.category==='string'?n.category.slice(0,60):'General DSA',annotation:typeof n.annotation==='string'?n.annotation.slice(0,3000):'',updated:Number.isFinite(n.updated)?n.updated:Date.now(),data};
}
function cleanCard(c){
 const data=studyData({answer:c?.answer,sources:c?.sources});
 if(!data || typeof c?.id!=='string' || c.id.length>100 || !c.id || typeof c.question!=='string' || !c.question.trim())return null;
 return {id:c.id,title:typeof c.title==='string'?c.title.slice(0,500):data.sources[0].title,question:c.question.slice(0,1200),answer:data.answer,sources:data.sources,basis:c.basis==='original caption excerpt'?'original caption excerpt':'generated notes',due:Number.isFinite(c.due)?c.due:0,streak:Number.isInteger(c.streak)?Math.min(10,Math.max(0,c.streak)):0,reviews:Number.isInteger(c.reviews)?Math.max(0,Math.min(100000,c.reviews)):0,rating:['again','got-it'].includes(c.rating)?c.rating:null};
}
function saveStudy(){
 const okNotes=storage.set('localStorage','a2z-notes',JSON.stringify(study.notes)),okCards=storage.set('localStorage','a2z-practice',JSON.stringify(study.cards));
 if(!okNotes || !okCards)toast('Kept for this session. Browser storage is unavailable or full; export a study backup to keep it.');
 updateStudyCounts();return okNotes&&okCards;
}
function updateStudyCounts(){ $('notes-count').textContent=study.notes.length;$('review-count').textContent=study.cards.filter(c=>c.due<=Date.now()).length; }
function noteCategory(title){
 for(const [pattern,label] of [[/\bDP\b|dynamic programming|subset|knapsack/i,'Dynamic programming'],[/binary search|\bBS\b/i,'Binary search'],[/graph|dijkstra|\bG-?\d/i,'Graphs'],[/linked list/i,'Linked lists'],[/tree|\bBST\b/i,'Trees'],[/recursion|backtrack/i,'Recursion'],[/stack|queue|cache/i,'Stacks & queues'],[/sort/i,'Sorting'],[/array|sum|window|pointer/i,'Arrays & patterns']])if(pattern.test(title))return label;
 return 'General DSA';
}
function saveNote(data){
 const d=studyData(data);if(!d)return;const existing=study.notes.find(n=>n.data.answer===d.answer && n.data.sources[0].video_id===d.sources[0].video_id);
 if(existing){study.selected=existing.id;toast('Already in My notes.');return;}
 if(study.notes.length>=40){toast('Your 40-note library is full. Export a backup or remove a note before saving another.');return;}
 const n={id:studyId(),title:d.sources[0].title,category:noteCategory(d.sources[0].title),annotation:'',updated:Date.now(),data:d};study.notes.unshift(n);study.selected=n.id;const ok=saveStudy();if(ok)toast('Saved to My notes, with lecture references.');
}
function openNotes(){renderNotes();$('notes-dialog').showModal();closeMenu();}
function renderNotes(){
 const select=$('notes-category'),current=select.value;select.replaceChildren();const all=node('option','','All topics');all.value='';select.append(all);
 const categories=[...new Set(study.notes.map(n=>n.category))].sort();for(const value of categories){const o=node('option','',value);o.value=value;select.append(o);}select.value=categories.includes(current)?current:'';
 const query=$('notes-search').value.toLocaleLowerCase().trim(),items=study.notes.filter(n=>(!select.value || n.category===select.value) && (n.title+' '+n.category+' '+n.annotation+' '+n.data.answer).toLocaleLowerCase().includes(query));
 const list=$('notes-list');list.replaceChildren();
 if(!items.length)list.append(node('p','muted',study.notes.length?'No notes match these filters.':'Save an answer using “Save notes” to start your library.'));
 if(!items.some(n=>n.id===study.selected))study.selected=items[0]?.id || null;
 for(const n of items){const b=node('button','note-list-item'+(n.id===study.selected?' active':''));b.setAttribute('aria-pressed',String(n.id===study.selected));b.append(node('small','',n.category),node('strong','',n.title),node('small','',new Date(n.updated).toLocaleDateString()+(n.annotation?' · Annotated':'')));b.onclick=()=>{study.selected=n.id;renderNotes();};list.append(b);}
 renderNoteDetail(study.notes.find(n=>n.id===study.selected));updateStudyCounts();
}
function renderNoteDetail(n){
 const root=$('note-detail');root.replaceChildren();if(!n){root.append(node('p','muted','Your saved notes and annotations appear here.'));return;}
 root.append(node('h3','',n.title));const meta=node('div','study-actions');
 for(const [label,fn] of [['Copy notes',()=>copy(notesMarkdown(n.data.answer,n.data))],['Download notes',()=>downloadMarkdown('a2z-saved-notes.md',notesMarkdown(n.data.answer,n.data)+(n.annotation?'\n\n## My annotation\n\n'+n.annotation:''))],['Practice',()=>{ $('notes-dialog').close();startPractice(n.data); }],['Delete',()=>{if(!window.confirm('Delete this saved note and its annotation?'))return;study.notes=study.notes.filter(x=>x.id!==n.id);saveStudy();renderNotes();}]]){const b=node('button','study-action',label);b.onclick=fn;meta.append(b);}root.append(meta);
 const form=node('form','note-editor'),category=node('input'),annotation=node('textarea');category.value=n.category;category.maxLength=60;category.setAttribute('aria-label','Note category');annotation.value=n.annotation;annotation.maxLength=3000;annotation.rows=3;annotation.setAttribute('aria-label','My annotation');annotation.placeholder='Your own observations, mistakes to avoid or questions…';
 const catLabel=node('label','','Category');catLabel.append(category);const annLabel=node('label','','My annotation');annLabel.append(annotation);const submit=node('button','primary-link','Save annotation');submit.type='submit';form.append(catLabel,annLabel,submit);form.onsubmit=e=>{e.preventDefault();n.category=category.value.trim().slice(0,60)||'General DSA';n.annotation=annotation.value.trim().slice(0,3000);n.updated=Date.now();if(saveStudy())toast('Annotation saved.');renderNotes();};root.append(form);
 const body=node('div','message-body saved-note-body');renderText(body,n.data.answer,n.data);root.append(body,answerLectures(n.data));
}
function cardsFromNotes(data){
 if(data.mode!=='generated' || data.summary_type!=='revision_notes')return [];
 const parts=data.answer.split(/^###\s+/m).slice(1);if(parts.length!==6)return [];
 const questions=({Hindi:['लक्ष्य क्या है और कौन-सी शर्तें आवश्यक हैं?','मुख्य तरीका क्यों काम करता है?','बिना देखे चरण या रिकरेंस बताइए।','एक छोटे उदाहरण को हल कीजिए।','समय और सहायक स्पेस जटिलता क्या है?','कौन-सी गलतियाँ या सीमा स्थितियाँ जाँचनी चाहिए?'],Hinglish:['Goal aur zaroori assumptions kya hain?','Main approach kyun kaam karta hai?','Bina dekhe steps ya recurrence batao.','Ek chhota example solve karo.','Time aur auxiliary space complexity kya hai?','Kaun se pitfalls ya boundary cases check karoge?']})[data.language] || ['What is the goal and what assumptions are needed?','Why does this approach work?','Describe the steps or recurrence without looking.','Work through a small example.','What are the time and auxiliary space costs?','Which pitfalls or boundary cases should you check?'];
 return parts.map((part,i)=>{const answer=part.slice(part.indexOf('\n')+1).trim(),ids=[...answer.matchAll(/(?<!\w)\[(\d+)\]/g)].map(m=>Number(m[1]));return cleanCard({id:'note-'+data.sources[0].video_id+'-'+i+'-'+smallHash(answer),title:data.sources[0].title,question:questions[i],answer,sources:data.sources.filter(s=>ids.includes(s.number)),basis:'generated notes'});}).filter(Boolean);
}
function smallHash(text){let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return(h>>>0).toString(36);}
function usePracticeCards(cards){
 const clean=cards.map(cleanCard).filter(Boolean);if(!clean.length){$('practice-status').textContent='No caption-backed cards found for this topic.';return;}
 const existing=new Map(study.cards.map(c=>[c.id,c]));for(const c of clean){const old=existing.get(c.id);existing.set(c.id,old || c);}study.cards=[...existing.values()].slice(-160);saveStudy();
 study.queue=clean.map(c=>study.cards.find(x=>x.id===c.id)||c);study.index=0;renderPractice();
}
async function startPractice(data){
 if(study.busy)return;$('practice-dialog').showModal();closeMenu();
 const local=data && cardsFromNotes(data);if(local?.length){usePracticeCards(local);return;}
 const primary=data?.sources?.find(s=>validVideo(s.video_id)),topic=data?.context_question || state.contextQuestion || state.library.find(v=>v.video_id===state.filter)?.title;
 if(!topic){$('practice-status').textContent='Find a topic or select a lecture first.';return;}
 study.busy=true;study.controller=new AbortController();const controller=study.controller;setPracticeBusy(true);$('practice-status').textContent='Preparing questions from the lecture evidence…';const timeout=setTimeout(()=>controller.abort(),65000);
 try{const result=await api('/api/practice',{question:('Create revision notes for '+topic).slice(0,1200),mode:'summary',video_id:primary?.video_id || state.filter,context_question:topic,language:data?.language || $('language').value,revision_detail:'quick',top_k:6},controller.signal);if(controller.signal.aborted)return;usePracticeCards(result.cards.map(c=>({...c,title:result.notes.sources[0]?.title})));if(result.notes.warning)toast(result.notes.warning);}
 catch(e){if(!controller.signal.aborted)$('practice-status').textContent=e.message;}
 finally{clearTimeout(timeout);study.busy=false;study.controller=null;setPracticeBusy(false);}
}
function setPracticeBusy(value){$('practice-current').disabled=value;$('practice-due').disabled=value;$('practice-weak').disabled=value;$('practice-content').setAttribute('aria-busy',String(value));}
function reviewDue(){if(study.busy)return;study.queue=study.cards.filter(c=>c.due<=Date.now()).sort((a,b)=>a.due-b.due);study.index=0;renderPractice();}
function renderPractice(){
 const root=$('practice-content');root.replaceChildren();updateStudyCounts();
 const weak=study.cards.filter(c=>c.rating==='again'),topics=new Set(weak.map(c=>c.sources[0].video_id));$('practice-overview').textContent=study.cards.length+' saved cards · '+study.cards.filter(c=>c.due<=Date.now()).length+' due · '+weak.length+' marked for revision across '+topics.size+' topics';
 if(study.index>=study.queue.length){$('practice-status').textContent=study.queue.length?'Session complete.':'No cards are due.';root.append(node('p','practice-complete',study.queue.length?'Your next reviews are scheduled. Use My notes to practise a topic again.':'Start with your current topic, or practise from a saved note.'));return;}
 const c=study.queue[study.index];$('practice-status').textContent='Card '+(study.index+1)+' of '+study.queue.length;
 root.append(node('small','section-label',c.basis==='original caption excerpt'?'READ & RECALL · ORIGINAL CAPTIONS':'ACTIVE RECALL · FROM CITED NOTES'),node('h3','practice-topic',c.title),node('h2','practice-question',c.question));
 const input=node('textarea','practice-attempt');input.rows=4;input.maxLength=3000;input.setAttribute('aria-label','Your practice answer');input.placeholder='Try answering before revealing the notes…';root.append(input);
 const reveal=node('button','primary-link','Reveal answer'),answer=node('div','practice-answer');answer.hidden=true;
 renderText(answer,c.answer,{sources:c.sources,mode:'generated'});answer.append(answerLectures({sources:c.sources,mode:'generated'}));
 const ratings=node('div','study-actions');for(const [rating,label] of [['again','Revise again · 10 min'],['got-it','Got it · next day or later']]){const b=node('button','study-action',label);b.onclick=()=>{c.rating=rating;c.reviews++;c.streak=rating==='again'?0:c.streak+1;c.due=Date.now()+(rating==='again'?600000:[1,3,7,14,30][Math.min(4,c.streak-1)]*86400000);saveStudy();study.index++;renderPractice();};ratings.append(b);}answer.append(node('p','muted','Self-assessment: compare your attempt with the cited answer. Ratings do not certify correctness.'),ratings);
 reveal.onclick=()=>{answer.hidden=false;reveal.hidden=true;input.readOnly=true;};root.append(reveal,answer);
}
function studyBackup(){return{format:'a2z-study-backup',version:1,exported_at:new Date().toISOString(),profile:state.profile,bookmarks:[...saved],progress:state.progress,lastLecture:state.lastLecture,notes:study.notes,cards:study.cards};}
function importStudy(raw){
 if(!raw || raw.format!=='a2z-study-backup' || raw.version!==1 || !Array.isArray(raw.notes) || !Array.isArray(raw.cards) || !Array.isArray(raw.bookmarks))throw new Error('Choose an A2Z Studyroom backup JSON file.');
 if(raw.notes.length>40 || raw.cards.length>160 || raw.bookmarks.length>1000)throw new Error('The backup exceeds the supported study limits.');
 const notes=raw.notes.map(cleanNote),cards=raw.cards.map(cleanCard);if(notes.some(n=>!n)||cards.some(c=>!c))throw new Error('The backup contains invalid notes or cards. No data was imported.');
 const merge=(old,incoming,limit)=>{const map=new Map(old.map(v=>[v.id,v]));for(const v of incoming)if(!map.has(v.id))map.set(v.id,v);if(map.size>limit)throw new Error('There is not enough room to merge this backup. Export your current data and remove some saved items first.');return [...map.values()];};
 const nextNotes=merge(study.notes,notes,40),nextCards=merge(study.cards,cards,160);
 study.notes=nextNotes;study.cards=nextCards;for(const id of raw.bookmarks)if(validVideo(id))saved.add(id);
 if(raw.progress && typeof raw.progress==='object')for(const [id,p] of Object.entries(raw.progress))if(validVideo(id)&&['learning','completed','revise'].includes(p?.status)&&Number.isFinite(p.updated)&&(!state.progress[id]||p.updated>state.progress[id].updated))state.progress[id]={status:p.status,updated:p.updated};
 if(!state.profile.name && typeof raw.profile?.name==='string'){state.profile={name:raw.profile.name.slice(0,60),goal:typeof raw.profile.goal==='string'?raw.profile.goal.slice(0,140):''};storage.set('localStorage','a2z-profile',JSON.stringify(state.profile));}
 if(!state.lastLecture && validVideo(raw.lastLecture?.id)){state.lastLecture={id:raw.lastLecture.id,seconds:Number.isFinite(raw.lastLecture.seconds)?Math.max(0,raw.lastLecture.seconds):null};storage.set('localStorage','a2z-last-lecture',JSON.stringify(state.lastLecture));}
 const okSaved=storage.set('localStorage','a2z-saved',JSON.stringify([...saved])),okProgress=storage.set('localStorage','a2z-progress',JSON.stringify(state.progress)),okStudy=saveStudy();renderLibrary();renderProfile();renderContinue();document.querySelectorAll('[data-save-id]').forEach(updateSaveButton);
 return okSaved&&okProgress&&okStudy;
}
function initializeStudy(){
 const notes=readStored('a2z-notes',[]),cards=readStored('a2z-practice',[]);study.notes=Array.isArray(notes)?notes.slice(0,40).map(cleanNote).filter(Boolean):[];study.cards=Array.isArray(cards)?cards.slice(0,160).map(cleanCard).filter(Boolean):[];updateStudyCounts();
 $('open-notes').onclick=openNotes;$('open-practice').onclick=()=>{reviewDue();$('practice-dialog').showModal();closeMenu();};$('notes-search').oninput=renderNotes;$('notes-category').onchange=renderNotes;$('practice-current').onclick=()=>startPractice();$('practice-due').onclick=reviewDue;$('practice-weak').onclick=()=>{if(study.busy)return;study.queue=study.cards.filter(c=>c.rating==='again');study.index=0;renderPractice();};
 $('practice-dialog').addEventListener('close',()=>study.controller?.abort());
 const section=node('section','backup-settings');section.append(node('h3','','Study backup'),node('p','muted','Move your notes, annotations, cards, bookmarks and progress between devices. Import merges without replacing existing notes. Chats and access keys are excluded. This is a manual transfer, not automatic account sync.'));
 const actions=node('div','study-actions'),exportButton=node('button','study-action','Export study backup'),importLabel=node('label','study-action','Import study backup'),input=node('input');input.type='file';input.accept='.json,application/json';input.setAttribute('aria-label','Import study backup');input.className='backup-file';importLabel.append(input);exportButton.onclick=()=>{try{const url=URL.createObjectURL(new Blob([JSON.stringify(studyBackup(),null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download='a2z-study-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{toast('Backup download unavailable in this browser.');}};
 input.onchange=async()=>{const f=input.files?.[0];if(!f)return;try{if(f.size>4000000)throw new Error('Backup files must be smaller than 4 MB.');const raw=JSON.parse(await f.text());const ok=importStudy(raw);toast(ok?'Study backup imported. Your existing notes were preserved.':'Imported for this session. Browser storage is unavailable or full; export a backup before leaving.');}catch(e){toast(e.message || 'This backup could not be imported.');}finally{input.value='';}};actions.append(exportButton,importLabel);section.append(actions);$('settings-dialog').append(section);
}
