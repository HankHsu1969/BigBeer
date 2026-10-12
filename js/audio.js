// Audio engine: everything except the German voice lines is synthesised live
// with the Web Audio API — modal-synthesis glass clinks, stoneware clunks,
// wooden barrel knocks, sliding friction noise, beer fizz bubbles, a crowd
// with applause, the beer-tent ambience and a cowbell alarm.
(function () {
  let ctx = null;
  let master, comp, musicBus, sfxBus, ambBus, revIn, noiseBuf;
  let slideSrc, slideBand, slideLow, slideGain, slideLowGain;
  let ambTimer = null;
  const voices = {};
  const state = { music: true, sfx: true };
  let lastVoiceAt = -10;
  const recent = [];   // timestamps of recent one-shots (voice limiter)

  const VOICE_FILES = {
    prost: 'assets/audio/prost.mp3',
    ozapft: 'assets/audio/ozapft.mp3',
    gsuffa: 'assets/audio/gsuffa.mp3',
    wunderbar: 'assets/audio/wunderbar.mp3',
    jawohl: 'assets/audio/jawohl.mp3',
    ohnein: 'assets/audio/ohnein.mp3',
    nochamass: 'assets/audio/nochamass.mp3',
    prosit: 'assets/audio/prosit.mp3',
    schunkeln: 'assets/audio/schunkeln.mp3',
    schnaps: 'assets/audio/schnaps.mp3',
    freibier: 'assets/audio/freibier.mp3',
    schnell: 'assets/audio/schnell.mp3',
    bitte: 'assets/audio/bitte.mp3',
  };

  try {
    state.music = localStorage.getItem('bb_music') !== '0';
    state.sfx = localStorage.getItem('bb_sfx') !== '0';
  } catch (e) { /* storage unavailable */ }

  function preloadVoices() {
    for (const k in VOICE_FILES) {
      const a = new Audio();
      a.preload = 'auto';
      a.src = VOICE_FILES[k];
      voices[k] = a;
    }
  }
  preloadVoices();

  function makeImpulse(seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections from the tent canvas + a warm, damped tail
        const er = i < rate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
        const n = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        lp += (n - lp) * (0.35 - 0.25 * t);          // darker as it decays
        d[i] = lp * 1.6 + er;
      }
    }
    return buf;
  }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    master = ctx.createGain(); master.gain.value = 0.95;
    master.connect(comp); comp.connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(2.6, 3.2);
    revIn = ctx.createGain(); revIn.gain.value = 1;
    const revOut = ctx.createGain(); revOut.gain.value = 0.55;
    revIn.connect(reverb); reverb.connect(revOut); revOut.connect(master);

    musicBus = ctx.createGain(); musicBus.gain.value = state.music ? 0.5 : 0;
    musicBus.connect(master);
    const mSend = ctx.createGain(); mSend.gain.value = 0.22; musicBus.connect(mSend); mSend.connect(revIn);

    sfxBus = ctx.createGain(); sfxBus.gain.value = state.sfx ? 0.9 : 0;
    sfxBus.connect(master);
    const sSend = ctx.createGain(); sSend.gain.value = 0.3; sfxBus.connect(sSend); sSend.connect(revIn);

    ambBus = ctx.createGain(); ambBus.gain.value = state.sfx ? 0.32 : 0;
    ambBus.connect(master);
    const aSend = ctx.createGain(); aSend.gain.value = 0.5; ambBus.connect(aSend); aSend.connect(revIn);

    const len = ctx.sampleRate * 3;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

    setupSlide();
  }

  const now = () => (ctx ? ctx.currentTime : 0);
  const rand = (a, b) => a + Math.random() * (b - a);

  function out(gain, pan, bus) {
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(p);
      node = p;
    }
    node.connect(bus || sfxBus);
    return g;
  }

  function noise(t, dur, dest, offset) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.connect(dest);
    src.start(t, offset != null ? offset : Math.random() * 2.5);
    src.stop(t + dur + 0.05);
    return src;
  }

  function env(param, t, peak, attack, decay, curve) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    if (curve === 'lin') param.linearRampToValueAtTime(0.0001, t + attack + decay);
    else param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // ---------- modal impact synthesis ----------
  const MATS = {
    glass: { ratios: [1, 2.32, 4.25, 6.63, 9.38], amps: [1, 0.55, 0.32, 0.18, 0.1], decay: 0.95, hit: 4200, hitQ: 0.7, hitAmp: 0.35 },
    ceramic: { ratios: [1, 2.09, 3.41, 5.12], amps: [1, 0.5, 0.28, 0.12], decay: 0.22, hit: 1600, hitQ: 0.9, hitAmp: 0.6 },
    wood: { ratios: [1, 2.43, 3.88, 5.6], amps: [1, 0.45, 0.25, 0.1], decay: 0.13, hit: 900, hitQ: 1.2, hitAmp: 0.9 },
    rail: { ratios: [1, 2.7, 4.1], amps: [1, 0.35, 0.15], decay: 0.09, hit: 700, hitQ: 1.0, hitAmp: 1.0 },
  };

  function impact(mat, f0, intensity, pan, delay) {
    if (!ctx || !state.sfx) return;
    const M = MATS[mat] || MATS.glass;
    const t = now() + (delay || 0) + 0.005;
    const I = Math.max(0.05, Math.min(1, intensity));
    const o = out(0.55 * Math.pow(I, 0.8), pan);
    const detune = rand(0.97, 1.03);
    // decay longer for bigger/softer hits, shorter for tiny glasses
    const sizeDecay = mat === 'glass' ? Math.min(1.6, 0.55 + 600 / f0) : 1;
    for (let i = 0; i < M.ratios.length; i++) {
      const f = f0 * detune * M.ratios[i] * rand(0.995, 1.005);
      if (f > 16000) continue;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const dec = (M.decay * sizeDecay) / Math.pow(1 + i, 0.75);
      const amp = M.amps[i] * (i === 0 ? 1 : 0.6 + 0.4 * I) * 0.5;
      env(g.gain, t, amp, 0.0015, dec);
      osc.connect(g); g.connect(o);
      osc.start(t); osc.stop(t + dec + 0.05);
      // glass rings with a slow beating "shimmer" on the fundamental
      if (mat === 'glass' && i === 0) {
        const o2 = ctx.createOscillator();
        o2.frequency.value = f + rand(1.5, 4);
        const g2 = ctx.createGain();
        env(g2.gain, t, amp * 0.6, 0.002, dec * 1.15);
        o2.connect(g2); g2.connect(o);
        o2.start(t); o2.stop(t + dec * 1.15 + 0.05);
      }
    }
    // contact transient
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = M.hit * rand(0.85, 1.15);
    bp.Q.value = M.hitQ;
    const ng = ctx.createGain();
    env(ng.gain, t, M.hitAmp * (0.4 + 0.6 * I), 0.0008, mat === 'glass' ? 0.018 : 0.045);
    bp.connect(ng); ng.connect(o);
    noise(t, 0.08, bp);
  }

  // A mug-vs-mug collision: both vessels ring
  function collide(levA, levB, v, pan) {
    if (!ctx || !state.sfx) return;
    const I = Math.min(1, v / 900);
    const A = BB.LEVELS[levA], B = BB.LEVELS[levB];
    impact(A.mat, A.f0, I, pan);
    if (levA !== levB || Math.random() < 0.6) impact(B.mat, B.f0 * rand(0.98, 1.02), I * 0.8, pan, 0.004);
  }

  function wall(lev, v, pan) {
    if (!ctx || !state.sfx) return;
    const I = Math.min(1, v / 1000);
    impact('rail', rand(95, 130), I * 0.9, pan);
    const L = BB.LEVELS[lev];
    impact(L.mat, L.f0, I * 0.6, pan, 0.003);
  }

  function land(lev, v, pan) {
    if (!ctx || !state.sfx) return;
    const I = Math.min(1, v / 900);
    const L = BB.LEVELS[lev];
    impact('rail', rand(80, 110), I * 0.7, pan);
    impact(L.mat, L.f0 * 0.98, I * 0.35, pan, 0.002);
  }

  // ---------- beer fizz, bubbles and glugs ----------
  function fizz(intensity, pan, big) {
    if (!ctx || !state.sfx) return;
    const t = now() + 0.01;
    const I = Math.max(0.2, Math.min(1, intensity));
    const dur = 0.45 + I * 0.9;
    const o = out(0.5, pan);
    // foam hiss
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800;
    const hs = ctx.createBiquadFilter(); hs.type = 'peaking'; hs.frequency.value = 7000; hs.gain.value = 6;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t);
    hg.gain.linearRampToValueAtTime(0.16 * I, t + 0.03);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    hp.connect(hs); hs.connect(hg); hg.connect(o);
    noise(t, dur, hp);
    // tiny popping bubbles
    const n = Math.floor(12 + I * 34);
    for (let i = 0; i < n; i++) {
      const bt = t + Math.pow(Math.random(), 1.6) * dur * 0.85;
      const f = rand(900, 3600);
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(f, bt);
      osc.frequency.exponentialRampToValueAtTime(f * rand(1.4, 2.2), bt + 0.025);
      const g = ctx.createGain();
      env(g.gain, bt, rand(0.02, 0.06), 0.002, 0.03);
      osc.connect(g); g.connect(o);
      osc.start(bt); osc.stop(bt + 0.05);
    }
    // glug-glug for the big vessels
    if (big) {
      const glugs = 3 + Math.floor(I * 4);
      for (let i = 0; i < glugs; i++) {
        const bt = t + 0.05 + i * rand(0.09, 0.14);
        const f = rand(170, 300);
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(f, bt);
        osc.frequency.exponentialRampToValueAtTime(f * 1.9, bt + 0.07);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
        const g = ctx.createGain();
        env(g.gain, bt, 0.22, 0.008, 0.08);
        osc.connect(lp); lp.connect(g); g.connect(o);
        osc.start(bt); osc.stop(bt + 0.12);
      }
    }
  }

  // ---------- push: hand thump + slide whoosh ----------
  function push(power, pan) {
    if (!ctx || !state.sfx) return;
    const t = now() + 0.005;
    const o = out(0.6, pan);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.09);
    const g = ctx.createGain();
    env(g.gain, t, 0.35, 0.003, 0.11);
    osc.connect(g); g.connect(o);
    osc.start(t); osc.stop(t + 0.15);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(1800 + power * 1500, t + 0.18);
    const ng = ctx.createGain();
    env(ng.gain, t, 0.12 + power * 0.18, 0.02, 0.28);
    bp.connect(ng); ng.connect(o);
    noise(t, 0.35, bp);
  }

  // ---------- continuous sliding friction on the wet wooden table ----------
  function setupSlide() {
    slideBand = ctx.createBiquadFilter(); slideBand.type = 'bandpass'; slideBand.frequency.value = 1100; slideBand.Q.value = 0.7;
    slideLow = ctx.createBiquadFilter(); slideLow.type = 'lowpass'; slideLow.frequency.value = 260;
    slideGain = ctx.createGain(); slideGain.gain.value = 0;
    slideLowGain = ctx.createGain(); slideLowGain.gain.value = 0;
    slideSrc = ctx.createBufferSource(); slideSrc.buffer = noiseBuf; slideSrc.loop = true;
    slideSrc.connect(slideBand); slideBand.connect(slideGain); slideGain.connect(sfxBus);
    slideSrc.connect(slideLow); slideLow.connect(slideLowGain); slideLowGain.connect(sfxBus);
    slideSrc.start();
  }

  function setSlide(amount, heavy) {
    if (!ctx || !slideGain) return;
    const t = now();
    const a = Math.max(0, Math.min(1, amount));
    slideGain.gain.setTargetAtTime(state.sfx ? a * 0.16 : 0, t, 0.05);
    slideLowGain.gain.setTargetAtTime(state.sfx ? Math.min(1, heavy) * a * 0.6 : 0, t, 0.06);
    slideBand.frequency.setTargetAtTime(700 + a * 1300, t, 0.08);
  }

  // ---------- crowd cheer with applause and whistles ----------
  function cheer(intensity) {
    if (!ctx || !state.sfx) return;
    const t = now() + 0.02;
    const I = Math.max(0.3, Math.min(1, intensity));
    const dur = 1.6 + I * 1.6;
    const o = out(0.42 * I, 0);
    const centers = [320, 480, 700, 950, 1250, 1650, 2200, 2900];
    for (const fc of centers) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fc * rand(0.9, 1.1); bp.Q.value = rand(2, 4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(rand(0.25, 0.45), t + rand(0.12, 0.35));
      g.gain.setValueAtTime(rand(0.2, 0.4), t + dur * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // syllabic "hey / yeah" flutter
      const lfo = ctx.createOscillator(); lfo.frequency.value = rand(3, 7);
      const lg = ctx.createGain(); lg.gain.value = 0.12;
      lfo.connect(lg); lg.connect(g.gain);
      lfo.start(t); lfo.stop(t + dur);
      bp.connect(g); g.connect(o);
      noise(t, dur, bp);
    }
    // applause: dense random hand claps
    const claps = Math.floor(40 + I * 90);
    for (let i = 0; i < claps; i++) {
      const ct = t + 0.1 + Math.random() * dur * 0.8;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(900, 2600); bp.Q.value = rand(0.8, 2);
      const g = ctx.createGain();
      env(g.gain, ct, rand(0.05, 0.16), 0.001, rand(0.02, 0.05));
      bp.connect(g); g.connect(o);
      noise(ct, 0.07, bp);
    }
    // a couple of finger whistles
    const wh = I > 0.6 ? 2 : 1;
    for (let i = 0; i < wh; i++) {
      const wt = t + rand(0.1, 0.6);
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(rand(1700, 2000), wt);
      osc.frequency.exponentialRampToValueAtTime(rand(2600, 3000), wt + 0.18);
      osc.frequency.exponentialRampToValueAtTime(rand(2100, 2400), wt + 0.55);
      const g = ctx.createGain();
      env(g.gain, wt, 0.07, 0.03, 0.6, 'lin');
      osc.connect(g); g.connect(o);
      osc.start(wt); osc.stop(wt + 0.7);
    }
  }

  // ---------- Bavarian cowbell (danger warning) ----------
  function cowbell(intensity) {
    if (!ctx || !state.sfx) return;
    const t = now() + 0.005;
    const o = out(0.32 * (intensity || 1), 0);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 820; bp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    for (const f of [562, 845]) {
      const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = f;
      osc.connect(bp); osc.start(t); osc.stop(t + 0.6);
    }
    bp.connect(g); g.connect(o);
  }

  // ---------- sad trombone for game over ----------
  function sadTrombone() {
    if (!ctx || !state.sfx) return;
    const t0 = now() + 0.05;
    const o = out(0.4, 0);
    const notes = [[293.66, 0.38], [277.18, 0.38], [261.63, 0.38], [246.94, 1.3]];
    let t = t0;
    for (const [f, d] of notes) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 1.02, t);
      osc.frequency.linearRampToValueAtTime(f, t + 0.06);
      if (d > 1) {
        const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
        const lg = ctx.createGain(); lg.gain.value = 6;
        lfo.connect(lg); lg.connect(osc.frequency);
        lfo.start(t + 0.25); lfo.stop(t + d);
        osc.frequency.linearRampToValueAtTime(f * 0.94, t + d);
      }
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.linearRampToValueAtTime(1500, t + 0.12);
      lp.frequency.linearRampToValueAtTime(700, t + d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.05);
      g.gain.setValueAtTime(0.45, t + d - 0.08);
      g.gain.linearRampToValueAtTime(0.0001, t + d);
      osc.connect(lp); lp.connect(g); g.connect(o);
      osc.start(t); osc.stop(t + d + 0.05);
      t += d;
    }
  }

  // ---------- a fist slamming the beer table: thump + every glass jingles ----------
  function tableBang(intensity) {
    if (!ctx || !state.sfx) return;
    const t = now() + 0.005;
    const I = Math.max(0.3, Math.min(1, intensity));
    const o = out(0.9 * I, 0);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const g = ctx.createGain();
    env(g.gain, t, 0.9, 0.003, 0.32);
    osc.connect(g); g.connect(o);
    osc.start(t); osc.stop(t + 0.4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const ng = ctx.createGain();
    env(ng.gain, t, 0.8, 0.002, 0.12);
    lp.connect(ng); ng.connect(o);
    noise(t, 0.2, lp);
    impact('rail', 72, 1, 0);
    // every vessel on the table rattles
    const jingles = 4 + Math.floor(I * 5);
    for (let i = 0; i < jingles; i++) {
      const lv = BB.LEVELS[Math.floor(Math.random() * 9)];
      impact(lv.mat, lv.f0 * rand(0.95, 1.05), rand(0.25, 0.6) * I, rand(-0.7, 0.7), 0.02 + Math.random() * 0.12);
    }
  }

  // short rising "ding-ding" for timers and event warnings
  function alert(hi) {
    if (!ctx || !state.sfx) return;
    const t = now() + 0.005;
    const o = out(0.25, 0);
    [0, 0.11].forEach((dt, i) => {
      const osc = ctx.createOscillator(); osc.type = 'triangle';
      osc.frequency.value = (hi ? 1320 : 990) * (i ? 1.26 : 1);
      const g = ctx.createGain();
      env(g.gain, t + dt, 0.5, 0.004, 0.16);
      osc.connect(g); g.connect(o);
      osc.start(t + dt); osc.stop(t + dt + 0.2);
    });
  }

  function uiTick() {
    if (!ctx || !state.sfx) return;
    impact('wood', 520, 0.5, 0);
  }

  // ---------- beer-tent ambience: crowd murmur + distant clinks ----------
  function startAmbience() {
    if (!ctx || ambTimer) return;
    const t = now();
    const layers = [];
    for (const fc of [260, 420, 650, 900, 1300, 1900]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fc; bp.Q.value = 1.8;
      const g = ctx.createGain(); g.gain.value = 0.0;
      bp.connect(g); g.connect(ambBus);
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      src.connect(bp); src.start(t, Math.random() * 2);
      layers.push(g);
    }
    let tick = 0;
    ambTimer = setInterval(() => {
      if (!ctx) return;
      const tt = now();
      for (const g of layers) g.gain.setTargetAtTime(rand(0.05, 0.2), tt, rand(0.15, 0.5));
      tick++;
      // a distant "Prost" clink somewhere in the tent
      if (Math.random() < 0.28) {
        const f = rand(900, 2300);
        const pan = rand(-0.9, 0.9);
        const save = sfxBus;
        sfxBus = ambBus;
        impact('glass', f, rand(0.15, 0.4), pan);
        if (Math.random() < 0.5) impact('glass', f * rand(1.05, 1.25), rand(0.1, 0.3), pan, 0.02);
        sfxBus = save;
      }
    }, 420);
  }

  // ---------- voice lines (generated with Higgsfield TTS) ----------
  function voice(name, force) {
    if (!state.sfx) return;
    const a = voices[name];
    if (!a) return;
    const tNow = performance.now() / 1000;
    if (!force && tNow - lastVoiceAt < 1.4) return;
    lastVoiceAt = tNow;
    try {
      a.currentTime = 0;
      a.volume = 1;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
    duckMusic(1.3);
  }

  function duckMusic(seconds) {
    if (!ctx || !state.music) return;
    const t = now();
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setTargetAtTime(0.22, t, 0.05);
    musicBus.gain.setTargetAtTime(0.5, t + seconds, 0.3);
  }

  function setMusic(on) {
    state.music = on;
    try { localStorage.setItem('bb_music', on ? '1' : '0'); } catch (e) { /* ignore */ }
    if (ctx) musicBus.gain.setTargetAtTime(on ? 0.5 : 0, now(), 0.1);
  }
  function setSfx(on) {
    state.sfx = on;
    try { localStorage.setItem('bb_sfx', on ? '1' : '0'); } catch (e) { /* ignore */ }
    if (ctx) {
      sfxBus.gain.setTargetAtTime(on ? 0.9 : 0, now(), 0.05);
      ambBus.gain.setTargetAtTime(on ? 0.32 : 0, now(), 0.2);
    }
    if (!on) for (const k in voices) { try { voices[k].pause(); } catch (e) { /* ignore */ } }
  }

  BB.Audio = {
    init, state, impact, collide, wall, land, fizz, push, setSlide, cheer, cowbell, tableBang, alert,
    sadTrombone, uiTick, startAmbience, voice, setMusic, setSfx, duckMusic,
    get ctx() { return ctx; },
    get musicBus() { return musicBus; },
    get noiseBuf() { return noiseBuf; },
  };
})();
