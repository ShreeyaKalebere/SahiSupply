// Renders the 3D delivery-truck model (public/models/delivery_truck.glb) into ONE sprite sheet: a strip
// with one frame per heading. Map markers show the frame for their direction by shifting the
// background position, so turning never swaps images (no decode, no flicker) and no WebGL runs per
// frame. three.js is loaded on demand (code-split) only when a map needs it.
//
// Model: "Delivery Truck" by Jasmin Daniel (https://sketchfab.com/jasmin.daniel), CC-BY-4.0.

export const TRUCK_MODEL_URL = "/models/delivery_truck.glb";
export const TRUCK_CREDIT = "Truck model: Jasmin Daniel (Sketchfab), CC-BY-4.0";
export const SPRITE_COUNT = 16;
const SPRITE_PX = 128;
// Which way the model's nose points along its long axis (+1 or -1); flips sprites if the model faces backwards.
const FRONT_SIGN = -1; // checked visually: this model's cab is at the -X end after alignment

let cache: Promise<string> | null = null;

/**
 * URL of the sprite sheet: SPRITE_COUNT square frames side by side; frame i shows the truck heading at
 * i * 360/SPRITE_COUNT degrees (0 = east, counter-clockwise).
 */
export function loadTruckSheet(): Promise<string> {
  cache ??= render().catch((err) => {
    cache = null;
    throw err;
  });
  return cache;
}

async function render(): Promise<string> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(TRUCK_MODEL_URL);

  const model = gltf.scene;
  model.traverse((obj) => {
    const mesh = obj as InstanceType<typeof THREE.Mesh>;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats as InstanceType<typeof THREE.MeshStandardMaterial>[]) paintYellow(THREE, m);
  });
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

  const sheet = document.createElement("canvas");
  sheet.width = SPRITE_PX * SPRITE_COUNT;
  sheet.height = SPRITE_PX;
  const ctx = sheet.getContext("2d")!;
  for (let i = 0; i < SPRITE_COUNT; i++) {
    yaw.rotation.y = (i * 2 * Math.PI) / SPRITE_COUNT; // +X turns toward -Z (north) for positive angles
    renderer.render(scene, camera);
    ctx.drawImage(canvas, i * SPRITE_PX, 0);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  const blob = await new Promise<Blob | null>((res) => sheet.toBlob(res, "image/png"));
  if (!blob) throw new Error("could not encode truck sprite sheet");
  return URL.createObjectURL(blob); // one decoded image shared by every marker
}

const TRUCK_YELLOW = 0xfacc15;

/**
 * Recolour the truck yellow but keep its detail: the texture is turned into brightness only (grey),
 * then tinted yellow by the material colour, so windows, wheels and edges stay darker than the body.
 */
function paintYellow(THREE: typeof import("three"), mat: InstanceType<typeof THREE.MeshStandardMaterial>) {
  mat.color = new THREE.Color(TRUCK_YELLOW);
  const img = mat.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!img?.width) { mat.map = null; mat.needsUpdate = true; return; }
  try {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < px.data.length; i += 4) {
      const lum = 0.299 * px.data[i] + 0.587 * px.data[i + 1] + 0.114 * px.data[i + 2];
      const v = Math.min(255, lum * 2.1); // lift the mid-blue body to near white so it tints bright yellow
      px.data[i] = px.data[i + 1] = px.data[i + 2] = v;
    }
    ctx.putImageData(px, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = mat.map!.flipY;
    tex.colorSpace = mat.map!.colorSpace;
    mat.map = tex;
  } catch {
    mat.map = null; // plain yellow if the texture can't be read
  }
  mat.needsUpdate = true;
}

/** Sprite index for a screen-space direction (dx right, dy down, in pixels). */
export function spriteIndex(dx: number, dy: number): number {
  const angle = Math.atan2(-dy, dx); // math angle, north = up
  const step = (2 * Math.PI) / SPRITE_COUNT;
  return ((Math.round(angle / step) % SPRITE_COUNT) + SPRITE_COUNT) % SPRITE_COUNT;
}
