const socket = io();

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const refs = {
  nameInput: document.getElementById("nameInput"),
  bodyColor: document.getElementById("bodyColor"),
  accentColor: document.getElementById("accentColor"),
  eyesColor: document.getElementById("eyesColor"),
  createLobbyBtn: document.getElementById("createLobbyBtn"),
  joinLobbyInput: document.getElementById("joinLobbyInput"),
  joinLobbyBtn: document.getElementById("joinLobbyBtn"),
  copyInviteBtn: document.getElementById("copyInviteBtn"),
  lobbyInfo: document.getElementById("lobbyInfo"),
  hpValue: document.getElementById("hpValue"),
  coinsValue: document.getElementById("coinsValue"),
  playersValue: document.getElementById("playersValue"),
  toast: document.getElementById("toast"),
  messages: document.getElementById("messages"),
};

const state = {
  ready: false,
  selfId: null,
  lobby: null,
  map: { width: 3200, height: 2200 },
  town: { x: 360, y: 360, radius: 260 },
  mineNode: { x: 1600, y: 1100, radius: 88 },
  players: [],
  enemies: [],
  input: {
    up: false,
    down: false,
    left: false,
    right: false,
  },
  camera: { x: 0, y: 0 },
  lastToastAt: 0,
  lastFrameAt: performance.now(),
  lastMoveSentAt: 0,
  lastUrlLobbyCode: new URLSearchParams(window.location.search).get("lobby") || "",
  pendingJoinCode: new URLSearchParams(window.location.search).get("lobby") || "",
  selfRender: null,
  remoteRender: {
    players: new Map(),
    enemies: new Map(),
  },
};

const POSITION_LERP = 0.14;
const CAMERA_LERP = 0.14;
const MOVE_SEND_INTERVAL = 1000 / 24;

function profilePayload() {
  return {
    name: refs.nameInput.value.trim() || "Игрок",
    body: refs.bodyColor.value,
    accent: refs.accentColor.value,
    eyes: refs.eyesColor.value,
  };
}

function sendInit() {
  socket.emit("player:init", profilePayload());
}

