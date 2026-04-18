const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 5000,
  perMessageDeflate: false,
});

const PORT = process.env.PORT || 3000;
const SIMULATION_HZ = 30;
const SNAPSHOT_HZ = 20;
const SIM_DT = 1 / SIMULATION_HZ;
const SNAPSHOT_MS = 1000 / SNAPSHOT_HZ;

const MAP = { width: 4000, height: 3000 };
const TOWN = { x: 500, y: 500, radius: 320 };
const MINE_NODES = [
  { x: 2000, y: 1500, radius: 100, type: "gold" },
  { x: 3200, y: 600, radius: 80, type: "iron" },
  { x: 700, y: 2400, radius: 80, type: "iron" },
  { x: 3400, y: 2500, radius: 110, type: "crystal" },
];
const BOSS_ARENA = { x: 3500, y: 1500, radius: 260 };

const MAX_MOBS = 28;
const PROJECTILE_LIFETIME = 1.6;

// ---------- classes ----------
const CLASSES = {
  warrior: {
    name: "Воин",
    maxHp: 160,
    speed: 235,
    damage: 24,
    attackCd: 0.5,
    range: 90,
    type: "melee",
    ability: { name: "shield_bash", cd: 7, desc: "Удар щитом по области" },
    abilityRange: 110,
    abilityDamage: 45,
  },
  mage: {
    name: "Маг",
    maxHp: 95,
    speed: 228,
    damage: 20,
    attackCd: 0.42,
    range: 600,
    type: "ranged",
    projectile: { speed: 520, radius: 14, color: "#ff7847" },
    ability: { name: "frost_nova", cd: 9, desc: "Ледяной взрыв" },
    abilityRange: 180,
    abilityDamage: 60,
  },
  rogue: {
    name: "Плут",
    maxHp: 105,
    speed: 320,
    damage: 13,
    attackCd: 0.22,
    range: 70,
    type: "melee",
    ability: { name: "dash", cd: 5, desc: "Рывок вперёд" },
  },
};

const MOB_TYPES = {
  slime: { hp: 40, dmg: 7, speed: 80, radius: 18, xp: 8, coin: [4, 9], color: "#83e06f", aggro: 280 },
  goblin: { hp: 65, dmg: 11, speed: 120, radius: 20, xp: 14, coin: [8, 16], color: "#b9ce5d", aggro: 340 },
  skeleton: { hp: 95, dmg: 15, speed: 105, radius: 22, xp: 22, coin: [14, 24], color: "#e8e4d0", aggro: 360 },
  orc: { hp: 180, dmg: 22, speed: 90, radius: 28, xp: 45, coin: [30, 55], color: "#8a3f2a", aggro: 380 },
  wraith: { hp: 120, dmg: 18, speed: 160, radius: 22, xp: 35, coin: [20, 40], color: "#a586ff", aggro: 420 },
};

const BOSS_TEMPLATE = {
  hp: 1400,
  dmg: 32,
  speed: 75,
  radius: 48,
  xp: 450,
  coin: [280, 420],
  color: "#ff4b6e",
  aggro: 700,
  boss: true,
  name: "Древний страж",
};

const ITEMS = {
  potion_hp: { name: "Зелье лечения", kind: "consumable", stack: 9, heal: 60, icon: "🧪", price: 40 },
  potion_mp: { name: "Эликсир ярости", kind: "consumable", stack: 9, buff: "rage", icon: "⚗️", price: 60 },
  // weapon upgrades (equipped -> increases dmg)
  sword_1: { name: "Стальной меч", kind: "weapon", dmg: 8, slot: "warrior", icon: "🗡️", price: 120 },
  sword_2: { name: "Рунный клинок", kind: "weapon", dmg: 18, slot: "warrior", icon: "⚔️", price: 320 },
  staff_1: { name: "Посох огня", kind: "weapon", dmg: 8, slot: "mage", icon: "🔥", price: 120 },
  staff_2: { name: "Посох архимага", kind: "weapon", dmg: 20, slot: "mage", icon: "✨", price: 350 },
  dagger_1: { name: "Острые кинжалы", kind: "weapon", dmg: 5, slot: "rogue", icon: "🗡️", price: 120 },
  dagger_2: { name: "Теневые клинки", kind: "weapon", dmg: 12, slot: "rogue", icon: "🔪", price: 330 },
  armor_1: { name: "Кожаный доспех", kind: "armor", hp: 30, icon: "🛡️", price: 100 },
  armor_2: { name: "Латный доспех", kind: "armor", hp: 80, icon: "🛡️", price: 280 },
  boots_1: { name: "Сапоги странника", kind: "boots", speed: 20, icon: "👢", price: 90 },
};

