import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { usePlanner } from "../hooks/usePlanner";
import type { Outlet, Route, Warehouse } from "../types/api";
import { cx } from "../utils/format";

interface DistributionSimulation3DProps {
  warehouses: Warehouse[];
  outlets: Outlet[];
  flows?: { w: string; d: string; qty: number }[];
  routes?: Route[];
  onSelectWarehouse: (w: Warehouse) => void;
  height?: number;
}

// Convert geographic coordinates (lat, lon) in India to 3D world space (X, 0, Z)
function geoTo3D(lat: number, lon: number): [number, number, number] {
  // Center of India roughly lat: 21.5, lon: 78.5
  const centerLat = 21.5;
  const centerLon = 78.5;
  const scale = 2.4;
  const x = (lon - centerLon) * scale;
  const z = -(lat - centerLat) * scale; // -lat so north is towards -Z
  return [x, 0, z];
}

export function DistributionSimulation3D({
  warehouses,
  outlets,
  flows = [],
  routes = [],
  onSelectWarehouse,
  height = 580,
}: DistributionSimulation3DProps) {
  const p = usePlanner();
  const mountRef = useRef<HTMLDivElement>(null);
  const [hidden3D, setHidden3D] = useState(false);
  const [hoveredWH, setHoveredWH] = useState<string | null>(null);

  // Projected 2D coordinates for warehouse labels
  const [whLabels, setWhLabels] = useState<
    { id: string; name: string; city: string; cap: string; x: number; y: number }[]
  >([]);

  // Legend counts
  const pharmaCount = useMemo(
    () => outlets.filter((o) => o.storage.includes("chilled") || o.type.toLowerCase().includes("hospital") || o.type.toLowerCase().includes("pharmacy")).length,
    [outlets]
  );
  const retailCount = useMemo(() => outlets.length - pharmaCount, [outlets, pharmaCount]);

  // Brand title
  const brandTitle = useMemo(() => {
    if (p.module === "grocery") return "Nestlé Grocery 3D Network";
    if (p.module === "cosmetics") return "Lakmé Beauty 3D Network";
    return "Cipla Pharma GDP 3D Network";
  }, [p.module]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || hidden3D) return;

    const width = container.clientWidth;
    const currentHeight = height;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080d1a);
    scene.fog = new THREE.FogExp2(0x080d1a, 0.008);

    const camera = new THREE.PerspectiveCamera(45, width / currentHeight, 0.1, 1000);
    camera.position.set(0, 38, 48);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, currentHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.08; // Keep above floor
    controls.minDistance = 15;
    controls.maxDistance = 110;
    controls.target.set(0, 0, 0);

    // 1. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(20, 45, 30);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // 2. Floor & Perspective Grid
    const floorGeo = new THREE.PlaneGeometry(120, 100);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x090f1f,
      roughness: 0.8,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(120, 60, 0x1e293b, 0x0f172a);
    grid.position.y = 0.01;
    scene.add(grid);

    // 3. Interactive Warehouse Nodes
    const warehouseMeshes: THREE.Group[] = [];
    const interactiveWarehouseObjects: THREE.Object3D[] = [];
    const whPositions: Record<string, THREE.Vector3> = {};

    warehouses.forEach((w, idx) => {
      const [wx, wy, wz] = geoTo3D(w.lat, w.lon);
      const whPos = new THREE.Vector3(wx, wy, wz);
      whPositions[w.warehouse_id] = whPos;

      const group = new THREE.Group();
      group.position.set(wx, wy, wz);
      group.userData = { warehouseId: w.warehouse_id, warehouse: w };

      // Building Body
      const bodyGeo = new THREE.BoxGeometry(4.2, 2.4, 3.2);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        metalness: 0.5,
        roughness: 0.3,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 1.2;
      body.castShadow = true;
      group.add(body);

      // Pitched Roof with Brand / Vertical Color Accent
      const roofGeo = new THREE.ConeGeometry(3.3, 1.2, 4);
      const brandColor =
        p.module === "grocery" ? 0x10b981 : p.module === "cosmetics" ? 0xe879f9 : 0x06b6d4;
      const roofMat = new THREE.MeshStandardMaterial({
        color: brandColor,
        roughness: 0.4,
      });
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 2.9;
      group.add(roof);

      // Loading Dock / Roll-up Door (Orange accent)
      const doorGeo = new THREE.PlaneGeometry(1.4, 1.1);
      const doorMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b });
      const door = new THREE.Mesh(doorGeo, doorMat);
      door.position.set(0, 0.6, 1.62);
      group.add(door);

      // Glowing Circular Base Ring (Matching Image 2)
      const ringGeo = new THREE.RingGeometry(3.2, 3.8, 32);
      const ringColor = idx % 2 === 0 ? 0x10b981 : 0xf59e0b;
      const ringMat = new THREE.MeshBasicMaterial({
        color: ringColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      ring.userData = { isRing: true };
      group.add(ring);

      // Invisible Click Hitbox
      const hitGeo = new THREE.BoxGeometry(7, 6, 7);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitBox = new THREE.Mesh(hitGeo, hitMat);
      hitBox.position.y = 2;
      hitBox.userData = { warehouseId: w.warehouse_id, warehouse: w };
      group.add(hitBox);

      scene.add(group);
      warehouseMeshes.push(group);
      interactiveWarehouseObjects.push(hitBox, body, roof);
    });

    // 4. Destination Outlets / Stores (3D Pins)
    const outletPositions: Record<string, THREE.Vector3> = {};
    outlets.forEach((o) => {
      const [ox, oy, oz] = geoTo3D(o.lat, o.lon);
      const oPos = new THREE.Vector3(ox, oy, oz);
      outletPositions[o.outlet_id] = oPos;

      const group = new THREE.Group();
      group.position.set(ox, oy, oz);

      // Color code by store type / cold-chain
      const isPharma =
        o.storage.includes("chilled") ||
        o.type.toLowerCase().includes("hospital") ||
        o.type.toLowerCase().includes("pharmacy");
      const pinColor = isPharma ? 0xa855f7 : 0x10b981;

      // Pin base cylinder
      const baseGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.3, 16);
      const baseMat = new THREE.MeshStandardMaterial({ color: pinColor, roughness: 0.3 });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.15;
      group.add(base);

      // Pin storefront cone / pyramid
      const coneGeo = new THREE.ConeGeometry(0.9, 1.8, 6);
      const coneMat = new THREE.MeshStandardMaterial({ color: pinColor, metalness: 0.2 });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.y = 1.2;
      group.add(cone);

      // Top glowing pearl
      const pearlGeo = new THREE.SphereGeometry(0.35, 12, 12);
      const pearlMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const pearl = new THREE.Mesh(pearlGeo, pearlMat);
      pearl.position.y = 2.2;
      group.add(pearl);

      scene.add(group);
    });

    // 5. Arced 3D Delivery Route Curves & Animated Trucks
    interface ActiveTruck {
      mesh: THREE.Group;
      curve: THREE.CatmullRomCurve3;
      progress: number;
      speed: number;
    }
    const animatedTrucks: ActiveTruck[] = [];

    // Derive active connections from flows or routes
    const connections: { wId: string; dId: string; cold: boolean }[] = [];
    if (flows.length > 0) {
      flows.forEach((f) => {
        if (whPositions[f.w] && outletPositions[f.d]) {
          connections.push({ wId: f.w, dId: f.d, cold: true });
        }
      });
    } else {
      // Default delivery routes
      routes.slice(0, 16).forEach((r, i) => {
        if (whPositions[r.warehouse_id] && outletPositions[r.outlet_id]) {
          connections.push({
            wId: r.warehouse_id,
            dId: r.outlet_id,
            cold: i % 2 === 0,
          });
        }
      });
    }

    // Deduplicate pairs
    const pairMap = new Map<string, { wId: string; dId: string; cold: boolean }>();
    connections.forEach((c) => pairMap.set(`${c.wId}-${c.dId}`, c));

    Array.from(pairMap.values()).forEach((conn, cIdx) => {
      const p1 = whPositions[conn.wId];
      const p2 = outletPositions[conn.dId];
      if (!p1 || !p2) return;

      // Parabolic midpoint arcing up in the air
      const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      const dist = p1.distanceTo(p2);
      mid.y = Math.min(8.5, Math.max(3.5, dist * 0.25));

      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(p1.x, 0.4, p1.z),
        mid,
        new THREE.Vector3(p2.x, 0.3, p2.z),
      ]);

      // Glowing route arc line
      const points = curve.getPoints(36);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineColor = conn.cold ? 0x06b6d4 : 0x6366f1;
      const lineMat = new THREE.LineBasicMaterial({
        color: lineColor,
        transparent: true,
        opacity: 0.65,
        linewidth: 2,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      scene.add(line);

      // 3D Delivery Truck on this curve
      const truck = new THREE.Group();
      // Cab
      const cab = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.7, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x2563eb })
      );
      cab.position.set(0.4, 0.4, 0);
      truck.add(cab);
      // Trailer
      const trailer = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.8, 0.7),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b })
      );
      trailer.position.set(-0.4, 0.45, 0);
      truck.add(trailer);
      // Headlight
      const light = new THREE.PointLight(0xffffff, 2, 5);
      light.position.set(0.8, 0.4, 0);
      truck.add(light);

      truck.scale.setScalar(0.7);
      scene.add(truck);

      animatedTrucks.push({
        mesh: truck,
        curve,
        progress: (cIdx * 0.17) % 1.0,
        speed: 0.0018 + (cIdx % 4) * 0.0005,
      });
    });

    // 6. Raycasting for Warehouse Click -> Opens 3D Warehouse Interior!
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(interactiveWarehouseObjects, true);

      if (intersects.length > 0) {
        let curr: THREE.Object3D | null = intersects[0].object;
        while (curr && !curr.userData.warehouse) {
          curr = curr.parent;
        }
        if (curr?.userData.warehouse) {
          // Open 3D warehouse interior!
          onSelectWarehouse(curr.userData.warehouse as Warehouse);
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(interactiveWarehouseObjects, true);

      if (intersects.length > 0) {
        renderer.domElement.style.cursor = "pointer";
        let curr: THREE.Object3D | null = intersects[0].object;
        while (curr && !curr.userData.warehouseId) {
          curr = curr.parent;
        }
        setHoveredWH(curr?.userData.warehouseId ?? null);
      } else {
        renderer.domElement.style.cursor = "default";
        setHoveredWH(null);
      }
    };

    renderer.domElement.addEventListener("click", handleClick);
    renderer.domElement.addEventListener("mousemove", handleMouseMove);

    // 7. Animation Loop
    let animId: number;
    const projectToScreen = (pos: THREE.Vector3) => {
      const p = pos.clone();
      p.project(camera);
      if (p.z > 1) return null;
      const x = (p.x * 0.5 + 0.5) * width;
      const y = (-(p.y * 0.5) + 0.5) * currentHeight;
      return { x, y };
    };

    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();

      // Animate trucks along curves
      animatedTrucks.forEach((t) => {
        t.progress = (t.progress + t.speed) % 1.0;
        const pt = t.curve.getPointAt(t.progress);
        const tangent = t.curve.getTangentAt(t.progress);
        t.mesh.position.copy(pt);
        t.mesh.lookAt(pt.clone().add(tangent));
      });

      // Pulse base rings
      const time = performance.now() * 0.002;
      warehouseMeshes.forEach((whGroup, idx) => {
        const ring = whGroup.children.find((c) => c.userData.isRing) as THREE.Mesh | undefined;
        if (ring) {
          const s = 1 + Math.sin(time + idx) * 0.08;
          ring.scale.set(s, s, s);
        }
      });

      // Project warehouse HUD label positions
      const labels = warehouses
        .map((w, idx) => {
          const pos = whPositions[w.warehouse_id];
          if (!pos) return null;
          const topPos = pos.clone().add(new THREE.Vector3(0, 4.4, 0));
          const screen = projectToScreen(topPos);
          if (!screen) return null;
          const capPercent = 75 + ((idx * 6) % 20); // 75% - 95% Cap
          return {
            id: w.warehouse_id,
            name: w.name,
            city: w.city,
            cap: `${capPercent}% Cap`,
            x: screen.x,
            y: screen.y,
          };
        })
        .filter((l): l is NonNullable<typeof l> => l !== null);
      setWhLabels(labels);

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const newWidth = container.clientWidth;
      camera.aspect = newWidth / currentHeight;
      camera.updateProjectionMatrix;
      renderer.setSize(newWidth, currentHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("click", handleClick);
      renderer.domElement.removeEventListener("mousemove", handleMouseMove);
      renderer.dispose();
    };
  }, [warehouses, outlets, flows, routes, hidden3D, height, onSelectWarehouse, p.module]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#060b17] text-white shadow-2xl overflow-hidden">
      {/* 1. Header Bar matching Image 2 */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-900/80 px-6 py-4 backdrop-blur">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-bold tracking-tight text-white">Recommended 3D Distribution Simulation</h2>
            <span className="flex items-center gap-1.5 rounded-full bg-blue-500/15 border border-blue-400/30 px-3 py-0.5 text-xs font-semibold text-blue-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Animated Trucks En Route
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Simulates dispatch routes computed by the optimizer across origin warehouses and retail stores
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setHidden3D(!hidden3D)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
          >
            {hidden3D ? <Eye size={14} /> : <EyeOff size={14} />} {hidden3D ? "Show 3D" : "Hide 3D"}
          </button>
        </div>
      </div>

      {/* 2. Interactive 3D Viewport */}
      {!hidden3D && (
        <div className="relative w-full overflow-hidden" style={{ height }}>
          <div ref={mountRef} className="h-full w-full" />

          {/* Top-Left Legend Overlay matching Image 2 */}
          <div className="absolute left-6 top-6 z-10 w-64 rounded-2xl border border-slate-700/60 bg-slate-900/85 p-3.5 shadow-xl backdrop-blur">
            <div className="space-y-2 text-xs font-medium">
              <div className="flex items-center gap-2.5 text-slate-200 font-semibold border-b border-slate-800 pb-2">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shadow-sm shadow-blue-500/50" />
                <span>{brandTitle}</span>
              </div>
              <div className="flex items-center gap-2.5 text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-400" />
                <span>Mega Warehouses ({warehouses.length})</span>
              </div>
              <div className="flex items-center gap-2.5 text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full bg-purple-400" />
                <span>Pharmacies / GDP ({pharmaCount})</span>
              </div>
              <div className="flex items-center gap-2.5 text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span>FMCG Retail / Stores ({retailCount})</span>
              </div>
              <div className="flex items-center gap-2.5 text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
                <span>Cold-Chain Reefer Route</span>
              </div>
            </div>
          </div>

          {/* Warehouse Floating HUD Badges (Clickable -> Opens 3D Interior) */}
          {whLabels.map((lbl) => {
            const wh = warehouses.find((w) => w.warehouse_id === lbl.id);
            return (
              <button
                key={lbl.id}
                onClick={() => {
                  if (wh) onSelectWarehouse(wh);
                }}
                style={{ left: lbl.x, top: lbl.y }}
                className={cx(
                  "absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center rounded-xl border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 text-center shadow-lg backdrop-blur transition-all duration-150 hover:scale-105 z-10",
                  hoveredWH === lbl.id && "border-blue-400 ring-2 ring-blue-500/50 bg-slate-800"
                )}
                title="Click to enter 3D warehouse interior"
              >
                <div className="flex items-center gap-1 text-[11px] font-bold text-white">
                  <span>🏭</span>
                  <span>{lbl.city} Hub</span>
                </div>
                <div className="text-[10px] font-semibold text-emerald-400">{lbl.cap}</div>
                <div className="text-[9px] text-blue-300 opacity-90">Click for 3D Interior</div>
              </button>
            );
          })}

          {/* Bottom-Left Helper HUD */}
          <div className="absolute bottom-4 left-6 z-10 flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2 text-xs text-slate-400 backdrop-blur">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              <b>Left Click:</b> Rotate
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
              <b>Right Click:</b> Pan
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <b>Scroll:</b> Zoom
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-amber-400 font-medium">💡 Click any warehouse to enter its 3D interior</span>
          </div>
        </div>
      )}
    </div>
  );
}
