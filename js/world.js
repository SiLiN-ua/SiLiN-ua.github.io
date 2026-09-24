/* Canvas scenes are illustrative; no remote telemetry, tracking or game state. */
(()=>{'use strict';
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 let paused=reduce.matches,clock=0,last=0,raf=0;
 const lang=()=>document.documentElement.lang==='en'?'en':'uk';
 const text=key=>window.__i18nDict?.[lang()]?.['r.world.'+key]||key;
 const toggle=document.querySelector('.motion-toggle');
 const syncMotion=()=>{document.body.classList.toggle('motion-paused',paused);toggle.setAttribute('aria-pressed',String(paused));toggle.querySelector('span').textContent=text(paused?'motionoff':'motion');};
 toggle.addEventListener('click',()=>{paused=!paused;syncMotion();wake();});
 reduce.addEventListener('change',()=>{paused=reduce.matches;syncMotion();wake();});
 const cases=[...document.querySelectorAll('[data-trace]')].map(el=>({el,kind:el.dataset.trace,step:0,playing:false,at:0}));
 const displayCase=c=>{
   c.el.querySelectorAll('[data-step]').forEach(b=>{let on=Number(b.dataset.step)===c.step;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
   c.el.querySelectorAll('[data-cluster]').forEach(e=>e.classList.toggle('active',Number(e.dataset.cluster)===c.step));
   c.el.querySelector('.trace-counter').textContent=`0${c.step+1} / 06`;
   c.el.querySelector('.trace-detail p').textContent=text(`${c.kind}.copy${c.step}`);
   const b=c.el.querySelector('.trace-play');b.setAttribute('aria-pressed',String(c.playing));b.textContent=text(c.playing?'stop':'play')+(c.playing?' Ⅱ':' ▷');
 };
 cases.forEach(c=>{
   c.el.querySelectorAll('[data-step]').forEach(b=>b.addEventListener('click',()=>{c.playing=false;c.step=Number(b.dataset.step);displayCase(c);}));
   c.el.querySelector('.trace-play').addEventListener('click',()=>{c.playing=!c.playing;c.at=clock;if(c.playing&&paused){paused=false;syncMotion();}displayCase(c);wake();});
 });
 const translate=()=>{
   syncMotion();cases.forEach(displayCase);
   document.querySelectorAll('[data-volume]').forEach(a=>{let n=a.dataset.volume,s=lang()==='en'?'EN':'UK';a.href=`content/books/pdfs/The_Shadow_Files_Vol${n}_${s}.pdf`;a.querySelector('img').src=`img/uploads/Cover_ShadowFiles_Vol${n}_${s}.png`;a.setAttribute('aria-label',`The Shadow Files · ${n} · ${a.querySelector('h3').textContent} · PDF`);});
 };
 document.addEventListener('langchange',translate);translate();
 // Tilt the display surface while keeping the book's floating animation independent.
 if(matchMedia('(pointer:fine)').matches){document.querySelectorAll('.volume-card,.lab-feature').forEach(card=>{
   const surface=card.querySelector('.volume-stage,.kiriko-cover');
   card.addEventListener('pointermove',e=>{if(paused||!surface)return;const r=card.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;surface.style.transform=`perspective(1000px) rotateX(${-y*7}deg) rotateY(${x*10}deg)`;});
   card.addEventListener('pointerleave',()=>{if(surface)surface.style.transform='';});
 });}
 if(!reduce.matches){
   const items=document.querySelectorAll('.section-heading,.world-copy,.trace-case,.method-inner,.lab-feature,.lab-card,.volume-card,.memoir-copy,.practice-card,.about-strip,.contact-band,.credential-card,.speaking-stage,.session-card');
   const reveal=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('entered');reveal.unobserve(e.target);}}),{threshold:.09});
   items.forEach((el,i)=>{el.setAttribute('data-enter','');el.style.setProperty('--enter-delay',el.classList.contains('volume-card')?`${(i%4)*.1}s`:'0s');reveal.observe(el);});
   document.body.classList.add('motion-ready');
 }
 const globe=document.getElementById('intelligence-globe'),field=document.querySelector('.signal-field');
 const scenes=[globe,field].map(canvas=>({canvas,ctx:canvas.getContext('2d'),visible:false,w:1,h:1}));
 const resize=new ResizeObserver(entries=>{for(const e of entries){let s=scenes.find(s=>s.canvas===e.target);if(!s)continue;const d=Math.min(devicePixelRatio||1,1.75);s.w=e.contentRect.width;s.h=e.contentRect.height;s.canvas.width=Math.round(s.w*d);s.canvas.height=Math.round(s.h*d);s.ctx.setTransform(d,0,0,d,0,0);}draw();});
 scenes.forEach(s=>resize.observe(s.canvas));
 const visibility=new IntersectionObserver(entries=>{entries.forEach(e=>{scenes.find(s=>s.canvas===e.target).visible=e.isIntersecting;});wake();},{rootMargin:'80px'});scenes.forEach(s=>visibility.observe(s.canvas));
 // Low-detail continent silhouettes, intentionally schematic rather than a political map.
 const land=[
 [[-168,70],[-145,72],[-130,57],[-125,48],[-123,39],[-115,31],[-108,24],[-97,16],[-86,16],[-81,9],[-77,9],[-83,21],[-82,27],[-80,32],[-70,43],[-59,49],[-65,59],[-81,64],[-95,75],[-120,73]],
 [[-81,12],[-70,10],[-60,7],[-51,4],[-35,-6],[-40,-22],[-50,-29],[-56,-40],[-68,-55],[-74,-48],[-72,-30],[-78,-10]],
 [[-17,36],[-2,37],[11,37],[23,32],[35,31],[43,12],[51,11],[42,-2],[35,-20],[27,-34],[17,-34],[12,-18],[8,1],[-5,5],[-17,16]],
 [[-10,36],[-10,44],[-2,49],[7,54],[6,59],[18,71],[30,71],[42,67],[60,69],[85,74],[115,73],[143,62],[175,65],[180,51],[155,48],[140,38],[129,35],[121,22],[107,10],[104,1],[95,6],[90,22],[78,8],[69,23],[56,25],[49,13],[42,14],[36,30],[29,40],[19,40],[12,44],[3,42]],
 [[112,-11],[131,-11],[139,-16],[146,-16],[154,-25],[150,-37],[137,-39],[126,-33],[114,-35]],
 [[-53,60],[-43,60],[-22,72],[-24,82],[-45,84],[-62,76]],
 [[-8,50],[-5,59],[1,58],[2,51]],[[129,31],[135,34],[141,42],[145,44],[143,36]],[[47,-13],[51,-16],[47,-25],[44,-22]],[[167,-35],[177,-38],[173,-44],[166,-47]],[[96,5],[106,-6],[119,-8],[130,-4],[140,-8],[150,-5],[142,1],[119,1],[108,7]]
 ];
 const inside=(x,y,p)=>{let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if(((a[1]>y)!==(b[1]>y))&&(x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]))c=!c;}return c;};
 const rad=Math.PI/180;
 const vec=(lon,lat)=>[Math.cos(lat*rad)*Math.sin(lon*rad),Math.sin(lat*rad),Math.cos(lat*rad)*Math.cos(lon*rad)];
 const points=[];for(let lat=-56;lat<81;lat+=2.6){for(let lon=-180;lon<180;lon+=2.6/Math.max(.3,Math.cos(lat*rad))){if(land.some(p=>inside(lon,lat,p)))points.push(vec(lon,lat));}}
 const hubs=[[30,50],[-74,41],[-122,38],[-46,-23],[-.1,51],[13,52],[55,25],[104,1],[139,36],[151,-34],[18,-34]].map(p=>vec(...p));
 const arcs=hubs.slice(1).map(v=>{const a=hubs[0],pts=[];for(let i=0;i<=60;i++){let t=i/60,b=a.map((x,k)=>x*(1-t)+v[k]*t),l=Math.hypot(...b),height=1+Math.sin(t*Math.PI)*.22;pts.push(b.map(x=>x/l*height));}return pts;});
 const grid=[];
 for(let lat=-60;lat<=60;lat+=30){const row=[];for(let lon=-180;lon<=180;lon+=4)row.push(vec(lon,lat));grid.push(row);}
 for(let lon=0;lon<360;lon+=30){const row=[];for(let lat=-90;lat<=90;lat+=4)row.push(vec(lon,lat));grid.push(row);}
 let spinC=1,spinS=0;
 const project=v=>{const x=v[0]*spinC+v[2]*spinS,z=v[2]*spinC-v[0]*spinS;return [x,v[1]*.978-z*.208,v[1]*.208+z*.978];};
 function drawGlobe(s){
   const {ctx:g,w,h}=s;if(w<2||h<2)return;g.clearRect(0,0,w,h);const cx=w*.51,cy=h*.5,r=Math.min(w*.365,h*.34),rotation=-.55+clock*.045;spinC=Math.cos(rotation);spinS=Math.sin(rotation);
   let halo=g.createRadialGradient(cx,cy,r*.7,cx,cy,r*1.35);halo.addColorStop(0,'#1b689510');halo.addColorStop(.7,'#38b8d11b');halo.addColorStop(1,'#38b8d100');g.fillStyle=halo;g.fillRect(0,0,w,h);
   let ocean=g.createRadialGradient(cx-r*.3,cy-r*.3,r*.05,cx,cy,r);ocean.addColorStop(0,'#10293a');ocean.addColorStop(.7,'#091a27');ocean.addColorStop(1,'#102c3a');g.beginPath();g.arc(cx,cy,r,0,Math.PI*2);g.fillStyle=ocean;g.fill();g.strokeStyle='#74d9f13a';g.lineWidth=1;g.stroke();
   const path=(arr,color,width=1)=>{g.beginPath();let started=false;for(const v of arr){const p=project(v,rotation);if(p[2]<0){started=false;continue;}let x=cx+p[0]*r,y=cy-p[1]*r;if(started)g.lineTo(x,y);else g.moveTo(x,y);started=true;}g.strokeStyle=color;g.lineWidth=width;g.stroke();};
   grid.forEach(row=>path(row,'#7cbcd320',.7));
   for(const v of points){let p=project(v,rotation);if(p[2]<0)continue;g.globalAlpha=.2+p[2]*.73;g.fillStyle='#93d7e4';g.beginPath();g.arc(cx+p[0]*r,cy-p[1]*r,Math.max(.7,r*.0045)*(p[2]*.35+.65),0,Math.PI*2);g.fill();}g.globalAlpha=1;
   arcs.forEach((a,j)=>{
     path(a,'#74dec15c',.9);
     const phase=(clock*.065+j*.113)%1;
     for(let tail=14;tail>=0;tail--){const u=phase-tail*.004;if(u<0)continue;const n=u*60,i=Math.min(59,Math.floor(n)),f=n-i,v=a[i].map((x,k)=>x+(a[i+1][k]-x)*f),p=project(v);if(p[2]<0)continue;
       g.globalAlpha=(1-tail/15)*.95;g.fillStyle=j%3===0?'#a1caff':'#aaffdd';if(tail===0){g.shadowBlur=10;g.shadowColor='#87ffe0';}g.beginPath();g.arc(cx+p[0]*r,cy-p[1]*r,tail===0?2.5:1.4,0,Math.PI*2);g.fill();g.shadowBlur=0;
     }g.globalAlpha=1;
   });
   hubs.forEach((v,j)=>{const p=project(v,rotation);if(p[2]<.03)return;let x=cx+p[0]*r,y=cy-p[1]*r,pulse=(clock*.4+j*.2)%1;g.fillStyle=j?'#a6e6fa':'#bcffe4';g.beginPath();g.arc(x,y,j?2.2:3.5,0,Math.PI*2);g.fill();g.beginPath();g.arc(x,y,4+pulse*13,0,Math.PI*2);g.strokeStyle=`rgba(130,244,211,${(1-pulse)*.45})`;g.stroke();});
   g.strokeStyle='#8ee6e820';g.beginPath();g.ellipse(cx,cy,r*1.22,r*.29,-.32,0,Math.PI*2);g.stroke();
 }
 const stars=Array.from({length:65},(_,i)=>({x:((i*73.17)%100)/100,y:((i*39.31)%100)/100,s:.6+(i%3)*.5}));
 function drawField(s){const {ctx:g,w,h}=s;g.clearRect(0,0,w,h);stars.forEach((p,i)=>{let x=(p.x*w+clock*(2+i%3))%(w+20)-10,y=p.y*h+Math.sin(clock*.24+i)*12;g.globalAlpha=.2+(Math.sin(clock*.6+i)+1)*.18;g.fillStyle=i%4?'#9acbdc':'#91f4d5';g.fillRect(x,y,p.s,p.s);if(i%9===0){g.strokeStyle='#65b4c9';g.lineWidth=.5;g.beginPath();g.moveTo(x-8,y);g.lineTo(x+8,y);g.moveTo(x,y-8);g.lineTo(x,y+8);g.stroke();}});g.globalAlpha=1;}
 function draw(){scenes.forEach((s,i)=>{if(s.visible||paused)(i===0?drawGlobe:drawField)(s);});}
 function frame(now){raf=0;if(document.hidden)return;const dt=Math.min((now-last)/1000,.05);last=now;if(!paused){clock+=dt;cases.forEach(c=>{if(c.playing&&clock-c.at>2.8){c.step=(c.step+1)%6;c.at=clock;displayCase(c);}});}draw();if(!paused&&(scenes.some(s=>s.visible)||cases.some(c=>c.playing)))raf=requestAnimationFrame(frame);}
 function wake(){if(raf)return;last=performance.now();raf=requestAnimationFrame(frame);}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else wake();});
 // Continue case playback only while its panel is visible.
 const caseView=new IntersectionObserver(entries=>{entries.forEach(e=>{const c=cases.find(c=>c.el===e.target);if(!e.isIntersecting&&c.playing){c.playing=false;displayCase(c);}});},{threshold:.05});cases.forEach(c=>caseView.observe(c.el));
 wake();
})();
