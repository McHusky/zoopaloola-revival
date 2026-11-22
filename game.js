'use strict';

// Original-inspired billiards rules, built from scratch. Both AI and multiplayer
// use exactly this deterministic, authoritative physics engine.
const WIDTH = 960;
const HEIGHT = 720;
const FIELD = Object.freeze({left:108, right:852, top:122, bottom:624});
const BALL_R = 23;
const MAX_POWER = 1020;
const FRICTION = 174;             // felt resistance: pixels/s^2
const BALL_RESTITUTION = 0.963;   // billiard ball collision
const CUSHION_RESTITUTION = 0.89; // rubber rails

// Four corner pockets plus one in the centre of each long rail, as on a
// traditional six-pocket table. Each trap has its own removal sequence.
const POCKETS = Object.freeze([
  {id:'tl', side:'corner', x:FIELD.left, y:FIELD.top, effect:'laser', capture:43, mouth:69},
  {id:'tm', side:'top', x:WIDTH/2, y:FIELD.top, effect:'ice', capture:43, mouth:60},
  {id:'tr', side:'corner', x:FIELD.right, y:FIELD.top, effect:'hammer', capture:43, mouth:69},
  {id:'bl', side:'corner', x:FIELD.left, y:FIELD.bottom, effect:'fire', capture:43, mouth:69},
  {id:'bm', side:'bottom', x:WIDTH/2, y:FIELD.bottom, effect:'spark', capture:43, mouth:60},
  {id:'br', side:'corner', x:FIELD.right, y:FIELD.bottom, effect:'water', capture:43, mouth:69}
]);

function newPieces(layout=0) {
  const pieces=[];
  function add(owner,x,y) {
    const count=pieces.filter(p=>p.owner===owner).length;
    pieces.push({id:`p${owner}-${count}`,owner,x,y,vx:0,vy:0,alive:true,r:BALL_R});
  }
  if(layout%3===0){
    const ys=[195,265,335,408,478,548];
    ys.forEach((y,i)=>{add(0, i%2?327:255, y);add(1, i%2?633:705, y);});
  }else if(layout%3===1){
    for(let i=0;i<12;i++){
      const a=(Math.PI*2*i/12)-Math.PI/2;
      add(i%2,480+Math.cos(a)*196,373+Math.sin(a)*171);
    }
  }else{
    const coords=[[250,245],[310,205],[324,315],[250,431],[310,505],[377,372]];
    coords.forEach(([x,y])=>add(0,x,y));
    coords.forEach(([x,y])=>add(1,960-x,746-y));
  }
  return pieces;
}

