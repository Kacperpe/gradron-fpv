/* ============================================================
   GRADRON — symulator lotu dronem FPV (acro)
   three.js r149 (vendor/three.min.js), bez zależności online
   ============================================================ */
(function () {
'use strict';

const V3 = THREE.Vector3;
const DEG = Math.PI / 180;

/* ---------- deterministyczny RNG (ten sam świat za każdym razem) ---------- */
let _seed = 20260729;
function rnd() { _seed = (_seed * 1664525 + 1013904223) % 4294967296; return _seed / 4294967296; }
function rr(a, b) { return a + (b - a) * rnd(); }

/* ============================================================
   RENDERER / SCENA
   ============================================================ */
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const SKY_TOP = new THREE.Color(0x2f6ea8);
const SKY_BOT = new THREE.Color(0xbcd6e4);
scene.fog = new THREE.Fog(0xa8c4d6, 140, 620);

const camera = new THREE.PerspectiveCamera(105, window.innerWidth / window.innerHeight, 0.08, 2200);
/* pionowe pole widzenia dla obu kamer — przelicza je fitView() pod proporcje ekranu */
const FOV = { fpv: 105, tpp: 74 };

/* niebo — gradientowa kopuła ze słońcem */
const SUN_DIR = new V3(-0.45, 0.62, 0.64).normalize();
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1600, 32, 20),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      top: { value: SKY_TOP }, bot: { value: SKY_BOT },
      sun: { value: SUN_DIR }, sunCol: { value: new THREE.Color(0xfff4d6) }
    },
    vertexShader: `varying vec3 vW; void main(){ vW = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top,bot,sun,sunCol; varying vec3 vW;
      void main(){
        float h = clamp(vW.y*0.5+0.5, 0.0, 1.0);
        vec3 c = mix(bot, top, pow(h, 0.75));
        float d = max(dot(normalize(vW), normalize(sun)), 0.0);
        c += sunCol * (pow(d, 700.0)*1.4 + pow(d, 12.0)*0.22);
        gl_FragColor = vec4(c, 1.0);
      }`
  })
);
sky.frustumCulled = false;
scene.add(sky);

/* światła */
const sun = new THREE.DirectionalLight(0xfff0d8, 1.22);
sun.position.copy(SUN_DIR).multiplyScalar(180);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 420;
sun.shadow.camera.left = -130; sun.shadow.camera.right = 130;
sun.shadow.camera.top = 130; sun.shadow.camera.bottom = -130;
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xc8e4f4, 0x566047, 0.72));

/* ============================================================
   ŚWIAT
   ============================================================ */
const colliders = [];                    // { min:V3, max:V3 }
function addBox(mesh) {
  mesh.updateMatrixWorld();
  const bb = new THREE.Box3().setFromObject(mesh);
  colliders.push({ min: bb.min, max: bb.max });
}

/* teren — fotorealistyczna, lokalna tekstura działa także z file:// */
const textureLoader = new THREE.TextureLoader();
function loadTiledTexture(path, rx, ry) {
  const t = textureLoader.load(path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.encoding = THREE.sRGBEncoding;
  return t;
}
const groundMap = loadTiledTexture('assets/textures/industrial-ground.jpg', 120, 120);
const concreteMap = loadTiledTexture('assets/textures/weathered-concrete.jpg', 2, 2);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2400, 2400),
  new THREE.MeshStandardMaterial({ map: groundMap, color: 0xd9d5c4, roughness: 0.99, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/* ---------- trasa: waypointy pętli ---------- */
const WPS = [
  [20, 6, 48], [-10, 9, 50], [-45, 13, 44], [-75, 17, 26], [-85, 21, -6],
  [-72, 12, -40], [-45, 7, -58], [-10, 12, -62], [22, 16, -50], [42, 9, -22],
  [46, 5.5, 8], [34, 11, 36]
];
const START = new V3(32, 0.3, 44);
const GATE_R = 3.4;

const gates = [];
const gateGroup = new THREE.Group();
scene.add(gateGroup);

const matRing = new THREE.MeshStandardMaterial({ color: 0x18242c, roughness: 0.55, metalness: 0.35 });
const matStripe = new THREE.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.6 });
const matNext = new THREE.MeshStandardMaterial({ color: 0x123a2c, emissive: 0x2fd08a, emissiveIntensity: 1.5, roughness: 0.4 });

function buildGate(i, p, dir) {
  const g = new THREE.Group();
  g.position.copy(p);
  g.rotation.y = Math.atan2(dir.x, dir.z);   // lokalne +Z = kierunek lotu

  const ring = new THREE.Mesh(new THREE.TorusGeometry(GATE_R, 0.22, 10, 44), matRing);
  g.add(ring);
  // 4 znaczniki na obwodzie (żeby widzieć obrót bramki)
  for (let k = 0; k < 4; k++) {
    const s = new THREE.Mesh(new THREE.TorusGeometry(GATE_R, 0.26, 8, 8, 0.5), matStripe);
    s.rotation.z = k * Math.PI / 2 + 0.25;
    g.add(s);
  }
  // słupki do ziemi
  const h = p.y - GATE_R - 0.6;
  if (h > 0.4) {
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, h, 7), matRing);
      post.position.set(sx * GATE_R * 0.72, -GATE_R * 0.7 - h / 2, 0);
      post.castShadow = true;
      g.add(post);
    }
  }
  ring.castShadow = true;
  gateGroup.add(g);
  gates.push({ obj: g, pos: p.clone(), quat: g.quaternion.clone(), ring, idx: i, prevZ: null });
}

for (let i = 0; i < WPS.length; i++) {
  const p = new V3().fromArray(WPS[i]);
  const a = new V3().fromArray(WPS[(i - 1 + WPS.length) % WPS.length]);
  const b = new V3().fromArray(WPS[(i + 1) % WPS.length]);
  buildGate(i, p, b.clone().sub(a).setY(0).normalize());
}

/* beacon nad następną bramką */
const beacon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.35, 0.35, 90, 8, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x2fd08a, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false })
);
scene.add(beacon);

function nearGate(x, z, m) {
  for (const g of gates) if (Math.hypot(g.pos.x - x, g.pos.z - z) < m) return true;
  for (let i = 0; i < WPS.length; i++) {                 // także odcinki między bramkami
    const a = new V3().fromArray(WPS[i]), b = new V3().fromArray(WPS[(i + 1) % WPS.length]);
    const abx = b.x - a.x, abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)));
    if (Math.hypot(a.x + abx * t - x, a.z + abz * t - z) < m * 0.62) return true;
  }
  return false;
}

/* ---------- realistyczny teren poprzemysłowy ---------- */
const concreteMats = [0xd0ccc1, 0xa9aaa3, 0xb7b0a2, 0x8f9694].map(c =>
  new THREE.MeshStandardMaterial({ map: concreteMap, color: c, roughness: 0.93, metalness: 0.015 }));
const darkConcreteMat = new THREE.MeshStandardMaterial({ map: concreteMap, color: 0x777b77, roughness: 0.96 });
const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x343936, roughness: 0.98 });
const asphaltPatchMat = new THREE.MeshStandardMaterial({ color: 0x272c2b, roughness: 1 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x687176, roughness: 0.82, metalness: 0.22 });
const rustRoofMat = new THREE.MeshStandardMaterial({ color: 0x6e5a48, roughness: 0.9, metalness: 0.12 });
const winMat = new THREE.MeshStandardMaterial({
  color: 0x26343b, roughness: 0.18, metalness: 0.35, emissive: 0x081014, emissiveIntensity: 0.2
});
const doorMat = new THREE.MeshStandardMaterial({ color: 0x3f4b4c, roughness: 0.72, metalness: 0.35 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0x5f6666, roughness: 0.58, metalness: 0.72 });
const rustMat = new THREE.MeshStandardMaterial({ color: 0x76503c, roughness: 0.82, metalness: 0.45 });
const warningMat = new THREE.MeshStandardMaterial({ color: 0xd8a92f, roughness: 0.68, metalness: 0.2 });

function staticBox(x, y, z, w, h, d, mat, rot, collision) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = rot || 0;
  m.castShadow = true; m.receiveShadow = true; scene.add(m);
  if (collision !== false) addBox(m);
  return m;
}

function roadBetween(ax, az, bx, bz, width, mat) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  const r = staticBox((ax + bx) / 2, 0.018, (az + bz) / 2, width, 0.035, len,
    mat || asphaltMat, Math.atan2(dx, dz), false);
  r.receiveShadow = true;
}

// Nierówne, częściowo połatane drogi dają skalę i czytelny ruch przy niskim locie.
roadBetween(-125, 68, 92, 68, 13, asphaltMat);
roadBetween(59, 92, 59, -105, 11, asphaltMat);
roadBetween(-92, -73, 78, -73, 8, asphaltMat);
roadBetween(-95, 8, 88, 8, 7, asphaltMat);
for (let i = 0; i < 18; i++) {
  const patch = staticBox(rr(-105, 75), 0.041, rr(-76, 72), rr(2, 8), 0.018, rr(1.2, 4),
    asphaltPatchMat, rr(-0.3, 0.3), false);
  patch.receiveShadow = true;
}

function addFacadeWindows(grp, w, d, h, industrial) {
  const rows = industrial ? 1 : Math.max(1, Math.floor((h - 2.5) / 3));
  const cols = Math.max(2, Math.floor(w / (industrial ? 4.5 : 3.2)));
  for (let row = 0; row < rows; row++) {
    const y = industrial ? h - 1.8 : 2.3 + row * 3;
    for (let col = 0; col < cols; col++) {
      if (industrial && (col % 3 === 1)) continue;
      const px = -w * 0.42 + col * (w * 0.84 / Math.max(1, cols - 1));
      const pane = new THREE.Mesh(new THREE.BoxGeometry(industrial ? 2.2 : 1.45, industrial ? 0.75 : 1.1, 0.08), winMat);
      pane.position.set(px, y, -d / 2 - 0.045); grp.add(pane);
    }
  }
}

function warehouse(x, z, w, d, h, rot) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z); grp.rotation.y = rot || 0;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), concreteMats[(rnd() * concreteMats.length) | 0]);
  body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true; grp.add(body);
  const slope = 0.105;
  for (const side of [-1, 1]) {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.52, 0.28, d * 1.035), rnd() > 0.25 ? roofMat : rustRoofMat);
    roof.position.set(side * w * 0.255, h + 0.3, 0);
    roof.rotation.z = -side * slope; roof.castShadow = true; grp.add(roof);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(Math.min(5.5, w * 0.35), Math.min(4.8, h * 0.65), 0.18), doorMat);
  door.position.set(w * 0.22, door.geometry.parameters.height / 2, -d / 2 - 0.1); grp.add(door);
  addFacadeWindows(grp, w, d, h, true);
  if (rnd() > 0.45) {
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.4, 10), steelMat);
    vent.position.set(rr(-w * 0.3, w * 0.3), h + 1.15, rr(-d * 0.25, d * 0.25)); grp.add(vent);
  }
  scene.add(grp); addBox(body);
  return grp;
}

function office(x, z, w, d, h, rot) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z); grp.rotation.y = rot || 0;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), concreteMats[(rnd() * concreteMats.length) | 0]);
  body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true; grp.add(body);
  addFacadeWindows(grp, w, d, h, false);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.025, 0.35, d * 1.025), darkConcreteMat);
  cap.position.y = h + 0.15; cap.castShadow = true; grp.add(cap);
  const entrance = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.8, 0.16), doorMat);
  entrance.position.set(0, 1.4, -d / 2 - 0.09); grp.add(entrance);
  scene.add(grp); addBox(body); addBox(cap);
  return grp;
}

function industrialTank(x, z, radius, h) {
  const grp = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 20), steelMat);
  tank.position.set(x, h / 2, z); tank.castShadow = true; tank.receiveShadow = true; scene.add(tank); addBox(tank);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.01, 0.11, 6, 24), rustMat);
  rim.rotation.x = Math.PI / 2; rim.position.set(x, h * 0.78, z); scene.add(rim);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.82, 0.045, 5, 24), warningMat);
  rail.rotation.x = Math.PI / 2; rail.position.set(x, h + 0.42, z); scene.add(rail);
  for (let i = 0; i < 4; i++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.75, 5), warningMat);
    const a = i * Math.PI / 2; post.position.set(x + Math.cos(a) * radius * 0.82, h + 0.2, z + Math.sin(a) * radius * 0.82);
    scene.add(post);
  }
  return grp;
}

function shippingContainer(x, z, rot, color, stacked) {
  const y = stacked ? 3.0 : 1.35;
  const box = staticBox(x, y, z, 2.45, 2.65, 6.1,
    new THREE.MeshStandardMaterial({ color, roughness: 0.73, metalness: 0.36 }), rot, true);
  for (let i = -2; i <= 2; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.045, 2.45, 6.16), steelMat);
    rib.position.set(i * 0.46, 0, 0); box.add(rib);
  }
  return box;
}

function pipeGantry(x, z, w, h, rot) {
  const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = rot || 0;
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.42, h, 0.42), rustMat);
    post.position.set(sx * w / 2, h / 2, 0); post.castShadow = true; grp.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.42, 0.5), rustMat);
  beam.position.y = h; beam.castShadow = true; grp.add(beam);
  for (let i = 0; i < 3; i++) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, w + 0.4, 8), i === 1 ? warningMat : steelMat);
    pipe.rotation.z = Math.PI / 2; pipe.position.set(0, h - 0.45 - i * 0.32, 0); grp.add(pipe);
  }
  scene.add(grp);
  for (const child of grp.children) addBox(child);
}

