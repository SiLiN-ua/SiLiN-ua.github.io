/* Portfolio-only navigation, catalogues and reader tools. No game state access. */
(()=>{'use strict';
 const page=document.body.className.match(/page-([\w-]+)/)?.[1]||'';
 const en=()=>document.documentElement.lang==='en';
 const label=(uk,eng)=>en()?eng:uk;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const slug=new URLSearchParams(location.search).get('slug');
 const seen=new WeakSet();let currentFilter='all',query='';
 let readerObserver;
 const category={
  'crypto-scam-call-centre':'fraud','telegram-military-impostor-donation-scam':'fraud','instagram-teen-fake-attribution':'fraud','passport-fraud-multi-source':'screening','twin-candidate-screening':'screening','family-chain':'screening','numeric-identifier':'identity','steam-id-to-identity':'identity','anonymous-x-attribution':'identity','private-accounts-access-layer':'identity'
 };
 function toolbar(target,groups=false){
   let bar=document.getElementById('catalogue-controls');
   if(!bar){bar=document.createElement('div');bar.id='catalogue-controls';bar.className='catalogue-controls';target.before(bar);
     const search=document.createElement('input');search.type='search';search.id='catalogue-search';search.autocomplete='off';bar.append(search);
     const filters=document.createElement('div');filters.className='catalogue-filters';bar.append(filters);
     if(groups)for(const key of ['all','identity','fraud','screening']){const b=document.createElement('button');b.type='button';b.dataset.filter=key;b.addEventListener('click',()=>{currentFilter=key;applyFilter(target);});filters.append(b);}
     const count=document.createElement('output');count.className='catalogue-count';count.setAttribute('aria-live','polite');bar.append(count);
     search.addEventListener('input',()=>{query=search.value.trim().toLocaleLowerCase();applyFilter(target);});
     const empty=document.createElement('p');empty.className='catalogue-empty';empty.hidden=true;target.after(empty);
   }
   const search=bar.querySelector('input');search.placeholder=label('Пошук у розділі…','Search this section…');search.setAttribute('aria-label',search.placeholder);
   const titles={all:['Усі','All'],identity:['Атрибуція','Attribution'],fraud:['Шахрайство','Fraud'],screening:['Перевірки','Screening']};
   bar.querySelectorAll('[data-filter]').forEach(b=>b.textContent=label(...titles[b.dataset.filter]));
   applyFilter(target);
 }
 function applyFilter(target){
   let count=0;const children=[...target.children].filter(e=>e.matches('.card,.proj-row,.cert,.rec,.tool-card'));
   for(const card of children){const href=card.querySelector('a[href*="slug="]')?.getAttribute('href')||'',s=new URL(href||location.href,location.href).searchParams.get('slug');const match=(!query||card.textContent.toLocaleLowerCase().includes(query))&&(currentFilter==='all'||category[s]===currentFilter);card.hidden=!match;if(match)count++;}
   const bar=document.getElementById('catalogue-controls');if(!bar)return;
   bar.querySelector('output').textContent=`${count} / ${children.length}`;
   bar.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===currentFilter)));
   const empty=target.nextElementSibling;if(empty?.classList.contains('catalogue-empty')){empty.hidden=!!count;empty.textContent=label('Нічого не знайдено. Змініть запит або напрям.','No matches. Change the search or category.');}
 }
 function reader(target){
   const meta=target.querySelector('.article-meta');if(!meta||meta.dataset.readerReady)return;
   const headings=[...target.querySelectorAll('h2')];if(!headings.length)return;meta.dataset.readerReady='true';
   const outline=document.createElement('details');outline.className='reader-outline';
   const summary=document.createElement('summary');summary.textContent=label('Зміст матеріалу','Contents');outline.append(summary);
   const links=document.createElement('nav');links.setAttribute('aria-label',summary.textContent);outline.append(links);
   const map=document.createElement('section');map.className='reader-map';const title=document.createElement('div');title.className='reader-map-title';title.textContent=label('Карта матеріалу','Article map');map.append(title);
   const mapNodes=document.createElement('div');mapNodes.className='reader-map-nodes';map.append(mapNodes);
   headings.forEach((h,i)=>{h.id=h.id||`section-${i+1}`;const a=document.createElement('a');a.href='#'+h.id;a.textContent=h.textContent;links.append(a);if(i<6){const node=document.createElement('a');node.href=a.href;const number=document.createElement('span');number.textContent=String(i+1).padStart(2,'0');const text=document.createElement('strong');text.textContent=h.textContent;node.append(number,text);mapNodes.append(node);}});
   meta.after(outline,map);
   if(slug==='crypto-scam-call-centre')investigation(target,map);
   readerObserver?.disconnect();readerObserver=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){links.querySelectorAll('a').forEach(a=>a.classList.toggle('current',a.hash==='#'+e.target.id));}},{rootMargin:'-90px 0px -65% 0px'});headings.forEach(h=>readerObserver.observe(h));
 }
 function investigation(target,map){
   const steps=[
     ['Username → телефон','Username → phone','Невідповідність країни нумерації — перший індикатор, ще не атрибуція.','A numbering-country mismatch: an initial indicator, not attribution.','crypto-scam-01-telegram-phone.png',/Стадія 1|Stage 1/i],
     ['Фото → перевірка легенди','Photo → identity check','Порівняння зображень ставить легенду під сумнів. Особу оператора ще не встановлено.','Image comparison challenges the cover story. The operator is still unidentified.','crypto-scam-03-face-similarity.png',/Стадія 2|Stage 2/i],
     ['Кадр → нова зачіпка','Frame → new lead','Кадр відеодзвінка відкриває пошук соціального профілю та пов’язаного телефону.','A video-call frame opens a route to a social profile and associated phone number.','crypto-scam-04-face-frame.png',/Стадія 3|Stage 3/i],
     ['Email → контекст локації','Email → location context','Пов’язані акаунти й активність додають географічні індикатори. Висновок спирається на зіставлення джерел.','Linked accounts and activity add location indicators. The conclusion depends on comparing sources.','crypto-scam-06-osint-industries-map.png',/Стадія 4|Stage 4/i]
   ];
   map.classList.add('investigation-map');map.replaceChildren();
   const eyebrow=document.createElement('div');eyebrow.className='reader-map-title';eyebrow.textContent='INSIDE THE MACHINE / INVESTIGATION TRACE';
   const title=document.createElement('h2');title.textContent=label('Як розсипалася легенда','How the cover story unravelled');
   const intro=document.createElement('p');intro.textContent=label('Чотири повороти розслідування. Оберіть етап, щоб побачити матеріал із кейсу. Ідентифікаційні дані у публікації анонімізовано.','Four turns in the investigation. Select a stage to inspect material from the case. Identifying details in the publication are anonymised.');
   const controls=document.createElement('div');controls.className='trace-controls';
   const panel=document.createElement('div');panel.className='trace-panel';panel.id='trace-evidence';
   const visual=document.createElement('button');visual.type='button';visual.className='trace-visual';const img=document.createElement('img');visual.append(img);
   visual.addEventListener('click',()=>openImage(img.src,img.alt,visual));
   const copy=document.createElement('div');const stepTitle=document.createElement('h3'),desc=document.createElement('p'),link=document.createElement('a');link.textContent=label('Читати цей етап ↗','Read this stage ↗');copy.append(stepTitle,desc,link);panel.append(visual,copy);
   steps.forEach((s,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-controls',panel.id);b.textContent=`0${i+1} / ${label(s[0],s[1])}`;controls.append(b);const select=()=>{controls.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));img.src='img/uploads/cases/'+s[4];img.alt=label(s[0],s[1]);visual.setAttribute('aria-label',label('Збільшити матеріал: ','Enlarge evidence: ')+img.alt);stepTitle.textContent=img.alt;desc.textContent=label(s[2],s[3]);const h=[...target.querySelectorAll('h3')].find(h=>s[5].test(h.textContent));if(h){h.id=h.id||`trace-stage-${i+1}`;link.href='#'+h.id;}link.hidden=!h;};b.addEventListener('click',select);if(i===0)select();});
   const outcome=document.createElement('p');outcome.className='trace-outcome';outcome.textContent=label('Результат → зіставлені матеріали передано потерпілому для заяви до правоохоронних органів.','Outcome → correlated materials were handed to the victim for a report to law enforcement.');
   map.append(eyebrow,title,intro,controls,panel,outcome);
 }
 function projectDetail(){const target=document.querySelector('#proj-detail'),head=target?.querySelector('.proj-head');if(!head||head.dataset.ready)return;head.dataset.ready='true';const section=target.querySelector('.proj-section');section.prepend(head);const actions=target.querySelector('.proj-actions');if(actions){const copy=actions.cloneNode(true);copy.className='project-top-actions';head.append(copy);}target.querySelectorAll('.proj-steps li').forEach((li,i)=>li.dataset.step=String(i+1).padStart(2,'0'));}
 // A single accessible image viewer for certificates, project screenshots and article evidence.
 const dialog=document.createElement('dialog');dialog.className='document-viewer';
 const close=document.createElement('button');close.type='button';close.className='document-close';close.textContent='×';dialog.append(close);
 const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');figure.append(caption);dialog.append(figure);document.body.append(dialog);
 const actual=document.createElement('button');actual.type='button';actual.className='document-scale';actual.textContent='1:1';actual.setAttribute('aria-label',label('Оригінальний розмір','Original size'));actual.setAttribute('aria-pressed','false');dialog.prepend(actual);
 actual.addEventListener('click',()=>{const on=dialog.classList.toggle('actual-size');actual.setAttribute('aria-pressed',String(on));});
 let opener;
 const openImage=(src,title,origin)=>{opener=origin;dialog.classList.remove('actual-size');actual.setAttribute('aria-pressed','false');actual.setAttribute('aria-label',label('Оригінальний розмір','Original size'));image.src=src;image.alt=title;figure.prepend(image);caption.textContent=title;close.setAttribute('aria-label',label('Закрити зображення','Close image'));dialog.setAttribute('aria-label',label('Перегляд документа','Document viewer'));dialog.showModal();};
 close.addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.addEventListener('close',()=>{opener?.focus();image.remove();image.removeAttribute('src');});
 function zoomable(){document.querySelectorAll('.cert__img,.proj-shot,.proj-hero,.prose__hero,.book__cover').forEach(parent=>{const img=parent.querySelector('img');if(!img||parent.querySelector('.zoom-document'))return;const button=document.createElement('button');button.type='button';button.className='zoom-document';button.textContent='↗';button.setAttribute('aria-label',label('Відкрити зображення','Open image'));button.addEventListener('click',()=>openImage(img.currentSrc||img.src,img.alt||parent.closest('.cert')?.querySelector('h3')?.textContent||label('Документ','Document'),button));parent.append(button);});}
 const reveal=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('dossier-visible');reveal.unobserve(e.target);}}),{threshold:.035});
 function decorate(){
   if((page==='cases'||page==='blog'||page==='tools')&&slug){document.body.classList.add('reading-mode');reader(document.querySelector('#article-body')||document.querySelector('.prose')||document.body);}
   projectDetail();zoomable();cinematic();
   if(page==='certificates')document.querySelectorAll('.cert__body').forEach(body=>{
     if(body.querySelector('.cert-details'))return;
     const content=[...body.children].filter(el=>el.matches('p,.cert__meta'));
     if(!content.length)return;
     const details=document.createElement('details');details.className='cert-details';
     const summary=document.createElement('summary');summary.textContent=label('Докладніше','Details');details.append(summary);
     content[0].before(details);content.forEach(el=>details.append(el));
   });
   const target=document.querySelector(page==='cases'&&!slug?'#cases-list':page==='projects'?'#projects-list':page==='certificates'?'#certs-list':page==='speaking'?'#speaking-list':page==='recommendations'?'#recs-list':page==='blog'&&!slug?'#posts-list':'#none');
   if(target&&target.querySelector('.card,.proj-row,.cert,.rec'))toolbar(target,page==='cases');
   document.querySelectorAll('.card,.proj-row,.book,.cert,.rec,.tl-item,.contact-item,.sup-card,.sim-tile,.skill,.proj-block').forEach((el,i)=>{if(seen.has(el))return;seen.add(el);el.style.setProperty('--stagger',`${Math.min(i%3,2)*70}ms`);el.classList.add('dossier-entrance');if(!reduced.matches)reveal.observe(el);else el.classList.add('dossier-visible');});
   const active=document.querySelector(`.nav__links>li>a[href="${page==='project'?'projects':page}.html"]`);if(active){active.classList.add('active');active.setAttribute('aria-current','page');}
 }
 // Scenes use existing headings and screenshots, never invented investigation evidence.
 const staged=new WeakSet();
 const stageObserver=new IntersectionObserver(entries=>entries.forEach(e=>{
   e.target.classList.toggle('scene-in-view',e.isIntersecting);
   if(e.isIntersecting)e.target.classList.add('scene-reached');
 }),{threshold:.28});
 function cinematic(){
   document.querySelectorAll('.dossier-scene,.reader-map-nodes a,.tl-item,.proj-steps li,.book,.cert,.proj-row').forEach((el,i)=>{
     if(staged.has(el))return;staged.add(el);el.style.setProperty('--scene-index',i%4);stageObserver.observe(el);
     if(el.matches('.dossier-scene,.book,.cert,.proj-row')){
       let frame=0;
       el.addEventListener('pointerleave',()=>{el.style.removeProperty('--light-x');el.style.removeProperty('--light-y');});
       el.addEventListener('pointermove',e=>{
         if(e.pointerType!=='mouse'||reduced.matches||document.body.classList.contains('dossier-paused')||frame)return;
         frame=requestAnimationFrame(()=>{frame=0;const r=el.getBoundingClientRect();
           el.style.setProperty('--light-x',`${(e.clientX-r.left)/r.width*100}%`);
           el.style.setProperty('--light-y',`${(e.clientY-r.top)/r.height*100}%`);
         });
       });
     }
   });
   const map=document.querySelector('.reader-map-nodes');
   if(map&&!map.dataset.cinema){map.dataset.cinema='true';
     const anchors=[...map.querySelectorAll('a')];
     const track=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){
       const active=anchors.findIndex(a=>a.hash==='#'+e.target.id);
       if(active>=0)anchors.forEach((a,i)=>{a.classList.toggle('trace-complete',i<active);a.classList.toggle('trace-current',i===active);if(i===active)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});
     }},{rootMargin:'-15% 0px -60% 0px'});
     anchors.forEach(a=>{const h=document.getElementById(a.hash.slice(1));if(h)track.observe(h);});
   }
   const detail=document.querySelector('#proj-detail');
   if(detail&&!detail.querySelector('.project-screen-deck')){
     const shots=[...detail.querySelectorAll('.proj-shot')];
     if(shots.length>1){
       const deck=document.createElement('section');deck.className='project-screen-deck';
       const preview=document.createElement('div');preview.className='screen-stage';
       const screen=document.createElement('img');screen.alt='';preview.append(screen);
       const name=document.createElement('p');preview.append(name);
       const expand=document.createElement('button');expand.type='button';expand.className='screen-expand';expand.textContent=label('Збільшити екран ↗','Enlarge screen ↗');expand.addEventListener('click',()=>openImage(screen.src,screen.alt,expand));preview.append(expand);
       const sceneNames={
         'kiriko-splash.jpg':['Знайомство з Kiriko','Meet Kiriko'],
         'kiriko-chat.jpg':['Діалог з агентом','Agent conversation'],
         'kiriko-report.jpg':['Скринінг-звіт','Screening report'],
         'kiriko-export.png':['Експорт результатів','Export results']
       };
       const buttons=document.createElement('div');buttons.className='screen-selectors';
       shots.forEach((shot,i)=>{const source=shot.querySelector('img');if(!source)return;
         const b=document.createElement('button');b.type='button';
         const scene=sceneNames[source.src.split('/').pop()];
         const title=scene?label(...scene):shot.querySelector('figcaption')?.textContent||source.alt||label('Екран проєкту','Project screen');
         b.textContent=String(i+1).padStart(2,'0')+' / '+title;
         const select=()=>{screen.src=source.src;screen.alt=title;name.textContent=title;buttons.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));preview.classList.remove('screen-changed');void preview.offsetWidth;preview.classList.add('screen-changed');};
         b.addEventListener('click',select);buttons.append(b);if(i===0)select();
       });
       deck.append(preview,buttons);detail.querySelector('.proj-hero')?.after(deck);
     }
   }
 }
 let pending=false;
 const observer=new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;decorate();});});
 ['cases-list','article-body','projects-list','proj-detail','books-list','certs-list','speaking-list','awards-list','recs-list','posts-list','tools-list','edu-root'].forEach(id=>{const target=document.getElementById(id);if(target)observer.observe(target,{childList:true,subtree:true});});
 // All motion controls are page-local; player settings and save keys are never touched.
 const motion=document.createElement('button');motion.type='button';motion.className='interior-motion';let paused=reduced.matches;
 const motionLabels=()=>{document.body.classList.toggle('dossier-paused',paused);motion.textContent=paused?label('Рух: пауза','Motion: paused'):label('Рух: увімкнено','Motion: on');motion.setAttribute('aria-pressed',String(paused));};
 motion.addEventListener('click',()=>{paused=!paused;motionLabels();});document.body.append(motion);motionLabels();
 document.addEventListener('langchange',()=>{motionLabels();setTimeout(decorate,0);});
 reduced.addEventListener('change',()=>{paused=reduced.matches;motionLabels();});decorate();
})();
