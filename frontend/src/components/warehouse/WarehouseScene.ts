// Imperative three.js warehouse scene. Loaded on demand (dynamic import) so three.js and the truck
// model are fetched only when someone opens the 3D view. Racks, pallets, cartons, status tags and
// click targets are InstancedMeshes, so a full warehouse renders in about a dozen draw calls.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TRUCK_MODEL_URL } from "../../utils/truckSprites";
import { BAY_W, LEVEL_H, RACK_D, STATUS_COLOR, type Bay, type Layout } from "../../utils/warehouseLayout";

export type Preset = "overview" | "aisle" | "cold" | "dock" | "quarantine";

export interface SceneHandle {
  setPreset: (p: Preset) => void;
  select: (bayId: string | null) => void;
  dispose: () => void;
}

const AISLE = 3.2;
const WALL_H = 7;

function box(): THREE.BoxGeometry { return new THREE.BoxGeometry(1, 1, 1); }

function label(text: string, opts: { bg?: string; fg?: string; px?: number; height?: number } = {}): THREE.Sprite {
  const px = opts.px ?? 44;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `600 ${px}px Inter, system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + px;
  canvas.width = w;
  canvas.height = Math.ceil(px * 1.6);
  ctx.font = `600 ${px}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = opts.bg ?? "rgba(15,23,42,0.85)";
  const r = px * 0.35;
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, r);
  ctx.fill();
  ctx.fillStyle = opts.fg ?? "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, px / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  const h = opts.height ?? 0.45;
  sprite.scale.set((h * canvas.width) / canvas.height, h, 1);
  return sprite;
}

