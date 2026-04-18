const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SIMULATION_TICK_RATE = 1000 / 20;
const SNAPSHOT_TICK_RATE = 1000 / 12;
const MAP = { width: 3200, height: 2200 };
const TOWN = { x: 360, y: 360, radius: 260 };
const MINE_NODE = { x: MAP.width / 2, y: MAP.height / 2, radius: 88 };
const MAX_ENEMIES = 16;
const PLAYER_SPEED = 220;

const lobbies = new Map();
const players = new Map();
const playerLobby = new Map();
function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createLobby(hostId) {
  let code = randomCode();
  while (lobbies.has(code)) {
    code = randomCode();
  }

  const lobby = {
    code,
    hostId,
    players: new Set(),
    enemies: [],
    messages: [`Лобби ${code} создано.`],
  };

  lobbies.set(code, lobby);
  return lobby;
}

function createPlayer(socket, payload = {}) {
  const colors = ["#f0efe9", "#1d3557", "#d62828", "#2a9d8f", "#e9c46a"];
  return {
    id: socket.id,
    name: String(payload.name || "Игрок").slice(0, 18),
    x: TOWN.x + Math.random() * 120 - 60,
    y: TOWN.y + Math.random() * 120 - 60,
    vx: 0,
    vy: 0,
    speed: PLAYER_SPEED,
    radius: 18,
    facing: "down",
    hp: 100,
    maxHp: 100,
    coins: 0,
    baseMiningReward: 6,
    baseDamage: 12,
    miningReward: 6,
    damage: 12,
    attackCooldown: 0,
    interactCooldown: 0,
    inventory: {
      pickaxe: false,
      sword: false,
    },
    appearance: {
      body: payload.body || colors[0],
      accent: payload.accent || colors[3],
      eyes: payload.eyes || colors[1],
    },
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
    },
    lastMoveAt: Date.now(),
  };
}

function sanitizeProfile(payload = {}) {
  const colors = ["#f0efe9", "#2a9d8f", "#1d3557"];
  const fallback = {
    body: colors[0],
    accent: colors[1],
    eyes: colors[2],
  };

  return {
    name: String(payload.name || "Игрок").slice(0, 18),
    appearance: {
      body: typeof payload.body === "string" ? payload.body : fallback.body,
      accent: typeof payload.accent === "string" ? payload.accent : fallback.accent,
      eyes: typeof payload.eyes === "string" ? payload.eyes : fallback.eyes,
    },
  };
}

function getLobby(code) {
  if (!code) return null;
  return lobbies.get(String(code).trim().toUpperCase()) || null;
}

function addPlayerToLobby(playerId, code) {
  const lobby = getLobby(code);
  const player = players.get(playerId);
  if (!lobby || !player) {
    return { ok: false, message: "Лобби не найдено." };
  }

  const oldCode = playerLobby.get(playerId);
  if (oldCode && lobbies.has(oldCode)) {
    const oldLobby = lobbies.get(oldCode);
    oldLobby.players.delete(playerId);
    io.to(oldCode).emit("systemMessage", `${player.name} покинул лобби.`);
    cleanupLobby(oldLobby);
  }

  lobby.players.add(playerId);
  playerLobby.set(playerId, lobby.code);
  player.x = TOWN.x + Math.random() * 150 - 75;
  player.y = TOWN.y + Math.random() * 150 - 75;

  if (lobby.enemies.length === 0) {
    spawnEnemies(lobby);
  }

  return { ok: true, lobby };
}

function cleanupLobby(lobby) {
  if (!lobby) return;
  if (lobby.players.size === 0) {
    lobbies.delete(lobby.code);
    return;
  }

  if (!lobby.players.has(lobby.hostId)) {
    lobby.hostId = Array.from(lobby.players)[0];
  }
}

