/* =========================================================
   钢铁前线 · TANK FRONT
   一个纯前端 Canvas 坦克大战
   ========================================================= */
(() => {
  'use strict';

  /* ---------------- 常量 ---------------- */
  const TILE = 32;
  const COLS = 30;
  const ROWS = 20;
  const W = COLS * TILE;
  const H = ROWS * TILE;
  const TOTAL_WAVES = 4;

  const T = { EMPTY: 0, BRICK: 1, STEEL: 2, WATER: 3, TREE: 4, BASE: 5 };
  const D = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const el = {
    score: $('scoreVal'),
    wave: $('waveVal'),
    enemies: $('enemiesVal'),
    lives: $('livesVal'),
    menu: $('menuScreen'),
    pause: $('pauseScreen'),
    result: $('resultScreen'),
    resultCard: document.querySelector('.result-card'),
    startBtn: $('startBtn'),
    menuBest: $('menuBest'),
    pauseBtn: $('pauseBtn'),
    soundBtn: $('soundBtn'),
    resumeBtn: $('resumeBtn'),
    restartBtn: $('restartBtn'),
    quitBtn: $('quitBtn'),
    againBtn: $('againBtn'),
    homeBtn: $('homeBtn'),
    resultKicker: $('resultKicker'),
    resultTitle: $('resultTitle'),
    resultDesc: $('resultDesc'),
    resultScore: $('resultScore'),
    resultWave: $('resultWave'),
    resultBest: $('resultBest'),
    bossHud: $('bossHud'),
    bossBar: $('bossBar'),
    toast: $('toast'),
    fireBtn: $('fireBtn')
  };

  /* ---------------- 音效 ---------------- */
  const sfx = (() => {
    let ac = null;
    let muted = false;

    function audio() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }

    function tone(freq, dur, type, vol, slideTo) {
      if (muted) return;
      const a = audio();
      if (!a) return;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, a.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
      g.gain.setValueAtTime(vol, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(g);
      g.connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur + 0.02);
    }

    function noise(dur, vol) {
      if (muted) return;
      const a = audio();
      if (!a) return;
      const len = Math.floor(a.sampleRate * dur);
      const buf = a.createBuffer(1, len, a.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource();
      const g = a.createGain();
      const filter = a.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      src.buffer = buf;
      g.gain.value = vol;
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(a.destination);
      src.start();
    }

    return {
      shoot() { tone(720, 0.07, 'square', 0.04, 260); },
      enemyShoot() { tone(400, 0.07, 'square', 0.025, 180); },
      spark() { noise(0.06, 0.03); },
      boom() { noise(0.32, 0.09); tone(110, 0.28, 'sawtooth', 0.05, 40); },
      hit() { tone(160, 0.12, 'square', 0.05, 70); },
      wave() { tone(520, 0.12, 'triangle', 0.05); setTimeout(() => tone(780, 0.16, 'triangle', 0.05), 130); },
      toggle() { muted = !muted; if (!muted) tone(880, 0.06, 'sine', 0.04); return muted; },
      get muted() { return muted; }
    };
  })();

  /* ---------------- 状态 ---------------- */
  const S = {
    mode: 'menu',          // menu | playing | paused | over
    map: [],
    wave: 1,
    score: 0,
    best: 0,
    lives: 3,
    player: null,
    enemies: [],
    bullets: [],
    parts: [],
    spawnQueue: [],
    spawnTimer: 0,
    betweenWaves: 0,
    boss: null,
    time: 0,
    shake: 0
  };

  const keys = { up: false, down: false, left: false, right: false, fire: false };

  const SPAWNS = [[1, 1], [28, 1], [14, 1]];
  const PLAYER_SPAWN = { x: 11, y: 18 };

  /* ---------------- 存档 ---------------- */
  function loadBest() {
    try {
      S.best = Number(localStorage.getItem('tankfront.best') || 0) || 0;
    } catch (e) {
      S.best = 0;
    }
  }
  function saveBest() {
    try { localStorage.setItem('tankfront.best', String(S.best)); } catch (e) { /* ignore */ }
  }

  /* ---------------- 地图 ---------------- */
  function buildMap(wave) {
    const m = Array.from({ length: ROWS }, () => new Array(COLS).fill(T.EMPTY));
    const put = (x, y, t) => {
      if (x >= 0 && x < COLS && y >= 0 && y < ROWS) m[y][x] = t;
    };
    const rect = (x, y, w, h, t) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, t);
    };

    // 四座砖砌掩体
    [[4, 3], [23, 3], [4, 12], [23, 12]].forEach(([x, y]) => {
      rect(x, y, 3, 3, T.BRICK);
      put(x + 1, y + 1, T.EMPTY);
    });

    // 钢制障碍
    const steelSets = [
      [[9, 6], [20, 6]],
      [[9, 6], [20, 6], [9, 13], [20, 13]],
      [[9, 6], [20, 6], [9, 13], [20, 13], [14, 2], [15, 2]],
      [[9, 5], [20, 5], [9, 14], [20, 14], [14, 6], [15, 6], [4, 9], [25, 9]]
    ];
    (steelSets[wave - 1] || steelSets[0]).forEach(([x, y]) => put(x, y, T.STEEL));

    // 水塘
    if (wave >= 3) rect(12, 9, 6, 2, T.WATER);

    // 树林
    [[2, 8], [27, 8], [2, 16], [27, 16], [14, 13], [15, 13], [6, 17], [23, 17]]
      .forEach(([x, y]) => { if (m[y][x] === T.EMPTY) put(x, y, T.TREE); });

    // 基地堡垒
    rect(13, 17, 4, 1, T.BRICK);
    rect(13, 18, 1, 2, T.BRICK);
    rect(16, 18, 1, 2, T.BRICK);
    rect(14, 19, 2, 1, T.BRICK);
    put(14, 18, T.BASE);
    put(15, 18, T.BASE);

    // 清空出生点
    const clear = (x, y) => { rect(x, y, 2, 2, T.EMPTY); };
    SPAWNS.forEach(([x, y]) => clear(x, y));
    clear(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
    clear(18, 18);

    return m;
  }

  /* ---------------- 实体 ---------------- */
  function makePlayer() {
    return {
      kind: 'player',
      side: 'player',
      x: PLAYER_SPAWN.x * TILE + 2,
      y: PLAYER_SPAWN.y * TILE + 2,
      size: 28,
      dir: D.UP,
      speed: 150,
      hp: 1,
      alive: true,
      shield: 2.2,
      nextFire: 0,
      fireDelay: 0.42,
      bulletSpeed: 430
    };
  }

  const ENEMY_TYPES = {
    scout: { speed: 108, hp: 1, fireDelay: 1.5, bulletSpeed: 300, color: '#8ecae6', score: 100, size: 26 },
    gunner: { speed: 84, hp: 1, fireDelay: 1.15, bulletSpeed: 330, color: '#e07a5f', score: 150, size: 27 },
    heavy: { speed: 60, hp: 3, fireDelay: 1.9, bulletSpeed: 280, color: '#cdb4db', score: 250, size: 29 },
    sniper: { speed: 92, hp: 1, fireDelay: 2.1, bulletSpeed: 430, color: '#b8b8ff', score: 200, size: 26 },
    boss: { speed: 52, hp: 45, fireDelay: 0.85, bulletSpeed: 300, color: '#ff5d5d', score: 1500, size: 56 }
  };

  function makeEnemy(type, x, y) {
    const spec = ENEMY_TYPES[type];
    const e = {
      kind: type,
      side: 'enemy',
      x: x * TILE + (TILE - spec.size) / 2,
      y: y * TILE + (TILE - spec.size) / 2,
      size: spec.size,
      dir: D.DOWN,
      speed: spec.speed,
      hp: spec.hp,
      maxHp: spec.hp,
      alive: true,
      nextFire: 0,
      fireDelay: spec.fireDelay,
      bulletSpeed: spec.bulletSpeed,
      color: spec.color,
      score: spec.score,
      think: 0,
      hitFlash: 0
    };
    return e;
  }

  function beginWave(wave) {
    S.wave = wave;
    S.map = buildMap(wave);
    S.bullets = [];
    S.parts = [];
    S.enemies = [];
    S.boss = null;
    S.betweenWaves = 0;
    el.bossHud.hidden = true;

    // 玩家回到出生点
    if (S.player) {
      S.player.x = PLAYER_SPAWN.x * TILE + 2;
      S.player.y = PLAYER_SPAWN.y * TILE + 2;
      S.player.dir = D.UP;
      S.player.hp = 1;
      S.player.shield = 2.2;
      S.player.alive = true;
    }

    // 敌军队列
    const counts = [6, 8, 10, 8];
    const pool = [
      ['scout', 'scout', 'gunner', 'gunner', 'scout'],
      ['scout', 'gunner', 'gunner', 'sniper', 'heavy'],
      ['gunner', 'sniper', 'heavy', 'scout', 'gunner'],
      ['heavy', 'sniper', 'gunner', 'heavy', 'scout', 'gunner']
    ];
    const queue = [];
    const n = counts[wave - 1];
    const p = pool[wave - 1];
    for (let i = 0; i < n; i++) queue.push(p[i % p.length]);
    if (wave === TOTAL_WAVES) queue.push('boss');
    S.spawnQueue = queue;
    S.spawnTimer = 0.6;

    showToast(`战区 0${wave} / 0${TOTAL_WAVES}  ·  ${wave === TOTAL_WAVES ? '重型单位接近' : '敌军装甲集群来袭'}`);
    sfx.wave();
    syncHud();
  }

  function startGame() {
    loadBest();
    S.score = 0;
    S.lives = 3;
    S.player = makePlayer();
    S.mode = 'playing';
    hideScreens();
    beginWave(1);
    syncHud();
  }

  /* ---------------- 地形工具 ---------------- */
  function tileAt(px, py) {
    const c = Math.floor(px / TILE);
    const r = Math.floor(py / TILE);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return T.EMPTY;
    return S.map[r][c];
  }

  function blocksTank(t) {
    return t === T.BRICK || t === T.STEEL || t === T.WATER || t === T.BASE;
  }

  function tankBlocked(tank, nx, ny) {
    const s = tank.size;
    if (nx < 0 || ny < 0 || nx + s > W || ny + s > H) return true;

    const x0 = Math.floor(nx / TILE);
    const x1 = Math.floor((nx + s - 1) / TILE);
    const y0 = Math.floor(ny / TILE);
    const y1 = Math.floor((ny + s - 1) / TILE);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!S.map[y] || S.map[y][x] === undefined) continue;
        if (blocksTank(S.map[y][x])) return true;
      }
    }

    const others = [];
    if (S.player && S.player !== tank && S.player.alive) others.push(S.player);
    for (const e of S.enemies) if (e !== tank && e.alive) others.push(e);
    for (const o of others) {
      if (nx < o.x + o.size && nx + s > o.x && ny < o.y + o.size && ny + s > o.y) return true;
    }
    return false;
  }

  /* 换向时对齐到格子，避免卡在通道口 */
  function setDir(tank, dir) {
    if (tank.dir === dir) return;
    tank.dir = dir;
    const off = (TILE - tank.size) / 2;
    if (dir === D.UP || dir === D.DOWN) {
      const nx = Math.round((tank.x - off) / TILE) * TILE + off;
      if (!tankBlocked(tank, nx, tank.y)) tank.x = nx;
    } else {
      const ny = Math.round((tank.y - off) / TILE) * TILE + off;
      if (!tankBlocked(tank, tank.x, ny)) tank.y = ny;
    }
  }

  function moveTank(tank, dir, dt) {
    setDir(tank, dir);
    const step = tank.speed * dt;
    const nx = tank.x + DX[dir] * step;
    const ny = tank.y + DY[dir] * step;
    if (!tankBlocked(tank, nx, ny)) {
      tank.x = nx;
      tank.y = ny;
    } else {
      // 贴边微调，减少卡顿感
      const off = (TILE - tank.size) / 2;
      if (dir === D.UP || dir === D.DOWN) {
        const tx = Math.round((tank.x - off) / TILE) * TILE + off;
        const d = Math.max(-step, Math.min(step, tx - tank.x));
        if (d && !tankBlocked(tank, tank.x + d, tank.y)) tank.x += d;
      } else {
        const ty = Math.round((tank.y - off) / TILE) * TILE + off;
        const d = Math.max(-step, Math.min(step, ty - tank.y));
        if (d && !tankBlocked(tank, tank.x, tank.y + d)) tank.y += d;
      }
    }
  }

  /* ---------------- 开火 ---------------- */
  function fire(tank) {
    if (S.time < tank.nextFire) return;
    tank.nextFire = S.time + tank.fireDelay;

    const cx = tank.x + tank.size / 2 + DX[tank.dir] * (tank.size / 2 + 5);
    const cy = tank.y + tank.size / 2 + DY[tank.dir] * (tank.size / 2 + 5);

    S.bullets.push({
      x: cx,
      y: cy,
      dir: tank.dir,
      speed: tank.bulletSpeed,
      side: tank.side,
      size: tank.kind === 'boss' ? 8 : 6,
      life: 3
    });

    // 炮口火花
    spawnParts(cx, cy, 5, tank.side === 'player' ? '#ffe08a' : '#ff9a8a', 60);
    if (tank.side === 'player') sfx.shoot();
    else sfx.enemyShoot();
  }

  function fireBoss(boss) {
    if (S.time < boss.nextFire) return;
    boss.nextFire = S.time + boss.fireDelay;
    const cx = boss.x + boss.size / 2;
    const cy = boss.y + boss.size / 2;
    const dirs = [boss.dir, (boss.dir + 1) % 4, (boss.dir + 3) % 4];
    for (const d of dirs) {
      S.bullets.push({
        x: cx + DX[d] * (boss.size / 2 + 4),
        y: cy + DY[d] * (boss.size / 2 + 4),
        dir: d,
        speed: boss.bulletSpeed,
        side: 'enemy',
        size: 8,
        life: 3
      });
    }
    sfx.enemyShoot();
  }

  /* ---------------- 粒子 ---------------- */
  function spawnParts(x, y, n, color, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.9);
      S.parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.35 + Math.random() * 0.45,
        max: 0.8,
        color,
        r: 1.5 + Math.random() * 3
      });
    }
  }

  function explode(x, y, big) {
    spawnParts(x, y, big ? 34 : 16, '#ffcf6b', big ? 260 : 170);
    spawnParts(x, y, big ? 18 : 8, '#ff7a45', big ? 190 : 120);
    S.shake = Math.min(10, S.shake + (big ? 7 : 3));
    if (big) sfx.boom();
    else sfx.hit();
  }

  /* ---------------- 伤害 ---------------- */
  function damageEnemy(e, dmg, x, y) {
    e.hp -= dmg;
    e.hitFlash = 0.12;
    if (e.hp > 0) {
      spawnParts(x, y, 6, '#ffd166', 90);
      return;
    }
    e.alive = false;
    S.score += e.score;
    explode(e.x + e.size / 2, e.y + e.size / 2, e.kind === 'boss');
    if (e.kind === 'boss') {
      S.boss = null;
      el.bossHud.hidden = true;
      showToast('重型单位已摧毁 · HEAVY UNIT DOWN');
    }
    syncHud();
  }

  function damagePlayer(x, y) {
    const p = S.player;
    if (!p || !p.alive || p.shield > 0) return;

    explode(p.x + p.size / 2, p.y + p.size / 2, false);
    S.lives -= 1;
    S.score = Math.max(0, S.score - 50);
    p.alive = false;
    p.shield = 2.4;

    if (S.lives <= 0) {
      gameOver(false, '装甲耗尽，驾驶员全部阵亡。');
      return;
    }

    setTimeout(() => {
      if (S.mode !== 'playing' || !S.player) return;
      const np = S.player;
      np.hp = 1;
      np.alive = true;
      np.x = PLAYER_SPAWN.x * TILE + 2;
      np.y = PLAYER_SPAWN.y * TILE + 2;
      np.dir = D.UP;
      np.shield = 2.4;
      np.nextFire = 0;
    }, 900);

    syncHud();
  }

  function destroyBase() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (S.map[y][x] === T.BASE) {
          S.map[y][x] = T.EMPTY;
          explode(x * TILE + 16, y * TILE + 16, true);
        }
      }
    }
    gameOver(false, '基地被击毁');
  }

  function gameOver(victory, reason) {
    if (S.mode === 'over') return;
    S.mode = 'over';
    if (S.score > S.best) {
      S.best = S.score;
      saveBest();
    }
    el.resultCard.classList.toggle('is-victory', !!victory);
    el.resultKicker.textContent = victory ? 'MISSION COMPLETE' : 'MISSION FAILED';
    el.resultTitle.textContent = victory ? '全线肃清' : '基地陷落';
    el.resultDesc.textContent = victory
      ? '四个战区全部收复，鹰徽仍在飘扬。'
      : (reason || '防线已被突破，装甲部队全灭。');
    el.resultScore.textContent = String(S.score).padStart(6, '0');
    el.resultWave.textContent = `0${S.wave} / 0${TOTAL_WAVES}`;
    el.resultBest.textContent = String(S.best).padStart(6, '0');
    el.bossHud.hidden = true;
    el.pauseBtn.disabled = true;
    showScreen(el.result);
    if (victory) sfx.wave();
  }

  /* ---------------- 更新 ---------------- */
  function update(dt) {
    S.time += dt;
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 26);

    // 玩家
    if (S.player && S.player.alive) {
      const p = S.player;
      if (p.shield > 0) p.shield = Math.max(0, p.shield - dt);
      p.nextFire = Math.max(0, p.nextFire);

      let dir = -1;
      if (keys.up) dir = D.UP;
      else if (keys.down) dir = D.DOWN;
      else if (keys.left) dir = D.LEFT;
      else if (keys.right) dir = D.RIGHT;

      if (dir >= 0) moveTank(p, dir, dt);
      if (keys.fire) fire(p);
    }

    // 刷怪
    if (S.spawnQueue.length && S.enemies.filter((e) => e.alive).length < 5) {
      S.spawnTimer -= dt;
      if (S.spawnTimer <= 0) {
        const type = S.spawnQueue.shift();
        const [sx, sy] = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
        const e = makeEnemy(type, sx, sy);
        if (tankBlocked(e, e.x, e.y)) {
          S.spawnQueue.unshift(type);
        } else {
          S.enemies.push(e);
          spawnParts(e.x + e.size / 2, e.y + e.size / 2, 14, 'rgba(120,220,255,0.8)', 120);
          if (type === 'boss') {
            S.boss = e;
            el.bossHud.hidden = false;
            showToast('警告 · 重型攻城单位出现', true);
            sfx.wave();
          }
        }
        S.spawnTimer = 1.5;
      }
    }

    // 敌军
    for (const e of S.enemies) {
      if (!e.alive) continue;
      if (e.hitFlash > 0) e.hitFlash -= dt;

      e.think -= dt;
      if (e.think <= 0) {
        e.think = 0.55 + Math.random() * 0.8;
        e.dir = chooseEnemyDir(e);
        setDir(e, e.dir);
      }

      // 前方被挡就重新选向
      if (tankBlocked(e, e.x + DX[e.dir] * 5, e.y + DY[e.dir] * 5)) {
        for (let i = 0; i < 6; i++) {
          const d = Math.floor(Math.random() * 4);
          if (!tankBlocked(e, e.x + DX[d] * 5, e.y + DY[d] * 5)) { e.dir = d; setDir(e, e.dir); break; }
        }
      }

      moveTank(e, e.dir, dt);

      if (e.kind === 'boss') {
        e.nextFire = Math.max(0, e.nextFire);
        if (e.nextFire <= 0) fireBoss(e);
      } else {
        e.nextFire = Math.max(0, e.nextFire);
        const aligned = isAlignedWithPlayer(e);
        if (e.nextFire <= 0 && (aligned || Math.random() < 0.02)) fire(e);
      }
    }
    S.enemies = S.enemies.filter((e) => e.alive);

    // 波次推进
    if (!S.spawnQueue.length && !S.enemies.length) {
      if (S.betweenWaves <= 0) S.betweenWaves = 1.8;
      S.betweenWaves -= dt;
      if (S.betweenWaves <= 0) {
        if (S.wave >= TOTAL_WAVES) {
          gameOver(true);
        } else {
          beginWave(S.wave + 1);
        }
      }
    }

    updateBullets(dt);
    updateParts(dt);
    syncHud();
  }

  function chooseEnemyDir(e) {
    const tx = 14 * TILE + TILE;
    const ty = 18 * TILE;
    let gx = tx;
    let gy = ty;
    if (Math.random() < 0.45 && S.player && S.player.alive) {
      gx = S.player.x + S.player.size / 2;
      gy = S.player.y + S.player.size / 2;
    }
    const dx = gx - (e.x + e.size / 2);
    const dy = gy - (e.y + e.size / 2);
    const options = [];
    if (Math.abs(dx) > 10) options.push(dx > 0 ? D.RIGHT : D.LEFT);
    if (Math.abs(dy) > 10) options.push(dy > 0 ? D.DOWN : D.UP);
    if (!options.length || Math.random() < 0.3) options.push(Math.floor(Math.random() * 4));
    // 优先可走的方向
    for (const d of options) {
      if (!tankBlocked(e, e.x + DX[d] * 6, e.y + DY[d] * 6)) return d;
    }
    return options[Math.floor(Math.random() * options.length)];
  }

  function isAlignedWithPlayer(e) {
    const p = S.player;
    if (!p || !p.alive) return false;
    const ex = e.x + e.size / 2;
    const ey = e.y + e.size / 2;
    const px = p.x + p.size / 2;
    const py = p.y + p.size / 2;
    if (Math.abs(ex - px) < TILE * 0.7) return true;
    if (Math.abs(ey - py) < TILE * 0.7) return true;
    return false;
  }

  function updateBullets(dt) {
    for (let i = S.bullets.length - 1; i >= 0; i--) {
      const b = S.bullets[i];
      b.x += DX[b.dir] * b.speed * dt;
      b.y += DY[b.dir] * b.speed * dt;
      b.life -= dt;

      if (b.x < -10 || b.x > W + 10 || b.y < -10 || b.y > H + 10 || b.life <= 0) {
        S.bullets.splice(i, 1);
        continue;
      }

      const c = Math.floor(b.x / TILE);
      const r = Math.floor(b.y / TILE);
      const tile = (S.map[r] && S.map[r][c] !== undefined) ? S.map[r][c] : T.EMPTY;

      if (tile === T.BRICK) {
        S.map[r][c] = T.EMPTY;
        spawnParts(b.x, b.y, 8, '#c96a4f', 110);
        sfx.spark();
        S.bullets.splice(i, 1);
        continue;
      }
      if (tile === T.STEEL) {
        spawnParts(b.x, b.y, 5, '#d7e0e6', 90);
        sfx.spark();
        S.bullets.splice(i, 1);
        continue;
      }
      if (tile === T.BASE) {
        S.bullets.splice(i, 1);
        destroyBase();
        return;
      }

      // 命中坦克
      let removed = false;
      if (b.side === 'player') {
        for (const e of S.enemies) {
          if (!e.alive) continue;
          if (b.x > e.x && b.x < e.x + e.size && b.y > e.y && b.y < e.y + e.size) {
            damageEnemy(e, 1, b.x, b.y);
            S.bullets.splice(i, 1);
            removed = true;
            break;
          }
        }
      } else {
        const p = S.player;
        if (p && p.alive && b.x > p.x && b.x < p.x + p.size && b.y > p.y && b.y < p.y + p.size) {
          if (p.shield > 0) {
            spawnParts(b.x, b.y, 6, '#9fe8ff', 90);
          } else {
            damagePlayer(b.x, b.y);
          }
          S.bullets.splice(i, 1);
          removed = true;
        }
      }
      if (removed) continue;
    }
  }

  function updateParts(dt) {
    for (let i = S.parts.length - 1; i >= 0; i--) {
      const p = S.parts[i];
      p.life -= dt;
      if (p.life <= 0) { S.parts.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
  }

  /* ---------------- 绘制 ---------------- */
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  function drawGround() {
    ctx.fillStyle = '#0b1410';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(120, 180, 140, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += TILE) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += TILE) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();

    const g = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, W * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawBrick(x, y) {
    ctx.fillStyle = '#5e2a22';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#9c4a37';
    for (let row = 0; row < 4; row++) {
      const offset = row % 2 ? 8 : 0;
      for (let cx = -1; cx < 2; cx++) {
        const bx = x + cx * 16 + offset;
        if (bx + 14 < x || bx > x + TILE) continue;
        ctx.fillRect(Math.max(x, bx), y + row * 8, Math.min(14, x + TILE - bx), 6);
      }
    }
  }

  function drawSteel(x, y) {
    ctx.fillStyle = '#39454e';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#63737e';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#8b9aa5';
    ctx.fillRect(x + 5, y + 5, TILE - 10, 6);
    ctx.fillStyle = '#2a343b';
    [[6, 6], [TILE - 8, 6], [6, TILE - 8], [TILE - 8, TILE - 8]].forEach(([ox, oy]) => {
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawWater(x, y) {
    ctx.fillStyle = '#0f3446';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = 'rgba(110, 200, 230, 0.55)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      const yy = y + 7 + i * 9 + Math.sin(S.time * 2 + x * 0.05 + i) * 1.8;
      ctx.beginPath();
      ctx.moveTo(x + 3, yy);
      ctx.quadraticCurveTo(x + TILE / 2, yy - 3, x + TILE - 3, yy);
      ctx.stroke();
    }
  }

  function drawTree(x, y) {
    ctx.fillStyle = 'rgba(20, 52, 34, 0.95)';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#2f7a4d';
    [[9, 12, 8], [22, 11, 7], [15, 22, 9], [24, 23, 6]].forEach(([ox, oy, r]) => {
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(120, 210, 150, 0.25)';
    ctx.beginPath();
    ctx.arc(x + 12, y + 10, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBase(x, y) {
    const r = Math.floor(y / TILE);
    const c = Math.floor(x / TILE);
    // 两格高的基地只绘制一次，横跨两格
    if (c > 0 && S.map[r] && S.map[r][c - 1] === T.BASE) return;

    let wBase = TILE;
    while (c + wBase / TILE < COLS && S.map[r] && S.map[r][c + wBase / TILE] === T.BASE) {
      wBase += TILE;
    }
    if (wBase < TILE) wBase = TILE;

    const cx = x + wBase / 2;
    const baseY = y + TILE - 4;

    ctx.fillStyle = '#101812';
    ctx.fillRect(x, y, wBase, TILE);

    const g = ctx.createLinearGradient(x, y, x, y + TILE);
    g.addColorStop(0, '#ffd977');
    g.addColorStop(1, '#bf8820');
    ctx.fillStyle = g;

    // 双翼
    ctx.beginPath();
    ctx.moveTo(cx - 4, baseY - 6);
    ctx.lineTo(cx - 26, baseY - 20);
    ctx.lineTo(cx - 22, baseY - 2);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx + 4, baseY - 6);
    ctx.lineTo(cx + 26, baseY - 20);
    ctx.lineTo(cx + 22, baseY - 2);
    ctx.closePath();
    ctx.fill();

    // 身体
    ctx.beginPath();
    ctx.moveTo(cx, baseY - 24);
    ctx.lineTo(cx + 9, baseY - 6);
    ctx.lineTo(cx, baseY);
    ctx.lineTo(cx - 9, baseY - 6);
    ctx.closePath();
    ctx.fill();

    // 头部
    ctx.beginPath();
    ctx.arc(cx, baseY - 26, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMap() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = S.map[r][c];
        if (!t) continue;
        const x = c * TILE;
        const y = r * TILE;
        if (t === T.BRICK) drawBrick(x, y);
        else if (t === T.STEEL) drawSteel(x, y);
        else if (t === T.WATER) drawWater(x, y);
        else if (t === T.TREE) drawTree(x, y);
        else if (t === T.BASE) drawBase(x, y);
      }
    }
  }

  function drawTank(t) {
    const s = t.size;
    const cx = t.x + s / 2;
    const cy = t.y + s / 2;
    let color = t.color;

    if (t.side === 'player') color = '#f2c14e';
    if (t.hitFlash > 0) color = '#ffffff';

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((Math.PI / 2) * t.dir);

    // 履带
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-s / 2, -s / 2, s, 7);
    ctx.fillRect(-s / 2, s / 2 - 7, s, 7);

    // 车身
    ctx.fillStyle = color;
    ctx.fillRect(-s / 2 + 4, -s / 2 + 5, s - 8, 6);
    ctx.fillRect(-s / 2 + 4, s / 2 - 11, s - 8, 6);
    ctx.fillRect(-s / 2 + 2, -s / 2 + 9, s - 4, s - 18);

    // 炮塔
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.21, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // 炮管
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-2.5, -s / 2 - 7, 5, s / 2 + 10);
    ctx.fillStyle = color;
    ctx.fillRect(-1.5, -s / 2 - 6, 3, s / 2 + 8);

    ctx.restore();

    // 护罩
    if (t.side === 'player' && t.shield > 0) {
      const a = 0.25 + 0.25 * Math.sin(S.time * 14);
      ctx.strokeStyle = `rgba(120, 220, 255, ${a + 0.25})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.78, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 血条（重型/首领）
    if (t.side === 'enemy' && t.maxHp > 1) {
      const wBar = s;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(t.x, t.y - 7, wBar, 4);
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(t.x, t.y - 7, wBar * (t.hp / t.maxHp), 4);
    }
  }

  function drawBullets() {
    for (const b of S.bullets) {
      ctx.save();
      ctx.shadowColor = b.side === 'player' ? '#ffe08a' : '#ff8f7a';
      ctx.shadowBlur = 10;
      ctx.fillStyle = b.side === 'player' ? '#fff3c4' : '#ffb3a3';
      const s = b.size;
      ctx.fillRect(b.x - s / 2, b.y - s / 2, s, s);
      ctx.restore();
    }
  }

  function drawParts() {
    for (const p of S.parts) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.6 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.save();
    if (S.shake > 0.4) {
      ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
    }
    drawGround();
    drawMap();
    for (const e of S.enemies) if (e.alive) drawTank(e);
    if (S.player && S.player.alive) drawTank(S.player);
    drawBullets();
    drawParts();
    ctx.restore();
  }

  /* ---------------- HUD ---------------- */
  let hudCache = { score: -1, wave: -1, enemies: -1, lives: -1 };

  function syncHud() {
    if (hudCache.score !== S.score) {
      hudCache.score = S.score;
      el.score.textContent = String(S.score).padStart(6, '0');
    }
    if (hudCache.wave !== S.wave) {
      hudCache.wave = S.wave;
      el.wave.innerHTML = `0${S.wave}<span class="hud-dim"> / 0${TOTAL_WAVES}</span>`;
    }
    const left = S.spawnQueue.length + S.enemies.filter((e) => e.alive).length;
    if (hudCache.enemies !== left) {
      hudCache.enemies = left;
      el.enemies.textContent = String(left).padStart(2, '0');
    }
    if (hudCache.lives !== S.lives) {
      hudCache.lives = S.lives;
      el.lives.textContent = String(Math.max(0, S.lives)).padStart(2, '0');
    }
    if (S.boss && S.boss.alive) {
      el.bossBar.style.width = `${Math.max(0, (S.boss.hp / S.boss.maxHp) * 100)}%`;
    }
  }

  /* ---------------- 界面 ---------------- */
  function hideScreens() {
    el.menu.classList.remove('is-active');
    el.pause.classList.remove('is-active');
    el.result.classList.remove('is-active');
  }

  function showScreen(node) {
    [el.menu, el.pause, el.result].forEach((n) => n && n.classList.remove('is-active'));
    if (node) node.classList.add('is-active');
  }

  let toastTimer = 0;
  function showToast(text, danger) {
    el.toast.textContent = text;
    el.toast.classList.toggle('is-danger', !!danger);
    el.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 2200);
  }

  function togglePause(force) {
    if (S.mode === 'playing' && force !== false) {
      S.mode = 'paused';
      showScreen(el.pause);
      el.pauseBtn.classList.add('is-paused');
      el.pauseBtn.disabled = false;
    } else if (S.mode === 'paused') {
      S.mode = 'playing';
      hideScreens();
      el.pauseBtn.classList.remove('is-paused');
    }
  }

  function goMenu() {
    S.mode = 'menu';
    S.player = null;
    S.enemies = [];
    S.bullets = [];
    S.parts = [];
    S.boss = null;
    S.map = buildMap(1);
    el.bossHud.hidden = true;
    el.pauseBtn.classList.remove('is-paused');
    el.pauseBtn.disabled = true;
    el.menuBest.textContent = String(S.best).padStart(6, '0');
    showScreen(el.menu);
  }

  /* ---------------- 输入 ---------------- */
  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'fire'
  };

  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code];
    if (k) {
      keys[k] = true;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (S.mode === 'menu' && e.code === 'Space') startGame();
    }
    if (e.code === 'KeyP') {
      e.preventDefault();
      togglePause();
    }
    if (e.code === 'KeyM') {
      e.preventDefault();
      const m = sfx.toggle();
      el.soundBtn.classList.toggle('is-muted', m);
      el.soundBtn.setAttribute('aria-pressed', String(m));
    }
  }, { passive: false });

  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (k) keys[k] = false;
  });

  window.addEventListener('blur', () => {
    keys.up = keys.down = keys.left = keys.right = keys.fire = false;
    if (S.mode === 'playing') togglePause(true);
  });

  // 触屏
  document.querySelectorAll('.touch-btn[data-dir]').forEach((btn) => {
    const map = { up: 'up', down: 'down', left: 'left', right: 'right' };
    const dir = map[btn.dataset.dir];
    const on = (e) => { e.preventDefault(); keys[dir] = true; btn.classList.add('is-active'); };
    const off = (e) => { e.preventDefault(); keys[dir] = false; btn.classList.remove('is-active'); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  });

  if (el.fireBtn) {
    const on = (e) => { e.preventDefault(); keys.fire = true; el.fireBtn.classList.add('is-active'); };
    const off = (e) => { e.preventDefault(); keys.fire = false; el.fireBtn.classList.remove('is-active'); };
    el.fireBtn.addEventListener('pointerdown', on);
    el.fireBtn.addEventListener('pointerup', off);
    el.fireBtn.addEventListener('pointercancel', off);
    el.fireBtn.addEventListener('pointerleave', off);
  }

  /* ---------------- 按钮 ---------------- */
  el.startBtn.addEventListener('click', () => { startGame(); });
  el.pauseBtn.addEventListener('click', () => togglePause());
  el.resumeBtn.addEventListener('click', () => togglePause());
  el.restartBtn.addEventListener('click', () => { hideScreens(); startGame(); });
  el.quitBtn.addEventListener('click', () => { goMenu(); });
  el.againBtn.addEventListener('click', () => { hideScreens(); startGame(); });
  el.homeBtn.addEventListener('click', () => { goMenu(); });
  el.soundBtn.addEventListener('click', () => {
    const m = sfx.toggle();
    el.soundBtn.classList.toggle('is-muted', m);
    el.soundBtn.setAttribute('aria-pressed', String(m));
  });

  /* ---------------- 主循环 ---------------- */
  let last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;

    if (S.mode === 'playing') {
      update(dt);
    } else if (S.mode === 'menu') {
      S.time += dt;
    } else if (S.mode === 'over') {
      S.time += dt;
      updateParts(dt);
    }
    render();
  }

  /* ---------------- 启动 ---------------- */
  loadBest();
  S.map = buildMap(1);
  el.menuBest.textContent = String(S.best).padStart(6, '0');
  requestAnimationFrame(loop);

  // 调试/扩展入口（不影响游戏）
  window.TankFront = { state: S, start: startGame, buildMap, beginWave };
})();
