// Renders the 3D delivery-truck model (public/models/delivery_truck.glb) into small images, one per
// heading, so map markers can show a 3D truck facing its direction of travel without running WebGL
// per frame. three.js is loaded on demand (code-split) only when a map needs it.
//
// Model: "Delivery Truck" by Jasmin Daniel (https://sketchfab.com/jasmin.daniel), CC-BY-4.0.

export const TRUCK_MODEL_URL = "/models/delivery_truck.glb";
export const TRUCK_CREDIT = "Truck model: Jasmin Daniel (Sketchfab), CC-BY-4.0";
export const SPRITE_COUNT = 16;
const SPRITE_PX = 128;
// Which way the model's nose points along its long axis (+1 or -1); flips sprites if the model faces backwards.
const FRONT_SIGN = -1; // checked visually: this model's cab is at the -X end after alignment

let cache: Promise<string[]> | null = null;

/** Sprite i shows the truck heading at angle i * 360/SPRITE_COUNT degrees (0 = east, counter-clockwise). */
export function loadTruckSprites(): Promise<string[]> {
  cache ??= render().catch((err) => {
    cache = null;
    throw err;
  });
  return cache;
}

async function render(): Promise<string[]> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(TRUCK_MODEL_URL);

  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);

  // Orient: put the truck's long horizontal axis on +X, wheels down (Y up after glTF node transforms).
  const align = new THREE.Group();
  align.add(model);
  if (size.z > size.x) align.rotation.y = FRONT_SIGN > 0 ? Math.PI / 2 : -Math.PI / 2;
  else if (FRONT_SIGN < 0) align.rotation.y = Math.PI;
  const yaw = new THREE.Group();
  yaw.add(align);
  yaw.scale.setScalar(2 / Math.max(size.x, size.y, size.z));

  const scene = new THREE.Scene();
  scene.add(yaw);
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-2, 5, 4);
  scene.add(sun);

  // Elevated camera from the south (screen bottom): map north = -Z = screen up.
  const camera = new THREE.OrthographicCamera(-1.15, 1.15, 1.15, -1.15, 0.1, 50);
  const elevation = (52 * Math.PI) / 180;
  camera.position.set(0, Math.sin(elevation) * 10, Math.cos(elevation) * 10);
  camera.lookAt(0, 0, 0);

  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SPRITE_PX, SPRITE_PX, false);
  renderer.setClearColor(0x000000, 0);

  const sprites: string[] = [];
  for (let i = 0; i < SPRITE_COUNT; i++) {
    yaw.rotation.y = (i * 2 * Math.PI) / SPRITE_COUNT; // +X turns toward -Z (north) for positive angles
    renderer.render(scene, camera);
    sprites.push(canvas.toDataURL("image/png"));
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return sprites;
}

/** Sprite index for a screen-space direction (dx right, dy down, in pixels). */
export function spriteIndex(dx: number, dy: number): number {
  const angle = Math.atan2(-dy, dx); // math angle, north = up
  const step = (2 * Math.PI) / SPRITE_COUNT;
  return ((Math.round(angle / step) % SPRITE_COUNT) + SPRITE_COUNT) % SPRITE_COUNT;
}