const SHOP_LISTINGS = [
  "potion_hp", "potion_mp", "sword_1", "sword_2", "staff_1", "staff_2",
  "dagger_1", "dagger_2", "armor_1", "armor_2", "boots_1",
];

// ---------- utility ----------
const lobbies = new Map();
const players = new Map();
const playerLobby = new Map();

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function len(x, y) { return Math.sqrt(x * x + y * y); }
function dist(a, b) { return len(a.x - b.x, a.y - b.y); }
function rand(a, b) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }

function randomCode(n = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function sanitizeProfile(p = {}) {
  return {
    name: String(p.name || "Герой").slice(0, 16),
    cls: CLASSES[p.cls] ? p.cls : "warrior",
    appearance: {
      body: typeof p.body === "string" ? p.body : "#f0efe9",
      accent: typeof p.accent === "string" ? p.accent : "#2a9d8f",
      eyes: typeof p.eyes === "string" ? p.eyes : "#1d3557",
    },
  };
}

function xpForLevel(lvl) { return Math.floor(50 * Math.pow(lvl, 1.55)); }

function computeStats(p) {
  const base = CLASSES[p.cls];
  let maxHp = base.maxHp + (p.level - 1) * 18;
  let damage = base.damage + (p.level - 1) * 3;
  let speed = base.speed;
  // equipment
  for (const slot of ["weapon", "armor", "boots"]) {
    const key = p.equipment[slot];
    const item = key && ITEMS[key];
    if (!item) continue;
    if (item.dmg) damage += item.dmg;
    if (item.hp) maxHp += item.hp;
    if (item.speed) speed += item.speed;
  }
  const hpRatio = p.hp / p.maxHp;
  p.maxHp = maxHp;
  p.hp = clamp(maxHp * hpRatio, 1, maxHp);
  p.damage = damage;
  p.speed = speed;
  p.attackCd = base.attackCd;
  p.range = base.range;
}

function createPlayer(socket, payload = {}) {
  const profile = sanitizeProfile(payload);
  const base = CLASSES[profile.cls];
  const p = {
    id: socket.id,
    name: profile.name,
    cls: profile.cls,
    appearance: profile.appearance,
    x: TOWN.x + rand(-120, 120),
    y: TOWN.y + rand(-120, 120),
    vx: 0, vy: 0,
    facing: 0,
    radius: 20,
    hp: base.maxHp,
    maxHp: base.maxHp,
    speed: base.speed,
    damage: base.damage,
    attackCd: base.attackCd,
    range: base.range,
    level: 1,
    xp: 0,
    xpNeeded: xpForLevel(1),
    coins: 50,
    attackTimer: 0,
    abilityTimer: 0,
    interactTimer: 0,
    respawnTimer: 0,
    buffs: {},
    inventory: Array(16).fill(null),
    equipment: { weapon: null, armor: null, boots: null },
    lastInputAt: Date.now(),
    lastDamagedBy: null,
  };
  return p;
}

function inventoryAdd(player, itemKey, qty = 1) {
  const def = ITEMS[itemKey];
  if (!def) return false;
  if (def.stack) {
    for (const slot of player.inventory) {
      if (slot && slot.key === itemKey && slot.qty < def.stack) {
        const space = def.stack - slot.qty;
        const add = Math.min(space, qty);
        slot.qty += add;
        qty -= add;
        if (qty <= 0) return true;
      }
    }
  }
  for (let i = 0; i < player.inventory.length; i++) {
    if (!player.inventory[i]) {
      player.inventory[i] = { key: itemKey, qty: def.stack ? Math.min(qty, def.stack) : 1 };
      qty -= player.inventory[i].qty;
      if (qty <= 0) return true;
    }
  }
  return qty <= 0;
}

function createLobby(hostId, name = "Арена") {
  let code = randomCode();
  while (lobbies.has(code)) code = randomCode();
  const lobby = {
    code,
    name: String(name).slice(0, 24) || "Арена",
    hostId,
    createdAt: Date.now(),
    players: new Set(),
    mobs: [],
    projectiles: [],
    effects: [],
    pickups: [],
    messages: [],
    nextMobId: 1,
    nextProjId: 1,
    nextEffId: 1,
    nextPickupId: 1,
    bossAlive: false,
    bossRespawnAt: 10,
  };
  lobbies.set(code, lobby);
  return lobby;
}

function getLobby(code) {
  return code ? lobbies.get(String(code).trim().toUpperCase()) || null : null;
}

function pushMessage(lobby, text) {
  lobby.messages.unshift({ t: Date.now(), text });
  lobby.messages = lobby.messages.slice(0, 20);
  io.to(lobby.code).emit("chat", lobby.messages[0]);
}

function respawnPlayer(p) {
  if (p.respawnTimer > 0) return;
  p.hp = p.maxHp;
  p.x = TOWN.x + rand(-100, 100);
  p.y = TOWN.y + rand(-100, 100);
  p.vx = 0; p.vy = 0;
  p.respawnTimer = 0;
}

function killPlayer(lobby, player, killerName = "враг") {
  if (player.hp <= 0 || player.respawnTimer > 0) return;
  player.hp = 0;
  player.vx = 0;
  player.vy = 0;
  player.attackTimer = 0;
  player.abilityTimer = 0;
  player.interactTimer = 0;
  player.respawnTimer = 2.2;
  addEffect(lobby, { type: "death", x: player.x, y: player.y, duration: 0.6, ownerId: player.id });
  void killerName;
}

function spawnMob(lobby, type, x, y) {
  const tpl = MOB_TYPES[type];
  const level = Math.min(5, 1 + Math.floor(Math.random() * 3));
  const hpMul = 1 + (level - 1) * 0.35;
  return {
    id: lobby.nextMobId++,
    type,
    name: type,
    x, y,
    vx: 0, vy: 0,
    radius: tpl.radius,
    hp: tpl.hp * hpMul,
    maxHp: tpl.hp * hpMul,
    damage: tpl.dmg,
    speed: tpl.speed,
    aggro: tpl.aggro,
    attackTimer: 0,
    state: "idle",
    target: null,
    level,
    color: tpl.color,
    boss: false,
    spawnX: x,
    spawnY: y,
  };
}

function spawnBoss(lobby) {
  const m = spawnMob(lobby, "orc", BOSS_ARENA.x, BOSS_ARENA.y);
  Object.assign(m, {
    type: "boss",
    name: BOSS_TEMPLATE.name,
    hp: BOSS_TEMPLATE.hp, maxHp: BOSS_TEMPLATE.hp,
    damage: BOSS_TEMPLATE.dmg, speed: BOSS_TEMPLATE.speed,
    radius: BOSS_TEMPLATE.radius, aggro: BOSS_TEMPLATE.aggro,
    color: BOSS_TEMPLATE.color, boss: true,
  });
  lobby.mobs.push(m);
  lobby.bossAlive = true;
  pushMessage(lobby, `⚠️ ${BOSS_TEMPLATE.name} пробудился!`);
}

function populateLobby(lobby) {
  const zones = [
    { x: 1500, y: 900, r: 500, type: "slime" },
    { x: 2400, y: 1800, r: 550, type: "goblin" },
    { x: 1000, y: 2000, r: 500, type: "skeleton" },
    { x: 3000, y: 2200, r: 500, type: "wraith" },
    { x: 2600, y: 500, r: 400, type: "goblin" },
  ];
  lobby.mobs = [];
  for (const z of zones) {
    const n = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * z.r;
      const x = clamp(z.x + Math.cos(a) * r, 60, MAP.width - 60);
      const y = clamp(z.y + Math.sin(a) * r, 60, MAP.height - 60);
      lobby.mobs.push(spawnMob(lobby, z.type, x, y));
    }
  }
}

