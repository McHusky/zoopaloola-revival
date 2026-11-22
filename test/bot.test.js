'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initGame,validShot}=require('../game');
const {chooseShot,optionsFor,simulate}=require('../bot');
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
