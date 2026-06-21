import * as THREE from 'three';
import './style.css';

type TileName =
  | 'grass'
  | 'asphalt'
  | 'concrete'
  | 'redRoof'
  | 'blueRoof'
  | 'creamWall'
  | 'schoolWall'
  | 'greenRoof'
  | 'lotDirt'
  | 'schoolDirt'
  | 'canopy'
  | 'forestPath'
  | 'water'
  | 'pipeConcrete'
  | 'shrubs'
  | 'gravel';

type TileSet = Record<TileName, THREE.Texture>;

type Collider = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  name: string;
};

type Actor = {
  group: THREE.Group;
  position: THREE.Vector3;
  yaw: number;
  radius: number;
  speed: number;
  turnSpeed: number;
  moving: boolean;
};

type Role = 'seeker' | 'hider';

const TILE_ORDER: TileName[] = [
  'grass',
  'asphalt',
  'concrete',
  'redRoof',
  'blueRoof',
  'creamWall',
  'schoolWall',
  'greenRoof',
  'lotDirt',
  'schoolDirt',
  'canopy',
  'forestPath',
  'water',
  'pipeConcrete',
  'shrubs',
  'gravel'
];

const WORLD_WIDTH = 86;
const WORLD_DEPTH = 64;
const SIGHT_RANGE = 15.5;
const SIGHT_ANGLE = THREE.MathUtils.degToRad(58);
const CAPTURE_DISTANCE = 1.35;
const SEEKER_SPEED = 5.05;
const HIDER_SPEED = 3.85;

const canvas = document.querySelector<HTMLCanvasElement>('#town-canvas');
if (!canvas) {
  throw new Error('Canvas element was not found.');
}
const canvasElement = canvas;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7d6d0);
scene.fog = new THREE.Fog(0xb7d6d0, 48, 104);

const renderer = new THREE.WebGLRenderer({
  canvas: canvasElement,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const seekerCamera = new THREE.PerspectiveCamera(66, 1, 0.1, 90);
const hiderCamera = new THREE.PerspectiveCamera(66, 1, 0.1, 90);

const sun = new THREE.DirectionalLight(0xfff3cf, 3.25);
sun.position.set(-26, 34, 24);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -58;
sun.shadow.camera.right = 58;
sun.shadow.camera.top = 48;
sun.shadow.camera.bottom = -48;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xd7fff6, 0x7e705e, 1.85));

const town = new THREE.Group();
town.name = 'expanded-hide-and-seek-town';
scene.add(town);

const colliders: Collider[] = [];
const keys = new Set<string>();
const clock = new THREE.Clock();

let seeker!: Actor;
let hider!: Actor;
let visionCone!: THREE.Mesh;
let activeRole: Role = 'seeker';
let elapsed = 0;
let spottedTime = 0;
let caught = false;
let ready = false;
let hiderAiRetargetAt = 0;
let hiderAiTarget = new THREE.Vector3();
let seekerPatrolIndex = 0;
let audioContext: AudioContext | null = null;
let lastFootstepAt = 0;

const dom = {
  role: document.querySelector<HTMLElement>('#role-readout'),
  timer: document.querySelector<HTMLElement>('#timer-readout'),
  state: document.querySelector<HTMLElement>('#state-readout'),
  footstep: document.querySelector<HTMLElement>('#footstep-bar'),
  sight: document.querySelector<HTMLElement>('#sight-bar'),
  distance: document.querySelector<HTMLElement>('#distance-readout'),
  seekerButton: document.querySelector<HTMLButtonElement>('#role-seeker'),
  hiderButton: document.querySelector<HTMLButtonElement>('#role-hider'),
  resetButton: document.querySelector<HTMLButtonElement>('#reset-round')
};

const hidingSpots = [
  new THREE.Vector3(-29, 0, -23),
  new THREE.Vector3(-31, 0, 18),
  new THREE.Vector3(-13, 0, 12),
  new THREE.Vector3(9, 0, 25),
  new THREE.Vector3(28, 0, 17),
  new THREE.Vector3(33, 0, -18),
  new THREE.Vector3(2, 0, -25),
  new THREE.Vector3(-23, 0, -2)
];

const seekerPatrol = [
  new THREE.Vector3(-30, 0, -22),
  new THREE.Vector3(-6, 0, -20),
  new THREE.Vector3(23, 0, -17),
  new THREE.Vector3(29, 0, 12),
  new THREE.Vector3(8, 0, 22),
  new THREE.Vector3(-20, 0, 14),
  new THREE.Vector3(-33, 0, 2)
];

function imageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${url}`));
    image.src = url;
  });
}

async function loadTiles(): Promise<TileSet> {
  const image = await imageFromUrl('textures/town-texture-atlas.png');
  const tileSize = 256;
  const tiles = {} as TileSet;

  TILE_ORDER.forEach((name, index) => {
    const sx = (index % 4) * tileSize;
    const sy = Math.floor(index / 4) * tileSize;
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tileSize;
    tileCanvas.height = tileSize;
    const context = tileCanvas.getContext('2d');
    if (!context) {
      throw new Error('Could not create texture canvas context.');
    }
    context.drawImage(image, sx, sy, tileSize, tileSize, 0, 0, tileSize, tileSize);
    const texture = new THREE.CanvasTexture(tileCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    tiles[name] = texture;
  });

  return tiles;
}

function materialFromTile(
  tiles: TileSet,
  tile: TileName,
  color: THREE.ColorRepresentation = 0xffffff,
  repeat: [number, number] = [1, 1],
  roughness = 0.92
): THREE.MeshStandardMaterial {
  const texture = tiles[tile].clone();
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  return new THREE.MeshStandardMaterial({ map: texture, color, roughness, metalness: 0.02 });
}

function solid(color: THREE.ColorRepresentation, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function registerCollider(mesh: THREE.Mesh, width: number, depth: number, height: number, name: string) {
  mesh.updateWorldMatrix(true, false);
  const worldPosition = mesh.getWorldPosition(new THREE.Vector3());
  colliders.push({
    minX: worldPosition.x - width / 2,
    maxX: worldPosition.x + width / 2,
    minZ: worldPosition.z - depth / 2,
    maxZ: worldPosition.z + depth / 2,
    height,
    name
  });
}

function box(
  parent: THREE.Group,
  name: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  material: THREE.Material | THREE.Material[],
  y = 0,
  collidable = false
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.name = name;
  mesh.position.set(x, y + height / 2, z);
  mesh.castShadow = height > 0.2;
  mesh.receiveShadow = true;
  parent.add(mesh);
  if (collidable) {
    registerCollider(mesh, width, depth, height, name);
  }
  return mesh;
}

function cylinder(
  parent: THREE.Group,
  name: string,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
  material: THREE.Material,
  position: THREE.Vector3,
  rotation: THREE.Euler
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, false),
    material
  );
  mesh.name = name;
  mesh.position.copy(position);
  mesh.rotation.copy(rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function forwardFromYaw(yaw: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
}

function signedAngleTo(fromYaw: number, from: THREE.Vector3, to: THREE.Vector3): number {
  const forward = forwardFromYaw(fromYaw);
  const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
  const cross = forward.x * direction.z - forward.z * direction.x;
  const dot = THREE.MathUtils.clamp(forward.dot(direction), -1, 1);
  return Math.atan2(cross, dot);
}

function angleToward(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function turnToward(actor: Actor, targetYaw: number, dt: number, multiplier = 1) {
  const delta = Math.atan2(Math.sin(targetYaw - actor.yaw), Math.cos(targetYaw - actor.yaw));
  actor.yaw += THREE.MathUtils.clamp(delta, -actor.turnSpeed * multiplier * dt, actor.turnSpeed * multiplier * dt);
}

function collidesAt(position: THREE.Vector3, radius: number): boolean {
  if (
    position.x < -WORLD_WIDTH / 2 + radius ||
    position.x > WORLD_WIDTH / 2 - radius ||
    position.z < -WORLD_DEPTH / 2 + radius ||
    position.z > WORLD_DEPTH / 2 - radius
  ) {
    return true;
  }

  return colliders.some((collider) => {
    const closestX = THREE.MathUtils.clamp(position.x, collider.minX, collider.maxX);
    const closestZ = THREE.MathUtils.clamp(position.z, collider.minZ, collider.maxZ);
    const dx = position.x - closestX;
    const dz = position.z - closestZ;
    return dx * dx + dz * dz < radius * radius;
  });
}

function tryMoveActor(actor: Actor, movement: THREE.Vector3) {
  actor.moving = movement.lengthSq() > 0.00001;
  if (!actor.moving || caught) {
    return;
  }

  const next = actor.position.clone().add(movement);
  if (!collidesAt(next, actor.radius)) {
    actor.position.copy(next);
    return;
  }

  const xOnly = actor.position.clone().add(new THREE.Vector3(movement.x, 0, 0));
  if (!collidesAt(xOnly, actor.radius)) {
    actor.position.copy(xOnly);
  }

  const zOnly = actor.position.clone().add(new THREE.Vector3(0, 0, movement.z));
  if (!collidesAt(zOnly, actor.radius)) {
    actor.position.copy(zOnly);
  }
}

function lineIntersectsCollider(from: THREE.Vector3, to: THREE.Vector3, collider: Collider): boolean {
  if (collider.height < 0.8) {
    return false;
  }

  const steps = Math.max(6, Math.ceil(from.distanceTo(to) / 0.45));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = THREE.MathUtils.lerp(from.x, to.x, t);
    const z = THREE.MathUtils.lerp(from.z, to.z, t);
    if (x >= collider.minX && x <= collider.maxX && z >= collider.minZ && z <= collider.maxZ) {
      return true;
    }
  }
  return false;
}

function hasClearLine(from: THREE.Vector3, to: THREE.Vector3): boolean {
  return !colliders.some((collider) => lineIntersectsCollider(from, to, collider));
}

function canSeekerSeeHider(): boolean {
  const distance = seeker.position.distanceTo(hider.position);
  if (distance > SIGHT_RANGE) {
    return false;
  }
  const angle = Math.abs(signedAngleTo(seeker.yaw, seeker.position, hider.position));
  return angle < SIGHT_ANGLE / 2 && hasClearLine(seeker.position, hider.position);
}

function createActor(role: Role, position: THREE.Vector3, yaw: number): Actor {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = yaw;
  scene.add(group);

  const bodyColor = role === 'seeker' ? 0xcd504a : 0x3f84bd;
  const accentColor = role === 'seeker' ? 0x6f1e1a : 0x1d4263;
  const body = cylinder(group, `${role}-body`, 0.36, 0.42, 1.02, 8, solid(bodyColor, 0.8), new THREE.Vector3(0, 0.74, 0), new THREE.Euler(0, 0, 0));
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 0), solid(0xf4c99d, 0.7));
  head.name = `${role}-head`;
  head.position.set(0, 1.46, 0);
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);
  box(group, `${role}-shoulder`, 0, -0.05, 0.82, 0.22, 0.22, solid(accentColor, 0.75), 1.12);
  box(group, `${role}-front-marker`, 0, 0.33, 0.18, 0.12, 0.16, solid(0xfff4c8, 0.7), 1.2);
  body.castShadow = true;

  return {
    group,
    position: position.clone(),
    yaw,
    radius: 0.48,
    speed: role === 'seeker' ? SEEKER_SPEED : HIDER_SPEED,
    turnSpeed: role === 'seeker' ? 2.65 : 2.35,
    moving: false
  };
}

function syncActor(actor: Actor) {
  actor.group.position.copy(actor.position);
  actor.group.rotation.y = actor.yaw;
}

function createVisionCone() {
  const half = SIGHT_ANGLE / 2;
  const vertices = new Float32Array([
    0,
    0.055,
    0,
    Math.sin(-half) * SIGHT_RANGE,
    0.055,
    Math.cos(-half) * SIGHT_RANGE,
    Math.sin(half) * SIGHT_RANGE,
    0.055,
    Math.cos(half) * SIGHT_RANGE
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color: 0xff5a49,
    transparent: true,
    opacity: 0.23,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  visionCone = new THREE.Mesh(geometry, material);
  visionCone.name = 'seeker-vision-cone';
  scene.add(visionCone);
}

function addHouse(
  parent: THREE.Group,
  tiles: TileSet,
  x: number,
  z: number,
  width: number,
  depth: number,
  roofTile: TileName,
  yaw = 0
) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  box(group, 'house-foundation', 0, 0, width + 0.35, depth + 0.35, 0.18, materialFromTile(tiles, 'gravel', 0xffffff, [2, 2]));
  box(group, 'house-body', 0, 0, width, depth, 1.75, materialFromTile(tiles, 'creamWall', 0xffffff, [1.5, 1.1]), 0.18, true);
  box(group, 'house-roof-main', 0, 0, width + 0.72, depth + 0.72, 0.42, materialFromTile(tiles, roofTile, 0xffffff, [2.2, 1.3]), 1.93);
  box(group, 'house-roof-cap', 0, -0.08, width * 0.72, depth * 0.55, 0.28, materialFromTile(tiles, roofTile, 0xffffff, [1.4, 1]), 2.32);
  box(group, 'house-door', 0, depth / 2 + 0.012, 0.42, 0.04, 0.78, solid(0x6d5136), 0.24);
  box(group, 'house-window-left', -width * 0.28, depth / 2 + 0.014, 0.42, 0.035, 0.34, solid(0xaed5df), 1.0);
  box(group, 'house-window-right', width * 0.28, depth / 2 + 0.014, 0.42, 0.035, 0.34, solid(0xaed5df), 1.0);
  box(group, 'garden-strip', -width * 0.72, depth * 0.48, 0.42, depth * 0.84, 0.2, materialFromTile(tiles, 'shrubs', 0xffffff, [1, 2]));
}

function addPipe(parent: THREE.Group, tiles: TileSet, x: number, z: number, rotationY: number) {
  const group = new THREE.Group();
  group.position.set(x, 0.28, z);
  group.rotation.y = rotationY;
  parent.add(group);
  const pipeMaterial = materialFromTile(tiles, 'pipeConcrete', 0xffffff, [1, 1]);
  const dark = solid(0x353332);
  cylinder(group, 'drainage-pipe', 0.42, 0.42, 1.75, 12, pipeMaterial, new THREE.Vector3(0, 0.42, 0), new THREE.Euler(0, 0, Math.PI / 2));
  cylinder(group, 'pipe-mouth-left', 0.33, 0.33, 0.035, 12, dark, new THREE.Vector3(-0.9, 0.42, 0), new THREE.Euler(0, 0, Math.PI / 2));
  cylinder(group, 'pipe-mouth-right', 0.33, 0.33, 0.035, 12, dark, new THREE.Vector3(0.9, 0.42, 0), new THREE.Euler(0, 0, Math.PI / 2));
  colliders.push({ minX: x - 1.15, maxX: x + 1.15, minZ: z - 0.58, maxZ: z + 0.58, height: 0.9, name: 'pipe-collider' });
}

function addTree(parent: THREE.Group, tiles: TileSet, x: number, z: number, scale = 1) {
  cylinder(parent, 'tree-trunk', 0.12 * scale, 0.16 * scale, 0.7 * scale, 6, solid(0x735435), new THREE.Vector3(x, 0.5 * scale, z), new THREE.Euler(0, 0, 0));
  const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62 * scale, 0), materialFromTile(tiles, 'canopy', 0xffffff, [1, 1]));
  crown.name = 'low-poly-tree-crown';
  crown.position.set(x, 1.08 * scale, z);
  crown.scale.y = 1.15;
  crown.castShadow = true;
  crown.receiveShadow = true;
  parent.add(crown);
  colliders.push({ minX: x - 0.35 * scale, maxX: x + 0.35 * scale, minZ: z - 0.35 * scale, maxZ: z + 0.35 * scale, height: 1.7 * scale, name: 'tree' });
}

function addRoadGrid(parent: THREE.Group, tiles: TileSet) {
  box(parent, 'grass-base', 0, 0, WORLD_WIDTH, WORLD_DEPTH, 0.3, materialFromTile(tiles, 'grass', 0xffffff, [22, 16]), -0.32);

  [-22, 0, 19].forEach((z) => {
    box(parent, 'wide-road-horizontal', 0, z, WORLD_WIDTH - 3, 3.1, 0.15, materialFromTile(tiles, 'asphalt', 0xffffff, [20, 1]));
    box(parent, 'wide-sidewalk-north', 0, z - 2.2, WORLD_WIDTH - 3, 0.72, 0.17, materialFromTile(tiles, 'concrete', 0xffffff, [18, 1]));
    box(parent, 'wide-sidewalk-south', 0, z + 2.2, WORLD_WIDTH - 3, 0.72, 0.17, materialFromTile(tiles, 'concrete', 0xffffff, [18, 1]));
  });

  [-30, -5, 18, 33].forEach((x) => {
    box(parent, 'wide-road-vertical', x, 0, 3.1, WORLD_DEPTH - 4, 0.16, materialFromTile(tiles, 'asphalt', 0xffffff, [1, 14]));
    box(parent, 'wide-sidewalk-west', x - 2.2, 0, 0.72, WORLD_DEPTH - 4, 0.17, materialFromTile(tiles, 'concrete', 0xffffff, [1, 14]));
    box(parent, 'wide-sidewalk-east', x + 2.2, 0, 0.72, WORLD_DEPTH - 4, 0.17, materialFromTile(tiles, 'concrete', 0xffffff, [1, 14]));
  });

  [-30, -5, 18, 33].forEach((x) => {
    [-22, 0, 19].forEach((z) => {
      for (let i = 0; i < 5; i += 1) {
        box(parent, 'crosswalk-horizontal', x - 1.22 + i * 0.6, z, 0.34, 2.28, 0.035, solid(0xf5f2e7), 0.19);
      }
    });
  });
}

function addCanal(parent: THREE.Group, tiles: TileSet) {
  box(parent, 'canal-water', 40, 4, 2.6, 55, 0.12, materialFromTile(tiles, 'water', 0xffffff, [1, 15]), 0.04);
  box(parent, 'canal-left-wall', 38.4, 4, 0.42, 55.5, 0.55, materialFromTile(tiles, 'pipeConcrete', 0xffffff, [1, 13]), 0.04, true);
  box(parent, 'canal-right-wall', 41.6, 4, 0.42, 55.5, 0.55, materialFromTile(tiles, 'pipeConcrete', 0xffffff, [1, 13]), 0.04, true);
  [-22, 0, 19].forEach((z) => box(parent, 'canal-bridge', 40, z, 4.6, 1.35, 0.3, materialFromTile(tiles, 'concrete', 0xffffff, [2, 1]), 0.32));
}

function addSchool(parent: THREE.Group, tiles: TileSet) {
  const school = new THREE.Group();
  school.position.set(22, 0, -16.8);
  parent.add(school);
  box(school, 'school-courtyard', 0, 1.9, 10.4, 5.2, 0.16, materialFromTile(tiles, 'concrete', 0xffffff, [5, 2]));
  box(school, 'school-main-building', 0, -2.0, 10.3, 2.3, 2.05, materialFromTile(tiles, 'schoolWall', 0xffffff, [4, 1]), 0, true);
  box(school, 'school-wing', -3.8, 0.3, 2.45, 4.2, 1.55, materialFromTile(tiles, 'schoolWall', 0xffffff, [1, 1.6]), 0, true);
  box(school, 'school-roof-main', 0, -2.0, 10.7, 2.65, 0.28, materialFromTile(tiles, 'greenRoof', 0xffffff, [4, 1]), 2.05);
  box(school, 'school-roof-wing', -3.8, 0.3, 2.85, 4.5, 0.24, materialFromTile(tiles, 'greenRoof', 0xffffff, [1, 2]), 1.55);
  for (let i = 0; i < 8; i += 1) {
    box(school, 'school-window', -4.2 + i * 1.2, -0.8, 0.42, 0.04, 0.32, solid(0xaed5df), 1.23);
  }
  box(school, 'schoolyard', 0.8, 6.1, 10.8, 6.2, 0.14, materialFromTile(tiles, 'schoolDirt', 0xffffff, [5, 3]));
  box(school, 'track-horizontal-a', 0.8, 5.1, 7.2, 0.08, 0.04, solid(0xf6eee1), 0.16);
  box(school, 'track-horizontal-b', 0.8, 7.0, 7.2, 0.08, 0.04, solid(0xf6eee1), 0.16);
  box(school, 'track-vertical-a', -2.8, 6.05, 0.08, 1.9, 0.04, solid(0xf6eee1), 0.16);
  box(school, 'track-vertical-b', 4.4, 6.05, 0.08, 1.9, 0.04, solid(0xf6eee1), 0.16);
}

function addVacantLot(parent: THREE.Group, tiles: TileSet, x: number, z: number) {
  const lot = new THREE.Group();
  lot.position.set(x, 0, z);
  parent.add(lot);
  box(lot, 'vacant-lot-ground', 0, 0, 8.0, 5.8, 0.18, materialFromTile(tiles, 'lotDirt', 0xffffff, [3, 2]));
  box(lot, 'lot-grass-edge-north', 0, -2.58, 7.9, 0.48, 0.2, materialFromTile(tiles, 'grass', 0xffffff, [3, 1]));
  box(lot, 'lot-grass-edge-east', 3.72, 0, 0.48, 5.8, 0.2, materialFromTile(tiles, 'grass', 0xffffff, [1, 2]));
  addPipe(lot, tiles, -2.0, -0.55, 0.05);
  addPipe(lot, tiles, -0.1, 0.62, -0.28);
  addPipe(lot, tiles, 1.85, -0.18, 0.22);
  box(lot, 'lot-low-wall', -4.15, 0, 0.22, 5.8, 0.75, materialFromTile(tiles, 'pipeConcrete', 0xffffff, [1, 2]), 0, true);
}

function addHill(parent: THREE.Group, tiles: TileSet) {
  const hill = new THREE.Group();
  hill.position.set(-26, 0, -23.5);
  parent.add(hill);
  box(hill, 'hill-base', 0, 0, 16.5, 9.8, 0.52, materialFromTile(tiles, 'grass', 0xffffff, [7, 4]));
  box(hill, 'hill-mid', -0.5, -0.2, 13.0, 7.2, 0.82, materialFromTile(tiles, 'grass', 0xe6f4d4, [5, 3]), 0.48);
  box(hill, 'hill-top', -1.1, -0.55, 9.0, 4.95, 0.68, materialFromTile(tiles, 'canopy', 0xffffff, [3, 2]), 1.25, true);
  box(hill, 'hill-path-a', -1.1, 1.0, 1.2, 8.1, 0.08, materialFromTile(tiles, 'forestPath', 0xffffff, [1, 3]), 1.98);
  box(hill, 'hill-path-b', 1.8, -1.1, 6.2, 0.9, 0.08, materialFromTile(tiles, 'forestPath', 0xffffff, [2, 1]), 2.0);
  box(hill, 'small-rest-roof', 4.0, -2.35, 1.4, 1.1, 0.2, materialFromTile(tiles, 'redRoof', 0xffffff, [1, 1]), 2.25);
  box(hill, 'small-rest-body', 4.0, -2.35, 0.8, 0.62, 0.44, solid(0x8d6844), 1.83, true);
  [
    [-6.4, -3.5, 1],
    [-5.4, -1.5, 0.9],
    [-6.8, 2.2, 1.05],
    [-3.6, 3.0, 0.86],
    [-1.1, 2.6, 0.94],
    [1.9, 1.4, 1],
    [5.0, 0.0, 0.86],
    [6.2, -2.7, 0.95],
    [-0.9, -3.5, 1.08],
    [2.4, -3.6, 0.9],
    [5.8, 2.4, 0.82]
  ].forEach(([tx, tz, s]) => addTree(hill, tiles, tx, tz, s));
}

function addUtilityPole(parent: THREE.Group, x: number, z: number) {
  const poleMaterial = solid(0x6c5840);
  cylinder(parent, 'utility-pole', 0.08, 0.1, 2.2, 8, poleMaterial, new THREE.Vector3(x, 1.1, z), new THREE.Euler(0, 0, 0));
  box(parent, 'utility-crossbar', x, z, 1.0, 0.08, 0.08, poleMaterial, 1.85);
}

function addShops(parent: THREE.Group, tiles: TileSet) {
  [
    [7, 6, 'blueRoof'],
    [12, 6, 'redRoof'],
    [24, 7.3, 'greenRoof'],
    [-38, 8, 'blueRoof'],
    [-36, -13, 'redRoof']
  ].forEach(([x, z, roof]) => {
    box(parent, 'shop-body', Number(x), Number(z), 3.6, 2.8, 1.55, materialFromTile(tiles, 'creamWall', 0xf3ead5, [1, 1]), 0, true);
    box(parent, 'shop-roof', Number(x), Number(z), 4.0, 3.15, 0.32, materialFromTile(tiles, roof as TileName, 0xffffff, [1.4, 1]), 1.55);
    box(parent, 'shop-awning', Number(x), Number(z) + 1.54, 2.4, 0.2, 0.18, solid(0x3d83b6), 1.0);
  });
}

function addNeighborhood(parent: THREE.Group, tiles: TileSet) {
  const houseRows: Array<[number, number, TileName, number]> = [
    [-39, -25, 'redRoof', 0],
    [-33, -25, 'blueRoof', 0],
    [-16, -25, 'redRoof', 0],
    [-10, -25, 'blueRoof', 0],
    [6, -25, 'redRoof', 0],
    [31, -25, 'blueRoof', 0],
    [-39, -11, 'blueRoof', Math.PI],
    [-18, -12, 'redRoof', Math.PI],
    [-12, -11, 'blueRoof', Math.PI],
    [3, -12, 'redRoof', Math.PI],
    [30, -12, 'redRoof', Math.PI],
    [-38, 6, 'redRoof', 0],
    [-24, 8, 'blueRoof', 0],
    [-16, 9, 'redRoof', 0],
    [1, 8.5, 'blueRoof', 0],
    [28, 10, 'redRoof', 0],
    [-39, 26, 'blueRoof', Math.PI],
    [-28, 25, 'redRoof', Math.PI],
    [-14, 25, 'blueRoof', Math.PI],
    [2, 26, 'redRoof', Math.PI],
    [17, 25, 'blueRoof', Math.PI],
    [30, 26, 'redRoof', Math.PI]
  ];

  houseRows.forEach(([x, z, roof, yaw], index) => {
    addHouse(parent, tiles, x, z, 3.2 + (index % 3) * 0.25, 2.55 + (index % 2) * 0.25, roof, yaw);
  });

  for (let i = 0; i < 30; i += 1) {
    const x = -40 + i * 2.7;
    addTree(parent, tiles, x, 30.5 + Math.sin(i * 0.55) * 0.35, 0.6 + (i % 4) * 0.04);
  }

  [-42, -34, -28, -18, -9, 4, 12, 26, 36].forEach((x) => addUtilityPole(parent, x, -2.2));
  [-42, -31, -20, -7, 7, 18, 29, 36].forEach((x) => addUtilityPole(parent, x, 16.7));
}

function addPark(parent: THREE.Group, tiles: TileSet) {
  const park = new THREE.Group();
  park.position.set(8, 0, 24.5);
  parent.add(park);
  box(park, 'park-grass', 0, 0, 13.2, 8.2, 0.15, materialFromTile(tiles, 'grass', 0xffffff, [5, 3]));
  box(park, 'park-path', 0, 0.2, 1.0, 7.3, 0.06, materialFromTile(tiles, 'forestPath', 0xffffff, [1, 3]), 0.12);
  box(park, 'park-path-cross', 0, 0.2, 9.8, 0.9, 0.06, materialFromTile(tiles, 'forestPath', 0xffffff, [4, 1]), 0.12);
  box(park, 'play-structure', 3.6, -2.0, 1.7, 1.1, 1.0, solid(0xe2a746), 0.2, true);
  box(park, 'bench-a', -4.0, 2.7, 1.9, 0.42, 0.38, solid(0x8b613a), 0.16, true);
  box(park, 'bench-b', 4.3, 2.3, 1.9, 0.42, 0.38, solid(0x8b613a), 0.16, true);
  [-5, -3, 2.7, 5.5].forEach((x) => addTree(park, tiles, x, -3.2, 0.7));
  [-5.4, -2.6, 1.8, 5.2].forEach((x) => addTree(park, tiles, x, 3.5, 0.75));
}

function addWallsAndHiding(parent: THREE.Group, tiles: TileSet) {
  const wallMaterial = materialFromTile(tiles, 'pipeConcrete', 0xffffff, [2, 1]);
  [
    [-25, -15, 7, 0.35],
    [-20, 14, 8, 0.35],
    [3, -14, 6, 0.35],
    [24, 14.5, 8, 0.35],
    [34.5, -2, 0.35, 8],
    [-10, 3.8, 0.35, 7],
    [11.5, 15, 0.35, 7],
    [-36, 18, 0.35, 6]
  ].forEach(([x, z, width, depth]) => {
    box(parent, 'garden-wall', x, z, width, depth, 1.08, wallMaterial, 0, true);
  });

  addVacantLot(parent, tiles, -20, 11);
  addVacantLot(parent, tiles, 27, -5);
}

async function buildTown() {
  const tiles = await loadTiles();
  addRoadGrid(town, tiles);
  addCanal(town, tiles);
  addHill(town, tiles);
  addSchool(town, tiles);
  addPark(town, tiles);
  addShops(town, tiles);
  addNeighborhood(town, tiles);
  addWallsAndHiding(town, tiles);
  createVisionCone();
  seeker = createActor('seeker', new THREE.Vector3(-33, 0, -18), 0.72);
  hider = createActor('hider', new THREE.Vector3(9, 0, 22.5), -0.35);
  hiderAiTarget.copy(hidingSpots[0]);
  ready = true;
}

function resetRound() {
  elapsed = 0;
  spottedTime = 0;
  caught = false;
  seeker.position.set(-33, 0, -18);
  seeker.yaw = 0.72;
  hider.position.set(9, 0, 22.5);
  hider.yaw = -0.35;
  hiderAiTarget.copy(hidingSpots[0]);
  seekerPatrolIndex = 0;
}

function setActiveRole(role: Role) {
  activeRole = role;
  dom.seekerButton?.classList.toggle('is-active', role === 'seeker');
  dom.hiderButton?.classList.toggle('is-active', role === 'hider');
}

function updateControlledActor(actor: Actor, dt: number) {
  const forward = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
  const turn = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
  actor.yaw += turn * actor.turnSpeed * dt;
  const speedBoost = activeRole === 'hider' && keys.has('shift') ? 1.08 : 1;
  const movement = forwardFromYaw(actor.yaw).multiplyScalar(forward * actor.speed * speedBoost * dt);
  tryMoveActor(actor, movement);
}

function updateSeekerAi(dt: number, visible: boolean) {
  const target = visible || seeker.position.distanceTo(hider.position) < 9 ? hider.position : seekerPatrol[seekerPatrolIndex];
  turnToward(seeker, angleToward(seeker.position, target), dt, visible ? 1.65 : 1);
  const distance = seeker.position.distanceTo(target);
  if (!visible && distance < 1.8) {
    seekerPatrolIndex = (seekerPatrolIndex + 1) % seekerPatrol.length;
  }
  tryMoveActor(seeker, forwardFromYaw(seeker.yaw).multiplyScalar((visible ? SEEKER_SPEED : SEEKER_SPEED * 0.72) * dt));
}

function chooseHidingSpot() {
  const candidates = hidingSpots
    .map((spot) => {
      const distanceFromSeeker = spot.distanceTo(seeker.position);
      const distanceFromHider = spot.distanceTo(hider.position);
      const seekerAngle = Math.abs(signedAngleTo(seeker.yaw, seeker.position, spot));
      const score = distanceFromSeeker * 1.4 - distanceFromHider * 0.4 + (seekerAngle > SIGHT_ANGLE ? 8 : 0);
      return { spot, score };
    })
    .sort((a, b) => b.score - a.score);
  hiderAiTarget.copy(candidates[0].spot);
}

function updateHiderAi(dt: number, visible: boolean, footstepLevel: number) {
  if (elapsed > hiderAiRetargetAt || visible || footstepLevel > 0.45 || hider.position.distanceTo(hiderAiTarget) < 1.8) {
    chooseHidingSpot();
    hiderAiRetargetAt = elapsed + 2.2;
  }
  turnToward(hider, angleToward(hider.position, hiderAiTarget), dt, visible ? 1.7 : 1.15);
  const panic = THREE.MathUtils.clamp(footstepLevel * 0.28 + (visible ? 0.18 : 0), 0, 0.35);
  tryMoveActor(hider, forwardFromYaw(hider.yaw).multiplyScalar(HIDER_SPEED * (0.75 + panic) * dt));
}

function updateCameras() {
  updateFollowCamera(seekerCamera, seeker, 5.0, 2.6, 9.0);
  updateFollowCamera(hiderCamera, hider, 4.55, 2.45, 8.0);
}

function updateFollowCamera(camera: THREE.PerspectiveCamera, actor: Actor, backDistance: number, height: number, lookAhead: number) {
  const forward = forwardFromYaw(actor.yaw);
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const position = actor.position
    .clone()
    .add(forward.clone().multiplyScalar(-backDistance))
    .add(right.multiplyScalar(0.32))
    .add(new THREE.Vector3(0, height, 0));
  const target = actor.position.clone().add(forward.multiplyScalar(lookAhead)).add(new THREE.Vector3(0, 1.2, 0));
  camera.position.copy(position);
  camera.lookAt(target);
}

function updateVisionCone() {
  visionCone.position.set(seeker.position.x, 0, seeker.position.z);
  visionCone.rotation.y = seeker.yaw;
  const material = visionCone.material as THREE.MeshBasicMaterial;
  material.opacity = canSeekerSeeHider() ? 0.38 : 0.22;
}

function updateHud(visible: boolean, footstepLevel: number, distance: number) {
  const footstepPercent = `${Math.round(footstepLevel * 100)}%`;
  const sightPercent = `${Math.round(THREE.MathUtils.clamp(spottedTime / 1.35, 0, 1) * 100)}%`;
  if (dom.footstep) dom.footstep.style.width = footstepPercent;
  if (dom.sight) dom.sight.style.width = sightPercent;
  if (dom.timer) dom.timer.textContent = `${Math.floor(elapsed)}s`;
  if (dom.role) dom.role.textContent = activeRole === 'seeker' ? '鬼' : '隠れる側';
  if (dom.distance) dom.distance.textContent = `${distance.toFixed(1)}m`;
  if (dom.state) {
    dom.state.textContent = caught ? '捕獲' : visible ? '視界内' : footstepLevel > 0.68 ? '足音 大' : footstepLevel > 0.35 ? '足音 中' : '探索中';
  }
  document.body.classList.toggle('is-visible', visible);
  document.body.classList.toggle('is-caught', caught);
}

function ensureAudio() {
  if (audioContext) {
    return;
  }
  const AudioCtor = window.AudioContext;
  audioContext = new AudioCtor();
}

function triggerFootstep(level: number) {
  if (!audioContext || level < 0.18 || caught) {
    return;
  }
  const interval = THREE.MathUtils.lerp(0.7, 0.24, THREE.MathUtils.clamp(level, 0, 1));
  if (elapsed - lastFootstepAt < interval) {
    return;
  }
  lastFootstepAt = elapsed;

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = THREE.MathUtils.lerp(72, 112, level);
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08 * level + 0.015, audioContext.currentTime + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.12);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.14);
}

function updateGame(dt: number) {
  elapsed += dt;
  const distance = seeker.position.distanceTo(hider.position);
  const preliminaryVisible = canSeekerSeeHider();
  const footstepLevel = THREE.MathUtils.clamp((22 - distance) / 22, 0, 1) * (seeker.moving ? 1 : 0.72);
  triggerFootstep(footstepLevel);

  if (caught) {
    seeker.moving = false;
    hider.moving = false;
    updateHud(preliminaryVisible, footstepLevel, distance);
    return;
  }

  if (activeRole === 'seeker') {
    updateControlledActor(seeker, dt);
    updateHiderAi(dt, preliminaryVisible, footstepLevel);
  } else {
    updateControlledActor(hider, dt);
    updateSeekerAi(dt, preliminaryVisible);
  }

  const visible = canSeekerSeeHider();
  spottedTime = THREE.MathUtils.clamp(spottedTime + (visible ? dt : -dt * 0.75), 0, 1.35);
  if (seeker.position.distanceTo(hider.position) <= CAPTURE_DISTANCE) {
    caught = true;
  }

  syncActor(seeker);
  syncActor(hider);
  updateVisionCone();
  updateCameras();
  updateHud(visible, footstepLevel, seeker.position.distanceTo(hider.position));
}

function renderSplitScreen() {
  const width = canvasElement.clientWidth;
  const height = canvasElement.clientHeight;
  const leftWidth = Math.floor(width / 2);
  const rightWidth = width - leftWidth;

  renderer.setSize(width, height, false);
  renderer.setScissorTest(true);
  renderer.clear();

  seekerCamera.aspect = leftWidth / height;
  seekerCamera.updateProjectionMatrix();
  renderer.setViewport(0, 0, leftWidth, height);
  renderer.setScissor(0, 0, leftWidth, height);
  renderer.render(scene, seekerCamera);

  hiderCamera.aspect = rightWidth / height;
  hiderCamera.updateProjectionMatrix();
  renderer.setViewport(leftWidth, 0, rightWidth, height);
  renderer.setScissor(leftWidth, 0, rightWidth, height);
  renderer.render(scene, hiderCamera);
  renderer.setScissorTest(false);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (ready) {
    updateGame(dt);
    renderSplitScreen();
  }
  requestAnimationFrame(animate);
}

window.addEventListener('keydown', (event) => {
  ensureAudio();
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
    event.preventDefault();
  }
  if (key === '1') setActiveRole('seeker');
  if (key === '2') setActiveRole('hider');
  if (key === 'r' && ready) resetRound();
  keys.add(key);
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.key.toLowerCase());
});

dom.seekerButton?.addEventListener('click', () => {
  ensureAudio();
  setActiveRole('seeker');
});
dom.hiderButton?.addEventListener('click', () => {
  ensureAudio();
  setActiveRole('hider');
});
dom.resetButton?.addEventListener('click', () => {
  ensureAudio();
  if (ready) resetRound();
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setActiveRole('seeker');
buildTown().catch((error) => {
  console.error(error);
});
animate();
