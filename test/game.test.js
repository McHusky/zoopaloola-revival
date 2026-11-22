'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initGame,shoot,advance,settle,validShot,pocketAt,BALL_R,FIELD,newPieces}=require('../game');

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
  assert.equal(pocketAt('top',264).effect,'ice');
  assert.equal(pocketAt('top',400),null);
  const g=initGame(0);
  const p=g.pieces[0];
  g.pieces.slice(1).forEach(x=>x.alive=false);
  p.x=480;p.y=FIELD.top+BALL_R+1;p.vy=-210;
  g.phase='moving';advance(g);
  assert.ok(p.vy>0);
  assert.equal(p.alive,true);
});
test('disc falling into pocket is removed with hazard event',()=>{
  const g=initGame(0);g.phase='moving';
  const p=g.pieces[0];g.pieces.slice(1).forEach(x=>x.alive=false);
  p.x=264;p.y=FIELD.top+BALL_R-2;p.vy=-330;
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
