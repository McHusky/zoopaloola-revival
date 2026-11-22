'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = 960, H = 720;
  const DEFAULT_MAX_POWER = 1020, FULL_POWER_DRAG = 130;
  const shotStrength = distance => Math.min(1, Math.max(0, distance / FULL_POWER_DRAG));
  const F = { l:108, r:852, t:122, b:624 };
  const ICONS = { lion:'🦁', elephant:'🐘', monkey:'🐒', hippo:'🦛' };
  // Four corner pockets plus centre pockets on the two long rails.
  const POCKETS = [
    {id:'tl',x:F.l,y:F.t,side:'corner',effect:'laser',span:48},
    {id:'tm',x:480,y:F.t,side:'top',effect:'ice',span:57},
    {id:'tr',x:F.r,y:F.t,side:'corner',effect:'hammer',span:48},
    {id:'bl',x:F.l,y:F.b,side:'corner',effect:'fire',span:48},
    {id:'bm',x:480,y:F.b,side:'bottom',effect:'spark',span:57},
    {id:'br',x:F.r,y:F.b,side:'corner',effect:'water',span:48}
  ];
  const TAU=Math.PI*2;
  let species='lion', session=null, current=null, es=null, pollTimer=null, lastSeq=-1;
  let drag=null, hoverPiece=null, audioEnabled=true, audioCtx=null, musicTimer=null, musicStep=0;
  const positions=new Map(), effects=[], seenEvents=new Set();
  let toastTimeout=null, sceneMode='preview';
  const demo = {game:{pieces:[],phase:'playing',turn:0,remaining:[6,6],shots:0,events:[]},players:[{name:'Sunny',species:'lion'},{name:'Moon',species:'hippo'}],phase:'playing'};
  // The lobby preview uses the same circular layout as all game modes.
  for(let i=0;i<12;i++){
    const angle=i*Math.PI/6-Math.PI/2;
    const owner=i%2;
    demo.game.pieces.push({id:`p${owner}-${Math.floor(i/2)}`,owner,
      x:480+Math.cos(angle)*196,y:373+Math.sin(angle)*171,vx:0,vy:0,alive:true});
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
  async function create(local=false,vsBot=false) {
    try {
      startAudio();sfx('select');setButtonsBusy(true);
      const result=await send('POST','/api/rooms',{name:$('playerName').value.trim()||'Dschungelheld',species,local,vsBot,difficulty:$('cpuDifficulty').value});
      enter(result);
      showToast(vsBot?'Solo-Duell gestartet. Du hast den ersten Stoß!':local?'Lokales Duell gestartet!':'Raum erstellt. Schicke den Einladungslink an deinen Freund.');
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
  function setButtonsBusy(busy) {$('createRoom').disabled=busy;$('joinRoom').disabled=busy;$('localRoom').disabled=busy;$('soloRoom').disabled=busy;}
  function enter(res) {
    session={code:res.code,token:res.token,seat:res.seat,local:res.local,bot:!!res.bot};
    localStorage.setItem('zoopaloola_rev_session',JSON.stringify(session));
    setURL(res.code);
    $('lobbyPanel').classList.add('hidden');$('gamePanel').classList.remove('hidden');
    $('currentRoomCode').textContent=res.code;$('roomType').textContent=res.bot?'SOLO':res.local?'LOKAL':'PRIVAT';
    $('copyInvite').classList.toggle('hidden',res.local||res.bot);
    $('inviteHint').textContent=res.bot?'Fordere den Computer heraus – er plant seine Spielzüge selbst.':res.local?'Zwei Spieler am selben Gerät wechseln sich ab.':'Teile den Link mit deinem Freund auf Discord.';
    $('gameCanvas').classList.add('interactive');
    sceneMode='game';applyState(res);
    startUpdates();
  }
  function reset(forget=false) {
    if(es){es.close();es=null;}
    if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}
    session=null;current=null;lastSeq=-1;seenEvents.clear();drag=null;positions.clear();effects.length=0;sceneMode='preview';roomState=demo;
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
      if(event.type==='pocket') {effects.push({x:event.x,y:event.y,tx:event.pocketX,ty:event.pocketY,owner:event.owner,kind:data.players[event.owner]?.species||'lion',type:'trap',effect:event.effect,life:1,seed:Math.random()});sfx('pocket',event.effect);}
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
    $('arenaStatus').textContent=sceneMode==='preview'?'SPIELVORSCHAU':data.phase==='waiting'?'WARTET AUF SPIELER':game.phase==='finished'?'PARTIE BEENDET':data.botThinking?'COMPUTER ZIELT':game.phase==='moving'?'KUGELN ROLLEN':'PARTIE LAEUFT';
  }
  function updateGamePanel(data) {
    const g=data.game, ourTurn=session.local||session.seat===g.turn;
    $('turnName').textContent=data.phase==='waiting'?'Noch ein Spieler fehlt':g.phase==='finished'?(g.winner===-1?'Unentschieden!':`${fmtName(data.players[g.winner]?.name)} gewinnt!`):g.phase==='moving'?'Die Kugeln rollen ...':data.bot&&g.turn===1?'Computer zielt …':fmtName(data.players[g.turn]?.name);
    $('turnLabel').textContent=g.phase==='finished'?'SPIEL BEENDET':data.phase==='waiting'?'WARTE AUF DEINEN FREUND':ourTurn?'DU BIST AM ZUG':data.bot?'COMPUTER IST DRAN':'GEGNER IST AM ZUG';
    $('turnIndicator').style.color=g.turn===0?'#f3a864':'#7acbee';
    $('rematch').classList.toggle('hidden',g.phase!=='finished');
    $('instruction').textContent=data.phase==='waiting'?'Sobald dein Freund beigetreten ist, kann es losgehen.':g.phase==='finished'?'Lust auf eine Revanche? Auch die nächste Runde startet im Kreis.':g.phase==='moving'?'Warte, bis alle Tierkugeln ausgerollt sind.':ourTurn?'Wähle eine eigene Kugel, ziehe den Queue zurück und lasse los. Über die Zielhilfe erkennst du den Trefferpunkt.':data.bot?'Der Computer berechnet seinen nächsten Stoß …':'Schau zu, wie dein Gegner seinen Stoß vorbereitet.';
  }
  function updateOverlay() {
    const overlay=$('arenaOverlay');
    if(sceneMode==='preview'){
      overlay.classList.remove('hidden');
      $('overlayKicker').textContent='WELCOME TO THE JUNGLE';
      $('overlayTitle').textContent='Bereit fuer den grossen Showdown?';
      $('overlayText').textContent='Spiele solo gegen den Computer, lokal oder online mit deinen Freunden!';
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
  function noiseBurst(duration=.25,volume=.035,frequency=1600,delay=0){
    if(!audioCtx||!audioEnabled)return;
    const length=Math.ceil(audioCtx.sampleRate*duration);
    const buffer=audioCtx.createBuffer(1,length,audioCtx.sampleRate);
    const samples=buffer.getChannelData(0);
    for(let i=0;i<length;i++)samples[i]=Math.random()*2-1;
    const source=audioCtx.createBufferSource();source.buffer=buffer;
    const filter=audioCtx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=frequency;
    const gain=audioCtx.createGain(),at=audioCtx.currentTime+delay;
    gain.gain.setValueAtTime(.0001,at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.001,volume),at+.012);
    gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    source.connect(filter).connect(gain).connect(audioCtx.destination);
    source.start(at);source.stop(at+duration+.01);
  }
  function sfx(type,style='water') {
    if(!audioEnabled||!audioCtx)return;
    if(type==='select'){tone(630,.10,'sine',.035,0,950);return;}
    if(type==='join'){tone(435,.13,'sine',.065);tone(570,.13,'sine',.065,.11);tone(760,.23,'triangle',.065,.22);return;}
    if(type==='shoot'){tone(220,.23,'sawtooth',.085,0,75);tone(85,.16,'triangle',.12);noiseBurst(.10,.055,950);return;}
    if(type==='hit'){tone(180,.09,'triangle',.06,0,80);noiseBurst(.08,.06,650);return;}
    if(type==='pocket') {
      if(style==='ice'){tone(1100,.4,'sine',.09,0,1700);tone(1500,.3,'triangle',.04,.11);noiseBurst(.32,.045,2800,.12);}
      else if(style==='laser'){tone(900,.45,'sawtooth',.09,0,100);tone(1450,.37,'square',.035,.04,250);noiseBurst(.48,.07,3300);}
      else if(style==='hammer'){tone(130,.26,'triangle',.15,0,48);noiseBurst(.19,.10,400,.14);}
      else if(style==='fire'){tone(220,.55,'sawtooth',.07,0,60);noiseBurst(.57,.075,1200);}
      else if(style==='spark'){for(let k=0;k<7;k++)tone(400+k*220,.08,'square',.033,k*.045);noiseBurst(.34,.06,4600);}
      else{tone(190,.27,'sine',.12,0,62);tone(410,.15,'triangle',.05,.05,200);noiseBurst(.43,.064,700);}
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
  function circle(x,y,r,fill,stroke,width=1){if(!Number.isFinite(r)||r<0)return;ctx.beginPath();ctx.arc(x,y,r,0,TAU);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
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
    const {x,y,effect}=p;
    ctx.save();ctx.translate(x,y);
    const middle=p.side!=='corner';
    const rx=middle?55:49,ry=middle?34:44;
    // Open abyss with concentric shaded stone rim; true pockets, not rails.
    ctx.shadowColor='#07190f';ctx.shadowBlur=17;ctx.shadowOffsetY=6;
    ellipse(0,2,rx+8,ry+8,'#223d2f');ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    ellipse(0,3,rx+4,ry+5,'#6c8367');
    ellipse(0,5,rx,ry,'#091f24');
    ellipse(0,7,rx-8,ry-7,'#05151c');
    ellipse(0,-ry*.24,rx-12,3,'#b6dbb721');
    const palette={ice:'#b9f3ff',hammer:'#ffe8a2',laser:'#fa5c62',water:'#6cd8ff',fire:'#ff934a',spark:'#d8a2ff'};
    ctx.globalAlpha=.30+.20*Math.sin(t*.003+x);
    circle(0,4,middle?24:20,null,palette[effect],3);
    ctx.globalAlpha=1;
    // Game-like trap machinery. Every pocket has a distinct weapon.
    const awayY=y<F.t+60?-1:1;
    if(middle){
      // Pair of cannons, facing the opening.
      for(const sign of [-1,1]){
        ctx.save();ctx.translate(sign*38,awayY*15);ctx.rotate(sign*Math.PI/2);
        rr(-10,-17,20,31,5,'#667b6e','#304d44',2);
        rr(-8,-25,16,17,4,'#97a79c','#324d50',2);
        ellipse(0,-25,8,4,'#203c40');ctx.restore();
      }
    }else{
      ctx.save();ctx.translate(x<F.l+80?-18:18,y<F.t+80?-23:23);
      circle(0,0,16,'#506c61','#a8b49c',3);
      circle(0,0,9,'#22343d');circle(-3,-3,3,palette[effect]);
      ctx.restore();
    }
    if(effect==='ice'){
      for(let i=0;i<3;i++){ctx.save();ctx.rotate(i*Math.PI/3);line(-13,0,13,0,'#baf8ff',3);ctx.restore();}
    }else if(effect==='laser'){
      circle(0,1,10,'#dc333e','#ffb9a5',2);circle(0,1,5,'#fff2bd');
    }else if(effect==='hammer'){
      rr(-12,-13,24,12,4,'#e6bd7e','#604931',3);line(0,-2,0,15,'#e9d0a5',5);
    }else if(effect==='fire'){
      ctx.beginPath();ctx.moveTo(0,-23);ctx.bezierCurveTo(21,-7,10,18,0,19);ctx.bezierCurveTo(-20,11,-18,-7,0,-23);ctx.fillStyle='#ff7b2b';ctx.fill();
      circle(0,7,7,'#ffe184');
    }else if(effect==='spark'){
      ctx.beginPath();ctx.moveTo(-5,-18);ctx.lineTo(10,-4);ctx.lineTo(0,0);ctx.lineTo(8,16);ctx.lineTo(-11,0);ctx.lineTo(-2,-4);ctx.closePath();ctx.fillStyle='#e6abff';ctx.fill();
    }else{
      for(let i=0;i<3;i++)circle(-12+i*12,-1+Math.sin(t*.002+i)*4,5,'#82e4ff');
    }
    ctx.restore();
  }
  function stoneSegment(x,y,w,h,seed){
    const g=ctx.createLinearGradient(x,y,x+w*.35,y+h);g.addColorStop(0,'#abb49a');g.addColorStop(.40,'#7c947e');g.addColorStop(.85,'#647b69');g.addColorStop(1,'#486553');
    rr(x+2,y+4,w-4,h-6,10,g,'#3c6552',2);
    rr(x+7,y+7,w-14,7,4,'#dce1b145');
    if(seed%3===0){line(x+w*.32,y+h*.7,x+w*.45,y+h*.42,'#3b624b',2);line(x+w*.45,y+h*.42,x+w*.61,y+h*.51,'#3b624b',1.5);}
    if(seed%5===0)circle(x+w*.75,y+h*.72,2,'#a5b99b');
  }
  function borderStones(){
    // Six-pocket billiards: interrupted top/bottom rails and four open corners.
    let seed=0;
    const railTop=F.t-51,railBottom=F.b+3;
    for(const [l,r] of [[F.l+68,480-64],[480+64,F.r-68]]){
      for(let x=l;x<r-7;x+=48){const w=Math.min(49,r-x);stoneSegment(x,railTop,w,52,seed++);stoneSegment(x,railBottom,w,52,seed++);}
    }
    for(const [l,r] of [[F.t+68,F.b-68]]){
      for(let y=l;y<r-8;y+=48){const h=Math.min(49,r-y);stoneSegment(F.l-55,y,54,h,seed++);stoneSegment(F.r+2,y,54,h,seed++);}
    }
    // Slim rubber cushions on the playable side; real gaps at every pocket.
    ctx.save();ctx.lineCap='round';
    for(const [a,b] of [[F.l+69,480-61],[480+61,F.r-69]]){
      line(a,F.t,b,F.t,'#2c5c41',8);line(a,F.b,b,F.b,'#2c5c41',8);
      line(a,F.t+3,b,F.t+3,'#8fc16d',2);line(a,F.b-3,b,F.b-3,'#8fc16d',2);
    }
    line(F.l,F.t+69,F.l,F.b-69,'#2c5c41',8);
    line(F.r,F.t+69,F.r,F.b-69,'#2c5c41',8);
    line(F.l+3,F.t+69,F.l+3,F.b-69,'#8fc16d',2);
    line(F.r-3,F.t+69,F.r-3,F.b-69,'#8fc16d',2);
    ctx.restore();
  }
  function paintedProps(t){
    // Botanically styled corners deliberately stay outside the pocket mouths.
    for(const [x,y,rot] of [[217,105,.4],[747,105,2.4],[225,647,-1.5],[737,647,1.5]]){
      ctx.save();ctx.translate(x,y);ctx.rotate(rot);
      for(let i=0;i<4;i++){
        ctx.save();ctx.rotate(i*TAU/4);ellipse(0,-13,5,17,'#215b3f');ellipse(0,-19,3.4,11,'#6fa64e');ctx.restore();
      }
      circle(0,0,4,'#d9a963');ctx.restore();
    }
    for(const x of [229,730]){
      circle(x,92,7,'#3c584c','#b0bc93',2);
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
  function trapEffects(dt,t){
    for(let i=effects.length-1;i>=0;i--){
      const e=effects[i];
      e.life-=dt*(e.type==='trap'?.00077:.0010);
      if(e.life<=0){effects.splice(i,1);continue;}
      ctx.save();
      const progress=1-e.life,fade=Math.min(1,e.life*3);
      if(e.type!=='trap'){
        const color=e.type==='hit'?'#fffbc6':'#f4d285';
        ctx.translate(e.x,e.y);ctx.globalAlpha=fade;
        circle(0,0,10+progress*55,null,color,4*e.life);
        for(let j=0;j<15;j++){
          const a=j*TAU/15+e.seed,dist=12+progress*(48+j%4*8);
          circle(Math.cos(a)*dist,Math.sin(a)*dist,2.2+(j%3),color);
        }
      }else{
        // Trap sequence: a marble is sucked toward the pocket, then destroyed
        // in a signature cartoon effect. All animations are original canvas art.
        const shift=Math.min(1,progress*4);
        const px=e.x+(e.tx-e.x)*shift,py=e.y+(e.ty-e.y)*shift;
        const color={laser:'#fa464b',fire:'#ff8c3f',hammer:'#ffdb94',ice:'#c7f5ff',spark:'#dd91ff',water:'#83e4ff'}[e.effect]||'#fff';
        const flick=Math.sin(progress*175+e.seed*5);
        ctx.translate(px,py);
        if(progress<.44){
          ctx.save();ctx.globalAlpha=progress<.3?1:Math.max(0,(.44-progress)/.14);
          const shrink=progress<.25?1:Math.max(.05,1-(progress-.25)*4.8);
          ctx.scale(shrink,shrink);
          animalBall({x:0,y:0,owner:e.owner},[{species:e.kind},{species:e.kind}],t,false);
          ctx.restore();
        }
        // Bright, timed weapons: laser incinerates, ice shatters, hammer
        // squashes, fire burns, electricity disintegrates, water splashes.
        if(e.effect==='laser'||e.effect==='spark'){
          ctx.save();ctx.globalAlpha=fade*(progress>.18?1:.15);
          const beam=color;
          line(-40,(-36+flick*5),0,0,beam,13*fade);
          line(-40,-36+flick*5,0,0,'#fff6d7',4*fade);
          if(e.effect==='spark'){
            for(let j=0;j<4;j++){
              const a=j*TAU/4+t*.005;
              ctx.beginPath();ctx.moveTo(0,0);
              for(let h=1;h<=4;h++){
                const rad=h*13;ctx.lineTo(Math.cos(a)*rad+Math.sin(t*.03+j+h)*7,Math.sin(a)*rad+Math.cos(t*.035+j)*8);
              }
              ctx.strokeStyle=j%2?'#fff':'#d775ff';ctx.lineWidth=3;ctx.stroke();
            }
          }
          ctx.restore();
        }
        if(e.effect==='ice'){
          ctx.save();ctx.globalAlpha=fade;
          ctx.rotate(progress*.3);
          rr(-21,-21,42,42,4,progress<.53?'#aceaff99':'#bff9fe', '#efffff',3);
          for(let j=0;j<6;j++){const a=j*TAU/6;line(0,0,Math.cos(a)*(15+progress*22),Math.sin(a)*(15+progress*22),'#effaff',2);}
          ctx.restore();
        }
        if(e.effect==='hammer'){
          ctx.save();ctx.globalAlpha=fade;
          const drop=progress<.38?-62+progress*150: -5+Math.sin((progress-.38)*18)*6;
          rr(-8,drop-44,16,64,5,'#7a5940','#e5bd82',3);
          rr(-43,drop-55,86,37,8,'#b5b5a0','#425f60',5);
          line(-31,drop-44,26,drop-44,'#ffffff80',4);
          ctx.restore();
        }
        if(e.effect==='fire'){
          ctx.save();ctx.globalAlpha=fade;
          for(let j=0;j<8;j++){
            const a=j*TAU/8;
            ctx.save();ctx.translate(Math.cos(a)*15,Math.sin(a)*15);
            ctx.rotate(a);const h=17+Math.sin(t*.018+j)*12;
            ctx.beginPath();ctx.moveTo(-8,16);ctx.quadraticCurveTo(-16,-h*.25,0,-h-25);ctx.quadraticCurveTo(16,-h*.2,8,16);ctx.closePath();ctx.fillStyle=j%2?'#ff9d36':'#ff4b35';ctx.fill();ctx.restore();
          }
          circle(0,0,11,'#ffe7a8');ctx.restore();
        }
        if(e.effect==='water'){
          ctx.save();ctx.globalAlpha=fade;
          // Ripple rings appear one after another. A negative radius would
          // throw IndexSizeError in Canvas 2D and permanently stop draw().
          for(let j=0;j<3;j++){
            const radius=progress*105-j*21;
            if(radius>0)circle(0,0,radius,null,'#a1efff',4);
          }
          for(let j=0;j<12;j++){const a=j*TAU/12+e.seed;const r=progress*80+10;circle(Math.cos(a)*r,Math.sin(a)*r,3.6,'#82daf7');}
          ctx.restore();
        }
        if(progress>.21){
          ctx.save();ctx.globalAlpha=fade;
          for(let j=0;j<26;j++){
            const a=j*2.399+e.seed*3,dist=(progress-.20)*(85+(j%5)*15);
            const dx=Math.cos(a)*dist,dy=Math.sin(a)*dist;
            const dot=2.2+j%4;
            ctx.translate(0,0);
            rr(dx-dot/2,dy-dot/2,dot,dot,1,j%3?'#fff5cc':color);
          }
          ctx.restore();
        }
        // Collapse shock ring makes the marble's death impossible to miss.
        ctx.globalAlpha=fade*.85;
        circle(0,0,12+progress*61,null,color,5*e.life);
        if(progress>.35){ctx.globalAlpha=fade*.4;circle(0,0,19+Math.sin(t*.04)*4,color);}
      }
      ctx.restore();
    }
  }
  function aimDraw(d,t){
    if(!drag||!d)return;
    const dx=drag.startX-drag.x,dy=drag.startY-drag.y,mag=Math.hypot(dx,dy);
    if(mag<3)return;
    const strength=shotStrength(mag),power=FULL_POWER_DRAG*strength,nx=dx/mag,ny=dy/mag;
    ctx.save();ctx.translate(d.x,d.y);
    // Preview the first ball-to-ball impact instead of a generic arrow.
    const game=roomState.game;
    let targetDistance=620,hitBall=false;
    for(const p of game.pieces){
      if(!p.alive||p.id===d.id)continue;
      const vx=p.x-d.x,vy=p.y-d.y;
      const along=vx*nx+vy*ny,perp2=vx*vx+vy*vy-along*along;
      if(along<=0||perp2>46*46)continue;
      const dist=along-Math.sqrt(46*46-perp2);
      if(dist>2&&dist<targetDistance){targetDistance=dist;hitBall=true;}
    }
    // Dashed sight-line, true billiards target ghost and a faint aim shadow.
    ctx.setLineDash([8,7]);ctx.lineWidth=3.5;ctx.strokeStyle='#fff7d6bb';
    ctx.beginPath();ctx.moveTo(nx*30,ny*30);ctx.lineTo(nx*targetDistance,ny*targetDistance);ctx.stroke();ctx.setLineDash([]);
    if(hitBall){
      circle(nx*targetDistance,ny*targetDistance,23,'#fff5bd2c','#fff4becc',2);
      circle(nx*targetDistance,ny*targetDistance,4,'#fff4be');
    }
    // Wooden pool cue, pulled back behind the selected animal.
    const retreat=18+Math.min(83,power*.56);
    const start=28+retreat,end=265+retreat;
    ctx.lineCap='round';
    const wood=ctx.createLinearGradient(-ny*11,nx*11,ny*11,-nx*11);
    wood.addColorStop(0,'#684429');wood.addColorStop(.5,'#ecc58b');wood.addColorStop(1,'#714526');
    line(-nx*start,-ny*start,-nx*end,-ny*end,'#201916',12);
    line(-nx*start,-ny*start,-nx*end,-ny*end,wood,9);
    line(-nx*start,-ny*start,-nx*(start+30),-ny*(start+30),'#f1e7cc',6);
    line(-nx*(start+1),-ny*(start+1),-nx*(start+8),-ny*(start+8),'#58a7c9',5);
    line(-nx*(end-40),-ny*(end-40),-nx*end,-ny*end,'#41312a',12);
    for(const v of [end-22,end-32])line(-nx*v,-ny*v,-nx*(v+3),-ny*(v+3),'#ebcf9b',11);
    ctx.restore();
    const meterX=Math.max(136,Math.min(726,d.x-83)),meterY=Math.max(164,d.y-83);
    rr(meterX,meterY,166,15,7,'#0b201cdd','#f1daa077',1);
    const gradient=ctx.createLinearGradient(meterX,0,meterX+163,0);
    gradient.addColorStop(0,'#8fe778');gradient.addColorStop(.62,'#f2d366');gradient.addColorStop(1,'#e85c37');
    rr(meterX+3,meterY+3,Math.max(1,160*strength),9,4,gradient);
    text(`STOßKRAFT ${Math.round(strength*100)}%`,meterX+83,meterY-7,'bold 11px Trebuchet MS','#f6f2cf');
  }
  let lastDrawTime=0;
  function draw(t){
    const dt=lastDrawTime?Math.min(60,t-lastDrawTime):16;lastDrawTime=t;
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
    trapEffects(dt,t);
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
    // The authoritative server exposes its power ceiling with the game state.
    // 100% on the UI maps to that precise value, even if it changes later.
    const maxPower=current.game.maxPower??DEFAULT_MAX_POWER;
    const power=maxPower*shotStrength(mag),vx=dx/mag*power,vy=dy/mag*power;
    try {await send('POST',`/api/rooms/${session.code}/shoot`,{token:session.token,pieceId:sel.id,vx,vy});}
    catch(e){showToast(e.message);}
  });

  $('createRoom').addEventListener('click',()=>create(false));
  $('localRoom').addEventListener('click',()=>create(true));
  $('soloRoom').addEventListener('click',()=>create(false,true));
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
      send('GET',`/api/rooms/${code}`).then(data=>{enter({...data,token:last.token,seat:last.seat,local:last.local,bot:last.bot});}).catch(()=>{localStorage.removeItem('zoopaloola_rev_session');showToast('Alter Raum nicht mehr erreichbar. Erstelle einen neuen.');});
    }else {showToast('Einladung gefunden! Waehle ein Tier und klicke auf BEITRETEN.');}
  }
})();