function spawnEnemies(lobby) {
  lobby.enemies = Array.from({ length: MAX_ENEMIES }, (_, index) => ({
    id: `enemy-${index}-${Date.now()}`,
    x: 900 + Math.random() * 1800,
    y: 600 + Math.random() * 1200,
    radius: 20,
    hp: 50,
    maxHp: 50,
    damage: 10,
    speed: 100 + Math.random() * 25,
    cooldown: 0,
    targetId: null,
    respawnAt: 0,
  }));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function length(x, y) {
  return Math.sqrt(x * x + y * y);
}

function distance(a, b) {
  return length(a.x - b.x, a.y - b.y);
}

function isInsideTown(player) {
  return distance(player, TOWN) <= TOWN.radius;
}

function respawnPlayer(player) {
  player.hp = player.maxHp;
  player.x = TOWN.x + Math.random() * 150 - 75;
  player.y = TOWN.y + Math.random() * 150 - 75;
}

function emitLobbyState(code) {
  const lobby = getLobby(code);
  if (!lobby) return;

  const payload = {
    lobby: {
      code: lobby.code,
      hostId: lobby.hostId,
      inviteCode: lobby.code,
    },
    map: MAP,
    town: TOWN,
    mineNode: MINE_NODE,
    shop: {
      pickaxe: { price: 40, name: "Кирка" },
      sword: { price: 55, name: "Меч" },
    },
    players: Array.from(lobby.players)
      .map((id) => players.get(id))
      .filter(Boolean)
      .map((player) => ({
        id: player.id,
        name: player.name,
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        speed: player.speed,
        radius: player.radius,
        hp: player.hp,
        maxHp: player.maxHp,
        coins: player.coins,
        appearance: player.appearance,
        inventory: player.inventory,
      })),
    enemies: lobby.enemies
      .filter((enemy) => enemy.respawnAt === 0)
      .map((enemy) => ({
        id: enemy.id,
        x: enemy.x,
        y: enemy.y,
        radius: enemy.radius,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
      })),
  };

  io.to(code).emit("state", payload);
}

function lobbyMessage(code, message) {
  const lobby = getLobby(code);
  if (!lobby) return;
  lobby.messages.unshift(message);
  lobby.messages = lobby.messages.slice(0, 8);
  io.to(code).emit("messages", lobby.messages);
}

function tryMine(player) {
  if (distance(player, MINE_NODE) > MINE_NODE.radius + 26) {
    return "Нужно подойти к залежи в центре карты.";
  }

  const reward = player.miningReward + Math.floor(Math.random() * 4);
  player.coins += reward;
  return `Добыто ${reward} попскойнов.`;
}

function tryBuy(player, item) {
  if (!isInsideTown(player)) {
    return "Покупки доступны только в городе.";
  }

  if (item === "pickaxe") {
    if (player.inventory.pickaxe) return "Кирка уже куплена.";
    if (player.coins < 40) return "Недостаточно попскойнов для кирки.";
    player.coins -= 40;
    player.inventory.pickaxe = true;
    player.miningReward = 12;
    return "Кирка куплена. Добыча усилена.";
  }

  if (item === "sword") {
    if (player.inventory.sword) return "Меч уже куплен.";
    if (player.coins < 55) return "Недостаточно попскойнов для меча.";
    player.coins -= 55;
    player.inventory.sword = true;
    player.damage = 24;
    return "Меч куплен. Урон повышен.";
  }

  return "Неизвестный предмет.";
}

function tryAttack(player, code) {
  if (player.attackCooldown > 0) {
    return;
  }

  const lobby = getLobby(code);
  if (!lobby) return;

  player.attackCooldown = 0.45;

  for (const enemy of lobby.enemies) {
    if (enemy.respawnAt > 0) continue;
    if (distance(player, enemy) <= 70) {
      enemy.hp -= player.damage;
      if (enemy.hp <= 0) {
        enemy.respawnAt = 8;
        enemy.hp = enemy.maxHp;
        const reward = 14 + Math.floor(Math.random() * 8);
        player.coins += reward;
        lobbyMessage(code, `${player.name} победил врага и получил ${reward} попскойнов.`);
      }
      return;
    }
  }
}

function updatePlayers(delta) {
  for (const player of players.values()) {
    if (player.attackCooldown > 0) {
      player.attackCooldown = Math.max(0, player.attackCooldown - delta);
    }
    if (player.interactCooldown > 0) {
      player.interactCooldown = Math.max(0, player.interactCooldown - delta);
    }
    if (Date.now() - player.lastMoveAt > 180) {
      player.vx = 0;
      player.vy = 0;
    }
  }
}

function updateEnemies(delta) {
  for (const lobby of lobbies.values()) {
    for (const enemy of lobby.enemies) {
      if (enemy.respawnAt > 0) {
        enemy.respawnAt = Math.max(0, enemy.respawnAt - delta);
        if (enemy.respawnAt === 0) {
          enemy.x = 900 + Math.random() * 1800;
          enemy.y = 600 + Math.random() * 1200;
        }
        continue;
      }

      let nearestPlayer = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const playerId of lobby.players) {
        const player = players.get(playerId);
        if (!player) continue;
        const d = distance(enemy, player);
        if (d < nearestDistance) {
          nearestDistance = d;
          nearestPlayer = player;
        }
      }

      if (!nearestPlayer) continue;

      if (nearestDistance < 320) {
        const dx = nearestPlayer.x - enemy.x;
        const dy = nearestPlayer.y - enemy.y;
        const mag = Math.max(1, length(dx, dy));
        enemy.x = clamp(enemy.x + (dx / mag) * enemy.speed * delta, 20, MAP.width - 20);
        enemy.y = clamp(enemy.y + (dy / mag) * enemy.speed * delta, 20, MAP.height - 20);
      }

      if (enemy.cooldown > 0) {
        enemy.cooldown = Math.max(0, enemy.cooldown - delta);
      }

      if (nearestDistance < 42 && enemy.cooldown === 0) {
        nearestPlayer.hp -= enemy.damage;
        enemy.cooldown = 1.1;
        if (nearestPlayer.hp <= 0) {
          nearestPlayer.coins = Math.max(0, nearestPlayer.coins - 10);
          respawnPlayer(nearestPlayer);
          lobbyMessage(lobby.code, `${nearestPlayer.name} пал в бою и потерял 10 попскойнов.`);
        }
      }
    }
  }
}

