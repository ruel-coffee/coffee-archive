const STORE={fields:'arkivon.fields.v2',brews:'arkivon.brews.v2',posts:'arkivon.posts.v2',comments:'arkivon.comments.v2'};
const $=(s,c=document)=>c.querySelector(s);const $$=(s,c=document)=>[...c.querySelectorAll(s)];
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
const write=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
const uid=()=>`${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;
const stamp=value=>new Intl.DateTimeFormat('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)).replace('.','월').replace('.','일');

const defaults=[
  {key:'bean',label:'원두',placeholder:'에티오피아 구지 내추럴',on:true},
  {key:'roaster',label:'로스터리',placeholder:'ARKIVON',on:true},
  {key:'roastDate',label:'로스팅 / 디게싱',placeholder:'2026.10.10 / 3일',on:true},
  {key:'dripper',label:'드리퍼',placeholder:'V60 02',on:true},
  {key:'grinder',label:'그라인더 / 분쇄도',placeholder:'C40 / 24 clicks',on:true},
  {key:'dose',label:'원두량',placeholder:'20g',on:true},
  {key:'water',label:'물양',placeholder:'300g',on:true},
  {key:'temperature',label:'물 온도',placeholder:'92°C',on:true},
  {key:'waterType',label:'물',placeholder:'정수 / 경도 70ppm',on:false},
  {key:'brewTime',label:'추출 시간',placeholder:'03:30',on:true},
  {key:'weather',label:'날씨 / 습도',placeholder:'맑음 / 62%',on:false},
  {key:'equipment',label:'기타 장비',placeholder:'Hario scale',on:false}
];
const getFields=()=>read(STORE.fields,defaults);
const getBrews=()=>read(STORE.brews,[]);

function initNavigation(){
  const toggle=$('.menu-toggle'),nav=$('.main-nav');
  toggle?.addEventListener('click',()=>{const open=nav.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'CLOSE':'MENU'});
  nav?.addEventListener('click',()=>nav.classList.remove('open'));
}

const RECIPES={
  '46':{name:'4:6 METHOD',total:210,dose:'20g',water:'300g',steps:[
    {at:0,water:60,label:'1ST POUR',hint:'중앙에서 바깥으로 60g까지 천천히 부으세요.'},
    {at:45,water:120,label:'2ND POUR',hint:'45초에 120g까지. 첫 두 번의 푸어가 맛의 균형을 만듭니다.'},
    {at:90,water:180,label:'3RD POUR',hint:'1분 30초에 180g까지 부으세요.'},
    {at:135,water:240,label:'4TH POUR',hint:'2분 15초에 240g까지 부으세요.'},
    {at:180,water:300,label:'FINAL POUR',hint:'3분에 300g까지. 3분 30초에 드리퍼를 제거하세요.'}
  ]},
  arkivon:{name:'ARKIVON DAILY',total:180,dose:'18g',water:'270g',steps:[
    {at:0,water:54,label:'BLOOM',hint:'54g까지 붓고 가볍게 스월하세요.'},
    {at:40,water:108,label:'2ND POUR',hint:'40초에 108g까지 부으세요.'},
    {at:80,water:162,label:'3RD POUR',hint:'1분 20초에 162g까지 부으세요.'},
    {at:120,water:216,label:'4TH POUR',hint:'2분에 216g까지 부으세요.'},
    {at:160,water:270,label:'FINAL POUR',hint:'2분 40초에 270g까지. 3분에 마무리하세요.'}
  ]}
};

function initTimer(){
  const root=$('[data-timer]');if(!root)return;
  let recipe=RECIPES['46'],elapsed=0,running=false,startAt=0,raf=0,countdown=false;
  const clock=$('[data-timer-clock]',root),total=$('[data-timer-total]',root),state=$('[data-timer-state]',root),name=$('[data-recipe-name]',root),water=$('[data-step-water]',root),label=$('[data-step-label]',root),hint=$('[data-step-hint]',root),bar=$('[data-timer-progress]',root),list=$('[data-step-list]',root),start=$('[data-timer-start]',root);
  const mmss=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const beep=()=>{try{const C=window.AudioContext||window.webkitAudioContext,a=new C(),o=a.createOscillator(),g=a.createGain();o.frequency.value=740;g.gain.setValueAtTime(.08,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.18);o.connect(g).connect(a.destination);o.start();o.stop(a.currentTime+.18);navigator.vibrate?.(90)}catch{}};
  const renderList=()=>{list.innerHTML=recipe.steps.map((s,i)=>`<li data-step="${i}"><time>${mmss(s.at)}</time><strong>${s.water}g</strong><span>${esc(s.label)}</span></li>`).join('')};
  const selectStep=seconds=>{let index=0;recipe.steps.forEach((s,i)=>{if(seconds>=s.at)index=i});return index};
  const paint=seconds=>{const s=Math.min(seconds,recipe.total),index=selectStep(s),step=recipe.steps[index],next=recipe.steps[index+1];clock.textContent=mmss(s);bar.style.width=`${s/recipe.total*100}%`;water.textContent=step.water;label.textContent=step.label;hint.textContent=next?`${step.hint} · 다음 푸어까지 ${Math.max(0,Math.ceil(next.at-s))}초`:step.hint;$$('[data-step]',list).forEach((el,i)=>el.classList.toggle('active',i===index))};
  const load=key=>{recipe=RECIPES[key];elapsed=0;running=false;countdown=false;cancelAnimationFrame(raf);name.textContent=recipe.name;total.textContent=`/ ${mmss(recipe.total)}`;state.textContent='READY';start.textContent='START';start.disabled=false;label.textContent='READY TO BREW';water.textContent='0';hint.textContent=`${recipe.dose} 원두와 ${recipe.water} 물을 준비하세요.`;bar.style.width='0';renderList();$$('.recipe-choice').forEach(b=>b.classList.toggle('active',b.dataset.recipe===key));};
  let previousStep=-1;
  const loop=()=>{if(!running)return;elapsed=(performance.now()-startAt)/1000;const step=selectStep(elapsed);if(step!==previousStep){previousStep=step;beep()}paint(elapsed);if(elapsed>=recipe.total){running=false;state.textContent='COMPLETE';start.textContent='BREW AGAIN';beep();return}raf=requestAnimationFrame(loop)};
  const begin=()=>{countdown=true;start.disabled=true;let n=3;state.textContent=`START IN ${n}`;const id=setInterval(()=>{n--;if(n>0){state.textContent=`START IN ${n}`;beep();return}clearInterval(id);countdown=false;start.disabled=false;running=true;previousStep=-1;startAt=performance.now()-elapsed*1000;state.textContent='BREWING';start.textContent='PAUSE';beep();raf=requestAnimationFrame(loop)},1000)};
  start.addEventListener('click',()=>{if(countdown)return;if(running){running=false;cancelAnimationFrame(raf);state.textContent='PAUSED';start.textContent='RESUME'}else if(elapsed>0&&elapsed<recipe.total){running=true;startAt=performance.now()-elapsed*1000;state.textContent='BREWING';start.textContent='PAUSE';raf=requestAnimationFrame(loop)}else{elapsed=0;begin()}});
  $('[data-timer-reset]',root).addEventListener('click',()=>load(Object.keys(RECIPES).find(k=>RECIPES[k]===recipe)||'46'));
  $$('.recipe-choice').forEach(b=>b.addEventListener('click',()=>load(b.dataset.recipe)));load('46');
}

function initLab(){
  const form=$('[data-brew-form]');if(!form)return;
  const toggles=$('[data-field-toggles]'),grid=$('[data-form-grid]');
  $('[data-brew-date]').textContent=new Intl.DateTimeFormat('ko-KR',{dateStyle:'long'}).format(new Date());
  const render=()=>{const fields=getFields();toggles.innerHTML=fields.map((f,i)=>`<label class="field-toggle"><span>${esc(f.label)}</span><input type="checkbox" data-field-index="${i}" ${f.on?'checked':''}></label>`).join('');grid.innerHTML=fields.filter(f=>f.on).map(f=>`<label class="form-field"><span>${esc(f.label)}</span><input name="${esc(f.key)}" placeholder="${esc(f.placeholder)}"></label>`).join('')};
  toggles.addEventListener('change',e=>{const input=e.target.closest('[data-field-index]');if(!input)return;const fields=getFields();fields[+input.dataset.fieldIndex].on=input.checked;write(STORE.fields,fields);render()});
  $('[data-add-field]').addEventListener('submit',e=>{e.preventDefault();const input=$('input',e.currentTarget),label=input.value.trim();if(!label)return;const fields=getFields();fields.push({key:`custom_${uid()}`,label,placeholder:'직접 입력',on:true});write(STORE.fields,fields);input.value='';render()});
  form.addEventListener('submit',e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form));const record={id:uid(),createdAt:new Date().toISOString(),...data};write(STORE.brews,[record,...getBrews()]);form.reset();const status=$('[data-save-status]');status.textContent='아카이브에 저장했습니다.';setTimeout(()=>location.href='archive.html',650)});render();
}

function brewTitle(b){return b.bean||b.roaster||'Untitled brew'}
function specEntries(b){const labels={roaster:'ROASTER',dripper:'DRIPPER',grinder:'GRIND',dose:'DOSE',water:'WATER',temperature:'TEMP',brewTime:'TIME',roastDate:'REST',waterType:'WATER TYPE',weather:'WEATHER',equipment:'EQUIPMENT'};return Object.entries(labels).filter(([k])=>b[k]).slice(0,8).map(([k,l])=>`<li><b>${l}</b>${esc(b[k])}</li>`).join('')}
function attachment(b){if(!b)return'';return `<div class="attachment"><span>ATTACHED BREW RECORD</span><h3>${esc(brewTitle(b))}</h3><dl><div><dt>DOSE / WATER</dt><dd>${esc(b.dose||'—')} / ${esc(b.water||'—')}</dd></div><div><dt>TEMP / TIME</dt><dd>${esc(b.temperature||'—')} / ${esc(b.brewTime||'—')}</dd></div><div><dt>DRIPPER</dt><dd>${esc(b.dripper||'—')}</dd></div><div><dt>GRIND</dt><dd>${esc(b.grinder||'—')}</dd></div></dl></div>`}

function initArchive(){
  const list=$('[data-archive-list]');if(!list)return;
  const render=(query='')=>{const all=getBrews(),brews=all.filter(b=>JSON.stringify(b).toLowerCase().includes(query.toLowerCase()));$('[data-archive-count]').textContent=all.length;if(!brews.length){list.innerHTML=`<div class="empty-state"><h2>${all.length?'검색 결과가 없습니다.':'첫 추출을 기록해보세요.'}</h2><p>변수를 남기면 다음 한 잔의 방향이 보입니다.</p><a class="button button--dark" href="lab.html">OPEN BREW LAB</a></div>`;return}list.innerHTML=brews.map((b,i)=>`<article class="archive-card"><span class="index">${String(i+1).padStart(2,'0')}</span><div><h2>${esc(brewTitle(b))}</h2><span class="date">${stamp(b.createdAt)}</span>${b.notes?`<p class="notes">${esc(b.notes)}</p>`:''}</div><div><ul class="brew-specs">${specEntries(b)}</ul>${b.issue?`<p class="notes"><b>QUESTION</b><br>${esc(b.issue)}</p>`:''}</div><div class="card-actions"><button class="mini-button" data-share="${b.id}">SHARE</button><button class="mini-button danger" data-delete="${b.id}">DELETE</button></div></article>`).join('')};
  list.addEventListener('click',e=>{const share=e.target.closest('[data-share]'),del=e.target.closest('[data-delete]');if(share){sessionStorage.setItem('arkivon.share',share.dataset.share);location.href='community.html?compose=1'}if(del&&confirm('이 추출 기록을 삭제할까요?')){write(STORE.brews,getBrews().filter(b=>b.id!==del.dataset.delete));render($('[data-archive-search]').value)}});
  $('[data-archive-search]').addEventListener('input',e=>render(e.target.value));render();
}

const seedPosts=()=>[
  {id:'sample-1',author:'mori',title:'내추럴 원두의 발효향이 너무 강할 때',body:'분쇄도를 굵게 하고 온도를 낮췄는데도 발효향이 앞서네요. 첫 푸어 비율을 줄이면 단맛이 더 또렷해질까요?',createdAt:new Date(Date.now()-27*60000).toISOString(),sample:true,brew:{bean:'Ethiopia Guji Natural',dripper:'V60 02',grinder:'C40 / 25 clicks',dose:'20g',water:'300g',temperature:'90°C',brewTime:'03:18'}},
  {id:'sample-2',author:'slowpour',title:'마지막 푸어 뒤 배수가 급격히 느려집니다',body:'앞 구간은 괜찮은데 240g 이후부터 막히는 느낌입니다. 교반을 줄이는 게 먼저일지, 분쇄도를 조절해야 할지 의견이 궁금합니다.',createdAt:new Date(Date.now()-93*60000).toISOString(),sample:true,brew:{bean:'Colombia Pink Bourbon',dripper:'Origami Air S',grinder:'Ode Gen 2 / 5.1',dose:'18g',water:'270g',temperature:'92°C',brewTime:'03:42'}}
];
function getPosts(){const posts=read(STORE.posts,null);return posts??seedPosts()}
function commentsFor(id){return read(STORE.comments,{})[id]||[]}

function initCommunity(){
  const feed=$('[data-post-feed]');if(!feed)return;const composer=$('[data-composer]'),discussion=$('[data-discussion]'),brews=getBrews();
  const fillSelect=()=>{const select=$('[data-brew-select]');select.innerHTML='<option value="">기록 없이 작성</option>'+brews.map(b=>`<option value="${b.id}">${esc(brewTitle(b))} · ${stamp(b.createdAt)}</option>`).join('');const shared=sessionStorage.getItem('arkivon.share');if(shared){select.value=shared;sessionStorage.removeItem('arkivon.share')}};
  const render=()=>{const posts=getPosts();feed.innerHTML=posts.map((p,i)=>{const count=commentsFor(p.id).length;return `<article class="post-card"><span class="index">${String(i+1).padStart(2,'0')}</span><div><div class="post-meta"><b>${esc(p.author)}</b><span>${stamp(p.createdAt)}</span></div><h2>${esc(p.title)}</h2><p class="post-body">${esc(p.body)}</p></div><div>${attachment(p.brew)}</div><div class="post-discuss"><button data-open-post="${p.id}">DISCUSS →<strong>${count}</strong></button></div></article>`}).join('')};
  const openPost=id=>{const p=getPosts().find(x=>x.id===id);if(!p)return;const comments=commentsFor(id);$('[data-discussion-panel]').innerHTML=`<div class="dialog-head"><p class="section-label">OPEN DISCUSSION</p><button class="icon-button" type="button" data-close-discussion>×</button></div><div class="post-meta"><b>${esc(p.author)}</b><span>${stamp(p.createdAt)}</span></div><h2 class="discussion-title">${esc(p.title)}</h2><p class="discussion-body">${esc(p.body)}</p>${attachment(p.brew)}<section class="comments"><p class="section-label">${comments.length} RESPONSES</p><div>${comments.length?comments.map(c=>`<article class="comment"><div class="comment-meta"><b>${esc(c.author)}</b><span>${stamp(c.createdAt)}</span></div><p>${esc(c.body)}</p></article>`).join(''):'<div class="comment"><p>첫 의견을 남겨보세요.</p></div>'}</div><form class="comment-form" data-comment-form data-post-id="${id}"><input name="author" required maxlength="20" placeholder="닉네임"><input name="body" required maxlength="300" placeholder="의견 또는 질문을 적어주세요"><button class="button button--dark" type="submit">REPLY</button></form></section>`;discussion.showModal()};
  feed.addEventListener('click',e=>{const b=e.target.closest('[data-open-post]');if(b)openPost(b.dataset.openPost)});
  $('[data-open-composer]').addEventListener('click',()=>{fillSelect();composer.showModal()});
  $$('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>composer.close()));
  $('[data-post-form]').addEventListener('submit',e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget)),brew=brews.find(b=>b.id===data.brewId);const post={id:uid(),author:data.author,title:data.title,body:data.body,createdAt:new Date().toISOString(),brew};write(STORE.posts,[post,...getPosts()]);e.currentTarget.reset();composer.close();render()});
  discussion.addEventListener('click',e=>{if(e.target.closest('[data-close-discussion]'))discussion.close()});
  discussion.addEventListener('submit',e=>{if(!e.target.matches('[data-comment-form]'))return;e.preventDefault();const id=e.target.dataset.postId,data=Object.fromEntries(new FormData(e.target)),all=read(STORE.comments,{});all[id]=[...(all[id]||[]),{id:uid(),author:data.author,body:data.body,createdAt:new Date().toISOString()}];write(STORE.comments,all);openPost(id);render()});
  if(new URLSearchParams(location.search).has('compose')){fillSelect();composer.showModal()}render();
}

document.addEventListener('DOMContentLoaded',()=>{initNavigation();initTimer();initLab();initArchive();initCommunity()});
