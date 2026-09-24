/* Progressive enhancement, isolated from game engines and stored progress. */
(()=>{'use strict';
 let selected=0;
 const update=()=>{
   const lang=document.documentElement.lang==='en'?'en':'uk';
   const dict=window.__i18nDict?.[lang]||{};
   const title=document.getElementById('node-title'),copy=document.getElementById('node-copy');
   if(title&&dict[`r.node.${selected}.title`])title.textContent=dict[`r.node.${selected}.title`];
   if(copy&&dict[`r.node.${selected}.copy`])copy.textContent=dict[`r.node.${selected}.copy`];
   const read=document.querySelector('.memoir-button');
   if(read)read.href=`content/books/pdfs/Everything_Is_Fine_${lang==='en'?'EN':'UK'}.pdf`;
   const art=document.querySelector('.memoir-art img');
   if(art){art.src=`img/uploads/Cover_EverythingIsFine_${lang==='en'?'EN':'UK'}.png`;art.alt=lang==='en'?'Everything Is Fine — book cover':'Все добре — обкладинка';}
 };
 document.querySelectorAll('[data-node]').forEach(button=>button.addEventListener('click',()=>{
   selected=Number(button.dataset.node);
   document.querySelectorAll('[data-node]').forEach(node=>{node.classList.toggle('selected',node===button);node.setAttribute('aria-pressed',String(node===button));});
   document.getElementById('node-index').textContent=`0${selected+1} / 06`;update();
 }));
 document.addEventListener('langchange',update);
 const nav=document.querySelector('.nav'),burger=nav?.querySelector('.nav__burger'),links=nav?.querySelector('.nav__links');
 if(burger&&links){
   const sync=()=>burger.setAttribute('aria-expanded',String(links.classList.contains('open')));
   new MutationObserver(sync).observe(links,{attributes:true,attributeFilter:['class']});
   document.addEventListener('keydown',e=>{if(e.key==='Escape'&&links.classList.contains('open')){links.classList.remove('open');burger.classList.remove('open');burger.focus();}});
 }
 // Honour shared incoming language links without changing simulator keys.
 const requested=new URLSearchParams(location.search).get('lang');
 if(requested==='en'||requested==='uk'){
   const apply=()=>document.querySelector(`.nav__lang button[data-lang="${requested}"]`)?.click();
   if(window.__i18nDict)setTimeout(apply,0);else document.addEventListener('langchange',()=>setTimeout(apply,0),{once:true});
 }
 // A searchable index makes the large portfolio accessible in a few keystrokes.
 const searchButton=document.createElement('button');
 searchButton.className='quick-search-button';searchButton.type='button';
 searchButton.innerHTML='<span aria-hidden="true">⌕</span><kbd>⌘ K</kbd>';
 nav?.insertBefore(searchButton,burger);
 const dialog=document.createElement('dialog');dialog.className='quick-search';
 dialog.innerHTML='<form method="dialog" class="search-heading"><label for="portfolio-search"></label><button value="close" aria-label="Close">×</button></form><input type="search" id="portfolio-search" autocomplete="off"><div class="search-results" aria-live="polite"></div><div class="search-footer">ESC <span></span></div>';
 document.body.append(dialog);
 dialog.setAttribute('aria-label','Portfolio search');
 dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dialog.close();}});
 const searchInput=dialog.querySelector('input'),results=dialog.querySelector('.search-results');
 let entries=[],searchLoaded=false;
 const lang=()=>document.documentElement.lang==='en'?'en':'uk';
 const index=async()=>{
   if(searchLoaded)return;searchLoaded=true;
   entries=[...nav.querySelectorAll('a[href]')].map(a=>({url:a.getAttribute('href'),label:a.textContent.trim(),key:a.querySelector('[data-i18n]')?.dataset.i18n,type:'page'}));
   const sets=await Promise.allSettled(['cases','projects','books'].map(async category=>{
     const r=await fetch(`content/${category}/_index.json`);if(!r.ok)throw Error(r.status);return {category,items:await r.json()};
   }));
   for(const set of sets)if(set.status==='fulfilled'){
     const {category,items}=set.value;
     for(const item of items.filter(i=>i.published!==false))entries.push({
       uk:item.title_uk||item.name,en:item.title_en||item.name,type:category,
       url:category==='books'?'books.html':`${category==='projects'?'project':'cases'}.html?slug=${encodeURIComponent(item.__slug)}`
     });
   }
   renderResults();
 };
 const renderResults=()=>{
   const l=lang(),dict=window.__i18nDict?.[l]||{},q=searchInput.value.trim().toLocaleLowerCase();results.replaceChildren();
   const matches=entries.map(e=>({...e,title:dict[e.key]||e[l]||e.label})).filter(e=>`${e.title} ${e.uk||''} ${e.en||''}`.toLocaleLowerCase().includes(q)).slice(0,12);
   for(const e of matches){const a=document.createElement('a');a.href=e.url;const tag=document.createElement('small');tag.textContent=({page:l==='en'?'SECTION':'РОЗДІЛ',cases:l==='en'?'CASE':'КЕЙС',projects:l==='en'?'PROJECT':'ПРОЄКТ',books:l==='en'?'BOOK':'КНИГА'})[e.type];const title=document.createElement('span');title.textContent=e.title;a.append(tag,title);results.append(a);}
   if(!matches.length){const p=document.createElement('p');p.textContent=l==='en'?'No matches. Try a name, topic or project.':'Нічого не знайдено. Спробуйте назву, тему або проєкт.';results.append(p);}
 };
 const searchLabels=()=>{const en=lang()==='en';searchButton.setAttribute('aria-label',en?'Search portfolio':'Пошук на сайті');dialog.querySelector('label').textContent=en?'Explore the archive':'Дослідити архів';searchInput.placeholder=en?'Cases, projects, books…':'Кейси, проєкти, книги…';dialog.querySelector('.search-footer span').textContent=en?'to close':'закрити';dialog.querySelector('.search-heading button').setAttribute('aria-label',en?'Close':'Закрити');if(dialog.open)renderResults();};
 const openSearch=()=>{if(!dialog.open){dialog.showModal();searchLabels();index();renderResults();searchInput.focus();}};
 searchButton.addEventListener('click',openSearch);searchInput.addEventListener('input',renderResults);
 searchInput.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();results.querySelector('a')?.focus();}if(e.key==='Enter'){e.preventDefault();results.querySelector('a')?.click();}});
 dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
 dialog.addEventListener('close',()=>searchButton.focus());
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch();}});
 document.addEventListener('langchange',searchLabels);searchLabels();
 const progress=document.createElement('div');progress.className='reading-progress';progress.setAttribute('aria-hidden','true');document.body.append(progress);
 let scheduled=false;
 addEventListener('scroll',()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{const max=document.documentElement.scrollHeight-innerHeight;progress.style.transform=`scaleX(${max>0?scrollY/max:0})`;scheduled=false;});},{passive:true});
 update();
})();