function addPlayerToLobby(playerId, code) {
  const lobby = getLobby(code);
  const p = players.get(playerId);
  if (!lobby || !p) return { ok: false, message: "Лобби не найдено." };

  const oldCode = playerLobby.get(playerId);
  if (oldCode && oldCode !== lobby.code) {
    const old = lobbies.get(oldCode);
    if (old) { old.players.delete(playerId); cleanupLobby(old); }
  }

  lobby.players.add(playerId);
  playerLobby.set(playerId, lobby.code);
  respawnPlayer(p);
  if (lobby.mobs.length === 0) populateLobby(lobby);
  return { ok: true, lobby };
}

function cleanupLobby(lobby) {
  if (!lobby) return;
  if (lobby.players.size === 0) { lobbies.delete(lobby.code); return; }
  if (!lobby.players.has(lobby.hostId)) lobby.hostId = Array.from(lobby.players)[0];
}

// ---------- combat ----------
function addEffect(lobby, data) {
  const e = { id: lobby.nextEffId++, t: 0, ...data };
  lobby.effects.push(e);
  return e;
}

function gainXp(player, amount) {
  player.xp += amount;
  while (player.xp >= player.xpNeeded) {
    player.xp -= player.xpNeeded;
    player.level += 1;
    player.xpNeeded = xpForLevel(player.level);
    computeStats(player);
    player.hp = player.maxHp;
    const lobby = getLobby(playerLobby.get(player.id));
    if (lobby) {
      pushMessage(lobby, `⭐ ${player.name} достиг ${player.level} уровня!`);
      addEffect(lobby, { type: "levelup", x: player.x, y: player.y, duration: 1.2, ownerId: player.id });
    }
  }
}