function ensureReady(action) {
  if (state.ready) {
    action();
    return;
  }

  sendInit();
  const wait = () => {
    if (state.ready) {
      action();
      return;
    }
    requestAnimationFrame(wait);
  };
  wait();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

function focusGame() {
  canvas.focus({ preventScroll: true });
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.style.opacity = "1";
  state.lastToastAt = performance.now();
}

function selfPlayer() {
  return state.players.find((player) => player.id === state.selfId);
}

function getRemotePlayerRender(player) {
  let render = state.remoteRender.players.get(player.id);
  if (!render) {
    render = { x: player.x, y: player.y, bob: Math.random() * Math.PI * 2 };
    state.remoteRender.players.set(player.id, render);
  }
  return render;
}

function getEnemyRender(enemy) {
  let render = state.remoteRender.enemies.get(enemy.id);
  if (!render) {
    render = { x: enemy.x, y: enemy.y, bob: Math.random() * Math.PI * 2 };
    state.remoteRender.enemies.set(enemy.id, render);
  }
  return render;
}

function pruneRenderState() {
  const playerIds = new Set(state.players.filter((player) => player.id !== state.selfId).map((player) => player.id));
  const enemyIds = new Set(state.enemies.map((enemy) => enemy.id));

  for (const id of state.remoteRender.players.keys()) {
    if (!playerIds.has(id)) {
      state.remoteRender.players.delete(id);
    }
  }

  for (const id of state.remoteRender.enemies.keys()) {
    if (!enemyIds.has(id)) {
      state.remoteRender.enemies.delete(id);
    }
  }
}

function renderMessages(messages = []) {
  refs.messages.innerHTML = "";
  messages.forEach((text) => {
    const node = document.createElement("div");
    node.className = "message";
    node.textContent = text;
    refs.messages.appendChild(node);
  });
}

function updateHud() {
  const self = selfPlayer();
  refs.playersValue.textContent = String(state.players.length);
  refs.coinsValue.textContent = self ? String(self.coins) : "0";
  refs.hpValue.textContent = self ? `${self.hp} / ${self.maxHp}` : "100 / 100";
  refs.lobbyInfo.textContent = state.lobby
    ? `Лобби ${state.lobby.code} · Хост ${state.lobby.hostId === state.selfId ? "ты" : "другой игрок"}`
    : "Сначала создай лобби или войди по коду.";
}

function currentInviteLink() {
  if (!state.lobby?.inviteCode) return "";
  const url = new URL(window.location.href);
  url.searchParams.set("lobby", state.lobby.inviteCode);
  return url.toString();
}

function worldToScreen(x, y) {
  return {
    x: x - state.camera.x,
    y: y - state.camera.y,
  };
}

function updateLocalPlayer(delta) {
  const self = selfPlayer();
  if (!self) return;

  if (!state.selfRender) {
    state.selfRender = { x: self.x, y: self.y, bob: Math.random() * Math.PI * 2 };
  }

  const inputX = Number(state.input.right) - Number(state.input.left);
  const inputY = Number(state.input.down) - Number(state.input.up);
  const magnitude = Math.hypot(inputX, inputY) || 1;

  if (inputX !== 0 || inputY !== 0) {
    self.vx = (inputX / magnitude) * self.speed;
    self.vy = (inputY / magnitude) * self.speed;
  } else {
    self.vx = 0;
    self.vy = 0;
  }

  state.selfRender.x = Math.max(30, Math.min(state.map.width - 30, state.selfRender.x + self.vx * delta));
  state.selfRender.y = Math.max(30, Math.min(state.map.height - 30, state.selfRender.y + self.vy * delta));
  state.selfRender.bob += delta * ((self.vx || self.vy) ? 8 : 3);

  self.x = state.selfRender.x;
  self.y = state.selfRender.y;
}

function updateRemoteEntities(delta) {
  state.players.forEach((player) => {
    if (player.id === state.selfId) return;
    const render = getRemotePlayerRender(player);
    render.x += (player.x - render.x) * POSITION_LERP;
    render.y += (player.y - render.y) * POSITION_LERP;
    render.bob += delta * ((player.vx || player.vy) ? 8 : 3);
  });

  state.enemies.forEach((enemy) => {
    const render = getEnemyRender(enemy);
    render.x += (enemy.x - render.x) * POSITION_LERP;
    render.y += (enemy.y - render.y) * POSITION_LERP;
    render.bob += delta * 7;
  });
}

function sendMovement(force = false) {
  const self = selfPlayer();
  if (!state.ready || !state.selfRender || !self) return;

  const now = performance.now();
  if (!force && now - state.lastMoveSentAt < MOVE_SEND_INTERVAL) return;
  state.lastMoveSentAt = now;

  socket.emit("player:move", {
    x: state.selfRender.x,
    y: state.selfRender.y,
    vx: self.vx || 0,
    vy: self.vy || 0,
  });
}

function updateCamera() {
  if (!state.selfRender) return;

  const targetX = Math.max(
    0,
    Math.min(state.selfRender.x - canvas.clientWidth / 2, state.map.width - canvas.clientWidth),
  );
  const targetY = Math.max(
    0,
    Math.min(state.selfRender.y - canvas.clientHeight / 2, state.map.height - canvas.clientHeight),
  );

  state.camera.x += (targetX - state.camera.x) * CAMERA_LERP;
  state.camera.y += (targetY - state.camera.y) * CAMERA_LERP;
}

function drawBackground() {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
  grad.addColorStop(0, "#f3efe4");
  grad.addColorStop(1, "#dfe7cd");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  const gridSize = 80;
  ctx.strokeStyle = "rgba(24, 33, 38, 0.06)";
  ctx.lineWidth = 1;

  for (let x = -(state.camera.x % gridSize); x < canvas.clientWidth; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.clientHeight);
    ctx.stroke();
  }

  for (let y = -(state.camera.y % gridSize); y < canvas.clientHeight; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.clientWidth, y);
    ctx.stroke();
  }
}

function drawTown() {
  const pos = worldToScreen(state.town.x, state.town.y);
  ctx.fillStyle = "rgba(42, 157, 143, 0.16)";
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, state.town.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2a9d8f";
  ctx.fillRect(pos.x - 80, pos.y - 70, 160, 140);
  ctx.fillStyle = "#fcfbf8";
  ctx.fillRect(pos.x - 52, pos.y - 24, 36, 32);
  ctx.fillRect(pos.x + 16, pos.y - 24, 36, 32);
  ctx.fillStyle = "#182126";
  ctx.fillRect(pos.x - 14, pos.y + 18, 28, 52);

  ctx.fillStyle = "#182126";
  ctx.font = "16px Segoe UI";
  ctx.fillText("Город / Магазин", pos.x - 58, pos.y - 92);
}