function lampPost(x, z, h) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, h, 7), steelMat);
  pole.position.set(x, h / 2, z); pole.castShadow = true; scene.add(pole); addBox(pole);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.18, 0.34), doorMat);
  head.position.set(x + 0.28, h, z); head.rotation.z = -0.12; scene.add(head);
}

// Główne obiekty: niskie magazyny, biura techniczne i zbiorniki zamiast losowych wieżowców.
warehouse(-18, -5, 34, 19, 8.5, 0.04);
warehouse(18, -20, 25, 15, 7.2, -0.09);
warehouse(-37, -28, 23, 16, 9.5, 0.12);
office(-6, 25, 18, 12, 11.5, -0.03);
office(69, -36, 17, 13, 15, 0.08);
warehouse(-112, 25, 30, 17, 8, -0.12);
warehouse(-88, 77, 26, 16, 7, 0.06);
warehouse(83, 65, 34, 18, 9, -0.04);
office(-105, -72, 18, 14, 18, 0.05);

industrialTank(-3, -38, 4.1, 10);
industrialTank(7, -40, 3.3, 8);
industrialTank(-2, -49, 3.7, 12);
pipeGantry(34, -5, 12, 6.5, Math.PI / 2);
pipeGantry(-61, 4, 10, 5.5, 0);

// Plac kontenerowy i betonowe szykany.
const containerColors = [0x735346, 0x385b62, 0x65704b, 0x8a7b5d, 0x4a555d];
for (let i = 0; i < 10; i++) {
  const row = i % 2, col = (i / 2) | 0;
  shippingContainer(72 + row * 4.0, 18 + col * 7.0, row ? 0.04 : -0.04,
    containerColors[i % containerColors.length], false);
}
shippingContainer(76, 32, -0.02, 0x6a4b40, true);

for (let i = 0; i < 9; i++) {
  const x = -30 + i * 7.5, h = rr(1.1, 1.8);
  staticBox(x, h / 2, 70, 4.2, h, 0.65, i % 3 === 0 ? warningMat : darkConcreteMat, rr(-0.06, 0.06), true);
}

// Komin i wieża wodna są mocnymi punktami orientacyjnymi z daleka.
const chimney = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 3.3, 55, 18), rustMat);
chimney.position.set(-128, 27.5, -12); chimney.castShadow = true; scene.add(chimney); addBox(chimney);
for (let y = 12; y < 53; y += 8) {
  const band = new THREE.Mesh(new THREE.TorusGeometry(2.55 - y * 0.012, 0.14, 6, 22), darkConcreteMat);
  band.rotation.x = Math.PI / 2; band.position.set(-128, y, -12); scene.add(band);
}
const waterTowerTank = new THREE.Mesh(new THREE.SphereGeometry(5.2, 18, 12), steelMat);
waterTowerTank.scale.y = 0.72; waterTowerTank.position.set(102, 31, -70);
waterTowerTank.castShadow = true; scene.add(waterTowerTank); addBox(waterTowerTank);
for (const sx of [-1, 1]) for (const sz of [-1, 1])
  staticBox(102 + sx * 2.7, 14, -70 + sz * 2.7, 0.35, 28, 0.35, rustMat, 0, true);

for (const [x, z] of [[-72, 66], [-38, 66], [2, 66], [42, 66], [60, 37], [60, -4], [60, -49], [-60, -72]])
  lampPost(x, z, rr(8, 11));

/* drzewa — instancing daje gęstsze, bardziej naturalne obrzeże bez setek draw calli */
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x594331, roughness: 1 });
const leafMat = new THREE.MeshStandardMaterial({
  color: 0x214a22, roughness: 1, emissive: 0x071006, emissiveIntensity: 0.08
});
const leafMat2 = new THREE.MeshStandardMaterial({
  color: 0x315b2a, roughness: 1, emissive: 0x091208, emissiveIntensity: 0.07
});
const treeMax = 220;
const trunkInstances = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.32, 1, 7), trunkMat, treeMax);
const crownInstances = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), leafMat, treeMax);
const crown2Instances = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), leafMat2, treeMax);
const dummy = new THREE.Object3D();
let treeCount = 0;
for (let i = 0; i < treeMax * 2 && treeCount < treeMax; i++) {
  const a = rnd() * Math.PI * 2, r = rr(78, 330);
  const x = Math.cos(a) * r - 20 + rr(-18, 18), z = Math.sin(a) * r - 8 + rr(-18, 18);
  if (nearGate(x, z, GATE_R + 8) || Math.hypot(x - START.x, z - START.z) < 15) continue;
  const h = rr(5.5, 13.5), crown = h * rr(0.24, 0.34);
  dummy.position.set(x, h * 0.22, z); dummy.scale.set(rr(0.8, 1.2), h * 0.44, rr(0.8, 1.2));
  dummy.rotation.y = rnd() * Math.PI; dummy.updateMatrix(); trunkInstances.setMatrixAt(treeCount, dummy.matrix);
  dummy.position.set(x, h * 0.63, z); dummy.scale.set(crown, crown * rr(0.8, 1.2), crown);
  dummy.rotation.y = rnd() * Math.PI; dummy.updateMatrix(); crownInstances.setMatrixAt(treeCount, dummy.matrix);
  dummy.position.set(x + rr(-0.5, 0.5), h * 0.82, z + rr(-0.5, 0.5));
  dummy.scale.set(crown * 0.72, crown * 0.62, crown * 0.72); dummy.updateMatrix();
  crown2Instances.setMatrixAt(treeCount, dummy.matrix);
  colliders.push({ min: new V3(x - 0.38, 0, z - 0.38), max: new V3(x + 0.38, h * 0.55, z + 0.38) });
  const crownHit = crown * 0.72;
  colliders.push({
    min: new V3(x - crownHit, h * 0.42, z - crownHit),
    max: new V3(x + crownHit, h * 1.04, z + crownHit)
  });
  treeCount++;
}
trunkInstances.count = crownInstances.count = crown2Instances.count = treeCount;
trunkInstances.castShadow = crownInstances.castShadow = crown2Instances.castShadow = true;
trunkInstances.receiveShadow = true;
scene.add(trunkInstances, crownInstances, crown2Instances);

/* kępy trawy i kamienie — jeden draw call na typ, a przy ziemi znika efekt idealnie płaskiej planszy */
function onPavement(x, z) {
  return Math.abs(z - 68) < 7.2 || Math.abs(x - 59) < 6.2 ||
    Math.abs(z + 73) < 4.5 || Math.abs(z - 8) < 4 ||
    Math.hypot(x - START.x, z - START.z) < 5.2;
}
const grassInstances = new THREE.InstancedMesh(
  new THREE.ConeGeometry(0.11, 0.42, 3),
  new THREE.MeshStandardMaterial({ color: 0x66733d, roughness: 1 }),
  720
);
let grassCount = 0;
for (let i = 0; i < 1100 && grassCount < 720; i++) {
  const x = rr(-165, 135), z = rr(-130, 115);
  if (onPavement(x, z) || rnd() < 0.12) continue;
  const s = rr(0.55, 1.45);
  dummy.position.set(x, 0.18 * s, z); dummy.scale.set(rr(0.6, 1.4), s, rr(0.6, 1.4));
  dummy.rotation.set(rr(-0.12, 0.12), rnd() * Math.PI * 2, rr(-0.12, 0.12));
  dummy.updateMatrix(); grassInstances.setMatrixAt(grassCount++, dummy.matrix);
}
grassInstances.count = grassCount;
scene.add(grassInstances);

const rockInstances = new THREE.InstancedMesh(
  new THREE.DodecahedronGeometry(0.22, 0),
  new THREE.MeshStandardMaterial({ color: 0x77746a, roughness: 1 }),
  120
);
let rockCount = 0;
for (let i = 0; i < 220 && rockCount < 120; i++) {
  const x = rr(-155, 125), z = rr(-120, 105);
  if (onPavement(x, z)) continue;
  const s = rr(0.35, 1.35);
  dummy.position.set(x, 0.12 * s, z); dummy.scale.set(s, rr(0.45, 0.9) * s, rr(0.7, 1.3) * s);
  dummy.rotation.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);
  dummy.updateMatrix(); rockInstances.setMatrixAt(rockCount++, dummy.matrix);
}
rockInstances.count = rockCount;
rockInstances.castShadow = true;
scene.add(rockInstances);

/* daleki horyzont: niska zabudowa przemysłowa, wzgórza i pas lasu */
const hillMat = new THREE.MeshStandardMaterial({ color: 0x4c5d49, roughness: 1, fog: true });
for (let i = 0; i < 34; i++) {
  const a = i / 34 * Math.PI * 2 + rr(-0.05, 0.05), r = rr(500, 720);
  const hill = new THREE.Mesh(new THREE.SphereGeometry(rr(50, 110), 10, 7), hillMat);
  hill.scale.y = rr(0.18, 0.34); hill.position.set(Math.cos(a) * r, rr(-18, -5), Math.sin(a) * r);
  scene.add(hill);
}
for (let i = 0; i < 38; i++) {
  const a = rnd() * Math.PI * 2, r = rr(260, 540), h = rr(8, 34), w = rr(14, 42);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, rr(12, 28)), concreteMats[(rnd() * concreteMats.length) | 0]);
  m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); m.receiveShadow = true; scene.add(m);
}

/* płyta startowa z zabrudzoną farbą */
const helipad = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.14, 36),
  new THREE.MeshStandardMaterial({ color: 0x303432, roughness: 0.96 }));
helipad.position.set(START.x, 0.07, START.z); helipad.receiveShadow = true; scene.add(helipad);
const padRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.1, 6, 48),
  new THREE.MeshStandardMaterial({ color: 0xcabf53, roughness: 0.84 }));
padRing.rotation.x = -Math.PI / 2; padRing.position.set(START.x, 0.16, START.z); scene.add(padRing);

/* ============================================================
   MAPY — tor wyścigowy + mapy misyjne z plików map-*.js
   Tor zostaje zbudowany powyżej; tutaj tylko robimy jego migawkę,
   żeby dało się go schować i podstawić inną mapę.
   ============================================================ */
const TOR_OBJECTS = scene.children.filter(o => o !== sky && o !== sun.target && !o.isLight);
const TOR_COLLIDERS = colliders.slice();
const FLAT_SURF = { y: 0, water: false };

const MAP_DEFS = [
  {
    key: 'tor', label: 'Tor wyścigowy (12 bramek)', short: 'Strefa 12',
    type: 'Wyścig · techniczna', desc: '12 bramek, ciasne linie i industrialne przeszkody',
    race: true, fog: [140, 620], bounds: 700, ceiling: 260, signalRange: 520,
    skyTop: 0x2f6ea8, skyBot: 0xbcd6e4, fogColor: 0xa8c4d6, exposure: 0.92, glow: '#7ef7c0'
  },
  {
    key: 'port', label: 'Port Mewi (misyjna)', short: 'Port Mewi',
    type: 'Freestyle · morska', desc: 'Suwnice, kontenery, statki, wiatraki i otwarta woda',
    race: false, fog: [190, 1420], bounds: 900, ceiling: 320, signalRange: 760,
    skyTop: 0x315a76, skyBot: 0xb2c7c9, fogColor: 0x9fb5ba, exposure: 0.88, glow: '#57bde8',
    build: () => (typeof PortMap === 'undefined' ? null : PortMap.create(THREE, scene, renderer))
  },
  {
    key: 'alpine', label: 'Dolina Wilcza (misyjna)', short: 'Dolina Wilcza',
    type: 'Eksploracja · górska', desc: 'Zapora, las, wyciąg i loty wysoko nad doliną',
    race: false, fog: [220, 1780], bounds: 820, ceiling: 620, signalRange: 900,
    skyTop: 0x315178, skyBot: 0xd1d9d4, fogColor: 0xbac6c2, exposure: 0.98, glow: '#ffd36a',
    build: () => (typeof AlpineMap === 'undefined' ? null : AlpineMap.create(THREE, scene, renderer))
  }
];
const builtMaps = {};                    // cache: mapy budujemy raz, potem tylko przełączamy visible
let activeMap = {
  key: 'tor', name: 'TOR WYŚCIGOWY', race: true, fog: [140, 620],
  spawn: { pos: START.clone() }, pois: [], surfaceAt: null, update: null,
  bounds: 700, ceiling: 260, signalRange: 520
};

/* słup światła nad wybranym celem nawigacji (mapy misyjne) */
const navBeacon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.6, 0.6, 300, 8, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x2fd08a, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false })
);
navBeacon.visible = false;
scene.add(navBeacon);
let navIdx = 0;

function navTarget() {
  const p = activeMap.pois;
  return p && p.length ? p[((navIdx % p.length) + p.length) % p.length] : null;
}
function updateNavBeacon() {
  const t = navTarget();
  navBeacon.visible = !!t && !activeMap.race;
  if (t) navBeacon.position.set(t[1].x, t[1].y + 150, t[1].z);
}
function cycleNav(d) {
  const t0 = navTarget();
  if (!t0) return;
  navIdx += d;
  updateNavBeacon();
  const t = navTarget();
  msg('', 'cel: ' + t[0] + '  ·  ' + st.pos.distanceTo(t[1]).toFixed(0) + ' m', 1.6);
}
function faceNav() {
  const t = navTarget();
  const d = (t ? t[1].clone() : new V3(0, 0, 0)).sub(st.pos).setY(0);
  if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
  st.quat.setFromEuler(new THREE.Euler(0, Math.atan2(d.x, d.z) + Math.PI, 0));
}

