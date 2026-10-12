// Procedural Bavarian "oom-pah" polka: tuba bass, accordion off-beat stabs,
// trumpets in parallel thirds, clarinets in the trio, glockenspiel sparkle and
// a little drum kit. Original melody, scheduled ahead with the Web Audio clock.
(function () {
  const A = BB.Audio;
  let bpm = 128;                      // the band speeds up as the party heats up
  let STEP = 60 / bpm / 4;            // one 16th note
  const BAR = 8;                      // 2/4 time -> 8 sixteenths per bar

  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const n = (s) => {
    const m = /^([A-G][b#]?)(\d)$/.exec(s);
    return 12 * (Number(m[2]) + 1) + NOTE[m[1]];
  };
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const KEY_BB = [10, 0, 2, 3, 5, 7, 9];
  const KEY_EB = [3, 5, 7, 8, 10, 0, 2];

  const CHORDS = {
    I:   { bass: [n('Bb2'), n('F2')],  stab: [n('D4'), n('F4'), n('Bb4')] },
    V7:  { bass: [n('F2'), n('C3')],   stab: [n('Eb4'), n('A4'), n('C5')] },
    IV:  { bass: [n('Eb2'), n('Bb2')], stab: [n('Eb4'), n('G4'), n('Bb4')] },
    Bb7: { bass: [n('Bb2'), n('F2')],  stab: [n('D4'), n('F4'), n('Ab4')] },
  };

  // melody: [note|null, sixteenths]
  const R = null;
  const A1 = [
    ['I',  [['F5', 2], ['D5', 2], ['F5', 2], ['Bb5', 2]]],
    ['I',  [['A5', 2], ['Bb5', 2], ['C6', 4]]],
    ['V7', [['C6', 2], ['A5', 2], ['C6', 2], ['Eb6', 2]]],
    ['V7', [['D6', 2], ['C6', 2], ['A5', 4]]],
    ['V7', [['C6', 2], ['A5', 2], ['F5', 2], ['A5', 2]]],
    ['V7', [['G5', 2], ['A5', 2], ['C6', 4]]],
    ['I',  [['Bb5', 2], ['F5', 2], ['D5', 2], ['F5', 2]]],
    ['I',  [['Bb5', 4], [R, 2], ['F5', 1], ['F5', 1]]],
  ];
  const A2 = [
    ['I',  [['Bb5', 2], ['D6', 2], ['Bb5', 2], ['F5', 2]]],
    ['I',  [['D5', 2], ['F5', 2], ['Bb5', 4]]],
    ['IV', [['G5', 2], ['Bb5', 2], ['Eb6', 2], ['Bb5', 2]]],
    ['IV', [['C6', 2], ['Bb5', 2], ['G5', 4]]],
    ['I',  [['F5', 2], ['Bb5', 2], ['D6', 2], ['Bb5', 2]]],
    ['V7', [['C6', 2], ['D6', 2], ['Eb6', 2], ['C6', 2]]],
    ['V7', [['A5', 2], ['F5', 2], ['G5', 2], ['A5', 2]]],
    ['I',  [['Bb5', 4], [R, 4]]],
  ];
  const B1 = [
    ['IV',  [['G5', 4], ['Bb5', 4]]],
    ['IV',  [['Eb6', 6], ['D6', 2]]],
    ['Bb7', [['D6', 4], ['C6', 2], ['Bb5', 2]]],
    ['Bb7', [['Ab5', 4], ['F5', 4]]],
    ['Bb7', [['F5', 2], ['G5', 2], ['Ab5', 2], ['Bb5', 2]]],
    ['Bb7', [['C6', 2], ['Bb5', 2], ['Ab5', 2], ['F5', 2]]],
    ['IV',  [['G5', 2], ['Bb5', 2], ['Eb6', 2], ['G5', 2]]],
    ['IV',  [['Bb5', 4], [R, 4]]],
  ];
  const B2 = [
    ['IV',  [['G5', 4], ['Bb5', 4]]],
    ['IV',  [['Eb6', 6], ['F6', 2]]],
    ['Bb7', [['D6', 4], ['C6', 2], ['Bb5', 2]]],
    ['Bb7', [['Ab5', 2], ['Bb5', 2], ['C6', 2], ['D6', 2]]],
    ['IV',  [['Eb6', 4], ['Bb5', 2], ['G5', 2]]],
    ['IV',  [['Eb5', 2], ['G5', 2], ['Bb5', 4]]],
    ['V7',  [['A5', 2], ['C6', 2], ['Eb6', 2], ['C6', 2]]],
    ['V7',  [['D6', 2], ['C6', 2], ['A5', 2], ['F5', 1], ['F5', 1]]],
  ];
  const INTRO = [
    ['I', [[R, 6], ['F5', 1], ['F5', 1]]],
    ['V7', [['C6', 2], ['A5', 2], ['F5', 4]]],
  ];

  // Build the arrangement: each bar knows its chord, key, lead instrument
  const SONG = [];
  function addSection(bars, opt) {
    for (const [ch, mel] of bars) SONG.push(Object.assign({ ch, mel }, opt));
  }
  function buildSong() {
    addSection(INTRO, { key: KEY_BB, lead: 'trumpet', intro: true });
    const loopStart = SONG.length;
    addSection(A1, { key: KEY_BB, lead: 'trumpet' });
    addSection(A2, { key: KEY_BB, lead: 'trumpet', crash0: true });
    addSection(B1, { key: KEY_EB, lead: 'clarinet', crash0: true });
    addSection(B2, { key: KEY_EB, lead: 'clarinet' });
    addSection(A1, { key: KEY_BB, lead: 'trumpet', glock: true, crash0: true });
    addSection(A2, { key: KEY_BB, lead: 'trumpet', glock: true });
    SONG[loopStart].crash = true;
    SONG[loopStart + 16].crash = true;
    SONG[loopStart + 32].crash = true;
    return loopStart;
  }
  const LOOP_START = buildSong();

  // diatonic third below (Bavarian brass loves parallel thirds)
  function thirdBelow(m, key) {
    for (const d of [3, 4]) if (key.includes((m - d + 120) % 12)) return m - d;
    return m - 3;
  }

  let timer = null;
  let nextTime = 0;
  let barIdx = 0;
  let stepInBar = 0;
  let playing = false;
  let volume = 1;
  let out = null;

  function ctx() { return A.ctx; }

  // ---------- instruments ----------
  function tuba(t, m, dur) {
    const c = ctx();
    const f = mtof(m);
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'square';
    o1.frequency.setValueAtTime(f * 0.95, t); o1.frequency.exponentialRampToValueAtTime(f, t + 0.035);
    o2.frequency.setValueAtTime(f * 0.95, t); o2.frequency.exponentialRampToValueAtTime(f, t + 0.035);
    const g2 = c.createGain(); g2.gain.value = 0.35;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.5;
    lp.frequency.setValueAtTime(f * 1.5, t);
    lp.frequency.linearRampToValueAtTime(f * 6, t + 0.03);
    lp.frequency.exponentialRampToValueAtTime(f * 2.6, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.025);
    g.gain.linearRampToValueAtTime(0.38, t + 0.1);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(out);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  function accordion(t, notes, dur, vel) {
    const c = ctx();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.55;
    const g = c.createGain();
    const peak = 0.07 * (vel || 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.setValueAtTime(peak * 0.85, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    bp.connect(g); g.connect(out);
    for (const m of notes) {
      const f = mtof(m);
      // musette tuning: three reeds slightly detuned against each other
      for (const cents of [-9, 0, 11]) {
        const o = c.createOscillator();
        o.type = cents === 0 ? 'square' : 'sawtooth';
        o.frequency.value = f * Math.pow(2, cents / 1200);
        o.connect(bp);
        o.start(t); o.stop(t + dur + 0.02);
      }
    }
  }

  function trumpet(t, m, dur, vel) {
    const c = ctx();
    const f = mtof(m);
    const o = c.createOscillator(); o.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.985, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    o2.frequency.setValueAtTime(f * 1.003, t);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(f * 1.4, t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 7), t + 0.045);
    lp.frequency.exponentialRampToValueAtTime(Math.min(7000, f * 4.2), t + Math.max(0.08, dur));
    const pk = c.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1300; pk.gain.value = 5; pk.Q.value = 1;
    const g = c.createGain();
    const peak = 0.11 * (vel || 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.03);
    g.gain.setValueAtTime(peak * 0.8, t + Math.max(0.04, dur - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    if (dur > 0.3) {
      const lfo = c.createOscillator(); lfo.frequency.value = 5.6;
      const lg = c.createGain(); lg.gain.value = f * 0.006;
      lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
      lfo.start(t + 0.15); lfo.stop(t + dur);
    }
    o.connect(lp); o2.connect(lp); lp.connect(pk); pk.connect(g); g.connect(out);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  function clarinet(t, m, dur, vel) {
    const c = ctx();
    const f = mtof(m);
    const o = c.createOscillator(); o.type = 'square';
    o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(6000, f * 3.2); lp.Q.value = 0.8;
    const g = c.createGain();
    const peak = 0.075 * (vel || 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.04);
    g.gain.setValueAtTime(peak * 0.9, t + Math.max(0.05, dur - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    if (dur > 0.25) {
      const lfo = c.createOscillator(); lfo.frequency.value = 5.2;
      const lg = c.createGain(); lg.gain.value = f * 0.004;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(t + 0.12); lfo.stop(t + dur);
    }
    o.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function glock(t, m, vel) {
    const c = ctx();
    const f = mtof(m + 12);
    for (const [ratio, amp, dec] of [[1, 0.06, 0.9], [2.76, 0.02, 0.35], [5.4, 0.01, 0.15]]) {
      const o = c.createOscillator(); o.frequency.value = f * ratio;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(amp * (vel || 1), t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dec + 0.02);
    }
  }

  function kick(t, vel) {
    const c = ctx();
    const o = c.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.3);
  }

  function snare(t, vel) {
    const c = ctx();
    const src = c.createBufferSource(); src.buffer = A.noiseBuf;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    src.connect(hp); hp.connect(g); g.connect(out);
    src.start(t, Math.random() * 2); src.stop(t + 0.14);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 190;
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.08 * vel, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(og); og.connect(out);
    o.start(t); o.stop(t + 0.1);
  }

  function crash(t, vel) {
    const c = ctx();
    const src = c.createBufferSource(); src.buffer = A.noiseBuf;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.13 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    src.connect(hp); hp.connect(g); g.connect(out);
    src.start(t, Math.random() * 1.5); src.stop(t + 1.5);
  }

  // ---------- sequencer ----------
  function playStep(bar, s, t) {
    const B = SONG[bar];
    const C = CHORDS[B.ch];
    // oom: tuba on beats 1 and 2, alternating root / fifth
    if (s === 0) { tuba(t, C.bass[0], STEP * 3.2); kick(t, 1); }
    if (s === 4) { tuba(t, C.bass[1], STEP * 3.2); kick(t, 0.55); }
    // pah: accordion + snare on the off-beats
    if (s === 2 || s === 6) { accordion(t, C.stab, STEP * 1.4, s === 6 ? 1 : 0.9); snare(t, s === 6 ? 0.9 : 0.6); }
    if (s === 0 && B.crash) crash(t, 1);

    if (B.intro && bar === 0 && s < 6) return;
    // melody
    let pos = 0;
    for (const [note, len] of B.mel) {
      if (pos === s && note) {
        const m = n(note);
        const dur = len * STEP * 0.92;
        const accent = s === 0 ? 1.1 : 1;
        if (B.lead === 'trumpet') {
          trumpet(t, m, dur, accent);
          trumpet(t, thirdBelow(m, B.key), dur, 0.75 * accent);
        } else {
          clarinet(t, m, dur, accent);
          clarinet(t, thirdBelow(m, B.key), dur, 0.7 * accent);
          trumpet(t, m - 12, dur, 0.35);
        }
        if (B.glock) glock(t, m, 0.9);
      }
      pos += len;
    }
  }

  function schedule() {
    const c = ctx();
    if (!c) return;
    while (nextTime < c.currentTime + 0.25) {
      STEP = 60 / bpm / 4;
      playStep(barIdx, stepInBar, nextTime);
      nextTime += STEP;
      stepInBar++;
      if (stepInBar >= BAR) {
        stepInBar = 0;
        barIdx++;
        if (barIdx >= SONG.length) barIdx = LOOP_START;
      }
    }
  }

  function start(fromIntro) {
    const c = ctx();
    if (!c || playing) return;
    if (!out) {
      out = c.createGain();
      out.connect(A.musicBus);
    }
    out.gain.cancelScheduledValues(c.currentTime);
    out.gain.setValueAtTime(0.0001, c.currentTime);
    out.gain.linearRampToValueAtTime(volume, c.currentTime + 0.4);
    playing = true;
    if (fromIntro) { barIdx = 0; stepInBar = 0; }
    nextTime = c.currentTime + 0.08;
    schedule();
    timer = setInterval(schedule, 40);
  }

  function stop(fade) {
    const c = ctx();
    if (!c || !playing) return;
    playing = false;
    clearInterval(timer);
    timer = null;
    const f = fade == null ? 0.4 : fade;
    out.gain.cancelScheduledValues(c.currentTime);
    out.gain.setValueAtTime(out.gain.value, c.currentTime);
    out.gain.linearRampToValueAtTime(0.0001, c.currentTime + f);
    // disconnect the old output so already-scheduled notes go silent
    const old = out;
    out = null;
    setTimeout(() => { try { old.disconnect(); } catch (e) { /* ignore */ } }, (f + 0.4) * 1000);
  }

  // short brass fanfare when a giant barrel appears
  function fanfare() {
    const c = ctx();
    if (!c || !A.state.music) return;
    const o = c.createGain();
    o.gain.value = 1.15;
    o.connect(A.musicBus);
    const save = out;
    out = o;
    const t = c.currentTime + 0.05;
    const seq = [[n('Bb4'), 0], [n('D5'), 0.12], [n('F5'), 0.24], [n('Bb5'), 0.36]];
    for (const [m, dt] of seq) { trumpet(t + dt, m, 0.14, 1.1); trumpet(t + dt, m - 4, 0.14, 0.7); }
    trumpet(t + 0.5, n('Bb5'), 0.9, 1.2);
    trumpet(t + 0.5, n('F5'), 0.9, 0.9);
    trumpet(t + 0.5, n('D5'), 0.9, 0.8);
    tuba(t + 0.5, n('Bb2'), 0.9);
    crash(t + 0.5, 1.2);
    kick(t + 0.5, 1);
    out = save;
  }

  function setTempo(b) { bpm = Math.max(90, Math.min(180, b)); }

  BB.Music = {
    start, stop, fanfare, setTempo,
    get playing() { return playing; },
  };
})();
