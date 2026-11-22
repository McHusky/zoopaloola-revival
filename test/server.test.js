'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createServer,rooms}=require('../server');

function serverHarness() {
  const server=createServer();
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{
    const url=`http://127.0.0.1:${server.address().port}`;
    const call=async(method,path,body)=>{
      const res=await fetch(url+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
      return {status:res.status,data:await res.json()};
    };
    resolve({call,server,close:()=>new Promise(done=>server.close(done))});
  }));
}

test('create, join, protected shots, and prevent a third player',async()=>{
  const s=await serverHarness();
  try {
    const create=await s.call('POST','/api/rooms',{name:'Sunny',species:'lion'});
    assert.equal(create.status,201);const {code,token:host}=create.data;
    assert.match(code,/^[A-Z2-9]{6}$/);assert.equal(create.data.phase,'waiting');
    const get=await s.call('GET',`/api/rooms/${code}`);
    assert.equal(get.status,200);assert.equal(get.data.players.length,1);
    assert.equal(get.data.token,undefined);
    const join=await s.call('POST',`/api/rooms/${code}/join`,{name:'Moon',species:'hippo'});
    assert.equal(join.status,200);assert.equal(join.data.phase,'playing');assert.equal(join.data.players.length,2);
    const third=await s.call('POST',`/api/rooms/${code}/join`,{name:'Interloper'});
    assert.equal(third.status,409);
    const imposter=await s.call('POST',`/api/rooms/${code}/shoot`,{token:'wrong',pieceId:'p0-0',vx:400,vy:0});
    assert.equal(imposter.status,403);
    const outOfTurn=await s.call('POST',`/api/rooms/${code}/shoot`,{token:join.data.token,pieceId:'p1-0',vx:300,vy:0});
    assert.equal(outOfTurn.status,409);
    const shot=await s.call('POST',`/api/rooms/${code}/shoot`,{token:host,pieceId:'p0-0',vx:250,vy:0});
    assert.equal(shot.status,200);
    const another=await s.call('POST',`/api/rooms/${code}/shoot`,{token:host,pieceId:'p0-1',vx:250,vy:0});
    assert.equal(another.status,409);
  }finally{await s.close();}
});
test('local play can be created with both seats on one device',async()=>{
  const s=await serverHarness();
  try {
    const r=await s.call('POST','/api/rooms',{name:'Test',local:true});
    assert.equal(r.status,201);assert.equal(r.data.players.length,2);
    assert.equal(r.data.local,true);assert.equal(r.data.tokens.length,2);
    const code=r.data.code;
    const rematch=await s.call('POST',`/api/rooms/${code}/rematch`,{token:r.data.token});
    assert.equal(rematch.status,409);
  }finally{await s.close();}
});
test('public page and health endpoint are available',async()=>{
  const s=await serverHarness();
  try {
    const health=await s.call('GET','/health');assert.equal(health.data.status,'ok');
    const r=await fetch(`http://127.0.0.1:${s.server.address().port}/`);
    assert.equal(r.status,200);assert.match(await r.text(),/Zoopaloola Revival/);
  }finally{await s.close();}
});

test('server-sent events stream delivers new room state after joining',async()=>{
  const s=await serverHarness();
  const ctl=new AbortController();
  try {
    const created=await s.call('POST','/api/rooms',{name:'A',species:'monkey'});
    const code=created.data.code;
    const raw=await fetch(`http://127.0.0.1:${s.server.address().port}/api/rooms/${code}/events`,{signal:ctl.signal});
    assert.equal(raw.status,200);assert.match(raw.headers.get('content-type'),/text\/event-stream/);
    const reader=raw.body.getReader();
    const initial=await reader.read();
    assert.match(Buffer.from(initial.value).toString(),/waiting/);
    const joined=await s.call('POST',`/api/rooms/${code}/join`,{name:'B',species:'elephant'});
    assert.equal(joined.status,200);
    const update=await reader.read();
    assert.match(Buffer.from(update.value).toString(),/playing/);
    await reader.cancel();
  } finally { ctl.abort();await s.close(); }
});

test('solo mode creates an immediate match against a server-side CPU',async()=>{
  const s=await serverHarness();
  try{
    const created=await s.call('POST','/api/rooms',{name:'Human',species:'monkey',vsBot:true,difficulty:'hard'});
    assert.equal(created.status,201);
    assert.equal(created.data.phase,'playing');
    assert.equal(created.data.players.length,2);
    assert.equal(created.data.players[1].name,'Computer');
    assert.equal(created.data.bot,true);
    assert.equal(created.data.difficulty,'hard');
    assert.equal(created.data.tokens,undefined);
    assert.equal((await s.call('POST',`/api/rooms/${created.data.code}/join`,{name:'Cheater'})).status,409);
    assert.equal((await s.call('POST',`/api/rooms/${created.data.code}/shoot`,{token:created.data.token,pieceId:'p1-0',vx:500,vy:0})).status,409);
  }finally{await s.close();}
});
test('the CPU automatically responds after a player shot finishes', {timeout:12000}, async()=>{
  const s=await serverHarness();
  try{
    const created=await s.call('POST','/api/rooms',{name:'Human',vsBot:true,difficulty:'easy'});
    assert.equal((await s.call('POST',`/api/rooms/${created.data.code}/shoot`,{
      token:created.data.token,pieceId:'p0-0',vx:210,vy:0
    })).status,200);
    let final=null;
    for(let i=0;i<65;i++){
      await new Promise(r=>setTimeout(r,100));
      const next=await s.call('GET',`/api/rooms/${created.data.code}`);
      final=next.data;
      if(final.game.shots>=2)break;
    }
    assert.ok(final.game.shots>=2,'the bot must shoot automatically without a second browser');
  } finally{await s.close();}
});

test('all game modes start in the same ring and accept full-power shots',async()=>{
  const s=await serverHarness();
  try{
    const common=await s.call('POST','/api/rooms',{name:'Local',local:true});
    const solo=await s.call('POST','/api/rooms',{name:'Human',vsBot:true,difficulty:'easy'});
    const online=await s.call('POST','/api/rooms',{name:'Host'});
    const join=await s.call('POST',`/api/rooms/${online.data.code}/join`,{name:'Guest'});
    assert.equal(join.status,200);
    const starts=[common.data.game.pieces,solo.data.game.pieces,online.data.game.pieces];
    for(const pieces of starts){
      assert.deepEqual(pieces.map(p=>[p.id,p.x,p.y]),starts[0].map(p=>[p.id,p.x,p.y]));
    }
    for(const created of [common,solo,online]){
      const response=await s.call('POST',`/api/rooms/${created.data.code}/shoot`,
        {token:created.data.token,pieceId:'p0-0',vx:0,vy:1020});
      assert.equal(response.status,200,`full power must work in ${created.data.code}: ${response.data.error}`);
    }
  }finally{await s.close();}
});


test('rematches keep the circular formation',async()=>{
  const s=await serverHarness();
  try {
    const created=await s.call('POST','/api/rooms',{name:'Two friends',local:true});
    const {code,token}=created.data;
    rooms.get(code).game.phase='finished';
    const rematch=await s.call('POST',`/api/rooms/${code}/rematch`,{token});
    assert.equal(rematch.status,200);
    const replay=await s.call('GET',`/api/rooms/${code}`);
    assert.equal(replay.data.game.phase,'playing');
    assert.deepEqual(replay.data.game.pieces.map(p=>[p.id,p.x,p.y]),
      created.data.game.pieces.map(p=>[p.id,p.x,p.y]));
  }finally{await s.close();}
});