/* ustawienie drona na starcie aktualnej mapy */
function resetOnMap() {
  st.pos.copy(activeMap.spawn.pos);
  if (activeMap.surfaceAt) st.pos.y = activeMap.surfaceAt(st.pos.x, st.pos.z).y + 0.3;
  st.vel.set(0, 0, 0); st.omega.set(0, 0, 0);
  st.quat.identity();
  if (activeMap.race) faceGate(0); else faceNav();
  st.onGround = true; st.crashed = 0; st.camSnap = true;
  st.signalQuality = st.signalRaw = 1; st.signalBlocked = 0; st.signalDistance = 0;
  st.timing = false; st.time = 0; st.nextGate = 0; st.lastGate = -1; st.lap = 0;
  stick.thr = 0;
  if (activeMap.race) { for (const g of gates) g.prevZ = null; updateBeacon(); }
  updateNavBeacon();
}

function setMap(key, quiet) {
  const def = MAP_DEFS.find(d => d.key === key) || MAP_DEFS[0];

  if (def.key !== 'tor' && !builtMaps[def.key]) {
    const m = def.build();
    if (!m) {                                   // brak pliku mapy — zostajemy na torze
      msg('BŁĄD', 'brak pliku mapy ' + def.key, 2.2);
      return setMap('tor', true);
    }
    builtMaps[def.key] = m;
  }

  for (const o of TOR_OBJECTS) o.visible = def.key === 'tor';
  for (const k in builtMaps) builtMaps[k].root.visible = k === def.key;

  colliders.length = 0;
  if (def.key === 'tor') {
    for (const c of TOR_COLLIDERS) colliders.push(c);
    activeMap = {
      key: 'tor', name: 'TOR WYŚCIGOWY', race: true, fog: def.fog,
      spawn: { pos: START.clone() }, pois: [], surfaceAt: null, update: null,
      bounds: def.bounds, ceiling: def.ceiling, signalRange: def.signalRange
    };
  } else {
    const m = builtMaps[def.key];
    for (const c of m.colliders) colliders.push(c);
    activeMap = {
      key: def.key, name: m.name, race: false, fog: def.fog,
      spawn: m.spawn, pois: m.pois || [], surfaceAt: m.surfaceAt || null,
      zones: m.zones, landmarks: m.landmarks, update: m.update,
      bounds: def.bounds, ceiling: def.ceiling, signalRange: def.signalRange
    };
  }

  SKY_TOP.setHex(def.skyTop);
  SKY_BOT.setHex(def.skyBot);
  scene.fog.color.setHex(def.fogColor);
  scene.fog.near = activeMap.fog[0];
  scene.fog.far = activeMap.fog[1];
  renderer.toneMappingExposure = def.exposure;
  navIdx = 0;
  try { localStorage.setItem('gradron.map', activeMap.key); } catch (e) { }
  resetOnMap();
  if (typeof paintMapCards === 'function') paintMapCards();
  if (!quiet) msg(activeMap.name, activeMap.race ? 'wyścig przez bramki' : 'lot swobodny — cel: G / menu', 2);
}
function cycleMap(d) {
  const i = MAP_DEFS.findIndex(m => m.key === activeMap.key);
  setMap(MAP_DEFS[(i + (d || 1) + MAP_DEFS.length) % MAP_DEFS.length].key);
}

/* ============================================================
   DRON
   ============================================================ */
const drone = new THREE.Group();
scene.add(drone);
const props = [];
(function buildDrone() {
  const cf = new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.45, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x2fd08a, roughness: 0.4, emissive: 0x0d3b2a });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.34), cf);
  body.castShadow = true; drone.add(body);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.1), accent);
  cam.position.set(0, 0.08, -0.13); cam.rotation.x = 0.4; drone.add(cam);
  const vtx = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 5), accent);
  vtx.position.set(0, 0.13, 0.16); drone.add(vtx);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.3), cf);
    arm.position.set(sx * 0.12, 0, sz * 0.16);
    arm.rotation.y = sx * sz * 0.7; arm.castShadow = true; drone.add(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.06, 8), cf);
    motor.position.set(sx * 0.2, 0.03, sz * 0.2); drone.add(motor);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.006, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xdfe6e2, transparent: true, opacity: 0.55, roughness: 0.3 }));
    prop.position.set(sx * 0.2, 0.07, sz * 0.2);
    props.push(prop); drone.add(prop);
  }
})();

/* ============================================================
   STAN LOTU / FIZYKA
   ============================================================ */
const G = 9.81;
const MASS = 0.75;              // kg, typowy freestyle 5" z baterią
const MAX_THRUST = 45;          // N/kg przy nominalnym napięciu (TWR ~4.6:1)
const MAX_TOTAL_THRUST = MASS * MAX_THRUST;
const MAX_MOTOR_THRUST = MAX_TOTAL_THRUST / 4;
const RATE_RP = 10.5;           // rad/s roll & pitch (~600 deg/s)
const RATE_Y = 7.0;             // rad/s yaw (~400 deg/s)
const MAX_TILT = 32 * DEG;      // angle mode
const R_DRONE = 0.26;
const ARM = 0.20;               // współrzędna silnika od środka ramy [m]
const INERTIA = new V3(0.0045, 0.0070, 0.0042); // kg*m^2, pitch/yaw/roll
const YAW_MOMENT = 0.018;        // moment reakcyjny [Nm] / ciąg [N]
const MOTOR_IDLE = 0.025;        // dynamic idle / Airmode
const MOTOR_TAU_UP = 0.035;      // czas rozpędzania silnika [s]
const MOTOR_TAU_DOWN = 0.022;    // active braking jest szybszy niż rozpędzanie
const BAT_CELLS = 6;
const BAT_CAPACITY_AH = 1.30;
const BAT_INTERNAL_R = 0.045;    // rezystancja całego pakietu [ohm]
const WIND_LEVELS = [0, 1, 2, 4, 6, 8, 12, 16]; // średnia prędkość przy ziemi [m/s]
const savedWind = parseFloat(localStorage.getItem('gradron.wind') || '');

// Kolejność odpowiada modelowi graficznemu: FL, FR, RL, RR.
// Przeciwległe silniki wirują w tę samą stronę.
const MOTORS = [
  { x: -ARM, z: -ARM, spin:  1 },
  { x:  ARM, z: -ARM, spin: -1 },
  { x: -ARM, z:  ARM, spin: -1 },
  { x:  ARM, z:  ARM, spin:  1 }
];

const st = {
  pos: START.clone(),
  vel: new V3(),
  quat: new THREE.Quaternion(),
  omega: new V3(),
  motor: [0, 0, 0, 0],       // znormalizowane rzeczywiste RPM
  motorCmd: [0, 0, 0, 0],    // wyjście miksera 0..1 (znormalizowany ciąg)
  pidI: new V3(),
  lastOmega: new V3(),
  lastRateTarget: new V3(),
  simTime: 0,
  onGround: true,
  armed: false,
  crashed: 0,          // countdown [s]
  crashes: 0,
  batt: 1,
  voltage: BAT_CELLS * 4.2,
  current: 0,
  propwash: 0,
  groundEffect: 0,
  windSpeed: Number.isFinite(savedWind) ? Math.max(0, Math.min(16, savedWind)) : 2,
  wind: new V3(),
  mode: 'ACRO',
  camTilt: 25 * DEG,
  camMode: 'FPV',          // FPV | TPP (widok z 3. osoby)
  camDist: 3.8,            // dystans kamery TPP [m]
  nextGate: 0,
  lastGate: -1,
  lap: 0,
  time: 0,
  timing: false,
  best: parseFloat(localStorage.getItem('gradron.best') || '') || null,
  paused: false,
  started: false,
  padThr: localStorage.getItem('gradron.padthr') || 'HOVER',   // HOVER | LINIOWY | SPUSTKI
  osd: true,
  vtx: true,
  signalQuality: 1,
  signalRaw: 1,
  signalBlocked: 0,
  signalDistance: 0,
  signalClock: 0
};
function faceGate(i) {
  const g = gates[((i % gates.length) + gates.length) % gates.length];
  const d = g.pos.clone().sub(st.pos).setY(0);
  if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
  st.quat.setFromEuler(new THREE.Euler(0, Math.atan2(d.x, d.z) + Math.PI, 0));
}
function resetToStart() {
  st.pos.copy(START); st.vel.set(0, 0, 0); st.omega.set(0, 0, 0);
  st.motor.fill(0); st.motorCmd.fill(0);
  st.pidI.set(0, 0, 0); st.lastOmega.set(0, 0, 0); st.lastRateTarget.set(0, 0, 0);
  st.quat.identity(); faceGate(0);
  st.onGround = true; st.crashed = 0; st.armed = false; st.camSnap = true;
}
function respawn() {
  /* mapy misyjne: nie ma bramek — wracamy nad wybrany cel nawigacji, a bez celu do bazy */
  if (!activeMap.race) {
    const t = navTarget();
    if (t) {
      st.pos.copy(t[1]).add(new V3(0, 9, 0));
      st.vel.set(0, 0, 0); st.omega.set(0, 0, 0);
      st.motor.fill(Math.sqrt(HOVER_T)); st.motorCmd.fill(HOVER_T);
      st.pidI.set(0, 0, 0); st.lastOmega.set(0, 0, 0); st.lastRateTarget.set(0, 0, 0);
      st.onGround = false; st.crashed = 0; st.camSnap = true;
      stick.thr = HOVER_T;
      faceNav();
    } else resetOnMap();
    return;
  }
  const g = st.lastGate >= 0 ? gates[st.lastGate] : null;
  if (g) {
    st.pos.copy(g.pos).add(new V3(0, 1.4, 0));
    st.vel.set(0, 0, 0); st.omega.set(0, 0, 0);
    st.motor.fill(Math.sqrt(HOVER_T)); st.motorCmd.fill(HOVER_T);
    st.pidI.set(0, 0, 0); st.lastOmega.set(0, 0, 0); st.lastRateTarget.set(0, 0, 0);
    st.onGround = false;
    faceGate(st.lastGate + 1);              // nosem w stronę następnej bramki
    stick.thr = HOVER_T;                    // start z gazem hover
  } else resetToStart();
  for (const gg of gates) gg.prevZ = null;
  st.crashed = 0; st.camSnap = true;      // kamera TPP nie dogania drona przez pół mapy
}
function restartRace() {
  st.crashes = 0; st.batt = 1;
  st.voltage = BAT_CELLS * 4.2; st.current = 0; st.simTime = 0;
  if (!activeMap.race) {                       // mapa misyjna: powrót na płytę bazy
    resetOnMap();
    msg('RESTART', 'powrót do bazy');
    return;
  }
  resetToStart();
  st.nextGate = 0; st.lastGate = -1; st.lap = 0; st.time = 0;
  st.timing = false;
  stick.thr = 0;
  for (const g of gates) g.prevZ = null;
  updateBeacon();
  msg('RESTART', 'nowy przelot');
}
resetToStart();

/* ============================================================
   STEROWANIE
   ============================================================ */
const keys = Object.create(null);
const stick = { thr: 0, yaw: 0, pitch: 0, roll: 0 };   // thr 0..1, reszta -1..1
// Korekta 0.975 uwzględnia typowy sag przy obciążeniu zawisu.
const HOVER_T = G / (MAX_THRUST * 0.975);              // gaz zawisu (~0.22 dla profilu 5")

function expo(v, e) { const a = Math.abs(v); return Math.sign(v) * (a * a * a * e + a * (1 - e)); }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function toward(cur, target, up, down, dt) {
  const rate = Math.abs(target) > Math.abs(cur) || Math.sign(target) !== Math.sign(cur) ? up : down;
  const d = target - cur;
  return Math.abs(d) <= rate * dt ? target : cur + Math.sign(d) * rate * dt;
}

/* ---------- pad: Xbox 360 / Xbox One / dowolny "standard mapping" ---------- */
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const pad = {
  index: null, name: '', standard: true, connected: false, active: false,
  ax: [0, 0, 0, 0], lt: 0, rt: 0, btn: [], prev: []
};
function dz(v, d) { const a = Math.abs(v); return a < d ? 0 : Math.sign(v) * (a - d) / (1 - d); }
function padHit(i) { return !!pad.btn[i] && !pad.prev[i]; }
/* zużycie wciśnięcia: menu i lot czytają pada w tej samej klatce, więc jedno naciśnięcie
   nie może zadziałać dwa razy (np. B zamyka menu i przełącza kamerę) */
function padUse(i) { pad.prev[i] = true; return true; }

function pollPad() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  let p = null;
  if (pad.index !== null && list[pad.index] && list[pad.index].connected) p = list[pad.index];
  else for (const g of list) if (g && g.connected && g.axes.length >= 2) { p = g; break; }

  pad.prev = pad.btn;
  if (!p) {
    if (pad.connected) msg('', 'pad odłączony', 1.2);
    pad.connected = false; pad.active = false; pad.index = null;
    pad.btn = []; pad.ax = [0, 0, 0, 0]; pad.lt = pad.rt = 0;
    return;
  }
  if (pad.index !== p.index) {
    pad.index = p.index;
    pad.standard = p.mapping === 'standard';
    pad.name = (p.id || 'gamepad')
      .replace(/\s*\([^)]*(?:STANDARD GAMEPAD|XInput|Vendor|Product)[^)]*\)/i, '')
      .trim().slice(0, 30) || 'gamepad';
    msg('', 'pad: ' + pad.name, 1.8);
  }
  pad.connected = true;

  const a = p.axes;
  pad.ax = [dz(a[0] || 0, 0.14), dz(a[1] || 0, 0.14), dz(a[2] || 0, 0.14), dz(a[3] || 0, 0.14)];
  pad.btn = p.buttons.map(b => b.pressed || b.value > 0.55);
  pad.lt = p.buttons[BTN.LT] ? p.buttons[BTN.LT].value : 0;
  pad.rt = p.buttons[BTN.RT] ? p.buttons[BTN.RT].value : 0;

  // stary sterownik 360 / DirectInput: [LX, LY, spustki, RY, RX], spustki na jednej osi
  if (!pad.standard && a.length >= 5) {
    pad.ax[2] = dz(a[4] || 0, 0.14);
    pad.ax[3] = dz(a[3] || 0, 0.14);
    const tz = a[2] || 0;
    pad.lt = Math.max(0, tz); pad.rt = Math.max(0, -tz);
  }

  if (!pad.active) {
    const moved = Math.abs(pad.ax[0]) + Math.abs(pad.ax[1]) + Math.abs(pad.ax[2]) + Math.abs(pad.ax[3]);
    if (moved > 0.12 || pad.lt > 0.2 || pad.rt > 0.2 || pad.btn.some(Boolean)) pad.active = true;
  }
}