function drawMine() {
  const pos = worldToScreen(state.mineNode.x, state.mineNode.y);
  ctx.fillStyle = "#6b705c";
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, state.mineNode.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#3f4238";
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.arc(pos.x - 36 + i * 15, pos.y + ((i % 2) ? 10 : -10), 10, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#182126";
  ctx.fillText("Залежь попскойнов", pos.x - 70, pos.y - 106);
}

function drawEnemy(enemy) {
  const render = getEnemyRender(enemy);
  const pos = worldToScreen(render.x, render.y);
  const bobOffset = Math.sin(render.bob) * 2.4;

  ctx.fillStyle = "#c44536";
  ctx.beginPath();
  ctx.arc(pos.x, pos.y + bobOffset, enemy.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.fillRect(pos.x - 14, pos.y - 7 + bobOffset, 8, 8);
  ctx.fillRect(pos.x + 6, pos.y - 7 + bobOffset, 8, 8);

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(pos.x - 20, pos.y - 32 + bobOffset, 40, 6);
  ctx.fillStyle = "#f4a261";
  ctx.fillRect(pos.x - 20, pos.y - 32 + bobOffset, (enemy.hp / enemy.maxHp) * 40, 6);
}

function drawPlayer(player) {
  const isSelf = player.id === state.selfId;
  const render = isSelf ? state.selfRender : getRemotePlayerRender(player);
  if (!render) return;

  const pos = worldToScreen(render.x, render.y);
  const bobOffset = Math.sin(render.bob) * (isSelf ? 2.2 : 1.6);

  ctx.fillStyle = player.appearance.body;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y + bobOffset, player.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = player.appearance.accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y + bobOffset, player.radius - 2, 0.25, Math.PI - 0.25);
  ctx.stroke();

  ctx.fillStyle = player.appearance.eyes;
  ctx.beginPath();
  ctx.arc(pos.x - 6, pos.y - 3 + bobOffset, 2.5, 0, Math.PI * 2);
  ctx.arc(pos.x + 6, pos.y - 3 + bobOffset, 2.5, 0, Math.PI * 2);
  ctx.fill();

  if (player.inventory.sword) {
    ctx.fillStyle = "#182126";
    ctx.fillRect(pos.x + 16, pos.y - 16 + bobOffset, 5, 24);
  }

  if (player.inventory.pickaxe) {
    ctx.strokeStyle = "#7f5539";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pos.x - 18, pos.y + 14 + bobOffset);
    ctx.lineTo(pos.x - 28, pos.y - 12 + bobOffset);
    ctx.stroke();
  }

  ctx.fillStyle = "#182126";
  ctx.font = "14px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText(player.name, pos.x, pos.y - 30 + bobOffset);

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(pos.x - 22, pos.y - 42 + bobOffset, 44, 6);
  ctx.fillStyle = "#2a9d8f";
  ctx.fillRect(pos.x - 22, pos.y - 42 + bobOffset, (player.hp / player.maxHp) * 44, 6);
  ctx.textAlign = "start";
}

function drawHints() {
  const self = selfPlayer();
  if (!self) return;

  const nearMine = Math.hypot(self.x - state.mineNode.x, self.y - state.mineNode.y) < state.mineNode.radius + 40;
  const inTown = Math.hypot(self.x - state.town.x, self.y - state.town.y) < state.town.radius;

  ctx.fillStyle = "rgba(255, 250, 240, 0.88)";
  ctx.fillRect(18, canvas.clientHeight - 74, 340, 46);
  ctx.fillStyle = "#182126";
  ctx.font = "15px Segoe UI";
  ctx.fillText(
    nearMine
      ? "Нажми E, чтобы добыть попскойны."
      : inTown
        ? "Ты в городе. Кирку и меч можно купить слева."
        : "Иди к центру карты за ресурсами и врагами.",
    32,
    canvas.clientHeight - 44,
  );
}