function initGame(layout=0) {
  return {pieces:newPieces(layout),turn:0,phase:'playing',winner:null,shots:0,frame:0,
    quiet:0,events:[],layout,lastAction:'',lastShotBy:null,lastHitFrame:-200,eventCounter:0};
}
function validShot(game,owner,pieceId,vx,vy) {
  if(game.phase!=='playing')return 'Schuss gerade nicht moeglich.';
  if(owner!==game.turn)return 'Du bist noch nicht am Zug.';
  const p=game.pieces.find(d=>d.id===pieceId&&d.alive);
  if(!p||p.owner!==owner)return 'Waehle eines deiner Tiere.';
  if(!Number.isFinite(vx)||!Number.isFinite(vy))return 'Ungueltiger Schuss.';
  const mag=Math.hypot(vx,vy);
  if(mag<35||mag>MAX_POWER+1)return 'Schusskraft ausserhalb des gueltigen Bereichs.';
  return null;
}
function event(game,type,details={}){
  game.events.push({seq:++game.eventCounter,type,...details});
  if(game.events.length>55)game.events.splice(0,game.events.length-55);
}
function shoot(game,owner,pieceId,vx,vy) {
  const error=validShot(game,owner,pieceId,vx,vy);
  if(error)return error;
  const p=game.pieces.find(d=>d.id===pieceId);
  p.vx=vx;p.vy=vy;
  game.phase='moving';game.quiet=0;game.frame=0;game.shots++;
  game.lastShotBy=owner;game.lastAction=`Stoß ${game.shots}`;
  event(game,'shot',{owner,x:p.x,y:p.y,pieceId});
  return null;
}
function nearestPocket(x,y){
  let best=null,bestDist=Infinity;
  for(const pocket of POCKETS){
    const d=Math.hypot(x-pocket.x,y-pocket.y);
    if(d<bestDist){best=pocket;bestDist=d;}
  }
  return {pocket:best,distance:bestDist};
}
function pocketAt(side,pos){
  if(side==='top'||side==='bottom')return POCKETS.find(p=>p.side===side&&Math.abs(p.x-pos)<p.mouth)||null;
  return null;
}
function pocket(game,piece,hazard){
  if(!piece.alive)return;
  piece.alive=false;
  event(game,'pocket',{pieceId:piece.id,owner:piece.owner,effect:hazard.effect,
    side:hazard.side,pocketId:hazard.id,pocketX:hazard.x,pocketY:hazard.y,
    x:piece.x,y:piece.y,vx:piece.vx,vy:piece.vy});
  piece.vx=0;piece.vy=0;
}
function isRailOpening(side,coord){
  if(side==='top'||side==='bottom'){
    return coord<FIELD.left+69||coord>FIELD.right-69||Math.abs(coord-WIDTH/2)<60;
  }
  return coord<FIELD.top+69||coord>FIELD.bottom-69;
}
function resolveCushions(game,p){
  const r=BALL_R;
  if(p.y<FIELD.top+r&&!isRailOpening('top',p.x)){
    p.y=FIELD.top+r;p.vy=Math.abs(p.vy)*CUSHION_RESTITUTION;p.vx*=0.995;
  }
  if(p.y>FIELD.bottom-r&&!isRailOpening('bottom',p.x)){
    p.y=FIELD.bottom-r;p.vy=-Math.abs(p.vy)*CUSHION_RESTITUTION;p.vx*=0.995;
  }
  if(p.x<FIELD.left+r&&!isRailOpening('left',p.y)){
    p.x=FIELD.left+r;p.vx=Math.abs(p.vx)*CUSHION_RESTITUTION;p.vy*=0.995;
  }
  if(p.x>FIELD.right-r&&!isRailOpening('right',p.y)){
    p.x=FIELD.right-r;p.vx=-Math.abs(p.vx)*CUSHION_RESTITUTION;p.vy*=0.995;
  }
  // Rounded jaws deflect shallow shots rather than allowing free passage
  // through a rail away from a proper pocket mouth.
  for(const hazard of POCKETS){
    if(hazard.side==='corner')continue;
    const dx=p.x-hazard.x,dy=p.y-hazard.y;
    if(Math.abs(dx)>hazard.mouth-2||Math.abs(dy)>BALL_R+5)continue;
    // The central mouth is handled by pocket capture; no invisible walls.
  }
}
function resolveBalls(game,active){
  const diameter=BALL_R*2;
  for(let i=0;i<active.length;i++){
    const a=active[i];if(!a.alive)continue;
    for(let j=i+1;j<active.length;j++){
      const b=active[j];if(!b.alive)continue;
      let dx=b.x-a.x,dy=b.y-a.y;
      let distance=Math.hypot(dx,dy);
      if(distance>=diameter)continue;
      if(distance<0.000001){dx=1;dy=0;distance=1;}
      const nx=dx/distance,ny=dy/distance;
      const correction=(diameter-distance)*0.502;
      a.x-=nx*correction;a.y-=ny*correction;
      b.x+=nx*correction;b.y+=ny*correction;
      const rv=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
      if(rv>=0)continue;
      const impulse=-(1+BALL_RESTITUTION)*rv/2; // equal mass, elastic transfer
      a.vx-=impulse*nx;a.vy-=impulse*ny;
      b.vx+=impulse*nx;b.vy+=impulse*ny;
      if(rv<-110&&game.frame-game.lastHitFrame>=7){
        event(game,'hit',{x:(a.x+b.x)/2,y:(a.y+b.y)/2,strength:Math.min(1,-rv/700)});
        game.lastHitFrame=game.frame;
      }
    }
  }
}
function simulateStep(game,dt){
  const active=game.pieces.filter(p=>p.alive);
  for(const p of active){
    const speed=Math.hypot(p.vx,p.vy);
    if(speed<3){p.vx=0;p.vy=0;continue;}
    const after=Math.max(0,speed-FRICTION*dt);
    const mult=after/speed;
    p.vx*=mult;p.vy*=mult;
    p.x+=p.vx*dt;p.y+=p.vy*dt;
  }
  resolveBalls(game,active);
  for(const p of active){
    if(!p.alive)continue;
    const near=nearestPocket(p.x,p.y);
    if(near.distance<near.pocket.capture){pocket(game,p,near.pocket);continue;}
    resolveCushions(game,p);
    // A ball that crossed a mouth continues into its trap instead of
    // disappearing outside the playing surface without an animation.
    if(p.x<FIELD.left-46||p.x>FIELD.right+46||p.y<FIELD.top-46||p.y>FIELD.bottom+46){
      pocket(game,p,near.pocket);
    }
  }
}
function advance(game,dt=1/60){
  if(game.phase!=='moving')return;
  dt=Math.min(Math.max(dt,1/120),1/30);
  const fastest=Math.max(0,...game.pieces.filter(p=>p.alive).map(p=>Math.hypot(p.vx,p.vy)));
  const n=fastest>700?3:fastest>360?2:1;
  for(let k=0;k<n;k++)simulateStep(game,dt/n);
  game.frame++;
  const remaining=game.pieces.filter(p=>p.alive);
  for(const p of remaining)if(Math.hypot(p.vx,p.vy)<8){p.vx=0;p.vy=0;}
  const quiet=remaining.every(p=>p.vx===0&&p.vy===0);
  game.quiet=quiet?game.quiet+1:0;
  if(game.quiet>=10||game.frame>1100)settle(game);
}
function settle(game){
  game.pieces.forEach(p=>{p.vx=0;p.vy=0;});
  const left=[0,1].map(owner=>game.pieces.filter(p=>p.alive&&p.owner===owner).length);
  if(left[0]===0||left[1]===0){
    game.phase='finished';game.winner=left[0]>0?0:left[1]>0?1:-1;
    game.lastAction=game.winner===-1?'Unentschieden!':`Team ${game.winner+1} gewinnt!`;
    event(game,'finish',{winner:game.winner});
  }else{
    game.phase='playing';game.turn=1-game.turn;
    game.lastAction=`Team ${game.turn+1} ist dran`;
    event(game,'turn',{owner:game.turn});
  }
}
function publicGame(game){
  return {pieces:game.pieces.map(({id,owner,x,y,vx,vy,alive})=>({id,owner,x:Math.round(x*10)/10,y:Math.round(y*10)/10,vx:Math.round(vx),vy:Math.round(vy),alive})),
    turn:game.turn,phase:game.phase,winner:game.winner,shots:game.shots,lastAction:game.lastAction,
    layout:game.layout,events:game.events.slice(-30),remaining:[0,1].map(o=>game.pieces.filter(p=>p.owner===o&&p.alive).length)};
}
module.exports={WIDTH,HEIGHT,FIELD,BALL_R,MAX_POWER,POCKETS,FRICTION,initGame,newPieces,validShot,shoot,advance,settle,publicGame,pocketAt,nearestPocket};