/* gaz z drążka ze sprężyną — trzy sposoby, przełączane w menu */
function padThrottle() {
  if (st.padThr === 'SPUSTKI') return clamp01(pad.rt - pad.lt);
  const v = -pad.ax[1];
  if (st.padThr === 'LINIOWY') return clamp01((v + 1) / 2);
  return clamp01(v >= 0 ? HOVER_T + v * (1 - HOVER_T) : HOVER_T * (1 + v));   // HOVER: środek = zawis
}

/* ---------- dotyk: dwa wirtualne drążki (telefon / tablet) ----------
   Lewy = gaz + yaw, prawy = pitch + roll. Oba są sprężynowane jak w padzie,
   więc puszczony lewy drążek wraca do gazu zawisu i dron nie spada. */
const touch = {
  supported: false, enabled: false, active: false,
  l: { id: null, x: 0, y: 0 },
  r: { id: null, x: 0, y: 0 }
};

function touchThrottle() {
  const v = touch.l.y;                                   // -1 (dół) .. 1 (góra)
  if (st.padThr === 'LINIOWY') return clamp01((v + 1) / 2);
  return clamp01(v >= 0 ? HOVER_T + v * (1 - HOVER_T) : HOVER_T * (1 + v));
}

/* ---------- żyroskop: sterowanie przechyłem telefonu ----------
   Telefon trzymany poziomo jest "kierownicą": przechylenie w bok daje roll,
   pochylenie do siebie / od siebie daje pitch. Punkt zerowy bierzemy z pozycji
   telefonu w chwili włączenia, więc można grać leżąc czy w fotelu. */
const tilt = {
  on: false, ready: false, denied: false,
  range: Number(localStorage.getItem('gradron.tiltrange')) || 28,   // stopnie do wychylenia max
  roll: 0, pitch: 0,                                               // -1..1 po kalibracji
  refRoll: null, refPitch: null, rawRoll: 0, rawPitch: 0, lastEvent: 0
};
const TILT_RANGES = [18, 28, 40];

/* Z alpha/beta/gamma budujemy kwaternion telefonu (kolejność YXZ, jak w three.js),
   uwzględniamy obrót ekranu i pytamy, gdzie w układzie ekranu leży pion świata.
   To daje kąty przechyłu odporne na obrót telefonu i na gimbal lock surowych osi. */
const _tq = new THREE.Quaternion(), _te = new THREE.Euler();
const _tqScreen = new THREE.Quaternion();
const _tqFlip = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);   // -90° wokół X
const _tUp = new V3(), _tZ = new V3(0, 0, 1);
function tiltAxes(e) {
  const a = ((e.alpha || 0)) * DEG, b = ((e.beta || 0)) * DEG, g = ((e.gamma || 0)) * DEG;
  const angle = (screen.orientation && typeof screen.orientation.angle === 'number')
    ? screen.orientation.angle : (window.orientation || 0);
  _te.set(b, a, -g, 'YXZ');
  _tq.setFromEuler(_te);
  _tq.multiply(_tqFlip);                                        // ekran patrzy na gracza
  _tq.multiply(_tqScreen.setFromAxisAngle(_tZ, -angle * DEG));   // obrót ekranu telefonu
  _tUp.set(0, 1, 0).applyQuaternion(_tq.conjugate());            // pion świata w układzie ekranu
  return {
    roll: Math.asin(clamp(-_tUp.x, -1, 1)) / DEG,     // dodatnie = prawa krawędź w dół
    pitch: Math.asin(clamp(-_tUp.y, -1, 1)) / DEG     // dodatnie = górna krawędź w dół
  };
}
function onTiltEvent(e) {
  if (e.beta === null && e.gamma === null) return;
  const ax = tiltAxes(e);
  tilt.ready = true; tilt.lastEvent = performance.now();
  tilt.rawRoll = ax.roll; tilt.rawPitch = ax.pitch;
  if (tilt.refRoll === null) { tilt.refRoll = ax.roll; tilt.refPitch = ax.pitch; }
  const dead = 1.6;
  const norm = (v, ref) => {
    let d = v - ref;
    if (Math.abs(d) < dead) return 0;
    d -= Math.sign(d) * dead;
    return clamp(d / tilt.range, -1, 1);
  };
  tilt.roll = norm(ax.roll, tilt.refRoll);        // prawa krawędź w dół = przechył w prawo
  tilt.pitch = -norm(ax.pitch, tilt.refPitch);    // górna krawędź w dół = nos w dół
}
function calibrateTilt(quiet) {
  tilt.refRoll = tilt.rawRoll; tilt.refPitch = tilt.rawPitch;
  tilt.roll = tilt.pitch = 0;
  if (!quiet) msg('', 'żyroskop wyzerowany', 1);
}
function setTilt(on) {
  if (on && !tilt.on) {
    const start = () => {
      window.addEventListener('deviceorientation', onTiltEvent);
      tilt.on = true; tilt.refRoll = tilt.refPitch = null;
      document.body.classList.add('gyro');
      msg('ŻYROSKOP', 'przechylaj telefon jak kierownicę', 1.6);
      setTimeout(() => {
        if (tilt.on && !tilt.ready) { setTilt(false); msg('', 'brak czujnika przechyłu', 1.6); }
      }, 1800);
    };
    /* iOS 13+ wymaga zgody użytkownika, i to z gestu — stąd włączanie przyciskiem */
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      DOE.requestPermission().then(r => {
        if (r === 'granted') start();
        else { tilt.denied = true; msg('', 'brak zgody na czujnik przechyłu', 1.8); }
      }).catch(() => { tilt.denied = true; msg('', 'czujnik przechyłu niedostępny', 1.6); });
    } else start();
  } else if (!on && tilt.on) {
    window.removeEventListener('deviceorientation', onTiltEvent);
    tilt.on = false; tilt.ready = false; tilt.roll = tilt.pitch = 0;
    document.body.classList.remove('gyro');
    msg('', 'żyroskop wyłączony', 1);
  }
  const b = el('tb-gyro');
  if (b) b.classList.toggle('on', tilt.on);
  try { localStorage.setItem('gradron.tilt', tilt.on ? '1' : '0'); } catch (e) { }
}
function cycleTiltRange(d) {
  let i = TILT_RANGES.indexOf(tilt.range);
  if (i < 0) i = 1;
  i = (i + (d || 1) + TILT_RANGES.length) % TILT_RANGES.length;
  tilt.range = TILT_RANGES[i];
  try { localStorage.setItem('gradron.tiltrange', String(tilt.range)); } catch (e) { }
  msg('', 'czułość przechyłu ' + tilt.range + '°', 0.9);
}

function readInput(dt) {
  if (touch.enabled && (touch.active || (tilt.on && tilt.ready))) {
    stick.thr = touchThrottle();
    stick.yaw = toward(stick.yaw, touch.l.x, 24, 24, dt);
    // przechył telefonu prowadzi pitch/roll, ale dotknięcie prawego drążka ma pierwszeństwo
    const useTilt = tilt.on && tilt.ready && touch.r.id === null;
    stick.roll = toward(stick.roll, useTilt ? tilt.roll : touch.r.x, 24, 24, dt);
    stick.pitch = toward(stick.pitch, useTilt ? tilt.pitch : touch.r.y, 24, 24, dt);
    return;
  }
  if (pad.connected && pad.active) {
    stick.thr = padThrottle();
    stick.yaw = toward(stick.yaw, pad.ax[0], 24, 24, dt);
    stick.roll = toward(stick.roll, pad.ax[2], 24, 24, dt);
    stick.pitch = toward(stick.pitch, -pad.ax[3], 24, 24, dt);

    if (padHit(BTN.A)) respawnPressed();
    if (padHit(BTN.B)) toggleCam();
    if (padHit(BTN.X)) toggleMode();
    if (padHit(BTN.Y)) restartRace();
    if (padHit(BTN.LB)) camAdjust(-1);
    if (padHit(BTN.RB)) camAdjust(1);
    if (padHit(BTN.BACK)) toggleOsd();
    return;
  }
  // klawiatura: gaz jak drążek bez sprężyny — W podnosi, S opuszcza, puszczone trzyma wartość
  const up = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
  stick.thr = clamp01(stick.thr + up * 1.15 * dt);
  stick.yaw = toward(stick.yaw, (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0), 5.5, 9, dt);
  stick.pitch = toward(stick.pitch, (keys['arrowup'] ? 1 : 0) - (keys['arrowdown'] ? 1 : 0), 6.5, 10, dt);
  stick.roll = toward(stick.roll, (keys['arrowright'] ? 1 : 0) - (keys['arrowleft'] ? 1 : 0), 6.5, 10, dt);
}

let respawnLatch = false;
function respawnPressed() { if (!respawnLatch) { respawnLatch = true; respawn(); setTimeout(() => respawnLatch = false, 400); } }

