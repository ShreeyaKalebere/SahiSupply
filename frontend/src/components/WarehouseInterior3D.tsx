import {
  ArrowLeft, Box, ChevronDown, Grid3X3, Layers, Snowflake,
  Warehouse as WarehouseIcon, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { usePlanner } from "../hooks/usePlanner";
import type { Warehouse } from "../types/api";
import { cx, fmtDate, fmtInt } from "../utils/format";

interface WarehouseInterior3DProps {
  warehouse: Warehouse;
  allWarehouses: Warehouse[];
  onSelectWarehouse: (w: Warehouse) => void;
  onBackToSimulation?: () => void;
  height?: number;
}

interface RackInfo {
  id: string;
  name: string;
  category: string;
  zone: "reefer" | "ambient" | "pharma";
  color: string;
  position: [number, number, number];
  size: [number, number, number];
  tags: string[];
}

export function WarehouseInterior3D({
  warehouse,
  allWarehouses,
  onSelectWarehouse,
  onBackToSimulation,
  height = 620,
}: WarehouseInterior3DProps) {
  const p = usePlanner();
  const mountRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");
  const [selectedRack, setSelectedRack] = useState<RackInfo | null>(null);
  const [hoveredRack, setHoveredRack] = useState<string | null>(null);

  // Fetch real inventory batches for this module
  const invQ = useAsync(() => api.inventory(p.module, p.scenario, p.contested), [p.module, p.scenario, p.contested]);
  const warehouseBatches = useMemo(() => {
    return (invQ.data?.rows ?? []).filter((r) => r.warehouse_id === warehouse.warehouse_id);
  }, [invQ.data, warehouse.warehouse_id]);

  // Define warehouse racks with real vertical-aware product categories
  const racks: RackInfo[] = useMemo(() => {
    const isPharma = p.module === "pharmacy";
    const isCosmetics = p.module === "cosmetics";

    return [
      // Left Cold-Storage Reefer Chamber (Cyan)
      {
        id: "RACK-C1",
        name: isPharma ? "Bio-Insulin & Cold Vaccines" : isCosmetics ? "Organic Cold Serums & Actives" : "Dairy Products & Fresh Milk",
        category: "Cold-Chain (2-8°C)",
        zone: "reefer",
        color: "#06b6d4",
        position: [-13, 2.8, -4],
        size: [3.4, 4.5, 2],
        tags: ["Chilled", "Cold-Storage", "2-8°C"],
      },
      {
        id: "RACK-C2",
        name: isPharma ? "Critical Bio-Injectables & Plasma" : isCosmetics ? "Temperature-Controlled Creams" : "Chilled Beverages & Yogurts",
        category: "Cold-Chain (2-8°C)",
        zone: "reefer",
        color: "#06b6d4",
        position: [-8.5, 2.8, -4],
        size: [3.4, 4.5, 2],
        tags: ["Reefer Vault", "FEFO Monitored"],
      },

      // Center Ambient Staging Racks
      {
        id: "RACK-A1",
        name: isPharma ? "Respiratory & Oral Solids" : isCosmetics ? "Lipsticks & Color Cosmetics" : "Snacks & Confectionery",
        category: "High-Velocity Ambient",
        zone: "ambient",
        color: "#10b981",
        position: [-3, 2.8, 1],
        size: [3.2, 4.5, 1.8],
        tags: ["Fast-Moving", "Ambient Aisle"],
      },
      {
        id: "RACK-A2",
        name: isPharma ? "Chronic Care Formulations" : isCosmetics ? "Foundation & Skincare Bases" : "Packaged Foods & Noodles",
        category: "Cycle Stock",
        zone: "ambient",
        color: "#3b82f6",
        position: [2, 2.8, 1],
        size: [3.2, 4.5, 1.8],
        tags: ["Buffer Bay", "Standard Shelf"],
      },
      {
        id: "RACK-A3",
        name: isPharma ? "Over-The-Counter Essentials" : isCosmetics ? "SunShield & Haircare Lotions" : "Beverages & Culinary Sauces",
        category: "General Storage",
        zone: "ambient",
        color: "#f59e0b",
        position: [-0.5, 2.2, 5.5],
        size: [3.2, 3.8, 1.8],
        tags: ["Pallet Staging", "Outbound Ready"],
      },

      // Right Secured GDP Pharma / High-Security Vault (Purple)
      {
        id: "RACK-D1",
        name: isPharma ? "GDP Secured Cardiac & Neuro Vault" : isCosmetics ? "Luxury Fragrance & Gold Serums" : "Premium Imported Gourmet & Coffee",
        category: "Secured Vault",
        zone: "pharma",
        color: "#a855f7",
        position: [9, 2.8, -4],
        size: [3.4, 4.5, 2],
        tags: ["Access-Controlled", "High Value"],
      },
      {
        id: "RACK-D2",
        name: isPharma ? "Hospital-Grade Critical Antibiotics" : isCosmetics ? "High-Margin Boutique Skin Care" : "Nutritional Formula Vault",
        category: "Secured Vault",
        zone: "pharma",
        color: "#8b5cf6",
        position: [13.5, 2.8, -4],
        size: [3.4, 4.5, 2],
        tags: ["GDP Compliant", "Audit Tracked"],
      },
    ];
  }, [p.module]);

  // Projected 2D coordinates for HTML floating label badges
  const [screenLabels, setScreenLabels] = useState<{ id: string; x: number; y: number; text: string; sub?: string; color: string }[]>([]);
  const [roomLabels, setRoomLabels] = useState<{ id: string; x: number; y: number; text: string; icon: string; color: string }[]>([]);

  // Three.js scene setup
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const currentHeight = height;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1d);
    scene.fog = new THREE.FogExp2(0x0a0f1d, 0.012);

    const camera = new THREE.PerspectiveCamera(45, width / currentHeight, 0.1, 1000);
    camera.position.set(0, 17, 30);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, currentHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Do not go below floor
    controls.minDistance = 8;
    controls.maxDistance = 65;
    controls.target.set(0, 2, 0);

    // 1. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(15, 25, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    scene.add(sun);

    // Cyan accent light in Reefer Chamber
    const reeferLight = new THREE.PointLight(0x06b6d4, 3, 20);
    reeferLight.position.set(-11, 4, -4);
    scene.add(reeferLight);

    // Purple accent light in Pharma Vault
    const pharmaLight = new THREE.PointLight(0x8b5cf6, 3, 20);
    pharmaLight.position.set(11, 4, -4);
    scene.add(pharmaLight);

    // 2. Floor Plane & Grid
    const floorGeo = new THREE.PlaneGeometry(64, 46);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0c1222,
      roughness: 0.7,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(64, 32, 0x334155, 0x1e293b);
    grid.position.y = 0.01;
    scene.add(grid);

    // 3. Yellow Staging / Loading Bay Floor Strip
    const yellowBayGeo = new THREE.PlaneGeometry(42, 4);
    const yellowBayMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      roughness: 0.5,
      metalness: 0.2,
    });
    const yellowBay = new THREE.Mesh(yellowBayGeo, yellowBayMat);
    yellowBay.rotation.x = -Math.PI / 2;
    yellowBay.position.set(0, 0.02, 13);
    scene.add(yellowBay);

    // 4. Blue Delivery Truck at Loading Bay
    const truckGroup = new THREE.Group();
    // Cab
    const cabGeo = new THREE.BoxGeometry(2.4, 2.2, 2.2);
    const cabMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4 });
    const cab = new THREE.Mesh(cabGeo, cabMat);
    cab.position.set(2.8, 1.3, 0);
    truckGroup.add(cab);
    // Trailer / Container
    const trailerGeo = new THREE.BoxGeometry(5.2, 2.8, 2.4);
    const trailerMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.3 });
    const trailer = new THREE.Mesh(trailerGeo, trailerMat);
    trailer.position.set(-1.2, 1.6, 0);
    truckGroup.add(trailer);
    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827 });
    const wheelPositions = [
      [-2.8, 0.5, 1.2],
      [-2.8, 0.5, -1.2],
      [-0.4, 0.5, 1.2],
      [-0.4, 0.5, -1.2],
      [2.8, 0.5, 1.2],
      [2.8, 0.5, -1.2],
    ];
    wheelPositions.forEach(([wx, wy, wz]) => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, wy, wz);
      truckGroup.add(wheel);
    });
    truckGroup.position.set(-12, 0, 13);
    scene.add(truckGroup);

    // 5. Left Cold-Storage Reefer Chamber (Glass Vault)
    const reeferRoomGeo = new THREE.BoxGeometry(13.5, 6.5, 11);
    const reeferRoomMat = new THREE.MeshPhysicalMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.16,
      roughness: 0.15,
      metalness: 0.1,
      transmission: 0.5,
    });
    const reeferRoom = new THREE.Mesh(reeferRoomGeo, reeferRoomMat);
    reeferRoom.position.set(-10.8, 3.25, -4);
    scene.add(reeferRoom);

    // Cyan wireframe edge
    const reeferEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(reeferRoomGeo),
      new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 2 })
    );
    reeferEdges.position.copy(reeferRoom.position);
    scene.add(reeferEdges);

    // 6. Right Secured GDP Pharma Vault (Purple Glass Vault)
    const pharmaRoomGeo = new THREE.BoxGeometry(13.5, 6.5, 11);
    const pharmaRoomMat = new THREE.MeshPhysicalMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 0.16,
      roughness: 0.15,
      metalness: 0.1,
      transmission: 0.5,
    });
    const pharmaRoom = new THREE.Mesh(pharmaRoomGeo, pharmaRoomMat);
    pharmaRoom.position.set(11.2, 3.25, -4);
    scene.add(pharmaRoom);

    // Purple wireframe edge
    const pharmaEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(pharmaRoomGeo),
      new THREE.LineBasicMaterial({ color: 0xa855f7, linewidth: 2 })
    );
    pharmaEdges.position.copy(pharmaRoom.position);
    scene.add(pharmaEdges);

    // 7. Industrial Racks & Storage Bins
    const rackMeshes: THREE.Group[] = [];
    const interactiveObjects: THREE.Object3D[] = [];

    racks.forEach((rack) => {
      const group = new THREE.Group();
      group.position.set(...rack.position);
      group.userData = { rackId: rack.id, info: rack };

      const [rw, rh, rd] = rack.size;
      const beamMat = new THREE.MeshStandardMaterial({
        color: 0x475569,
        metalness: 0.7,
        roughness: 0.3,
      });

      // 4 Upright Pillars
      const pillarGeo = new THREE.BoxGeometry(0.12, rh, 0.12);
      const pillars = [
        [-rw / 2, rh / 2, -rd / 2],
        [rw / 2, rh / 2, -rd / 2],
        [-rw / 2, rh / 2, rd / 2],
        [rw / 2, rh / 2, rd / 2],
      ];
      pillars.forEach(([px, py, pz]) => {
        const p = new THREE.Mesh(pillarGeo, beamMat);
        p.position.set(px, py - rh / 2, pz);
        p.castShadow = true;
        group.add(p);
      });

      // 3 Shelf Levels
      const shelfLevels = [0.15, rh * 0.38, rh * 0.72];
      const shelfGeo = new THREE.BoxGeometry(rw, 0.08, rd);
      const shelfMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.4 });

      shelfLevels.forEach((levelY, levelIdx) => {
        const shelf = new THREE.Mesh(shelfGeo, shelfMat);
        shelf.position.y = levelY;
        shelf.receiveShadow = true;
        group.add(shelf);

        // Place 3 colored boxes / totes per shelf level
        const boxColors =
          rack.zone === "reefer"
            ? [0xef4444, 0x10b981, 0x3b82f6] // Red, Green, Blue as seen in screenshot!
            : rack.zone === "pharma"
            ? [0x06b6d4, 0x10b981, 0x06b6d4] // Turquoise & Green
            : [0x10b981, 0xf97316, 0x3b82f6]; // Green, Orange, Blue

        const boxGeo = new THREE.BoxGeometry(rw / 3.4, 0.65, rd * 0.75);
        for (let b = 0; b < 3; b++) {
          const color = boxColors[(b + levelIdx) % boxColors.length];
          const bMat = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.4,
            metalness: 0.1,
          });
          const box = new THREE.Mesh(boxGeo, bMat);
          const bx = -rw / 3 + b * (rw / 3);
          box.position.set(bx, levelY + 0.35, 0);
          box.castShadow = true;
          box.receiveShadow = true;
          box.userData = { rackId: rack.id, isBox: true };
          group.add(box);
          interactiveObjects.push(box);
        }
      });

      // Invisible hit area for easier clicking
      const hitGeo = new THREE.BoxGeometry(rw + 0.6, rh + 0.6, rd + 0.6);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitBox = new THREE.Mesh(hitGeo, hitMat);
      hitBox.position.y = 0;
      hitBox.userData = { rackId: rack.id, isHit: true };
      group.add(hitBox);
      interactiveObjects.push(hitBox);

      scene.add(group);
      rackMeshes.push(group);
    });

    // Raycasting for rack selection & hover
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(interactiveObjects, true);

      if (intersects.length > 0) {
        const hit = intersects[0].object;
        const rackId = hit.userData.rackId;
        const r = racks.find((x) => x.id === rackId);
        if (r) setSelectedRack(r);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(interactiveObjects, true);

      if (intersects.length > 0) {
        renderer.domElement.style.cursor = "pointer";
        const hit = intersects[0].object;
        setHoveredRack(hit.userData.rackId ?? null);
      } else {
        renderer.domElement.style.cursor = "default";
        setHoveredRack(null);
      }
    };

    renderer.domElement.addEventListener("click", handleClick);
    renderer.domElement.addEventListener("mousemove", handleMouseMove);

    // Animation & Label projection loop
    let animId: number;
    const projectToScreen = (pos: THREE.Vector3) => {
      const p = pos.clone();
      p.project(camera);
      if (p.z > 1) return null; // Behind camera
      const x = (p.x * 0.5 + 0.5) * width;
      const y = (-(p.y * 0.5) + 0.5) * currentHeight;
      return { x, y };
    };

    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();

      // Project rack label coordinates
      const labels = racks
        .map((r) => {
          const topPos = new THREE.Vector3(r.position[0], r.position[1] + r.size[1] / 2 + 0.7, r.position[2]);
          const screen = projectToScreen(topPos);
          if (!screen) return null;
          return {
            id: r.id,
            x: screen.x,
            y: screen.y,
            text: `${r.id} • ${r.name}`,
            color: r.color,
          };
        })
        .filter((l): l is NonNullable<typeof l> => l !== null);
      setScreenLabels(labels);

      // Project chamber room banners
      const reeferTop = projectToScreen(new THREE.Vector3(-10.8, 6.8, -4));
      const pharmaTop = projectToScreen(new THREE.Vector3(11.2, 6.8, -4));
      const rLabels = [];
      if (reeferTop) {
        rLabels.push({
          id: "reefer-banner",
          x: reeferTop.x,
          y: reeferTop.y,
          text: "2-8°C REEFER VAULT",
          icon: "❄️",
          color: "border-cyan-400 text-cyan-300 bg-cyan-950/80 shadow-cyan-900/50",
        });
      }
      if (pharmaTop) {
        rLabels.push({
          id: "pharma-banner",
          x: pharmaTop.x,
          y: pharmaTop.y,
          text: "GDP PHARMA VAULT",
          icon: "🔒",
          color: "border-purple-400 text-purple-300 bg-purple-950/80 shadow-purple-900/50",
        });
      }
      setRoomLabels(rLabels);

      renderer.render(scene, camera);
    };
    animate();

    // Mode switch: animate camera for 3D Racks vs 2D Grid
    if (viewMode === "2d") {
      camera.position.set(0, 36, 0.01);
      controls.target.set(0, 0, 0);
      controls.enableRotate = false;
    } else {
      camera.position.set(0, 17, 30);
      controls.target.set(0, 2, 0);
      controls.enableRotate = true;
    }

    const handleResize = () => {
      if (!container) return;
      const newWidth = container.clientWidth;
      camera.aspect = newWidth / currentHeight;
      camera.updateProjectionMatrix();
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
  }, [height, racks, viewMode]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#070b14] text-white shadow-2xl overflow-hidden">
      {/* 1. Header Bar matching Image 1 */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-900/80 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
            <WarehouseIcon size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-white">
                {warehouse.name} — Interactive 3D Warehouse Interior
              </h2>
              <span className="rounded-full bg-blue-500/15 border border-blue-400/30 px-2.5 py-0.5 text-xs font-semibold text-blue-300">
                {warehouse.city} Hub
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Industrial Racks, Cold-Storage Reefer Chamber (2-8°C), and Secured GDP Pharmaceutical Vault
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Warehouse Selector Dropdown */}
          <div className="relative">
            <select
              value={warehouse.warehouse_id}
              onChange={(e) => {
                const target = allWarehouses.find((w) => w.warehouse_id === e.target.value);
                if (target) onSelectWarehouse(target);
              }}
              className="appearance-none rounded-xl border border-slate-700 bg-slate-800/90 py-2 pl-3.5 pr-9 text-xs font-semibold text-white shadow-sm hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              {allWarehouses.map((w) => (
                <option key={w.warehouse_id} value={w.warehouse_id} className="bg-slate-900 text-white">
                  {w.name} ({w.city})
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-3 text-slate-400" />
          </div>

          {/* 3D Racks vs 2D Grid View Switcher */}
          <div className="flex rounded-xl border border-slate-700 bg-slate-800/90 p-1">
            <button
              onClick={() => setViewMode("3d")}
              className={cx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                viewMode === "3d" ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-white"
              )}
            >
              <Layers size={13} /> 3D Racks
            </button>
            <button
              onClick={() => setViewMode("2d")}
              className={cx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                viewMode === "2d" ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-white"
              )}
            >
              <Grid3X3 size={13} /> 2D Grid
            </button>
          </div>

          {onBackToSimulation && (
            <button
              onClick={onBackToSimulation}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-blue-500 hover:text-white transition-colors"
            >
              <ArrowLeft size={14} /> Back to Simulation
            </button>
          )}
        </div>
      </div>

      {/* 2. Interactive 3D Canvas Viewport */}
      <div className="relative w-full overflow-hidden" style={{ height }}>
        <div ref={mountRef} className="h-full w-full" />

        {/* Top-Left HUD Info Card Overlay matching Image 1 */}
        <div className="absolute left-6 top-6 z-10 w-72 rounded-2xl border border-slate-700/60 bg-slate-900/85 p-4 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-blue-500/20 text-blue-400">
              <WarehouseIcon size={15} />
            </div>
            <div>
              <div className="text-sm font-bold text-white">{warehouse.name.split(" (")[0]}</div>
              <div className="text-[11px] text-slate-400">
                {warehouse.city}, {warehouse.state ?? "India"}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Capacity</div>
              <div className="mt-0.5 text-xs font-bold text-emerald-400">{warehouse.capacity ?? "380,000 units"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Reefer Chamber</div>
              <div className="mt-0.5 text-xs font-bold text-cyan-400">35,000 units</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Active</div>
              <div className="mt-0.5 text-xs font-bold text-blue-400">
                {warehouseBatches.length > 0 ? `${warehouseBatches.length} Batches` : "28 Units"}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl bg-cyan-950/40 border border-cyan-800/40 px-3 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-cyan-300">
              <Snowflake size={13} className="text-cyan-400" /> 2-8°C REEFER VAULT
            </span>
            <span className="text-[10px] text-emerald-400 font-medium">Active GDP</span>
          </div>
        </div>

        {/* Floating Chamber Room Banners (e.g. ❄️ 2-8°C REEFER VAULT and 🔒 GDP PHARMA VAULT) */}
        {roomLabels.map((rl) => (
          <div
            key={rl.id}
            style={{ left: rl.x, top: rl.y }}
            className={cx(
              "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold tracking-wider shadow-lg backdrop-blur z-10 transition-transform duration-75",
              rl.color
            )}
          >
            <span>{rl.icon}</span>
            <span>{rl.text}</span>
          </div>
        ))}

        {/* Floating Rack Labels (e.g. RACK-C1 • Dairy Products) */}
        {screenLabels.map((lbl) => (
          <button
            key={lbl.id}
            onClick={() => {
              const r = racks.find((x) => x.id === lbl.id);
              if (r) setSelectedRack(r);
            }}
            style={{ left: lbl.x, top: lbl.y }}
            className={cx(
              "absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-slate-700 bg-slate-900/90 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-200 shadow-md backdrop-blur transition-all duration-150 hover:scale-105 z-10",
              hoveredRack === lbl.id && "border-blue-400 text-white shadow-blue-500/50 ring-2 ring-blue-500/40"
            )}
          >
            {lbl.text}
          </button>
        ))}

        {/* Bottom Helper Controls HUD */}
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
          <span className="text-blue-400 font-medium">Click any rack to inspect inventory batches</span>
        </div>
      </div>

      {/* 3. Interactive Rack Detail Drawer / Modal */}
      {selectedRack && (
        <div className="border-t border-slate-800 bg-slate-900/95 p-5 backdrop-blur">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="grid h-10 w-10 place-items-center rounded-xl text-white font-bold"
                style={{ backgroundColor: selectedRack.color }}
              >
                <Box size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">
                    {selectedRack.id} · {selectedRack.name}
                  </h3>
                  <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                    {selectedRack.category}
                  </span>
                </div>
                <div className="flex gap-2 text-xs text-slate-400 mt-1">
                  {selectedRack.tags.map((t) => (
                    <span key={t} className="rounded bg-slate-800/60 px-1.5 py-0.5">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedRack(null)}
              className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {warehouseBatches.slice(0, 4).map((b, i) => (
              <div key={b.batch_id || i} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="flex justify-between text-xs">
                  <span className="font-mono text-slate-400">{b.batch_id}</span>
                  <span className="font-semibold text-emerald-400">{fmtInt(b.quantity)} units</span>
                </div>
                <div className="mt-1 font-semibold text-white text-sm truncate">{b.product_name}</div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Expires: {fmtDate(b.expiry_date)}</span>
                  <span className="font-medium text-amber-400">{Math.round(b.remaining_life_pct)}% life</span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.min(100, Math.max(10, b.remaining_life_pct))}%` }}
                  />
                </div>
              </div>
            ))}
            {warehouseBatches.length === 0 && (
              <div className="col-span-full py-4 text-center text-xs text-slate-400">
                Holding standard reserve inventory for this aisle. Ready for dispatches.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
