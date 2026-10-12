// Game flow: loading, title, playing, pause, game over. Input handling,
// spawning / pushing mugs, merge scoring, effects and audio cues.
(function () {
  const CFG = BB.CFG;
  const LEVELS = BB.LEVELS;
  const A = BB.Audio;
  const $ = (id) => document.getElementById(id);
  BB.DEBUG = /[?&]debug/.test(location.search);
  const TEST = /[?&](auto|view)=/.test(location.search);   // automated test runs never save a best score

  const canvas = $('game');
  BB.Render.init(canvas);

  const game = {
    state: 'loading',
    world: new BB.World(),
    held: null,
    next: 0,
    aimX: 0,
    aimVel: 0,
    charging: false,
    charge: 0,
    readyAt: 0,
    time: 0,
    score: 0,
    displayScore: 0,
    scoreBump: 0,
    best: 0,
    maxLevel: 0,
    danger: 0,
    dangerBell: 0,
    combo: 0,
    comboT: 0,
    shake: 0,
    seppJump: 0,
    seppV: 0,
    waitressHop: 0,
    particles: [],
    puddles: [],
    floaters: [],
    confetti: [],
    fps: 60,
    overAt: 0,
    playTime: 0,
    orderT: 0,          // time left before the waitress pushes the mug herself
    orderMax: 1,
    scoreMult: 1,
    evt: null,          // running beer-tent event
    evtNextAt: 0,
    evtBag: [],
    banner: null,
    swayAngle: 0,
  };
  BB.game = game;

  try { game.best = Number(localStorage.getItem('bb_best')) || 0; } catch (e) { /* ignore */ }

  // ---------- loading ----------
  function loadImages() {
    const list = [
      ['bg', 'assets/img/bg.jpg'],
      ['wood', 'assets/img/wood.jpg'],
      ['logo', 'assets/img/logo.webp'],
      ['waitress', 'assets/img/waitress.webp'],
      ['sepp', 'assets/img/sepp.webp'],
    ];
    LEVELS.forEach((L, i) => list.push(['mug' + i, `assets/img/${L.key}.webp`]));
    const IMG = { mugs: [] };
    let done = 0;
    return new Promise((resolve) => {
      for (const [k, src] of list) {
        const im = new Image();
        im.onload = im.onerror = () => {
          done++;
          $('load-fill').style.width = `${Math.round((done / list.length) * 100)}%`;
          if (done === list.length) resolve(IMG);
        };
        im.src = src;
        if (k.startsWith('mug')) IMG.mugs[Number(k.slice(3))] = im; else IMG[k] = im;
      }
    });
  }

  loadImages().then(async (IMG) => {
    BB.IMG = IMG;
    if (document.fonts && document.fonts.load) {
      try { await Promise.race([document.fonts.load('40px "Lilita One"'), new Promise((r) => setTimeout(r, 1500))]); } catch (e) { /* offline */ }
    }
    BB.Render.resize();
    $('load-text').textContent = '啤酒都倒好了！';
    $('btn-enter').classList.remove('hidden');
    game.state = 'title-wait';
    resetBoard(true);
    testHooks();
  });

  // ?view=title shows the title screen, ?auto=N lets a bot push N mugs
  // (used for automated screenshots; audio stays off without a user gesture)
  function testHooks() {
    const q = new URLSearchParams(location.search);
    if (q.get('view') === 'title') showTitle();
    if (q.get('view') === 'over') { startGame(); game.score = 1234; game.maxLevel = 7; gameOver(); }
    const auto = Number(q.get('auto'));
    if (!auto) return;
    startGame();
    let left = auto;
    const iv = setInterval(() => {
      if (game.state !== 'playing' || left <= 0) { clearInterval(iv); return; }
      if (!game.held || game.time < game.readyAt) return;
      game.aimX = (Math.random() - 0.5) * CFG.W;
      game.charging = true;
      game.charge = Math.random();
      release();
      left--;
    }, 650);
  }

  // ---------- UI wiring ----------
  function show(id) {
    for (const s of ['screen-loading', 'screen-title', 'screen-pause', 'screen-over']) $(s).classList.toggle('hidden', s !== id);
  }

  $('btn-enter').addEventListener('click', () => {
    A.init();
    A.startAmbience();
    A.uiTick();
    if (A.state.music) BB.Music.start(true);
    showTitle();
  });

  function showTitle() {
    game.state = 'title';
    $('title-best').textContent = game.best;
    $('hud-buttons').classList.add('hidden');
    show('screen-title');
    resetBoard(true);
  }

  $('btn-start').addEventListener('click', () => { A.init(); A.uiTick(); startGame(); });
  $('btn-retry').addEventListener('click', () => { A.uiTick(); startGame(true); });
  $('btn-home').addEventListener('click', () => { A.uiTick(); showTitle(); if (A.state.music && !BB.Music.playing) BB.Music.start(true); });
  $('btn-resume').addEventListener('click', () => { A.uiTick(); resume(); });
  $('btn-quit').addEventListener('click', () => { A.uiTick(); showTitle(); if (A.state.music && !BB.Music.playing) BB.Music.start(true); });
  $('btn-pause').addEventListener('click', () => { A.uiTick(); pause(); });
  $('btn-music').addEventListener('click', toggleMusic);
  $('btn-sfx').addEventListener('click', toggleSfx);
  syncToggles();

  function syncToggles() {
    $('btn-music').classList.toggle('off', !A.state.music);
    $('btn-sfx').classList.toggle('off', !A.state.sfx);
    $('btn-sfx').textContent = A.state.sfx ? '🔊' : '🔈';
  }
  function toggleMusic() {
    A.init();
    A.setMusic(!A.state.music);
    if (A.state.music && !BB.Music.playing && game.state !== 'paused') BB.Music.start();
    syncToggles();
  }
  function toggleSfx() {
    A.init();
    A.setSfx(!A.state.sfx);
    syncToggles();
    A.uiTick();
  }

  // ---------- game control ----------
  function resetBoard(demo) {
    game.world.clear();
    game.particles.length = 0;
    game.puddles.length = 0;
    game.floaters.length = 0;
    game.confetti.length = 0;
    game.danger = 0;
    game.combo = 0;
    game.held = null;
    game.charging = false;
    game.charge = 0;
    if (demo) {
      // a few mugs lying around behind the title screen
      const demoSet = [[10, -110, 560], [8, 150, 580], [6, 40, 420], [5, -190, 400], [3, 200, 400], [4, -40, 320], [1, 130, 300], [2, -210, 300], [0, 40, 260]];
      for (const [lvl, x, y] of demoSet) game.world.add(new BB.Body(lvl, x, y));
    }
  }

  function randomLevel() {
    const w = CFG.SPAWN_WEIGHTS;
    const maxSpawn = w.length - 1;
    let total = 0;
    for (let i = 0; i <= maxSpawn; i++) total += w[i];
    let r = Math.random() * total;
    for (let i = 0; i <= maxSpawn; i++) { r -= w[i]; if (r <= 0) return i; }
    return 0;
  }

  function startGame(retry) {
    resetBoard(false);
    game.score = 0;
    game.displayScore = 0;
    game.maxLevel = 0;
    game.time = 0;
    game.playTime = 0;
    game.scoreMult = 1;
    game.evt = null;
    game.evtBag = [];
    game.evtNextAt = CFG.EVENT_FIRST;
    game.banner = null;
    game.swayAngle = 0;
    game.world.gx = 0;
    BB.Music.setTempo(128);
    game.aimX = 0;
    game.next = randomLevel();
    game.held = { lvl: randomLevel(), pop: 0.4, alpha: 1 };
    resetOrderTimer();
    game.readyAt = 0;
    game.state = 'playing';
    show(null);
    $('hud-buttons').classList.remove('hidden');
    if (A.state.music && !BB.Music.playing) BB.Music.start(true);
    A.voice(retry ? 'nochamass' : 'ozapft', true);
    if (!retry) A.cheer(0.5);
  }

  function pause() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    game.charging = false;
    BB.Music.stop(0.2);
    A.setSlide(0, 0);
    show('screen-pause');
  }
  function resume() {
    if (game.state !== 'paused') return;
    game.state = 'playing';
    show(null);
    if (A.state.music) BB.Music.start();
  }

  function gameOver() {
    game.state = 'over';
    game.charging = false;
    game.held = null;
    game.evt = null;
    game.world.gx = 0;
    game.scoreMult = 1;
    A.setSlide(0, 0);
    BB.Music.stop(0.3);
    A.sadTrombone();
    setTimeout(() => A.voice('ohnein', true), 250);
    const isBest = game.score > game.best;
    if (isBest) {
      game.best = game.score;
      if (!TEST) try { localStorage.setItem('bb_best', String(game.best)); } catch (e) { /* ignore */ }
    }
    setTimeout(() => {
      if (game.state !== 'over') return;
      $('over-score').textContent = game.score;
      $('over-best').innerHTML = isBest ? '🎉 新紀錄！' : `最高分 <span>${game.best}</span>`;
      const L = LEVELS[game.maxLevel];
      $('over-max').textContent = `${L.zh}（${L.de}）`;
      $('hud-buttons').classList.add('hidden');
      show('screen-over');
    }, 1700);
  }

  // ---------- input ----------
  let pointerActive = false;
  function setAimFromPointer(e) {
    const rect = canvas.getBoundingClientRect();
    const x = BB.Render.screenToAimX(e.clientX - rect.left);
    game.aimX = x;
  }
  canvas.addEventListener('pointermove', (e) => {
    if (game.state !== 'playing') return;
    if (e.pointerType === 'mouse' || pointerActive) setAimFromPointer(e);
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (game.state !== 'playing') return;
    if (e.button != null && e.button > 0) return;
    pointerActive = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    setAimFromPointer(e);
    beginCharge();
  });
  const endPointer = (e) => {
    if (!pointerActive) return;
    pointerActive = false;
    if (game.state === 'playing') release();
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', () => { pointerActive = false; game.charging = false; game.charge = 0; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const keys = {};
  window.addEventListener('keydown', (e) => {
    if (e.repeat) { if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) e.preventDefault(); return; }
    keys[e.code] = true;
    if (game.state === 'playing') {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); beginCharge(); }
      if (e.code === 'KeyP' || e.code === 'Escape') pause();
    } else if (game.state === 'paused' && (e.code === 'KeyP' || e.code === 'Escape')) {
      resume();
    } else if (game.state === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault(); A.init(); startGame();
    }
    if (e.code === 'KeyM') toggleMusic();
    if (e.code === 'KeyN') toggleSfx();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (game.state === 'playing' && (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW')) release();
  });

  function beginCharge() {
    if (!game.held || game.time < game.readyAt) {
      game.queuedCharge = true;
      return;
    }
    game.charging = true;
    game.charge = 0;
  }

  function release() {
    game.queuedCharge = false;
    if (!game.charging || !game.held) { game.charging = false; return; }
    const power = game.charge;
    game.charging = false;
    game.charge = 0;
    pushMug(power);
  }

  function pushMug(power) {
    const lvl = game.held.lvl;
    const r = LEVELS[lvl].r;
    const x = clampAim(game.aimX, r);
    const b = new BB.Body(lvl, x, CFG.LAUNCH_Y);
    b.vy = CFG.PUSH_MIN + (CFG.PUSH_MAX - CFG.PUSH_MIN) * power;
    b.vx = 0;
    b.age = 0;
    game.world.add(b);
    A.push(power, panOf(x));
    game.held = null;
    game.readyAt = game.time + CFG.COOLDOWN;
    game.waitressHop = 1;
  }

  function clampAim(x, r) {
    const lim = CFG.W / 2 - r - 1;
    return Math.max(-lim, Math.min(lim, x));
  }
  const panOf = (x) => Math.max(-0.8, Math.min(0.8, x / (CFG.W / 2)));

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => BB.Render.resize(), 80);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    // silence the whole tent while the tab is in the background
    const ctx = A.ctx;
    if (ctx) { if (document.hidden) ctx.suspend(); else ctx.resume(); }
  });

  // ---------- effects ----------
  function splash(x, y, z, lvl, amount) {
    const L = LEVELS[lvl];
    const n = Math.floor(8 + amount * 26);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 260 * (0.6 + amount);
      const foam = Math.random() < 0.45;
      game.particles.push({
        x, y, z: z + Math.random() * 20,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8,
        vz: 250 + Math.random() * 520 * (0.6 + amount),
        size: foam ? 3 + Math.random() * 5 : 2 + Math.random() * 3.5,
        color: foam ? '#fffaf0' : L.beer,
        foam,
        life: 1.6,
        lvl,
      });
    }
    game.puddles.push({ x, y, r: L.r * (0.7 + amount * 0.5), color: L.beer === '#eaf6ff' ? '#cfe6f5' : L.beer, life: 7 });
    if (game.puddles.length > 24) game.puddles.shift();
  }

  function floater(text, x, y, color, size, life) {
    y = Math.max(110, y);   // keep texts from mugs at the far end on screen
    game.floaters.push({ text, x, y, color: color || '#fff8e6', size: size || 40, life: life || 1.2, maxLife: life || 1.2, scale: 1 });
  }

  function confettiBurst(count) {
    const D = BB.Render.view.D;
    const cols = ['#1e6fc8', '#ffffff', '#5aa6f0', '#f5b31b', '#ffffff'];
    for (let i = 0; i < count; i++) {
      game.confetti.push({
        x: Math.random() * D.w, y: -20 - Math.random() * 300,
        vx: (Math.random() - 0.5) * 120, vy: 80 + Math.random() * 160,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8,
        flip: Math.random() * 6, vf: 4 + Math.random() * 8,
        size: 7 + Math.random() * 9,
        color: cols[i % cols.length],
        life: 6,
      });
    }
  }

  function handleEvents() {
    const evs = game.world.events;
    let hits = 0;
    for (const e of evs) {
      if (e.type === 'hit') {
        if (hits > 6) continue;
        const t = game.world.time;
        if (t - e.a.lastSnd < 0.07 && t - e.b.lastSnd < 0.07) continue;
        e.a.lastSnd = e.b.lastSnd = t;
        hits++;
        A.collide(e.a.lvl, e.b.lvl, e.v, panOf(e.x));
        if (e.v > 650) {
          const L = LEVELS[Math.max(e.a.lvl, e.b.lvl)];
          // a few drops slosh out on a hard knock
          for (let i = 0; i < 5; i++) {
            game.particles.push({ x: e.x, y: e.y, z: L.r * 1.4, vx: (Math.random() - 0.5) * 200, vy: (Math.random() - 0.5) * 160, vz: 200 + Math.random() * 250, size: 2 + Math.random() * 3, color: Math.random() < 0.5 ? '#fffaf0' : L.beer, foam: false, life: 1.2 });
          }
        }
      } else if (e.type === 'wall') {
        const t = game.world.time;
        if (t - e.b.lastSnd < 0.07) continue;
        e.b.lastSnd = t;
        A.wall(e.b.lvl, e.v, panOf(e.x));
      } else if (e.type === 'land') {
        A.land(e.b.lvl, e.v, panOf(e.x));
      } else if (e.type === 'merge') {
        onMerge(e);
      } else if (e.type === 'mega') {
        onMega(e);
      }
    }
    evs.length = 0;
  }

  function onMerge(e) {
    const lvl = e.lvl;
    const L = LEVELS[lvl];
    const pts = BB.SCORE_FOR(lvl);
    game.combo = game.comboT > 0 ? game.combo + 1 : 1;
    game.comboT = 1.1;
    const bonus = game.combo > 1 ? Math.round(pts * 0.25 * (game.combo - 1)) : 0;
    addScore(pts + bonus);
    const isNewMax = lvl > game.maxLevel;
    if (isNewMax) game.maxLevel = lvl;

    const amount = lvl / BB.MAX_LEVEL;
    splash(e.x, e.y, L.r * 1.2, lvl, amount);
    const pan = panOf(e.x);
    // the "Prost!" double clink of the two vessels meeting, then the fizz
    const prev = LEVELS[lvl - 1];
    A.impact(prev.mat, prev.f0, 0.85, pan);
    A.impact(prev.mat, prev.f0 * 1.06, 0.7, pan, 0.07);
    A.fizz(0.3 + amount * 0.8, pan, lvl >= 5);

    const p = BB.Render.worldToDesign(e.x, e.y, L.r * 2.2);
    floater(`+${(pts + bonus) * game.scoreMult}`, p.x, p.y, game.scoreMult > 1 ? '#ffe066' : L.color, 34 + lvl * 3, 1.1);
    if (lvl >= 4 || game.combo >= 3) {
      floater(game.combo >= 3 ? `${game.combo}× Combo!` : BB.CHEERS[lvl], p.x, p.y - 46, '#fff8e6', 36 + lvl * 2, 1.3);
    }
    if (isNewMax && lvl >= 5) floater(`NEW! ${L.zh}`, p.x, p.y - 92, '#ffd75e', 34, 1.6);

    game.shake = Math.max(game.shake, 0.08 + amount * 0.35);
    if (lvl >= 5) game.seppJump = Math.max(game.seppJump, 0.5 + amount * 0.5);

    // voices and crowd
    if (lvl === BB.MAX_LEVEL) {
      BB.Music.fanfare();
      A.cheer(1);
      A.voice('gsuffa', true);
      confettiBurst(140);
    } else if (lvl >= 8) {
      A.cheer(0.85);
      A.voice(Math.random() < 0.5 ? 'wunderbar' : 'jawohl');
      confettiBurst(50);
    } else if (lvl >= 6) {
      A.cheer(0.55);
      A.voice(Math.random() < 0.5 ? 'prost' : 'jawohl');
    } else if (lvl === 5) {
      A.voice('prost');
    } else if (game.combo >= 3) {
      A.voice('wunderbar');
    }
  }

  function onMega(e) {
    addScore(BB.MEGA_BONUS);
    splash(e.x, e.y, 200, BB.MAX_LEVEL, 1.3);
    splash(e.x, e.y, 120, BB.MAX_LEVEL, 1.1);
    const p = BB.Render.worldToDesign(e.x, e.y, 200);
    floater(`+${BB.MEGA_BONUS}`, p.x, p.y, '#ffd75e', 64, 1.8);
    floater('Ein Prosit!', p.x, p.y - 70, '#fff8e6', 52, 2);
    A.impact('wood', 170, 1, panOf(e.x));
    A.fizz(1, panOf(e.x), true);
    A.cheer(1);
    BB.Music.fanfare();
    A.voice('prosit', true);
    confettiBurst(220);
    game.shake = 0.6;
    game.seppJump = 1;
  }

  function addScore(n) {
    game.score += n * game.scoreMult;
    game.scoreBump = 1;
  }

  // ---------- the impatient waitress ----------
  function orderLimit() {
    return Math.max(CFG.ORDER_TIME_MIN, CFG.ORDER_TIME_START - game.playTime / CFG.ORDER_RAMP);
  }
  function resetOrderTimer() {
    game.orderMax = orderLimit();
    game.orderT = game.orderMax;
    game.orderWarned = false;
  }
  function updateOrderTimer(dt) {
    if (!game.held) return;
    game.orderT -= dt;
    if (!game.orderWarned && game.orderT < 1.6) {
      game.orderWarned = true;
      A.alert(true);
      A.voice('schnell');
      game.waitressHop = 1;
    }
    if (game.orderT <= 0) {
      // she pushes it herself, with whatever charge you had
      const power = game.charging ? game.charge : 0.25;
      game.charging = false;
      game.charge = 0;
      const p = BB.Render.worldToDesign(game.aimX, CFG.LAUNCH_Y, 160);
      floater('Schnell!', p.x, p.y, '#ff8a7a', 44, 1.1);
      pushMug(power);
    }
  }

  // ---------- random beer-tent events ----------
  const EVENTS = {
    sway:     { dur: 8.4, title: '全場搖擺！', sub: 'SCHUNKELN!', color: '#1e6fc8', voice: 'schunkeln' },
    bang:     { dur: 2.6, title: '拍桌乾杯！', sub: "OANS, ZWOA, G'SUFFA!", color: '#c8312f', voice: 'gsuffa' },
    schnaps:  { dur: 2.8, title: '請大家喝一輪！', sub: 'EINE RUNDE SCHNAPS!', color: '#7a4a20', voice: 'schnaps' },
    freibier: { dur: 10, title: '免費啤酒 分數×2', sub: 'FREIBIER!', color: '#d98a06', voice: 'freibier' },
  };

  function pickEvent() {
    if (!game.evtBag.length) {
      game.evtBag = Object.keys(EVENTS);
      for (let i = game.evtBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [game.evtBag[i], game.evtBag[j]] = [game.evtBag[j], game.evtBag[i]];
      }
    }
    return game.evtBag.pop();
  }

  function startEvent(type) {
    const E = EVENTS[type];
    game.evt = { type, t: 0, dur: E.dur, fired: 0 };
    game.banner = { title: E.title, sub: E.sub, color: E.color, t: 0, life: 2.4 };
    A.alert(false);
    A.voice(E.voice, true);
    if (type === 'freibier') { game.scoreMult = 2; A.cheer(0.7); confettiBurst(60); }
    if (type === 'sway') A.cheer(0.45);
    game.seppJump = Math.max(game.seppJump, 0.6);
  }

  function endEvent() {
    game.evt = null;
    game.world.gx = 0;
    game.scoreMult = 1;
    const gap = CFG.EVENT_GAP_MIN + Math.random() * (CFG.EVENT_GAP_MAX - CFG.EVENT_GAP_MIN);
    game.evtNextAt = game.playTime + Math.max(9, gap - game.playTime / 60);
  }

  function updateEvents(dt) {
    if (!game.evt) {
      if (game.playTime >= game.evtNextAt) startEvent(pickEvent());
      return;
    }
    const e = game.evt;
    e.t += dt;
    const strength = Math.min(1.4, 1 + game.playTime / 300);
    if (e.type === 'sway') {
      // the whole tent links arms and sways from side to side
      const t = e.t - 1.3;
      if (t > 0) {
        const fadeIn = Math.min(1, t / 0.8), fadeOut = Math.min(1, (e.dur - e.t) / 0.8);
        game.world.gx = CFG.SWAY_GX * strength * fadeIn * Math.max(0, fadeOut) * Math.sin((t * Math.PI * 2) / 2.6);
      }
    } else if (e.type === 'bang') {
      // three fists on the table in time with "Oans - zwoa - g'suffa!"
      const hits = [0.45, 1.05, 1.75];
      while (e.fired < hits.length && e.t >= hits[e.fired]) {
        tableBang(e.fired === 2 ? 1.25 * strength : 0.75 * strength);
        e.fired++;
      }
    } else if (e.type === 'schnaps') {
      // shot glasses rain down from the waitresses' trays
      const n = Math.min(6, 3 + Math.floor(game.playTime / 70));
      while (e.fired < n && e.t >= 1.0 + e.fired * 0.18) {
        dropGlass(Math.random() < 0.75 ? 0 : 1);
        e.fired++;
      }
    }
    if (e.t >= e.dur) endEvent();
  }

  function tableBang(power) {
    A.tableBang(Math.min(1, power));
    game.shake = Math.max(game.shake, 0.35 * power);
    game.seppJump = 1;
    for (const b of game.world.bodies) {
      const light = Math.min(1.6, 60 / b.r);
      b.vz = Math.max(b.vz, (180 + Math.random() * 200) * power * (0.6 + 0.4 * light));
      b.vx += (Math.random() - 0.5) * 260 * power * light;
      b.vy += (Math.random() - 0.65) * 200 * power * light;
      b.tiltV += (Math.random() - 0.5) * 6 * power;
    }
  }

  function dropGlass(lvl) {
    const r = LEVELS[lvl].r;
    const x = (Math.random() - 0.5) * (CFG.W - 2 * r);
    const y = CFG.DANGER_Y + 140 + Math.random() * (CFG.L - CFG.DANGER_Y - 140 - r);
    const b = new BB.Body(lvl, x, y);
    b.z = 520 + Math.random() * 120;
    b.vz = -100;
    b.age = 10;
    b.tilt = (Math.random() - 0.5) * 0.5;
    game.world.add(b);
  }

  // ---------- update ----------
  function update(dt) {
    game.time += dt;
    const W = game.world;

    if (game.state === 'playing') {
      // keyboard aiming
      const dir = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
      if (dir) game.aimX += dir * 420 * dt;
      // new mug arrives from the waitress
      if (!game.held && game.time >= game.readyAt) {
        game.held = { lvl: game.next, pop: 0.3, alpha: 1 };
        game.next = randomLevel();
        resetOrderTimer();
        if (Math.random() < 0.12) A.voice('bitte');
        if (game.queuedCharge) { game.charging = true; game.charge = 0; game.queuedCharge = false; }
      }
      game.playTime += dt;
      updateOrderTimer(dt);
      updateEvents(dt);
      // the band plays faster as the evening goes on, and faster still in danger
      BB.Music.setTempo(128 + Math.min(26, game.playTime / 7) + (game.danger > 0 ? 10 : 0));
      if (game.held) {
        game.aimX = clampAim(game.aimX, LEVELS[game.held.lvl].r);
        game.held.pop += (1 - game.held.pop) * Math.min(1, dt * 10);
      }
      if (game.charging) game.charge = Math.min(1, game.charge + dt / CFG.CHARGE_TIME);
    }

    if (game.state === 'playing' || game.state === 'title' || game.state === 'title-wait' || game.state === 'over') {
      const speed = game.state === 'over' ? 0.35 : 1;
      W.step(dt * speed);
      handleEvents();
    }

    // danger check
    if (game.state === 'playing') {
      let inDanger = false;
      for (const b of W.bodies) {
        if (b.age > CFG.DANGER_GRACE && b.y - b.r < CFG.DANGER_Y && Math.abs(b.vy) < 260) { inDanger = true; break; }
      }
      if (inDanger) {
        game.danger += dt;
        game.dangerBell -= dt;
        if (game.dangerBell <= 0) { A.cowbell(0.6 + game.danger / CFG.DANGER_LIMIT * 0.6); game.dangerBell = Math.max(0.35, 0.9 - game.danger * 0.18); }
        if (game.danger >= CFG.DANGER_LIMIT) gameOver();
      } else {
        game.danger = Math.max(0, game.danger - dt * 2);
        game.dangerBell = 0;
      }
    }

    // sliding friction sound from all moving mugs
    if (game.state === 'playing' || game.state === 'title') {
      let amt = 0, heavy = 0;
      for (const b of W.bodies) {
        if (b.z > 2) continue;
        const v = Math.max(0, b.slide - 25);
        amt += v * (0.4 + b.r / 140);
        heavy += v * (b.r / 138);
      }
      A.setSlide(amt / 1100, heavy / 500);
    }

    // timers & springs
    game.comboT = Math.max(0, game.comboT - dt);
    game.swayAngle += (-(W.gx / CFG.GRAVITY) * 0.09 - game.swayAngle) * Math.min(1, dt * 8);
    if (game.banner) { game.banner.t += dt; if (game.banner.t > game.banner.life) game.banner = null; }
    game.shake = Math.max(0, game.shake - dt * 1.6);
    game.scoreBump = Math.max(0, game.scoreBump - dt * 4);
    game.waitressHop = Math.max(0, game.waitressHop - dt * 3.5);
    game.seppJump = Math.max(0, game.seppJump - dt * 1.4);
    if (game.displayScore < game.score) game.displayScore = Math.min(game.score, game.displayScore + Math.max(1, Math.ceil((game.score - game.displayScore) * dt * 10)));

    // particles: real gravity in z, splat into puddles
    for (const p of game.particles) {
      p.vz -= CFG.ZGRAV * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.life -= dt;
      if (p.z <= 0) { p.z = 0; p.life = Math.min(p.life, 0.12); p.vx *= 0.3; p.vy *= 0.3; p.vz = 0; }
    }
    game.particles = game.particles.filter((p) => p.life > 0);
    for (const p of game.puddles) p.life -= dt;
    game.puddles = game.puddles.filter((p) => p.life > 0);
    for (const f of game.floaters) { f.life -= dt; f.y -= 60 * dt; }
    game.floaters = game.floaters.filter((f) => f.life > 0);
    const D = BB.Render.view.D;
    for (const c of game.confetti) {
      c.vy += 60 * dt; c.vx *= 0.99;
      c.x += (c.vx + Math.sin(c.flip) * 40) * dt; c.y += c.vy * dt;
      c.rot += c.vr * dt; c.flip += c.vf * dt; c.life -= dt;
    }
    game.confetti = game.confetti.filter((c) => c.life > 0 && c.y < D.h + 40);
  }

  // ---------- main loop ----------
  let last = performance.now();
  let acc = 0;
  const FIXED = 1 / 120;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    game.fps += (1 / Math.max(dt, 1e-3) - game.fps) * 0.05;
    if (BB.IMG && game.state !== 'loading' && game.state !== 'paused') {
      acc += dt;
      let n = 0;
      while (acc >= FIXED && n < 8) { update(FIXED); acc -= FIXED; n++; }
      if (n === 8) acc = 0;
    }
    if (BB.IMG) BB.Render.draw(game);
    nextFrame(frame);
  }
  // the auto-test bot runs on timers so headless captures advance in virtual time
  const nextFrame = /[?&]auto=/.test(location.search)
    ? (f) => setTimeout(() => f(performance.now()), 16)
    : (f) => requestAnimationFrame(f);
  nextFrame(frame);
})();