/* ============================================================
   FIZYKA
   ============================================================ */
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3();
const _airBody = new V3(), _bodyUp = new V3();
const _motorForce = [0, 0, 0, 0];
const _motorCorrection = [0, 0, 0, 0];
const _pidTorque = new V3();
const _pidKp = new V3(0.070, 0.055, 0.070);
const _pidKi = new V3(0.090, 0.070, 0.090);
const _pidKd = new V3(0.0018, 0.0007, 0.0018);
const _pidKff = new V3(0.0016, 0.0011, 0.0016);

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function smoothstep(a, b, v) {
  const x = clamp((v - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}

function batteryStep(dt) {
  // Przybliżenie typowego 6S 1300 mAh: prąd jałowy plus nieliniowy
  // pobór wynikający z obciążenia czterech śmigieł.
  let load = 0;
  for (let i = 0; i < 4; i++) load += Math.pow(st.motorCmd[i], 1.65);
  load *= 0.25;
  st.current = 1.4 + 112 * load;
  st.batt = Math.max(0, st.batt - st.current * dt / (BAT_CAPACITY_AH * 3600));

  // Napięcie spoczynkowe LiPo opada łagodnie w środku zakresu i szybciej przy końcu.
  const cellOpen = 3.45 + 0.75 * Math.pow(st.batt, 0.42);
  const openVoltage = BAT_CELLS * cellOpen;
  st.voltage = Math.max(BAT_CELLS * 3.15, openVoltage - st.current * BAT_INTERNAL_R);
}

function rateController(target, dt) {
  const error = _v2.copy(target).sub(st.omega);
  if (st.onGround && stick.thr < HOVER_T * 0.7) {
    st.pidI.multiplyScalar(Math.exp(-dt * 12));
  } else {
    st.pidI.x = clamp(st.pidI.x + error.x * dt, -0.75, 0.75);
    st.pidI.y = clamp(st.pidI.y + error.y * dt, -0.55, 0.55);
    st.pidI.z = clamp(st.pidI.z + error.z * dt, -0.75, 0.75);
  }

  const gyroDot = _v3.copy(st.omega).sub(st.lastOmega).multiplyScalar(1 / Math.max(dt, 1e-5));
  const setpointDot = _v4.copy(target).sub(st.lastRateTarget).multiplyScalar(1 / Math.max(dt, 1e-5));
  st.lastOmega.copy(st.omega);
  st.lastRateTarget.copy(target);

  return _pidTorque.set(
    _pidKp.x * error.x + _pidKi.x * st.pidI.x - _pidKd.x * gyroDot.x + _pidKff.x * setpointDot.x,
    _pidKp.y * error.y + _pidKi.y * st.pidI.y - _pidKd.y * gyroDot.y + _pidKff.y * setpointDot.y,
    _pidKp.z * error.z + _pidKi.z * st.pidI.z - _pidKd.z * gyroDot.z + _pidKff.z * setpointDot.z
  );
}

function mixMotors(throttle, torque) {
  // Mikser wynika wprost z geometrii: tau = r x F + moment reakcyjny śmigła.
  // Korekcje są skalowane razem, a collective przesuwany w dozwolony zakres.
  for (let i = 0; i < 4; i++) {
    const m = MOTORS[i];
    const deltaN =
      (-m.z * torque.x / (4 * ARM * ARM)) +
      ( m.x * torque.z / (4 * ARM * ARM)) +
      ( m.spin * torque.y / (4 * YAW_MOMENT));
    _motorCorrection[i] = deltaN / MAX_MOTOR_THRUST;
  }

  let cMin = Infinity, cMax = -Infinity;
  for (let i = 0; i < 4; i++) {
    cMin = Math.min(cMin, _motorCorrection[i]);
    cMax = Math.max(cMax, _motorCorrection[i]);
  }
  const scale = Math.min(1, (1 - MOTOR_IDLE) / Math.max(1e-6, cMax - cMin));
  const low = MOTOR_IDLE - cMin * scale;
  const high = 1 - cMax * scale;
  const collective = clamp(throttle, Math.min(low, high), Math.max(low, high));
  for (let i = 0; i < 4; i++)
    st.motorCmd[i] = clamp(collective + _motorCorrection[i] * scale, MOTOR_IDLE, 1);
}

function physics(dt) {
  const thr = stick.thr;
  st.simTime += dt;

  /* --- drążki -> żądane prędkości kątowe --- */
  const tgt = _v.set(
    -expo(stick.pitch, 0.35) * RATE_RP,
    -expo(stick.yaw, 0.3) * RATE_Y,
    -expo(stick.roll, 0.35) * RATE_RP
  );

  if (st.mode === 'ANGLE') {
    // Cel: aktualny yaw oraz kąt pitch/roll proporcjonalny do drążków.
    const fwd = _v2.set(0, 0, -1).applyQuaternion(st.quat);
    const yaw = Math.atan2(fwd.x, fwd.z);
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0))
      .multiply(_q.setFromAxisAngle(new V3(1, 0, 0), -stick.pitch * MAX_TILT))
      .multiply(_q2.setFromAxisAngle(new V3(0, 0, 1), -stick.roll * MAX_TILT));
    const err = target.multiply(st.quat.clone().invert());
    const ang = 2 * Math.acos(Math.min(1, Math.abs(err.w)));
    const s = Math.sqrt(Math.max(1e-9, 1 - err.w * err.w));
    const axis = new V3(err.x / s, err.y / s, err.z / s).multiplyScalar(err.w < 0 ? -1 : 1);
    const wWorld = axis.multiplyScalar(Math.min(ang * 7.0, RATE_RP));
    const wBody = wWorld.applyQuaternion(st.quat.clone().invert());
    tgt.set(wBody.x, -expo(stick.yaw, 0.3) * RATE_Y, wBody.z);
  }

  const requestedTorque = rateController(tgt, dt);
  mixMotors(thr, requestedTorque);
  batteryStep(dt);

  /* --- napięcie i ESC -> RPM każdego silnika --- */
  const nominalVoltage = BAT_CELLS * 4.2;
  const voltageRatio = clamp(st.voltage / nominalVoltage, 0.68, 1);
  // Częściowa kompensacja VBat zachowuje charakter PID, ale nie ukrywa
  // słabszej baterii ani sagu przy pełnym gazie.
  const compensated = Math.pow(voltageRatio, -0.70);
  for (let i = 0; i < 4; i++) {
    const targetRpm = Math.sqrt(clamp(st.motorCmd[i] * compensated, 0, 1)) * voltageRatio;
    const tau = targetRpm > st.motor[i] ? MOTOR_TAU_UP : MOTOR_TAU_DOWN;
    st.motor[i] += (targetRpm - st.motor[i]) * (1 - Math.exp(-dt / tau));
  }

  /* --- powietrze: wiatr, osiowy napływ i propwash --- */
  const altitudeWind = 0.58 + 0.42 * smoothstep(1, 35, st.pos.y);
  const gust = 1 + Math.sin(st.simTime * 0.37) * 0.24 + Math.sin(st.simTime * 1.31) * 0.09;
  const crossGust = Math.sin(st.simTime * 0.23 + 1.8) * 0.18;
  const wind = st.wind.set(
    st.windSpeed * (0.94 * gust - 0.34 * crossGust) * altitudeWind,
    st.windSpeed * Math.sin(st.simTime * 0.71) * 0.025 * altitudeWind,
    st.windSpeed * (0.34 * gust + 0.94 * crossGust) * altitudeWind
  );
  const airWorld = _v3.copy(st.vel).sub(wind);
  const invQuat = _q2.copy(st.quat).invert();
  const airBody = _airBody.copy(airWorld).applyQuaternion(invQuat);
  const lateralSpeed = Math.hypot(airBody.x, airBody.z);
  const descending = smoothstep(2.5, 10.5, -airBody.y);
  const cleanAir = 1 - smoothstep(4, 13, lateralSpeed);
  const throttleWindow = 1 - smoothstep(0.72, 1.0, thr);
  const propwashTarget = descending * cleanAir * throttleWindow;
  st.propwash += (propwashTarget - st.propwash) * (1 - Math.exp(-dt / 0.09));

  const bodyUp = _bodyUp.set(0, 1, 0).applyQuaternion(st.quat);
  const upright = smoothstep(0.15, 0.75, bodyUp.y);
  const effectHeight = clamp((1.25 - (st.pos.y - R_DRONE)) / 1.25, 0, 1);
  st.groundEffect = 0.14 * effectHeight * effectHeight * upright;
  const axialLoss = clamp(1 - Math.max(0, airBody.y) * 0.012, 0.68, 1.03);

  /* --- siły i momenty od rzeczywistych rotorów --- */
  const torque = _v2.set(0, 0, 0);
  let totalThrust = 0, avgRpm = 0;
  for (let i = 0; i < 4; i++) {
    const m = MOTORS[i];
    const turbulence =
      Math.sin(st.simTime * (47 + i * 4.7) + i * 1.9) * 0.055 +
      Math.sin(st.simTime * (83 + i * 3.1) + i * 0.7) * 0.025;
    const washFactor = 1 - st.propwash * 0.13 + st.propwash * turbulence;
    const force = MAX_MOTOR_THRUST * st.motor[i] * st.motor[i] *
      axialLoss * (1 + st.groundEffect) * clamp(washFactor, 0.72, 1.08);
    _motorForce[i] = force;
    totalThrust += force;
    avgRpm += st.motor[i] * 0.25;
    torque.x += -m.z * force;
    torque.z +=  m.x * force;
    torque.y +=  m.spin * force * YAW_MOMENT;
  }

  /* --- dynamika obrotowa bryły sztywnej w układzie drona --- */
  const w = st.omega;
  const iOmega = _v3.set(INERTIA.x * w.x, INERTIA.y * w.y, INERTIA.z * w.z);
  const gyro = _v4.copy(w).cross(iOmega);
  const angularDrag = 0.0016 + avgRpm * 0.0022;
  const alphaX = (torque.x - gyro.x - w.x * angularDrag) / INERTIA.x;
  const alphaY = (torque.y - gyro.y - w.y * angularDrag * 1.35) / INERTIA.y;
  const alphaZ = (torque.z - gyro.z - w.z * angularDrag) / INERTIA.z;
  st.omega.x += alphaX * dt;
  st.omega.y += alphaY * dt;
  st.omega.z += alphaZ * dt;
  const maxOmega = 24;
  if (st.omega.lengthSq() > maxOmega * maxOmega) st.omega.setLength(maxOmega);

  const wl = st.omega.length();
  if (wl > 1e-5) {
    _q.setFromAxisAngle(_v.copy(st.omega).multiplyScalar(1 / wl), wl * dt);
    st.quat.multiply(_q).normalize();           // obrót w układzie drona
  }

  /* --- translacja i anizotropowy opór aerodynamiczny --- */
  const acc = _v.set(0, 1, 0).applyQuaternion(st.quat).multiplyScalar(totalThrust / MASS);
  acc.y -= G;
  const dragBody = _v2.set(
    -airBody.x * (0.055 + avgRpm * 0.17 + Math.abs(airBody.x) * 0.006),
    -airBody.y * (0.025 + Math.abs(airBody.y) * 0.0035),
    -airBody.z * (0.070 + avgRpm * 0.20 + Math.abs(airBody.z) * 0.007)
  ).applyQuaternion(st.quat);
  acc.add(dragBody);

  st.vel.addScaledVector(acc, dt);
  st.pos.addScaledVector(st.vel, dt);

  collide();

  /* granice świata — mapy misyjne są większe i wyższe niż tor */
  const R = activeMap.bounds || 700, CEIL = activeMap.ceiling || 260;
  const d2 = Math.hypot(st.pos.x, st.pos.z);
  if (d2 > R) { st.pos.x *= R / d2; st.pos.z *= R / d2; st.vel.multiplyScalar(0.3); }
  if (st.pos.y > CEIL) { st.pos.y = CEIL; st.vel.y = Math.min(0, st.vel.y); }
}

function crash(impact) {
  if (st.crashed > 0) return;
  st.crashed = 1.15; st.crashes++;
  st.vel.multiplyScalar(0.08); st.omega.multiplyScalar(0.1);
  msg(st.wet ? 'WODA' : 'CRASH', st.wet ? 'dron zalany — respawn…' : 'respawn…');
  st.wet = false;
  sfxCrash(Math.min(1, impact / 22));
  staticBurst(0.85);
}

function collide() {
  /* ziemia / woda — mapy misyjne mają teren o zmiennej wysokości i akweny */
  const surf = activeMap.surfaceAt ? activeMap.surfaceAt(st.pos.x, st.pos.z) : FLAT_SURF;
  if (st.pos.y < surf.y + R_DRONE) {
    const vy = -st.vel.y;
    st.pos.y = surf.y + R_DRONE;
    if (surf.water) { st.wet = true; return crash(14); }     // kontakt z wodą = koniec lotu
    if (vy > 6.5) return crash(vy);
    st.vel.y = Math.max(0, st.vel.y * -0.22);
    st.vel.x *= 0.86; st.vel.z *= 0.86;
    st.onGround = stick.thr < HOVER_T * 0.88;
    if (st.onGround) {
      st.omega.multiplyScalar(0.62);
      st.pidI.multiplyScalar(0.75);
    }
  } else st.onGround = false;

  /* budynki / ścianki (AABB) */
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (st.pos.x < b.min.x - R_DRONE || st.pos.x > b.max.x + R_DRONE) continue;
    if (st.pos.y < b.min.y - R_DRONE || st.pos.y > b.max.y + R_DRONE) continue;
    if (st.pos.z < b.min.z - R_DRONE || st.pos.z > b.max.z + R_DRONE) continue;

    const cx = Math.max(b.min.x, Math.min(st.pos.x, b.max.x));
    const cy = Math.max(b.min.y, Math.min(st.pos.y, b.max.y));
    const cz = Math.max(b.min.z, Math.min(st.pos.z, b.max.z));
    // środek drona w bryle: normalna jest wtedy nieokreślona, a powtarzane odbicia
    // potrafiły wystrzelić drona w kosmos — to po prostu kraksa
    if (cx === st.pos.x && cy === st.pos.y && cz === st.pos.z) return crash(30);

    const n = _v.set(st.pos.x - cx, st.pos.y - cy, st.pos.z - cz);
    let len = n.length();
    if (len > R_DRONE) continue;
    if (len < 1e-5) { n.set(0, 1, 0); len = 1e-5; }
    n.multiplyScalar(1 / len);
    const vn = st.vel.dot(n);
    if (-vn > 5.5) return crash(-vn);
    st.pos.addScaledVector(n, R_DRONE - len + 0.001);
    st.vel.addScaledVector(n, -vn * 1.25);
    st.vel.multiplyScalar(0.72);
  }

  /* obręcze bramek (kolizja z ramą) */
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    if (st.pos.distanceToSquared(g.pos) > (GATE_R + 1.2) * (GATE_R + 1.2)) continue;
    const loc = _v.copy(st.pos).sub(g.pos).applyQuaternion(_q.copy(g.quat).invert());
    const rad = Math.hypot(loc.x, loc.y);
    if (Math.abs(loc.z) < 0.3 + R_DRONE && Math.abs(rad - GATE_R) < 0.3 + R_DRONE) {
      const nl = _v2.set(loc.x / (rad || 1) * (rad > GATE_R ? 1 : -1), loc.y / (rad || 1) * (rad > GATE_R ? 1 : -1), 0);
      const n = nl.applyQuaternion(g.quat).normalize();
      const vn = st.vel.dot(n);
      if (-vn > 5) return crash(-vn);
      st.pos.addScaledVector(n, 0.35);
      st.vel.addScaledVector(n, -vn * 1.2);
      st.vel.multiplyScalar(0.7);
    }
  }
}

/* ============================================================
   BRAMKI / WYŚCIG
   ============================================================ */
function checkGates() {
  const g = gates[st.nextGate];
  const loc = _v.copy(st.pos).sub(g.pos).applyQuaternion(_q.copy(g.quat).invert());
  const z = loc.z;
  if (g.prevZ !== null && Math.hypot(loc.x, loc.y) < GATE_R - 0.15 && g.prevZ < 0 && z >= 0) {
    passGate();
  }
  g.prevZ = z;
}

function passGate() {
  const i = st.nextGate;
  st.lastGate = i;
  gates[i].prevZ = null;
  st.nextGate = (i + 1) % gates.length;
  gates[st.nextGate].prevZ = null;
  sfxBeep(i === gates.length - 1 ? 1180 : 760);

  if (!st.timing) { st.timing = true; st.time = 0; msg('START', 'czas leci'); }
  else if (i === gates.length - 1) {                 // ostatnia bramka = koniec rundy
    st.lap++;
    const t = st.time;
    const isBest = st.best === null || t < st.best;
    if (isBest) { st.best = t; localStorage.setItem('gradron.best', String(t)); }
    msg(t.toFixed(2) + 's', (isBest ? 'NOWY REKORD! ' : '') + 'runda ' + st.lap);
    sfxBeep(isBest ? 1600 : 980);
    st.time = 0;
  } else {
    msg('', 'bramka ' + (i + 1) + '/' + gates.length, 0.45);
  }
  updateBeacon();
}

function updateBeacon() {
  for (const g of gates) g.ring.material = matRing;
  const g = gates[st.nextGate];
  g.ring.material = matNext;
  beacon.position.set(g.pos.x, g.pos.y + 45, g.pos.z);
}
updateBeacon();

/* ============================================================
   KAMERA
   ============================================================ */
const chasePos = new V3(0, 3, 8);
const _look = new V3(), _fwd = new V3();

/* kamera TPP nie może wejść w budynek ani pod ziemię: idziemy od drona w stronę
   docelowego miejsca i zatrzymujemy się przed pierwszą przeszkodą */