function dropLoot(lobby, mob) {
  const tpl = mob.boss ? BOSS_TEMPLATE : MOB_TYPES[mob.type];
  const coin = randi(tpl.coin[0], tpl.coin[1]) * (mob.boss ? 1 : 1);
  const drops = [{ kind: "coin", amount: coin }];
  if (mob.boss || Math.random() < 0.25) drops.push({ kind: "item", key: "potion_hp" });
  if (mob.boss) { drops.push({ kind: "item", key: "armor_2" }); drops.push({ kind: "item", key: "potion_mp" }); }
  else if (Math.random() < 0.04) drops.push({ kind: "item", key: "potion_mp" });
  for (const d of drops) {
    const angle = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 30;
    lobby.pickups.push({
      id: lobby.nextPickupId++,
      ...d,
      x: mob.x + Math.cos(angle) * r,
      y: mob.y + Math.sin(angle) * r,
      ttl: 60,
    });
  }
}

function killMob(lobby, mob, killer) {
  dropLoot(lobby, mob);
  addEffect(lobby, { type: "death", x: mob.x, y: mob.y, duration: 0.6 });
  if (killer) {
    const tpl = mob.boss ? BOSS_TEMPLATE : MOB_TYPES[mob.type];
    gainXp(killer, tpl.xp * (mob.boss ? 1 : 1));
    if (mob.boss) pushMessage(lobby, `🏆 ${killer.name} победил ${mob.name}!`);
  }
  if (mob.boss) { lobby.bossAlive = false; lobby.bossRespawnAt = 90; }
}

function damageMob(lobby, mob, amount, killer) {
  mob.hp -= amount;
  addEffect(lobby, { type: "damage", x: mob.x, y: mob.y - mob.radius - 8, amount: Math.round(amount), duration: 0.8, crit: false });
  if (mob.hp <= 0) {
    const idx = lobby.mobs.indexOf(mob);
    if (idx >= 0) lobby.mobs.splice(idx, 1);
    killMob(lobby, mob, killer);
  }
}

function playerAttack(player, lobby, aim) {
  if (player.hp <= 0 || player.respawnTimer > 0) return;
  if (player.attackTimer > 0) return;
  const cls = CLASSES[player.cls];
  player.attackTimer = player.attackCd;
  const ang = Math.atan2(aim.y, aim.x);
  player.facing = ang;

  if (cls.type === "ranged") {
    // fireball projectile
    const pr = cls.projectile;
    lobby.projectiles.push({
      id: lobby.nextProjId++,
      ownerId: player.id,
      x: player.x + Math.cos(ang) * 24,
      y: player.y + Math.sin(ang) * 24,
      vx: Math.cos(ang) * pr.speed,
      vy: Math.sin(ang) * pr.speed,
      radius: pr.radius,
      damage: player.damage,
      life: PROJECTILE_LIFETIME,
      kind: "fireball",
    });
    addEffect(lobby, { type: "cast", x: player.x, y: player.y, duration: 0.25, color: pr.color });
  } else {
    // melee swing - cone
    addEffect(lobby, {
      type: "swing", x: player.x, y: player.y, angle: ang,
      range: player.range, duration: 0.22, ownerId: player.id, cls: player.cls,
    });
    const range = player.range;
    for (const mob of [...lobby.mobs]) {
      const dx = mob.x - player.x, dy = mob.y - player.y;
      const d = len(dx, dy);
      if (d > range + mob.radius) continue;
      const a = Math.atan2(dy, dx);
      let diff = a - ang;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > Math.PI / 2.3) continue;
      damageMob(lobby, mob, player.damage, player);
    }
  }
}

