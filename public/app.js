'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = 960, H = 720;
  const F = { l:92, r:868, t:118, b:633 };
  const ICONS = { lion:'\ud83e\udd81', elephant:'\ud83d\udc18', monkey:'\ud83d\udc12', hippo:'\ud83e\udd9b' };
  const POCKETS = [
    {side:'top', c:264, span:52, effect:'ice'},
    {side:'top', c:696, span:52, effect:'hammer'},
    {side:'bottom', c:264, span:52, effect:'laser'},
    {side:'bottom', c:696, span:52, effect:'water'},
    {side:'left', c:377, span:63, effect:'fire'},
    {side:'right', c:377, span:63, effect:'spark'}
  ];
  const TAU=Math.PI*2;
  let species='lion', session=null, current=null, es=null, pollTimer=null, lastSeq=-1;
  let drag=null, hoverPiece=null, audioEnabled=true, audioCtx=null, musicTimer=null, musicStep=0;
  const positions=new Map(), effects=[], seenEvents=new Set();
  let toastTimeout=null, sceneMode='preview';
  const demo = {game:{pieces:[],phase:'playing',turn:0,remaining:[6,6],shots:0,events:[]},players:[{name:'Sunny',species:'lion'},{name:'Moon',species:'hippo'}],phase:'playing'};
  const Y=[186,260,334,408,482,556];
  for(let i=0;i<6;i++){
    demo.game.pieces.push({id:'p0-'+i,owner:0,x:i%2?328:245,y:Y[i],vx:0,vy:0,alive:true});
    demo.game.pieces.push({id:'p1-'+i,owner:1,x:i%2?632:715,y:Y[i],vx:0,vy:0,alive:true});
  }
  let roomState=demo;

  function showToast(msg) {
    $('toast').textContent=msg; $('toast').classList.add('show');
    clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('show'),3400);
  }
  function fmtName(name) { return String(name||'Dschungelheld'); }
  function send(method,url,body) {
    return fetch(url,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'})
      .then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||'Netzwerkfehler');return data;});
  }
  function inviteURL(code) {return `${location.origin}/?room=${encodeURIComponent(code)}`;}
  function setURL(code) {history.replaceState({},'',code?'/?room='+encodeURIComponent(code):'/');}
  function choosingSpecies() {
    document.querySelectorAll('.species-choice').forEach(btn => {
      btn.addEventListener('click',()=>{
        species=btn.dataset.species;
        document.querySelectorAll('.species-choice').forEach(b=>{
          const active=b===btn;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));
        });
        startAudio();sfx('select');
      });
    });
  }
  async function create(local=false) {
    try {
      startAudio();sfx('select');setButtonsBusy(true);
      const result=await send('POST','/api/rooms',{name:$('playerName').value.trim()||'Dschungelheld',species,local});
      enter(result);
      showToast(local?'Lokales Duell gestartet!':'Raum erstellt. Schicke den Einladungslink an deinen Freund.');
    } catch(e){showToast(e.message);} finally{setButtonsBusy(false);}
  }
  async function join() {
    const code=$('roomCode').value.trim().toUpperCase();
    if(!/^[A-Z2-9]{6}$/.test(code)){showToast('Bitte gib einen gueltigen 6-stelligen Raumcode ein.');return;}
    try {
      startAudio();setButtonsBusy(true);
      const result=await send('POST',`/api/rooms/${code}/join`,{name:$('playerName').value.trim()||'Dschungelheld',species});
      enter(result);showToast('Du bist dabei. Viel Spass beim Duell!');sfx('join');
    }catch(e){showToast(e.message);}finally{setButtonsBusy(false);}
  }
  function setButtonsBusy(busy) {$('createRoom').disabled=busy;$('joinRoom').disabled=busy;$('localRoom').disabled=busy;}
  function enter(res) {
    session={code:res.code,token:res.token,seat:res.seat,local:res.local};
    localStorage.setItem('zoopaloola_rev_session',JSON.stringify(session));
    setURL(res.code);
    $('lobbyPanel').classList.add('hidden');$('gamePanel').classList.remove('hidden');
    $('currentRoomCode').textContent=res.code;$('roomType').textContent=res.local?'LOKAL':'PRIVAT';
    $('copyInvite').classList.toggle('hidden',res.local);
    $('inviteHint').textContent=res.local?'Zwei Spieler am selben Geraet wechseln sich ab.':'Teile den Link mit deinem Freund auf Discord.';
    $('gameCanvas').classList.add('interactive');
    sceneMode='game';applyState(res);
    startUpdates();
  }
  function reset(forget=false) {
    if(es){es.close();es=null;}
    if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}
    session=null;current=null;lastSeq=-1;seenEvents.clear();drag=null;positions.clear();sceneMode='preview';roomState=demo;
    if(forget)localStorage.removeItem('zoopaloola_rev_session');
    $('gamePanel').classList.add('hidden');$('lobbyPanel').classList.remove('hidden');
    $('gameCanvas').classList.remove('interactive');$('arenaStatus').textContent='SPIELVORSCHAU';
    setURL('');updateScoreboard(demo);updateOverlay();
  }
  function applyState(data) {
    if(!session || data.code!==session.code)return;
    if(data.seq!==undefined && data.seq<lastSeq)return;
    if(data.seq!==undefined)lastSeq=data.seq;
    if(current && data.game.shots<current.game.shots) {seenEvents.clear();positions.clear();}
    current=data;roomState=data;
    (data.game.events||[]).forEach(event=>{
      const key=[event.seq,event.type].join(':');
      if(seenEvents.has(key))return;
      seenEvents.add(key);
      if(seenEvents.size>100)seenEvents.clear();
      if(event.type==='shot') {effects.push({x:event.x,y:event.y,type:'shoot',life:1,seed:Math.random()});sfx('shoot');}
      if(event.type==='hit') {effects.push({x:event.x,y:event.y,type:'hit',life:.6,seed:Math.random()});sfx('hit');}
      if(event.type==='pocket') {effects.push({x:event.x,y:event.y,type:event.effect||'splash',life:1,seed:Math.random()});sfx('pocket',event.effect);}
      if(event.type==='finish') {sfx('win');}
    });
    updateScoreboard(data);
    updateGamePanel(data);
    updateOverlay();
  }
  function updateScoreboard(data) {
    const p=data.players||demo.players, game=data.game||demo.game;
    $('nameLeft').textContent=p[0]?.name||'Spieler 1';
    $('nameRight').textContent=p[1]?.name||'Wartet auf Freund';
    $('avatarLeft').textContent=ICONS[p[0]?.species]||ICONS.lion;
    $('avatarRight').textContent=ICONS[p[1]?.species]||ICONS.hippo;
    $('scoreNumberLeft').textContent=game.remaining[0];
    $('scoreNumberRight').textContent=game.remaining[1];
    $('scoreLeft').classList.toggle('active',sceneMode==='game'&&data.phase==='playing'&&game.phase!=='finished'&&game.turn===0);
    $('scoreRight').classList.toggle('active',sceneMode==='game'&&data.phase==='playing'&&game.phase!=='finished'&&game.turn===1);
    $('arenaStatus').textContent=sceneMode==='preview'?'SPIELVORSCHAU':data.phase==='waiting'?'WARTET AUF SPIELER':game.phase==='finished'?'PARTIE BEENDET':game.phase==='moving'?'TIERE IN BEWEGUNG':'PARTIE LAEUFT';
  }
  function updateGamePanel(data) {
    const g=data.game, ourTurn=session.local||session.seat===g.turn;
    $('turnName').textContent=data.phase==='waiting'?'Noch ein Spieler fehlt':g.phase==='finished'?(g.winner===-1?'Unentschieden!':`${fmtName(data.players[g.winner]?.name)} gewinnt!`):g.phase==='moving'?'Die Tiere rollen ...':fmtName(data.players[g.turn]?.name);
    $('turnLabel').textContent=g.phase==='finished'?'SPIEL BEENDET':data.phase==='waiting'?'WARTE AUF DEINEN FREUND':ourTurn?'DU BIST AM ZUG':'GEGNER IST AM ZUG';
    $('turnIndicator').style.color=g.turn===0?'#f3a864':'#7acbee';
    $('rematch').classList.toggle('hidden',g.phase!=='finished');
    $('instruction').textContent=data.phase==='waiting'?'Sobald dein Freund beigetreten ist, kann es losgehen.':g.phase==='finished'?'Lust auf eine Revanche? Die Startaufstellung aendert sich bei jeder Runde.':g.phase==='moving'?'Warte, bis alle Tiere ausgerollt sind.':ourTurn?'Wahle ein eigenes Tier. Ziehe es in die Gegenrichtung deines Schusses und lasse los.':'Schau zu, wie dein Gegner seinen Schuss vorbereitet.';
  }
  function updateOverlay() {
    const overlay=$('arenaOverlay');
    if(sceneMode==='preview'){
      overlay.classList.remove('hidden');
      $('overlayKicker').textContent='WELCOME TO THE JUNGLE';
      $('overlayTitle').textContent='Bereit fuer den grossen Showdown?';
      $('overlayText').textContent='Erstelle einen Raum oder spiele lokal. Die Arena wartet auf dich!';
      $('overlayAction').textContent='JETZT LOSLEGEN ->';$('overlayAction').classList.remove('hidden');return;
    }
    if(current.phase==='waiting') {
      overlay.classList.remove('hidden');
      $('overlayKicker').textContent='YOU ARE IN THE JUNGLE';
      $('overlayTitle').textContent='Dein Gegner fehlt noch!';
      $('overlayText').textContent='Kopiere den Einladungslink und schicke ihn per Discord an deinen Freund.';
      $('overlayAction').textContent='EINLADUNG KOPIEREN';$('overlayAction').classList.remove('hidden');return;
    }
    if(current.game.phase==='finished') {
      overlay.classList.remove('hidden');
      const win=current.game.winner;
      $('overlayKicker').textContent='MATCH COMPLETE';
      $('overlayTitle').textContent=win===-1?'Unentschieden!':`${fmtName(current.players[win]?.name)} gewinnt!`;
      $('overlayText').textContent='Was fuer ein Dschungel-Duell! Bereit fuer eine weitere Runde?';
      $('overlayAction').textContent='REVANCHE SPIELEN';$('overlayAction').classList.remove('hidden');return;
    }
    overlay.classList.add('hidden');
  }
  function startUpdates() {
    if(es){es.close();es=null;}
    if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}
    if(typeof EventSource!=='undefined'){
      es=new EventSource(`/api/rooms/${session.code}/events`);
      es.addEventListener('state',ev=>{try{applyState(JSON.parse(ev.data));}catch{}});
      es.onerror=()=>{ /* Polling below also works on hosts buffering streaming responses. */ };
    }
    const poll=async()=>{
      if(!session)return;
      try{const s=await send('GET',`/api/rooms/${session.code}`);applyState(s);}
      catch(e){if(e.message.includes('nicht gefunden')){showToast(e.message);reset(true);return;}}
      pollTimer=setTimeout(poll,current?.game?.phase==='moving'?155:950);
    };
    pollTimer=setTimeout(poll,300);
  }
  async function copyInvite() {
    if(!session)return;
    const link=inviteURL(session.code);
    try {await navigator.clipboard.writeText(link);showToast('Einladungslink kopiert! Ab damit zu Discord.');}
    catch{window.prompt('Diesen Einladungslink kopieren:',link);}
    startAudio();sfx('select');
  }
  async function rematch() {
    if(!session)return;
    try {startAudio();await send('POST',`/api/rooms/${session.code}/rematch`,{token:session.token});sfx('join');}
    catch(e){showToast(e.message);}
  }

  // WebAudio synth. This is original synthesized audio, not a sample from a commercial game.
  function startAudio() {
    if(!audioEnabled)return;
    try {if(!audioCtx){audioCtx=new (window.AudioContext||window.webkitAudioContext)();}
      if(audioCtx.state==='suspended')audioCtx.resume();
      if(!musicTimer)musicTimer=setInterval(playMusic,320);
    }catch{audioEnabled=false;}
  }
  function tone(freq,duration=.15,kind='triangle',gain=.09,when=0,end=null){
    if(!audioEnabled||!audioCtx)return;
    const start=audioCtx.currentTime+when;
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=kind;o.frequency.setValueAtTime(Math.max(20,freq),start);
    if(end)o.frequency.exponentialRampToValueAtTime(Math.max(20,end),start+duration);
    g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(Math.max(.00011,gain),start+.009);
    g.gain.exponentialRampToValueAtTime(.0001,start+duration);o.connect(g).connect(audioCtx.destination);o.start(start);o.stop(start+duration+.015);
  }
  function sfx(type,style='water') {
    if(!audioEnabled||!audioCtx)return;
    if(type==='select'){tone(630,.10,'sine',.035,0,950);return;}
    if(type==='join'){tone(435,.13,'sine',.065);tone(570,.13,'sine',.065,.11);tone(760,.23,'triangle',.065,.22);return;}
    if(type==='shoot'){tone(220,.23,'sawtooth',.085,0,75);tone(85,.16,'triangle',.12);return;}
    if(type==='hit'){tone(180,.09,'triangle',.06,0,80);return;}
    if(type==='pocket') {
      if(style==='ice'){tone(1100,.4,'sine',.09,0,1700);tone(1500,.3,'triangle',.04,.11);}
      else if(style==='laser'){tone(720,.4,'sawtooth',.08,0,120);}
      else if(style==='hammer'){tone(130,.26,'triangle',.15,0,48);}
      else if(style==='fire'){tone(110,.4,'sawtooth',.06,0,45);}
      else if(style==='spark'){for(let k=0;k<4;k++)tone(400+k*180,.1,'square',.02,k*.06);}
      else{tone(190,.27,'sine',.12,0,62);tone(410,.15,'triangle',.05,.05,200);}
      return;
    }
    if(type==='win'){[392,494,587,784].forEach((f,i)=>tone(f,.36,'triangle',.07,i*.13));}
  }
  let musicTicks=0;
  function playMusic() {
    musicTicks++;
    if(!audioEnabled||!audioCtx||!session||!current||current.game.phase==='finished'||document.hidden)return;
    if(musicTicks%2!==0)return;
    const notes=[196,247,294,392,330,294,247,220,196,247,330,440,392,330,247,196];
    const n=notes[musicStep%notes.length];
    tone(n,.17,'sine',.012);if(musicStep%4===0)tone(n/2,.33,'triangle',.018);
    musicStep++;
  }
  $('audioToggle').addEventListener('click',()=>{audioEnabled=!audioEnabled;$('audioLabel').textContent=audioEnabled?'Ton an':'Ton aus';$('audioToggle').style.opacity=audioEnabled?'1':'.55';if(audioEnabled){startAudio();sfx('select');}});

  const turfDots=[];let randSeed=12;
  function random(){randSeed=(randSeed*1664525+1013904223)>>>0;return randSeed/4294967296;}
  for(let i=0;i<310;i++)turfDots.push({x:110+random()*740,y:139+random()*465,r:.4+random()*1.5,a:.06+random()*.09});
  const decorDots=[];for(let i=0;i<100;i++)decorDots.push({x:random()*W,y:random()*H,r:1+random()*2.7});
  function rr(x,y,w,h,r,fill,stroke,width=1){
    ctx.beginPath();ctx.roundRect(x,y,w,h,r);
    if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.lineWidth=width;ctx.strokeStyle=stroke;ctx.stroke();}
  }
  function line(x1,y1,x2,y2,stroke,width=1){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}
  function circle(x,y,r,fill,stroke,width=1){ctx.beginPath();ctx.arc(x,y,r,0,TAU);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
  function ellipse(x,y,rx,ry,fill){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,TAU);ctx.fillStyle=fill;ctx.fill();}
  function text(t,x,y,font,color,align='center'){ctx.font=font;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(t,x,y);}
  function water(t){
    const gradient=ctx.createLinearGradient(0,0,W,H);gradient.addColorStop(0,'#3e85a4');gradient.addColorStop(.48,'#275d82');gradient.addColorStop(1,'#123f67');ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);
    const time=t*.00035;
    for(let j=0;j<11;j++){
      const yy=42+j*67;
      ctx.beginPath();
      for(let x=-15;x<=W+15;x+=15){const y=yy+Math.sin(x/51+time+j*.8)*6;if(x===-15)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
      ctx.strokeStyle='#b4e8f010';ctx.lineWidth=2;ctx.stroke();
    }
    decorDots.forEach((d,i)=>circle(d.x,d.y+Math.sin(time*1.6+i)*2,d.r,'#b8ebef1a'));
    // Soft oval shadow underneath the floating island.
    ctx.save();ctx.shadowColor='#071b26';ctx.shadowBlur=22;ctx.shadowOffsetY=16;
    rr(53,75,854,603,62,'#143e39');ctx.restore();
    rr(53,69,854,604,63,'#4a6b4d','#71955b',4);
    rr(67,86,827,573,48,'#7ea75d','#284d33',2);
    const grass=ctx.createRadialGradient(470,309,80,480,378,500);
    grass.addColorStop(0,'#79ce42');grass.addColorStop(.54,'#54b533');grass.addColorStop(1,'#267b32');
    rr(92,118,776,515,22,grass,'#85c64c',2);
    // Surface hatch, speckles, and broad lawn border.
    ctx.save();ctx.beginPath();ctx.roundRect(96,121,768,508,17);ctx.clip();
    turfDots.forEach(d=>circle(d.x,d.y,d.r,`rgba(227,250,138,${d.a})`));
    ctx.strokeStyle='#d4f59b1a';ctx.lineWidth=2;ctx.setLineDash([5,10]);ctx.strokeRect(117,139,725,473);ctx.setLineDash([]);
    circle(480,378,176,null,'#edffb519',4);circle(480,378,155,null,'#edffb511',2);
    text('JUNGLE',480,367,'bold 61px Trebuchet MS, sans-serif','#e9fca120');
    text('RUMBLE',480,417,'bold 58px Trebuchet MS, sans-serif','#e9fca120');
    ctx.restore();
  }
  function pocketDraw(p,t){
    const horizontal=p.side==='top'||p.side==='bottom';
    const x=horizontal?p.c:(p.side==='left'?F.l:F.r),y=horizontal?(p.side==='top'?F.t:F.b):p.c;
    ctx.save();ctx.translate(x,y);
    if(!horizontal)ctx.rotate(Math.PI/2);
    ellipse(0,0,p.span+1,20,'#153624');ellipse(0,5,p.span-8,13,'#091f25');
    ellipse(0,1,p.span-9,5,'#0d393e');
    // Small themed hazard marker tucked just behind the opening.
    const colors={ice:'#c4eff3',hammer:'#deb981',laser:'#fc66b5',water:'#6dd9e7',fire:'#f6ad52',spark:'#d8a6ff'};
    circle(0,horizontal?(p.side==='top'?-14:14):-16,17,'#41564d','#9eae8d',3);
    circle(0,horizontal?(p.side==='top'?-14:14):-16,11,colors[p.effect]);
    ctx.save();ctx.translate(0,horizontal?(p.side==='top'?-14:14):-16);
    if(p.effect==='ice'){for(let i=0;i<3;i++){ctx.save();ctx.rotate(i*Math.PI/3);line(-7,0,7,0,'#428fbd',2);ctx.restore();}}
    else if(p.effect==='hammer'){rr(-5,-7,10,5,2,'#83674c');line(0,-2,0,8,'#6b4127',3);}
    else if(p.effect==='laser'){line(-7,7,7,-7,'#8b1c65',3);circle(0,0,3,'#fff8ef');}
    else if(p.effect==='fire'){ctx.beginPath();ctx.moveTo(0,-9);ctx.quadraticCurveTo(13,-1,1,9);ctx.quadraticCurveTo(-12,5,0,-9);ctx.fillStyle='#d14926';ctx.fill();}
    else if(p.effect==='spark'){text('*',0,6,'bold 22px Arial','#6e3fc6');}
    else{circle(0,0,5,null,'#2382a2',2);circle(-4,-3,2,'#fff5ed');}
    ctx.restore();ctx.restore();
  }
  function stoneSegment(x,y,w,h,seed){
    const g=ctx.createLinearGradient(x,y,x+w*.35,y+h);g.addColorStop(0,'#abb49a');g.addColorStop(.40,'#7c947e');g.addColorStop(.85,'#647b69');g.addColorStop(1,'#486553');
    rr(x+2,y+4,w-4,h-6,10,g,'#3c6552',2);
    rr(x+7,y+7,w-14,7,4,'#dce1b145');
    if(seed%3===0){line(x+w*.32,y+h*.7,x+w*.45,y+h*.42,'#3b624b',2);line(x+w*.45,y+h*.42,x+w*.61,y+h*.51,'#3b624b',1.5);}
    if(seed%5===0)circle(x+w*.75,y+h*.72,2,'#a5b99b');
  }
  function borderStones(){
    // Big beveled stone slabs. Interruptions are playable gaps, not visible walls.
    let seed=0;
    for(let x=91;x<868;x+=50){
      if(!POCKETS.some(p=>p.side==='top'&&Math.abs(p.c-(x+25))<p.span+13))stoneSegment(x,70,50,51,seed++);
      if(!POCKETS.some(p=>p.side==='bottom'&&Math.abs(p.c-(x+25))<p.span+13))stoneSegment(x,627,50,51,seed++);
    }
    for(let y=119;y<630;y+=51){
      if(!POCKETS.some(p=>p.side==='left'&&Math.abs(p.c-(y+25))<p.span+14))stoneSegment(45,y,52,51,seed++);
      if(!POCKETS.some(p=>p.side==='right'&&Math.abs(p.c-(y+25))<p.span+14))stoneSegment(865,y,52,51,seed++);
    }
    [[60,77],[850,77],[60,622],[850,622]].forEach(([x,y],i)=>stoneSegment(x,y,52,48,i+7));
  }
  function paintedProps(t){
    // Lush ferns and small jungle flowers in the surrounding frame.
    for(const [x,y,rot] of [[117,103,.4],[847,101,2.4],[112,651,-1.5],[843,652,1.5]]){
      ctx.save();ctx.translate(x,y);ctx.rotate(rot);
      for(let i=0;i<4;i++){
        ctx.save();ctx.rotate(i*TAU/4);ellipse(0,-13,5,17,'#215b3f');ellipse(0,-19,3.4,11,'#6fa64e');ctx.restore();
      }
      circle(0,0,4,'#d9a963');ctx.restore();
    }
    // Two small torches in the corner granite blocks.
    for(const x of [124,836]){
      circle(x,91,8,'#3c584c','#b0bc93',2);
      const h=3+Math.sin(t*.01+x)*2;
      ctx.beginPath();ctx.moveTo(x-5,89);ctx.quadraticCurveTo(x-8,79,x+1,75-h);ctx.quadraticCurveTo(x+8,79,x+5,89);ctx.closePath();ctx.fillStyle='#f6be64';ctx.fill();
      circle(x,86,3,'#fff0a0');
    }
  }
  function face(species,team){
    const light=team===0?'#efcf9f':'#bfced3';
    const dark=team===0?'#76503b':'#49637b';
    ctx.save();
    if(species==='lion'){
      for(let j=0;j<11;j++){ctx.save();ctx.rotate(j*TAU/11);ellipse(0,-14,8,11,'#c67b36');ctx.restore();}
      circle(-11,-10,6,'#a55c2e');circle(11,-10,6,'#a55c2e');
      circle(0,0,14,'#f4bc77');ellipse(0,6,9,6,'#fee2a5');
    } else if(species==='elephant'){
      ellipse(-15,-3,9,13,'#779cb2');ellipse(15,-3,9,13,'#779cb2');
      ellipse(-15,-2,6,9,'#b1c4d2');ellipse(15,-2,6,9,'#b1c4d2');
      circle(0,0,14,'#a3c2cc');
      ctx.beginPath();ctx.moveTo(-5,7);ctx.bezierCurveTo(-5,17,6,20,7,9);ctx.lineWidth=8;ctx.strokeStyle='#a3c2cc';ctx.lineCap='round';ctx.stroke();
      line(4,12,7,13,'#5e8292',1.4);
    } else if(species==='monkey'){
      circle(-14,-2,8,'#70492d');circle(14,-2,8,'#70492d');
      circle(-14,-2,4,'#b98c67');circle(14,-2,4,'#b98c67');
      circle(0,0,15,'#70462f');ellipse(0,5,12,9,'#e3bb91');ellipse(0,-8,8,6,'#b88d6a');
    } else {
      circle(-11,-12,6,'#7e83ac');circle(11,-12,6,'#7e83ac');
      circle(0,-2,14,'#9a99bb');ellipse(0,7,16,10,'#c4bacb');
      circle(-8,5,2,'#857c91');circle(8,5,2,'#857c91');
      rr(-8,12,4,4,1,'#fff5e5');rr(5,12,4,4,1,'#fff5e5');
    }
    // Playful expressive eyes and a hand-drawn little mouth.
    ellipse(-5,-3,2.7,3.9,'#2e2b25');ellipse(5,-3,2.7,3.9,'#2e2b25');
    circle(-5.9,-4.4,1,'#fff');circle(4.1,-4.4,1,'#fff');
    if(species!=='elephant'){
      ctx.beginPath();ctx.arc(0,5,4,0,Math.PI);ctx.strokeStyle=dark;ctx.lineWidth=1.6;ctx.stroke();
      circle(0,4,2.1,dark);
    }
    ctx.restore();
  }
  function animalBall(d,players,t,selected,preview){
    const owner=d.owner,sp=players[owner]?.species||(owner===0?'lion':'hippo');
    const r=24,bg=owner===0?'#ef7546':'#4da0d0',rim=owner===0?'#a84338':'#2b6299';
    ctx.save();ctx.translate(d.x,d.y);
    ellipse(1,17,24,7,'#143b243f');
    if(selected){
      const rad=30+Math.sin(t*.008)*2;circle(0,0,rad,'#f8db8b24','#ffe8a5',3);
      for(let i=0;i<5;i++){const a=t*.001+i*TAU/5;circle(Math.cos(a)*34,Math.sin(a)*34,2.5,'#fff1b0');}
    }
    circle(0,2,r+2,rim,'#f7e8be',1.5);
    const g=ctx.createRadialGradient(-7,-9,2,4,7,28);
    g.addColorStop(0,owner===0?'#ffbe74':'#a0d7ef');g.addColorStop(.74,bg);g.addColorStop(1,rim);
    circle(0,0,r,g,'#eac992',1.5);
    circle(0,0,r-4,'#f0debc',owner===0?'#a6533f':'#3375a7',2);
    ctx.save();ctx.beginPath();ctx.arc(0,0,r-5,0,TAU);ctx.clip();face(sp,owner);ctx.restore();
    ctx.save();ctx.rotate(-.45);ellipse(-9,-16,9,3,'#fff8dc89');ctx.restore();
    // Small team indicator bead.
    circle(16,17,5,bg,'#e8f1c1',1.2);circle(15,16,1.6,'#fff7e8');
    ctx.restore();
  }
  function trapEffects(dt){
    for(let i=effects.length-1;i>=0;i--){
      const e=effects[i];e.life-=dt*.00068;
      if(e.life<=0){effects.splice(i,1);continue;}
      ctx.save();ctx.translate(e.x,e.y);
      const progress=1-e.life;
      const color=({fire:'#ffad55',ice:'#d9f4ff',hammer:'#e8d4a7',laser:'#ff81b8',water:'#80e5fc',spark:'#ddb1ff',shoot:'#fff4b5',hit:'#fff5c6'})[e.type]||'#ffffff';
      circle(0,0,10+progress*48,null,color.replace(')',',.4)'),2*e.life); // alpha adjusted below via globalAlpha
      for(let j=0;j<11;j++){
        const a=j*TAU/11+e.seed*2;
        const dist=8+progress*(42+(j%3)*9);
        ctx.globalAlpha=e.life;
        circle(Math.cos(a)*dist,Math.sin(a)*dist,1.5+(j%3),color);
      }
      ctx.restore();
    }
  }
  function aimDraw(d,t){
    if(!drag||!d)return;
    const dx=drag.startX-drag.x,dy=drag.startY-drag.y,mag=Math.hypot(dx,dy);
    if(mag<4)return;
    const power=Math.min(130,mag),nx=dx/mag,ny=dy/mag;
    const future=power*1.3;
    ctx.save();ctx.translate(d.x,d.y);
    ctx.setLineDash([10,8]);ctx.lineWidth=4;ctx.strokeStyle='#fff5b6aa';
    ctx.beginPath();ctx.moveTo(nx*27,ny*27);ctx.lineTo(nx*(28+future),ny*(28+future));ctx.stroke();ctx.setLineDash([]);
    const tip=28+future;ctx.fillStyle='#fff4b6';ctx.beginPath();ctx.moveTo(nx*(tip+5),ny*(tip+5));ctx.lineTo(nx*(tip-19)-ny*10,ny*(tip-19)+nx*10);ctx.lineTo(nx*(tip-19)+ny*10,ny*(tip-19)-nx*10);ctx.fill();
    ctx.lineWidth=6;ctx.strokeStyle='#3e2b20aa';ctx.beginPath();ctx.moveTo(-nx*30,-ny*30);ctx.lineTo(-nx*Math.min(140,mag+26),-ny*Math.min(140,mag+26));ctx.stroke();
    ctx.lineWidth=3;ctx.strokeStyle='#e5b76b';ctx.stroke();
    ctx.restore();
    // Capsule power meter follows the selected animal.
    const meterX=Math.max(135,Math.min(750,d.x-68)),meterY=Math.max(149,d.y-75);
    rr(meterX,meterY,136,13,6,'#142f24b8','#d4c98b88',1);
    const gradient=ctx.createLinearGradient(meterX,0,meterX+134,0);gradient.addColorStop(0,'#83e278');gradient.addColorStop(.62,'#efcb62');gradient.addColorStop(1,'#f47550');
    rr(meterX+3,meterY+3,Math.max(1,130*power/130),7,3,gradient);
    text('POWER',meterX+68,meterY-7,'bold 11px Trebuchet MS','#f4f1d1');
  }
  function draw(t){
    ctx.clearRect(0,0,W,H);water(t);
    POCKETS.forEach(p=>pocketDraw(p,t));borderStones();paintedProps(t);
    const src=roomState||demo,g=src.game,players=src.players||demo.players;
    for(const p of g.pieces){
      if(!p.alive)continue;
      let q=positions.get(p.id);
      if(!q){q={x:p.x,y:p.y};positions.set(p.id,q);}
      const k=g.phase==='moving'?.35:.65;
      q.x+=(p.x-q.x)*k;q.y+=(p.y-q.y)*k;
      const selected=drag?.id===p.id;
      animalBall({...p,x:q.x,y:q.y},players,t,selected);
    }
    if(drag){const p=g.pieces.find(z=>z.id===drag.id&&z.alive);if(p)aimDraw(p,t);}
    trapEffects(16);
    requestAnimationFrame(draw);
  }
  function myTurn() {
    if(!session||!current)return false;
    return current.phase==='playing'&&current.game.phase==='playing'&&(session.local||current.game.turn===session.seat);
  }
  function point(ev) {
    const b=canvas.getBoundingClientRect();return{x:(ev.clientX-b.left)*(W/b.width),y:(ev.clientY-b.top)*(H/b.height)};
  }
  canvas.addEventListener('pointerdown',ev=>{
    if(!myTurn())return;
    const p=point(ev),g=current.game;
    const target=g.pieces.filter(d=>d.alive&&d.owner===g.turn).find(d=>Math.hypot(d.x-p.x,d.y-p.y)<37);
    if(!target){showToast('Klicke auf eines deiner eigenen Tiere.');return;}
    ev.preventDefault();startAudio();sfx('select');
    drag={id:target.id,x:p.x,y:p.y,startX:p.x,startY:p.y,pieceX:target.x,pieceY:target.y};
    canvas.classList.add('dragging');canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove',ev=>{if(!drag)return;ev.preventDefault();const p=point(ev);drag.x=p.x;drag.y=p.y;});
  canvas.addEventListener('pointercancel',()=>{drag=null;canvas.classList.remove('dragging');});
  canvas.addEventListener('pointerup',async ev=>{
    if(!drag)return;
    ev.preventDefault();const pointNow=point(ev),sel=drag;drag=null;canvas.classList.remove('dragging');
    if(!myTurn())return;
    const dx=sel.startX-pointNow.x,dy=sel.startY-pointNow.y;
    const mag=Math.hypot(dx,dy);
    if(mag<8){showToast('Ziehe das Tier nach hinten, dann loslassen!');return;}
    const power=Math.min(1050,mag*7.9),vx=dx/mag*power,vy=dy/mag*power;
    try {await send('POST',`/api/rooms/${session.code}/shoot`,{token:session.token,pieceId:sel.id,vx,vy});}
    catch(e){showToast(e.message);}
  });

  $('createRoom').addEventListener('click',()=>create(false));
  $('localRoom').addEventListener('click',()=>create(true));
  $('joinRoom').addEventListener('click',join);
  $('roomCode').addEventListener('keydown',ev=>{if(ev.key==='Enter')join();});
  $('playerName').addEventListener('keydown',ev=>{if(ev.key==='Enter')create(false);});
  $('copyInvite').addEventListener('click',copyInvite);
  $('rematch').addEventListener('click',rematch);
  $('backToLobby').addEventListener('click',()=>reset(false));
  $('overlayAction').addEventListener('click',()=>{
    if(!session){$('playerName').focus();$('lobbyPanel').scrollIntoView({behavior:'smooth',block:'center'});}
    else if(current?.game?.phase==='finished')rematch();
    else if(current?.phase==='waiting')copyInvite();
  });
  choosingSpecies();
  updateScoreboard(demo);updateOverlay();requestAnimationFrame(draw);
  const params=new URLSearchParams(location.search),code=(params.get('room')||'').toUpperCase();
  if(/^[A-Z2-9]{6}$/.test(code)){
    $('roomCode').value=code;
    const last=JSON.parse(localStorage.getItem('zoopaloola_rev_session')||'null');
    if(last?.code===code&&last?.token) {
      send('GET',`/api/rooms/${code}`).then(data=>{enter({...data,token:last.token,seat:last.seat,local:last.local});}).catch(()=>{localStorage.removeItem('zoopaloola_rev_session');showToast('Alter Raum nicht mehr erreichbar. Erstelle einen neuen.');});
    }else {showToast('Einladung gefunden! Waehle ein Tier und klicke auf BEITRETEN.');}
  }
})();