app.use(express.static("public"));

io.on("connection", (socket) => {
  socket.on("player:init", (payload) => {
    if (players.has(socket.id)) {
      const player = players.get(socket.id);
      const profile = sanitizeProfile(payload);
      player.name = profile.name;
      player.appearance = profile.appearance;
      socket.emit("ready", { playerId: socket.id });
      return;
    }

    players.set(socket.id, createPlayer(socket, payload));
    socket.emit("ready", { playerId: socket.id });
  });

  socket.on("player:updateProfile", (payload) => {
    const player = players.get(socket.id);
    if (!player) return;
    const profile = sanitizeProfile(payload);
    player.name = profile.name;
    player.appearance = profile.appearance;

    const code = playerLobby.get(socket.id);
    if (code) {
      emitLobbyState(code);
    }
  });

  socket.on("lobby:create", () => {
    const player = players.get(socket.id);
    if (!player) return;
    const previousCode = playerLobby.get(socket.id);
    const lobby = createLobby(socket.id);
    const result = addPlayerToLobby(socket.id, lobby.code);
    if (!result.ok) return;
    if (previousCode && previousCode !== lobby.code) {
      socket.leave(previousCode);
    }
    socket.join(lobby.code);
    lobbyMessage(lobby.code, `${player.name} создал лобби.`);
    emitLobbyState(lobby.code);
    io.to(lobby.code).emit("messages", lobby.messages);
  });

  socket.on("lobby:join", (rawCode) => {
    const player = players.get(socket.id);
    if (!player) return;
    const code = String(rawCode || "").trim().toUpperCase();
    const previousCode = playerLobby.get(socket.id);
    const result = addPlayerToLobby(socket.id, code);
    if (!result.ok) {
      socket.emit("actionResult", result.message);
      return;
    }
    if (previousCode && previousCode !== code) {
      socket.leave(previousCode);
    }
    socket.join(code);
    lobbyMessage(code, `${player.name} вошёл в лобби.`);
    emitLobbyState(code);
    io.to(code).emit("messages", result.lobby.messages);
  });

  socket.on("player:move", (payload) => {
    const player = players.get(socket.id);
    if (!player) return;

    const nextX = Number(payload?.x);
    const nextY = Number(payload?.y);
    const nextVx = Number(payload?.vx) || 0;
    const nextVy = Number(payload?.vy) || 0;

    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;

    player.x = clamp(nextX, 30, MAP.width - 30);
    player.y = clamp(nextY, 30, MAP.height - 30);
    player.vx = clamp(nextVx, -PLAYER_SPEED, PLAYER_SPEED);
    player.vy = clamp(nextVy, -PLAYER_SPEED, PLAYER_SPEED);
    player.lastMoveAt = Date.now();
  });

  socket.on("player:interact", () => {
    const player = players.get(socket.id);
    const code = playerLobby.get(socket.id);
    if (!player || !code) return;
    if (player.interactCooldown > 0) return;
    player.interactCooldown = 0.35;

    const result = tryMine(player);
    socket.emit("actionResult", result);
    emitLobbyState(code);
  });

  socket.on("player:attack", () => {
    const player = players.get(socket.id);
    const code = playerLobby.get(socket.id);
    if (!player || !code) return;
    tryAttack(player, code);
    emitLobbyState(code);
  });

  socket.on("shop:buy", (item) => {
    const player = players.get(socket.id);
    const code = playerLobby.get(socket.id);
    if (!player || !code) return;
    const result = tryBuy(player, item);
    socket.emit("actionResult", result);
    emitLobbyState(code);
  });

  socket.on("disconnect", () => {
    const code = playerLobby.get(socket.id);
    const player = players.get(socket.id);

    if (code && lobbies.has(code)) {
      const lobby = lobbies.get(code);
      lobby.players.delete(socket.id);
      socket.leave(code);
      if (player) {
        lobbyMessage(code, `${player.name} отключился.`);
      }
      cleanupLobby(lobby);
      emitLobbyState(code);
    }

    playerLobby.delete(socket.id);
    players.delete(socket.id);
  });
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const delta = Math.min(0.033, (now - lastTick) / 1000);
  lastTick = now;
  updatePlayers(delta);
  updateEnemies(delta);
}, SIMULATION_TICK_RATE);

setInterval(() => {
  for (const code of lobbies.keys()) {
    emitLobbyState(code);
  }
}, SNAPSHOT_TICK_RATE);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