function playerAbility(player, lobby, aim) {
  if (player.hp <= 0 || player.respawnTimer > 0) return;
  if (player.abilityTimer > 0) return;
  const cls = CLASSES[player.cls];
  const ab = cls.ability;
  player.abilityTimer = ab.cd;
  const ang = Math.atan2(aim.y, aim.x);

  if (ab.name === "shield_bash") {
    const cx = player.x + Math.cos(ang) * 60;
    const cy = player.y + Math.sin(ang) * 60;
    addEffect(lobby, { type: "shield_bash", x: cx, y: cy, radius: cls.abilityRange, duration: 0.45 });
    for (const mob of [...lobby.mobs]) {
      if (len(mob.x - cx, mob.y - cy) <= cls.abilityRange + mob.radius) {
        damageMob(lobby, mob, cls.abilityDamage + player.damage * 0.5, player);
      }
    }
  } else if (ab.name === "frost_nova") {
    addEffect(lobby, { type: "frost_nova", x: player.x, y: player.y, radius: cls.abilityRange, duration: 0.7 });
    for (const mob of [...lobby.mobs]) {
      if (len(mob.x - player.x, mob.y - player.y) <= cls.abilityRange + mob.radius) {
        damageMob(lobby, mob, cls.abilityDamage + player.damage * 0.4, player);
        mob.frozen = 1.5;
      }
    }
  } else if (ab.name === "dash") {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const dashDist = 220;
    const nx = clamp(player.x + dx * dashDist, 30, MAP.width - 30);
    const ny = clamp(player.y + dy * dashDist, 30, MAP.height - 30);
    addEffect(lobby, { type: "dash", x1: player.x, y1: player.y, x2: nx, y2: ny, duration: 0.35, ownerId: player.id });
    player.x = nx; player.y = ny;
    // damage along the line
    for (const mob of [...lobby.mobs]) {
      // project mob onto line
      const vx = nx - (player.x - dx * dashDist), vy = ny - (player.y - dy * dashDist);
      const t = ((mob.x - (player.x - dx * dashDist)) * vx + (mob.y - (player.y - dy * dashDist)) * vy) / (vx * vx + vy * vy);
      const tc = clamp(t, 0, 1);
      const px = (player.x - dx * dashDist) + vx * tc, py = (player.y - dy * dashDist) + vy * tc;
      if (len(mob.x - px, mob.y - py) < mob.radius + 34) {
        damageMob(lobby, mob, player.damage * 1.6, player);
      }
    }
  }
}

function useItem(player, slotIndex) {
  if (player.hp <= 0 || player.respawnTimer > 0) return "Нельзя использовать предметы после смерти.";
  const slot = player.inventory[slotIndex];
  if (!slot) return "Слот пуст.";
  const def = ITEMS[slot.key];
  if (!def) return "Неизвестный предмет.";
  if (def.kind === "consumable") {
    if (def.heal) player.hp = clamp(player.hp + def.heal, 0, player.maxHp);
    if (def.buff === "rage") {
      player.buffs.rage = 8;
    }
    slot.qty -= 1;
    if (slot.qty <= 0) player.inventory[slotIndex] = null;
    return def.name + " использовано.";
  }
  if (def.kind === "weapon") {
    if (def.slot && def.slot !== player.cls) return "Оружие не для этого класса.";
    const prev = player.equipment.weapon;
    player.equipment.weapon = slot.key;
    player.inventory[slotIndex] = prev ? { key: prev, qty: 1 } : null;
    computeStats(player);
    return "Оружие экипировано.";
  }
  if (def.kind === "armor") {
    const prev = player.equipment.armor;
    player.equipment.armor = slot.key;
    player.inventory[slotIndex] = prev ? { key: prev, qty: 1 } : null;
    computeStats(player);
    return "Броня экипирована.";
  }
  if (def.kind === "boots") {
    const prev = player.equipment.boots;
    player.equipment.boots = slot.key;
    player.inventory[slotIndex] = prev ? { key: prev, qty: 1 } : null;
    computeStats(player);
    return "Сапоги экипированы.";
  }
  return "Нельзя использовать.";
}

function buyItem(player, key) {
  if (dist(player, TOWN) > TOWN.radius) return "Покупки только в городе.";
  const def = ITEMS[key];
  if (!def) return "Товара нет.";
  if (player.coins < def.price) return "Недостаточно монет.";
  if (!inventoryAdd(player, key)) return "Инвентарь полон.";
  player.coins -= def.price;
  return `Куплено: ${def.name}`;
}

function tryMine(player, lobby) {
  const node = MINE_NODES.find((n) => dist(player, n) <= n.radius + 30);
  if (!node) return "Подойди к залежи.";
  const bonus = node.type === "gold" ? 18 : node.type === "crystal" ? 30 : 10;
  const reward = bonus + Math.floor(Math.random() * 8);
  player.coins += reward;
  gainXp(player, Math.floor(reward / 2));
  addEffect(lobby, { type: "mine", x: node.x, y: node.y, duration: 0.5 });
  return `Добыто ${reward} монет.`;
}

function pickupNear(player, lobby) {
  for (let i = lobby.pickups.length - 1; i >= 0; i--) {
    const pk = lobby.pickups[i];
    if (len(player.x - pk.x, player.y - pk.y) < 34) {
      if (pk.kind === "coin") { player.coins += pk.amount; }
      else if (pk.kind === "item") { if (!inventoryAdd(player, pk.key)) continue; }
      lobby.pickups.splice(i, 1);
    }
  }
}

