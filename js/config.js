// Global game configuration. World units: the table is W wide (x: -W/2..W/2)
// and L long (y: 0 = player's edge, L = far end). The table tilts away from
// the player, so "gravity" pulls every mug toward the far end (+y).
window.BB = window.BB || {};

BB.CFG = {
  W: 560,
  L: 700,
  LAUNCH_Y: 82,          // where the mug waits before being pushed
  DANGER_Y: 222,         // mugs resting nearer than this line = table overflowing

  GRAVITY: 950,          // along +y (table tilt), units/s^2
  FRICTION: 150,         // sliding friction deceleration on the wet table
  DAMPING: 0.35,         // extra linear damping (1/s)
  RESTITUTION: 0.2,      // mug vs mug bounciness
  WALL_REST: 0.3,        // mug vs rail bounciness
  MU_PAIR: 0.1,          // tangential friction between mugs
  SUBSTEPS: 4,
  ITER: 2,
  POS_CORR: 0.75,
  SLOP: 0.25,
  GROW_TIME: 0.12,       // merged mug grows to full size over this time

  PUSH_MIN: 330,         // push speed for a quick tap
  PUSH_MAX: 1550,        // push speed at full charge
  CHARGE_TIME: 0.95,
  COOLDOWN: 0.5,

  DANGER_GRACE: 1.5,     // freshly pushed mugs are ignored by the danger check
  DANGER_LIMIT: 2.5,     // seconds over the line before game over

  ZGRAV: 2600,           // vertical gravity for hops, splashes and droplets
  SPAWN_WEIGHTS: [28, 25, 21, 15, 11],

  // the waitress is impatient: each mug must be pushed before this runs out
  ORDER_TIME_START: 7,
  ORDER_TIME_MIN: 3.2,
  ORDER_RAMP: 45,        // seconds of play to shave one second off the order time

  // random beer-tent events (sway, table bang, schnapps round, free beer)
  EVENT_FIRST: 16,
  EVENT_GAP_MIN: 13,
  EVENT_GAP_MAX: 20,
  SWAY_GX: 430,          // sideways gravity while the whole tent sways
};

// The 11 stages of the merge chain (like the fruits in Suika).
// r = footprint radius on the table, mat = sound material, beer = droplet colour.
BB.LEVELS = [
  { key: 'm00', de: 'Stamperl',    zh: '小烈酒杯',   r: 31,  mat: 'glass',   f0: 2650, color: '#bfe3ff', beer: '#eaf6ff' },
  { key: 'm01', de: 'Stange',      zh: '小啤酒杯',   r: 39,  mat: 'glass',   f0: 2150, color: '#ffd75e', beer: '#f6c22e' },
  { key: 'm02', de: 'Pilstulpe',   zh: '皮爾森杯',   r: 48,  mat: 'glass',   f0: 1850, color: '#ffe48a', beer: '#f3cf45' },
  { key: 'm03', de: 'Weißbier',    zh: '小麥啤酒杯', r: 58,  mat: 'glass',   f0: 1500, color: '#ffb84a', beer: '#efa52c' },
  { key: 'm04', de: 'Dunkel',      zh: '黑啤酒杯',   r: 69,  mat: 'glass',   f0: 1180, color: '#c7834b', beer: '#5c2d10' },
  { key: 'm05', de: 'Maßkrug',     zh: '一公升大杯', r: 81,  mat: 'glass',   f0: 960,  color: '#ffc531', beer: '#f2b01c' },
  { key: 'm06', de: 'Steinkrug',   zh: '陶瓷啤酒壺', r: 94,  mat: 'ceramic', f0: 640,  color: '#6fa0e6', beer: '#f2b01c' },
  { key: 'm07', de: 'Deckelkrug',  zh: '錫蓋啤酒杯', r: 108, mat: 'ceramic', f0: 720,  color: '#c9d4df', beer: '#f2b01c' },
  { key: 'm08', de: 'Bierstiefel', zh: '啤酒靴',     r: 123, mat: 'glass',   f0: 780,  color: '#ffb020', beer: '#f2a516' },
  { key: 'm09', de: 'Fässchen',    zh: '小酒桶',     r: 139, mat: 'wood',    f0: 260,  color: '#d08a4a', beer: '#f2b01c' },
  { key: 'm10', de: 'Riesenfass',  zh: '巨型酒桶',   r: 156, mat: 'wood',    f0: 175,  color: '#ffcf5a', beer: '#f2b01c' },
];
BB.MAX_LEVEL = BB.LEVELS.length - 1;

// Points for creating level i (triangular numbers, as in Suika); merging two
// giant barrels pays MEGA_BONUS.
BB.SCORE_FOR = (lvl) => (lvl * (lvl + 1)) / 2;
BB.MEGA_BONUS = 100;

BB.CHEERS = ['Prost!', 'Zum Wohl!', 'Servus!', 'Sauber!', 'Prost!', 'Wunderbar!', 'Jawohl!', 'Super!', 'Grandios!', "O'zapft is!", 'Ein Prosit!'];
