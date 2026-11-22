'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { initGame, shoot, advance, publicGame } = require('./game');
const { chooseShot } = require('./bot');

const rooms = new Map();
const PUBLIC = path.join(__dirname, 'public');
const SPECIES = new Set(['lion','elephant','monkey','hippo']);
const DIFFICULTIES = new Set(['easy','normal','hard']);
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
const safeName = s => (typeof s === 'string' ? s.trim().replace(/[<>\x00-\x1f]/g, '').slice(0,22) : '') || 'Dschungelheld';
const safeSpecies = s => SPECIES.has(s) ? s : 'lion';
const token = () => crypto.randomBytes(18).toString('hex');
function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from(crypto.randomBytes(6), b => chars[b % chars.length]).join(''); } while (rooms.has(code));
  return code;
}
function makePlayer(name, species, seat) { return { seat, name: safeName(name), species: safeSpecies(species), token: token() }; }
function makeRoom({ name, species, local = false, vsBot = false, difficulty = 'normal' }) {
  const code = roomCode();
  const players = [makePlayer(name,species,0)];
  const bot=!!vsBot&&!local;
  const level=DIFFICULTIES.has(difficulty)?difficulty:'normal';
  if (local) players.push(makePlayer('Spieler 2','hippo',1));
  if (bot) players.push(makePlayer('Computer', 'elephant',1));
  const room = { code, players, local: !!local, bot, difficulty:level, botThinking:false, game: initGame(0), phase: (local||bot) ? 'playing' : 'waiting', seq:0, streams:new Set(), updated: Date.now(), layout: 0, started: Date.now() };
  rooms.set(code,room);
  return room;
}
function state(room) {
  return { code:room.code, seq:room.seq, local:room.local, bot:room.bot, difficulty:room.difficulty, botThinking:room.botThinking, phase:room.phase,
    players:room.players.map(({seat,name,species}) => ({seat,name,species})),
    game:publicGame(room.game), online:room.players.length === 2, timestamp:Date.now() };
}
function sendJSON(res, code, obj) {
  if (res.writableEnded) return;
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(obj));
}
function broadcast(room) {
  room.seq++; room.updated = Date.now();
  const msg = `id: ${room.seq}\nevent: state\ndata: ${JSON.stringify(state(room))}\n\n`;
  for (const res of room.streams) { try {res.write(msg);} catch {room.streams.delete(res);} }
}
function identity(room, key) {
  if (room.local && key && room.players.some(p => p.token === key)) return room.players.find(p => p.token === key);
  return room.players.find(p => p.token === key);
}
const intervals = new Map();
const botTimers = new Map();
function scheduleBot(room) {
  if (!room.bot || room.game.phase !== 'playing' || room.game.turn !== 1 || botTimers.has(room.code)) return;
  room.botThinking=true;broadcast(room);
  const tid=setTimeout(()=>{
    botTimers.delete(room.code);
    if(rooms.get(room.code)!==room || room.game.phase!=='playing' || room.game.turn!==1)return;
    const shot=chooseShot(room.game,room.difficulty);
    room.botThinking=false;
    if(!shot){broadcast(room);return;}
    const err=shoot(room.game,1,shot.pieceId,shot.vx,shot.vy);
    if(!err){broadcast(room);startPhysics(room);}
  },room.difficulty==='hard'?850:650);
  botTimers.set(room.code,tid);
}
function startPhysics(room) {
  if (intervals.has(room.code)) return;
  let ticks = 0;
  const interval = setInterval(() => {
    if (room.game.phase !== 'moving') {clearInterval(interval);intervals.delete(room.code);return;}
    advance(room.game,1/60);
    ticks++;
    if(room.game.phase==='playing' && room.bot) scheduleBot(room);
    if (ticks % 3 === 0 || room.game.phase !== 'moving') broadcast(room);
  },1000/60);
  intervals.set(room.code,interval);
}
async function readBody(req) {
  return new Promise((resolve,reject) => {
    let bytes=0, parts=[];
    req.on('data',d => {bytes+=d.length;if(bytes>8192){reject(new Error('Zu grosse Anfrage'));req.destroy();}else parts.push(d);});
    req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString()||'{}'));}catch{reject(new Error('Ungueltiges JSON'));}});
    req.on('error',reject);
  });
}
function fail(res,status,reason) {sendJSON(res,status,{error:reason});}
function handleAPI(req,res,url) {
  const parts=url.pathname.split('/').filter(Boolean);
  if(parts[1]==='rooms' && parts.length===2 && req.method==='POST') {
    return readBody(req).then(body => {
      const room=makeRoom(body||{});
      const result={...state(room), token:room.players[0].token,seat:0};
      if (room.local) result.tokens=room.players.map(p=>p.token);
      sendJSON(res,201,result);
    }).catch(e=>fail(res,400,e.message));
  }
  if(parts[1]!=='rooms' || parts.length<3) return fail(res,404,'Unbekannter Endpunkt');
  const room=rooms.get((parts[2]||'').toUpperCase());
  if(!room) return fail(res,404,'Raum nicht gefunden. Vielleicht wurde der Server neu gestartet.');
  room.updated=Date.now();
  if(parts.length===3 && req.method==='GET') return sendJSON(res,200,state(room));
  if(parts[3]==='events' && req.method==='GET') {
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
    res.write(`retry: 1500\nevent: state\ndata: ${JSON.stringify(state(room))}\n\n`);
    room.streams.add(res);
    const heartbeat=setInterval(()=>{ if(!res.writableEnded){try{res.write(': heartbeat\n\n');}catch{clearInterval(heartbeat);}} },25000);
    req.on('close',()=>{room.streams.delete(res);clearInterval(heartbeat);});
    return;
  }
  if(parts[3]==='join' && req.method==='POST') return readBody(req).then(body=>{
    if(room.players.length>=2) {
      const member=identity(room,body.token);
      if(member)return sendJSON(res,200,{...state(room),seat:member.seat,token:member.token});
      return fail(res,409,'Dieser Raum ist bereits voll.');
    }
    const player=makePlayer(body.name,body.species,1);
    room.players.push(player);room.phase='playing';broadcast(room);
    return sendJSON(res,200,{...state(room),token:player.token,seat:1});
  }).catch(e=>fail(res,400,e.message));
  if(parts[3]==='shoot' && req.method==='POST')return readBody(req).then(body=>{
    const player=identity(room,body.token);
    if(!player)return fail(res,403,'Nicht angemeldet.');
    if(room.players.length<2)return fail(res,409,'Warte auf einen Mitspieler.');
    const owner=room.local ? room.game.turn : player.seat;
    const err=shoot(room.game,owner,body.pieceId,Number(body.vx),Number(body.vy));
    if(err)return fail(res,409,err);
    broadcast(room);startPhysics(room);
    return sendJSON(res,200,{ok:true,seq:room.seq});
  }).catch(e=>fail(res,400,e.message));
  if(parts[3]==='rematch' && req.method==='POST')return readBody(req).then(body=>{
    const player=identity(room,body.token);
    if(!player)return fail(res,403,'Nicht angemeldet.');
    if(room.phase!=='playing' || room.game.phase!=='finished')return fail(res,409,'Die Partie ist noch nicht vorbei.');
    room.layout=(room.layout+1)%3;
    room.game=initGame(room.layout);
    room.game.turn=room.layout%2;
    room.botThinking=false;
    broadcast(room);
    scheduleBot(room);
    return sendJSON(res,200,{ok:true,seq:room.seq});
  }).catch(e=>fail(res,400,e.message));
  return fail(res,404,'Unbekannter Endpunkt');
}
function createServer() {
  return http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    res.setHeader('x-content-type-options','nosniff');
    res.setHeader('referrer-policy','strict-origin-when-cross-origin');
    if(url.pathname==='/health')return sendJSON(res,200,{status:'ok',rooms:rooms.size});
    if(url.pathname.startsWith('/api/'))return handleAPI(req,res,url);
    if(req.method!=='GET' && req.method!=='HEAD')return fail(res,405,'Methode nicht erlaubt');
    const rel = url.pathname==='/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const filename=path.resolve(PUBLIC,rel);
    if(filename!==PUBLIC && !filename.startsWith(PUBLIC+path.sep))return fail(res,403,'Kein Zugriff');
    fs.stat(filename,(err,st)=>{
      if(err||!st.isFile())return fail(res,404,'Datei nicht gefunden');
      res.writeHead(200,{'content-type':MIME[path.extname(filename)]||'application/octet-stream','cache-control':'no-store'});
      if(req.method==='HEAD')return res.end();
      fs.createReadStream(filename).pipe(res);
    });
  });
}
const cleaner=setInterval(()=>{
  const now=Date.now();
  for(const [code,room] of rooms) {
    if(now-room.updated > 2*60*60*1000 && room.game.phase!=='moving') {
      rooms.delete(code);
      room.streams.forEach(s=>s.end());
      const timer=intervals.get(code);if(timer){clearInterval(timer);intervals.delete(code);}
      const botTimer=botTimers.get(code);if(botTimer){clearTimeout(botTimer);botTimers.delete(code);}
    }
  }
},5*60*1000);
cleaner.unref();

if(require.main===module){const PORT=Number(process.env.PORT)||3000;createServer().listen(PORT,'0.0.0.0',()=>console.log(`Zoopaloola Revival läuft auf http://localhost:${PORT}`));}
module.exports={createServer,rooms,makeRoom,state,handleAPI};