// ---------- simulation ----------
function updateLobby(lobby, dt) {
  // players
  for (const pid of lobby.players) {
    const p = players.get(pid);
    if (!p) continue;
    if (p.respawnTimer > 0) {
      p.respawnTimer = Math.max(0, p.respawnTimer - dt);
      p.vx = 0;
      p.vy = 0;
      if (p.respawnTimer === 0) respawnPlayer(p);
      continue;
    }
    if (p.attackTimer > 0) p.attackTimer = Math.max(0, p.attackTimer - dt);
    if (p.abilityTimer > 0) p.abilityTimer = Math.max(0, p.abilityTimer - dt);
    if (p.interactTimer > 0) p.interactTimer = Math.max(0, p.interactTimer - dt);
    for (const k of Object.keys(p.buffs)) {
      p.buffs[k] -= dt;
      if (p.buffs[k] <= 0) delete p.buffs[k];
    }
    if (dist(p, TOWN) <= TOWN.radius && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.06 * dt);
    }
    if (Date.now() - p.lastInputAt > 220) { p.vx = 0; p.vy = 0; }
    pickupNear(p, lobby);
  }

  // mobs
  for (const mob of lobby.mobs) {
    if (mob.frozen) { mob.frozen = Math.max(0, mob.frozen - dt); if (mob.frozen > 0) continue; }
    if (mob.attackTimer > 0) mob.attackTimer = Math.max(0, mob.attackTimer - dt);

    let target = null, best = Infinity;
    for (const pid of lobby.players) {
      const p = players.get(pid);
      if (!p) continue;
      const d = dist(p, mob);
      if (d < best && d < mob.aggro) { best = d; target = p; }
    }

    if (target) {
      const dx = target.x - mob.x, dy = target.y - mob.y;
      const d = Math.max(1, len(dx, dy));
      const speed = mob.speed;
      if (d > mob.radius + 24) {
        mob.vx = (dx / d) * speed;
        mob.vy = (dy / d) * speed;
        mob.x = clamp(mob.x + mob.vx * dt, 20, MAP.width - 20);
        mob.y = clamp(mob.y + mob.vy * dt, 20, MAP.height - 20);
      } else {
        mob.vx = 0; mob.vy = 0;
        if (mob.attackTimer === 0) {
          target.hp -= mob.damage;
          mob.attackTimer = 1.0;
          addEffect(lobby, { type: "hit", x: target.x, y: target.y, duration: 0.35 });
          if (target.hp <= 0) killPlayer(lobby, target, mob.name);
          if (target.hp <= 0) {
            const lost = Math.min(25, Math.floor(target.coins * 0.1));
            target.coins -= lost;
            respawnPlayer(target);
            pushMessage(lobby, `💀 ${target.name} пал от ${mob.name}.`);
          }
        }
      }
    } else {
      // idle drift back to spawn
      const dx = mob.spawnX - mob.x, dy = mob.spawnY - mob.y;
      const d = len(dx, dy);
      if (d > 10) { mob.vx = (dx / d) * mob.speed * 0.3; mob.vy = (dy / d) * mob.speed * 0.3;
        mob.x += mob.vx * dt; mob.y += mob.vy * dt;
      } else { mob.vx = 0; mob.vy = 0; }
    }
  }

  // projectiles
  for (let i = lobby.projectiles.length - 1; i >= 0; i--) {
    const pr = lobby.projectiles[i];
    pr.life -= dt;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    if (pr.life <= 0 || pr.x < 0 || pr.x > MAP.width || pr.y < 0 || pr.y > MAP.height) {
      lobby.projectiles.splice(i, 1);
      continue;
    }
    // hit mobs
    let hit = false;
    for (const mob of [...lobby.mobs]) {
      if (len(pr.x - mob.x, pr.y - mob.y) < pr.radius + mob.radius) {
        const owner = players.get(pr.ownerId);
        damageMob(lobby, mob, pr.damage, owner);
        addEffect(lobby, { type: "explosion", x: pr.x, y: pr.y, duration: 0.4 });
        hit = true;
        break;
      }
    }
    if (hit) lobby.projectiles.splice(i, 1);
  }

  // effects
  for (let i = lobby.effects.length - 1; i >= 0; i--) {
    lobby.effects[i].t += dt;
    if (lobby.effects[i].t >= lobby.effects[i].duration) lobby.effects.splice(i, 1);
  }

  // pickups
  for (let i = lobby.pickups.length - 1; i >= 0; i--) {
    lobby.pickups[i].ttl -= dt;
    if (lobby.pickups[i].ttl <= 0) lobby.pickups.splice(i, 1);
  }

  // boss respawn
  if (!lobby.bossAlive) {
    lobby.bossRespawnAt -= dt;
    if (lobby.bossRespawnAt <= 0 && lobby.players.size > 0) spawnBoss(lobby);
  }

  // mobs respawn to keep population
  if (lobby.mobs.filter((m) => !m.boss).length < 20) {
    const types = ["slime", "goblin", "skeleton", "wraith"];
    const t = types[Math.floor(Math.random() * types.length)];
    lobby.mobs.push(spawnMob(lobby, t, rand(800, MAP.width - 200), rand(800, MAP.height - 200)));
  }
}

