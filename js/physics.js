// Small custom rigid-body solver for circular mug footprints sliding on a
// tilted table: gravity along +y, sliding friction, impulse collisions with
// restitution + tangential friction, positional correction and merge detection.
// A separate vertical (z) channel gives hops / bounces under real gravity.
(function () {
  const CFG = BB.CFG;

  class Body {
    constructor(lvl, x, y) {
      this.id = Body.nextId++;
      this.lvl = lvl;
      const r = BB.LEVELS[lvl].r;
      this.r = r;
      this.rFrom = r;
      this.rTarget = r;
      this.m = r * r;
      this.x = x; this.y = y;
      this.vx = 0; this.vy = 0;
      this.z = 0; this.vz = 0;
      this.tilt = 0; this.tiltV = 0;   // visual wobble (radians)
      this.pop = 1; this.popV = 0;     // visual scale spring
      this.age = 0;
      this.dead = false;
      this.merging = false;
      this.canMerge = true;
      this.lastSnd = -1;
      this.slide = 0;                  // smoothed sliding speed (for audio)
    }
    setRadiusGrowFrom(r0) {
      this.rFrom = r0;
      this.r = r0;
      this.m = r0 * r0;
    }
  }
  Body.nextId = 1;

  class World {
    constructor() {
      this.bodies = [];
      this.events = [];
      this.time = 0;
      this.merges = [];
      this.gx = 0;          // sideways gravity (the tent sways during "Schunkeln")
    }

    clear() {
      this.bodies.length = 0;
      this.events.length = 0;
      this.merges.length = 0;
    }

    add(b) { this.bodies.push(b); return b; }

    step(dt) {
      const sub = CFG.SUBSTEPS;
      const h = dt / sub;
      for (let s = 0; s < sub; s++) {
        this.time += h;
        this.integrate(h);
        for (let it = 0; it < CFG.ITER; it++) {
          this.solvePairs(it === 0);
          this.solveWalls(it === 0);
        }
        if (this.merges.length) this.resolveMerges();
      }
      this.updateVertical(dt);
    }

    integrate(h) {
      const damp = Math.exp(-CFG.DAMPING * h);
      for (const b of this.bodies) {
        if (b.r < b.rTarget) {
          b.r = Math.min(b.rTarget, b.r + (b.rTarget - b.rFrom) * h / CFG.GROW_TIME);
          b.m = b.r * b.r;
        }
        // gravity along the tilted table (+ sideways while the tent sways)
        b.vy += CFG.GRAVITY * h;
        b.vx += this.gx * h;
        // kinetic sliding friction (only while touching the table)
        if (b.z < 2) {
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > 1e-6) {
            const dec = Math.min(sp, CFG.FRICTION * h);
            b.vx -= (b.vx / sp) * dec;
            b.vy -= (b.vy / sp) * dec;
          }
        }
        b.vx *= damp; b.vy *= damp;
        b.x += b.vx * h;
        b.y += b.vy * h;
      }
    }

    solvePairs(first) {
      const bs = this.bodies;
      const n = bs.length;
      for (let i = 0; i < n; i++) {
        const a = bs[i];
        if (a.dead) continue;
        for (let j = i + 1; j < n; j++) {
          const b = bs[j];
          if (b.dead) continue;
          // mugs flying through the air pass over the others until they land
          if (a.z > 45 || b.z > 45) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const rs = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rs * rs) continue;
          const d = Math.sqrt(d2) || 1e-4;
          const nx = dx / d, ny = dy / d;

          // same mugs touching -> merge (handled after the iteration)
          if (a.lvl === b.lvl && !a.merging && !b.merging && a.canMerge && b.canMerge) {
            a.merging = b.merging = true;
            this.merges.push([a, b]);
            continue;
          }
          if (a.merging || b.merging) continue;

          const ima = 1 / a.m, imb = 1 / b.m;
          const pen = rs - d;
          const corr = Math.max(pen - CFG.SLOP, 0) * CFG.POS_CORR / (ima + imb);
          a.x -= nx * corr * ima; a.y -= ny * corr * ima;
          b.x += nx * corr * imb; b.y += ny * corr * imb;

          const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const e = -vn > 60 ? CFG.RESTITUTION : 0;
            const jn = -(1 + e) * vn / (ima + imb);
            a.vx -= jn * nx * ima; a.vy -= jn * ny * ima;
            b.vx += jn * nx * imb; b.vy += jn * ny * imb;

            // tangential (Coulomb) friction between the mugs
            const tx = -ny, ty = nx;
            const vt = rvx * tx + rvy * ty;
            let jt = -vt / (ima + imb);
            const maxF = CFG.MU_PAIR * jn;
            jt = Math.max(-maxF, Math.min(maxF, jt));
            a.vx -= jt * tx * ima; a.vy -= jt * ty * ima;
            b.vx += jt * tx * imb; b.vy += jt * ty * imb;

            const impact = -vn;
            if (first && impact > 45) {
              // wobble: each mug leans away from the hit, lighter one more
              const wa = impact * 0.0011 * (b.m / (a.m + b.m));
              const wb = impact * 0.0011 * (a.m / (a.m + b.m));
              a.tiltV -= nx * wa * 9; b.tiltV += nx * wb * 9;
              // a hard knock makes the lighter mug hop a little
              if (impact > 520) {
                const hop = Math.min(260, (impact - 520) * 0.35);
                if (a.m < b.m) a.vz = Math.max(a.vz, hop); else b.vz = Math.max(b.vz, hop);
              }
              this.events.push({ type: 'hit', a, b, v: impact, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            }
          }
        }
      }
    }

    solveWalls(first) {
      const hw = CFG.W / 2, L = CFG.L, rest = CFG.WALL_REST;
      for (const b of this.bodies) {
        if (b.dead) continue;
        if (b.x - b.r < -hw) {
          b.x = -hw + b.r;
          if (b.vx < 0) { if (first && -b.vx > 45) this.wallHit(b, -b.vx, 'left'); b.vx = -b.vx * rest; b.vy *= 0.97; }
        } else if (b.x + b.r > hw) {
          b.x = hw - b.r;
          if (b.vx > 0) { if (first && b.vx > 45) this.wallHit(b, b.vx, 'right'); b.vx = -b.vx * rest; b.vy *= 0.97; }
        }
        if (b.y + b.r > L) {
          b.y = L - b.r;
          if (b.vy > 0) { if (first && b.vy > 45) this.wallHit(b, b.vy, 'back'); b.vy = -b.vy * rest; b.vx *= 0.97; }
        } else if (b.y - b.r < 0) {
          b.y = b.r;
          if (b.vy < 0) { if (first && -b.vy > 45) this.wallHit(b, -b.vy, 'front'); b.vy = -b.vy * rest; }
        }
      }
    }

    wallHit(b, v, side) {
      b.tiltV += (side === 'left' ? 1 : side === 'right' ? -1 : (Math.random() - 0.5)) * v * 0.006;
      if (v > 700) b.vz = Math.max(b.vz, Math.min(220, (v - 700) * 0.3));
      this.events.push({ type: 'wall', b, v, side, x: b.x, y: b.y });
    }

    resolveMerges() {
      for (const [a, b] of this.merges) {
        if (a.dead || b.dead) continue;
        a.dead = b.dead = true;
        const lvl = a.lvl;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (lvl >= BB.MAX_LEVEL) {
          this.events.push({ type: 'mega', x: mx, y: my, lvl });
          continue;
        }
        const nb = new Body(lvl + 1, mx, my);
        nb.setRadiusGrowFrom(Math.max(a.r, b.r));
        nb.vx = (a.vx * a.m + b.vx * b.m) / (a.m + b.m);
        nb.vy = (a.vy * a.m + b.vy * b.m) / (a.m + b.m);
        nb.vz = 240 + lvl * 12;          // the new mug pops up and lands again
        nb.pop = 0.55;
        nb.age = 10;                     // not a "fresh push" for the danger check
        this.bodies.push(nb);
        this.events.push({ type: 'merge', body: nb, lvl: lvl + 1, x: mx, y: my });
      }
      this.merges.length = 0;
      this.bodies = this.bodies.filter((b) => !b.dead);
    }

    // vertical hops, wobble and pop springs (visual + physical z gravity)
    updateVertical(dt) {
      for (const b of this.bodies) {
        b.age += dt;
        if (b.z > 0 || b.vz !== 0) {
          b.vz -= CFG.ZGRAV * dt;
          b.z += b.vz * dt;
          if (b.z <= 0) {
            b.z = 0;
            if (b.vz < -220) {
              this.events.push({ type: 'land', b, v: -b.vz, x: b.x, y: b.y });
              b.vz = -b.vz * 0.32;
            } else {
              b.vz = 0;
            }
          }
        }
        // wobble spring (mugs lean with the swaying tent)
        b.tiltV += (-70 * b.tilt - 7 * b.tiltV + this.gx * 0.012) * dt;
        b.tilt += b.tiltV * dt;
        if (b.tilt > 0.35) b.tilt = 0.35; else if (b.tilt < -0.35) b.tilt = -0.35;
        // pop spring (merge squash & stretch)
        b.popV += (-(b.pop - 1) * 320 - b.popV * 15) * dt;
        b.pop += b.popV * dt;
        // smoothed speed for the sliding sound
        const sp = Math.hypot(b.vx, b.vy);
        b.slide += (sp - b.slide) * Math.min(1, dt * 12);
      }
    }
  }

  BB.Body = Body;
  BB.World = World;
})();
