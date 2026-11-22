'use strict';

const {MAX_POWER,POCKETS,shoot,advance,nearestPocket}=require('./game');
const clamp=(v,low,high)=>Math.max(low,Math.min(high,v));

// The CPU uses exactly the same ball physics as a human. It evaluates shots
// in a private game clone; only its chosen shot is applied to the real game.
function simulate(game,shot){
  const clone={...game,pieces:game.pieces.map(p=>({...p})),events:[],eventCounter:0};
  if(shoot(clone,1,shot.pieceId,shot.vx,shot.vy))return null;
  for(let i=0;i<1110&&clone.phase==='moving';i++)advance(clone,1/60);
  return clone;
}
function optionsFor(game){
  const allies=game.pieces.filter(p=>p.alive&&p.owner===1);
  const enemies=game.pieces.filter(p=>p.alive&&p.owner===0);
  const options=[],seen=new Set();
  function add(a,tx,ty,mult=1){
    const dx=tx-a.x,dy=ty-a.y,d=Math.hypot(dx,dy);
    if(d<10)return;
    const speed=clamp((280+d*.85)*mult,185,MAX_POWER-8);
    const key=`${a.id}:${Math.round(Math.atan2(dy,dx)*18)}:${Math.round(speed/90)}`;
    if(seen.has(key))return;
    seen.add(key);
    options.push({pieceId:a.id,vx:dx/d*speed,vy:dy/d*speed});
  }
  for(const a of allies){
    for(const e of enemies){
      const dx=e.x-a.x,dy=e.y-a.y,d=Math.hypot(dx,dy);
      if(d<1)continue;
      const perp={x:-dy/d,y:dx/d};
      // Centre and two off-centre impacts produce very different billiards shots.
      for(const offset of [0,-14,14]){
        const x=e.x+perp.x*offset,y=e.y+perp.y*offset;
        add(a,x,y,.78);add(a,x,y,1.18);
      }
      // Potting geometry: aim at the ghost contact point just behind the
      // enemy disc, so the collision transfers momentum toward a pocket.
      const nearby=POCKETS.map(p=>({...p,d:Math.hypot(e.x-p.x,e.y-p.y)})).sort((p,q)=>p.d-q.d).slice(0,2);
      for(const p of nearby){
        if(p.d<3)continue;
        const dirx=(p.x-e.x)/p.d,diry=(p.y-e.y)/p.d;
        add(a,e.x-dirx*46,e.y-diry*46,1.15);
      }
    }
  }
  return options;
}
function scoreGame(before,after){
  const alive=(g,o)=>g.pieces.filter(p=>p.alive&&p.owner===o);
  const lostEnemy=alive(before,0).length-alive(after,0).length;
  const lostAlly=alive(before,1).length-alive(after,1).length;
  let score=lostEnemy*500-lostAlly*610;
  if(after.winner===1)score+=2800;
  if(after.winner===0)score-=3300;
  const start=new Map(before.pieces.map(p=>[p.id,p]));
  for(const p of after.pieces){
    if(!p.alive)continue;
    const original=start.get(p.id);
    const near=nearestPocket(p.x,p.y).distance;
    const oldNear=nearestPocket(original.x,original.y).distance;
    if(p.owner===0){
      // Even without potting a piece, putting the opponent near the edge
      // is useful; movement of other pieces is rewarded only a little.
      score+=clamp((oldNear-near)*.46,-25,65);
      score+=Math.min(26,Math.hypot(p.x-original.x,p.y-original.y)*.055);
    } else {
      score-=Math.max(0,(oldNear-near)*.22);
    }
  }
  return score;
}
function chooseShot(game,difficulty='normal'){
  if(game.phase!=='playing'||game.turn!==1)return null;
  const opts=optionsFor(game);
  if(!opts.length)return null;
  const max=difficulty==='easy'?58:difficulty==='hard'?230:110;
  // Deterministic stride so all difficulties consider shots from all animals.
  const candidates=opts.length<=max?opts:Array.from({length:max},(_,i)=>opts[Math.floor(i*opts.length/max)]);
  let best=null,bestScore=-Infinity;
  const shotNumber=game.shots||0;
  for(let i=0;i<candidates.length;i++){
    const shot=candidates[i],out=simulate(game,shot);
    if(!out)continue;
    let score=scoreGame(game,out);
    const jitter=Math.sin(i*17.31+shotNumber*7.77)*Math.cos(i*1.93+game.layout);
    score+=jitter*(difficulty==='easy'?130:difficulty==='hard'?2:33);
    if(score>bestScore){bestScore=score;best=shot;}
  }
  return best||opts[0];
}
module.exports={chooseShot,optionsFor,scoreGame,simulate};
