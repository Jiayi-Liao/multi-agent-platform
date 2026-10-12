import * as THREE from "/vendor/three.module.js";
import { agentSlots, packetProgress } from "/world-state.js";

const colors = [
  "#d5f867",
  "#8dbbd2",
  "#f0aa77",
  "#d9a3bd",
  "#91cdb2",
  "#c8b892",
];
const lightMaterials = {
  "#1b3038": "#c5d2c7",
  "#304b52": "#e0e8d5",
  "#24383e": "#cbd7cc",
  "#617575": "#839b90",
};
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const vector = (x, y, z) => new THREE.Vector3(x, y, z);

export class AgentWorld {
  constructor(host, onPick) {
    this.host = host;
    this.onPick = onPick;
    this.nodes = new Map();
    this.edges = new Map();
    this.packets = new Map();
    this.labels = document.createElement("div");
    this.labels.className = "world-labels";
    this.roster = document.getElementById("world-roster");
    this.hud = document.getElementById("world-hud");
    this.clock = 0;
    this.signature = "";
    this.runId = null;
    this.angle = 0.75;
    this.tilt = 0.8;
    this.zoom = 1;
    this.inView = true;
    this.alive = true;
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch {
      this.fallback(
        "3D requires WebGL2. Explore agents and communication below.",
      );
      return;
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute(
      "aria-label",
      "3D agent outpost. Drag to orbit, scroll to zoom. Use agent buttons for keyboard selection.",
    );
    this.canvas.setAttribute("role", "img");
    this.host.append(this.canvas, this.labels);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2("#101b20", 0.012);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 180);
    this.hemi = new THREE.HemisphereLight("#c8e7ef", "#283c35", 2.8);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight("#f2e9cf", 4);
    key.position.set(-6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, {
      left: -22,
      right: 22,
      top: 22,
      bottom: -22,
    });
    key.shadow.bias = -0.001;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#77dbcf", 2.2);
    rim.position.set(8, 6, -9);
    this.scene.add(rim);
    this.base = new THREE.Group();
    this.dynamic = new THREE.Group();
    this.scene.add(this.base, this.dynamic);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.disposers = [];
    this.light = document.documentElement.dataset.theme === "light";
    this.themeChange = () => this.applyTheme();
    window.addEventListener("relay:themechange", this.themeChange);
    this.disposers.push(() =>
      window.removeEventListener("relay:themechange", this.themeChange),
    );
    this.applyTheme();
    this.bindControls();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.inView = entry.isIntersecting;
    });
    this.intersectionObserver.observe(host);
    this.contextLost = (e) => {
      e.preventDefault();
      this.fallback(
        "3D paused because the graphics context was lost. Reload to restore it; history remains available.",
      );
    };
    this.canvas.addEventListener("webglcontextlost", this.contextLost);
    this.frame = (now) => {
      if (!this.alive) return;
      this.raf = requestAnimationFrame(this.frame);
      // Keep the loop lightweight when the scene is offscreen or the tab is hidden.
      if (document.hidden || !this.inView || !this.renderer || this.lost)
        return;
      if (now - (this.lastFrame || 0) < (reduced.matches ? 100 : 33)) return;
      this.lastFrame = now;
      this.animate(now);
      this.renderer.render(this.scene, this.camera);
      this.positionLabels();
    };
    this.raf = requestAnimationFrame(this.frame);
  }

  fallback(text) {
    this.lost = true;
    this.host.dataset.fallback = "true";
    const el = document.createElement("p");
    el.className = "world-fallback";
    el.textContent = text;
    this.host.append(el);
    if (this.canvas) this.canvas.hidden = true;
    this.labels.hidden = true;
  }

  applyTheme() {
    this.light = document.documentElement.dataset.theme === "light";
    this.scene.fog.color.set(this.light ? "#e6efe2" : "#101b20");
    this.hemi.groundColor.set(this.light ? "#adbfa4" : "#283c35");
    this.renderer.toneMappingExposure = this.light ? 1.1 : 1.25;
    this.dynamic.traverse((obj) => {
      const materials = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];
      for (const material of materials) {
        const original = material?.userData?.relayColor;
        if (original)
          material.color.set(this.light ? lightMaterials[original] : original);
      }
    });
    this.buildBase(this.baseRadius || this.radius || 11);
  }

  material(color, glow = false) {
    const material = new THREE.MeshStandardMaterial({
      color:
        this.light && lightMaterials[color] ? lightMaterials[color] : color,
      roughness: 0.58,
      metalness: 0.24,
      ...(glow ? { emissive: color, emissiveIntensity: 0.7 } : {}),
    });
    if (lightMaterials[color]) material.userData.relayColor = color;
    return material;
  }
  mesh(group, geometry, material, pos) {
    const obj = new THREE.Mesh(geometry, material);
    obj.position.copy(pos);
    obj.castShadow = true;
    obj.receiveShadow = true;
    group.add(obj);
    return obj;
  }
  box(g, dims, material, x, y, z) {
    return this.mesh(
      g,
      new THREE.BoxGeometry(...dims),
      material,
      vector(x, y, z),
    );
  }
  cylinder(g, top, bottom, h, material, x, y, z, sides = 6) {
    return this.mesh(
      g,
      new THREE.CylinderGeometry(top, bottom, h, sides),
      material,
      vector(x, y, z),
    );
  }
  release(group) {
    const materials = new Set(),
      geometries = new Set();
    group.traverse((obj) => {
      if (obj.geometry) geometries.add(obj.geometry);
      if (obj.material)
        for (const m of Array.isArray(obj.material)
          ? obj.material
          : [obj.material])
          materials.add(m);
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    group.clear();
  }
  buildBase(radius) {
    this.release(this.base);
    const dark = this.material("#1b3038"),
      trim = this.material("#304b52");
    this.cylinder(this.base, radius, radius * 0.97, 0.7, dark, 0, -0.7, 0, 6);
    this.cylinder(
      this.base,
      radius * 0.97,
      radius * 0.97,
      0.09,
      trim,
      0,
      -0.29,
      0,
      6,
    );
    const grid = new THREE.GridHelper(
      radius * 1.55,
      Math.round(radius * 1.55),
      this.light ? "#789986" : "#53787a",
      this.light ? "#a4bda5" : "#2b444b",
    );
    grid.position.y = -0.22;
    grid.material.transparent = true;
    grid.material.opacity = 0.45;
    this.base.add(grid);
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const g = new THREE.Group();
      g.position.set(
        Math.cos(angle) * radius * 0.8,
        -0.1,
        Math.sin(angle) * radius * 0.8,
      );
      const lamp = this.material(i % 2 ? "#8dbbd2" : "#d5f867", true);
      this.cylinder(g, 0.14, 0.22, 0.65, trim, 0, 0.2, 0);
      this.cylinder(g, 0.15, 0.15, 0.12, lamp, 0, 0.58, 0);
      this.base.add(g);
    }
    // A deterministic star field gives the outpost depth without textures or external assets.
    const points = [];
    for (let i = 0; i < 130; i++) {
      const a = i * 2.39996,
        r = 24 + (i % 17) * 1.3;
      points.push(Math.cos(a) * r, 3 + ((i * 7) % 27), Math.sin(a) * r);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3),
    );
    this.base.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: this.light ? "#648979" : "#84acae",
          size: 0.055,
          transparent: true,
          opacity: 0.65,
        }),
      ),
    );
  }
  buildAgent(agent, position, index) {
    const g = new THREE.Group();
    g.position.set(position.x, 0, position.z);
    g.userData.pick = { agentId: agent.id };
    const tint = colors[index % colors.length];
    const dark = this.material("#24383e"),
      metal = this.material("#617575"),
      shell = this.material(tint);
    const glow = this.material(tint, true),
      visor = this.material("#0b232b");
    this.cylinder(g, 1.9, 2.1, 0.38, dark, 0, 0, 0);
    this.cylinder(g, 1.92, 1.92, 0.045, shell, 0, 0.2, 0);
    this.cylinder(g, 1.7, 1.7, 0.05, metal, 0, 0.24, 0);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.93, 0.028, 8, 64),
      glow,
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.27;
    g.add(halo);
    const robot = new THREE.Group();
    // All characters face the camera's initial direction.
    robot.rotation.y = 0.45;
    for (const x of [-0.3, 0.3]) {
      this.box(robot, [0.38, 0.48, 0.44], dark, x, 0.54, 0.2);
      this.box(robot, [0.43, 0.17, 0.65], shell, x, 0.35, 0.32);
    }
    this.box(robot, [0.95, 0.85, 0.6], shell, 0, 1.13, 0.15);
    this.box(robot, [0.42, 0.25, 0.03], dark, 0, 1.14, 0.47);
    this.box(robot, [0.22, 0.045, 0.04], glow, 0, 1.16, 0.495);
    this.box(robot, [1.17, 0.75, 0.76], shell, 0, 1.98, 0.15);
    this.box(robot, [0.96, 0.35, 0.065], visor, 0, 1.99, 0.56);
    for (const x of [-0.24, 0.24])
      this.box(robot, [0.12, 0.12, 0.035], glow, x, 2.02, 0.607);
    this.cylinder(robot, 0.035, 0.035, 0.3, metal, 0.35, 2.5, 0.1, 8);
    const beacon = this.mesh(
      robot,
      new THREE.SphereGeometry(0.09, 12, 8),
      glow,
      vector(0.35, 2.7, 0.1),
    );
    const arms = [];
    for (const x of [-0.65, 0.65]) {
      const arm = this.box(robot, [0.25, 0.62, 0.29], dark, x, 1.12, 0.35);
      arm.rotation.x = -0.4;
      arms.push(arm);
      this.box(robot, [0.27, 0.24, 0.27], shell, x, 0.86, 0.51);
    }
    g.add(robot);
    // Desk, monitor and a small stack of work artifacts.
    const desk = new THREE.Group();
    desk.rotation.y = 0.45;
    this.box(desk, [1.9, 0.15, 0.7], dark, 0, 0.9, 1.13);
    for (const x of [-0.7, 0.7])
      this.box(desk, [0.1, 0.6, 0.1], metal, x, 0.56, 1.15);
    const monitor = this.box(desk, [0.85, 0.6, 0.1], dark, 0, 1.3, 1.18);
    monitor.rotation.x = -0.2;
    const screen = this.box(desk, [0.71, 0.45, 0.025], glow, 0, 1.3, 1.25);
    screen.rotation.x = -0.2;
    this.box(desk, [0.62, 0.04, 0.21], shell, 0, 1, 1.5);
    this.box(desk, [0.25, 0.06, 0.32], shell, 0.65, 1.03, 1.14);
    g.add(desk);
    this.dynamic.add(g);
    const label = document.createElement("button");
    label.className = "world-agent-label";
    label.dataset.agent = agent.id;
    label.style.setProperty("--agent-color", tint);
    const title = document.createElement("strong"),
      role = document.createElement("span");
    title.textContent = agent.name;
    role.textContent = agent.role;
    label.append(title, role);
    this.labels.append(label);
    this.nodes.set(agent.id, {
      g,
      robot,
      glow,
      halo,
      arms,
      beacon,
      label,
      tint,
      anchor: vector(position.x, 3.3, position.z),
    });
  }
  path(from, to) {
    const a = this.nodes.get(from)?.g.position,
      b = this.nodes.get(to)?.g.position;
    if (!a || !b) return null;
    const start = vector(a.x, 0.4, a.z),
      end = vector(b.x, 0.4, b.z);
    // Reverse directions use opposite sides of the same corridor.
    const tangent = end.clone().sub(start).normalize();
    const side = vector(-tangent.z, 0, tangent.x).multiplyScalar(0.48);
    return new THREE.CubicBezierCurve3(
      start.clone().add(side),
      start
        .clone()
        .lerp(end, 0.33)
        .add(side)
        .add(vector(0, 1.3, 0)),
      start
        .clone()
        .lerp(end, 0.67)
        .add(side)
        .add(vector(0, 1.3, 0)),
      end.clone().add(side),
    );
  }
  rebuild(state) {
    this.release(this.dynamic);
    this.nodes.clear();
    this.edges.clear();
    this.packets.clear();
    this.labels.replaceChildren();
    const agents = Object.values(state.agents),
      slots = agentSlots(agents);
    agents.forEach((a, i) => this.buildAgent(a, slots.get(a.id), i));
    const pairs = new Map();
    for (const m of Object.values(state.messages)) {
      const key = JSON.stringify([m.fromAgentId, m.toAgentId]);
      if (!pairs.has(key))
        pairs.set(key, { from: m.fromAgentId, to: m.toAgentId, count: 0 });
      pairs.get(key).count++;
    }
    for (const [key, pair] of pairs) {
      const curve = this.path(pair.from, pair.to);
      if (!curve) continue;
      const tint = this.nodes.get(pair.from).tint;
      const mesh = this.mesh(
        this.dynamic,
        new THREE.TubeGeometry(curve, 32, 0.035, 5, false),
        new THREE.MeshBasicMaterial({ color: tint, toneMapped: false }),
        vector(0, 0, 0),
      );
      mesh.userData.pick = { from: pair.from, to: pair.to };
      this.edges.set(key, { ...pair, curve, mesh });
    }
    for (const a of agents)
      if (a.parentId && this.nodes.has(a.parentId)) {
        const from = this.nodes.get(a.parentId).g.position,
          to = this.nodes.get(a.id).g.position;
        const geometry = new THREE.BufferGeometry().setFromPoints([
          vector(from.x, 0.29, from.z),
          vector(to.x, 0.29, to.z),
        ]);
        const line = new THREE.Line(
          geometry,
          new THREE.LineDashedMaterial({
            color: "#73929a",
            dashSize: 0.2,
            gapSize: 0.16,
            transparent: true,
            opacity: 0.65,
          }),
        );
        line.computeLineDistances();
        this.dynamic.add(line);
      }
    // Bound transient geometry even on very long runs. Only the recent send window can be visible.
    const recent = Object.values(state.messages).filter(
      (m) => packetProgress(m.timestamp, this.clock) !== null,
    );
    for (const m of recent) {
      const edge = this.edges.get(JSON.stringify([m.fromAgentId, m.toAgentId]));
      if (!edge) continue;
      const obj = this.mesh(
        this.dynamic,
        new THREE.OctahedronGeometry(0.23),
        new THREE.MeshBasicMaterial({
          color: this.nodes.get(m.fromAgentId).tint,
          toneMapped: false,
        }),
        vector(0, 0, 0),
      );
      obj.castShadow = false;
      const aura = new THREE.Mesh(
        new THREE.SphereGeometry(0.36, 12, 8),
        new THREE.MeshBasicMaterial({
          color: this.nodes.get(m.fromAgentId).tint,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      obj.add(aura);
      obj.userData.pick = { messageId: m.id };
      this.packets.set(m.id, { obj, curve: edge.curve, sentAt: m.timestamp });
    }
    this.radius = Math.max(
      10,
      ...[...slots.values()].map((p) => Math.hypot(p.x, p.z) + 4),
    );
    if (this.baseRadius !== this.radius) {
      this.buildBase(this.radius);
      this.baseRadius = this.radius;
    }
    this.resize();
  }
  update(state, { clock, live, playing, selected, runId }) {
    this.state = state;
    this.clock = clock;
    this.live = live;
    this.playing = playing;
    this.wallAnchor = performance.now();
    if (this.runId !== runId) {
      this.runId = runId;
      this.resetCamera();
      this.signature = "";
    }
    const agents = Object.values(state.agents),
      messages = Object.values(state.messages);
    this.hud.textContent = !agents.length
      ? "OUTPOST EMPTY · advance the timeline"
      : `${agents.filter((a) => a.status === "working").length} WORKING · ${messages.length} HANDOFFS`;
    const rosterSignature = JSON.stringify([
      agents.map((a) => [a.id, a.name, a.role, a.status]),
      messages.map((m) => [m.id, m.fromAgentId, m.toAgentId]),
      selected,
    ]);
    if (rosterSignature !== this.rosterSignature) {
      this.rosterSignature = rosterSignature;
      this.roster.replaceChildren();
      agents.forEach((a, index) => {
        const b = document.createElement("button");
        b.className = `world-roster-agent ${selected === a.id ? "selected" : ""}`;
        b.dataset.agent = a.id;
        b.style.setProperty("--agent-color", colors[index % colors.length]);
        b.textContent = `${a.name} · ${a.role} · ${a.status}`;
        b.setAttribute("aria-pressed", String(selected === a.id));
        this.roster.append(b);
      });
      const pairs = new Map();
      for (const m of messages) {
        const key = JSON.stringify([m.fromAgentId, m.toAgentId]);
        const pair = pairs.get(key) || {
          from: m.fromAgentId,
          to: m.toAgentId,
          count: 0,
        };
        pair.count++;
        pairs.set(key, pair);
      }
      for (const p of pairs.values()) {
        const b = document.createElement("button");
        b.className = "world-route";
        b.dataset.edgeFrom = p.from;
        b.dataset.edgeTo = p.to;
        b.textContent = `${state.agents[p.from]?.name} → ${state.agents[p.to]?.name} (${p.count})`;
        this.roster.append(b);
      }
    }
    if (!this.renderer || this.lost) return;
    const signature = JSON.stringify([
      agents.map((a) => [a.id, a.parentId]),
      messages.map((m) => m.id),
      messages
        .filter((m) => packetProgress(m.timestamp, clock) !== null)
        .map((m) => m.id),
    ]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild(state);
    }
    for (const a of agents) {
      const node = this.nodes.get(a.id);
      node.label.classList.toggle("selected", selected === a.id);
      node.label.title = `${a.name} · ${a.role} · ${a.status}${a.activity ? " · " + a.activity : ""}`;
      node.label.setAttribute(
        "aria-label",
        `${a.name}, ${a.role}, ${a.status}. Inspect agent`,
      );
      node.glow.color.set(a.status === "failed" ? "#ee8c78" : node.tint);
      node.glow.emissive.copy(node.glow.color);
      node.glow.emissiveIntensity =
        selected === a.id ? 1.8 : a.status === "working" ? 1.15 : 0.45;
      node.halo.scale.setScalar(selected === a.id ? 1.06 : 1);
    }
  }
  animate(now) {
    // In replay, all activity freezes exactly at the selected event/time.
    const clock = this.clock + (this.live ? now - this.wallAnchor : 0);
    const t = clock / 1000;
    for (const [id, node] of this.nodes) {
      const working = this.state.agents[id].status === "working";
      node.robot.position.y =
        !reduced.matches && working ? Math.sin(t * 3) * 0.045 : 0;
      for (const [i, arm] of node.arms.entries())
        arm.rotation.x =
          -0.4 +
          (!reduced.matches && working ? Math.sin(t * 7 + i * 2) * 0.16 : 0);
      node.beacon.scale.setScalar(
        working && !reduced.matches ? 1 + Math.sin(t * 4) * 0.2 : 1,
      );
    }
    for (const packet of this.packets.values()) {
      const progress = packetProgress(packet.sentAt, clock);
      packet.obj.visible = progress !== null;
      if (progress !== null) {
        packet.obj.position.copy(
          packet.curve.getPoint(reduced.matches ? 0.5 : progress),
        );
        packet.obj.rotation.set(
          reduced.matches ? 0 : t,
          reduced.matches ? 0 : t,
          0,
        );
      }
    }
  }
  positionLabels() {
    const rect = this.host.getBoundingClientRect();
    for (const node of this.nodes.values()) {
      const point = node.anchor.clone().project(this.camera);
      node.label.style.left = `${((point.x + 1) * rect.width) / 2}px`;
      node.label.style.top = `${((1 - point.y) * rect.height) / 2}px`;
      node.label.hidden =
        point.z > 1 || Math.abs(point.x) > 1.15 || Math.abs(point.y) > 1.15;
    }
  }
  resize() {
    if (!this.renderer || this.lost) return;
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.moveCamera();
  }
  moveCamera() {
    if (!this.camera) return;
    const distance =
      (this.radius || 10) *
      2.7 *
      this.zoom *
      Math.max(1, 0.95 / this.camera.aspect);
    this.camera.position.set(
      Math.sin(this.angle) * Math.cos(this.tilt) * distance,
      Math.sin(this.tilt) * distance,
      Math.cos(this.angle) * Math.cos(this.tilt) * distance,
    );
    this.camera.lookAt(0, 0.6, 0);
  }
  resetCamera() {
    this.angle = 0.75;
    this.tilt = 0.8;
    this.zoom = 1;
    this.moveCamera();
  }
  pick(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(
      this.dynamic.children,
      true,
    )) {
      let object = hit.object;
      while (object && !object.userData.pick) object = object.parent;
      if (object?.userData.pick) {
        this.onPick(object.userData.pick);
        return;
      }
    }
  }
  bindControls() {
    const listen = (target, event, handler, options) => {
      target.addEventListener(event, handler, options);
      this.disposers.push(() =>
        target.removeEventListener(event, handler, options),
      );
    };
    let drag = null;
    listen(this.canvas, "pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = {
        x: e.clientX,
        y: e.clientY,
        angle: this.angle,
        tilt: this.tilt,
        moved: false,
        id: e.pointerId,
      };
      this.canvas.setPointerCapture(e.pointerId);
    });
    listen(this.canvas, "pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      if (drag.moved) {
        this.angle = drag.angle - dx * 0.006;
        this.tilt = Math.max(0.32, Math.min(1.3, drag.tilt + dy * 0.005));
        this.moveCamera();
      }
    });
    listen(this.canvas, "pointerup", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const moved = drag.moved;
      drag = null;
      this.canvas.releasePointerCapture(e.pointerId);
      if (!moved) this.pick(e);
    });
    listen(this.canvas, "pointercancel", () => {
      drag = null;
    });
    listen(
      this.canvas,
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoom = Math.max(
          0.65,
          Math.min(2.2, this.zoom + e.deltaY * 0.0006),
        );
        this.moveCamera();
      },
      { passive: false },
    );
    listen(document.getElementById("world-reset"), "click", () =>
      this.resetCamera(),
    );
    listen(document.getElementById("world-zoom-in"), "click", () => {
      this.zoom = Math.max(0.65, this.zoom - 0.15);
      this.moveCamera();
    });
    listen(document.getElementById("world-zoom-out"), "click", () => {
      this.zoom = Math.min(2.2, this.zoom + 0.15);
      this.moveCamera();
    });
  }
  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    for (const dispose of this.disposers || []) dispose();
    if (this.canvas)
      this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    if (this.scene) this.release(this.scene);
    this.renderer?.dispose();
  }
}
