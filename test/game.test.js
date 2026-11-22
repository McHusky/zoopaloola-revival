'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initGame,shoot,advance,settle,validShot,pocketAt,BALL_R,FIELD,newPieces,POCKETS,nearestPocket}=require('../game');

test('every starting layout has six distinct discs for each player',()=>{
  for(let i=0;i<3;i++){
    const discs=newPieces(i);
    assert.equal(discs.length,12);
    assert.equal(discs.filter(p=>p.owner===0).length,6);
    assert.equal(discs.filter(p=>p.owner===1).length,6);
    for(let j=0;j<discs.length;j++)for(let k=j+1;k<discs.length;k++)
      assert.ok(Math.hypot(discs[j].x-discs[k].x,discs[j].y-discs[k].y)>BALL_R*2-2,`layout ${i} overlap ${j}/${k}`);
  }
});
test('cannot shoot opponents disc or shoot out of turn',()=>{
  const g=initGame(0);
  assert.match(validShot(g,0,'p1-0',500,0),/eines deiner/);
  assert.match(validShot(g,1,'p1-0',500,0),/noch nicht/);
  assert.equal(shoot(g,0,'p0-0',500,0),null);
  assert.match(shoot(g,0,'p0-1',400,0),/nicht moeglich/);
});
test('power must be finite and within limits',()=>{
  const g=initGame(0);
  assert.ok(validShot(g,0,'p0-0',Infinity,0));
  assert.ok(validShot(g,0,'p0-0',20,0));
  assert.ok(validShot(g,0,'p0-0',2000,0));
});
test('a standard shot settles and alternates turns',()=>{
  const g=initGame(0);
  assert.equal(shoot(g,0,'p0-0',300,10),null);
  for(let i=0;i<1200&&g.phase==='moving';i++)advance(g);
  assert.equal(g.phase,'playing');
  assert.equal(g.turn,1);
  assert.equal(g.shots,1);
});
test('wall rebounds outside gaps and open pockets identify the correct effect',()=>{
  assert.equal(pocketAt('top',480).effect,'ice');
  assert.equal(pocketAt('top',264),null);
  assert.deepEqual(POCKETS.map(p=>p.id),['tl','tm','tr','bl','bm','br']);
  const g=initGame(0);
  const p=g.pieces[0];
  g.pieces.slice(1).forEach(x=>x.alive=false);
  p.x=400;p.y=FIELD.top+BALL_R+1;p.vy=-210;
  g.phase='moving';advance(g);
  assert.ok(p.vy>0);
  assert.equal(p.alive,true);
});
test('disc falling into pocket is removed with hazard event',()=>{
  const g=initGame(0);g.phase='moving';
  const p=g.pieces[0];g.pieces.slice(1).forEach(x=>x.alive=false);
  p.x=480;p.y=FIELD.top+BALL_R+19;p.vy=-330;
  for(let i=0;i<30&&p.alive;i++)advance(g);
  assert.equal(p.alive,false);
  assert.ok(g.events.some(e=>e.type==='pocket'&&e.effect==='ice'));
});
test('last animal standing wins',()=>{
  const g=initGame(0);
  g.pieces.filter(p=>p.owner===1).forEach(p=>p.alive=false);
  g.phase='moving';settle(g);
  assert.equal(g.phase,'finished');assert.equal(g.winner,0);
});
test('both players knocked out ends in a draw',()=>{
  const g=initGame(0);
  g.pieces.forEach(p=>p.alive=false);
  g.phase='moving';settle(g);
  assert.equal(g.phase,'finished');assert.equal(g.winner,-1);
});

test('corner pockets capture a ball and report the exact trap position for animation',()=>{
  const g=initGame();g.phase='moving';
  const p=g.pieces[0];g.pieces.slice(1).forEach(x=>x.alive=false);
  p.x=FIELD.left+BALL_R+20;p.y=FIELD.top+BALL_R+20;
  p.vx=-550;p.vy=-550;
  for(let i=0;i<20&&p.alive;i++)advance(g);
  assert.equal(p.alive,false);
  const event=g.events.find(e=>e.type==='pocket');
  assert.equal(event.effect,'laser');
  assert.equal(event.pocketId,'tl');
  assert.equal(event.pocketX,FIELD.left);
  assert.equal(event.pocketY,FIELD.top);
});
test('no pockets appear in the middle of left and right rails',()=>{
  assert.equal(POCKETS.length,6);
  assert.equal(POCKETS.filter(p=>p.side==='corner').length,4);
  assert.equal(POCKETS.filter(p=>p.side==='top').length,1);
  assert.equal(POCKETS.filter(p=>p.side==='bottom').length,1);
  const g=initGame();g.phase='moving';
  const p=g.pieces[0];g.pieces.slice(1).forEach(x=>x.alive=false);
  p.x=FIELD.left+BALL_R+1;p.y=FIELD.top+250;p.vx=-320;p.vy=0;
  for(let i=0;i<8;i++)advance(g);
  assert.equal(p.alive,true);
  assert.ok(p.vx>0,'the cushion rebounds the disc');
});
test('billiard energy transfers from the shooter to the target',()=>{
  const g=initGame();g.phase='moving';
  const a=g.pieces[0],b=g.pieces[1];
  g.pieces.slice(2).forEach(p=>p.alive=false);
  a.x=300;a.y=360;a.vx=540;a.vy=0;
  b.x=357;b.y=360;b.vx=0;b.vy=0;
  for(let i=0;i<12;i++)advance(g);
  assert.ok(b.vx>300,`target picks up the speed, got ${b.vx}`);
  assert.ok(a.vx<120,`striker slows down on impact, got ${a.vx}`);
});

test('all rounds start with the same alternating twelve-animal ring',()=>{
  const initial=newPieces(0);
  for(const layout of [1,2,3,9,27]){
    const pieces=newPieces(layout);
    assert.deepEqual(pieces.map(p=>[p.id,p.owner,p.x,p.y]),initial.map(p=>[p.id,p.owner,p.x,p.y]));
  }
  const cx=480,cy=373,rx=196,ry=171;
  for(let i=0;i<initial.length;i++){
    const p=initial[i];
    const ellipse=(p.x-cx)**2/rx**2+(p.y-cy)**2/ry**2;
    assert.ok(Math.abs(ellipse-1)<1e-10,`piece ${p.id} must be on the ring`);
    assert.equal(p.owner,i%2,'the teams must alternate around the ring');
    assert.ok(p.x>FIELD.left+BALL_R&&p.x<FIELD.right-BALL_R);
    assert.ok(p.y>FIELD.top+BALL_R&&p.y<FIELD.bottom-BALL_R);
  }
});

test('exactly 100 percent power is a legal shot',()=>{
  const g=initGame();
  const {MAX_POWER}=require('../game');
  assert.equal(validShot(g,0,'p0-0',MAX_POWER,0),null);
  assert.equal(shoot(g,0,'p0-0',MAX_POWER,0),null);
  assert.equal(Math.hypot(g.pieces[0].vx,g.pieces[0].vy),MAX_POWER);
});
