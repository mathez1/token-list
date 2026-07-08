/* =====================================================================
   LYŽIAR NA KORBE  —  Ski Truck Slalom
   A silly indie arcade game: a screaming skier is roped to the flatbed
   (korba) of your pickup. Slalom through traffic, don't crash the truck,
   the further & faster you go the more points you rack up.  Reach the
   CIEL (finish) quickly for a fat time bonus, then chase the bonus road.
   Pure vanilla JS + Canvas, no dependencies.
   ===================================================================== */
(function () {
  "use strict";

  // ---------------------------------------------------------------- config
  const CFG = {
    W: 540,
    H: 760,
    LANES: 4,
    ROAD_W: 380,
    get ROAD_X0() {
      return (this.W - this.ROAD_W) / 2;
    },
    get LANE_W() {
      return this.ROAD_W / this.LANES;
    },
    PPM: 5.5, // pixels per metre (visual speed feel)
    SPEED_START: 55, // km/h
    SPEED_CAP: 250, // km/h
    RAMP: 0.028, // km/h added per metre travelled
    BOOST: 48, // km/h target while holding gas
    BRAKE: 62, // km/h target while holding brake
    FINISH_M: 5000, // distance to the CIEL
    PAR_TIME: 105, // seconds; beat it for max time bonus
    SCORE_PER_KM: 100,
    PLAYER_Y: 570,
    PLAYER_W: 46,
    PLAYER_H: 82,
  };

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = CFG.W;
  const H = CFG.H;

  // ---------------------------------------------------------------- helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rndi = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const laneCenter = (i) => CFG.ROAD_X0 + CFG.LANE_W * (i + 0.5);

  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // lighten (amt>0) / darken (amt<0) a #rrggbb colour, amt in -1..1
  function shade(hex, amt) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    let r = parseInt(h.slice(0, 2), 16),
      g = parseInt(h.slice(2, 4), 16),
      b = parseInt(h.slice(4, 6), 16);
    const t = Math.abs(amt),
      f = amt < 0 ? 0 : 255;
    r = Math.round(lerp(r, f, t));
    g = Math.round(lerp(g, f, t));
    b = Math.round(lerp(b, f, t));
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  // soft drop shadow ellipse (for depth under cars/objects)
  function softShadow(cx, cy, rx, ry, alpha) {
    ctx.fillStyle = "rgba(0,0,0," + (alpha || 0.25) + ")";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.283);
    ctx.fill();
  }

  // ---- pre-rendered scrolling textures (built once) ----
  const TILE = 64;
  function makeTile(base, specks) {
    const c = document.createElement("canvas");
    c.width = c.height = TILE;
    const x = c.getContext("2d");
    x.fillStyle = base;
    x.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < specks.count; i++) {
      x.fillStyle = pick(specks.colors);
      const s = rnd(specks.min, specks.max);
      x.fillRect(Math.random() * TILE, Math.random() * TILE, s, s);
    }
    return ctx.createPattern(c, "repeat");
  }
  const asphaltPattern = makeTile("#3c3f47", {
    count: 150,
    colors: ["#43464e", "#363940", "#4a4d55", "#2c2f35", "#2f3238"],
    min: 1,
    max: 2.4,
  });
  const grassPattern = makeTile("#54ad46", {
    count: 90,
    colors: ["#4c9f3f", "#5cb84d", "#489a3c", "#63c256"],
    min: 2,
    max: 5,
  });

  // cached vignette (static, covers full screen)
  let vignette = null;
  function getVignette() {
    if (!vignette) {
      vignette = ctx.createRadialGradient(
        W / 2, H * 0.46, H * 0.28,
        W / 2, H * 0.5, H * 0.8
      );
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(0.7, "rgba(0,0,0,0.06)");
      vignette.addColorStop(1, "rgba(10,8,18,0.42)");
    }
    return vignette;
  }

  // ---------------------------------------------------------------- audio
  const Audio = (function () {
    let ac = null;
    let master = null;
    let engineOsc = null;
    let engineGain = null;
    let muted = false;

    function ensure() {
      if (ac) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.5;
      master.connect(ac.destination);
    }
    function resume() {
      ensure();
      if (ac && ac.state === "suspended") ac.resume();
    }
    function blip(freq, dur, type, vol, slideTo) {
      if (!ac || muted) return;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, ac.currentTime);
      if (slideTo)
        o.frequency.exponentialRampToValueAtTime(
          Math.max(1, slideTo),
          ac.currentTime + dur
        );
      g.gain.setValueAtTime(vol || 0.2, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g);
      g.connect(master);
      o.start();
      o.stop(ac.currentTime + dur + 0.02);
    }
    function noise(dur, vol) {
      if (!ac || muted) return;
      const n = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, n, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g = ac.createGain();
      g.gain.value = vol || 0.4;
      src.connect(g);
      g.connect(master);
      src.start();
    }
    function startEngine() {
      // note: do NOT bail on `muted` — the oscillator must exist so that
      // unmuting mid-run works; engine() drives its gain to 0 while muted.
      if (!ac || engineOsc) return;
      engineOsc = ac.createOscillator();
      engineGain = ac.createGain();
      engineOsc.type = "sawtooth";
      engineOsc.frequency.value = 60;
      engineGain.gain.value = 0.04;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 500;
      engineOsc.connect(lp);
      lp.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
    }
    function stopEngine() {
      if (engineOsc) {
        try {
          engineOsc.stop();
        } catch (e) {}
        engineOsc = null;
        engineGain = null;
      }
    }
    function engine(speedKmh) {
      if (engineOsc && engineGain) {
        const t = speedKmh / CFG.SPEED_CAP;
        engineOsc.frequency.setTargetAtTime(
          55 + t * 130,
          ac.currentTime,
          0.05
        );
        engineGain.gain.setTargetAtTime(muted ? 0 : 0.03 + t * 0.05, ac.currentTime, 0.1);
      }
    }
    return {
      resume,
      startEngine,
      stopEngine,
      engine,
      toggleMute() {
        muted = !muted;
        if (master) master.gain.value = muted ? 0 : 0.5;
        return muted;
      },
      isMuted: () => muted,
      whoosh: () => blip(880, 0.14, "sine", 0.18, 220),
      coin: () => {
        blip(1046, 0.07, "square", 0.16);
        setTimeout(() => blip(1568, 0.09, "square", 0.16), 60);
      },
      honk: () => {
        blip(300, 0.18, "sawtooth", 0.22);
        blip(360, 0.18, "sawtooth", 0.16);
      },
      crash: () => {
        noise(0.5, 0.5);
        blip(140, 0.4, "sawtooth", 0.3, 40);
      },
      fanfare: () => {
        [523, 659, 784, 1046].forEach((f, i) =>
          setTimeout(() => blip(f, 0.22, "square", 0.2), i * 130)
        );
      },
    };
  })();

  // ---------------------------------------------------------------- input
  const keys = {};
  const CONTROL = { left: false, right: false, up: false, down: false };

  function setKey(code, down) {
    switch (code) {
      case "ArrowLeft":
      case "KeyA":
        CONTROL.left = down;
        break;
      case "ArrowRight":
      case "KeyD":
        CONTROL.right = down;
        break;
      case "ArrowUp":
      case "KeyW":
        CONTROL.up = down;
        break;
      case "ArrowDown":
      case "KeyS":
        CONTROL.down = down;
        break;
    }
  }

  window.addEventListener("keydown", (e) => {
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Space",
      ].indexOf(e.code) >= 0
    )
      e.preventDefault();
    keys[e.code] = true;
    setKey(e.code, true);
    Audio.resume();
    if (e.code === "Space") onAction();
    if (e.code === "KeyP") togglePause();
    if (e.code === "KeyM") setMute(Audio.toggleMute());
  });
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
    setKey(e.code, false);
  });

  // touch buttons
  function bindHold(id, ctrl) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (e) => {
      e.preventDefault();
      CONTROL[ctrl] = true;
      Audio.resume();
    };
    const off = (e) => {
      e.preventDefault();
      CONTROL[ctrl] = false;
    };
    el.addEventListener("touchstart", on, { passive: false });
    el.addEventListener("touchend", off, { passive: false });
    el.addEventListener("touchcancel", off, { passive: false });
    el.addEventListener("mousedown", on);
    el.addEventListener("mouseup", off);
    el.addEventListener("mouseleave", off);
  }
  bindHold("btn-left", "left");
  bindHold("btn-right", "right");
  bindHold("btn-up", "up");
  bindHold("btn-down", "down");

  // tap canvas to start / restart
  canvas.addEventListener("pointerdown", (e) => {
    Audio.resume();
    if (state === "menu" || state === "over" || state === "paused") onAction();
  });

  const muteBtn = document.getElementById("mute");
  function setMute(m) {
    muteBtn.textContent = m ? "🔇" : "🔊";
  }
  muteBtn.addEventListener("click", () => {
    Audio.resume();
    setMute(Audio.toggleMute());
  });

  // ---------------------------------------------------------------- state
  let state = "menu"; // menu | playing | crashing | over | paused
  let prevState = "menu";
  let tPrev = 0;
  let shake = 0;
  let flashFinish = 0;
  let started = false;

  const player = { x: W / 2, y: CFG.PLAYER_Y, w: CFG.PLAYER_W, h: CFG.PLAYER_H, vx: 0 };
  const skier = {
    x: W / 2,
    y: CFG.PLAYER_Y + 96,
    vx: 0,
    ragdoll: false,
    rx: 0,
    ry: 0,
    rvx: 0,
    rvy: 0,
    rot: 0,
    rvrot: 0,
    face: "wheee",
    say: "",
    sayT: 0,
  };

  let traffic = [];
  let particles = [];
  let floaters = [];
  let confetti = [];
  let scenery = []; // roadside trees / lamps / signs

  let speed = CFG.SPEED_START; // km/h (current)
  let distanceM = 0;
  let scrollY = 0; // for road dashes
  let worldScroll = 0; // total px scrolled (textures + scenery)
  let frameScroll = 0; // px scrolled this frame
  let nextSceneryAt = 0; // worldScroll threshold for next scenery spawn
  let lastOpenLane = 1; // keeps consecutive gaps reachable
  let elapsed = 0; // monotonic cosmetic clock (advances in every state)
  let raceTime = 0; // gameplay stopwatch (used for the CIEL time bonus)
  let combo = 0;
  let comboTimer = 0;
  let bestCombo = 0;
  let nearMisses = 0;
  let slalomScore = 0;
  let timeBonus = 0;
  let finished = false;
  let finishTime = 0;

  let best = 0;
  try {
    best = parseInt(localStorage.getItem("ski_truck_best") || "0", 10) || 0;
  } catch (e) {}

  function totalScore() {
    return Math.floor((distanceM / 1000) * CFG.SCORE_PER_KM + slalomScore + timeBonus);
  }

  // ---------------------------------------------------------------- vehicles
  const CAR_TYPES = [
    { kind: "car", body: "#e8443c", w: 46, h: 84 },
    { kind: "car", body: "#3d7be8", w: 46, h: 84 },
    { kind: "car", body: "#7a49d6", w: 46, h: 84 },
    { kind: "car", body: "#20b573", w: 46, h: 84 },
    { kind: "car", body: "#e88f1e", w: 46, h: 84 },
    { kind: "car", body: "#12b5c9", w: 46, h: 84 },
    { kind: "car", body: "#ff5d8f", w: 46, h: 84 },
    { kind: "sports", body: "#e01e2b", w: 44, h: 88 },
    { kind: "sports", body: "#111418", w: 44, h: 88 },
    { kind: "taxi", body: "#ffc21c", w: 46, h: 86 },
    { kind: "van", body: "#efece2", w: 52, h: 104 },
    { kind: "van", body: "#4a90d9", w: 52, h: 104 },
    { kind: "bus", body: "#ffd23f", w: 56, h: 150 },
    { kind: "ambulance", body: "#f4f7fb", w: 52, h: 112 },
    { kind: "tractor", body: "#3fa34d", w: 50, h: 92, slow: true },
    { kind: "duck", body: "#ffd400", w: 48, h: 78 },
    { kind: "banana", body: "#ffe14d", w: 44, h: 96 },
    { kind: "bathtub", body: "#f4f7fb", w: 50, h: 90 },
    { kind: "cop", body: "#20242b", w: 46, h: 86 },
  ];

  function newRun() {
    player.x = W / 2;
    player.vx = 0;
    skier.x = W / 2;
    skier.vx = 0;
    skier.ragdoll = false;
    skier.face = "wheee";
    skier.say = "";
    skier.sayT = 0;
    traffic = [];
    particles = [];
    floaters = [];
    confetti = [];
    scenery = [];
    nextSceneryAt = 0;
    lastOpenLane = 1;
    speed = CFG.SPEED_START;
    distanceM = 0;
    scrollY = 0;
    worldScroll = 0;
    frameScroll = 0;
    raceTime = 0;
    combo = 0;
    comboTimer = 0;
    bestCombo = 0;
    nearMisses = 0;
    slalomScore = 0;
    timeBonus = 0;
    finished = false;
    finishTime = 0;
    shake = 0;
    flashFinish = 0;
    resetControls();
    Audio.startEngine();
    state = "playing";
  }

  // spawn a row of traffic. Rows sit closer together and block more lanes as
  // it gets harder (more cars), but always leave >=1 open lane, and keep that
  // gap reachable from the previous one so dense traffic stays fair.
  function trySpawn() {
    const d = clamp(distanceM / CFG.FINISH_M, 0, 2);
    const gapPx = clamp(178 - d * 100, 84, 178); // denser over time
    let topY = Infinity;
    for (const c of traffic) if (c.y < topY) topY = c.y;
    if (topY < gapPx) return; // wait until the top is clear enough

    // how many lanes to leave OPEN (>=1), shrinking with difficulty
    const open = clamp(CFG.LANES - 1 - Math.floor(d * 2.4), 1, CFG.LANES - 1);
    // guaranteed reachable open lane: adjacent-ish to the previous one
    const base = clamp(lastOpenLane + rndi(-1, 1), 0, CFG.LANES - 1);
    const openSet = new Set([base]);
    let guard = 0;
    while (openSet.size < open && guard++ < 20) openSet.add(rndi(0, CFG.LANES - 1));
    lastOpenLane = base;

    for (let ln = 0; ln < CFG.LANES; ln++) {
      if (openSet.has(ln)) continue;
      const t = pick(CAR_TYPES);
      // own forward speed as a fraction of ours -> they always drift down
      const frac = t.slow ? rnd(0.05, 0.16) : rnd(0.32, 0.6);
      traffic.push({
        x: laneCenter(ln) + rnd(-5, 5),
        y: -t.h - rnd(0, 46),
        w: t.w,
        h: t.h,
        kind: t.kind,
        body: t.body,
        frac: frac,
        wob: rnd(0, 6.28),
        wobA: t.slow ? rnd(2, 3) : rnd(0.6, 1.4),
        googly: Math.random() < 0.5,
        counted: false,
        honked: false,
      });
    }
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    elapsed += dt; // cosmetic clock ticks in menu, play, over — everywhere
    frameScroll = 0;
    if (state === "playing") updatePlaying(dt);
    else if (state === "crashing") updateCrashing(dt);
    else if (state === "menu") frameScroll = 95 * dt; // gentle idle highway
    else if (state === "over") frameScroll = 12 * dt;

    // world scroll drives textures, dashes and roadside scenery in every state
    scrollY = (scrollY + frameScroll) % 40;
    worldScroll += frameScroll;
    updateScenery(frameScroll);

    // decay visual bits everywhere
    updateParticles(dt);
    updateFloaters(dt);
    updateConfetti(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 60);
    if (flashFinish > 0) flashFinish = Math.max(0, flashFinish - dt);
  }

  function updatePlaying(dt) {
    raceTime += dt;

    // --- speed model: auto ramp + throttle/brake
    let target = CFG.SPEED_START + distanceM * CFG.RAMP;
    if (CONTROL.up) target += CFG.BOOST;
    if (CONTROL.down) target -= CFG.BRAKE;
    target = clamp(target, 40, CFG.SPEED_CAP);
    speed += (target - speed) * clamp(dt * 1.8, 0, 1);
    Audio.engine(speed);

    const mps = speed / 3.6;
    distanceM += mps * dt;
    frameScroll = mps * dt * CFG.PPM; // consumed centrally in update()

    // --- steering
    const steer = (CONTROL.right ? 1 : 0) - (CONTROL.left ? 1 : 0);
    const steerPower = 620; // px/s^2-ish
    player.vx += steer * steerPower * dt;
    player.vx *= Math.pow(0.86, dt * 60);
    player.vx = clamp(player.vx, -320, 320);
    player.x += player.vx * dt;
    const minX = CFG.ROAD_X0 + player.w / 2 + 4;
    const maxX = CFG.ROAD_X0 + CFG.ROAD_W - player.w / 2 - 4;
    if (player.x < minX) {
      player.x = minX;
      player.vx *= -0.3;
    }
    if (player.x > maxX) {
      player.x = maxX;
      player.vx *= -0.3;
    }

    // --- skier pendulum behind the truck
    const anchorX = player.x;
    skier.vx += (anchorX - skier.x) * 26 * dt;
    skier.vx += -player.vx * 4 * dt; // gets thrown outward on hard turns
    skier.vx *= Math.pow(0.9, dt * 60);
    skier.x += skier.vx * dt;
    skier.y = player.y + player.h / 2 + 46;

    // --- move traffic
    let dangerNear = false;
    for (const c of traffic) {
      const relMps = mps * (1 - c.frac);
      c.y += relMps * dt * CFG.PPM;
      c.wob += dt * 6;

      // proximity feeling for skier face
      if (c.y > player.y - 200 && c.y < player.y + 40) {
        if (Math.abs(c.x - player.x) < 70) dangerNear = true;
      }

      // honk when getting close ahead
      if (!c.honked && c.y > player.y - 160 && Math.abs(c.x - player.x) < 60) {
        c.honked = true;
        if (Math.random() < 0.5) Audio.honk();
      }

      // collision (forgiving boxes)
      if (aabb(player, c, 7)) {
        doCrash(c);
        return;
      }

      // near-miss: fully passed below player without crashing
      if (!c.counted && c.y - c.h / 2 > player.y + player.h / 2) {
        c.counted = true;
        const dx = Math.abs(c.x - player.x);
        if (dx < 84) awardNearMiss(dx, c);
      }
    }
    traffic = traffic.filter((c) => c.y < H + 160);

    // --- combo decay
    comboTimer -= dt;
    if (comboTimer <= 0 && combo > 0) {
      combo = 0;
    }

    // --- skier mood
    if (dangerNear) skier.face = "scared";
    else if (combo >= 3) skier.face = "yeah";
    else skier.face = "wheee";
    tickSkierChatter(dt, dangerNear);

    // --- spawning
    trySpawn();

    // --- trail effects: sparks off the skis (it's asphalt!), exhaust, smoke
    const spd01 = clamp((speed - 40) / (CFG.SPEED_CAP - 40), 0, 1);
    const sparkN = 1 + Math.floor(spd01 * 2); // both skis, per frame
    for (let k = 0; k < sparkN; k++) {
      spawnSpark(skier.x - 9 + rnd(-2, 2), skier.y + 17, skier.vx);
      spawnSpark(skier.x + 9 + rnd(-2, 2), skier.y + 17, skier.vx);
    }
    // exhaust from the tailpipe
    if (Math.random() < (5 + spd01 * 9) * dt)
      spawnExhaust(player.x + player.w / 2 - 9, player.y + player.h / 2 - 2);
    // extra tyre smoke when flooring it
    if (CONTROL.up && Math.random() < dt * 18) {
      spawnSmoke(player.x - player.w / 2 + 6, player.y + player.h / 2);
      spawnSmoke(player.x + player.w / 2 - 6, player.y + player.h / 2);
    }

    // --- finish line
    if (!finished && distanceM >= CFG.FINISH_M) {
      finished = true;
      finishTime = raceTime;
      timeBonus = Math.max(0, Math.round((CFG.PAR_TIME - raceTime) * 60));
      flashFinish = 2.2;
      shake = 8;
      burstConfetti(160);
      Audio.fanfare();
      floaters.push(makeFloater(W / 2, 220, "🏁 CIEL! 🏁", "#fff", 34, 2.2));
      if (timeBonus > 0)
        floaters.push(
          makeFloater(W / 2, 270, "ČAS BONUS +" + timeBonus, "#ffe14d", 24, 2.4)
        );
    }
  }

  function updateCrashing(dt) {
    // slow-mo tumble
    const s = 0.35;
    // ragdoll skier physics
    skier.rvy += 900 * dt * s;
    skier.rx += skier.rvx * dt * s;
    skier.ry += skier.rvy * dt * s;
    skier.rot += skier.rvrot * dt * s;
    // keep traffic drifting a touch
    for (const c of traffic) c.y += 30 * dt;
    crashTimer -= dt;
    if (crashTimer <= 0) endRun();
  }

  let crashTimer = 0;
  function doCrash(car) {
    if (state !== "playing") return;
    state = "crashing";
    crashTimer = 1.5;
    shake = 16;
    Audio.crash();
    Audio.honk();
    Audio.stopEngine();
    // launch skier ragdoll
    skier.ragdoll = true;
    skier.rx = skier.x;
    skier.ry = skier.y;
    skier.rvx = rnd(-120, 120) + player.vx;
    skier.rvy = rnd(-520, -360);
    skier.rot = 0;
    skier.rvrot = rnd(-14, 14);
    skier.say = pick(["MAMAAA!", "PREČOOO", "AU!", "TAK TO NIE"]);
    skier.sayT = 1.6;
    // debris
    for (let i = 0; i < 26; i++) {
      particles.push({
        x: player.x,
        y: player.y,
        vx: rnd(-260, 260),
        vy: rnd(-380, 120),
        life: rnd(0.5, 1.1),
        max: 1.1,
        size: rnd(4, 10),
        col: pick(["#ffd23f", "#e8443c", "#333", "#fff", car.body]),
        rot: rnd(0, 6.28),
        vrot: rnd(-10, 10),
        kind: "box",
      });
    }
    for (let i = 0; i < 14; i++) spawnSmoke(player.x + rnd(-20, 20), player.y + rnd(-20, 20));
  }

  function endRun() {
    state = "over";
    Audio.stopEngine();
    const t = totalScore();
    if (t > best) {
      best = t;
      try {
        localStorage.setItem("ski_truck_best", String(best));
      } catch (e) {}
    }
  }

  function awardNearMiss(dx, car) {
    nearMisses++;
    combo++;
    comboTimer = 2.6;
    if (combo > bestCombo) bestCombo = combo;
    const closeness = 1 - dx / 84; // 0..1
    const pts = Math.round((14 + closeness * 26) * (1 + combo * 0.12));
    slalomScore += pts;
    const label =
      combo >= 6
        ? "SLALOM KRÁĽ! "
        : combo >= 3
        ? "PARÁDA! "
        : dx < 50
        ? "TESNÉ! "
        : "";
    floaters.push(
      makeFloater(
        car.x,
        player.y - 8,
        label + "+" + pts + (combo > 1 ? "  x" + combo : ""),
        combo >= 3 ? "#ffe14d" : "#fff",
        combo >= 3 ? 22 : 18,
        1.0
      )
    );
    Audio.coin();
    if (combo >= 3 && Math.random() < 0.4) Audio.whoosh();
    skier.say = pick(["WÍÍÍ!", "EŠTE!", "HOP!", "10/10", "PECKA"]);
    skier.sayT = 0.9;
  }

  function tickSkierChatter(dt, danger) {
    skier.sayT -= dt;
    if (skier.sayT <= 0) {
      skier.say = "";
      if (danger && Math.random() < dt * 1.4) {
        skier.say = pick(["POZOOR!", "STOOOP", "!!!", "DRŽ SA!"]);
        skier.sayT = 0.8;
      } else if (speed > 160 && Math.random() < dt * 0.5) {
        skier.say = pick(["RÝCHLEJŠIE!", "IHAAA!", "SNEH KDE?", "ČAAAU"]);
        skier.sayT = 1.0;
      }
    }
  }

  function aabb(a, c, pad) {
    pad = pad || 0;
    return (
      Math.abs(a.x - c.x) < (a.w + c.w) / 2 - pad &&
      Math.abs(a.y - c.y) < (a.h + c.h) / 2 - pad
    );
  }

  // ---------------------------------------------------------------- particles
  function spawnSmoke(x, y) {
    particles.push({
      x,
      y,
      vx: rnd(-26, 26),
      vy: rnd(-8, 36),
      life: rnd(0.35, 0.75),
      max: 0.75,
      size: rnd(6, 12),
      col: "#ffffff",
      kind: "smoke",
    });
  }
  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "box") {
        p.vy += 900 * dt;
        p.rot += p.vrot * dt;
      } else if (p.kind === "spark") {
        p.vy += 90 * dt;
        p.vx *= 0.95;
      } else {
        // smoke + exhaust: rise slightly and expand
        p.vy -= 18 * dt;
        p.size += dt * 16;
      }
    }
    particles = particles.filter((p) => p.life > 0);
  }

  function makeFloater(x, y, text, col, size, life) {
    return { x, y, text, col, size, life, max: life };
  }
  function updateFloaters(dt) {
    for (const f of floaters) {
      f.life -= dt;
      f.y -= 26 * dt;
    }
    floaters = floaters.filter((f) => f.life > 0);
  }

  function burstConfetti(n) {
    for (let i = 0; i < n; i++)
      confetti.push({
        x: rnd(0, W),
        y: rnd(-40, -4),
        vx: rnd(-40, 40),
        vy: rnd(60, 200),
        size: rnd(5, 11),
        col: pick(["#ffd23f", "#e8443c", "#3d7be8", "#20b573", "#ff7fd0", "#fff"]),
        rot: rnd(0, 6.28),
        vrot: rnd(-8, 8),
        life: rnd(2.5, 4.5),
      });
  }
  function updateConfetti(dt) {
    for (const c of confetti) {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vy += 40 * dt;
      c.rot += c.vrot * dt;
      c.life -= dt;
    }
    confetti = confetti.filter((c) => c.life > 0 && c.y < H + 20);
  }

  // ---------------------------------------------------------------- draw
  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate(rnd(-shake, shake), rnd(-shake, shake));
    }
    drawWorld();
    ctx.restore();

    // vignette for depth (over the world, under the HUD)
    ctx.fillStyle = getVignette();
    ctx.fillRect(0, 0, W, H);

    // HUD & overlays sit above the shake
    drawHUD();
    for (const f of floaters) drawFloater(f);
    for (const c of confetti) drawConfetti(c);

    if (flashFinish > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(flashFinish / 2.2) * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state === "menu") drawMenu();
    if (state === "over") drawOver();
    if (state === "paused") drawPaused();
  }

  function drawWorld() {
    drawGrass();
    drawRoad();
    drawGuardrail();
    drawScenery();

    // finish line approaching
    if (finished || distanceM > CFG.FINISH_M - 900) {
      const remaining = CFG.FINISH_M - distanceM; // metres to line
      const lineY = player.y - remaining * CFG.PPM;
      if (lineY > -40 && lineY < H + 40) drawFinishLine(lineY);
    }

    // traffic behind/around player, then player on top
    for (const c of traffic) drawCar(c);

    drawRopeAndSkier();
    drawTruck();

    // particles (sparks / smoke / debris) above the road
    for (const p of particles) drawParticle(p);

    // motion + depth
    drawSpeedLines();
    drawAtmosphere();
  }

  // ---- ground ------------------------------------------------------------
  function drawGrass() {
    const off = worldScroll % TILE;
    ctx.save();
    ctx.fillStyle = grassPattern;
    ctx.translate(0, off);
    ctx.fillRect(0, -off - TILE, W, H + 2 * TILE);
    ctx.restore();
    // subtle brightening toward the horizon (top)
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(0, 0, W, H * 0.35);
  }

  function drawRoad() {
    const x0 = CFG.ROAD_X0,
      rw = CFG.ROAD_W;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, rw, H);
    ctx.clip();
    ctx.fillStyle = "#3c3f47";
    ctx.fillRect(x0, 0, rw, H);
    const off = worldScroll % TILE;
    ctx.save();
    ctx.fillStyle = asphaltPattern;
    ctx.translate(0, off);
    ctx.fillRect(x0, -off - TILE, rw, H + 2 * TILE);
    ctx.restore();
    // cross-road shading: darker shoulders, faint centre sheen
    const g = ctx.createLinearGradient(x0, 0, x0 + rw, 0);
    g.addColorStop(0, "rgba(0,0,0,0.30)");
    g.addColorStop(0.5, "rgba(255,255,255,0.035)");
    g.addColorStop(1, "rgba(0,0,0,0.30)");
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, rw, H);
    ctx.restore();
    drawRoadMarkings();
  }

  function drawRoadMarkings() {
    const x0 = CFG.ROAD_X0,
      rw = CFG.ROAD_W;
    // solid edge lines
    ctx.fillStyle = "rgba(238,236,226,0.85)";
    ctx.fillRect(x0 + 3, 0, 4, H);
    ctx.fillRect(x0 + rw - 7, 0, 4, H);
    // dashed lane dividers with a soft drop shadow
    const dy = (scrollY % 40) - 40;
    for (let i = 1; i < CFG.LANES; i++) {
      const x = x0 + CFG.LANE_W * i - 3;
      for (let y = dy; y < H; y += 40) {
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(x + 1.5, y + 2, 6, 24);
        ctx.fillStyle = "#f3ead0";
        ctx.fillRect(x, y, 6, 24);
      }
    }
  }

  function drawGuardrail() {
    const rails = [CFG.ROAD_X0 - 7, CFG.ROAD_X0 + CFG.ROAD_W + 7];
    const py = (scrollY % 40) - 40;
    for (const rx of rails) {
      ctx.fillStyle = "#c3c8cf";
      ctx.fillRect(rx - 3, 0, 6, H);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(rx - 3, 0, 2, H);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(rx + 1, 0, 2, H);
      ctx.fillStyle = "#868c95";
      for (let y = py; y < H; y += 40) ctx.fillRect(rx - 2.5, y, 5, 13);
    }
  }

  // ---- roadside scenery --------------------------------------------------
  const SCENERY = [
    "tree", "tree", "tree", "bush", "lamp", "lamp",
    "sign", "rock", "flowers", "tree", "bush",
  ];
  function spawnScenery(seedY) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const type = pick(SCENERY);
    const margin = 10;
    let x;
    if (side < 0) x = rnd(margin, CFG.ROAD_X0 - 16);
    else x = rnd(CFG.ROAD_X0 + CFG.ROAD_W + 16, W - margin);
    scenery.push({
      x,
      y: seedY !== undefined ? seedY : -34 - rnd(0, 46),
      type,
      s: rnd(0.85, 1.2),
      side,
      variant: rndi(0, 2),
      wob: rnd(0, 6.28),
    });
  }
  function seedScenery() {
    for (let y = -20; y < H; y += rnd(58, 108)) spawnScenery(y);
  }
  function updateScenery(scrollPx) {
    for (const s of scenery) s.y += scrollPx;
    scenery = scenery.filter((s) => s.y < H + 140);
    let guard = 0;
    while (worldScroll >= nextSceneryAt && guard++ < 8) {
      spawnScenery();
      nextSceneryAt += rnd(52, 116);
    }
  }

  function drawScenery() {
    for (const s of scenery) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(s.s, s.s);
      if (s.type === "tree") drawTree(s.variant);
      else if (s.type === "bush") drawBush();
      else if (s.type === "lamp") drawLamp(s.side);
      else if (s.type === "sign") drawSign(s.variant);
      else if (s.type === "rock") drawRock();
      else drawFlowers();
      ctx.restore();
    }
  }

  function drawTree(v) {
    softShadow(4, 20, 15, 6, 0.28);
    // trunk
    ctx.fillStyle = "#7a4a24";
    ctx.fillRect(-3, 4, 6, 16);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(1, 4, 2, 16);
    // canopy: layered blobs
    const greens =
      v === 0
        ? ["#2f7d32", "#3c9a3f", "#57b85a"]
        : v === 1
        ? ["#2b6e46", "#37905a", "#54b078"]
        : ["#4a7a1e", "#5f9a2b", "#7cbf45"];
    const blobs = [
      [0, -14, 16],
      [-9, -6, 12],
      [9, -6, 12],
      [0, -2, 13],
    ];
    blobs.forEach((b, i) => {
      ctx.fillStyle = greens[i % greens.length];
      ctx.beginPath();
      ctx.arc(b[0], b[1], b[2], 0, 6.28);
      ctx.fill();
    });
    // highlight
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.arc(-5, -16, 5, 0, 6.28);
    ctx.fill();
  }

  function drawBush() {
    softShadow(2, 10, 13, 5, 0.25);
    const g = ["#2f7d3a", "#3fa04b", "#54b85f"];
    [
      [-8, 0, 9],
      [8, 0, 9],
      [0, -5, 11],
    ].forEach((b, i) => {
      ctx.fillStyle = g[i];
      ctx.beginPath();
      ctx.arc(b[0], b[1], b[2], 0, 6.28);
      ctx.fill();
    });
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.arc(-3, -7, 4, 0, 6.28);
    ctx.fill();
  }

  function drawLamp(side) {
    const dir = side < 0 ? 1 : -1; // arm reaches toward road
    softShadow(0, 22, 7, 3, 0.25);
    ctx.strokeStyle = "#5a5f66";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 22);
    ctx.lineTo(0, -20);
    ctx.lineTo(dir * 16, -24);
    ctx.stroke();
    // lamp head
    ctx.fillStyle = "#3b3f45";
    rr(dir * 16 - 5, -27, 10, 6, 3);
    ctx.fill();
    // warm glow
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,214,120,0.5)";
    ctx.beginPath();
    ctx.arc(dir * 16, -21, 5, 0, 6.28);
    ctx.fill();
    ctx.restore();
  }

  function drawSign(v) {
    softShadow(0, 20, 6, 3, 0.25);
    ctx.fillStyle = "#8a8f96";
    ctx.fillRect(-2, -4, 4, 24);
    const msgs = [
      ["#1f9e5a", "🎿"],
      ["#e8443c", "POZOR!"],
      ["#3d7be8", "SNEH →"],
    ];
    const m = msgs[v % msgs.length];
    ctx.fillStyle = "#fff";
    rr(-20, -26, 40, 24, 5);
    ctx.fill();
    ctx.strokeStyle = m[0];
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = m[0];
    ctx.font = "bold 11px 'Comic Sans MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(m[1], 0, -10);
  }

  function drawRock() {
    softShadow(2, 8, 12, 5, 0.25);
    ctx.fillStyle = "#8b9099";
    ctx.beginPath();
    ctx.moveTo(-12, 6);
    ctx.lineTo(-6, -8);
    ctx.lineTo(6, -9);
    ctx.lineTo(13, 4);
    ctx.lineTo(6, 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(-6, -8);
    ctx.lineTo(6, -9);
    ctx.lineTo(0, -2);
    ctx.closePath();
    ctx.fill();
  }

  function drawFlowers() {
    softShadow(0, 6, 10, 4, 0.18);
    const cols = ["#ff5d8f", "#ffd23f", "#7a49d6", "#ff8c1a"];
    for (let i = 0; i < 5; i++) {
      const fx = (i - 2) * 5,
        fy = Math.sin(i * 2) * 3;
      ctx.fillStyle = "#3fa04b";
      ctx.fillRect(fx - 0.5, fy, 1.5, 6);
      ctx.fillStyle = cols[i % cols.length];
      ctx.beginPath();
      ctx.arc(fx, fy, 2.6, 0, 6.28);
      ctx.fill();
    }
  }

  // ---- motion / atmosphere ----------------------------------------------
  function drawSpeedLines() {
    const spd01 = clamp((speed - 95) / (CFG.SPEED_CAP - 95), 0, 1);
    if (spd01 <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const n = Math.floor(4 + spd01 * 16);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * W;
      const len = 45 + spd01 * 150 + Math.random() * 40;
      const y = Math.random() * H;
      ctx.fillStyle = "rgba(255,255,255," + (0.04 + spd01 * 0.06) + ")";
      ctx.fillRect(x, y, Math.random() < 0.5 ? 1 : 2, len);
    }
    ctx.restore();
  }

  let topHaze = null;
  function drawAtmosphere() {
    if (!topHaze) {
      topHaze = ctx.createLinearGradient(0, 0, 0, 160);
      topHaze.addColorStop(0, "rgba(18,22,36,0.55)");
      topHaze.addColorStop(1, "rgba(18,22,36,0)");
    }
    ctx.fillStyle = topHaze;
    ctx.fillRect(0, 0, W, 160);
  }

  // ---- extra particle emitters ------------------------------------------
  function spawnSpark(x, y, sidevx) {
    particles.push({
      kind: "spark",
      x,
      y,
      vx: rnd(-45, 45) - (sidevx || 0) * 0.25,
      vy: rnd(50, 165), // shoots backward (down the screen)
      life: rnd(0.22, 0.5),
      max: 0.5,
      size: rnd(1.4, 3.2),
      col: pick(["#fff4b0", "#ffd23f", "#ff9d2e", "#ffe98a"]),
    });
  }
  function spawnExhaust(x, y) {
    particles.push({
      kind: "exhaust",
      x,
      y,
      vx: rnd(-14, 14),
      vy: rnd(22, 58),
      life: rnd(0.5, 1.0),
      max: 1.0,
      size: rnd(4, 9),
      col: "#6b6f76",
    });
  }

  function drawFinishLine(y) {
    const sq = 20;
    for (let i = 0; i < CFG.ROAD_W / sq; i++) {
      for (let r = 0; r < 2; r++) {
        ctx.fillStyle = (i + r) % 2 === 0 ? "#111" : "#fff";
        ctx.fillRect(CFG.ROAD_X0 + i * sq, y + r * sq, sq, sq);
      }
    }
    ctx.font = "bold 22px 'Comic Sans MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#111";
    ctx.fillText("🏁 CIEL 🏁", W / 2, y - 10);
  }

  // ---- the hero truck with the korba (flatbed)
  function drawTruck() {
    const { x, y, w, h } = player;
    const tilt = clamp(player.vx / 320, -1, 1) * 0.16;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    // soft shadow
    softShadow(3, 8, w * 0.55, h * 0.5, 0.3);

    // headlight cones sweeping ahead (additive)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const cone = ctx.createLinearGradient(0, -h / 2, 0, -h / 2 - 80);
    cone.addColorStop(0, "rgba(255,240,170,0.26)");
    cone.addColorStop(1, "rgba(255,240,170,0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 6, -h / 2 + 2);
    ctx.lineTo(-w / 2 - 8, -h / 2 - 78);
    ctx.lineTo(8, -h / 2 - 78);
    ctx.lineTo(-4, -h / 2 + 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w / 2 - 6, -h / 2 + 2);
    ctx.lineTo(w / 2 + 8, -h / 2 - 78);
    ctx.lineTo(-8, -h / 2 - 78);
    ctx.lineTo(4, -h / 2 + 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // flatbed (korba) at the back (bottom) — shaded wood
    const bedG = ctx.createLinearGradient(0, 2, 0, h / 2);
    bedG.addColorStop(0, "#9a6531");
    bedG.addColorStop(1, "#6f4620");
    ctx.fillStyle = bedG;
    rr(-w / 2, 2, w, h / 2 - 4, 6);
    ctx.fill();
    ctx.strokeStyle = "#5e3d1c";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = "rgba(60,38,18,0.7)";
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      const py = 2 + (i * (h / 2 - 4)) / 4;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 3, py);
      ctx.lineTo(w / 2 - 3, py);
      ctx.stroke();
    }
    // cargo crate + strap
    ctx.fillStyle = "#caa02f";
    rr(-w / 2 + 8, 8, w - 16, 15, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    rr(-w / 2 + 8, 8, w - 16, 5, 3);
    ctx.fill();
    ctx.strokeStyle = "#2f2f2f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, 6);
    ctx.lineTo(-2, 27);
    ctx.stroke();
    // tow hook
    ctx.fillStyle = "#333";
    ctx.fillRect(-3, h / 2 - 4, 6, 8);

    // cab (front) — glossy paint
    const cabG = ctx.createLinearGradient(0, -h / 2, 0, 6);
    cabG.addColorStop(0, "#ff6a5f");
    cabG.addColorStop(0.5, "#e8443c");
    cabG.addColorStop(1, "#b72f28");
    ctx.fillStyle = cabG;
    rr(-w / 2, -h / 2, w, h / 2 + 4, 10);
    ctx.fill();
    ctx.strokeStyle = "#8f221b";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    rr(-w / 2 + 5, -h / 2 + 3, w - 10, 12, 6);
    ctx.fill();

    // windscreen + roof stripe
    glass(-w / 2 + 6, -h / 2 + 8, w - 12, 18, 6);
    ctx.fillStyle = "#fff";
    ctx.fillRect(-w / 2 + 6, -h / 2 + 30, w - 12, 5);

    // chrome bumper + headlights
    ctx.fillStyle = "#d9dde2";
    rr(-w / 2 + 4, -h / 2 - 1, w - 8, 4, 2);
    ctx.fill();
    ctx.fillStyle = "#fff6b0";
    ctx.beginPath();
    ctx.arc(-w / 2 + 8, -h / 2 + 4, 4, 0, 6.28);
    ctx.arc(w / 2 - 8, -h / 2 + 4, 4, 0, 6.28);
    ctx.fill();

    // wheels
    ctx.fillStyle = "#161616";
    [-w / 2 - 3, w / 2 - 3].forEach((wx) => {
      rr(wx, -h / 2 + 14, 6, 18, 3);
      ctx.fill();
      rr(wx, h / 2 - 30, 6, 18, 3);
      ctx.fill();
    });

    // wobbly flag on the cab
    const fw = Math.sin(elapsed * 12) * 4;
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 6, -h / 2 + 2);
    ctx.lineTo(w / 2 - 6, -h / 2 - 14);
    ctx.stroke();
    ctx.fillStyle = "#ff4d6d";
    ctx.beginPath();
    ctx.moveTo(w / 2 - 6, -h / 2 - 14);
    ctx.lineTo(w / 2 - 6 + 16 + fw, -h / 2 - 10);
    ctx.lineTo(w / 2 - 6, -h / 2 - 6);
    ctx.fill();

    ctx.restore();
  }

  // ---- rope from korba to the trailing skier
  function drawRopeAndSkier() {
    if (skier.ragdoll) {
      drawSkierRagdoll();
      return;
    }
    const ax = player.x;
    const ay = player.y + player.h / 2 + 2;
    const sx = skier.x;
    const sy = skier.y;

    // rope with a little sag — dark core + light highlight for depth
    ctx.lineCap = "round";
    ctx.strokeStyle = "#7a5a2e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax + sx) / 2, (ay + sy) / 2 + 12, sx, sy - 14);
    ctx.stroke();
    ctx.strokeStyle = "#dcbb78";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax + sx) / 2, (ay + sy) / 2 + 12, sx, sy - 14);
    ctx.stroke();

    drawSkier(sx, sy, clamp(skier.vx / 200, -0.6, 0.6));
  }

  function drawSkier(x, y, lean) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean * 0.5);

    // skis
    ctx.strokeStyle = "#e63946";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-12, 16);
    ctx.lineTo(-6, 22);
    ctx.moveTo(12, 16);
    ctx.lineTo(6, 22);
    ctx.stroke();
    // ski tips
    ctx.beginPath();
    ctx.moveTo(-12, 16);
    ctx.lineTo(-16, 12);
    ctx.moveTo(12, 16);
    ctx.lineTo(16, 12);
    ctx.stroke();

    // legs
    ctx.strokeStyle = "#2a3b6b";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(-8, 16);
    ctx.moveTo(0, 2);
    ctx.lineTo(8, 16);
    ctx.stroke();

    // body / jacket (shaded)
    const jg = ctx.createLinearGradient(0, -12, 0, 6);
    jg.addColorStop(0, "#ffb14d");
    jg.addColorStop(1, "#f07d10");
    ctx.fillStyle = jg;
    rr(-8, -12, 16, 18, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,60,0,0.45)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // arms flailing
    const flail = Math.sin(elapsed * 22) * 6;
    ctx.strokeStyle = "#ff8c1a";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-6, -6);
    ctx.lineTo(-16, -14 + flail);
    ctx.moveTo(6, -6);
    ctx.lineTo(16, -14 - flail);
    ctx.stroke();

    // head
    ctx.fillStyle = "#ffd9a8";
    ctx.beginPath();
    ctx.arc(0, -18, 8, 0, 6.28);
    ctx.fill();
    // beanie
    ctx.fillStyle = "#1f9e5a";
    ctx.beginPath();
    ctx.arc(0, -20, 8, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, -27, 3, 0, 6.28);
    ctx.fill();

    // face
    drawFace(skier.face);

    ctx.restore();

    // speech bubble
    if (skier.say && skier.sayT > 0) drawBubble(x, y - 40, skier.say);
  }

  function drawFace(mood) {
    ctx.fillStyle = "#14110f";
    if (mood === "scared") {
      ctx.beginPath();
      ctx.arc(-3, -19, 2.4, 0, 6.28);
      ctx.arc(3, -19, 2.4, 0, 6.28);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -13, 3, 0, 6.28);
      ctx.fill(); // open mouth
    } else if (mood === "yeah") {
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "#14110f";
      ctx.beginPath(); // happy squint
      ctx.moveTo(-5, -20);
      ctx.lineTo(-1, -18);
      ctx.moveTo(5, -20);
      ctx.lineTo(1, -18);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -15, 3, 0, Math.PI);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(-3, -19, 1.8, 0, 6.28);
      ctx.arc(3, -19, 1.8, 0, 6.28);
      ctx.fill();
      ctx.strokeStyle = "#14110f";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, -14, 2.4, 0, Math.PI);
      ctx.stroke();
    }
  }

  function drawSkierRagdoll() {
    ctx.save();
    ctx.translate(skier.rx, skier.ry);
    ctx.rotate(skier.rot);
    // reuse a compact body — draw head/beanie FIRST, then the face on top
    ctx.fillStyle = "#ff8c1a";
    rr(-8, -12, 16, 18, 6);
    ctx.fill();
    ctx.fillStyle = "#ffd9a8";
    ctx.beginPath();
    ctx.arc(0, -18, 8, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = "#1f9e5a";
    ctx.beginPath();
    ctx.arc(0, -20, 8, Math.PI, 0);
    ctx.fill();
    drawFace("scared");
    ctx.strokeStyle = "#e63946";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-14, 16);
    ctx.lineTo(-4, 22);
    ctx.moveTo(14, 16);
    ctx.lineTo(4, 22);
    ctx.stroke();
    ctx.restore();
    if (skier.say && skier.sayT > 0) drawBubble(skier.rx, skier.ry - 36, skier.say);
  }

  function drawBubble(x, y, text) {
    ctx.font = "bold 15px 'Comic Sans MS', sans-serif";
    const w = ctx.measureText(text).width + 16;
    const bx = clamp(x - w / 2, 4, W - w - 4);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#14110f";
    ctx.lineWidth = 2.5;
    rr(bx, y - 26, w, 24, 8);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 2);
    ctx.lineTo(x + 5, y - 2);
    ctx.lineTo(x, y + 6);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#14110f";
    ctx.textAlign = "center";
    ctx.fillText(text, bx + w / 2, y - 9);
  }

  // ---- traffic drawing
  function drawCar(c) {
    const { x, y, w, h, body, kind } = c;
    const wob = Math.sin(c.wob) * (c.wobA || 1);
    ctx.save();
    ctx.translate(x + wob, y);

    // soft ground shadow (offset down-right for a top-left key light)
    softShadow(3, 7, w * 0.52, h * 0.5, 0.26);

    if (kind === "bus") drawBus(w, h, body);
    else if (kind === "tractor") drawTractor(w, h, body);
    else if (kind === "duck") drawDuck(w, h, body);
    else if (kind === "banana") drawBanana(w, h, body);
    else if (kind === "bathtub") drawBathtub(w, h, body);
    else if (kind === "cop") drawCop(w, h, body);
    else if (kind === "van") drawVan(w, h, body);
    else if (kind === "sports") drawSports(w, h, body);
    else if (kind === "taxi") drawTaxi(w, h, body);
    else if (kind === "ambulance") drawAmbulance(w, h, body);
    else drawGenericCar(w, h, body);

    if (c.googly) drawGoogly(-w / 6, -h / 2 + 12, w / 6, -h / 2 + 12);

    ctx.restore();
  }

  // shaded, glossy body + peeking wheels
  function carBase(w, h, body, radius) {
    radius = radius || 10;
    ctx.fillStyle = "#171717";
    [-w / 2 - 2, w / 2 - 4].forEach((wx) => {
      rr(wx, -h / 2 + 12, 6, 17, 3);
      ctx.fill();
      rr(wx, h / 2 - 29, 6, 17, 3);
      ctx.fill();
    });
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, shade(body, 0.26));
    g.addColorStop(0.45, body);
    g.addColorStop(1, shade(body, -0.24));
    ctx.fillStyle = g;
    rr(-w / 2, -h / 2, w, h, radius);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // glossy top highlight + left rim light
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    rr(-w / 2 + 4, -h / 2 + 3, w - 8, h * 0.3, radius * 0.7);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    rr(-w / 2 + 2, -h / 2 + 6, 3, h - 12, 2);
    ctx.fill();
  }

  function glass(x, y, gw, gh, r) {
    const g = ctx.createLinearGradient(0, y, 0, y + gh);
    g.addColorStop(0, "#3a5871");
    g.addColorStop(1, "#20303f");
    ctx.fillStyle = g;
    rr(x, y, gw, gh, r || 4);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    rr(x + 2, y + 2, gw * 0.5, gh - 4, r || 3);
    ctx.fill();
  }
  function headlights(w, h) {
    ctx.fillStyle = "#fff2b0";
    ctx.fillRect(-w / 2 + 5, -h / 2 + 3, 8, 3);
    ctx.fillRect(w / 2 - 13, -h / 2 + 3, 8, 3);
  }
  function taillights(w, h) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,64,64,0.9)";
    ctx.fillRect(-w / 2 + 5, h / 2 - 7, 9, 4);
    ctx.fillRect(w / 2 - 14, h / 2 - 7, 9, 4);
    ctx.restore();
  }

  function drawGenericCar(w, h, body) {
    carBase(w, h, body);
    glass(-w / 2 + 7, -h / 2 + 8, w - 14, 18, 5);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    rr(-w / 2 + 8, -h / 2 + 30, w - 16, h - 58, 4);
    ctx.fill();
    glass(-w / 2 + 7, h / 2 - 26, w - 14, 16, 5);
    headlights(w, h);
    taillights(w, h);
  }

  function drawSports(w, h, body) {
    carBase(w, h, body, 13);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(-6, -h / 2 + 2, 3, h - 4);
    ctx.fillRect(3, -h / 2 + 2, 3, h - 4);
    glass(-w / 2 + 8, -h / 2 + 13, w - 16, 15, 6);
    glass(-w / 2 + 8, h / 2 - 24, w - 16, 12, 6);
    // rear spoiler
    ctx.fillStyle = shade(body, -0.3);
    rr(-w / 2 + 2, h / 2 - 7, w - 4, 5, 2);
    ctx.fill();
    headlights(w, h);
    taillights(w, h);
  }

  function drawTaxi(w, h, body) {
    carBase(w, h, body);
    glass(-w / 2 + 7, -h / 2 + 8, w - 14, 18, 5);
    glass(-w / 2 + 7, h / 2 - 26, w - 14, 16, 5);
    // checker band
    ctx.fillStyle = "#111";
    for (let i = 0; i < Math.floor(w / 8); i++)
      if (i % 2 === 0) ctx.fillRect(-w / 2 + i * 8, -3, 8, 6);
    // roof sign
    ctx.fillStyle = "#111";
    rr(-9, -h / 2 + 30, 18, 8, 2);
    ctx.fill();
    ctx.fillStyle = "#ffe14d";
    ctx.font = "bold 7px 'Comic Sans MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TAXI", 0, -h / 2 + 36);
    headlights(w, h);
    taillights(w, h);
  }

  function drawAmbulance(w, h, body) {
    carBase(w, h, body, 8);
    glass(-w / 2 + 7, -h / 2 + 8, w - 14, 16, 4);
    // red cross
    ctx.fillStyle = "#e8443c";
    ctx.fillRect(-3, -6, 6, 22);
    ctx.fillRect(-11, 2, 22, 6);
    // blinking bar
    const on = Math.floor(elapsed * 8) % 2 === 0;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = on ? "rgba(255,64,64,0.95)" : "rgba(70,130,255,0.95)";
    ctx.fillRect(-w / 2 + 8, -h / 2 + 2, (w - 16) / 2, 5);
    ctx.fillStyle = on ? "rgba(70,130,255,0.95)" : "rgba(255,64,64,0.95)";
    ctx.fillRect(-1, -h / 2 + 2, (w - 16) / 2, 5);
    ctx.restore();
    taillights(w, h);
  }

  function drawVan(w, h, body) {
    carBase(w, h, body, 8);
    glass(-w / 2 + 7, -h / 2 + 8, w - 14, 15, 4);
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 6, h / 2 - 30);
    ctx.lineTo(w / 2 - 6, h / 2 - 30);
    ctx.moveTo(0, -h / 2 + 26);
    ctx.lineTo(0, h / 2 - 10);
    ctx.stroke();
    headlights(w, h);
    taillights(w, h);
  }

  function drawBus(w, h, body) {
    carBase(w, h, body, 10);
    for (let i = 0; i < 5; i++) glass(-w / 2 + 7, -h / 2 + 14 + i * 26, w - 14, 16, 4);
    ctx.fillStyle = "#c23b2b";
    ctx.fillRect(-w / 2 + 3, h / 2 - 30, w - 6, 5);
    ctx.fillStyle = "#111";
    ctx.font = "bold 10px 'Comic Sans MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ŠKOLA", 0, h / 2 - 6);
    taillights(w, h);
  }

  function drawTractor(w, h, body) {
    // big rear wheels + small front
    ctx.fillStyle = "#141414";
    [-w / 2 - 3, w / 2 - 7].forEach((wx) => {
      rr(wx, h / 2 - 34, 10, 26, 5);
      ctx.fill();
      rr(wx + 2, -h / 2 + 8, 6, 14, 3);
      ctx.fill();
    });
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, shade(body, 0.25));
    g.addColorStop(1, shade(body, -0.2));
    ctx.fillStyle = g;
    rr(-w / 2 + 4, -h / 2, w - 8, h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    glass(-w / 2 + 10, -h / 2 + 10, w - 20, 16, 4);
    // exhaust puff
    ctx.fillStyle = "rgba(80,80,80,0.5)";
    ctx.beginPath();
    ctx.arc(-w / 2 + 12, -h / 2 - 2 - (Math.sin(elapsed * 6) + 1) * 3, 4, 0, 6.28);
    ctx.fill();
    taillights(w, h);
  }

  function drawDuck(w, h, body) {
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, 6.28);
    ctx.fill();
    ctx.strokeStyle = "#d9a800";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // head bump
    ctx.beginPath();
    ctx.arc(0, -h / 2 + 8, 10, 0, 6.28);
    ctx.fill();
    ctx.stroke();
    // beak
    ctx.fillStyle = "#ff9800";
    ctx.beginPath();
    ctx.moveTo(-6, -h / 2 + 4);
    ctx.lineTo(6, -h / 2 + 4);
    ctx.lineTo(0, -h / 2 - 3);
    ctx.fill();
    // eye
    ctx.fillStyle = "#14110f";
    ctx.beginPath();
    ctx.arc(4, -h / 2 + 6, 2, 0, 6.28);
    ctx.fill();
    // wheels peeking
    ctx.fillStyle = "#141414";
    rr(-w / 2 - 1, h / 2 - 24, 5, 14, 3);
    ctx.fill();
    rr(w / 2 - 4, h / 2 - 24, 5, 14, 3);
    ctx.fill();
  }

  function drawBanana(w, h, body) {
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2 + 10);
    ctx.quadraticCurveTo(0, -h / 2 - 6, w / 2, -h / 2 + 10);
    ctx.quadraticCurveTo(w / 2 + 4, 0, w / 2 - 8, h / 2);
    ctx.quadraticCurveTo(0, h / 2 - 20, -w / 2 + 8, h / 2);
    ctx.quadraticCurveTo(-w / 2 - 4, 0, -w / 2, -h / 2 + 10);
    ctx.fill();
    ctx.strokeStyle = "#caa800";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = "#5b4a12";
    ctx.fillRect(-2, -h / 2 + 2, 4, 8);
    ctx.fillStyle = "#141414";
    rr(-w / 2, h / 2 - 22, 5, 12, 3);
    ctx.fill();
    rr(w / 2 - 5, h / 2 - 22, 5, 12, 3);
    ctx.fill();
  }

  function drawBathtub(w, h, body) {
    ctx.fillStyle = "#141414";
    rr(-w / 2 - 1, -h / 2 + 12, 5, 14, 3);
    ctx.fill();
    rr(w / 2 - 4, -h / 2 + 12, 5, 14, 3);
    ctx.fill();
    rr(-w / 2 - 1, h / 2 - 26, 5, 14, 3);
    ctx.fill();
    rr(w / 2 - 4, h / 2 - 26, 5, 14, 3);
    ctx.fill();
    ctx.fillStyle = body;
    rr(-w / 2, -h / 2, w, h, w / 2);
    ctx.fill();
    ctx.strokeStyle = "#b9c3d0";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = "#cfe0ef";
    rr(-w / 2 + 6, -h / 2 + 10, w - 12, h - 20, w / 3);
    ctx.fill();
    // faucet
    ctx.fillStyle = "#9aa7b3";
    ctx.fillRect(-3, -h / 2 + 2, 6, 8);
    // rubber duck passenger 🦆
    ctx.font = "14px serif";
    ctx.textAlign = "center";
    ctx.fillText("🦆", 0, 4);
  }

  function drawCop(w, h, body) {
    carBase(w, h, body);
    glass(-w / 2 + 7, -h / 2 + 8, w - 14, 18, 5);
    glass(-w / 2 + 7, h / 2 - 26, w - 14, 16, 5);
    // blinking light bar (additive glow)
    const on = Math.floor(elapsed * 8) % 2 === 0;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = on ? "rgba(255,60,60,0.95)" : "rgba(70,130,255,0.95)";
    ctx.fillRect(-w / 2 + 8, -2, (w - 16) / 2, 6);
    ctx.fillStyle = on ? "rgba(70,130,255,0.95)" : "rgba(255,60,60,0.95)";
    ctx.fillRect(-1, -2, (w - 16) / 2, 6);
    ctx.restore();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px 'Comic Sans MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("POLÍCIA", 0, h / 2 - 6);
    taillights(w, h);
  }

  function drawGoogly(x1, y1, x2, y2) {
    [
      [x1, y1],
      [x2, y2],
    ].forEach(([ex, ey]) => {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex, ey, 5, 0, 6.28);
      ctx.fill();
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1;
      ctx.stroke();
      const px = Math.cos(elapsed * 9 + ex) * 2;
      const py = Math.sin(elapsed * 11 + ey) * 2;
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(ex + px, ey + py, 2.2, 0, 6.28);
      ctx.fill();
    });
  }

  function drawParticle(p) {
    const a = clamp(p.life / p.max, 0, 1);
    if (p.kind === "spark") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = a;
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 6.28);
      ctx.fill();
      ctx.restore();
    } else if (p.kind === "smoke") {
      ctx.fillStyle = `rgba(232,232,232,${a * 0.55})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 6.28);
      ctx.fill();
    } else if (p.kind === "exhaust") {
      ctx.fillStyle = `rgba(92,96,102,${a * 0.4})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 6.28);
      ctx.fill();
    } else {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }

  function drawFloater(f) {
    const a = clamp(f.life / f.max, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `bold ${f.size}px 'Comic Sans MS', sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.col;
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }

  function drawConfetti(c) {
    ctx.save();
    ctx.globalAlpha = clamp(c.life, 0, 1);
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.col;
    ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.6);
    ctx.restore();
  }

  // ---------------------------------------------------------------- HUD
  function panel(x, y, w, h) {
    ctx.fillStyle = "rgba(20,17,15,0.55)";
    rr(x, y, w, h, 10);
    ctx.fill();
  }

  function drawHUD() {
    if (state === "menu") return;
    // top-left: score + distance
    panel(10, 10, 210, 82);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffe14d";
    ctx.font = "bold 26px 'Comic Sans MS', sans-serif";
    ctx.fillText(totalScore().toLocaleString("sk-SK"), 20, 42);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px 'Comic Sans MS', sans-serif";
    ctx.fillText("BODY", 20, 58);
    ctx.fillText("📏 " + (distanceM / 1000).toFixed(2) + " km", 20, 80);

    // top-right: speed
    panel(W - 150, 10, 140, 82);
    ctx.textAlign = "right";
    const spd = Math.round(speed);
    ctx.fillStyle = spd > 180 ? "#ff6b6b" : "#8fe36b";
    ctx.font = "bold 30px 'Comic Sans MS', sans-serif";
    ctx.fillText(spd, W - 58, 44);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px 'Comic Sans MS', sans-serif";
    ctx.fillText("km/h", W - 20, 44);
    // mini speed bar
    const bw = 118,
      bx = W - 134,
      by = 60;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    rr(bx, by, bw, 12, 6);
    ctx.fill();
    const t = clamp((speed - 40) / (CFG.SPEED_CAP - 40), 0, 1);
    ctx.fillStyle = t > 0.75 ? "#ff6b6b" : "#8fe36b";
    rr(bx, by, bw * t, 12, 6);
    ctx.fill();

    // combo (center)
    if (combo >= 2 && comboTimer > 0) {
      ctx.textAlign = "center";
      const pulse = 1 + Math.sin(elapsed * 20) * 0.06;
      ctx.save();
      ctx.translate(W / 2, 66);
      ctx.scale(pulse, pulse);
      ctx.font = "bold 26px 'Comic Sans MS', sans-serif";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.strokeText("SLALOM x" + combo, 0, 0);
      ctx.fillStyle = "#ffd23f";
      ctx.fillText("SLALOM x" + combo, 0, 0);
      ctx.restore();
      // combo timer bar
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      rr(W / 2 - 60, 76, 120, 6, 3);
      ctx.fill();
      ctx.fillStyle = "#ffd23f";
      rr(W / 2 - 60, 76, 120 * clamp(comboTimer / 2.6, 0, 1), 6, 3);
      ctx.fill();
    }

    // progress to CIEL
    const py = 100;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    rr(W / 2 - 130, py, 260, 14, 7);
    ctx.fill();
    const prog = clamp(distanceM / CFG.FINISH_M, 0, 1);
    ctx.fillStyle = "#6fd3ff";
    rr(W / 2 - 130, py, 260 * prog, 14, 7);
    ctx.fill();
    ctx.font = "13px 'Comic Sans MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.fillText(finished ? "🏁 BONUS TRASA!" : "🏁 CIEL", W / 2, py - 4);
  }

  // ---------------------------------------------------------------- overlays
  function bigTitle(text, y, size, col) {
    ctx.textAlign = "center";
    ctx.font = `bold ${size}px 'Comic Sans MS', sans-serif`;
    ctx.lineWidth = size / 5;
    ctx.strokeStyle = "#14110f";
    ctx.strokeText(text, W / 2, y);
    ctx.fillStyle = col;
    ctx.fillText(text, W / 2, y);
  }

  function drawMenu() {
    ctx.fillStyle = "rgba(20,17,15,0.55)";
    ctx.fillRect(0, 0, W, H);

    // animated demo skier bobbing at top
    const bx = W / 2 + Math.sin(elapsed * 2) * 60;
    drawSkier(bx, 150, Math.sin(elapsed * 2) * 0.4);

    bigTitle("LYŽIAR", 250, 54, "#ffd23f");
    bigTitle("NA KORBE", 305, 54, "#6fd3ff");
    ctx.font = "16px 'Comic Sans MS', sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText("🎿 Ski Truck Slalom 🚚", W / 2, 345);

    // instructions card
    panel(W / 2 - 200, 410, 400, 210);
    ctx.fillStyle = "#fff";
    ctx.font = "15px 'Comic Sans MS', sans-serif";
    ctx.textAlign = "left";
    const lines = [
      "🎯  Kľučkuj (slalom) medzi autami v premávke.",
      "💥  Nenaraz svojím autom do premávky — inak koniec!",
      "🏁  Príď do CIEĽa (5 km) čo najrýchlejšie.",
      "⚡  Čím ďalej ideš, tým si rýchlejší = viac bodov.",
      "🤟  Tesné prejazdy = SLALOM combo a extra body.",
    ];
    lines.forEach((l, i) => ctx.fillText(l, W / 2 - 186, 440 + i * 30));

    ctx.textAlign = "center";
    const blink = Math.sin(elapsed * 5) > -0.3;
    if (blink) {
      ctx.fillStyle = "#ffe14d";
      ctx.font = "bold 22px 'Comic Sans MS', sans-serif";
      ctx.fillText("▶  Stlač MEDZERU / ťukni pre ŠTART", W / 2, 660);
    }
    ctx.fillStyle = "#cfe6ff";
    ctx.font = "14px 'Comic Sans MS', sans-serif";
    ctx.fillText("Najlepšie skóre: " + best.toLocaleString("sk-SK"), W / 2, 700);
  }

  function drawOver() {
    ctx.fillStyle = "rgba(20,17,15,0.66)";
    ctx.fillRect(0, 0, W, H);

    bigTitle(finished ? "DOJAZD!" : "BUM! 💥", 180, 52, finished ? "#8fe36b" : "#ff6b6b");
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "18px 'Comic Sans MS', sans-serif";
    ctx.fillText(
      finished ? "Dorazil si do cieľa a išiel ďalej!" : pick(SPLATS),
      W / 2,
      215
    );

    // scoreboard card
    panel(W / 2 - 190, 250, 380, 250);
    ctx.textAlign = "left";
    ctx.font = "17px 'Comic Sans MS', sans-serif";
    const distScore = Math.floor((distanceM / 1000) * CFG.SCORE_PER_KM);
    const rows = [
      ["📏 Vzdialenosť", (distanceM / 1000).toFixed(2) + " km"],
      ["   → body za km", "+" + distScore.toLocaleString("sk-SK")],
      ["🤟 Slalom prejazdy", nearMisses + "  (max x" + bestCombo + ")"],
      ["   → slalom body", "+" + Math.floor(slalomScore).toLocaleString("sk-SK")],
      [
        finished ? "🏁 Čas do cieľa" : "🏁 Cieľ",
        finished ? finishTime.toFixed(1) + " s" : "nedosiahnutý",
      ],
      ["   → časový bonus", "+" + timeBonus.toLocaleString("sk-SK")],
    ];
    rows.forEach((r, i) => {
      const y = 285 + i * 30;
      ctx.fillStyle = i % 2 === 0 ? "#fff" : "#cfe6ff";
      ctx.fillText(r[0], W / 2 - 175, y);
      ctx.textAlign = "right";
      ctx.fillText(r[1], W / 2 + 175, y);
      ctx.textAlign = "left";
    });

    // total
    ctx.textAlign = "center";
    bigTitle(totalScore().toLocaleString("sk-SK") + " BODOV", 540, 34, "#ffe14d");
    ctx.fillStyle = "#fff";
    ctx.font = "16px 'Comic Sans MS', sans-serif";
    const rec = totalScore() >= best && totalScore() > 0;
    ctx.fillText(
      rec ? "🏆 NOVÝ REKORD! 🏆" : "Najlepšie: " + best.toLocaleString("sk-SK"),
      W / 2,
      572
    );

    const blink = Math.sin(elapsed * 5) > -0.3;
    if (blink) {
      ctx.fillStyle = "#ffe14d";
      ctx.font = "bold 22px 'Comic Sans MS', sans-serif";
      ctx.fillText("▶  MEDZERA / ťuk — hrať znova", W / 2, 640);
    }
  }

  const SPLATS = [
    "Lyžiar posiela pozdravy z priekopy.",
    "To bolo tesné… teda nebolo.",
    "Autu to nevadí. Lyžiarovi trošku.",
    "Skús to bez toho nárazu.",
    "Ktovie kam doletel ten lyžiar…",
  ];

  function drawPaused() {
    ctx.fillStyle = "rgba(20,17,15,0.55)";
    ctx.fillRect(0, 0, W, H);
    bigTitle("PAUZA", H / 2 - 10, 46, "#fff");
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffe14d";
    ctx.font = "bold 20px 'Comic Sans MS', sans-serif";
    ctx.fillText("Stlač P / MEDZERU pre pokračovanie", W / 2, H / 2 + 30);
  }

  // ---------------------------------------------------------------- flow
  function onAction() {
    if (state === "menu" || state === "over") {
      newRun();
    } else if (state === "paused") {
      state = prevState;
      Audio.startEngine();
    }
  }
  function togglePause() {
    if (state === "playing") {
      prevState = state;
      state = "paused";
      Audio.stopEngine();
    } else if (state === "paused") {
      state = prevState;
      Audio.startEngine();
    }
  }
  function resetControls() {
    CONTROL.left = CONTROL.right = CONTROL.up = CONTROL.down = false;
  }
  window.addEventListener("blur", () => {
    // a held key's keyup is never delivered to a blurred window, so drop all
    // held-input state — otherwise the truck keeps steering/boosting on resume
    resetControls();
    if (state === "playing") togglePause();
  });

  // ---------------------------------------------------------------- loop
  seedScenery(); // populate the roadside before the first frame
  function frame(now) {
    if (!tPrev) tPrev = now;
    let dt = (now - tPrev) / 1000;
    tPrev = now;
    dt = clamp(dt, 0, 0.05); // avoid huge jumps
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // expose a tiny bit for debugging / automated smoke-testing
  window.__ski = {
    CFG,
    get state() {
      return state;
    },
    get score() {
      return totalScore();
    },
    get px() {
      return player.x;
    },
    _jump(m) {
      if (state === "playing") distanceM = m;
    },
    _crash() {
      if (state === "playing" && traffic[0]) doCrash(traffic[0]);
    },
  };
})();
