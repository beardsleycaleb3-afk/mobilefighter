// ============================================================================
// main.js — ties engine + combat + entities + render + vm together.
// This is where "input -> update -> render, repeat" actually happens.
// ============================================================================

(function(){
"use strict";

const W = 300, H = 500, GROUND_Y = 380;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = true;

let assets = null;
let animTable = null;
let camX = 0;
let frameCount = 0;

// ---------------------------------------------------------------- Audio ----
let actx = null;
function ensureAudio(){
  if (actx) return;
  try { actx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){ actx=null; }
  if (actx && actx.state==='suspended') actx.resume();
}
function beep(freq,dur,type,vol){
  if(!actx) return;
  const o=actx.createOscillator(), g=actx.createGain();
  o.type=type||'square'; o.frequency.value=freq; g.gain.value=vol!==undefined?vol:0.08;
  o.connect(g); g.connect(actx.destination);
  const t=actx.currentTime;
  g.gain.setValueAtTime(g.gain.value,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  o.start(t); o.stop(t+dur);
}
const SFX = {
  hit: () => beep(160,0.09,'square',0.09),
  kick: () => beep(110,0.12,'sawtooth',0.09),
  jump: () => beep(440,0.08,'sine',0.06),
  gem: () => { beep(880,0.1,'sine',0.07); beep(1320,0.08,'sine',0.05); },
  hurt: () => beep(90,0.15,'sawtooth',0.09),
  special: () => { beep(220,0.05,'square',0.08); beep(440,0.05,'square',0.08); beep(660,0.15,'square',0.08); },
  levelup: () => { beep(523,0.08,'sine',0.07); beep(659,0.08,'sine',0.07); beep(784,0.16,'sine',0.08); },
  boss: () => beep(60,0.4,'sawtooth',0.1)
};

// ------------------------------------------------------------- Input -------
const keys = { left:false, right:false, jump:false, punch:false, kick:false, special:false };
const inputQueue = Combat.makeInputQueue(3);

function bindBtn(id, key){
  const el = document.getElementById(id);
  function on(e){ e.preventDefault(); ensureAudio(); keys[key]=true; el.classList.add('active'); }
  function off(e){ e.preventDefault(); keys[key]=false; el.classList.remove('active'); }
  el.addEventListener('touchstart', on, {passive:false});
  el.addEventListener('touchend', off, {passive:false});
  el.addEventListener('touchcancel', off, {passive:false});
}

// --------------------------------------------------------- Toast / cards ---
const toastEl = document.getElementById('toast');
let toastTicks = 0;
function toast(msg){ toastEl.textContent = msg; toastEl.style.opacity = 1; toastTicks = 48; }
const bossCardEl = document.getElementById('bossCard');
function showBossCard(name, sub){
  document.getElementById('bossName').textContent = name;
  document.getElementById('bossSub').textContent = sub;
  bossCardEl.style.opacity = 1;
  setTimeout(() => { bossCardEl.style.opacity = 0; }, 1600);
}

// ------------------------------------------------------- Progression -------
let level, xp, xpToNext, gems, specialMeter, comboCount, comboTicks, flameBuffTicks;
let upgrades;
let killTally;

function resetProgression(){
  level=1; xp=0; xpToNext=30; gems=0; specialMeter=0;
  upgrades = { dmg:0, hp:0, reach:0 };
  comboCount=0; comboTicks=0; flameBuffTicks=0;
  killTally = { rock:0, vine:0, flame:0, ninja:0, shadow:0, boss:0 };
  inputQueue.clear();
}

function gainXP(n){
  if (flameBuffTicks>0) n = Math.round(n*1.25);
  xp += n;
  while (xp >= xpToNext){
    xp -= xpToNext; level++; xpToNext = Math.floor(xpToNext*1.35)+10;
    player.maxHp += 12; player.hp = Math.min(player.maxHp, player.hp+player.maxHp);
    SFX.levelup(); toast('LEVEL UP! LV'+level);
  }
  document.getElementById('lvlLabel').textContent = 'LV '+level;
  document.getElementById('xpBarFill').style.width = (100*xp/xpToNext)+'%';
}
function addCombo(){
  comboCount++; comboTicks=42;
  const cl = document.getElementById('comboLabel');
  if (comboCount>1){ cl.textContent='COMBO x'+comboCount; cl.style.opacity=1; }
  specialMeter = Math.min(100, specialMeter + (flameBuffTicks>0?11:7));
  document.getElementById('specBarFill').style.width = specialMeter+'%';
}
function updateFlameHud(){
  const el = document.getElementById('flameLabel');
  if (flameBuffTicks>0){ el.style.opacity=1; el.textContent = '🔥 '+Math.ceil(flameBuffTicks/60)+'s'; }
  else el.style.opacity=0;
}
function updateKillTallyHud(){
  document.getElementById('killTally').textContent =
    '🪨'+killTally.rock+' 🌿'+killTally.vine+' 🔥'+killTally.flame+' 🥷'+killTally.ninja+' 👹'+killTally.shadow+' 👑'+killTally.boss;
}

// ------------------------------------------------------------- Zones -------
let zoneIndex = 0;
let levelLen = 1300;
let enemies = [], hazards = [], gemsList = [], flamesList = [];
let bgPatterns = null;
let bakedZoneKey = null;
let bossIntroShown = false;
let vm = QDBP.makeVM(1);

const ZONES = [
  { name:"ZONE 1 — ROADSIDE",        len:1300, enemies:3, gems:6, bg:"#1c2436", far:"#2b3550", near:"#171a24", boss:null },
  { name:"ZONE 2 — RUST YARD",       len:1450, enemies:4, gems:6, bg:"#2a1f1c", far:"#4a2f24", near:"#1a1512", boss:null },
  { name:"ZONE 3 — STONE PASS",      len:1600, enemies:4, gems:7, bg:"#241407", far:"#3a2410", near:"#1a0e05", boss:{ type:'elemental', el:'rock', sub:"Keeper of the Stone Pass" } },
  { name:"ZONE 4 — NEON MARKET",     len:1700, enemies:5, gems:7, bg:"#241426", far:"#40224a", near:"#160c18", boss:{ type:'realsprite', spriteType:'shadow', name:'SHADOW FIEND', sub:"Something that shouldn't exist" } },
  { name:"ZONE 5 — THORN HOLLOW",    len:1850, enemies:5, gems:8, bg:"#160a24", far:"#2a1240", near:"#0d0618", boss:{ type:'elemental', el:'vine', sub:"Mistress of Thorn Hollow" } },
  { name:"ZONE 6 — ROAD'S END",      len:2000, enemies:3, gems:9, bg:"#200a0a", far:"#441414", near:"#140505", boss:{ type:'realsprite', spriteType:'flame', name:'FLAME DEMON', sub:"What the road leaves behind" } }
];

const REAL_ENEMY_TYPES = ['flame','ninja','shadow'];

function buildZone(idx){
  const z = ZONES[idx];
  levelLen = z.len; camX = 0;
  vm = QDBP.makeVM(QDBP.cascade(idx+3, 41) % 256);

  player.x = 60; player.y = GROUND_Y; player.vx=0; player.vy=0;
  player.moveKey=null; player.movePhase=null; player.anim='idle';

  enemies = []; hazards = []; flamesList = [];
  const spacing = levelLen/(z.enemies+1);
  for (let i=0;i<z.enemies;i++){
    const ex = spacing*(i+1) + vm.range(-25,25);
    if (idx>=1 && i===Math.floor(z.enemies/2) && vm.chance(0.5)){
      const el = vm.pick(['rock','vine']);
      enemies.push(Entities.createElementalEnemy(ex, GROUND_Y, el, false));
    } else {
      const type = vm.pick(REAL_ENEMY_TYPES);
      enemies.push(Entities.createRealSpriteEnemy(ex, GROUND_Y, type, false, vm));
    }
  }
  if (z.boss){
    if (z.boss.type==='elemental'){
      const b = Entities.createElementalEnemy(levelLen-90, GROUND_Y, z.boss.el, true);
      b.bossSub = z.boss.sub;
      enemies.push(b);
    } else {
      const b = Entities.createRealSpriteEnemy(levelLen-90, GROUND_Y, z.boss.spriteType, true, vm);
      b.name = z.boss.name; b.bossSub = z.boss.sub;
      enemies.push(b);
    }
  }

  gemsList = [];
  for (let g=0; g<z.gems; g++){
    gemsList.push({ x:40+vm.next()*(levelLen-80), y:GROUND_Y-10-vm.next()*30, taken:false, bob:vm.next()*10 });
  }
  const hazCount = 2+idx;
  for (let hz=0; hz<hazCount; hz++){
    hazards.push({ x:150+vm.next()*(levelLen-300), type: vm.chance(0.5)?'spike':'crate', broken:false });
  }
  const flameCount = 1 + Math.floor(idx/2);
  for (let fl=0; fl<flameCount; fl++){
    flamesList.push({ x:80+vm.next()*(levelLen-160), y:GROUND_Y-14-vm.next()*26, taken:false, bob:vm.next()*10 });
  }

  document.getElementById('zoneLabel').textContent = z.name;
  bossIntroShown = false;
  bakedZoneKey = null; // force re-bake parallax for the new zone palette
}

// ------------------------------------------------------------- Player ------
let player = null;
let animQueue = []; // cutscene queue: victory / knockdown sequences

function enqueueAnim(anim, ticks){ animQueue.push({ anim, ticks }); }
function updateAnimQueue(){
  if (!animQueue.length) return false;
  const step = animQueue[0];
  player.anim = step.anim;
  step.ticks--;
  if (step.ticks <= 0) animQueue.shift();
  return true;
}

function setPlayerAnim(name){
  if (player.anim !== name){ player.anim = name; player.frame = 0; player.frameTicks = 0; }
}
function advancePlayerAnim(){
  const a = animTable[player.anim] || animTable.idle;
  player.frameTicks++;
  const ticksPerFrame = Math.max(1, Math.round(60/a.fps));
  if (player.frameTicks >= ticksPerFrame){
    player.frameTicks = 0;
    player.frame++;
    if (player.frame >= a.frames.length){ player.frame = a.loop ? 0 : a.frames.length-1; }
  }
}

function tryDodge(dir){
  if (player.moveKey) return;
  player.vx = (dir==='left'?-1:1) * 5.5;
  player.invulnTicks = 14;
}
let lastTapDir=null, lastTapTick=0;

function updatePlayer(){
  if (updateAnimQueue()){ advancePlayerAnim(); return; }

  if (player.invulnTicks>0) player.invulnTicks--;
  if (player.comboChainTicks>0){ player.comboChainTicks--; if (player.comboChainTicks<=0) player.comboNode=null; }
  if (comboTicks>0){ comboTicks--; if(comboTicks<=0){ comboCount=0; document.getElementById('comboLabel').style.opacity=0; } }
  if (flameBuffTicks>0){ flameBuffTicks--; updateFlameHud(); }

  let moving = false;

  if (player.moveKey){
    const stillBusy = Combat.tickMove(player);
    if (stillBusy && player.movePhase==='active' && !player.hitLanded){
      resolvePlayerHit();
    }
    if (!stillBusy){ setPlayerAnim('idle'); }
  } else if (keys.special && specialMeter>=100){
    const mv = Combat.startMove(player, 'fireball');
    setPlayerAnim(mv.anim);
    specialMeter=0; document.getElementById('specBarFill').style.width='0%'; keys.special=false;
    SFX[mv.sfx] && SFX[mv.sfx]();
  } else {
    if (keys.left){ player.vx=-2.6; player.facing=-1; moving=true; }
    else if (keys.right){ player.vx=2.6; player.facing=1; moving=true; }
    else player.vx=0;

    if (keys.left || keys.right){
      const dirKey = keys.left ? 'left' : 'right';
      const now = frameCount;
      if (lastTapDir===dirKey && now-lastTapTick<16) tryDodge(dirKey);
      lastTapDir = dirKey; lastTapTick = now;
    }

    if (keys.jump && player.grounded){ player.vy=-13.2; player.grounded=false; SFX.jump(); setPlayerAnim('jump'); }

    if (keys.punch && keys.kick){ inputQueue.enqueue('grab'); keys.punch=false; keys.kick=false; }
    else if (keys.punch){ inputQueue.enqueue('punch'); keys.punch=false; }
    else if (keys.kick){ inputQueue.enqueue('kick'); keys.kick=false; }

    if (inputQueue.length){
      const inp = inputQueue.dequeue();
      const moveKeyName = Combat.resolveComboStep(player.comboNode, inp);
      const mv = Combat.startMove(player, moveKeyName);
      setPlayerAnim(mv.anim);
      SFX[mv.sfx] && SFX[mv.sfx]();
    }
  }

  Engine.stepPhysics(player, GROUND_Y);
  if (player.x<20) player.x=20;
  if (player.x>levelLen-20) player.x=levelLen-20;

  // hazards
  for (const hz of hazards){
    if (hz.broken) continue;
    if (Math.abs(hz.x-player.x)<16 && player.grounded){
      if (hz.type==='spike' && player.invulnTicks<=0){
        player.hp -= 6; player.invulnTicks=24; SFX.hurt(); toast('OUCH — SPIKES');
      } else if (hz.type==='crate' && player.moveKey){
        hz.broken = true;
        if (vm.chance(0.6)){ gems++; SFX.gem(); document.getElementById('score').textContent='💎 '+gems; toast('CRATE +1 💎'); }
        else { player.hp=Math.min(player.maxHp, player.hp+10); toast('HEALTH FOUND'); }
      }
    }
  }

  if (!player.moveKey){
    if (!player.grounded) setPlayerAnim('jump');
    else if (moving) setPlayerAnim('walk');
    else setPlayerAnim('idle');
  }
  advancePlayerAnim();

  camX = player.x-110; if (camX<0) camX=0; if (camX>levelLen-W) camX=levelLen-W;

  // gems / flames
  for (const gm of gemsList){
    if (!gm.taken && Math.abs(gm.x-player.x)<20 && Math.abs(gm.y-player.y)<40){
      gm.taken=true; gems++; SFX.gem();
      document.getElementById('score').textContent='💎 '+gems; toast('+1 💎');
    }
  }
  for (const flm of flamesList){
    if (!flm.taken && Math.abs(flm.x-player.x)<20 && Math.abs(flm.y-player.y)<40){
      flm.taken=true; SFX.special();
      flameBuffTicks = Math.min(flameBuffTicks + 480, 1200);
      toast('🔥 FLAME COLLECTED +8s'); updateFlameHud();
    }
  }

  document.getElementById('hpBarFill').style.width = Math.max(0,100*player.hp/player.maxHp)+'%';
}

function resolvePlayerHit(){
  const hitbox = Combat.getActiveHitbox(player);
  if (!hitbox) return;
  const mv = Combat.MOVES[player.moveKey];
  let dmg = mv.dmg + upgrades.dmg*4;
  if (flameBuffTicks>0) dmg = Math.round(dmg*1.3);
  let any = false;
  for (const e of enemies){
    if (!e.alive) continue;
    const hurt = Combat.getHurtbox(e);
    if (Engine.aabbOverlap(hitbox, hurt)){
      e.hp -= dmg; e.hurtTicks = 16;
      e.vx = player.facing * mv.knockback * 2;
      if (mv.launch) e.vy = mv.launch;
      any = true;
      if (e.hp<=0 && e.alive){ e.alive=false; killEnemy(e); }
    }
  }
  if (any) { player.hitLanded = true; addCombo(); }
}

function killEnemy(e){
  const base = e.isBoss ? 130 : (e.isElemental ? 26 : 18);
  gainXP(base);
  if (e.isBoss){ killTally.boss++; toast('👑 '+(e.name||'BOSS')+' DEFEATED!'); SFX.levelup(); }
  else if (e.isElemental){ killTally[e.el]++; }
  else if (e.kind==='realsprite'){ killTally[e.spriteType]++; }
  updateKillTallyHud();
}

// ------------------------------------------------------------- Enemies -----
function getEnemyAttackHitbox(e){
  const w = e.reach*0.5, h = e.displayH*0.5;
  const x = e.facing>0 ? e.x + e.reach*0.15 : e.x - e.reach*0.15 - w;
  const y = e.y - e.displayH*0.62;
  return { x, y, w, h };
}

function updateEnemy(e){
  if (!e.alive) return;

  if (e.kind==='elemental'){
    e.animTicks++;
    const fps = ELEMENTALS_FPS[e.el];
    const ticksPerFrame = Math.max(1, Math.round(60/fps));
    if (e.animTicks>=ticksPerFrame){ e.animTicks=0; e.animFrame=(e.animFrame+1) % assets.elementalMeta[e.el].length; }
  } else if (e.kind==='realsprite' && e.spriteType==='flame'){
    e.animTicks++;
    if (e.animTicks>=8){ e.animTicks=0; e.animFrame=(e.animFrame+1)%8; }
  }

  if (e.hurtTicks>0){
    e.hurtTicks--;
    Engine.stepPhysics(e, GROUND_Y);
    return;
  }

  const dx = player.x - e.x, dist = Math.abs(dx);
  e.facing = dx>0 ? 1 : -1;

  if (e.attackWindup>0){
    e.attackWindup--;
    if (e.attackWindup===0){
      if (e.ranged){
        e.projectiles.push({ x:e.x, y:e.y-30, vx:e.facing*3.0, w:10, h:10 });
      } else {
        const hb = getEnemyAttackHitbox(e);
        const playerHurt = { x: player.x-player.w/2, y: player.y-player.h, w: player.w, h: player.h };
        if (Engine.aabbOverlap(hb, playerHurt) && player.invulnTicks<=0){
          player.hp -= e.dmg; player.invulnTicks=27; SFX.hurt();
        }
      }
      e.anim='idle';
    }
  } else if (e.ranged){
    if (dist<220 && dist>60){
      e.aiTicks--;
      if (e.aiTicks<=0){ e.attackWindup=16; e.anim='attacking'; e.aiTicks=e.attackCooldown; }
    } else if (dist<=60){ e.vx = -e.facing*e.speed*0.6; }
    else { e.vx = e.facing*e.speed*0.5; }
  } else if (dist < 240){
    if (dist > e.reach-6){ e.vx = e.facing*e.speed; e.anim='walk'; }
    else {
      e.vx = 0;
      e.aiTicks--;
      if (e.aiTicks<=0){ e.attackWindup=17; e.anim='attacking'; e.aiTicks=e.attackCooldown; }
    }
  } else { e.vx = 0; e.anim='idle'; }

  Engine.stepPhysics(e, GROUND_Y);

  for (let i=e.projectiles.length-1; i>=0; i--){
    const p = e.projectiles[i];
    p.x += p.vx;
    const pRect = { x:p.x-5, y:p.y-5, w:10, h:10 };
    const playerHurt = { x: player.x-player.w/2, y: player.y-player.h, w: player.w, h: player.h };
    if (Engine.aabbOverlap(pRect, playerHurt) && player.invulnTicks<=0){
      player.hp -= e.dmg; player.invulnTicks=24; SFX.hurt();
      e.projectiles.splice(i,1); continue;
    }
    if (p.x<camX-40 || p.x>camX+W+40) e.projectiles.splice(i,1);
  }
}
const ELEMENTALS_FPS = { rock:12, vine:13 };

// ------------------------------------------------------------- Zone flow ---
let gameState = 'title';
let paused = false;

function checkZoneState(){
  const allDead = enemies.every(e => !e.alive);
  if (allDead && gameState==='playing'){
    gameState='cleared';
    enqueueAnim('victory', 78);
    toast('FLAME ON!');
    setTimeout(() => {
      zoneIndex++;
      if (zoneIndex>=ZONES.length){
        showOverlay('ROAD\'S END','The wanderer walks on','Every zone cleared, every enemy fallen. Gems: '+gems+'. Level: '+level+'. New Game+ awaits.','NEW GAME+');
        gameState='win';
      } else {
        openShop(() => { buildZone(zoneIndex); toast('ZONE CLEAR!'); gameState='playing'; });
      }
    }, 1500);
  }
  if (player.hp<=0 && gameState==='playing'){
    gameState='gameover';
    enqueueAnim('down', 42); enqueueAnim('gettingUp', 36);
    showOverlay('DOWN BUT NOT OUT','You were defeated','The road is unforgiving. Gems: '+gems+'. Try again, wanderer.','RETRY ZONE');
  }
  const boss = enemies.find(e => e.isBoss && e.alive);
  if (boss && !bossIntroShown){
    bossIntroShown = true;
    showBossCard(boss.name || (boss.isElemental ? (boss.el==='rock'?'ROCK WARRIOR':'VINE ASSASSIN') : 'BOSS'), boss.bossSub || 'ZONE BOSS');
    SFX.boss();
  }
}

function showOverlay(title,sub,body,btnText){
  document.getElementById('msgTitle').textContent=title;
  document.getElementById('msgSub').textContent=sub;
  document.getElementById('msgBody').textContent=body;
  document.getElementById('startBtn').textContent=btnText;
  document.getElementById('shopArea').innerHTML='';
  document.getElementById('msgOverlay').classList.remove('hidden');
}

function openShop(onDone){
  const area = document.getElementById('shopArea');
  const overlay = document.getElementById('msgOverlay');
  document.getElementById('msgTitle').textContent = 'REST STOP';
  document.getElementById('msgBody').textContent = 'Spend your gems before the next zone.';
  document.getElementById('startBtn').textContent = 'CONTINUE';
  const items = [
    { label:'Patch Wounds (full HP)', cost:3, action:()=>{ player.hp=player.maxHp; } },
    { label:'Sharpen Fists (+DMG)', cost:5, action:()=>{ upgrades.dmg++; } },
    { label:'Toughen Up (+Max HP)', cost:5, action:()=>{ upgrades.hp++; player.maxHp+=15; player.hp+=15; } },
    { label:'Longer Reach (+Reach)', cost:4, action:()=>{ upgrades.reach++; } }
  ];
  function render(){
    area.innerHTML=''; document.getElementById('msgSub').textContent='Gems: '+gems;
    items.forEach(it => {
      const row=document.createElement('div'); row.className='shopItem';
      const lbl=document.createElement('span'); lbl.textContent=it.label+' — '+it.cost+'g';
      const btn=document.createElement('span'); btn.className='shopBtn'+(gems<it.cost?' disabled':''); btn.textContent='BUY';
      btn.addEventListener('touchstart', (ev) => {
        ev.preventDefault();
        if (gems>=it.cost){ gems-=it.cost; it.action(); render(); toast('Upgraded!'); }
      }, {passive:false});
      row.appendChild(lbl); row.appendChild(btn); area.appendChild(row);
    });
  }
  render();
  overlay.classList.remove('hidden');
  const startBtn = document.getElementById('startBtn');
  function go(e){
    e.preventDefault();
    overlay.classList.add('hidden'); area.innerHTML='';
    startBtn.removeEventListener('touchstart', go);
    startBtn.addEventListener('touchstart', handleStart, {passive:false});
    onDone();
  }
  startBtn.removeEventListener('touchstart', handleStart);
  startBtn.addEventListener('touchstart', go, {passive:false});
}

// ------------------------------------------------------------ Rendering ----
function render(){
  if (!bgPatterns || bakedZoneKey !== ZONES[Math.min(zoneIndex,ZONES.length-1)].name){
    const z = ZONES[Math.min(zoneIndex,ZONES.length-1)];
    bgPatterns = Render.bakeParallax(ctx, z);
    bakedZoneKey = z.name;
  }
  const z = ZONES[Math.min(zoneIndex,ZONES.length-1)];
  Render.drawBackground(ctx, W, H, GROUND_Y, camX, z, bgPatterns);
  Render.drawGems(ctx, camX, GROUND_Y, gemsList, frameCount, W);
  Render.drawFlames(ctx, camX, GROUND_Y, flamesList, frameCount, W);
  for (const hz of hazards) Render.drawHazard(ctx, camX, GROUND_Y, hz, W);

  const drawList = enemies.slice(); drawList.push(player);
  drawList.sort((a,b) => (a.y-b.y) || (a.x-b.x));
  for (const ent of drawList){
    if (ent===player){
      Render.drawPlayer(ctx, camX, player, animTable, assets.fighterImg, assets.fighterMeta, frameCount);
    } else if (ent.isElemental){
      Render.drawElementalEnemy(ctx, camX, ent, assets.elementalMeta, assets.elementalImg, frameCount);
      Render.drawProjectiles(ctx, camX, ent);
      Render.drawHealthBar(ctx, camX, ent);
    } else {
      Render.drawRealSpriteEnemy(ctx, camX, ent, assets.flameDemonImg, assets.flameDemonMeta, assets.extraImg, assets.extraMeta, frameCount);
      Render.drawProjectiles(ctx, camX, ent);
      Render.drawHealthBar(ctx, camX, ent);
    }
  }

  const prog = Math.min(1, (player.x-20)/(levelLen-40));
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(76,10,150,6);
  ctx.fillStyle='#ffb35a'; ctx.fillRect(76,10,150*prog,6);
}

// --------------------------------------------------------------- Loop ------
function pollInput(){ /* touch handlers mutate `keys` directly; nothing to poll here */ }

function update(){
  frameCount++;
  if (toastTicks>0){ toastTicks--; if(toastTicks<=0) toastEl.style.opacity=0; }
  if (gameState==='playing' && !paused){
    updatePlayer();
    for (const e of enemies) updateEnemy(e);
    checkZoneState();
  }
}

// ------------------------------------------------------------ Start/UI -----
function handleStart(e){
  if (e) e.preventDefault();
  ensureAudio();
  document.getElementById('msgOverlay').classList.add('hidden');
  if (gameState==='gameover'){
    player.hp = player.maxHp; player.invulnTicks=0; buildZone(zoneIndex);
  } else {
    resetProgression();
    player = Entities.createPlayer(60, GROUND_Y, upgrades);
    document.getElementById('score').textContent='💎 0';
    document.getElementById('lvlLabel').textContent='LV 1';
    document.getElementById('xpBarFill').style.width='0%';
    document.getElementById('specBarFill').style.width='0%';
    updateKillTallyHud(); updateFlameHud();
    zoneIndex=0; buildZone(0);
  }
  gameState='playing';
}

// ------------------------------------------------------------- Boot --------
async function boot(){
  const loadingEl = document.getElementById('msgBody');
  try {
    assets = await Assets.loadAll('assets/sprites/');
  } catch(err){
    loadingEl.textContent = 'Failed to load game assets: ' + err.message + '. Check your connection and reload.';
    document.getElementById('startBtn').textContent = 'RELOAD';
    document.getElementById('startBtn').addEventListener('touchstart', (e)=>{ e.preventDefault(); location.reload(); }, {passive:false});
    return;
  }
  animTable = Render.buildAnimTable(assets.fighterMeta);

  resetProgression();
  player = Entities.createPlayer(60, GROUND_Y, upgrades);
  buildZone(0);

  bindBtn('djump','jump'); bindBtn('dleft','left'); bindBtn('dright','right');
  bindBtn('btnPunch','punch'); bindBtn('btnKick','kick'); bindBtn('btnSpecial','special');
  document.getElementById('startBtn').addEventListener('touchstart', handleStart, {passive:false});

  document.getElementById('pauseBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (gameState!=='playing' && !paused) return;
    paused = !paused;
    if (paused) showOverlay('PAUSED','','Tap resume to continue the fight.','RESUME');
    else document.getElementById('msgOverlay').classList.add('hidden');
  }, {passive:false});

  Engine.createLoop({ pollInput, update, render });
}

boot();
})();