function render(now = performance.now()) {
  const delta = Math.min(0.033, (now - state.lastFrameAt) / 1000 || 0.016);
  state.lastFrameAt = now;

  updateLocalPlayer(delta);
  updateRemoteEntities(delta);
  updateCamera();
  drawBackground();
  drawTown();
  drawMine();
  state.enemies.forEach(drawEnemy);
  state.players.forEach(drawPlayer);
  drawHints();

  refs.toast.style.opacity = performance.now() - state.lastToastAt > 2200 ? "0" : "1";
  requestAnimationFrame(render);
}

refs.createLobbyBtn.addEventListener("click", () => {
  ensureReady(() => {
    socket.emit("lobby:create");
    focusGame();
  });
});

refs.joinLobbyBtn.addEventListener("click", () => {
  ensureReady(() => {
    socket.emit("lobby:join", refs.joinLobbyInput.value);
    focusGame();
  });
});

refs.copyInviteBtn.addEventListener("click", async () => {
  const inviteLink = currentInviteLink();
  if (!inviteLink) {
    showToast("Сначала войди в лобби.");
    return;
  }
  await navigator.clipboard.writeText(inviteLink);
  showToast("Ссылка приглашения скопирована.");
});

document.querySelectorAll("[data-shop]").forEach((button) => {
  button.addEventListener("click", () => {
    socket.emit("shop:buy", button.dataset.shop);
  });
});

[refs.nameInput, refs.bodyColor, refs.accentColor, refs.eyesColor].forEach((element) => {
  element.addEventListener("input", () => {
    if (!state.ready) return;
    socket.emit("player:updateProfile", profilePayload());
  });
});

window.addEventListener("resize", resizeCanvas);
canvas.addEventListener("pointerdown", focusGame);

window.addEventListener("keydown", (event) => {
  if (document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    return;
  }
  if (event.repeat && event.code !== "Space") return;

  if (event.code === "KeyW") state.input.up = true;
  if (event.code === "KeyS") state.input.down = true;
  if (event.code === "KeyA") state.input.left = true;
  if (event.code === "KeyD") state.input.right = true;
  if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) sendMovement(true);

  if (event.code === "KeyE") {
    socket.emit("player:interact");
  }

  if (event.code === "Space") {
    event.preventDefault();
    socket.emit("player:attack");
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "KeyW") state.input.up = false;
  if (event.code === "KeyS") state.input.down = false;
  if (event.code === "KeyA") state.input.left = false;
  if (event.code === "KeyD") state.input.right = false;
  if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) sendMovement(true);
});

window.addEventListener("blur", () => {
  state.input.up = false;
  state.input.down = false;
  state.input.left = false;
  state.input.right = false;

  const self = selfPlayer();
  if (self) {
    self.vx = 0;
    self.vy = 0;
  }

  sendMovement(true);
});

socket.on("connect", () => {
  showToast("Подключено к серверу.");
  state.ready = false;
  state.selfId = null;
  state.selfRender = null;
  state.lastMoveSentAt = 0;
  if (state.pendingJoinCode) {
    sendInit();
  }
});

socket.on("ready", ({ playerId }) => {
  state.ready = true;
  state.selfId = playerId;
  if (state.pendingJoinCode) {
    refs.joinLobbyInput.value = state.pendingJoinCode.toUpperCase();
    socket.emit("lobby:join", state.pendingJoinCode);
    state.pendingJoinCode = "";
  }
  focusGame();
  showToast("Персонаж готов.");
});

socket.on("state", (payload) => {
  state.lobby = payload.lobby;
  state.map = payload.map;
  state.town = payload.town;
  state.mineNode = payload.mineNode;
  state.players = payload.players;
  state.enemies = payload.enemies;
  pruneRenderState();

  const self = selfPlayer();
  if (self) {
    if (!state.selfRender) {
      state.selfRender = { x: self.x, y: self.y, bob: Math.random() * Math.PI * 2 };
    }
    self.x = state.selfRender.x;
    self.y = state.selfRender.y;
  }

  if (state.lobby?.code && state.lastUrlLobbyCode !== state.lobby.code) {
    const url = new URL(window.location.href);
    url.searchParams.set("lobby", state.lobby.code);
    window.history.replaceState({}, "", url);
    state.lastUrlLobbyCode = state.lobby.code;
  }

  updateHud();
});

socket.on("messages", (messages) => {
  renderMessages(messages);
});

socket.on("actionResult", (message) => {
  showToast(message);
});

resizeCanvas();
render();
