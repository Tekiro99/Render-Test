(() => {
  "use strict";

  const socket = io({ transports: ["websocket"] });

  const S = {
    connected: false,
    self: null,
    selfId: null,
    cls: "warrior",
    appearance: { body: "#f3e6c4", accent: "#2a9d8f", eyes: "#1d3557" },
    name: "Герой",
    lobbyCode: null,
    lobbyName: null,
    static: null,
    classes: null,
    items: null,
    shop: null,
    inLobby: false,

    snapshots: [],
    interpDelay: 100,

    pos: { x: 500, y: 500 },
    vel: { x: 0, y: 0 },

    keys: {},
    mouse: { x: 0, y: 0, down: false },
    facingAngle: 0,
    lastInputSent: 0,

    camera: { x: 0, y: 0, shake: 0 },
    particles: [],
    damageTexts: [],
    zone: "",

    chatActive: false,
    inventoryOpen: false,
    shopOpen: false,
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const KEY_CODE_MAP = {
    KeyW: "move_up",
    KeyA: "move_left",
    KeyS: "move_down",
    KeyD: "move_right",
    ArrowUp: "move_up",
    ArrowLeft: "move_left",
    ArrowDown: "move_down",
    ArrowRight: "move_right",
    KeyQ: "ability",
    KeyE: "interact",
    KeyI: "inventory",
    KeyB: "shop",
    KeyH: "help",
    Space: "attack",
    ShiftLeft: "sprint",
    ShiftRight: "sprint",
  };
  const KEY_FALLBACK_MAP = {
    w: "move_up",
    ц: "move_up",
    a: "move_left",
    ф: "move_left",
    s: "move_down",
    ы: "move_down",
    d: "move_right",
    в: "move_right",
    arrowup: "move_up",
    arrowleft: "move_left",
    arrowdown: "move_down",
    arrowright: "move_right",
    q: "ability",
    й: "ability",
    e: "interact",
    у: "interact",
    i: "inventory",
    ш: "inventory",
    b: "shop",
    и: "shop",
    h: "help",
    р: "help",
    " ": "attack",
    shift: "sprint",
  };

  function showScreen(id) {
    $$(".screen").forEach((e) => e.classList.remove("active"));
    $("#" + id).classList.add("active");
  }

  function toast(text) {
    if (!text) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    const area = $("#toastArea");
    if (!area) return;
    area.appendChild(el);
    setTimeout(() => el.classList.add("fade"), 2200);
    setTimeout(() => el.remove(), 2800);
  }

  const CLASS_META = {
    warrior: { glyph: "⚔️", name: "Воин", desc: "Крепкий боец: высокое HP, мощная ближняя атака. Способность — удар щитом по области." },
    mage: { glyph: "🔮", name: "Маг", desc: "Дистанция: фаерболы в сторону курсора. Способность — Ледяной взрыв, замораживает врагов." },
    rogue: { glyph: "🗡️", name: "Плут", desc: "Скорость: быстрое передвижение и быстрые атаки. Способность — Рывок с уроном по траектории." },
  };

  function renderClassTiles() {
    const grid = $("#classGrid");
    grid.innerHTML = "";
    for (const key of Object.keys(CLASS_META)) {
      const meta = CLASS_META[key];
      const tile = document.createElement("div");
      tile.className = "class-tile" + (key === S.cls ? " active" : "");
      tile.dataset.cls = key;
      tile.innerHTML = `<span class="glyph">${meta.glyph}</span><span class="cname">${meta.name}</span>`;
      tile.addEventListener("click", () => selectClass(key));
      grid.appendChild(tile);
    }
    updateClassDetails();
  }
  function updateClassDetails() {
    $("#classDetails").textContent = CLASS_META[S.cls].desc;
    $$("#classGrid .class-tile").forEach((t) => t.classList.toggle("active", t.dataset.cls === S.cls));
  }
  function selectClass(k) { S.cls = k; updateClassDetails(); sendProfile(); }

  function sendProfile() {
    S.name = $("#nameInput").value.trim() || "Герой";
    S.appearance = { body: $("#bodyColor").value, accent: $("#accentColor").value, eyes: $("#eyesColor").value };
    socket.emit("player:init", {
      name: S.name, cls: S.cls,
      body: S.appearance.body, accent: S.appearance.accent, eyes: S.appearance.eyes,
    });
  }
  function refreshLobbies() { socket.emit("lobby:list"); }

  function renderLobbyList(list) {
    const wrap = $("#lobbyList");
    wrap.innerHTML = "";
    if (!list.length) {
      wrap.innerHTML = '<div class="muted tiny" style="padding:8px;text-align:center">Нет активных лобби — создай своё</div>';
      return;
    }
    for (const l of list) {
      const row = document.createElement("div");
      row.className = "lobby-row";
      row.innerHTML = `<span><span class="code">${l.code}</span>  ${escapeHtml(l.name)}</span><span class="players-count">👥 ${l.players}</span>`;
      row.addEventListener("click", () => { sendProfile(); setTimeout(() => socket.emit("lobby:join", l.code), 40); });
      wrap.appendChild(row);
    }
  }
  function escapeHtml(s) { return String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c])); }

  // ========= canvas =========
  const canvas = $("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const mini = $("#minimap");
  const mctx = mini.getContext("2d");

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);

  // ========= input =========
  function getInputKey(e) {
    const key = typeof e.key === "string" ? e.key.toLowerCase() : "";
    return KEY_CODE_MAP[e.code] || KEY_FALLBACK_MAP[key] || key;
  }

  window.addEventListener("keydown", (e) => {
    if (S.chatActive) {
      if (e.key === "Enter") {
        const v = $("#chatInput").value.trim();
        if (v) socket.emit("chat:send", v);
        $("#chatInput").value = "";
        toggleChat(false);
      } else if (e.key === "Escape") toggleChat(false);
      return;
    }
    const inputKey = getInputKey(e);
    S.keys[inputKey] = true;
    if (e.key === "Enter") { toggleChat(true); e.preventDefault(); return; }
    if (!S.inLobby) return;
    if (inputKey === "interact") socket.emit("player:interact");
    if (inputKey === "attack") { e.preventDefault(); doAttack(); }
    if (inputKey === "ability") doAbility();
    if (inputKey === "inventory") togglePanel("inv");
    if (inputKey === "shop") togglePanel("shop");
    if (inputKey === "help") $("#helpOverlay").classList.toggle("hidden");
    if (/^[1-4]$/.test(e.key)) socket.emit("inventory:use", parseInt(e.key, 10) - 1);
    if (e.key === "Escape") $("#helpOverlay").classList.add("hidden");
  });
  window.addEventListener("keyup", (e) => { S.keys[getInputKey(e)] = false; });

  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    S.mouse.x = e.clientX - r.left;
    S.mouse.y = e.clientY - r.top;
  });
  canvas.addEventListener("mousedown", (e) => {
    if (!S.inLobby) return;
    if (e.button === 0) { S.mouse.down = true; doAttack(); }
    else if (e.button === 2) doAbility();
  });
  canvas.addEventListener("mouseup", () => { S.mouse.down = false; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  function getAim() {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const dx = S.mouse.x - cx, dy = S.mouse.y - cy;
    const m = Math.hypot(dx, dy);
    const deadzone = Math.max(1, S.self?.radius || findSelfInSnapshot()?.radius || 20);
    const facing = getFacingAngle();
    if (m <= deadzone) return { x: Math.cos(facing), y: Math.sin(facing) };
    S.facingAngle = Math.atan2(dy, dx);
    return { x: dx / m, y: dy / m };
  }
  function getFacingAngle() {
    if (Number.isFinite(S.facingAngle)) return S.facingAngle;
    const selfSnap = findSelfInSnapshot();
    if (selfSnap && Number.isFinite(selfSnap.facing)) {
      S.facingAngle = selfSnap.facing;
      return selfSnap.facing;
    }
    return S.facingAngle;
  }
  function doAttack() { if (S.inLobby) socket.emit("player:attack", getAim()); }
  function doAbility() { if (S.inLobby) socket.emit("player:ability", getAim()); }

  function toggleChat(on) {
    S.chatActive = on;
    $(".chat-input-row").classList.toggle("active", on);
    if (on) $("#chatInput").focus(); else $("#chatInput").blur();
  }
  function togglePanel(which) {
    if (which === "inv") { S.inventoryOpen = !S.inventoryOpen; $("#invPanel").classList.toggle("open", S.inventoryOpen); }
    if (which === "shop") { S.shopOpen = !S.shopOpen; $("#shopPanel").classList.toggle("open", S.shopOpen); }
  }

  // ========= socket =========
  socket.on("connect", () => {
    S.connected = true;
    $("#connStatus").classList.add("ok"); $("#connStatus").classList.remove("err");
    $("#connLabel").textContent = "Подключено";
    sendProfile();
    refreshLobbies();
  });
  socket.on("disconnect", () => {
    S.connected = false;
    $("#connStatus").classList.remove("ok"); $("#connStatus").classList.add("err");
    $("#connLabel").textContent = "Разрыв соединения";
  });
  socket.on("ready", (p) => { S.selfId = p.id; if (p.cls) { S.cls = p.cls; updateClassDetails(); } });
  socket.on("static", (data) => {
    S.static = data; S.classes = data.classes; S.items = data.items; S.shop = data.shop;
    buildShop();
  });
  socket.on("lobby:list", renderLobbyList);
  socket.on("lobby:joined", (data) => {
    S.lobbyCode = data.code; S.lobbyName = data.name; S.inLobby = true;
    $("#lobbyChip").textContent = data.code;
    showScreen("game"); resizeCanvas(); canvas.focus();
    toast(`Вошёл в ${data.code}`);
  });
  socket.on("lobby:left", () => { S.inLobby = false; S.lobbyCode = null; showScreen("menu"); refreshLobbies(); });
  socket.on("snapshot", (snap) => {
    snap.recvAt = performance.now();
    S.snapshots.push(snap);
    if (S.snapshots.length > 30) S.snapshots.shift();
    for (const e of snap.effects) ingestEffect(e);
    // initialize pos once from server
    if (!S._posInit) {
      const me = snap.players.find((p) => p.id === S.selfId);
      if (me) { S.pos.x = me.x; S.pos.y = me.y; S.facingAngle = me.facing || 0; S._posInit = true; }
    }
  });
  socket.on("self", (self) => { S.self = self; });
  socket.on("chat", (msg) => addChatLine(msg));
  socket.on("chat:history", (msgs) => {
    $("#chatLog").innerHTML = "";
    msgs.slice().reverse().forEach(addChatLine);
  });
  socket.on("actionResult", toast);

  function addChatLine(msg) {
    const log = $("#chatLog");
    const line = document.createElement("div");
    line.textContent = msg.text;
    log.prepend(line);
    while (log.children.length > 30) log.lastChild.remove();
  }

  // ========= effects =========
  const seenEffects = new Set();
  function ingestEffect(e) {
    const key = (e.id || 0) + ":" + e.type + ":" + (e.t || 0).toFixed(2);
    if (seenEffects.has(key)) return;
    seenEffects.add(key);
    if (seenEffects.size > 600) seenEffects.clear();

    if (e.type === "damage") {
      S.damageTexts.push({ x: e.x, y: e.y, vy: -40, t: 0, life: 0.9, text: "-" + e.amount, color: "#ff9070" });
    } else if (e.type === "hit") { burst(e.x, e.y, 10, "#ff5772"); S.camera.shake = Math.max(S.camera.shake, 4); }
    else if (e.type === "explosion") { burst(e.x, e.y, 26, "#ff9040"); S.camera.shake = Math.max(S.camera.shake, 6); }
    else if (e.type === "death") burst(e.x, e.y, 30, "#ffffff");
    else if (e.type === "mine") burst(e.x, e.y, 14, "#ffd166");
    else if (e.type === "levelup") { for (let i = 0; i < 40; i++) S.particles.push(makeSpark(e.x, e.y, "#ffcf6b", 1.2)); }
    else if (e.type === "frost_nova") burst(e.x, e.y, 40, "#8fd9ff");
    else if (e.type === "shield_bash") { burst(e.x, e.y, 28, "#ffd166"); S.camera.shake = Math.max(S.camera.shake, 6); }
    else if (e.type === "dash") { for (let i = 0; i < 14; i++) { const t = i / 14; S.particles.push(makeSpark(e.x1 + (e.x2 - e.x1) * t, e.y1 + (e.y2 - e.y1) * t, "#b7f5ff", 0.4)); } }
    else if (e.type === "cast") burst(e.x, e.y, 8, e.color || "#ff7847");
  }
  function burst(x, y, n, color) { for (let i = 0; i < n; i++) S.particles.push(makeSpark(x, y, color, 0.6)); }
  function makeSpark(x, y, color, life) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 180;
    return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, maxLife: life, color, size: 2 + Math.random() * 3 };
  }

  // ========= local step =========
  let lastUpdate = performance.now();
  function localStep() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastUpdate) / 1000);
    lastUpdate = now;

    if (S.inLobby && S.self) {
      const baseSpeed = S.self.speed || 220;
      const speed = S.keys.sprint ? baseSpeed * 1.55 : baseSpeed;
      let ix = 0, iy = 0;
      if (S.keys.move_up) iy -= 1;
      if (S.keys.move_down) iy += 1;
      if (S.keys.move_left) ix -= 1;
      if (S.keys.move_right) ix += 1;
      const m = Math.hypot(ix, iy);
      if (m > 0) { ix /= m; iy /= m; }
      S.vel.x = ix * speed; S.vel.y = iy * speed;
      S.pos.x += S.vel.x * dt; S.pos.y += S.vel.y * dt;
      if (S.static && S.static.map) {
        S.pos.x = Math.max(30, Math.min(S.static.map.width - 30, S.pos.x));
        S.pos.y = Math.max(30, Math.min(S.static.map.height - 30, S.pos.y));
      }
      // reconcile
      const server = findSelfInSnapshot();
      if (server) {
        const ex = server.x - S.pos.x, ey = server.y - S.pos.y;
        if (Math.hypot(ex, ey) > 120) { S.pos.x = server.x; S.pos.y = server.y; }
        else { S.pos.x += ex * 0.12; S.pos.y += ey * 0.12; }
      }
      if (now - S.lastInputSent > 45) {
        const aim = getAim();
        S.facingAngle = Math.atan2(aim.y, aim.x);
        socket.emit("player:input", { x: S.pos.x, y: S.pos.y, vx: S.vel.x, vy: S.vel.y, facing: S.facingAngle });
        S.lastInputSent = now;
      }
    }

    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
      if (p.life <= 0) S.particles.splice(i, 1);
    }
    for (let i = S.damageTexts.length - 1; i >= 0; i--) {
      const d = S.damageTexts[i];
      d.t += dt; d.y += d.vy * dt; d.vy += 30 * dt;
      if (d.t >= d.life) S.damageTexts.splice(i, 1);
    }
    if (S.camera.shake > 0) S.camera.shake = Math.max(0, S.camera.shake - dt * 40);
  }
  function findSelfInSnapshot() {
    const last = S.snapshots[S.snapshots.length - 1];
    if (!last) return null;
    return last.players.find((p) => p.id === S.selfId) || null;
  }

  // ========= interpolation =========
  function getInterpolated() {
    if (S.snapshots.length === 0) return null;
    if (S.snapshots.length === 1) return { state: S.snapshots[0], prev: S.snapshots[0], alpha: 1 };
    const renderTime = performance.now() - S.interpDelay;
    let a = S.snapshots[0], b = S.snapshots[1];
    for (let i = S.snapshots.length - 2; i >= 0; i--) {
      if (S.snapshots[i].recvAt <= renderTime) { a = S.snapshots[i]; b = S.snapshots[i + 1]; break; }
    }
    const range = Math.max(1, b.recvAt - a.recvAt);
    const alpha = Math.max(0, Math.min(1, (renderTime - a.recvAt) / range));
    return { state: b, prev: a, alpha };
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  function updateCameraTarget() {
    const sx = (Math.random() - 0.5) * S.camera.shake;
    const sy = (Math.random() - 0.5) * S.camera.shake;
    S.camera.x = S.pos.x - window.innerWidth / 2 + sx;
    S.camera.y = S.pos.y - window.innerHeight / 2 + sy;
    if (S.static && S.static.map) {
      const mw = S.static.map.width - window.innerWidth, mh = S.static.map.height - window.innerHeight;
      S.camera.x = Math.max(0, Math.min(Math.max(0, mw), S.camera.x));
      S.camera.y = Math.max(0, Math.min(Math.max(0, mh), S.camera.y));
    }
  }

  // ========= drawing =========
  function drawBackground() {
    const map = S.static && S.static.map;
    if (!map) return;
    const w = window.innerWidth, h = window.innerHeight;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0d1628"); grad.addColorStop(1, "#050910");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(-S.camera.x, -S.camera.y);

    const tile = 80;
    const x0 = Math.floor(S.camera.x / tile) * tile;
    const y0 = Math.floor(S.camera.y / tile) * tile;
    ctx.fillStyle = "rgba(60,80,90,0.15)";
    for (let y = y0; y < S.camera.y + h + tile; y += tile) {
      for (let x = x0; x < S.camera.x + w + tile; x += tile) {
        ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.strokeStyle = "rgba(120,140,200,0.18)"; ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, map.width, map.height);

    const town = S.static.town;
    const tg = ctx.createRadialGradient(town.x, town.y, 20, town.x, town.y, town.radius);
    tg.addColorStop(0, "rgba(255, 207, 107, 0.22)"); tg.addColorStop(1, "rgba(255, 207, 107, 0.0)");
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.arc(town.x, town.y, town.radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,207,107,0.4)"; ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(town.x, town.y, town.radius, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    drawTownDecor(town);

    for (const m of S.static.mines || []) drawMine(m);

    const ba = S.static.bossArena;
    if (ba) {
      const bg = ctx.createRadialGradient(ba.x, ba.y, 20, ba.x, ba.y, ba.radius);
      bg.addColorStop(0, "rgba(255,70,100,0.18)"); bg.addColorStop(1, "rgba(255,70,100,0)");
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(ba.x, ba.y, ba.radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,70,100,0.4)"; ctx.setLineDash([4, 10]);
      ctx.beginPath(); ctx.arc(ba.x, ba.y, ba.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
  function drawTownDecor(town) {
    const positions = [
      { x: -120, y: -50, w: 70, h: 60, c: "#6b4a2a" },
      { x: 80, y: -100, w: 80, h: 70, c: "#5a3a22" },
      { x: -50, y: 100, w: 90, h: 70, c: "#7a5530" },
      { x: 100, y: 80, w: 60, h: 55, c: "#4a3020" },
    ];
    for (const h of positions) {
      const bx = town.x + h.x, by = town.y + h.y;
      ctx.fillStyle = h.c;
      ctx.fillRect(bx - h.w / 2, by - h.h / 2, h.w, h.h);
      ctx.fillStyle = "#4a1a15";
      ctx.beginPath();
      ctx.moveTo(bx - h.w / 2 - 6, by - h.h / 2);
      ctx.lineTo(bx, by - h.h / 2 - 22);
      ctx.lineTo(bx + h.w / 2 + 6, by - h.h / 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffcf6b";
      ctx.fillRect(bx - 6, by - 4, 12, 10);
    }
    ctx.fillStyle = "#3a5470";
    ctx.beginPath(); ctx.arc(town.x, town.y, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#6ac0ff";
    ctx.beginPath(); ctx.arc(town.x, town.y, 16, 0, Math.PI * 2); ctx.fill();
  }
  function drawMine(m) {
    const t = performance.now() / 1000;
    const col = m.type === "gold" ? "#ffd166" : m.type === "crystal" ? "#b084ff" : "#a8b3c0";
    const glow = ctx.createRadialGradient(m.x, m.y, 4, m.x, m.y, m.radius);
    glow.addColorStop(0, col + "88"); glow.addColorStop(1, col + "00");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2); ctx.fill();
    const pulse = 1 + Math.sin(t * 2) * 0.06;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + t * 0.2;
      const rx = m.x + Math.cos(a) * 22, ry = m.y + Math.sin(a) * 22;
      ctx.save(); ctx.translate(rx, ry); ctx.rotate(a); ctx.scale(pulse, pulse);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(7, 0); ctx.lineTo(0, 14); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function drawPlayer(p, isSelf, t) {
    const moving = Math.hypot(p.vx || 0, p.vy || 0) > 10;
    const bob = moving ? Math.sin(t * 10) * 2 : 0;
    const meta = CLASS_META[p.cls] || CLASS_META.warrior;
    const app = p.appearance || { body: "#f3e6c4", accent: "#2a9d8f", eyes: "#1d3557" };
    const facing = p.facing || 0;
    const r = 18;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(p.x, p.y + r, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(p.x, p.y - r * 0.2 + bob);
    ctx.fillStyle = app.accent;
    ctx.beginPath(); ctx.ellipse(0, 2, r * 0.95, r * 1.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = app.body;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.font = "16px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.9; ctx.fillText(meta.glyph, 0, -1);
    ctx.restore();

    const ex = Math.cos(facing) * 4, ey = Math.sin(facing) * 4;
    ctx.fillStyle = app.eyes;
    ctx.beginPath(); ctx.arc(-4 + ex, -3 + ey, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4 + ex, -3 + ey, 2, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.rotate(facing);
    if (p.cls === "warrior") {
      ctx.fillStyle = "#d0d4de"; ctx.fillRect(r * 0.7, -2, 20, 4);
      ctx.fillStyle = "#8a6a3a"; ctx.fillRect(r * 0.55, -3, 6, 6);
    } else if (p.cls === "mage") {
      ctx.strokeStyle = "#a78356"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(r * 0.4, 0); ctx.lineTo(r * 1.4, 0); ctx.stroke();
      ctx.fillStyle = "#ff8050";
      ctx.beginPath(); ctx.arc(r * 1.5, 0, 4, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = "#c0c4d0";
      ctx.fillRect(r * 0.6, -4, 12, 3); ctx.fillRect(r * 0.6, 1, 12, 3);
    }
    ctx.restore();
    ctx.restore();

    const bw = 46, bh = 6;
    const pct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const barX = p.x - bw / 2;
    const barY = p.y - r - 19;
    ctx.fillStyle = "rgba(5,10,18,0.82)";
    ctx.fillRect(barX, barY, bw, bh);
    const hpGrad = ctx.createLinearGradient(barX, barY, barX + bw, barY);
    hpGrad.addColorStop(0, pct > 0.4 ? "#4fe37b" : pct > 0.2 ? "#ffb347" : "#ff6b6b");
    hpGrad.addColorStop(1, pct > 0.4 ? "#c7ff72" : pct > 0.2 ? "#ffd166" : "#ff8f70");
    ctx.fillStyle = hpGrad;
    ctx.fillRect(barX, barY, bw * pct, bh);
    ctx.strokeStyle = isSelf ? "rgba(255,207,107,0.85)" : "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX - 0.5, barY - 0.5, bw + 1, bh + 1);

    ctx.font = "11px Inter, sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = isSelf ? "#ffcf6b" : "#e6e9f2";
    ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 3;
    const label = `${p.name} · ${p.level}`;
    ctx.strokeText(label, p.x, p.y - r - 22);
    ctx.fillText(label, p.x, p.y - r - 22);

    if (isSelf) {
      ctx.strokeStyle = "rgba(255,207,107,0.6)"; ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawMob(m, t) {
    const r = m.radius;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(m.x, m.y + r, r * 0.9, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    const bob = Math.sin(t * 5 + (m.id || 0)) * 2;
    ctx.save();
    ctx.translate(m.x, m.y + bob);
    if (m.boss) {
      const glow = ctx.createRadialGradient(0, 0, 10, 0, 0, r + 24);
      glow.addColorStop(0, "rgba(255,70,100,0.4)"); glow.addColorStop(1, "rgba(255,70,100,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, r + 24, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = m.frozen ? "#8fd9ff" : m.color;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.35, r * 0.35, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1a0a18";
    ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.1, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.1, 3, 0, Math.PI * 2); ctx.fill();
    if (m.boss) {
      ctx.fillStyle = "#220";
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.7); ctx.lineTo(-r * 0.2, -r); ctx.lineTo(-r * 0.1, -r * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 0.5, -r * 0.7); ctx.lineTo(r * 0.2, -r); ctx.lineTo(r * 0.1, -r * 0.5);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    const bw = Math.max(32, r * 2), bh = 4;
    const pct = Math.max(0, Math.min(1, m.hp / m.maxHp));
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(m.x - bw / 2, m.y - r - 12, bw, bh);
    ctx.fillStyle = m.boss ? "#ff5772" : "#ff8c6b"; ctx.fillRect(m.x - bw / 2, m.y - r - 12, bw * pct, bh);
    if (m.boss) {
      ctx.font = "bold 12px Inter"; ctx.textAlign = "center";
      ctx.fillStyle = "#ff5772"; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.lineWidth = 3;
      ctx.strokeText(m.name, m.x, m.y - r - 18); ctx.fillText(m.name, m.x, m.y - r - 18);
    }
  }

  function drawProjectile(p) {
    const glow = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.radius + 14);
    glow.addColorStop(0, "rgba(255,230,120,0.95)"); glow.addColorStop(0.5, "rgba(255,120,60,0.5)"); glow.addColorStop(1, "rgba(255,60,20,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffe0a0";
    ctx.beginPath(); ctx.arc(p.x, p.y, p.radius * 0.6, 0, Math.PI * 2); ctx.fill();
    if (Math.random() < 0.7) {
      S.particles.push({
        x: p.x, y: p.y,
        vx: -p.vx * 0.1 + (Math.random() - 0.5) * 30,
        vy: -p.vy * 0.1 + (Math.random() - 0.5) * 30,
        life: 0.4, maxLife: 0.4, color: "#ff9040", size: 3 + Math.random() * 2,
      });
    }
  }

  function drawPickup(pk, t) {
    const wobble = Math.sin(t * 4 + (pk.id || 0)) * 3;
    if (pk.kind === "coin") {
      ctx.fillStyle = "rgba(255,207,107,0.3)";
      ctx.beginPath(); ctx.arc(pk.x, pk.y + wobble, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffcf6b";
      ctx.beginPath(); ctx.arc(pk.x, pk.y + wobble, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8f6118"; ctx.font = "bold 9px Inter"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("$", pk.x, pk.y + wobble + 1);
    } else {
      const item = S.items && S.items[pk.key];
      ctx.fillStyle = "rgba(138,205,255,0.3)";
      ctx.beginPath(); ctx.arc(pk.x, pk.y + wobble, 14, 0, Math.PI * 2); ctx.fill();
      ctx.font = "18px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText((item && item.icon) || "?", pk.x, pk.y + wobble);
    }
  }

  function drawEffects(snap) {
    for (const e of snap.effects || []) {
      const p = Math.min(1, e.t / e.duration);
      if (e.type === "swing") {
        ctx.save();
        ctx.translate(e.x, e.y); ctx.rotate(e.angle);
        ctx.fillStyle = `rgba(255,230,120,${0.22 * (1 - p)})`;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.arc(0, 0, e.range, -Math.PI / 2.3, Math.PI / 2.3);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = `rgba(255,240,170,${0.8 * (1 - p)})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, e.range * (0.7 + 0.3 * p), -Math.PI / 2.3 + p * 0.2, Math.PI / 2.3 - p * 0.2);
        ctx.stroke();
        ctx.restore();
      } else if (e.type === "shield_bash") {
        ctx.strokeStyle = `rgba(255,207,107,${1 - p})`; ctx.lineWidth = 6 * (1 - p * 0.5);
        ctx.beginPath(); ctx.arc(e.x, e.y, e.radius * (0.5 + p * 0.6), 0, Math.PI * 2); ctx.stroke();
      } else if (e.type === "frost_nova") {
        ctx.strokeStyle = `rgba(140,215,255,${1 - p})`; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.radius * p, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(140,215,255,${0.2 * (1 - p)})`;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.radius * p, 0, Math.PI * 2); ctx.fill();
      } else if (e.type === "dash") {
        ctx.strokeStyle = `rgba(183,245,255,${1 - p})`; ctx.lineWidth = 6 * (1 - p);
        ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
      } else if (e.type === "levelup") {
        ctx.strokeStyle = `rgba(255,207,107,${1 - p})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(e.x, e.y, 10 + p * 80, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  function drawParticles() {
    for (const p of S.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color; ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawDamageTexts() {
    ctx.font = "bold 16px Inter"; ctx.textAlign = "center";
    for (const d of S.damageTexts) {
      const a = 1 - d.t / d.life;
      ctx.globalAlpha = a;
      ctx.strokeStyle = "rgba(0,0,0,0.9)"; ctx.lineWidth = 3;
      ctx.strokeText(d.text, d.x, d.y);
      ctx.fillStyle = d.color; ctx.fillText(d.text, d.x, d.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawMinimap() {
    const map = S.static && S.static.map;
    if (!map) return;
    const W = mini.width, H = mini.height;
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = "rgba(14,20,36,0.9)"; mctx.fillRect(0, 0, W, H);
    const sx = W / map.width, sy = H / map.height;
    const t = S.static.town;
    mctx.fillStyle = "rgba(255,207,107,0.4)";
    mctx.beginPath(); mctx.arc(t.x * sx, t.y * sy, t.radius * sx, 0, Math.PI * 2); mctx.fill();
    for (const m of S.static.mines || []) {
      mctx.fillStyle = "rgba(138,205,255,0.6)";
      mctx.beginPath(); mctx.arc(m.x * sx, m.y * sy, 2.5, 0, Math.PI * 2); mctx.fill();
    }
    const b = S.static.bossArena;
    if (b) {
      mctx.fillStyle = "rgba(255,70,100,0.6)";
      mctx.beginPath(); mctx.arc(b.x * sx, b.y * sy, 3, 0, Math.PI * 2); mctx.fill();
    }
    const snap = S.snapshots[S.snapshots.length - 1];
    if (snap) {
      for (const mob of snap.mobs) {
        mctx.fillStyle = mob.boss ? "#ff5772" : "rgba(255,180,100,0.7)";
        mctx.fillRect(mob.x * sx - 1.5, mob.y * sy - 1.5, 3, 3);
      }
      for (const p of snap.players) {
        mctx.fillStyle = p.id === S.selfId ? "#ffcf6b" : "#6ac0ff";
        mctx.beginPath(); mctx.arc(p.x * sx, p.y * sy, 3, 0, Math.PI * 2); mctx.fill();
      }
    }
    mctx.strokeStyle = "rgba(255,255,255,0.3)";
    mctx.strokeRect(S.camera.x * sx, S.camera.y * sy, window.innerWidth * sx, window.innerHeight * sy);
  }

  // ========= HUD =========
  function updateHud() {
    const self = S.self;
    if (!self) return;
    $("#heroName").textContent = S.name;
    $("#heroLvl").textContent = "Lv " + self.level;
    const hpPct = (self.hp / self.maxHp) * 100;
    $("#hpFill").style.width = hpPct + "%";
    $("#hpText").textContent = `${Math.round(self.hp)}/${self.maxHp}`;
    const xpPct = (self.xp / self.xpNeeded) * 100;
    $("#xpFill").style.width = xpPct + "%";
    $("#xpText").textContent = `${self.xp}/${self.xpNeeded}`;
    $("#coinsVal").textContent = `${Math.round(self.coins).toLocaleString("ru-RU")} ${S.keys.sprint ? "• СПРИНТ" : ""}`;

    $("#skillAtk .cd").style.transform = `scaleY(${Math.min(1, self.attackTimer / self.attackCd)})`;
    $("#skillAbl .cd").style.transform = `scaleY(${Math.min(1, self.abilityTimer / self.abilityCd)})`;
    const abIcon = self.cls === "warrior" ? "🛡️" : self.cls === "mage" ? "❄️" : "💨";
    $("#abilityIcon").textContent = abIcon;

    for (let i = 0; i < 4; i++) {
      const slotEl = document.querySelector(`.slot[data-slot="${i}"]`);
      if (!slotEl) continue;
      slotEl.querySelectorAll(".item-icon,.qty").forEach((e) => e.remove());
      const s = self.inventory[i];
      if (s && S.items && S.items[s.key]) {
        const ic = document.createElement("span");
        ic.className = "item-icon"; ic.textContent = S.items[s.key].icon;
        slotEl.appendChild(ic);
        if (s.qty > 1) {
          const q = document.createElement("span");
          q.className = "qty"; q.textContent = s.qty;
          slotEl.appendChild(q);
        }
      }
    }

    if (S.inventoryOpen) {
      const g = $("#invGrid");
      g.innerHTML = "";
      for (let i = 0; i < self.inventory.length; i++) {
        const s = self.inventory[i];
        const d = document.createElement("div");
        d.className = "inv-slot";
        if (s && S.items && S.items[s.key]) {
          d.innerHTML = `${S.items[s.key].icon}${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ""}`;
          d.title = S.items[s.key].name;
          d.addEventListener("click", () => socket.emit("inventory:use", i));
        }
        g.appendChild(d);
      }
      for (const slot of ["weapon", "armor", "boots"]) {
        const el = document.querySelector(`[data-eq="${slot}"]`);
        const k = self.equipment[slot];
        if (k && S.items && S.items[k]) {
          el.classList.add("has");
          el.innerHTML = `<span>${S.items[k].icon}</span>`;
          el.title = S.items[k].name;
        } else {
          el.classList.remove("has");
          el.innerHTML = `<span>${slot === "weapon" ? "⚔️" : slot === "armor" ? "🛡️" : "👢"}</span>`;
        }
      }
    }

    let zone = "";
    if (S.static) {
      const t = S.static.town;
      if (Math.hypot(S.pos.x - t.x, S.pos.y - t.y) <= t.radius) zone = "Город";
      else {
        const b = S.static.bossArena;
        if (b && Math.hypot(S.pos.x - b.x, S.pos.y - b.y) <= b.radius) zone = "Арена Стража";
        else zone = "Дикие земли";
      }
    }
    if (zone !== S.zone) {
      S.zone = zone;
      const el = $("#zoneLabel");
      el.textContent = zone;
      el.classList.add("show");
      clearTimeout(S._zoneT);
      S._zoneT = setTimeout(() => el.classList.remove("show"), 1800);
    }
    $("#deathOverlay").classList.toggle("hidden", self.hp > 0);
  }

  function buildShop() {
    if (!S.shop || !S.items) return;
    const g = $("#shopGrid"); g.innerHTML = "";
    for (const key of S.shop) {
      const it = S.items[key]; if (!it) continue;
      const d = document.createElement("div");
      d.className = "shop-item";
      d.innerHTML = `<span class="icon">${it.icon}</span><span class="info">${it.name}</span><span class="price">${it.price}</span>`;
      d.addEventListener("click", () => socket.emit("shop:buy", key));
      g.appendChild(d);
    }
  }

  // ========= loop =========
  function render() {
    requestAnimationFrame(render);
    if (!S.inLobby) return;
    localStep();
    updateCameraTarget();
    const interp = getInterpolated();
    const t = performance.now() / 1000;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    drawBackground();

    ctx.save();
    ctx.translate(-S.camera.x, -S.camera.y);

    if (interp) {
      const { state, prev, alpha } = interp;
      for (const pk of state.pickups || []) drawPickup(pk, t);

      const prevMobs = new Map((prev.mobs || []).map((m) => [m.id, m]));
      for (const m of state.mobs) {
        const pm = prevMobs.get(m.id);
        const rm = pm ? { ...m, x: lerp(pm.x, m.x, alpha), y: lerp(pm.y, m.y, alpha) } : m;
        drawMob(rm, t);
      }

      const prevPlayers = new Map((prev.players || []).map((p) => [p.id, p]));
      for (const p of state.players) {
        let rp;
        if (p.id === S.selfId) {
          const aim = getAim();
          rp = { ...p, x: S.pos.x, y: S.pos.y, vx: S.vel.x, vy: S.vel.y, facing: Math.atan2(aim.y, aim.x) };
        } else {
          const pp = prevPlayers.get(p.id);
          rp = pp ? { ...p, x: lerp(pp.x, p.x, alpha), y: lerp(pp.y, p.y, alpha) } : p;
        }
        drawPlayer(rp, p.id === S.selfId, t);
      }

      const prevProjs = new Map((prev.projectiles || []).map((p) => [p.id, p]));
      for (const pr of state.projectiles) {
        const pp = prevProjs.get(pr.id);
        const rp = pp ? { ...pr, x: lerp(pp.x, pr.x, alpha), y: lerp(pp.y, pr.y, alpha) } : pr;
        drawProjectile(rp);
      }
      drawEffects(state);
    }

    drawParticles();
    drawDamageTexts();
    ctx.restore();

    drawMinimap();
    updateHud();
  }

  // ========= wiring =========
  $("#createLobbyBtn").addEventListener("click", () => {
    sendProfile();
    setTimeout(() => socket.emit("lobby:create", { name: `${S.name || "Герой"}'s Arena` }), 50);
  });
  $("#joinLobbyBtn").addEventListener("click", () => {
    const code = $("#joinLobbyInput").value.trim().toUpperCase();
    if (!code) return;
    sendProfile();
    setTimeout(() => socket.emit("lobby:join", code), 50);
  });
  $("#joinLobbyInput").addEventListener("keypress", (e) => { if (e.key === "Enter") $("#joinLobbyBtn").click(); });
  $("#refreshLobbiesBtn").addEventListener("click", refreshLobbies);
  ["nameInput", "bodyColor", "accentColor", "eyesColor"].forEach((id) => {
    $("#" + id).addEventListener("change", sendProfile);
  });

  $("#leaveBtn").addEventListener("click", () => socket.emit("lobby:leave"));
  $("#copyInviteBtn").addEventListener("click", () => {
    if (S.lobbyCode && navigator.clipboard) navigator.clipboard.writeText(S.lobbyCode).then(() => toast("Код: " + S.lobbyCode));
  });
  $("#toggleInv").addEventListener("click", () => togglePanel("inv"));
  $("#toggleShop").addEventListener("click", () => togglePanel("shop"));
  $("#helpBtn").addEventListener("click", () => $("#helpOverlay").classList.toggle("hidden"));
  $("#closeHelp").addEventListener("click", () => $("#helpOverlay").classList.add("hidden"));
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => {
    const which = b.dataset.close;
    if (which === "inv") { S.inventoryOpen = false; $("#invPanel").classList.remove("open"); }
    if (which === "shop") { S.shopOpen = false; $("#shopPanel").classList.remove("open"); }
  }));
  $$(".slot").forEach((el) => {
    const slot = el.dataset.slot;
    if (slot != null) el.addEventListener("click", () => socket.emit("inventory:use", parseInt(slot, 10)));
  });
  $("#skillAtk").addEventListener("click", doAttack);
  $("#skillAbl").addEventListener("click", doAbility);

  setInterval(() => { if (!S.inLobby) refreshLobbies(); }, 5000);

  renderClassTiles();
  resizeCanvas();
  showScreen("menu");
  requestAnimationFrame(render);
})();