const _march = new V3();
function inSolid(p, m) {         // tylko bryły; ziemię załatwia dolny limit wysokości kamery
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (p.x > b.min.x - m && p.x < b.max.x + m &&
        p.y > b.min.y - m && p.y < b.max.y + m &&
        p.z > b.min.z - m && p.z < b.max.z + m) return true;
  }
  return false;
}
function clampCam(p) {
  const dir = _v2.copy(p).sub(st.pos);
  const dist = dir.length();
  if (dist < 0.75) return p;
  dir.multiplyScalar(1 / dist);

  let ok = -1;
  for (let t = 0.75; t <= dist; t += 0.45) {
    _march.copy(st.pos).addScaledVector(dir, t);
    if (_march.y < 0.55) _march.y = 0.55;          // promień nie schodzi pod ziemię
    if (inSolid(_march, 0.3)) break;
    ok = t;
  }
  if (ok < 0) {                       // ściana jest bliżej niż minimalny dystans → kamera nad drona
    p.copy(st.pos); p.y += Math.max(1, dist * 0.4);
    if (inSolid(p, 0.2)) { p.copy(st.pos); p.y += 0.55; }
    return p;
  }
  p.copy(st.pos).addScaledVector(dir, ok);
  if (p.y < 0.55) p.y = 0.55;         // lerp nie może wciągnąć kamery pod ziemię
  return p;
}

function updateCamera(dt) {
  if (st.camMode === 'FPV') {
    if (camera.fov !== FOV.fpv) { camera.fov = FOV.fpv; camera.updateProjectionMatrix(); }
    drone.visible = false;
    const q = st.quat.clone().multiply(_q.setFromAxisAngle(_v.set(1, 0, 0), st.camTilt));
    camera.quaternion.copy(q);
    camera.position.copy(st.pos).add(_v.set(0, 0.055, -0.02).applyQuaternion(st.quat));
  } else {
    // widok z 3. osoby: kamera zawsze pionowo (nie kręci się z rollem), za dronem, po jego kursie
    if (camera.fov !== FOV.tpp) { camera.fov = FOV.tpp; camera.updateProjectionMatrix(); }
    drone.visible = true;
    _fwd.set(0, 0, -1).applyQuaternion(st.quat);
    _fwd.y *= 0.4;                                  // przy pionowym nosie kamera nie ucieka nad/pod drona
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();

    const d = st.camDist;
    const want = _v.copy(st.pos).addScaledVector(_fwd, -d);
    want.y += d * 0.3;
    want.y = Math.max(want.y, 0.6);                 // nie pod ziemię
    clampCam(want);
    if (st.camSnap) { chasePos.copy(want); st.camSnap = false; }
    else chasePos.lerp(want, 1 - Math.exp(-dt / 0.11));
    clampCam(chasePos);
    if (chasePos.y < 0.55) chasePos.y = 0.55;
    camera.position.copy(chasePos);
    camera.up.set(0, 1, 0);
    // patrzymy trochę przed drona, ale nie tak daleko, żeby wypadł z kadru
    camera.lookAt(_look.copy(st.pos).addScaledVector(_fwd, d * 0.22).setY(st.pos.y + 0.25 + _fwd.y * d * 0.22));
  }
  sky.position.copy(camera.position);
  sun.position.copy(st.pos).addScaledVector(SUN_DIR, 190);
  sun.target.position.copy(st.pos);
}

/* ============================================================
   AUDIO (silniki + wiatr + zdarzenia)
   ============================================================ */
let ac = null, motorGain = null, motorOsc = [], windGain = null, windSrc = null, soundOn = true;
function initAudio() {
  if (ac) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  const master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);

  motorGain = ac.createGain(); motorGain.gain.value = 0;
  const mf = ac.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 2600;
  motorGain.connect(mf); mf.connect(master);
  for (let i = 0; i < 4; i++) {
    const o = ac.createOscillator();
    o.type = i % 2 ? 'sawtooth' : 'square';
    o.frequency.value = 90;
    const g = ac.createGain(); g.gain.value = i < 2 ? 0.32 : 0.16;
    o.connect(g); g.connect(motorGain); o.start();
    motorOsc.push(o);
  }
  // wiatr = szum przez bandpass
  const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  windSrc = ac.createBufferSource(); windSrc.buffer = buf; windSrc.loop = true;
  const wf = ac.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 700; wf.Q.value = 0.6;
  windGain = ac.createGain(); windGain.gain.value = 0;
  windSrc.connect(wf); wf.connect(windGain); windGain.connect(master); windSrc.start();
}
function audioUpdate(dt) {
  if (!ac || !motorGain) return;
  const on = soundOn && !st.paused && st.started;
  const thr = stick.thr;
  const f = 78 + thr * 330 + Math.min(st.vel.length(), 40) * 1.1;
  for (let i = 0; i < motorOsc.length; i++)
    motorOsc[i].frequency.setTargetAtTime(f * (1 + i * 0.035), ac.currentTime, 0.04);
  motorGain.gain.setTargetAtTime(on ? 0.05 + thr * 0.3 : 0, ac.currentTime, 0.06);
  const airNoise = Math.max(st.vel.length(), st.wind.length() * 0.85);
  windGain.gain.setTargetAtTime(on ? Math.min(0.34, Math.pow(airNoise / 32, 1.7) * 0.34) : 0, ac.currentTime, 0.1);
}
function sfxBeep(freq) {
  if (!ac || !soundOn) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'triangle'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.28, ac.currentTime + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.22);
  o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.25);
}
function sfxCrash(v) {
  if (!ac || !soundOn) return;
  const len = ac.sampleRate * 0.4, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
  const s = ac.createBufferSource(); s.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + v * 2200;
  const g = ac.createGain(); g.gain.value = 0.35 + v * 0.4;
  s.connect(f); f.connect(g); g.connect(ac.destination); s.start();
}

/* ============================================================
   OSD
   ============================================================ */
const el = id => document.getElementById(id);
const osd = el('osd'), msgEl = el('msg');
const fTime = el('f-time'), fBest = el('f-best'), fGate = el('f-gate'), fMode = el('f-mode'),
  fDist = el('f-dist'), fSpd = el('f-spd'), fAlt = el('f-alt'), fBatt = el('f-batt'),
  fCrash = el('f-crash'), fPad = el('f-pad'), fWind = el('f-wind'), fSignal = el('f-signal'),
  fGateLbl = el('f-gate-lbl'),
  thrFill = el('thr-fill'), horizon = el('horizon'),
  stickL = el('stick-l').firstElementChild, stickR = el('stick-r').firstElementChild,
  staticEl = el('static'), signalNoise = el('signal-noise'), signalTear = el('signal-tear'),
  signalBlackout = el('signal-blackout');

/* Łącze radiowe jest liczone od miejsca startu pilota do drona.
   Odległość osłabia sygnał płynnie, a bryły pomiędzy nadajnikiem i dronem
   symulują tłumienie przez beton, kontenery, skały i drzewa. */
const _sigA = new V3(), _sigB = new V3();
function segmentHitsBox(a, b, box) {
  let lo = 0, hi = 1;
  for (const axis of ['x', 'y', 'z']) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-7) {
      if (a[axis] < box.min[axis] || a[axis] > box.max[axis]) return false;
    } else {
      let t0 = (box.min[axis] - a[axis]) / d, t1 = (box.max[axis] - a[axis]) / d;
      if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
      lo = Math.max(lo, t0); hi = Math.min(hi, t1);
      if (lo > hi) return false;
    }
  }
  return hi > 0.025 && lo < 0.975;
}
function updateSignal(dt) {
  st.signalClock += dt;
  const pilot = activeMap.spawn && activeMap.spawn.pos ? activeMap.spawn.pos : START;
  _sigA.copy(pilot).add(new V3(0, 2.2, 0));
  _sigB.copy(st.pos);
  const distance = _sigA.distanceTo(_sigB);
  let blockers = 0;
  if (st.signalClock >= 0.09) {
    st.signalClock = 0;
    for (let i = 0; i < colliders.length && blockers < 4; i++) {
      if (segmentHitsBox(_sigA, _sigB, colliders[i])) blockers++;
    }
    const range = activeMap.signalRange || 650;
    const t = clamp((distance - range * 0.28) / (range * 0.72), 0, 1);
    const distanceLink = 1 - t * t * (3 - 2 * t);
    const altitudeHelp = clamp((st.pos.y - _sigA.y) / 130, 0, 0.1);
    const multipath = (Math.sin(st.simTime * 4.1 + st.pos.x * 0.037 + st.pos.z * 0.021) + 1) * 0.035;
    let raw = clamp((distanceLink + altitudeHelp - multipath * (1 - distanceLink)) * Math.pow(0.61, blockers), 0.015, 1);
    if (distance < 45) raw = Math.max(raw, 0.94);
    st.signalRaw = raw;
    st.signalBlocked = blockers;
    st.signalDistance = distance;
  }
  const response = 1 - Math.exp(-Math.max(0.001, dt) * (st.signalRaw < st.signalQuality ? 7.5 : 2.2));
  st.signalQuality += (st.signalRaw - st.signalQuality) * response;

  const active = st.vtx && st.camMode === 'FPV';
  const loss = active ? clamp(1 - st.signalQuality, 0, 1) : 0;
  const pulse = 0.5 + 0.5 * Math.sin(st.simTime * 23 + st.pos.x * 0.11);
  const noise = loss < 0.16 ? 0 : clamp((loss - 0.12) * 0.78 + pulse * loss * 0.22, 0, 0.82);
  signalNoise.style.opacity = noise.toFixed(3);
  signalNoise.style.backgroundPosition = ((st.simTime * 83) % 100).toFixed(0) + 'px ' +
    ((st.simTime * 137) % 100).toFixed(0) + 'px';
  const tear = loss > 0.42 ? clamp((loss - 0.38) * (0.55 + pulse), 0, 0.92) : 0;
  signalTear.style.opacity = tear.toFixed(3);
  signalTear.style.top = (18 + ((st.simTime * 91) % 64)).toFixed(0) + '%';
  signalTear.style.transform = 'translateX(' + ((pulse - 0.5) * loss * 42).toFixed(0) + 'px)';
  const dropoutWave = Math.sin(st.simTime * 31.7 + st.pos.z * 0.08) * Math.sin(st.simTime * 7.3);
  const blackout = loss > 0.72 && dropoutWave > (1.72 - loss * 1.4)
    ? clamp((loss - 0.67) * 2.8, 0, 0.96) : 0;
  signalBlackout.style.opacity = blackout.toFixed(3);
  canvas.style.filter = active && loss > 0.18
    ? `saturate(${(1 - loss * 0.58).toFixed(2)}) contrast(${(1 + loss * 0.3).toFixed(2)}) brightness(${(1 - loss * 0.18).toFixed(2)})`
    : '';
}

let msgTimer = 0;
function msg(big, small, dur) {
  msgEl.innerHTML = big + (small ? '<small>' + small + '</small>' : '');
  msgEl.classList.add('show');
  msgTimer = dur || 1.6;
}
let staticT = 0;
function staticBurst(v) { staticT = v; }

function fmt(t) { return t.toFixed(2); }
function updateOSD(dt) {
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) msgEl.classList.remove('show'); }
  if (staticT > 0) { staticT = Math.max(0, staticT - dt * 1.6); staticEl.style.opacity = (staticT * 0.55 * Math.random()).toFixed(3); }
  else staticEl.style.opacity = 0;

  fTime.textContent = fmt(st.time);
  fBest.textContent = activeMap.race
    ? (st.best ? 'best ' + fmt(st.best) : 'best —')
    : activeMap.name.toLowerCase();
  if (fGateLbl) fGateLbl.textContent = activeMap.race ? 'bramka' : 'cel nawigacji';
  fMode.textContent = st.mode;
  fMode.className = 'mid ' + (st.mode === 'ACRO' ? 'accent' : 'warn');
  if (touch.enabled) {
    const bMode = el('tb-mode'), bNav = el('tb-nav'), bCam = el('tb-cam');
    if (bMode) bMode.textContent = st.mode;
    if (bNav) bNav.textContent = activeMap.race ? 'restart' : 'cel';
    if (bCam) bCam.textContent = st.camMode === 'FPV' ? 'FPV' : '3os';
  }

  if (activeMap.race) {
    fGate.textContent = (st.nextGate + 1) + '/' + gates.length;
    fDist.textContent = st.pos.distanceTo(gates[st.nextGate].pos).toFixed(0) + ' m';
  } else {
    const t = navTarget();
    fGate.textContent = t ? (((navIdx % activeMap.pois.length) + activeMap.pois.length) % activeMap.pois.length + 1)
      + '/' + activeMap.pois.length : '—';
    fDist.textContent = t ? st.pos.distanceTo(t[1]).toFixed(0) + ' m · ' + t[0] : activeMap.name;
  }
  const spd = st.vel.length() * 3.6;
  fSpd.innerHTML = spd.toFixed(0) + '<span style="font-size:14px"> km/h</span>';
  fAlt.innerHTML = st.pos.y.toFixed(1) + '<span style="font-size:14px"> m</span>';
  fCrash.textContent = 'crash ' + st.crashes + '  •  runda ' + st.lap;

  const cellVolt = st.voltage / BAT_CELLS;
  fBatt.textContent = st.voltage.toFixed(1) + 'V  ' + cellVolt.toFixed(2) + '/c  ' +
    Math.round(st.batt * 100) + '%';
  fBatt.className = 'mid ' + (st.batt < 0.15 ? 'bad' : st.batt < 0.3 ? 'warn' : '');
  if (fWind) {
    const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
    const angle = Math.atan2(st.wind.x, -st.wind.z);
    const arrow = arrows[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
    fWind.textContent = st.windSpeed <= 0
      ? 'WIATR OFF'
      : 'WIATR ' + st.wind.length().toFixed(1) + ' m/s  ' + arrow;
    fWind.className = 'mid ' + (st.windSpeed >= 8 ? 'warn' : '');
  }
  if (fSignal) {
    const lq = Math.round(st.signalQuality * 100);
    const rssi = Math.round(-43 - (1 - st.signalQuality) * 67);
    fSignal.textContent = 'LQ ' + lq + '%  ·  RSSI ' + rssi +
      (st.signalBlocked ? '  ·  LOS×' + st.signalBlocked : '');
    fSignal.className = 'mid ' + (lq < 25 ? 'bad' : lq < 55 ? 'warn' : '');
  }
  fPad.textContent = touch.enabled && (touch.active || tilt.on)
    ? (tilt.on && tilt.ready ? 'PRZECHYŁ • ' : 'DOTYK • ') +
      'GAZ ' + (st.padThr === 'SPUSTKI' ? 'HOVER' : st.padThr)
    : touch.enabled ? 'DOTYK — dotknij drążka'
      : pad.connected
        ? (pad.active ? 'PAD • GAZ ' + st.padThr : 'PAD GOTOWY — rusz drążkiem')
        : 'KLAWIATURA';
  fPad.className = 'mid ' + ((touch.enabled && (touch.active || tilt.on)) || (pad.connected && pad.active) ? 'accent' : '');

  thrFill.style.height = (stick.thr * 100).toFixed(1) + '%';
  stickL.style.transform = `translate(${stick.yaw * 24}px, ${(0.5 - stick.thr) * 48}px)`;
  stickR.style.transform = `translate(${stick.roll * 24}px, ${-stick.pitch * 24}px)`;

  // sztuczny horyzont z kwaternionu kamery
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  horizon.style.transform = `translateY(${Math.max(-260, Math.min(260, e.x * 340))}px) rotate(${-e.z / DEG}deg)`;
}