function snapshotLobby(lobby) {
  const pls = [];
  for (const pid of lobby.players) {
    const p = players.get(pid);
    if (!p) continue;
    pls.push({
      id: p.id, name: p.name, cls: p.cls, appearance: p.appearance,
      x: +p.x.toFixed(1), y: +p.y.toFixed(1), vx: +p.vx.toFixed(1), vy: +p.vy.toFixed(1),
      facing: +p.facing.toFixed(2),
      hp: Math.round(p.hp), maxHp: p.maxHp, level: p.level,
    });
  }
  return {
    t: Date.now(),
    players: pls,
    mobs: lobby.mobs.map((m) => ({
      id: m.id, type: m.type, name: m.name, x: +m.x.toFixed(1), y: +m.y.toFixed(1),
      vx: +m.vx.toFixed(1), vy: +m.vy.toFixed(1), radius: m.radius,
      hp: Math.round(m.hp), maxHp: m.maxHp, boss: m.boss, frozen: !!m.frozen, color: m.color,
    })),
    projectiles: lobby.projectiles.map((p) => ({
      id: p.id, x: +p.x.toFixed(1), y: +p.y.toFixed(1), vx: p.vx, vy: p.vy,
      radius: p.radius, kind: p.kind, ownerId: p.ownerId,
    })),
    effects: lobby.effects.map((e) => ({ ...e })),
    pickups: lobby.pickups.map((p) => ({ id: p.id, x: p.x, y: p.y, kind: p.kind, amount: p.amount, key: p.key })),
  };
}

function sendSelfState(socket, p) {
  socket.emit("self", {
    id: p.id, name: p.name, cls: p.cls,
    hp: p.hp, maxHp: p.maxHp, level: p.level, xp: p.xp, xpNeeded: p.xpNeeded,
    coins: p.coins, damage: p.damage, speed: p.speed, range: p.range,
    radius: p.radius,
    attackCd: p.attackCd, attackTimer: p.attackTimer,
    abilityTimer: p.abilityTimer, abilityCd: CLASSES[p.cls].ability.cd,
    inventory: p.inventory, equipment: p.equipment,
    buffs: p.buffs,
  });
}

// ---------- express / io ----------
app.use(express.static("public"));

app.get("/api/lobbies", (_req, res) => {
  const list = [];
  for (const l of lobbies.values()) {
    list.push({ code: l.code, name: l.name, players: l.players.size, createdAt: l.createdAt });
  }
  res.json(list);
});

