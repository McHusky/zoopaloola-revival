'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initGame,validShot}=require('../game');
const {chooseShot,optionsFor,simulate}=require('../bot');

function seededRandom(seed){
  return ()=>{
    let t=seed+=0x6D2B79F5;
    t=Math.imul(t^t>>>15,t|1);
    t^=t+Math.imul(t^t>>>7,t|61);
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
test('CPU can pick a physics-valid shot on three difficulty levels',()=>{
  for(const level of ['easy','normal','hard']){
    const g=initGame();g.turn=1;
    const option=chooseShot(g,level);
    assert.ok(option);
    assert.equal(validShot(g,1,option.pieceId,option.vx,option.vy),null);
    assert.ok(simulate(g,option).shots===1);
  }
});
test('CPU never takes a human move and considers real ball trajectories',()=>{
  const g=initGame();
  assert.equal(chooseShot(g,'hard'),null);
  g.turn=1;
  assert.ok(optionsFor(g).length>50);
  assert.equal(chooseShot(g,'hard').pieceId.startsWith('p1-'),true);
});

test('Normal remains a challenge but no longer pockets the opener perfectly every turn',()=>{
  const g=initGame();g.turn=1;
  let normalPots=0;
  const shots=[];
  for(let i=1;i<=20;i++){
    const shot=chooseShot(g,'normal',seededRandom(i*81271));
    assert.equal(validShot(g,1,shot.pieceId,shot.vx,shot.vy),null);
    shots.push(`${shot.pieceId}:${Math.round(shot.vx)}:${Math.round(shot.vy)}`);
    const after=simulate(g,shot);
    normalPots+=after.pieces.some(p=>p.owner===0&&!p.alive)?1:0;
  }
  assert.ok(normalPots>0,'Normal must remain capable of potting balls');
  assert.ok(normalPots<20,'Normal must sometimes miss rather than always execute perfect shots');
  assert.ok(new Set(shots).size>5,'Normal must not use a fixed scripted miss');
});

test('Hard keeps exact execution while Normal has natural aim and power variance',()=>{
  const g=initGame();g.turn=1;
  const hard=chooseShot(g,'hard',seededRandom(1));
  assert.deepEqual(hard,chooseShot(g,'hard',seededRandom(2)));
  const sameRandom=()=>0.5;
  const perfectNormal=chooseShot(g,'normal',sameRandom);
  const variedNormal=chooseShot(g,'normal',()=>0.9);
  assert.notDeepEqual(perfectNormal,variedNormal);
  assert.equal(validShot(g,1,variedNormal.pieceId,variedNormal.vx,variedNormal.vy),null);
});