/* ============================================================
   ZDARZENIA / WEJŚCIE
   ============================================================ */
const startPanel = el('start');
const startMapCards = el('start-map-cards'), menuMapCards = el('menu-map-cards');
function makeMapCards(host) {
  if (!host) return;
  host.innerHTML = '';
  for (const def of MAP_DEFS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-card' + (def.key === activeMap.key ? ' active' : '');
    b.style.setProperty('--map-glow', def.glow);
    b.innerHTML = '<small></small><strong></strong><span></span>';
    b.children[0].textContent = def.type;
    b.children[1].textContent = def.short;
    b.children[2].textContent = def.desc;
    b.addEventListener('mousedown', e => e.stopPropagation());
    b.addEventListener('click', e => {
      e.stopPropagation();
      setMap(def.key);
      paintMapCards();
      if (menuOpen) paintMenu();
    });
    host.appendChild(b);
  }
}
function paintMapCards() {
  makeMapCards(startMapCards);
  makeMapCards(menuMapCards);
}
function beginGame() {
  if (st.started) return;
  st.started = true;
  startPanel.classList.add('hidden');
  updateRotateHint();
  try { initAudio(); if (ac && ac.state === 'suspended') ac.resume(); }
  catch (e) { ac = null; console.warn('audio off:', e); }   // brak audio nie może zabić lotu
  msg('GO', pad.connected ? 'lewy drążek = gaz' : 'W = gaz', 1.4);
}
el('start-play').addEventListener('click', beginGame);
paintMapCards();

/* ---------- wirtualne drążki: obsługa dotyku ---------- */
function bindTouchPad(elm, side) {
  const knob = elm.firstElementChild;
  const s = touch[side];
  let cx = 0, cy = 0, rad = 1;

  function measure() {
    const r = elm.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    rad = r.width * 0.42;
  }
  function apply(e) {
    let dx = (e.clientX - cx) / rad, dy = (e.clientY - cy) / rad;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    s.x = dx; s.y = -dy;                       // ekran ma Y w dół, drążek w górę
    knob.style.transform = `translate(${(dx * rad).toFixed(1)}px, ${(dy * rad).toFixed(1)}px)`;
  }
  function release() {
    s.id = null; s.x = 0; s.y = 0;
    knob.style.transform = '';
    elm.classList.remove('on');
  }

  elm.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (s.id !== null) return;
    s.id = e.pointerId;
    elm.setPointerCapture(e.pointerId);
    elm.classList.add('on');
    touch.active = true;
    if (!st.started) beginGame();
    measure(); apply(e);
  });
  elm.addEventListener('pointermove', e => { if (s.id === e.pointerId) { e.preventDefault(); apply(e); } });
  for (const ev of ['pointerup', 'pointercancel'])
    elm.addEventListener(ev, e => { if (s.id === e.pointerId) release(); });
  elm.addEventListener('contextmenu', e => e.preventDefault());
}
bindTouchPad(el('tpad-l'), 'l');
bindTouchPad(el('tpad-r'), 'r');

function tbtn(id, fn) {
  const b = el(id);
  b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); });
  b.addEventListener('click', e => e.preventDefault());
  return b;
}
tbtn('tb-menu', () => { if (!st.started) beginGame(); else toggleMenu(); });
tbtn('tb-resp', () => respawnPressed());
tbtn('tb-cam', () => toggleCam());
tbtn('tb-mode', () => toggleMode());
tbtn('tb-nav', () => { if (activeMap.race) restartRace(); else cycleNav(1); });
tbtn('tb-full', () => toggleFull());
/* żyroskop: krótkie dotknięcie włącza/wyłącza, przytrzymanie zeruje punkt neutralny.
   Przełączamy na pointerup, bo iOS pyta o zgodę na czujnik tylko z gestu użytkownika. */
(function () {
  const b = el('tb-gyro');
  let timer = 0, held = false;
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); held = false;
    timer = setTimeout(() => { held = true; if (tilt.on) calibrateTilt(); }, 600);
  });
  b.addEventListener('pointerup', e => {
    e.preventDefault(); e.stopPropagation(); clearTimeout(timer);
    if (!held) setTilt(!tilt.on);
  });
  b.addEventListener('pointercancel', () => clearTimeout(timer));
  b.addEventListener('click', e => e.preventDefault());
})();

const startHint = document.querySelector('#start .key-hint');
const startHintHtml = startHint ? startHint.innerHTML : '';
function setTouchUI(on, remember) {
  touch.enabled = !!on;
  document.body.classList.toggle('touch', touch.enabled);
  if (startHint) {
    startHint.innerHTML = touch.enabled
      ? 'Dotknij <b>Uruchom lot</b> — drążki pojawią się na dole ekranu'
      : startHintHtml;
  }
  if (!touch.enabled) {
    touch.active = false;
    touch.l.id = touch.r.id = null;
    touch.l.x = touch.l.y = touch.r.x = touch.r.y = 0;
  }
  if (remember) { try { localStorage.setItem('gradron.touch', touch.enabled ? '1' : '0'); } catch (e) { } }
}
touch.supported = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 ||
  (window.matchMedia && matchMedia('(pointer: coarse)').matches);
let touchPref = null;
try { touchPref = localStorage.getItem('gradron.touch'); } catch (e) { }
setTouchUI(touchPref !== null ? touchPref === '1' : touch.supported);

/* pierwszy dotyk na urządzeniu bez wykrytego dotyku (np. hybryda) włącza drążki,
   o ile użytkownik sam ich wcześniej nie wyłączył */
window.addEventListener('touchstart', function firstTouch() {
  window.removeEventListener('touchstart', firstTouch);
  touch.supported = true;
  if (touchPref === null && !touch.enabled) setTouchUI(true);
  fitView();
}, { passive: true });

/* ============================================================
   ROZPOZNANIE EKRANU: TELEFON / TABLET / PULPIT
   Klasa ekranu steruje wielkością drążków i OSD (data-device w CSS),
   gęstością renderowania oraz pionowym polem widzenia kamery.
   ============================================================ */
const UI_MODES = ['AUTO', 'TELEFON', 'TABLET', 'PULPIT'];
const UI_TO_DEVICE = { TELEFON: 'phone', TABLET: 'tablet', PULPIT: 'desktop' };
let uiMode = 'AUTO';
try { uiMode = localStorage.getItem('gradron.ui') || 'AUTO'; } catch (e) { }
const qUi = /[?&]ui=(\w+)/.exec(location.search);
if (qUi) uiMode = qUi[1].toUpperCase();
if (UI_MODES.indexOf(uiMode) < 0) uiMode = 'AUTO';

function detectDevice() {
  if (UI_TO_DEVICE[uiMode]) return UI_TO_DEVICE[uiMode];
  const short = Math.min(window.innerWidth, window.innerHeight);
  const long = Math.max(window.innerWidth, window.innerHeight);
  if (!touch.supported) return 'desktop';
  if (short <= 500 || long <= 820) return 'phone';       // telefony w pionie i w poziomie
  return 'tablet';                                        // duży ekran dotykowy
}
let device = '';
function applyDevice() {
  const d = detectDevice();
  if (d === device) return;
  device = d;
  document.body.dataset.device = d;
  // telefony mają gęste ekrany — pełne DPR zjada klatki, więc renderujemy oszczędniej
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,
    d === 'phone' ? 1.35 : d === 'tablet' ? 1.6 : 1.75));
}
function cycleUiMode(dir) {
  uiMode = UI_MODES[(UI_MODES.indexOf(uiMode) + (dir || 1) + UI_MODES.length) % UI_MODES.length];
  try { localStorage.setItem('gradron.ui', uiMode); } catch (e) { }
  device = '';                                            // wymuś ponowne przeliczenie
  fitView();
}

/* Kamera: trzymamy stałe pole widzenia w poziomie (jak w goglach FPV), a pionowe
   liczymy z proporcji ekranu — inaczej telefon w pionie pokazuje wąski tunel.
   Wartości odniesienia to dotychczasowe 105° / 74° w pionie przy ekranie 16:9. */
const HFOV_FPV = 133, HFOV_TPP = 107;
function vFov(hfov, aspect) { return 2 * Math.atan(Math.tan(hfov * DEG / 2) / aspect) / DEG; }
function fitView() {
  const w = window.innerWidth, h = window.innerHeight;
  const aspect = w / h;
  camera.aspect = aspect;
  FOV.fpv = clamp(vFov(HFOV_FPV, aspect), 88, 118);
  FOV.tpp = clamp(vFov(HFOV_TPP, aspect), 62, 96);
  camera.fov = st.camMode === 'TPP' ? FOV.tpp : FOV.fpv;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  applyDevice();
  updateRotateHint();
}

/* podpowiedź "obróć telefon" — tylko na telefonie w pionie i poza lotem */
const rotateEl = el('rotate');
let rotateOff = false;
try { rotateOff = localStorage.getItem('gradron.rotate') === 'off'; } catch (e) { }
function updateRotateHint() {
  if (!rotateEl) return;
  const portrait = window.innerHeight > window.innerWidth;
  const show = !rotateOff && device === 'phone' && portrait && (!st.started || st.paused);
  rotateEl.classList.toggle('hidden', !show);
}
el('rot-ok').addEventListener('click', () => {
  rotateOff = true;
  try { localStorage.setItem('gradron.rotate', 'off'); } catch (e) { }
  updateRotateHint();
});

fitView();
/* zapamiętany żyroskop wracamy tylko tam, gdzie nie trzeba pytać o zgodę z gestu (Android);
   na iOS użytkownik włącza go przyciskiem ŻYRO */