io.on("connection", (socket) => {
  socket.on("player:init", (payload) => {
    if (players.has(socket.id)) {
      const p = players.get(socket.id);
      const prof = sanitizeProfile(payload);
      p.name = prof.name; p.appearance = prof.appearance;
      if (prof.cls !== p.cls) {
        p.cls = prof.cls;
        computeStats(p);
        p.hp = p.maxHp;
      }
      socket.emit("ready", { id: socket.id, cls: p.cls });
      return;
    }
    const p = createPlayer(socket, payload);
    players.set(socket.id, p);
    socket.emit("ready", { id: socket.id, cls: p.cls });
    socket.emit("static", { map: MAP, town: TOWN, mines: MINE_NODES, bossArena: BOSS_ARENA, classes: CLASSES, items: ITEMS, shop: SHOP_LISTINGS });
  });

  socket.on("lobby:list", () => {
    const list = [];
    for (const l of lobbies.values()) list.push({ code: l.code, name: l.name, players: l.players.size });
    socket.emit("lobby:list", list);
  });

  socket.on("lobby:create", (payload) => {
    const p = players.get(socket.id);
    if (!p) return;
    const prev = playerLobby.get(socket.id);
    const lobby = createLobby(socket.id, payload?.name || `${p.name} Lobby`);
    const res = addPlayerToLobby(socket.id, lobby.code);
    if (!res.ok) return;
    if (prev && prev !== lobby.code) socket.leave(prev);
    socket.join(lobby.code);
    pushMessage(lobby, `✨ ${p.name} создал лобби.`);
    socket.emit("lobby:joined", { code: lobby.code, name: lobby.name });
    socket.emit("chat:history", lobby.messages);
  });

  socket.on("lobby:join", (raw) => {
    const p = players.get(socket.id);
    if (!p) return;
    const code = String(raw || "").trim().toUpperCase();
    const prev = playerLobby.get(socket.id);
    const res = addPlayerToLobby(socket.id, code);
    if (!res.ok) { socket.emit("actionResult", res.message); return; }
    if (prev && prev !== code) socket.leave(prev);
    socket.join(code);
    pushMessage(res.lobby, `➕ ${p.name} вошёл в лобби.`);
    socket.emit("lobby:joined", { code: res.lobby.code, name: res.lobby.name });
    socket.emit("chat:history", res.lobby.messages);
  });

  socket.on("lobby:leave", () => {
    const code = playerLobby.get(socket.id);
    const p = players.get(socket.id);
    if (code && lobbies.has(code)) {
      const l = lobbies.get(code);
      l.players.delete(socket.id);
      socket.leave(code);
      if (p) pushMessage(l, `➖ ${p.name} покинул лобби.`);
      cleanupLobby(l);
    }
    playerLobby.delete(socket.id);
    socket.emit("lobby:left");
  });

  socket.on("player:input", (payload) => {
    const p = players.get(socket.id);
    if (!p) return;
    if (p.hp <= 0 || p.respawnTimer > 0) return;
    const nx = Number(payload?.x), ny = Number(payload?.y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    p.x = clamp(nx, 30, MAP.width - 30);
    p.y = clamp(ny, 30, MAP.height - 30);
    p.vx = clamp(+payload.vx || 0, -500, 500);
    p.vy = clamp(+payload.vy || 0, -500, 500);
    p.facing = +payload.facing || p.facing;
    p.lastInputAt = Date.now();
  });

  socket.on("player:attack", (aim) => {
    const p = players.get(socket.id);
    const code = playerLobby.get(socket.id);
    const lobby = code && lobbies.get(code);
    if (!p || !lobby) return;
    const a = { x: +aim?.x || 1, y: +aim?.y || 0 };
    playerAttack(p, lobby, a);
  });

  socket.on("player:ability", (aim) => {
    const p = players.get(socket.id);
    const code = playerLobby.get(socket.id);
    const lobby = code && lobbies.get(code);
    if (!p || !lobby) return;
    const a = { x: +aim?.x || 1, y: +aim?.y || 0 };
    playerAbility(p, lobby, a);
  });

  socket.on("player:interact", () => {
    const p = players.get(socket.id);
    const code = playerLobby.get(socket.id);
    const lobby = code && lobbies.get(code);
    if (!p || !lobby || p.interactTimer > 0 || p.hp <= 0 || p.respawnTimer > 0) return;
    p.interactTimer = 0.35;
    socket.emit("actionResult", tryMine(p, lobby));
  });

  socket.on("inventory:use", (idx) => {
    const p = players.get(socket.id);
    if (!p) return;
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0 || i >= p.inventory.length) return;
    socket.emit("actionResult", useItem(p, i));
  });

  socket.on("shop:buy", (key) => {
    const p = players.get(socket.id);
    if (!p || p.hp <= 0 || p.respawnTimer > 0) return;
    socket.emit("actionResult", buyItem(p, String(key)));
  });

  socket.on("chat:send", (text) => {
    const p = players.get(socket.id);
    const code = playerLobby.get(socket.id);
    const lobby = code && lobbies.get(code);
    if (!p || !lobby) return;
    const clean = String(text || "").slice(0, 160).trim();
    if (!clean) return;
    pushMessage(lobby, `💬 ${p.name}: ${clean}`);
  });

  socket.on("disconnect", () => {
    const code = playerLobby.get(socket.id);
    const p = players.get(socket.id);
    if (code && lobbies.has(code)) {
      const l = lobbies.get(code);
      l.players.delete(socket.id);
      if (p) pushMessage(l, `⚠ ${p.name} отключился.`);
      cleanupLobby(l);
    }
    playerLobby.delete(socket.id);
    players.delete(socket.id);
  });
});

// ---------- main loops ----------
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  for (const lobby of lobbies.values()) updateLobby(lobby, dt);
}, 1000 / SIMULATION_HZ);

setInterval(() => {
  for (const lobby of lobbies.values()) {
    const snap = snapshotLobby(lobby);
    io.to(lobby.code).emit("snapshot", snap);
    for (const pid of lobby.players) {
      const p = players.get(pid);
      const sock = io.sockets.sockets.get(pid);
      if (p && sock) sendSelfState(sock, p);
    }
  }
}, SNAPSHOT_MS);

server.listen(PORT, () => console.log(`Server on ${PORT}`));
