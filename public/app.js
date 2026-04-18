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
  entityRender: {
    players: new Map(),
    enemies: new Map(),
  },
  lastFrameAt: performance.now(),
  lastUrlLobbyCode: new URLSearchParams(window.location.search).get("lobby") || "",
  initSent: false,
  pendingJoinCode: new URLSearchParams(window.location.search).get("lobby") || "",
  selfRender: null,
};

const POSITION_LERP = 0.16;
const CAMERA_LERP = 0.12;
const SELF_CORRECTION_LERP = 0.08;

function sendInit() {
  state.initSent = true;
  socket.emit("player:init", {
    name: refs.nameInput.value.trim() || "Игрок",
    body: refs.bodyColor.value,
    accent: refs.accentColor.value,
    eyes: refs.eyesColor.value,
  });
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

function showToast(message) {
  refs.toast.textContent = message;
  state.lastToastAt = performance.now();
}

function selfPlayer() {
  return state.players.find((player) => player.id === state.selfId);
}

function profilePayload() {
  return {
    name: refs.nameInput.value.trim() || "Игрок",
    body: refs.bodyColor.value,
    accent: refs.accentColor.value,
    eyes: refs.eyesColor.value,
  };
}

function ensureReady(action) {
  if (state.ready) {
    action();
    return;
  }

  sendInit();
  const waitForReady = () => {
    if (state.ready) {
      action();
      return;
    }
    requestAnimationFrame(waitForReady);
  };
  waitForReady();
}

function getRenderPlayer(player) {
  if (player.id === state.selfId && state.selfRender) {
    return state.selfRender;
  }
  let renderPlayer = state.entityRender.players.get(player.id);
  if (!renderPlayer) {
    renderPlayer = { x: player.x, y: player.y, bob: Math.random() * Math.PI * 2 };
    state.entityRender.players.set(player.id, renderPlayer);
  }
  return renderPlayer;
}

function getRenderEnemy(enemy) {
  let renderEnemy = state.entityRender.enemies.get(enemy.id);
  if (!renderEnemy) {
    renderEnemy = { x: enemy.x, y: enemy.y, bob: Math.random() * Math.PI * 2 };
    state.entityRender.enemies.set(enemy.id, renderEnemy);
  }
  return renderEnemy;
}

function pruneRenderState() {
  const playerIds = new Set(state.players.map((player) => player.id));
  const enemyIds = new Set(state.enemies.map((enemy) => enemy.id));

  for (const id of state.entityRender.players.keys()) {
    if (!playerIds.has(id)) {
      state.entityRender.players.delete(id);
    }
  }

  for (const id of state.entityRender.enemies.keys()) {
    if (!enemyIds.has(id)) {
      state.entityRender.enemies.delete(id);
    }
  }
}

function updateRenderState(delta) {
  const inputX = Number(state.input.right) - Number(state.input.left);
  const inputY = Number(state.input.down) - Number(state.input.up);
  const inputMagnitude = Math.hypot(inputX, inputY) || 1;
  const self = selfPlayer();

  if (self) {
    if (!state.selfRender) {
      state.selfRender = { x: self.x, y: self.y, bob: Math.random() * Math.PI * 2 };
    }

    if (inputX !== 0 || inputY !== 0) {
      state.selfRender.x += (inputX / inputMagnitude) * self.speed * delta;
      state.selfRender.y += (inputY / inputMagnitude) * self.speed * delta;
    }

    state.selfRender.x = Math.max(30, Math.min(state.map.width - 30, state.selfRender.x));
    state.selfRender.y = Math.max(30, Math.min(state.map.height - 30, state.selfRender.y));

    const dx = self.x - state.selfRender.x;
    const dy = self.y - state.selfRender.y;
    const serverDistance = Math.hypot(dx, dy);

    if (serverDistance > 140) {
      state.selfRender.x = self.x;
      state.selfRender.y = self.y;
    } else if (serverDistance > 10) {
      state.selfRender.x += dx * SELF_CORRECTION_LERP;
      state.selfRender.y += dy * SELF_CORRECTION_LERP;
    }

    state.selfRender.bob += delta * ((inputX || inputY) ? 8 : 3);
  }

  state.players.forEach((player) => {
    if (player.id === state.selfId) return;

    const renderPlayer = getRenderPlayer(player);
    renderPlayer.x += (player.x - renderPlayer.x) * POSITION_LERP;
    renderPlayer.y += (player.y - renderPlayer.y) * POSITION_LERP;
    renderPlayer.bob += delta * ((player.vx || player.vy) ? 8 : 3);
  });

  state.enemies.forEach((enemy) => {
    const renderEnemy = getRenderEnemy(enemy);
    renderEnemy.x += (enemy.x - renderEnemy.x) * POSITION_LERP;
    renderEnemy.y += (enemy.y - renderEnemy.y) * POSITION_LERP;
    renderEnemy.bob += delta * 7;
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

function renderMessages(messages = []) {
  refs.messages.innerHTML = "";
  messages.forEach((text) => {
    const node = document.createElement("div");
    node.className = "message";
    node.textContent = text;
    refs.messages.appendChild(node);
  });
}

function sendInput() {
  socket.emit("player:input", state.input);
}

function worldToScreen(x, y) {
  return {
    x: x - state.camera.x,
    y: y - state.camera.y,
  };
}

function updateCamera() {
  const self = selfPlayer();
  if (!self) return;
  const selfRender = getRenderPlayer(self);
  const targetX = Math.max(
    0,
    Math.min(selfRender.x - canvas.clientWidth / 2, state.map.width - canvas.clientWidth),
  );
  const targetY = Math.max(
    0,
    Math.min(selfRender.y - canvas.clientHeight / 2, state.map.height - canvas.clientHeight),
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
  const renderEnemy = getRenderEnemy(enemy);
  const pos = worldToScreen(renderEnemy.x, renderEnemy.y);
  const bobOffset = Math.sin(renderEnemy.bob) * 2.4;
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
  const renderPlayer = getRenderPlayer(player);
  const pos = worldToScreen(renderPlayer.x, renderPlayer.y);
  const self = player.id === state.selfId;
  const bobOffset = Math.sin(renderPlayer.bob) * (self ? 2.2 : 1.6);

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

  const nearMine =
    Math.hypot(self.x - state.mineNode.x, self.y - state.mineNode.y) < state.mineNode.radius + 40;
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
  updateRenderState(delta);
  updateCamera();
  drawBackground();
  drawTown();
  drawMine();
  state.enemies.forEach(drawEnemy);
  state.players.forEach(drawPlayer);
  drawHints();

  if (performance.now() - state.lastToastAt > 2200) {
    refs.toast.style.opacity = "0";
  } else {
    refs.toast.style.opacity = "1";
  }

  requestAnimationFrame(render);
}

refs.createLobbyBtn.addEventListener("click", () => {
  ensureReady(() => {
    socket.emit("lobby:create");
  });
});

refs.joinLobbyBtn.addEventListener("click", () => {
  ensureReady(() => {
    socket.emit("lobby:join", refs.joinLobbyInput.value);
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

window.addEventListener("keydown", (event) => {
  if (["INPUT"].includes(document.activeElement.tagName)) return;
  if (event.repeat && event.code !== "Space") return;

  if (event.code === "KeyW") state.input.up = true;
  if (event.code === "KeyS") state.input.down = true;
  if (event.code === "KeyA") state.input.left = true;
  if (event.code === "KeyD") state.input.right = true;
  if (event.code.startsWith("Key")) sendInput();

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
  if (event.code.startsWith("Key")) sendInput();
});

window.addEventListener("blur", () => {
  state.input.up = false;
  state.input.down = false;
  state.input.left = false;
  state.input.right = false;
  if (state.ready) {
    sendInput();
  }
});

socket.on("connect", () => {
  showToast("Подключено к серверу.");
  state.ready = false;
  state.initSent = false;
  state.selfId = null;
  state.selfRender = null;
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
  if (self && !state.selfRender) {
    state.selfRender = { x: self.x, y: self.y, bob: Math.random() * Math.PI * 2 };
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