if (touch.supported && localStorage.getItem('gradron.tilt') === '1' &&
  !(window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function'))
  setTilt(true);

/* ---------- przełączniki (używane i przez klawisze, i przez menu, i przez pada) ---------- */
function toggleMode() { st.mode = st.mode === 'ACRO' ? 'ANGLE' : 'ACRO'; msg(st.mode, 'tryb lotu', 1.1); }
function toggleCam() {
  st.camMode = st.camMode === 'FPV' ? 'TPP' : 'FPV';
  msg('', st.camMode === 'FPV' ? 'kamera FPV' : 'kamera z 3. osoby', 0.9);
}
function tiltCam(d) {
  st.camTilt = Math.max(0, Math.min(55 * DEG, st.camTilt + d * DEG));
  msg('', 'kamera ' + Math.round(st.camTilt / DEG) + '°', 0.8);
}
function distCam(d) {
  st.camDist = Math.max(2, Math.min(14, st.camDist + d * 0.8));
  msg('', 'dystans TPP ' + st.camDist.toFixed(1) + ' m', 0.8);
}
/* [ ] oraz LB/RB: w FPV zmieniają kąt kamery, w TPP dystans */
function camAdjust(d) { st.camMode === 'TPP' ? distCam(d) : tiltCam(d * 5); }
function toggleSound() { soundOn = !soundOn; msg('', 'dźwięk ' + (soundOn ? 'on' : 'off'), 0.9); }
function toggleOsd() { st.osd = !st.osd; osd.classList.toggle('hidden', !st.osd); }
function toggleVtx() {
  st.vtx = !st.vtx;
  el('vignette').classList.toggle('off', !st.vtx);
  el('scan').classList.toggle('off', !st.vtx);
  signalNoise.classList.toggle('off', !st.vtx);
  signalTear.classList.toggle('off', !st.vtx);
  signalBlackout.classList.toggle('off', !st.vtx);
  if (!st.vtx) {
    signalNoise.style.opacity = signalTear.style.opacity = signalBlackout.style.opacity = 0;
    canvas.style.filter = '';
  }
}
function cyclePadThr() {
  const m = ['HOVER', 'LINIOWY', 'SPUSTKI'];
  st.padThr = m[(m.indexOf(st.padThr) + 1) % m.length];
  localStorage.setItem('gradron.padthr', st.padThr);
}
function cycleWind(d) {
  let i = WIND_LEVELS.indexOf(st.windSpeed);
  if (i < 0) {
    i = 0;
    for (let k = 1; k < WIND_LEVELS.length; k++)
      if (Math.abs(WIND_LEVELS[k] - st.windSpeed) < Math.abs(WIND_LEVELS[i] - st.windSpeed)) i = k;
  }
  i = (i + (d || 1) + WIND_LEVELS.length) % WIND_LEVELS.length;
  st.windSpeed = WIND_LEVELS[i];
  try { localStorage.setItem('gradron.wind', String(st.windSpeed)); } catch (e) { }
  msg('', st.windSpeed ? 'wiatr ' + st.windSpeed + ' m/s' : 'wiatr wyłączony', 0.9);
}
function toggleFull() {
  if (!document.fullscreenElement) {
    if (!document.documentElement.requestFullscreen) return;
    const p = document.documentElement.requestFullscreen();
    // na telefonie pełny ekran ma sens tylko w poziomie — jeśli przeglądarka pozwala, obracamy
    if (p && p.then) p.then(() => {
      if (device === 'phone' && screen.orientation && screen.orientation.lock)
        screen.orientation.lock('landscape').catch(() => { });
    }).catch(() => { });
  } else if (document.exitFullscreen) document.exitFullscreen();
}

/* ============================================================
   MENU (ESC / Start na padzie)
   ============================================================ */
const menuEl = el('menu'), menuList = el('menu-items'), padStatus = el('pad-status');
let menuOpen = false, menuSel = 0, menuPaint = 0, menuAxisCool = 0;

const MENU = [
  { label: 'Wróć do lotu', act: () => closeMenu() },
  {
    label: 'Mapa', val: () => MAP_DEFS.find(m => m.key === activeMap.key).label,
    act: () => { cycleMap(1); paintMenu(); }, adj: d => { cycleMap(d); paintMenu(); }
  },
  {
    label: 'Cel nawigacji', val: () => {
      if (activeMap.race) return 'bramki (wyścig)';
      const t = navTarget();
      return t ? t[0] : '—';
    },
    act: () => { cycleNav(1); paintMenu(); }, adj: d => { cycleNav(d); paintMenu(); }
  },
  { label: 'Tryb lotu', val: () => st.mode, act: toggleMode },
  { label: 'Kamera', val: () => st.camMode === 'FPV' ? 'FPV' : '3. OSOBA', act: toggleCam, adj: () => toggleCam() },
  { label: 'Kąt kamery FPV', val: () => Math.round(st.camTilt / DEG) + '°', act: () => tiltCam(5), adj: d => tiltCam(d * 5) },
  { label: 'Dystans kamery 3. osoby', val: () => st.camDist.toFixed(1) + ' m', act: () => distCam(1), adj: d => distCam(d) },
  { label: 'Gaz na padzie', val: () => st.padThr, act: cyclePadThr, adj: () => cyclePadThr() },
  {
    label: 'Drążki dotykowe (telefon)', val: () => touch.enabled ? 'ON' : 'OFF',
    act: () => setTouchUI(!touch.enabled, true), adj: () => setTouchUI(!touch.enabled, true)
  },
  {
    label: 'Układ ekranu',
    val: () => uiMode === 'AUTO'
      ? 'AUTO (' + (device === 'phone' ? 'telefon' : device === 'tablet' ? 'tablet' : 'pulpit') + ')'
      : uiMode,
    act: () => { cycleUiMode(1); paintMenu(); }, adj: d => { cycleUiMode(d); paintMenu(); }
  },
  {
    label: 'Sterowanie przechyłem telefonu', val: () => tilt.on ? 'ON · ' + tilt.range + '°' : 'OFF',
    act: () => setTilt(!tilt.on), adj: d => { if (tilt.on) cycleTiltRange(d); else setTilt(true); }
  },
  { label: 'Wyzeruj przechył (trzymaj telefon jak do lotu)', act: () => calibrateTilt() },
  {
    label: 'Prędkość wiatru',
    val: () => st.windSpeed ? st.windSpeed + ' m/s  (' + Math.round(st.windSpeed * 3.6) + ' km/h)' : 'OFF',
    act: () => cycleWind(1), adj: d => cycleWind(d)
  },
  { label: 'Dźwięk silników', val: () => soundOn ? 'ON' : 'OFF', act: toggleSound },
  { label: 'Efekty analogowego VTX', val: () => st.vtx ? 'ON' : 'OFF', act: toggleVtx },
  { label: 'OSD', val: () => st.osd ? 'ON' : 'OFF', act: toggleOsd },
  { label: 'Pełny ekran', val: () => document.fullscreenElement ? 'ON' : 'OFF', act: toggleFull },
  { label: 'Respawn na ostatniej bramce', act: () => { respawn(); closeMenu(); } },
  { label: 'Restart wyścigu', act: () => { restartRace(); closeMenu(); } },
  { label: 'Skasuj rekord', val: () => st.best ? st.best.toFixed(2) + 's' : '—', act: () => { st.best = null; localStorage.removeItem('gradron.best'); } }
];

const menuRows = MENU.map((m, i) => {
  const d = document.createElement('div');
  d.className = 'mi';
  d.innerHTML = '<span></span><b></b>';
  d.firstElementChild.textContent = m.label;
  d.addEventListener('mousemove', () => { if (menuSel !== i) { menuSel = i; paintMenu(); } });
  d.addEventListener('click', () => { menuSel = i; m.act(); paintMenu(); });
  menuList.appendChild(d);
  return d;
});

function paintMenu() {
  for (let i = 0; i < menuRows.length; i++) {
    menuRows[i].classList.toggle('sel', i === menuSel);
    menuRows[i].lastElementChild.textContent = MENU[i].val ? MENU[i].val() : '›';
  }
  padStatus.textContent = pad.connected
    ? 'pad: ' + pad.name + (pad.standard ? '  •  mapowanie standardowe' : '  •  mapowanie niestandardowe')
    : 'pad: nie wykryty — podłącz go i rusz drążkiem albo wciśnij przycisk';
  padStatus.className = 'padrow' + (pad.connected ? ' accent' : '');
}
function openMenu() {
  if (!st.started || menuOpen) return;
  menuOpen = true; st.paused = true;
  updateRotateHint();
  for (const k in keys) keys[k] = false;
  menuEl.classList.remove('hidden');
  paintMenu();
}
function closeMenu(announce) {
  if (!menuOpen) return;
  menuOpen = false; st.paused = false;
  updateRotateHint();
  menuEl.classList.add('hidden');
  if (announce) msg('LOT', 'ustawienia zamknięte', 1.1);
}
function toggleMenu() { menuOpen ? closeMenu() : openMenu(); }
function menuMove(d) { menuSel = (menuSel + d + MENU.length) % MENU.length; paintMenu(); }

/* nawigacja menu padem + globalne przyciski pada */
function padGlobal(dt) {
  if (!pad.connected) return;
  // START: na ekranie startowym odpala lot, w menu wychodzi z ustawień wprost do lotu,
  // w locie otwiera menu
  if (padHit(BTN.START) && padUse(BTN.START)) {
    if (!st.started) beginGame();
    else if (menuOpen) closeMenu(true);
    else openMenu();
    return;
  }
  if (!st.started) { if (padHit(BTN.A) && padUse(BTN.A)) beginGame(); return; }
  if (!menuOpen) return;

  if (padHit(BTN.UP)) menuMove(-1);
  if (padHit(BTN.DOWN)) menuMove(1);
  menuAxisCool -= dt;
  if (Math.abs(pad.ax[1]) > 0.55 && menuAxisCool <= 0) { menuMove(pad.ax[1] > 0 ? 1 : -1); menuAxisCool = 0.18; }
  else if (Math.abs(pad.ax[1]) < 0.3) menuAxisCool = 0;

  const item = MENU[menuSel];
  if (padHit(BTN.LEFT) && item.adj) { item.adj(-1); paintMenu(); }
  if (padHit(BTN.RIGHT) && item.adj) { item.adj(1); paintMenu(); }
  if (padHit(BTN.A) && padUse(BTN.A)) { item.act(); paintMenu(); }
  else if (padHit(BTN.B) && padUse(BTN.B)) closeMenu();
}

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();

  if (!st.started) { if (k === ' ' || k === 'enter') beginGame(); return; }

  if (menuOpen) {
    const item = MENU[menuSel];
    if (k === 'arrowup' || k === 'w') menuMove(-1);
    else if (k === 'arrowdown' || k === 's') menuMove(1);
    else if (k === 'arrowleft' && item.adj) { item.adj(-1); paintMenu(); }
    else if (k === 'arrowright' && item.adj) { item.adj(1); paintMenu(); }
    else if (k === 'enter' || k === ' ') { item.act(); paintMenu(); }
    else if (k === 'escape' || k === 'p' || k === 'h') closeMenu();
    return;
  }

  keys[k] = true;
  switch (k) {
    case 'm': toggleMode(); break;
    case 'c': toggleCam(); break;
    case 'r': respawnPressed(); break;
    case 't': restartRace(); break;
    case '[': camAdjust(-1); break;
    case ']': camAdjust(1); break;
    case 'n': toggleSound(); break;
    case 'o': toggleOsd(); break;
    case 'v': toggleVtx(); break;
    case 'g': cycleNav(1); break;          // następny cel nawigacji (mapy misyjne)
    case 'k': cycleMap(1); break;          // następna mapa
    case 'escape': case 'p': case 'h': openMenu(); break;
  }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
window.addEventListener('gamepadconnected', () => { if (menuOpen) paintMenu(); });
window.addEventListener('gamepaddisconnected', () => { if (menuOpen) paintMenu(); });

window.addEventListener('resize', fitView);
window.addEventListener('orientationchange', () => setTimeout(fitView, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitView);
if (screen.orientation && screen.orientation.addEventListener)
  screen.orientation.addEventListener('change', () => setTimeout(fitView, 120));

/* ?auto — pominięcie ekranu startowego (przydatne do testów i zrzutów) */
/* wybór mapy: ?map=port|alpine|tor, inaczej ostatnio używana */
(function initMap() {
  const q = /[?&]map=(\w+)/.exec(location.search);
  let key = q ? q[1] : null;
  if (!key) { try { key = localStorage.getItem('gradron.map'); } catch (e) { } }
  if (key && key !== 'tor' && MAP_DEFS.some(m => m.key === key)) setMap(key, true);
})();

if (/[?&]auto/.test(location.search)) {
  if (activeMap.race) { st.pos.set(START.x, 9, START.z); faceGate(0); }
  else { st.pos.copy(activeMap.spawn.pos).y += 9; faceNav(); }
  stick.thr = HOVER_T;
  window.__gd = {
    st, stick, gates, THREE, camera, colliders, inSolid, physics,
    renderer, scene, groundMap, concreteMap,
    setMap, cycleMap, cycleNav, navTarget, updateSignal, touch, tilt, FOV,
    get activeMap() { return activeMap; }, get device() { return device; },
    get builtMaps() { return builtMaps; }
  }; // hook do testów
  beginGame();
}

/* ============================================================
   PĘTLA GŁÓWNA
   ============================================================ */
let last = performance.now();
const propSpin = [0, 0, 0, 0];
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  // rAF potrafi podać znacznik czasu sprzed startu pętli (długa inicjalizacja na telefonie) —
  // ujemny albo ogromny krok policzyłby fizykę wstecz i wysadził prędkości w kosmos
  if (!(dt > 0)) dt = 0;
  else if (dt > 0.1) dt = 0.1;

  pollPad();                       // pad czytamy zawsze — także w menu i na ekranie startowym
  padGlobal(dt);
  if (menuOpen) {
    menuPaint -= dt;
    if (menuPaint <= 0) { paintMenu(); menuPaint = 0.25; }   // odświeżanie statusu pada / pełnego ekranu
  }

  if (st.started && !st.paused) {
    readInput(dt);

    if (st.crashed > 0) {
      st.crashed -= dt;
      stick.thr = 0; stick.yaw = stick.pitch = stick.roll = 0;
      st.vel.multiplyScalar(0.9);
      st.pos.addScaledVector(st.vel, dt);
      const floor = (activeMap.surfaceAt ? activeMap.surfaceAt(st.pos.x, st.pos.z).y : 0) + R_DRONE;
      st.pos.y = Math.max(floor, st.pos.y);
      if (st.crashed <= 0) respawn();
    } else {
      const steps = Math.max(1, Math.ceil(dt / 0.006));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) physics(h);
      if (activeMap.race) checkGates();
      else if (!st.timing && stick.thr > 0.15) st.timing = true;   // mapy misyjne: czas lotu
      if (st.timing) st.time += dt;
    }

    for (let i = 0; i < props.length; i++) {
      propSpin[i] += dt * (18 + st.motor[i] * 520) * MOTORS[i].spin;
      props[i].rotation.y = propSpin[i];
    }
    audioUpdate(dt);
  }

  drone.position.copy(st.pos);
  drone.quaternion.copy(st.quat);
  updateCamera(dt);
  updateSignal(st.paused ? 0 : dt);
  updateOSD(st.paused ? 0 : dt);

  // animacje mapy misyjnej (woda, wirniki, żuraw, mewy) — także w menu, tylko bez postępu czasu
  if (activeMap.update) activeMap.update(st.paused ? 0 : dt, camera.position);

  // migotanie następnej bramki
  matNext.emissiveIntensity = 1.1 + Math.sin(now * 0.005) * 0.55;

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

})();
