(() => {
  'use strict';
  const canvas = document.getElementById('world'), ctx = canvas.getContext('2d');
  const mini = document.getElementById('minimap'), mctx = mini.getContext('2d');
  const COLS = 72, ROWS = 48, TYPES = ['deep','shallow','sand','grass','forest','mountain'];
  const colors = { deep:'#436c78', shallow:'#61928d', sand:'#d9c890', grass:'#8eae72', forest:'#557f58', mountain:'#84918a' };
  let seed = 82426;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const hash = (x,y) => { let n = (x*374761393+y*668265263+seed*982451653)|0; n=(n^(n>>>13))*1274126177; return ((n^(n>>>16))>>>0)/4294967295; };
  let grid = [], agents = [], kingdoms = [], fires = [], effects = [], events = [];
  let nextAgent = 1, nextKingdom = 1, day = 1, tick = 0, speed = 1, paused = false, activeTool = 'inspect', brush = 2;
  let canvasW=800,canvasH=500,dpr=1,scale=10,panX=0,panY=0, zoom=1, pointer={x:0,y:0,valid:false}, drawing=false, panning=false, lastBrushCell='', lastTick=0, toastTimer;
  const seasons=['Primavera','Verano','Otoño','Invierno'];
  const toolNames={inspect:'Mirar',raise:'Elevar terreno',lower:'Hundir terreno',forest:'Bosque plantado',water:'Agua nueva',villager:'Aldeano invocado',lightning:'Rayo divino',bomb:'Explosión',acid:'Lluvia ácida'};
  const at=(x,y)=>x>=0&&y>=0&&x<COLS&&y<ROWS?grid[y][x]:null;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  function makeCell(x,y){
    const nx=(x-COLS/2)/(COLS*.48), ny=(y-ROWS/2)/(ROWS*.49), r=Math.sqrt(nx*nx+ny*ny);
    const wave=Math.sin(x*.31+y*.14)*.045+Math.cos(y*.28-x*.11)*.035+(hash(x,y)-.5)*.11;
    const h=1-r+wave;
    let type=h<.04?'deep':h<.12?'shallow':h<.18?'sand':h>.68?'mountain':h>.43&&hash(x+71,y+19)>.29?'forest':'grass';
    if(type==='deep'&&h>.015)type='shallow';
    const elevation=type==='mountain'?2:type==='forest'||type==='grass'?1:0;
    return {type,elevation,tree:type==='forest'&&hash(x+80,y+90)>.17,food:hash(x+22,y+3)>.91?1:0,wood:0,stone:0,owner:0,burning:0,acid:0,house:null,texture:hash(x+seed,y-seed)};
  }
  function generateWorld(){
    seed=82426;grid=Array.from({length:ROWS},(_,y)=>Array.from({length:COLS},(_,x)=>makeCell(x,y)));
    // Broad, navigable landmasses with coves and a small eastern islet.
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      const nx=(x-COLS*.5)/(COLS*.47),ny=(y-ROWS*.5)/(ROWS*.48),r=Math.sqrt(nx*nx+ny*ny);
      if(x>COLS*.76&&y>ROWS*.48&&y<ROWS*.78&&Math.hypot((x-COLS*.83)/7,(y-ROWS*.64)/5)<1.02){grid[y][x].type=hash(x,y)>.82?'forest':'grass';grid[y][x].tree=hash(x+51,y)>.53;grid[y][x].elevation=1;continue;}
      if(r>.96&&grid[y][x].type!=='deep')grid[y][x].type='shallow';
      if(r>1.015)grid[y][x].type='deep';
    }
    agents=[];kingdoms=[];fires=[];effects=[];events=[];nextAgent=nextKingdom=1;day=1;tick=0;
    panX=panY=0;zoom=1;updateWorldStats();render();
  }
  function resize(){
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    dpr=Math.min(window.devicePixelRatio||1,2);canvasW=rect.width;canvasH=rect.height;
    canvas.width=Math.round(canvasW*dpr);canvas.height=Math.round(canvasH*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    scale=Math.min(canvasW/COLS,canvasH/ROWS)*.96*zoom;render();
  }
  function screenOrigin(){return {x:(canvasW-COLS*scale)/2+panX,y:(canvasH-ROWS*scale)/2+panY};}
  function toCell(px,py){const o=screenOrigin();return {x:Math.floor((px-o.x)/scale),y:Math.floor((py-o.y)/scale)};}
  function notify(text){const el=document.getElementById('toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),1650);}
  function addEvent(icon, message, dayLabel=`AÑO ${Math.floor((day-1)/360)+1} · DÍA ${((day-1)%360)+1}`){events.unshift({icon,message,time:dayLabel});events=events.slice(0,5);renderEvents();}
  function renderEvents(){document.getElementById('eventCount').textContent=String(events.length).padStart(2,'0');document.getElementById('eventList').innerHTML=events.map(e=>`<div class="event-item"><span class="event-time">${e.time}</span><div class="event-copy"><span class="event-icon">${e.icon}</span>${e.message}</div></div>`).join('')||'<div class="empty-state"><small>Los acontecimientos aparecerán aquí.</small></div>';}
  function updateWorldStats(){
    const land=grid.flat().filter(c=>c.type!=='deep'&&c.type!=='shallow').length;
    document.getElementById('landPercent').textContent=`${Math.round(land/(COLS*ROWS)*100)}%`;
    document.getElementById('population').innerHTML=`${agents.length} <small>almas</small>`;
    document.getElementById('kingdomCount').textContent=kingdoms.length;
    document.getElementById('villageCount').textContent=kingdoms.reduce((n,k)=>n+k.villages,0);
    document.getElementById('treeCount').textContent=grid.flat().filter(c=>c.tree).length;
    document.getElementById('foodCount').textContent=grid.flat().reduce((n,c)=>n+c.food,0);
    document.getElementById('fireCount').textContent=fires.length;
    document.getElementById('popMeter').style.width=`${Math.min(100,agents.length/50*100)}%`;
    document.getElementById('seasonText').textContent=`${seasons[Math.floor((day-1)/90)%4]}, año ${Math.floor((day-1)/360)+1}`;
    const list=document.getElementById('kingdomList');
    if(!kingdoms.length)list.innerHTML='<div class="empty-state"><span>⚑</span><b>Una historia por escribir</b><small>Invoca aldeanos para fundar el primer reino.</small></div>';
    else list.innerHTML=kingdoms.slice(0,4).map(k=>`<div class="kingdom-item"><i class="kingdom-swatch" style="background:${k.color}"></i><div class="kingdom-info"><b>${k.name}</b><small>${k.villages} aldea${k.villages===1?'':'s'} · ${agents.filter(a=>a.kingdom===k.id).length} habitantes</small></div><span class="kingdom-size">${k.tiles}◈</span></div>`).join('');
  }
  function terrainAt(x,y){return at(Math.floor(x),Math.floor(y));}
  function spawnAgent(x,y,kingdom=0){
    let c=at(x,y);if(!c||['deep','shallow','mountain'].includes(c.type)){const p=findLand(x,y,6);if(!p)return null;x=p.x;y=p.y;c=at(x,y);}
    const a={id:nextAgent++,x:x+.5,y:y+.5,tx:x+.5,ty:y+.5,kingdom,health:100,hunger:rand()*22,age:18+rand()*12,state:'idle',cooldown:0,carrying:0,skin:['#e8b990','#c98e69','#efc9a6'][Math.floor(rand()*3)],shirt:kingdom?kingdomById(kingdom)?.color:'#84916d',gender:rand()<.5?'♀':'♂',walk:rand()*7};
    agents.push(a);return a;
  }
  function findLand(x,y,radius){for(let r=0;r<=radius;r++)for(let yy=Math.max(0,y-r);yy<=Math.min(ROWS-1,y+r);yy++)for(let xx=Math.max(0,x-r);xx<=Math.min(COLS-1,x+r);xx++){if(Math.max(Math.abs(xx-x),Math.abs(yy-y))!==r)continue;const c=at(xx,yy);if(c&&['grass','forest','sand'].includes(c.type))return{x:xx,y:yy};}return null;}
  function kingdomById(id){return kingdoms.find(k=>k.id===id);}
  function foundKingdom(x,y,members){
    const id=nextKingdom++,palette=['#c67e63','#728daa','#ab8bb4','#d1a353','#649886'];
    const names=['Brumaverde','Valle de Nácar','Eirwood','Lúmina','Piedralba','Solaria','Monte Claro','Islas de Eira'];
    const k={id,name:names[(id-1)%names.length],x,y,color:palette[(id-1)%palette.length],villages:1,tiles:0,wood:0,stone:0,food:0};kingdoms.push(k);
    members.forEach(a=>{a.kingdom=id;a.shirt=k.color;});
    for(let yy=Math.max(0,y-1);yy<=Math.min(ROWS-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(COLS-1,x+1);xx++){const c=at(xx,yy);if(c&&c.type==='grass'&&!c.house){c.house={kingdom:id};break;}}
    addEvent('⚑',`<b>${k.name}</b> se ha fundado junto a la costa.`);notify(`¡Ha nacido ${k.name}!`);updateWorldStats();
  }
  function foundPendingGroups(){
    const pending=agents.filter(a=>!a.kingdom);if(pending.length<3)return;
    const start=pending[0],group=pending.filter(a=>distance(a,start)<9);
    if(group.length>=3){const p={x:Math.round(group.reduce((n,a)=>n+a.x,0)/group.length),y:Math.round(group.reduce((n,a)=>n+a.y,0)/group.length)};foundKingdom(Math.floor(p.x),Math.floor(p.y),group);}
  }
  function chooseTarget(a){
    const c=terrainAt(a.x,a.y);if(a.hunger>62){let best=null,score=1e9;for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const t=at(x,y);if(t.food&&distance(a,{x:x+.5,y:y+.5})<score){best={x:x+.5,y:y+.5,kind:'food'};score=distance(a,{x:x+.5,y:y+.5});}}if(best)return best;}
    if(a.kingdom){const k=kingdomById(a.kingdom);if(k){if(k.wood<5){let best=null,score=12;for(let y=1;y<ROWS-1;y++)for(let x=1;x<COLS-1;x++){const t=at(x,y),d=distance(a,{x:x+.5,y:y+.5});if(t.tree&&d<score){best={x:x+.5,y:y+.5,kind:'wood'};score=d;}}if(best)return best;}
      if(k.wood>=4&&!c?.house){const homes=grid.flat().filter(t=>t.house&&t.house.kingdom===k.id).length;if(homes<5&&rand()<.55)return{x:k.x+.5,y:k.y+.5,kind:'build'};}}
    }
    for(let tries=0;tries<12;tries++){const dx=Math.floor(rand()*13)-6,dy=Math.floor(rand()*13)-6,x=Math.max(1,Math.min(COLS-2,Math.round(a.x)+dx)),y=Math.max(1,Math.min(ROWS-2,Math.round(a.y)+dy)),t=at(x,y);if(t&&!['deep','shallow','mountain'].includes(t.type))return{x:x+.5,y:y+.5,kind:'wander'};}
    return null;
  }
  function stepAgents(dt){
    for(const a of [...agents]){
      a.age+=dt/16000;a.hunger=Math.min(100,a.hunger+dt*.005);a.cooldown-=dt;a.walk+=dt*.008;
      if(a.health<=0||a.age>90){agents=agents.filter(b=>b!==a);if(a.kingdom)addEvent('†',`Un aldeano de <b>${kingdomById(a.kingdom)?.name||'un reino'}</b> ha partido.`);continue;}
      const here=terrainAt(a.x,a.y);if(here?.food&&a.hunger>38){here.food=0;a.hunger=Math.max(0,a.hunger-55);a.state='comiendo';a.cooldown=500;}
      if(a.cooldown>0)continue;
      const dist=Math.hypot(a.tx-a.x,a.ty-a.y);
      if(dist>.08){const step=Math.min(dist,dt*.0017);a.x+=(a.tx-a.x)/dist*step;a.y+=(a.ty-a.y)/dist*step;}
      else{
        const targetKind=a.targetKind;a.targetKind='';
        if(targetKind==='wood'){const c=terrainAt(a.x,a.y);if(c?.tree){c.tree=false;const k=kingdomById(a.kingdom);if(k)k.wood++;a.state='recolectando';a.cooldown=800;} }
        if(targetKind==='food'){const c=terrainAt(a.x,a.y);if(c?.food){c.food=0;a.hunger=Math.max(0,a.hunger-65);a.state='comiendo';a.cooldown=650;}}
        if(targetKind==='build'){const k=kingdomById(a.kingdom),x=Math.floor(a.x),y=Math.floor(a.y);if(k&&k.wood>=4){const c=at(x,y);if(c&&['grass','forest'].includes(c.type)&&!c.house){c.house={kingdom:k.id};k.wood-=4;k.villages++;a.state='construyendo';addEvent('⌂',`<b>${k.name}</b> ha levantado una nueva vivienda.`);}}}
        if(a.state!=='comiendo'&&a.state!=='construyendo'&&a.state!=='recolectando')a.state='explorando';
        if(a.kingdom&&a.age>23&&a.hunger<32&&rand()<.013&&agents.length<50){const p=findLand(Math.round(a.x+rand()*4-2),Math.round(a.y+rand()*4-2),4);if(p){const child=spawnAgent(p.x,p.y,a.kingdom);if(child){child.age=0;child.hunger=5;addEvent('♡',`Una nueva vida llega a <b>${kingdomById(a.kingdom)?.name}</b>.`);}}}
        const target=chooseTarget(a);if(target){a.tx=target.x;a.ty=target.y;a.targetKind=target.kind;a.state=target.kind==='food'?'buscando comida':target.kind==='wood'?'recolectando madera':target.kind==='build'?'construyendo':'explorando';}
      }
    }
    // Kingdoms claim nearby fertile cells and can clash at overlapping frontiers.
    for(const k of kingdoms){let count=0;for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const c=at(x,y),d=Math.hypot(x-k.x,y-k.y);if(d<4.2&&c&&!['deep','shallow','mountain'].includes(c.type)){if(!c.owner||c.owner===k.id)c.owner=k.id;if(c.owner===k.id)count++;}}k.tiles=count;}
    foundPendingGroups();
  }
  function spreadFire(){
    const fresh=[];for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const c=at(x,y);if(c.burning>0){c.burning--;if(c.type==='shallow'||c.type==='deep'){c.burning=0;continue;}if(c.tree&&rand()<.025){c.tree=false;}if(c.burning>0)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const n=at(x+dx,y+dy);if(n?.tree&&!n.burning&&rand()<.075)n.burning=3+rand()*4;}for(const a of agents)if(Math.hypot(a.x-(x+.5),a.y-(y+.5))<.8)a.health-=15;}}
    fires=grid.flat().filter(c=>c.burning>0);
  }
  function simulate(){
    if(paused)return;tick++;day+=speed*.18;stepAgents(80*speed);if(tick%4===0)spreadFire();
    // Native forest growth and berry regrowth keep the ecosystem replenishable.
    if(tick%14===0){for(let i=0;i<6;i++){const x=Math.floor(rand()*COLS),y=Math.floor(rand()*ROWS),c=at(x,y);if(c&&c.type==='grass'&&!c.tree&&rand()<.22)c.tree=true;if(c&&c.type==='grass'&&!c.food&&rand()<.18)c.food=1;}}
    if(tick%5===0)updateWorldStats();
  }
  function paintCell(x,y,c,ox,oy){
    const px=ox+x*scale,py=oy+y*scale,s=scale;
    ctx.fillStyle=colors[c.type];ctx.fillRect(px,py,s+.25,s+.25);
    // Quiet terrain grain gives the pixel-island map a tactile, hand-painted feel.
    const h=hash(x,y);if(c.type==='deep'||c.type==='shallow'){
      ctx.strokeStyle=c.type==='deep'?'#9cc0bc42':'#c3d6b74d';ctx.lineWidth=Math.max(.65,s*.045);ctx.beginPath();const wx=px+s*(.2+(h*.55)),wy=py+s*(.24+hash(x+9,y+8)*.55);ctx.moveTo(wx,wy);ctx.quadraticCurveTo(wx+s*.18,wy-s*.06,wx+s*.36,wy+s*.01);ctx.stroke();
    }else{
      if(c.type==='grass'&&h>.83){ctx.strokeStyle='#e2e8b755';ctx.lineWidth=Math.max(.6,s*.035);ctx.beginPath();ctx.moveTo(px+s*.22,py+s*.72);ctx.lineTo(px+s*.25,py+s*.5);ctx.moveTo(px+s*.28,py+s*.68);ctx.lineTo(px+s*.34,py+s*.52);ctx.stroke();}
      if(c.type==='mountain'){ctx.fillStyle='#d9ded0';ctx.beginPath();ctx.moveTo(px+s*.16,py+s*.79);ctx.lineTo(px+s*.52,py+s*.18);ctx.lineTo(px+s*.83,py+s*.78);ctx.closePath();ctx.fill();ctx.fillStyle='#a6afa2';ctx.beginPath();ctx.moveTo(px+s*.52,py+s*.18);ctx.lineTo(px+s*.83,py+s*.78);ctx.lineTo(px+s*.57,py+s*.72);ctx.closePath();ctx.fill();ctx.fillStyle='#f6f5e8';ctx.beginPath();ctx.moveTo(px+s*.52,py+s*.18);ctx.lineTo(px+s*.65,py+s*.45);ctx.lineTo(px+s*.53,py+s*.4);ctx.lineTo(px+s*.4,py+s*.48);ctx.closePath();ctx.fill();}
      if(c.type==='sand'&&h>.65){ctx.fillStyle='#bcae7c77';ctx.beginPath();ctx.arc(px+s*.35,py+s*.6,s*.055,0,Math.PI*2);ctx.arc(px+s*.72,py+s*.29,s*.04,0,Math.PI*2);ctx.fill();}
    }
    if(c.owner){const k=kingdomById(c.owner);if(k){ctx.fillStyle=k.color+'20';ctx.fillRect(px,py,s,s);}}
    if(c.acid>0){ctx.fillStyle='#a4c95758';ctx.fillRect(px,py,s,s);}
    if(c.tree){const r=s*.32,tx=px+s*.5,ty=py+s*.49;ctx.fillStyle='#294c3850';ctx.beginPath();ctx.ellipse(tx+s*.04,ty+s*.31,r*1.14,r*.39,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#705e3b';ctx.fillRect(tx-s*.045,ty+s*.12,s*.09,s*.21);ctx.fillStyle='#365f43';ctx.beginPath();ctx.arc(tx,ty,r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#638d55';ctx.beginPath();ctx.arc(tx-r*.22,ty-r*.18,r*.67,0,Math.PI*2);ctx.fill();ctx.fillStyle='#9cb978';ctx.beginPath();ctx.arc(tx-r*.3,ty-r*.37,r*.2,0,Math.PI*2);ctx.fill();}
    if(c.food){ctx.fillStyle='#bf5c4c';ctx.beginPath();ctx.arc(px+s*.68,py+s*.7,s*.1,0,Math.PI*2);ctx.fill();ctx.fillStyle='#e7c773';ctx.beginPath();ctx.arc(px+s*.43,py+s*.66,s*.075,0,Math.PI*2);ctx.fill();}
    if(c.house){const hx=px+s*.5,hy=py+s*.55,hw=s*.65;ctx.fillStyle='#4b4d3e50';ctx.fillRect(hx-hw*.48,hy-hw*.02,hw,hw*.47);ctx.fillStyle='#d6ba83';ctx.fillRect(hx-hw*.44,hy-hw*.18,hw*.88,hw*.62);ctx.fillStyle='#946f53';ctx.beginPath();ctx.moveTo(hx-hw*.56,hy-hw*.2);ctx.lineTo(hx,hy-hw*.65);ctx.lineTo(hx+hw*.56,hy-hw*.2);ctx.closePath();ctx.fill();ctx.fillStyle='#805f47';ctx.fillRect(hx-hw*.09,hy+hw*.08,hw*.19,hw*.36);const k=kingdomById(c.house.kingdom);if(k){ctx.fillStyle=k.color;ctx.fillRect(hx+hw*.17,hy-hw*.42,hw*.045,hw*.25);ctx.fillStyle=k.color;ctx.beginPath();ctx.moveTo(hx+hw*.2,hy-hw*.42);ctx.lineTo(hx+hw*.5,hy-hw*.35);ctx.lineTo(hx+hw*.2,hy-hw*.26);ctx.fill();}}
    if(c.burning>0){const t=performance.now()/120;ctx.fillStyle='#f7a43c';ctx.beginPath();ctx.ellipse(px+s*.5,py+s*.52,s*.18,s*(.26+Math.sin(t+x+y)*.04),0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffe18a';ctx.beginPath();ctx.ellipse(px+s*.5,py+s*.57,s*.08,s*.13,0,0,Math.PI*2);ctx.fill();}
    ctx.strokeStyle=c.type==='deep'?'#d1e2d522':'#f3f2d520';ctx.lineWidth=.55;ctx.strokeRect(px,py,s,s);
  }
  function drawAgent(a,ox,oy){
    const x=ox+a.x*scale,y=oy+a.y*scale,r=Math.max(2.4,scale*.18),step=Math.sin(a.walk)*scale*.04;
    ctx.fillStyle='#35453540';ctx.beginPath();ctx.ellipse(x,y+r*1.2,r*1.3,r*.48,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#5e5145';ctx.lineWidth=Math.max(1,scale*.055);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x-r*.35,y+r*.48);ctx.lineTo(x-r*.35+step,y+r*1.03);ctx.moveTo(x+r*.35,y+r*.48);ctx.lineTo(x+r*.35-step,y+r*1.03);ctx.stroke();
    ctx.fillStyle=a.shirt;ctx.beginPath();ctx.ellipse(x,y+r*.12,r*.8,r*.8,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=a.skin;ctx.beginPath();ctx.arc(x,y-r*.72,r*.48,0,Math.PI*2);ctx.fill();
    if(scale>11&&a.kingdom){ctx.fillStyle=kingdomById(a.kingdom)?.color||'#fff';ctx.fillRect(x-2,y-r*1.65,4,2);}
  }
  function drawEffects(){const now=performance.now();effects=effects.filter(e=>now-e.start<e.life);for(const e of effects){const p=(now-e.start)/e.life;ctx.globalAlpha=1-p;if(e.kind==='lightning'){ctx.strokeStyle='#fff4a8';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(e.x-5,e.y-25);ctx.lineTo(e.x+2,e.y-8);ctx.lineTo(e.x-4,e.y-8);ctx.lineTo(e.x+7,e.y+7);ctx.stroke();ctx.fillStyle='#ffe987';ctx.beginPath();ctx.arc(e.x,e.y,9*(1-p),0,Math.PI*2);ctx.fill();}else{ctx.strokeStyle=e.kind==='bomb'?'#eea664':'#bbda75';ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,e.radius*p,0,Math.PI*2);ctx.stroke();}ctx.globalAlpha=1;}}
  function render(){
    if(!ctx||!grid.length)return;ctx.clearRect(0,0,canvasW,canvasH);ctx.fillStyle='#436c78';ctx.fillRect(0,0,canvasW,canvasH);
    const o=screenOrigin();
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)paintCell(x,y,grid[y][x],o.x,o.y);
    // Soft boundary marks make claimed land legible without obscuring terrain.
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const c=at(x,y);if(!c?.owner)continue;const k=kingdomById(c.owner);if(!k)continue;const px=o.x+x*scale,py=o.y+y*scale;ctx.strokeStyle=k.color+'aa';ctx.lineWidth=Math.max(1,scale*.045);if(at(x,y-1)?.owner!==c.owner){ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+scale,py);ctx.stroke();}if(at(x,y+1)?.owner!==c.owner){ctx.beginPath();ctx.moveTo(px,py+scale);ctx.lineTo(px+scale,py+scale);ctx.stroke();}if(at(x-1,y)?.owner!==c.owner){ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px,py+scale);ctx.stroke();}if(at(x+1,y)?.owner!==c.owner){ctx.beginPath();ctx.moveTo(px+scale,py);ctx.lineTo(px+scale,py+scale);ctx.stroke();}}
    agents.forEach(a=>drawAgent(a,o.x,o.y));drawEffects();
    if(pointer.valid){const c=toCell(pointer.x,pointer.y);if(c.x>=0&&c.y>=0&&c.x<COLS&&c.y<ROWS){ctx.strokeStyle=activeTool==='inspect'?'#ffffffb5':'#fffde6';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(o.x+(c.x+.5)*scale,o.y+(c.y+.5)*scale,Math.max(scale*.45,brush*scale*.72),0,Math.PI*2);ctx.stroke();ctx.fillStyle='#ffffff10';ctx.fill();}}
    drawMinimap();
  }
  function drawMinimap(){if(!grid.length)return;const w=mini.width,h=mini.height,sx=w/COLS,sy=h/ROWS;mctx.clearRect(0,0,w,h);for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const c=at(x,y);mctx.fillStyle=c.owner?(kingdomById(c.owner)?.color||colors[c.type]):colors[c.type];mctx.fillRect(x*sx,y*sy,sx+.3,sy+.3);}for(const a of agents){mctx.fillStyle='#fff';mctx.fillRect(a.x*sx-1,a.y*sy-1,2,2);}}
  function usePower(cx,cy){
    if(cx<0||cy<0||cx>=COLS||cy>=ROWS)return;
    if(activeTool==='inspect'){inspectCell(cx,cy);return;}
    const o=screenOrigin(),px=o.x+(cx+.5)*scale,py=o.y+(cy+.5)*scale,r=brush;
    if(activeTool==='lightning'){
      const c=at(cx,cy);if(c){c.burning=Math.max(c.burning,5);if(c.tree)c.tree=false;}
      let hit=0;for(const a of agents)if(Math.hypot(a.x-(cx+.5),a.y-(cy+.5))<1.6){a.health-=100;hit++;}
      effects.push({kind:'lightning',x:px,y:py,start:performance.now(),life:480});addEvent('ϟ',hit?`Un rayo divino ha alcanzado a ${hit} habitante${hit===1?'':'s'}.`:'Un relámpago ilumina el horizonte.');notify('El cielo responde a tu llamada.');return;
    }
    if(activeTool==='bomb'){
      for(let y=Math.max(0,cy-r-2);y<=Math.min(ROWS-1,cy+r+2);y++)for(let x=Math.max(0,cx-r-2);x<=Math.min(COLS-1,cx+r+2);x++){const d=Math.hypot(x-cx,y-cy),c=at(x,y);if(d>r+1.4)continue;if(d<r*.72){c.type='shallow';c.tree=false;c.food=0;c.house=null;c.owner=0;c.burning=0;}else if(c.tree){c.tree=false;c.burning=0;}}
      agents=agents.filter(a=>Math.hypot(a.x-(cx+.5),a.y-(cy+.5))>r+1);effects.push({kind:'bomb',x:px,y:py,radius:scale*(r+2),start:performance.now(),life:620});addEvent('✹','Una explosión transforma el paisaje.');notify('¡BOOM! La tierra tiembla.');return;
    }
    if(activeTool==='acid'){let affected=0;for(let y=Math.max(0,cy-r);y<=Math.min(ROWS-1,cy+r);y++)for(let x=Math.max(0,cx-r);x<=Math.min(COLS-1,cx+r);x++){if(Math.hypot(x-cx,y-cy)>r+.25)continue;const c=at(x,y);c.acid=16;if(c.tree&&rand()<.72)c.tree=false;affected++;}for(const a of agents)if(Math.hypot(a.x-(cx+.5),a.y-(cy+.5))<r+1)a.health-=15;effects.push({kind:'acid',x:px,y:py,radius:scale*(r+1),start:performance.now(),life:1000});addEvent('☂','Una nube de lluvia ácida cubre el territorio.');notify('La lluvia ácida consume el bosque.');return;}
    if(activeTool==='villager'){
      const kingdom=kingdoms.map(k=>({k,d:Math.hypot(k.x-cx,k.y-cy)})).sort((a,b)=>a.d-b.d)[0];
      const member=kingdom&&kingdom.d<11?kingdom.k.id:0;const a=spawnAgent(cx,cy,member);
      if(!a){notify('Busca tierra fértil para invocar.');return;}
      if(member)addEvent('♟',`Un aldeano llega a <b>${kingdomById(member).name}</b>.`);else addEvent('♟','Un viajero solitario ha llegado a las islas.');
      document.getElementById('introTip').classList.add('hidden');notify(member?`Un habitante se une a ${kingdomById(member).name}.`:'Un aldeano ha llegado.');updateWorldStats();return;
    }
    let changed=0;
    for(let y=Math.max(0,cy-r);y<=Math.min(ROWS-1,cy+r);y++)for(let x=Math.max(0,cx-r);x<=Math.min(COLS-1,cx+r);x++){
      if(Math.hypot(x-cx,y-cy)>r+.25)continue;const c=at(x,y);
      if(activeTool==='forest'){if(c.type==='grass'||c.type==='sand'){c.type='forest';c.tree=true;c.elevation=1;changed++;}}
      if(activeTool==='water'){if(c.type!=='deep'){c.type=c.type==='shallow'?'deep':'shallow';c.tree=false;c.food=0;c.burning=0;c.acid=0;changed++;}}
      if(activeTool==='raise'){if(c.type==='deep'||c.type==='shallow'){c.type='sand';c.elevation=0;}else if(c.type==='sand'){c.type='grass';c.elevation=1;}else if(c.type==='grass'||c.type==='forest'){c.type='mountain';c.tree=false;c.elevation=2;}changed++;}
      if(activeTool==='lower'){if(c.type==='mountain'){c.type='grass';c.elevation=1;}else if(c.type==='grass'||c.type==='forest'){c.type='sand';c.tree=false;c.elevation=0;}else if(c.type==='sand'){c.type='shallow';c.elevation=0;}changed++;}
    }
    if(changed&&activeTool==='forest')notify('Semillas al viento. Un bosque empieza a crecer.');
    else if(changed&&activeTool==='water')notify('El agua fluye y apaga las llamas.');
    else if(changed&&(activeTool==='raise'||activeTool==='lower'))notify('La tierra se mueve bajo tu mano.');
  }
  function inspectCell(x,y){
    const c=at(x,y);if(!c)return;const person=agents.find(a=>Math.hypot(a.x-(x+.5),a.y-(y+.5))<.8);
    if(person){const k=kingdomById(person.kingdom);notify(`${person.gender} Habitante · ${person.state} · Salud ${Math.max(0,Math.round(person.health))}%${k?' · '+k.name:''}`);return;}
    const names={deep:'Agua profunda',shallow:'Agua poco profunda',sand:'Arena',grass:'Pradera',forest:'Bosque',mountain:'Montaña'};
    const kingdom=kingdomById(c.owner);notify(`${names[c.type]}${c.tree?' · Árboles':''}${c.food?' · Alimento':''}${kingdom?' · '+kingdom.name:''}`);
  }
  function pointerPosition(e){const rect=canvas.getBoundingClientRect();return{x:e.clientX-rect.left,y:e.clientY-rect.top};}
  canvas.addEventListener('pointermove',e=>{
    const p=pointerPosition(e);pointer={...p,valid:true};const cell=toCell(p.x,p.y);document.getElementById('cursorCoords').textContent=cell.x>=0&&cell.y>=0&&cell.x<COLS&&cell.y<ROWS?`${String(cell.x).padStart(2,'0')}, ${String(cell.y).padStart(2,'0')}`:'—, —';
    if(panning){panX+=p.x-pointer.lastX;panY+=p.y-pointer.lastY;pointer.lastX=p.x;pointer.lastY=p.y;}
    else if(drawing){const key=`${cell.x},${cell.y}`;if(key!==lastBrushCell){lastBrushCell=key;usePower(cell.x,cell.y);}}
  });
  canvas.addEventListener('pointerleave',()=>{if(!drawing&&!panning)pointer.valid=false;});
  canvas.addEventListener('pointerdown',e=>{e.preventDefault();canvas.setPointerCapture(e.pointerId);const p=pointerPosition(e);pointer={...p,valid:true,lastX:p.x,lastY:p.y};if(e.button===1||e.button===2||e.getModifierState?.(' ')){panning=true;return;}drawing=true;lastBrushCell='';const cell=toCell(p.x,p.y);usePower(cell.x,cell.y);lastBrushCell=`${cell.x},${cell.y}`;});
  const endPointer=()=>{drawing=false;panning=false;lastBrushCell='';};canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.65,Math.min(2.4,zoom*(e.deltaY<0?1.12:.89)));resize();document.getElementById('zoomReadout').textContent=`${Math.round(zoom*100)}%`;},{passive:false});
  function selectTool(name){activeTool=name;document.querySelectorAll('.tool-btn').forEach(b=>b.classList.toggle('active',b.dataset.tool===name));canvas.style.cursor=name==='inspect'?'crosshair':'cell';document.getElementById('introTip').classList.add('hidden');}
  document.getElementById('toolList').addEventListener('click',e=>{const btn=e.target.closest('.tool-btn');if(btn)selectTool(btn.dataset.tool);});
  document.getElementById('brushSize').addEventListener('input',e=>{brush=Number(e.target.value);document.getElementById('brushValue').textContent=brush;});
  document.querySelectorAll('.speed-btn').forEach(btn=>btn.addEventListener('click',()=>{speed=Number(btn.dataset.speed);document.querySelectorAll('.speed-btn').forEach(b=>b.classList.toggle('active',b===btn));}));
  document.getElementById('pauseBtn').addEventListener('click',()=>{paused=!paused;document.getElementById('pauseBtn').textContent=paused?'▶':'Ⅱ';notify(paused?'Simulación pausada':'El mundo vuelve a respirar.');});
  document.getElementById('regenBtn').addEventListener('click',()=>{generateWorld();notify('Un nuevo mundo ha nacido.');});
  document.getElementById('zoomIn').addEventListener('click',()=>{zoom=Math.min(2.4,zoom*1.15);resize();document.getElementById('zoomReadout').textContent=`${Math.round(zoom*100)}%`;});
  document.getElementById('zoomOut').addEventListener('click',()=>{zoom=Math.max(.65,zoom/1.15);resize();document.getElementById('zoomReadout').textContent=`${Math.round(zoom*100)}%`;});
  document.getElementById('centerBtn').addEventListener('click',()=>{panX=panY=0;zoom=1;resize();document.getElementById('zoomReadout').textContent='100%';});
  document.getElementById('dismissTip').addEventListener('click',()=>document.getElementById('introTip').classList.add('hidden'));
  document.getElementById('helpBtn').addEventListener('click',()=>document.getElementById('modalBackdrop').classList.add('open'));
  document.getElementById('modalClose').addEventListener('click',()=>document.getElementById('modalBackdrop').classList.remove('open'));
  document.getElementById('startPlaying').addEventListener('click',()=>document.getElementById('modalBackdrop').classList.remove('open'));
  document.getElementById('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')e.currentTarget.classList.remove('open');});
  document.getElementById('soundBtn').addEventListener('click',()=>notify('El mundo permanece en silencio por ahora.'));
  document.getElementById('saveBtn').addEventListener('click',()=>{try{localStorage.setItem('verdant-save',JSON.stringify({seed,grid,agents,kingdoms,day,nextAgent,nextKingdom}));notify('Mundo guardado en este dispositivo.');}catch{notify('No se pudo guardar en este navegador.');}});
  document.getElementById('showAll').addEventListener('click',()=>notify(kingdoms.length?`${kingdoms.length} reino${kingdoms.length===1?'':'s'} habitan este mundo.`:'Aún no existen reinos.'));
  window.addEventListener('keydown',e=>{if(e.target.matches('input,textarea'))return;const key=e.key.toLowerCase();const mapping={v:'inspect','1':'raise','2':'lower','3':'forest','4':'water','5':'villager','6':'lightning','7':'bomb','8':'acid'};if(mapping[key])selectTool(mapping[key]);if(e.code==='Space'){e.preventDefault();document.getElementById('pauseBtn').click();}if(key==='escape')document.getElementById('modalBackdrop').classList.remove('open');});
  window.addEventListener('resize',resize);
  let lastFrame=0;function frame(now){if(now-lastFrame>70){render();lastFrame=now;}requestAnimationFrame(frame);}
  generateWorld();resize();addEvent('✦','El mundo de <b>Eira</b> aguarda a su creador.');setInterval(simulate,150);requestAnimationFrame(frame);
})();
