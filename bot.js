'use strict';

const {MAX_POWER,POCKETS,shoot,advance,nearestPocket}=require('./game');
const clamp=(v,low,high)=>Math.max(low,Math.min(high,v));

// On Easy and Normal the computer can still identify promising shots, but it
// does not execute them with the perfect precision of the physics simulator.
// Hard deliberately retains the previous precise, deeper search.
const SKILL = Object.freeze({
  easy:   Object.freeze({candidates:22, judgement:230, angle:14, power:0.18, slipChance:0.23, slipAngle:12}),
  normal: Object.freeze({candidates:42, judgement:115, angle:2.7, power:0.075, slipChance:0.20, slipAngle:7.5}),
  hard:   Object.freeze({candidates:230,judgement:2,   angle:0, power:0, slipChance:0, slipAngle:0})
});

function imperfectShot(shot,skill,random){
  if(!skill.angle && !skill.power)return shot;
  // Clamp custom RNG values (also makes deterministic testing possible).
  const draw=()=>{
    const value=Number(random());
    return Number.isFinite(value)?clamp(value,0,1-Number.EPSILON):0.5;
  };
  const signed=()=>draw()*2-1;
  let angle=Math.atan2(shot.vy,shot.vx)+signed()*skill.angle*Math.PI/180;
  // An occasional, larger misjudgement simulates a rushed human shot.
  if(draw()<skill.slipChance)angle+=signed()*skill.slipAngle*Math.PI/180;
  const power=clamp(Math.hypot(shot.vx,shot.vy)*(1+signed()*skill.power),40,MAX_POWER);
  return {pieceId:shot.pieceId,vx:Math.cos(angle)*power,vy:Math.sin(angle)*power};
}

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
function chooseShot(game,difficulty='normal',random=Math.random){
  if(game.phase!=='playing'||game.turn!==1)return null;
  const opts=optionsFor(game);
  if(!opts.length)return null;
  const skill=SKILL[difficulty]||SKILL.normal;
  const max=skill.candidates;
  // Deterministic stride so all difficulties consider shots from all animals.
  const candidates=opts.length<=max?opts:Array.from({length:max},(_,i)=>opts[Math.floor(i*opts.length/max)]);
  let best=null,bestScore=-Infinity;
  const shotNumber=game.shots||0;
  for(let i=0;i<candidates.length;i++){
    const shot=candidates[i],out=simulate(game,shot);
    if(!out)continue;
    let score=scoreGame(game,out);
    const jitter=Math.sin(i*17.31+shotNumber*7.77)*Math.cos(i*1.93+game.layout);
    score+=jitter*skill.judgement;
    if(score>bestScore){bestScore=score;best=shot;}
  }
  return imperfectShot(best||opts[0],skill,random);
}
module.exports={chooseShot,optionsFor,scoreGame,simulate};
