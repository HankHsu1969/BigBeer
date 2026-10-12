// Renderer: a pinhole projection of the tilted beer table (world x/y on the
// table plane, z up) drawn with Canvas 2D. Layout adapts to landscape and
// portrait screens; everything is drawn in "design units" then scaled.
(function () {
  const CFG = BB.CFG;
  const SPR = window.BB_SPRITES;
  const W2 = CFG.W / 2;
  const RW = 30;   // side rail width
  const RH = 24;   // side rail height
  const BH = 74;   // back board height
  const FH = 12;   // front lip height
  const FONT = '"Lilita One", "Arial Rounded MT Bold", "Microsoft JhengHei", sans-serif';
  const FONT_ZH = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';

  let canvas, ctx;
  const view = { vw: 0, vh: 0, dpr: 1, scale: 1, pr: 1, D: { w: 1920, h: 1080 }, portrait: false };
  const P = {};
  const LAY = {};
  let tableLayer = null;
  let shadowSprite = null;

  // ---------- projection ----------
  function makeProjection(t) {
    const L = CFG.L;
    const d0 = (L * t.Hf) / (t.Hn - t.Hf);
    const kx = (t.Hn * d0) / W2;
    const c = (t.Yn - t.Yf) / (1 / d0 - 1 / (L + d0));
    const Yh = t.Yn - c / d0;
    const kz = kx * 0.9;
    const cx = t.cx;
    P.cx = cx; P.d0 = d0; P.kx = kx; P.c = c; P.Yh = Yh; P.kz = kz;
    P.sx = (x, y) => cx + (kx * x) / (y + d0);
    P.sy = (y, z) => Yh + (c - kz * (z || 0)) / (y + d0);
    P.s = (y) => kx / (y + d0);
    P.vs = (y) => c / ((y + d0) * (y + d0));
    P.yOf = (sy) => c / (sy - Yh) - d0;
  }

  // ---------- layout ----------
  function computeLayout() {
    // a hidden tab can report a 0x0 viewport; fall back to a sane size
    const vw = window.innerWidth || 1280, vh = window.innerHeight || 720;
    const aspect = vw / vh;
    const portrait = aspect < 1.25;
    let D;
    if (portrait) {
      const h = Math.max(1700, 1080 / aspect);
      D = { w: h * aspect, h };
    } else {
      const w = Math.max(1720, 1080 * aspect);
      D = { w, h: w / aspect };
    }
    view.vw = vw; view.vh = vh; view.portrait = portrait; view.D = D;
    // cap the backing store (~5 MP) so huge / high-DPI screens stay smooth
    view.dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(5e6 / (vw * vh)));
    view.scale = vw / D.w;
    view.pr = view.scale * view.dpr;

    let t;
    if (portrait) {
      t = { cx: D.w / 2, Yn: D.h - 40, Yf: D.h - 1060, Hn: 480, Hf: 350 };
    } else {
      t = { cx: D.w / 2, Yn: D.h - 34, Yf: D.h - 760, Hn: 440, Hf: 330 };
    }
    LAY.table = t;
    makeProjection(t);

    const logoAR = SPR.logo.h / SPR.logo.w;
    if (!portrait) {
      const side = D.w / 2 - t.Hn - (RW * t.Hn) / W2 - 20;
      const lx = side / 2 + 8;
      const rx = D.w - lx;
      const lw = Math.min(400, side - 30);
      LAY.logo = { x: lx - lw / 2, y: 18, w: lw, h: lw * logoAR };
      const sw = Math.min(370, side - 40);
      LAY.score = { x: lx - sw / 2, y: LAY.logo.y + LAY.logo.h + 8, w: sw, h: 132 };
      const scoreBottom = LAY.score.y + LAY.score.h;
      const wh = Math.min(560, D.h - scoreBottom - 70);
      LAY.waitress = { cx: lx - 50, bottom: D.h + 12, h: wh };
      LAY.next = { x: lx + 100, y: Math.max(scoreBottom + 86, D.h - wh + 10), r: 76 };
      LAY.evo = { mode: 'ring', x: rx, y: 262, R: 150, item: 84 };
      const sh = Math.min(560, D.h - 460);
      LAY.sepp = { cx: rx + 10, bottom: D.h + 14, h: sh };
    } else {
      // compact top bar: score | logo | next, then the evolution row
      const lw = Math.min(330, D.w * 0.31);
      LAY.logo = { x: D.w / 2 - lw / 2, y: 12, w: lw, h: lw * logoAR };
      LAY.score = { x: 22, y: 22, w: 290, h: 128 };
      LAY.next = { x: D.w - 108, y: 104, r: 74 };
      const rowY = Math.max(LAY.logo.y + LAY.logo.h, 150) + 66;
      LAY.evo = { mode: 'row', x0: 60, x1: D.w - 60, y: rowY, item: Math.min(80, (D.w - 120) / 11 - 4) };
      // the two hosts stand large behind the far end of the table
      const charTop = rowY + 64;
      const charBottom = t.Yf + 70;
      const ch = Math.max(300, Math.min(900, charBottom - charTop));
      const ww = (ch * SPR.waitress.w) / SPR.waitress.h;
      const sh = ch * 1.02;
      const swd = (sh * SPR.sepp.w) / SPR.sepp.h;
      LAY.waitress = { cx: ww / 2 + 4, bottom: charBottom, h: ch };
      LAY.sepp = { cx: D.w - swd / 2 + 6, bottom: charBottom + 8, h: sh };
    }
  }

  function resize() {
    computeLayout();
    canvas.width = Math.round(view.vw * view.dpr);
    canvas.height = Math.round(view.vh * view.dpr);
    buildTable();
    buildBackground();
  }

  function init(c) {
    canvas = c;
    ctx = canvas.getContext('2d');
    shadowSprite = document.createElement('canvas');
    shadowSprite.width = shadowSprite.height = 128;
    const g = shadowSprite.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(25,10,0,0.75)');
    grd.addColorStop(0.55, 'rgba(25,10,0,0.45)');
    grd.addColorStop(1, 'rgba(25,10,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }

  // ---------- static table layer ----------
  function poly(g, pts) {
    g.beginPath();
    pts.forEach(([x, y, z], i) => {
      const X = P.sx(x, y), Y = P.sy(y, z);
      if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
    });
    g.closePath();
  }

  function buildTable() {
    const IMG = BB.IMG;
    if (!IMG || !IMG.wood) return;
    const D = view.D, pr = view.pr;
    if (!tableLayer) tableLayer = document.createElement('canvas');
    tableLayer.width = Math.ceil(D.w * pr);
    tableLayer.height = Math.ceil(D.h * pr);
    const g = tableLayer.getContext('2d');
    g.setTransform(pr, 0, 0, pr, 0, 0);
    const L = CFG.L;

    // soft drop shadow of the whole table on the tent floor
    g.save();
    g.filter = 'blur(18px)';
    g.fillStyle = 'rgba(0,0,0,0.55)';
    poly(g, [[-W2 - RW - 20, -10, -40], [W2 + RW + 20, -10, -40], [W2 + RW + 30, L + 60, 0], [-W2 - RW - 30, L + 60, 0]]);
    g.fill();
    g.restore();

    // front apron (edge of the table top facing the player)
    const apron = g.createLinearGradient(0, P.sy(0, 0), 0, P.sy(0, -40));
    apron.addColorStop(0, '#6a3d18');
    apron.addColorStop(1, '#2c1606');
    g.fillStyle = apron;
    poly(g, [[-W2 - RW, 0, 0], [W2 + RW, 0, 0], [W2 + RW, 0, -40], [-W2 - RW, 0, -40]]);
    g.fill();

    // table surface: perspective-correct texture, one scanline at a time
    const tex = IMG.wood;
    const tw = tex.naturalWidth, th = tex.naturalHeight;
    const yTop = P.sy(L, 0), yBot = P.sy(0, 0);
    for (let py = Math.floor(yTop * pr); py < Math.ceil(yBot * pr); py++) {
      const sy = (py + 0.5) / pr;
      const wy = P.yOf(sy);
      if (wy < 0 || wy > L) continue;
      const xl = P.sx(-W2, wy), xr = P.sx(W2, wy);
      const v = Math.min(th - 1, Math.max(0, (1 - wy / L) * (th - 1)));
      g.drawImage(tex, 0, v, tw, 1, xl, py / pr, xr - xl, 1 / pr + 0.05);
    }

    // lighting: warmer and brighter near the player, shade toward the far end
    g.save();
    poly(g, [[-W2, 0, 0], [W2, 0, 0], [W2, L, 0], [-W2, L, 0]]);
    g.clip();
    const lg = g.createLinearGradient(0, yBot, 0, yTop);
    lg.addColorStop(0, 'rgba(255,190,90,0.10)');
    lg.addColorStop(0.55, 'rgba(40,18,4,0.12)');
    lg.addColorStop(1, 'rgba(30,12,2,0.42)');
    g.fillStyle = lg;
    g.fillRect(0, yTop - 5, D.w, yBot - yTop + 10);
    // wet varnish sheen
    const cx = P.sx(0, L * 0.45), cy = P.sy(L * 0.45, 0);
    const sh = g.createRadialGradient(cx, cy, 10, cx, cy, P.s(L * 0.45) * 420);
    sh.addColorStop(0, 'rgba(255,236,190,0.18)');
    sh.addColorStop(1, 'rgba(255,236,190,0)');
    g.fillStyle = sh;
    g.fillRect(0, yTop - 5, D.w, yBot - yTop + 10);
    // ambient occlusion along the rails
    for (const side of [-1, 1]) {
      const x0 = P.sx(side * W2, L * 0.5);
      const x1 = P.sx(side * (W2 - 40), L * 0.5);
      const ao = g.createLinearGradient(x0, 0, x1, 0);
      ao.addColorStop(0, 'rgba(20,8,0,0.35)');
      ao.addColorStop(1, 'rgba(20,8,0,0)');
      g.fillStyle = ao;
      g.fillRect(Math.min(x0, x1) - 60, yTop, Math.abs(x1 - x0) + 60, yBot - yTop);
    }
    g.restore();

    // back board with the Bavarian rhombus pattern
    drawBackBoard(g);

    // side rails
    for (const side of [-1, 1]) {
      const xi = side * W2, xo = side * (W2 + RW);
      // inner face
      const ig = g.createLinearGradient(0, P.sy(0, RH), 0, P.sy(L, 0));
      ig.addColorStop(0, '#5a3214');
      ig.addColorStop(1, '#3a1e08');
      g.fillStyle = ig;
      poly(g, [[xi, 0, 0], [xi, L, 0], [xi, L, RH], [xi, 0, RH]]);
      g.fill();
      // top face
      const tg = g.createLinearGradient(0, P.sy(0, RH), 0, P.sy(L, RH));
      tg.addColorStop(0, '#b27a3e');
      tg.addColorStop(1, '#7c4b1f');
      g.fillStyle = tg;
      poly(g, [[xo, 0, RH], [xi, 0, RH], [xi, L, RH], [xo, L, RH]]);
      g.fill();
      g.strokeStyle = 'rgba(255,220,160,0.35)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(P.sx(xi, 0), P.sy(0, RH));
      g.lineTo(P.sx(xi, L), P.sy(L, RH));
      g.stroke();
      // front end face
      g.fillStyle = '#4a280c';
      poly(g, [[xo, 0, -40], [xi, 0, -40], [xi, 0, RH], [xo, 0, RH]]);
      g.fill();
    }
  }

  function drawBackBoard(g) {
    const L = CFG.L;
    const xl = -W2 - RW, xr = W2 + RW;
    // top face
    g.fillStyle = '#9a6430';
    poly(g, [[xl, L, BH], [xr, L, BH], [xr, L + 26, BH], [xl, L + 26, BH]]);
    g.fill();
    // front face drawn with an affine transform (constant depth -> linear)
    const s = P.kx / (L + P.d0);
    const sz = P.kz / (L + P.d0);
    const y0 = P.Yh + P.c / (L + P.d0);
    g.save();
    g.transform(s, 0, 0, -sz, P.cx, y0);   // now draw in world (x, z) at y = L
    const wood = g.createLinearGradient(0, 0, 0, BH);
    wood.addColorStop(0, '#5b3213');
    wood.addColorStop(1, '#8a5527');
    g.fillStyle = wood;
    g.fillRect(xl, 0, xr - xl, BH);
    // rhombus band
    const b0 = 16, b1 = BH - 14;
    g.save();
    g.beginPath();
    g.rect(xl + 6, b0, xr - xl - 12, b1 - b0);
    g.clip();
    g.fillStyle = '#ffffff';
    g.fillRect(xl, b0, xr - xl, b1 - b0);
    const dw = 34, dh = (b1 - b0) / 2;
    g.fillStyle = '#1e6fc8';
    for (let row = 0; row < 3; row++) {
      for (let x = xl - dw; x < xr + dw; x += dw) {
        const ox = row % 2 ? dw / 2 : 0;
        const cx = x + ox, cy = b0 + row * dh;
        g.beginPath();
        g.moveTo(cx, cy - dh / 2);
        g.lineTo(cx + dw / 2, cy);
        g.lineTo(cx, cy + dh / 2);
        g.lineTo(cx - dw / 2, cy);
        g.closePath();
        g.fill();
      }
    }
    g.restore();
    g.strokeStyle = '#3b200c';
    g.lineWidth = 3;
    g.strokeRect(xl + 6, b0, xr - xl - 12, b1 - b0);
    // little brass plaque in the middle
    g.fillStyle = '#d9a63a';
    g.strokeStyle = '#6b4a10';
    g.lineWidth = 2;
    roundRect(g, -70, b0 + 4, 140, b1 - b0 - 8, 8);
    g.fill();
    g.stroke();
    g.restore();
    // text on the plaque (drawn unflipped)
    g.save();
    g.fillStyle = '#4a2a06';
    g.font = `${Math.round(22 * s)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PROST!', P.cx, y0 - sz * BH * 0.5 + 1);
    g.restore();
  }

  // ---------- helpers ----------
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function outlinedText(text, x, y, size, fill, stroke, align, font, lw) {
    ctx.font = `${size}px ${font || FONT}`;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw || Math.max(3, size * 0.16);
    ctx.strokeStyle = stroke || '#3b200c';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill || '#fff8e6';
    ctx.fillText(text, x, y);
  }

  function drawSpriteFit(img, meta, cx, cy, box, alpha) {
    const k = Math.min(box / meta.w, box / meta.h);
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(img, cx - (meta.w * k) / 2, cy - (meta.h * k) / 2, meta.w * k, meta.h * k);
    ctx.globalAlpha = 1;
  }

  // ---------- world drawing ----------
  function drawShadow(x, y, r, z, alpha) {
    const sx = P.sx(x, y), sy = P.sy(y, 0);
    const shrink = 1 / (1 + z / 260);
    const rx = r * P.s(y) * 1.08 * shrink;
    const ry = r * P.vs(y) * 1.08 * shrink;
    ctx.globalAlpha = (alpha == null ? 1 : alpha) * Math.max(0.15, 1 - z / 420);
    ctx.drawImage(shadowSprite, sx - rx, sy - ry * 0.9, rx * 2, ry * 2);
    ctx.globalAlpha = 1;
  }

  function drawVessel(lvl, x, y, z, r, pop, tilt, alpha) {
    const key = BB.LEVELS[lvl].key;
    const meta = SPR[key];
    const img = BB.IMG.mugs[lvl];
    const s = P.s(y);
    const k = (r * s * pop) / meta.halfW;
    const w = meta.w * k, h = meta.h * k;
    const bx = P.sx(x, y);
    const by = P.sy(y, z) + 0.34 * meta.baseFrac * r * s * pop;
    // squash & stretch while popping
    const sxk = 1 + (pop - 1) * 0.35;
    const syk = 1 / Math.max(0.6, sxk);
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(bx, by);
    if (tilt) ctx.rotate(tilt);
    ctx.scale(sxk, syk);
    ctx.drawImage(img, -meta.axisX * k, -h, w, h);
    ctx.restore();
    // screen rect of the body (handle excluded) for the x-ray pass
    const hw = r * s * pop;
    return { x0: bx - hw, x1: bx + hw, y0: by - h * syk, y1: by };
  }

  // Glass is see-through: a vessel hidden behind nearer ones shows through
  // them faintly so the player can still read the pile.
  function drawXray(list, rects) {
    for (let i = 0; i < list.length; i++) {
      const a = rects[i];
      const area = (a.x1 - a.x0) * (a.y1 - a.y0);
      let covered = 0;
      for (let j = i + 1; j < list.length; j++) {
        const b = rects[j];
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (ox > 0 && oy > 0) covered += ox * oy;
      }
      const frac = Math.min(1, covered / area);
      if (frac < 0.4) continue;
      const v = list[i];
      drawVessel(v.lvl, v.x, v.y, v.z, v.r, v.pop, v.tilt, 0.12 + 0.2 * ((frac - 0.4) / 0.6));
    }
  }

  function drawDangerLine(game) {
    const y = CFG.DANGER_Y;
    const d = game.danger;
    const t = performance.now() / 1000;
    const pulse = d > 0 ? 0.55 + 0.45 * Math.sin(t * 12) : 0;
    // tint the overflow zone
    if (d > 0) {
      ctx.fillStyle = `rgba(220,30,20,${0.08 + 0.12 * pulse * Math.min(1, d)})`;
      ctx.beginPath();
      ctx.moveTo(P.sx(-W2, 0), P.sy(0, 0));
      ctx.lineTo(P.sx(W2, 0), P.sy(0, 0));
      ctx.lineTo(P.sx(W2, y), P.sy(y, 0));
      ctx.lineTo(P.sx(-W2, y), P.sy(y, 0));
      ctx.closePath();
      ctx.fill();
    }
    ctx.save();
    ctx.lineWidth = 4 * P.s(y);
    ctx.setLineDash([22 * P.s(y), 14 * P.s(y)]);
    ctx.lineDashOffset = -t * 40;
    ctx.strokeStyle = d > 0 ? `rgba(255,60,40,${0.6 + 0.4 * pulse})` : 'rgba(255,80,60,0.45)';
    ctx.beginPath();
    ctx.moveTo(P.sx(-W2, y), P.sy(y, 0));
    ctx.lineTo(P.sx(W2, y), P.sy(y, 0));
    ctx.stroke();
    ctx.restore();
  }

  function drawAim(game) {
    const h = game.held;
    if (!h) return;
    const x = game.aimX;
    // dotted guide straight down the table
    for (let y = CFG.LAUNCH_Y + 40; y < CFG.L - 10; y += 28) {
      const a = 0.42 * (1 - y / CFG.L) + 0.08;
      ctx.fillStyle = `rgba(255,248,230,${a})`;
      ctx.beginPath();
      ctx.ellipse(P.sx(x, y), P.sy(y, 0), 4 * P.s(y), 4 * P.vs(y), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // power ring around the mug's footprint
    if (game.charging) {
      const r = BB.LEVELS[h.lvl].r + 14;
      const y = CFG.LAUNCH_Y - game.charge * 14;
      const c = game.charge;
      const col = c < 0.5 ? `rgb(${Math.round(120 + 270 * c)},220,70)` : `rgb(255,${Math.round(220 - 300 * (c - 0.5))},50)`;
      ctx.save();
      ctx.translate(P.sx(x, y), P.sy(y, 0));
      ctx.scale(1, P.vs(y) / P.s(y));
      ctx.lineWidth = 9 * P.s(y);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, r * P.s(y), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, r * P.s(y), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c);
      ctx.stroke();
      ctx.restore();
    }
    drawOrderTimer(game, x);
  }

  // the waitress's patience: a ring that drains, then a big countdown
  function drawOrderTimer(game, x) {
    const h = game.held;
    const r = BB.LEVELS[h.lvl].r + 30;
    const y = CFG.LAUNCH_Y;
    const f = Math.max(0, game.orderT / game.orderMax);
    const urgent = game.orderT < 1.6;
    const blink = urgent ? 0.55 + 0.45 * Math.sin(performance.now() / 70) : 1;
    ctx.save();
    ctx.translate(P.sx(x, y), P.sy(y, 0));
    ctx.scale(1, P.vs(y) / P.s(y));
    ctx.lineWidth = 5 * P.s(y);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, r * P.s(y), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = blink;
    ctx.strokeStyle = urgent ? '#ff4a3a' : f < 0.5 ? '#ffc23a' : '#fff3d0';
    ctx.beginPath();
    ctx.arc(0, 0, r * P.s(y), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
    ctx.stroke();
    ctx.restore();
    if (game.orderT < 3) {
      const n = Math.max(1, Math.ceil(game.orderT));
      const frac = game.orderT - Math.floor(game.orderT);
      const sc = 1 + frac * 0.35;
      ctx.save();
      ctx.translate(P.sx(x, y) + r * P.s(y) * 1.05, P.sy(y, BB.LEVELS[h.lvl].r * 2.4));
      ctx.scale(sc, sc);
      outlinedText(String(n), 0, 0, 54, urgent ? '#ff6a5a' : '#fff3d0', '#2a1608');
      ctx.restore();
    }
  }

  function drawPuddles(game) {
    for (const p of game.puddles) {
      const a = Math.min(1, p.life / 2) * 0.32;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.ellipse(P.sx(p.x, p.y), P.sy(p.y, 0), p.r * P.s(p.y), p.r * P.vs(p.y), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles(game) {
    for (const p of game.particles) {
      const sx = P.sx(p.x, p.y), sy = P.sy(p.y, p.z);
      const r = p.size * P.s(p.y);
      ctx.globalAlpha = Math.min(1, p.life * 3);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      if (p.foam) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(sx - r * 0.3, sy - r * 0.3, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFrontLip() {
    const g = ctx;
    const grd = g.createLinearGradient(0, P.sy(0, FH), 0, P.sy(0, -40));
    grd.addColorStop(0, '#c48a4a');
    grd.addColorStop(0.25, '#8a5526');
    grd.addColorStop(1, '#3a1d07');
    g.fillStyle = grd;
    poly(g, [[-W2 - RW, -14, FH], [W2 + RW, -14, FH], [W2 + RW, -14, -40], [-W2 - RW, -14, -40]]);
    g.fill();
    g.fillStyle = '#d29a58';
    poly(g, [[-W2 - RW, -14, FH], [W2 + RW, -14, FH], [W2 + RW, 0, FH], [-W2 - RW, 0, FH]]);
    g.fill();
  }

  // ---------- UI ----------
  function woodPanel(x, y, w, h, r) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    const grd = ctx.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, '#a46a33');
    grd.addColorStop(0.5, '#7d4b1f');
    grd.addColorStop(1, '#5e3615');
    ctx.fillStyle = grd;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#3b200c';
    roundRect(ctx, x, y, w, h, r);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,220,170,0.35)';
    roundRect(ctx, x + 6, y + 6, w - 12, h - 12, Math.max(2, r - 5));
    ctx.stroke();
    // plank lines
    ctx.save();
    roundRect(ctx, x + 3, y + 3, w - 6, h - 6, r);
    ctx.clip();
    ctx.strokeStyle = 'rgba(40,18,4,0.25)';
    ctx.lineWidth = 2;
    for (let yy = y + h / 3; yy < y + h; yy += h / 3) {
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    }
    ctx.restore();
  }

  function drawScore(game) {
    const b = LAY.score;
    woodPanel(b.x, b.y, b.w, b.h, 18);
    outlinedText('SCORE 分數', b.x + b.w / 2, b.y + 26, 24, '#f5b31b', '#2a1608', 'center', `${FONT}, ${FONT_ZH}`);
    const bump = 1 + game.scoreBump * 0.25;
    ctx.save();
    ctx.translate(b.x + b.w / 2, b.y + 72);
    ctx.scale(bump, bump);
    outlinedText(String(game.displayScore), 0, 0, 58, '#fff8e6', '#2a1608');
    ctx.restore();
    outlinedText(`BEST ${game.best}`, b.x + b.w / 2, b.y + b.h - 18, 20, '#ffe7a8', '#2a1608');
    if (game.scoreMult > 1) {
      const pulse = 1 + Math.sin(performance.now() / 120) * 0.06;
      ctx.save();
      ctx.translate(b.x + b.w / 2, b.y + b.h + 30);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = '#f5b31b';
      roundRect(ctx, -120, -24, 240, 48, 24);
      ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#3b200c'; ctx.stroke();
      outlinedText(`×${game.scoreMult} FREIBIER`, 0, 1, 28, '#fff8e6', '#5a2a04');
      ctx.restore();
    }
  }

  function drawNext(game) {
    const b = LAY.next;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#fff8e6';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // blue-white rhombus ring
    const segs = 22;
    for (let i = 0; i < segs; i++) {
      ctx.strokeStyle = i % 2 ? '#ffffff' : '#1e6fc8';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r - 4, (i / segs) * Math.PI * 2, ((i + 1) / segs) * Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#3b200c';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 1, 0, Math.PI * 2); ctx.stroke();
    if (game.next != null) {
      const lvl = game.next;
      const key = BB.LEVELS[lvl].key;
      const bob = Math.sin(performance.now() / 300) * 3;
      drawSpriteFit(BB.IMG.mugs[lvl], SPR[key], b.x, b.y + 4 + bob, b.r * 1.25);
    }
    // ribbon label
    const rw = 132, rh = 30;
    ctx.fillStyle = '#c8312f';
    roundRect(ctx, b.x - rw / 2, b.y - b.r - 18, rw, rh, 8);
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#3b200c'; ctx.stroke();
    outlinedText('NEXT 下一杯', b.x, b.y - b.r - 3, 18, '#fff8e6', '#5a120f', 'center', `${FONT}, ${FONT_ZH}`, 3);
  }

  function drawEvolution(game) {
    const E = LAY.evo;
    const n = BB.LEVELS.length;
    const t = performance.now() / 1000;
    if (E.mode === 'ring') {
      // round wooden tray
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 8;
      const grd = ctx.createRadialGradient(E.x, E.y - 30, 20, E.x, E.y, E.R + 56);
      grd.addColorStop(0, '#b47a40');
      grd.addColorStop(1, '#6b3f1c');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(E.x, E.y, E.R + 54, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.lineWidth = 6; ctx.strokeStyle = '#3b200c';
      ctx.beginPath(); ctx.arc(E.x, E.y, E.R + 54, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,220,170,0.3)';
      ctx.beginPath(); ctx.arc(E.x, E.y, E.R + 46, 0, Math.PI * 2); ctx.stroke();
      // arrows ring
      ctx.strokeStyle = 'rgba(255,240,200,0.35)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.arc(E.x, E.y, E.R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      outlinedText('進化圈', E.x, E.y - 14, 30, '#fff8e6', '#2a1608', 'center', FONT_ZH, 6);
      outlinedText('Evolution', E.x, E.y + 20, 20, '#f5b31b', '#2a1608');
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const x = E.x + Math.cos(ang) * E.R, y = E.y + Math.sin(ang) * E.R;
        drawEvoItem(game, i, x, y, E.item, t);
      }
    } else {
      const step = (E.x1 - E.x0) / (n - 1);
      ctx.save();
      ctx.fillStyle = 'rgba(40,18,4,0.55)';
      roundRect(ctx, E.x0 - 44, E.y - E.item * 0.62, E.x1 - E.x0 + 88, E.item * 1.24, 22);
      ctx.fill();
      ctx.restore();
      for (let i = 0; i < n; i++) drawEvoItem(game, i, E.x0 + i * step, E.y, E.item, t);
    }
  }

  function drawEvoItem(game, i, x, y, size, t) {
    const reached = i <= game.maxLevel;
    const isMax = i === game.maxLevel;
    const box = size * (0.62 + 0.38 * (i / 10));
    if (isMax) {
      const glow = ctx.createRadialGradient(x, y, 2, x, y, size * 0.75);
      glow.addColorStop(0, 'rgba(255,215,90,0.85)');
      glow.addColorStop(1, 'rgba(255,215,90,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, size * 0.75, 0, Math.PI * 2); ctx.fill();
    }
    const bob = isMax ? Math.sin(t * 4) * 3 : 0;
    drawSpriteFit(BB.IMG.mugs[i], SPR[BB.LEVELS[i].key], x, y + bob, box, reached ? 1 : 0.38);
  }

  function drawCharacters(game) {
    const t = performance.now() / 1000;
    const W = LAY.waitress, S = LAY.sepp;
    const wi = BB.IMG.waitress, si = BB.IMG.sepp;
    const wm = SPR.waitress, sm = SPR.sepp;
    // waitress sways gently, hops when a new mug arrives
    {
      const k = W.h / wm.h;
      const hop = game.waitressHop;
      const sway = Math.sin(t * 2.1) * 0.025;
      ctx.save();
      ctx.translate(W.cx, W.bottom - hop * 26);
      ctx.rotate(sway + game.swayAngle * 3);
      ctx.scale(1 - hop * 0.04, 1 + hop * 0.05);
      ctx.drawImage(wi, -(wm.w * k) / 2, -wm.h * k, wm.w * k, wm.h * k);
      ctx.restore();
    }
    // Sepp laughs along: bounces with the music and jumps on big merges
    {
      const k = S.h / sm.h;
      const beat = Math.abs(Math.sin(t * Math.PI * 2.2)) * 6;
      const jump = game.seppJump;
      ctx.save();
      ctx.translate(S.cx, S.bottom - beat - jump * 70);
      ctx.rotate(Math.sin(t * 1.3) * 0.02 - jump * 0.06 + game.swayAngle * 3);
      ctx.scale(1 + jump * 0.05, 1 - jump * 0.02);
      ctx.drawImage(si, -(sm.w * k) / 2, -sm.h * k, sm.w * k, sm.h * k);
      ctx.restore();
    }
  }

  function drawFloaters(game) {
    for (const f of game.floaters) {
      const a = Math.min(1, f.life * 2.2);
      const sc = f.scale * (1 + Math.max(0, f.life - f.maxLife + 0.15) * 3);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(f.x, f.y);
      ctx.scale(sc, sc);
      outlinedText(f.text, 0, 0, f.size, f.color, '#2a1608', 'center', `${FONT}, ${FONT_ZH}`);
      ctx.restore();
    }
  }

  function drawConfetti(game) {
    for (const c of game.confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.scale(Math.cos(c.flip), 1);
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.moveTo(0, -c.size);
      ctx.lineTo(c.size * 0.7, 0);
      ctx.lineTo(0, c.size);
      ctx.lineTo(-c.size * 0.7, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // big ribbon announcing a beer-tent event
  function drawBanner(game) {
    const b = game.banner;
    if (!b) return;
    const D = view.D;
    const t = b.t;
    const inK = Math.min(1, t / 0.22);
    const outK = Math.min(1, (b.life - t) / 0.35);
    const sc = 0.6 + 0.4 * (1 - Math.pow(1 - inK, 3)) + (inK < 1 ? 0 : Math.sin(t * 9) * 0.015);
    const w = Math.min(D.w - 40, 860), h = 158;
    const cx = P.cx, cy = LAY.table.Yf + (LAY.table.Yn - LAY.table.Yf) * 0.6;
    ctx.save();
    ctx.globalAlpha = Math.max(0, outK);
    ctx.translate(cx, cy);
    ctx.scale(sc, sc);
    ctx.rotate(-0.03);
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = b.color;
    roundRect(ctx, -w / 2, -h / 2, w, h, 26);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 7; ctx.strokeStyle = '#3b200c'; ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    roundRect(ctx, -w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 18);
    ctx.stroke();
    outlinedText(b.title, 0, -22, 62, '#fff8e6', '#2a1608', 'center', FONT_ZH, 9);
    outlinedText(b.sub, 0, 42, 36, '#ffe08a', '#2a1608');
    ctx.restore();
  }

  // tent background, scaled to cover the screen once per resize
  let bgLayer = null;
  const BG_PAD = 16;
  function buildBackground() {
    const img = BB.IMG && BB.IMG.bg;
    if (!img) return;
    const cw = canvas.width + BG_PAD * 2, ch = canvas.height;
    if (!bgLayer) bgLayer = document.createElement('canvas');
    bgLayer.width = cw;
    bgLayer.height = ch;
    const g = bgLayer.getContext('2d');
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = Math.max(cw / iw, ch / ih);
    g.drawImage(img, (cw - iw * s) / 2, (ch - ih * s) / 2, iw * s, ih * s);
    const grd = g.createLinearGradient(0, 0, 0, ch);
    grd.addColorStop(0, 'rgba(20,8,2,0.25)');
    grd.addColorStop(0.5, 'rgba(20,8,2,0.15)');
    grd.addColorStop(1, 'rgba(15,6,1,0.55)');
    g.fillStyle = grd;
    g.fillRect(0, 0, cw, ch);
  }

  function drawBackground() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!bgLayer) { ctx.fillStyle = '#2a1608'; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    const sway = Math.sin(performance.now() / 1000 * 0.35) * BG_PAD * 0.8;
    ctx.drawImage(bgLayer, -BG_PAD + sway, 0);
  }

  // ---------- frame ----------
  function draw(game) {
    if (!BB.IMG) return;
    const pr = view.pr;
    drawBackground();

    const shx = (Math.random() - 0.5) * game.shake * 18;
    const shy = (Math.random() - 0.5) * game.shake * 18;
    ctx.setTransform(pr, 0, 0, pr, shx * pr, shy * pr);

    drawCharacters(game);
    if (game.state !== 'title' && game.state !== 'title-wait') {
      const Lg = LAY.logo;
      ctx.drawImage(BB.IMG.logo, Lg.x, Lg.y, Lg.w, Lg.h);
    }
    drawEvolution(game);
    drawScore(game);
    drawNext(game);

    // table (static layer drawn in device pixels), tilted while the tent sways
    const ang = game.swayAngle || 0;
    const pvx = P.cx, pvy = (LAY.table.Yn + LAY.table.Yf) / 2;
    ctx.setTransform(1, 0, 0, 1, shx * pr, shy * pr);
    if (ang) { ctx.translate(pvx * pr, pvy * pr); ctx.rotate(ang); ctx.translate(-pvx * pr, -pvy * pr); }
    if (tableLayer) ctx.drawImage(tableLayer, 0, 0);
    ctx.setTransform(pr, 0, 0, pr, shx * pr, shy * pr);
    if (ang) { ctx.translate(pvx, pvy); ctx.rotate(ang); ctx.translate(-pvx, -pvy); }

    drawPuddles(game);
    drawDangerLine(game);
    if (game.state === 'playing') drawAim(game);

    // collect vessels (including the held one), far to near
    const list = [];
    for (const b of game.world.bodies) list.push(b);
    const h = game.held;
    if (h && game.state === 'playing') {
      list.push({ held: true, lvl: h.lvl, x: game.aimX, y: CFG.LAUNCH_Y - game.charge * 14, z: 6 + Math.sin(performance.now() / 260) * 3, r: BB.LEVELS[h.lvl].r, pop: h.pop, tilt: -game.charge * 0.06, alpha: h.alpha });
    }
    for (const b of list) drawShadow(b.x, b.y, b.r, b.z, b.alpha);
    list.sort((a, b) => b.y - a.y);
    const rects = list.map((b) => drawVessel(b.lvl, b.x, b.y, b.z, b.r, b.pop, b.tilt, b.alpha));
    drawXray(list, rects);

    drawFrontLip();
    drawParticles(game);
    ctx.setTransform(pr, 0, 0, pr, shx * pr, shy * pr);
    drawFloaters(game);
    drawBanner(game);
    drawConfetti(game);

    if (BB.DEBUG) {
      ctx.strokeStyle = 'rgba(0,255,0,0.7)';
      ctx.lineWidth = 1.5;
      for (const b of game.world.bodies) {
        ctx.beginPath();
        ctx.ellipse(P.sx(b.x, b.y), P.sy(b.y, 0), b.r * P.s(b.y), b.r * P.vs(b.y), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      outlinedText(`${game.fps | 0} fps  ${game.world.bodies.length} bodies`, 20, view.D.h - 30, 22, '#9f9', '#000', 'left');
    }

    // danger vignette
    if (game.danger > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const cw = canvas.width, ch = canvas.height;
      const a = Math.min(0.5, game.danger / CFG.DANGER_LIMIT * 0.5) * (0.6 + 0.4 * Math.sin(performance.now() / 90));
      const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
      g.addColorStop(0, 'rgba(200,20,10,0)');
      g.addColorStop(1, `rgba(200,20,10,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }
  }

  // screen (CSS px) -> world x along the launch line
  function screenToAimX(px) {
    const dx = px / view.scale;
    return ((dx - P.cx) * (CFG.LAUNCH_Y + P.d0)) / P.kx;
  }
  // world point -> design coords (for floating texts / confetti)
  function worldToDesign(x, y, z) {
    return { x: P.sx(x, y), y: P.sy(y, z || 0) };
  }

  BB.Render = { init, resize, draw, screenToAimX, worldToDesign, view, LAY, P };
})();