export function mountWarehouse(container: HTMLElement, layout: Layout, cb: {
  onSelect: (bay: Bay | null) => void; onReady: () => void;
}): SceneHandle {
  const { theme, width, depth } = layout;
  const renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8eef6);
  scene.fog = new THREE.Fog(0xe8eef6, Math.max(width, depth) * 1.6, Math.max(width, depth) * 3.2);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.minDistance = 2.5;
  controls.maxDistance = Math.max(width, depth) * 2.2;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a94a6, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(width * 0.4, 40, depth * 0.6);
  scene.add(sun);

  const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra });
  const unit = box();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const put = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    mesh.setMatrixAt(i, m4);
  };

  // ---------------- building shell ----------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width + 30, depth + 30), mat(theme.floor, { roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const wallMat = mat(theme.wall, { roughness: 0.9 });
  const walls = [
    { x: 0, z: -depth / 2, sx: width, sz: 0.3 },
    { x: -width / 2, z: 0, sx: 0.3, sz: depth },
    { x: width / 2, z: 0, sx: 0.3, sz: depth },
  ];
  for (const w of walls) {
    const m = new THREE.Mesh(unit, wallMat);
    m.position.set(w.x, WALL_H / 2, w.z);
    m.scale.set(w.sx, WALL_H, w.sz);
    scene.add(m);
  }

  // ---------------- racks ----------------
  const uprightCount = layout.racks.reduce((s, r) => s + (r.bays + 1) * 2, 0);
  const beamCount = layout.racks.reduce((s, r) => s + (r.levels + 1) * 2, 0);
  const deckCount = layout.racks.reduce((s, r) => s + r.levels, 0);
  const uprights = new THREE.InstancedMesh(unit, mat(theme.upright, { metalness: 0.4, roughness: 0.5 }), uprightCount);
  const beams = new THREE.InstancedMesh(unit, mat(theme.beam, { metalness: 0.3, roughness: 0.5 }), beamCount);
  const decks = new THREE.InstancedMesh(unit, mat(theme.deck, { metalness: 0.2 }), deckCount);
  let ui = 0, bi = 0, di = 0;
  for (const r of layout.racks) {
    const len = r.bays * BAY_W;
    const h = r.levels * LEVEL_H + 0.4;
    for (let s = 0; s <= r.bays; s++) {
      const x = r.x - len / 2 + s * BAY_W;
      put(uprights, ui++, x, h / 2, r.z - RACK_D / 2, 0.08, h, 0.08);
      put(uprights, ui++, x, h / 2, r.z + RACK_D / 2, 0.08, h, 0.08);
    }
    for (let l = 0; l <= r.levels; l++) {
      const y = 0.1 + l * LEVEL_H;
      put(beams, bi++, r.x, y, r.z + RACK_D / 2, len, 0.12, 0.06);
      put(beams, bi++, r.x, y, r.z - RACK_D / 2, len, 0.12, 0.06);
      if (l < r.levels) put(decks, di++, r.x, y + 0.05, r.z, len, 0.03, RACK_D);
    }
  }
  scene.add(uprights, beams, decks);

  // ---------------- stock: pallets, cartons, status tags, click targets ----------------
  const stocked = [...layout.bays, ...layout.quarantine];
  const c = theme.carton;
  const perBay = c.cols * c.rows * c.layers;
  const cartons = new THREE.InstancedMesh(unit, mat(0xffffff, { roughness: 0.85 }), stocked.length * perBay);
  const pallets = new THREE.InstancedMesh(unit, mat(0xa16207, { roughness: 0.9 }), stocked.length);
  const tags = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({ color: 0xffffff }), stocked.length);
  const hits = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), stocked.length);
  const col = new THREE.Color();
  let ci = 0, pi = 0;
  stocked.forEach((bay, i) => {
    const floorPallet = bay.zone === "quarantine";
    const onPallet = theme.pallets || floorPallet;
    const spanW = floorPallet ? 1.2 : BAY_W - 0.3;
    const spanD = floorPallet ? 1.0 : RACK_D - 0.12;
    let baseY = bay.y + (floorPallet ? 0 : 0.08);
    if (onPallet) {
      put(pallets, pi++, bay.x, baseY + 0.07, bay.z, spanW, 0.14, spanD);
      baseY += 0.14;
    }
    const cw = Math.min(c.w, (spanW / c.cols) * 0.94), cd = Math.min(c.d, (spanD / c.rows) * 0.94);
    const n = Math.max(1, Math.round(bay.fill * perBay));
    for (let k = 0; k < n; k++) {
      const layer = Math.floor(k / (c.cols * c.rows)), rem = k % (c.cols * c.rows);
      const cx = rem % c.cols, cz = Math.floor(rem / c.cols);
      put(cartons, ci, bay.x - spanW / 2 + (cx + 0.5) * (spanW / c.cols), baseY + c.h / 2 + layer * c.h, bay.z - spanD / 2 + (cz + 0.5) * (spanD / c.rows), cw, c.h * 0.96, cd);
      col.setHex(bay.color).offsetHSL(0, 0, ((k * 37) % 9 - 4) * 0.012);
      cartons.setColorAt(ci++, col);
    }
    const tagY = floorPallet ? 0.02 : bay.y + 0.04;
    put(tags, i, bay.x, tagY, bay.z + (floorPallet ? spanD / 2 + 0.05 : RACK_D / 2 + 0.05), 0.42, floorPallet ? 0.04 : 0.12, 0.03);
    tags.setColorAt(i, col.setHex(STATUS_COLOR[bay.batch.status] ?? 0x16a34a));
    const hh = floorPallet ? 1.2 : LEVEL_H - 0.1;
    put(hits, i, bay.x, bay.y + hh / 2, bay.z, floorPallet ? 1.3 : BAY_W - 0.06, hh, floorPallet ? 1.1 : RACK_D + 0.1);
  });
  cartons.count = ci;
  pallets.count = pi;
  for (const m of [cartons, tags]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  scene.add(cartons, pallets, tags, hits);

  // ---------------- floor markings ----------------
  const lines = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xfacc15 }), layout.racks.length * 2);
  layout.racks.forEach((r, i) => {
    const len = r.bays * BAY_W;
    for (const [j, dz] of [[0, RACK_D / 2 + 0.25], [1, -RACK_D / 2 - 0.25]] as const) {
      m4.compose(new THREE.Vector3(r.x, 0.012, r.z + dz), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(len, 0.1, 1));
      lines.setMatrixAt(i * 2 + j, m4);
    }
  });
  scene.add(lines);

  // ---------------- zones ----------------
  const zonePlane = (rect: { x0: number; x1: number; z0: number; z1: number }, color: number, opacity = 1) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(rect.x1 - rect.x0, rect.z1 - rect.z0),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: opacity < 1, opacity }));
    p.rotation.x = -Math.PI / 2;
    p.position.set((rect.x0 + rect.x1) / 2, 0.006, (rect.z0 + rect.z1) / 2);
    scene.add(p);
  };
  const { cold, quarantine, dock } = layout.zones;
  if (cold) {
    zonePlane(cold, theme.coldTint, 0.35);
    const glass = new THREE.MeshStandardMaterial({ color: theme.coldTint, transparent: true, opacity: 0.16, roughness: 0.1, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const cw = cold.x1 - cold.x0, cd = cold.z1 - cold.z0, cx = (cold.x0 + cold.x1) / 2, cz = (cold.z0 + cold.z1) / 2, gh = 5.2;
    for (const g of [{ x: cx, z: cold.z1, sx: cw, sz: 0.05 }, { x: cold.x0, z: cz, sx: 0.05, sz: cd }]) {
      const pane = new THREE.Mesh(unit, glass);
      pane.position.set(g.x, gh / 2, g.z);
      pane.scale.set(g.sx, gh, g.sz);
      scene.add(pane);
    }
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(cw, gh, cd)), new THREE.LineBasicMaterial({ color: 0x0369a1 }));
    frame.position.set(cx, gh / 2, cz);
    scene.add(frame);
    const s = label(`❄ ${theme.coldLabel}`, { bg: "rgba(3,105,161,0.9)", height: 0.6 });
    s.position.set(cx, gh + 0.6, cold.z1);
    scene.add(s);
  }
  if (quarantine) {
    zonePlane(quarantine, 0xfecaca, 0.8);
    const qw = quarantine.x1 - quarantine.x0, qd = quarantine.z1 - quarantine.z0;
    const fence = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(qw, 2.2, qd)), new THREE.LineBasicMaterial({ color: 0xdc2626 }));
    fence.position.set((quarantine.x0 + quarantine.x1) / 2, 1.1, (quarantine.z0 + quarantine.z1) / 2);
    scene.add(fence);
    const s = label(`⛔ ${theme.quarantineLabel}`, { bg: "rgba(185,28,28,0.9)", height: 0.5 });
    s.position.set((quarantine.x0 + quarantine.x1) / 2, 2.8, quarantine.z1);
    scene.add(s);
  }
  zonePlane({ ...dock, z0: dock.z0 + 1 }, 0x64748b, 0.25);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(width + 30, 16), mat(0x475569, { roughness: 1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, 0.004, depth / 2 + 8);
  scene.add(apron);
  const doorMat = mat(0x334155, { metalness: 0.5, roughness: 0.4 });
  const doorXs = [-width / 4, 0, width / 4];
  // low dock wall along the front, with a gap at each door
  const edges = [-width / 2, ...doorXs.flatMap((x) => [x - 1.8, x + 1.8]), width / 2];
  for (let i = 0; i < edges.length; i += 2) {
    const seg = new THREE.Mesh(unit, wallMat);
    seg.position.set((edges[i] + edges[i + 1]) / 2, 0.6, depth / 2);
    seg.scale.set(edges[i + 1] - edges[i], 1.2, 0.3);
    scene.add(seg);
  }
  for (const dx of doorXs) {
    const frame = new THREE.Mesh(unit, mat(0xfacc15));
    frame.position.set(dx, 2.3, depth / 2);
    frame.scale.set(3.6, 4.6, 0.2);
    scene.add(frame);
    const door = new THREE.Mesh(unit, doorMat);
    door.position.set(dx, 2.15, depth / 2 + 0.05);
    door.scale.set(3.2, 4.3, 0.2);
    scene.add(door);
  }
  const dockSign = label("Loading dock", { bg: "rgba(51,65,85,0.9)", height: 0.55 });
  dockSign.position.set(0, 5.2, depth / 2);
  scene.add(dockSign);
  const ambSign = label(theme.ambientLabel, { bg: "rgba(15,23,42,0.85)", height: 0.6 });
  ambSign.position.set(layout.racks[0]?.x ?? 0, WALL_H - 0.4, -depth / 2 + 0.3);
  scene.add(ambSign);

  // product signs and rack letters
  for (const s of layout.productSigns) {
    const sp = label(s.text.length > 28 ? `${s.text.slice(0, 27)}…` : s.text, { height: 0.32 });
    sp.position.set(s.x, s.y, s.z);
    scene.add(sp);
  }
  for (const r of layout.racks) {
    const sp = label(r.id, { bg: "rgba(250,204,21,0.95)", fg: "#0f172a", height: 0.5 });
    sp.position.set(r.x - (r.bays * BAY_W) / 2 - 0.4, r.levels * LEVEL_H + 0.8, r.z + RACK_D / 2);
    scene.add(sp);
  }

  // ---------------- forklift (animated) ----------------
  const fork = new THREE.Group();
  const yellow = mat(0xf59e0b, { metalness: 0.2 });
  const dark = mat(0x1f2937, { metalness: 0.4, roughness: 0.5 });
  const partBox = (m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const p = new THREE.Mesh(unit, m);
    p.position.set(x, y, z);
    p.scale.set(sx, sy, sz);
    fork.add(p);
  };
  partBox(yellow, 0, 0.55, 0, 1.6, 0.7, 1.0);
  partBox(dark, -0.2, 1.25, 0, 0.9, 0.08, 0.9);
  partBox(dark, -0.55, 0.95, 0.4, 0.06, 0.7, 0.06);
  partBox(dark, -0.55, 0.95, -0.4, 0.06, 0.7, 0.06);
  partBox(dark, 0.9, 1.3, 0.3, 0.08, 2.2, 0.08);
  partBox(dark, 0.9, 1.3, -0.3, 0.08, 2.2, 0.08);
  partBox(dark, 1.4, 0.15, 0.25, 1.0, 0.06, 0.12);
  partBox(dark, 1.4, 0.15, -0.25, 1.0, 0.06, 0.12);
  partBox(mat(0xc08552), 1.4, 0.45, 0, 0.8, 0.5, 0.7);
  const wheel = new THREE.CylinderGeometry(0.25, 0.25, 0.2, 16);
  for (const [x, z] of [[-0.5, 0.55], [-0.5, -0.55], [0.55, 0.55], [0.55, -0.55]]) {
    const w = new THREE.Mesh(wheel, dark);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.25, z);
    fork.add(w);
  }
  const firstRack = layout.racks.find((r) => r.zone === "ambient");
  const aisleZ = (firstRack?.z ?? 0) + RACK_D / 2 + AISLE / 2;
  const aisleX0 = firstRack ? firstRack.x - (firstRack.bays * BAY_W) / 2 : -width / 3;
  const aisleSpan = Math.min(width * 0.6, 26);
  fork.position.set(aisleX0, 0, aisleZ);
  scene.add(fork);

  // ---------------- truck at the dock (real GLB model) ----------------
  new GLTFLoader().load(TRUCK_MODEL_URL, (gltf) => {
    const model = gltf.scene;
    const bb = new THREE.Box3().setFromObject(model);
    const size = bb.getSize(new THREE.Vector3());
    model.position.sub(bb.getCenter(new THREE.Vector3()));
    const align = new THREE.Group();
    align.add(model);
    if (size.z > size.x) align.rotation.y = -Math.PI / 2;
    const scale = 7.5 / Math.max(size.x, size.z);
    const truck = new THREE.Group();
    truck.add(align);
    truck.scale.setScalar(scale);
    truck.rotation.y = -Math.PI / 2;     // cab away from the building, rear at the door
    truck.position.set(doorXs[0], (size.y * scale) / 2, depth / 2 + 4.6);
    scene.add(truck);
  }, undefined, () => { /* the truck is decoration; the warehouse works without it */ });

  // ---------------- selection + camera ----------------
  const highlight = new THREE.LineSegments(new THREE.EdgesGeometry(unit), new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true }));
  highlight.visible = false;
  scene.add(highlight);

  const tween = { active: false, t0: 0, dur: 900, fromP: new THREE.Vector3(), toP: new THREE.Vector3(), fromT: new THREE.Vector3(), toT: new THREE.Vector3() };
  const flyTo = (pos: THREE.Vector3, target: THREE.Vector3) => {
    tween.fromP.copy(camera.position);
    tween.fromT.copy(controls.target);
    tween.toP.copy(pos);
    tween.toT.copy(target);
    tween.t0 = performance.now();
    tween.active = true;
  };
  const presets: Record<Preset, () => [THREE.Vector3, THREE.Vector3]> = {
    overview: () => [new THREE.Vector3(width * 0.32, Math.max(width, depth) * 0.42, depth * 0.78), new THREE.Vector3(0, 1.5, -depth * 0.08)],
    aisle: () => [new THREE.Vector3(aisleX0 - 1.5, 1.7, aisleZ), new THREE.Vector3(aisleX0 + 12, 2.2, aisleZ)],
    cold: () => {
      const z = cold ?? { x0: 0, x1: 0, z0: 0, z1: 0 };
      const cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2;
      return [new THREE.Vector3(cx - 2, 6, z.z1 + 7), new THREE.Vector3(cx, 2, cz)];
    },
    dock: () => [new THREE.Vector3(width * 0.25, 6.5, depth / 2 + 16), new THREE.Vector3(0, 1.8, depth / 2 - 2)],
    quarantine: () => {
      const z = quarantine ?? dock;
      const cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2;
      return [new THREE.Vector3(cx - 4, 5, cz + 8), new THREE.Vector3(cx, 0.8, cz)];
    },
  };
  const [p0, t0] = presets.overview();
  camera.position.copy(p0);
  controls.target.copy(t0);

  const selectIndex = (i: number | null, focus: boolean) => {
    if (i === null) {
      highlight.visible = false;
      cb.onSelect(null);
      return;
    }
    hits.getMatrixAt(i, m4);
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    m4.decompose(pos, q, scl);
    highlight.position.copy(pos);
    highlight.scale.copy(scl).multiplyScalar(1.03);
    highlight.visible = true;
    cb.onSelect(stocked[i]);
    if (focus) {
      const offset = camera.position.clone().sub(controls.target);
      const dist = Math.min(offset.length(), 9);
      flyTo(pos.clone().add(offset.setLength(dist)), pos);
    }
  };

  // click vs drag: only a press that barely moves selects
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  const pick = (ev: PointerEvent): number | null => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(hits, false)[0];
    return hit?.instanceId ?? null;
  };
  const onDown = (ev: PointerEvent) => { down = { x: ev.clientX, y: ev.clientY }; };
  const onUp = (ev: PointerEvent) => {
    if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 6) selectIndex(pick(ev), true);
    down = null;
  };
  let lastHover = 0;
  const onMove = (ev: PointerEvent) => {
    const now = performance.now();
    if (now - lastHover < 60 || down) return;
    lastHover = now;
    renderer.domElement.style.cursor = pick(ev) !== null ? "pointer" : "grab";
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointermove", onMove);

  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let raf = 0;
  let ready = false;
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    if (tween.active) {
      const k = Math.min(1, (t - tween.t0) / tween.dur), e = ease(k);
      camera.position.lerpVectors(tween.fromP, tween.toP, e);
      controls.target.lerpVectors(tween.fromT, tween.toT, e);
      if (k >= 1) tween.active = false;
    }
    // forklift drives up and down the first aisle, turning at each end
    const cycle = 16000, u = (t % cycle) / cycle, leg = u < 0.5 ? u * 2 : (1 - u) * 2;
    fork.position.x = aisleX0 + ease(leg) * aisleSpan;
    fork.rotation.y = u < 0.5 ? 0 : Math.PI;
    if (highlight.visible) (highlight.material as THREE.LineBasicMaterial).opacity = 0.55 + 0.45 * Math.sin(t / 220);
    controls.update();
    renderer.render(scene, camera);
    if (!ready) { ready = true; cb.onReady(); }
  };
  raf = requestAnimationFrame(loop);

  return {
    setPreset: (p) => { const [pos, target] = presets[p](); flyTo(pos, target); },
    select: (bayId) => {
      const i = bayId === null ? null : stocked.findIndex((b) => b.id === bayId);
      selectIndex(i !== null && i >= 0 ? i : null, true);
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mt of mats) {
          (mt as THREE.MeshStandardMaterial).map?.dispose();
          mt.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
