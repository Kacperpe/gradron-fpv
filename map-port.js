/* ============================================================
   MAPA 2 — "PORT MEWI" (strefa portowo-przemysłowa nad kanałem)
   Tylko geometria świata + rejestr punktów misyjnych. Zero fizyki,
   zero logiki misji — to wchodzi do głównej gry osobno.

   Użycie:  const map = PortMap.create(THREE, scene, renderer);
            map.update(dt);          // wirujące łopaty, woda, latarnia
            map.colliders            // [{min:V3, max:V3}] do kolizji AABB
            map.landmarks            // nazwane punkty/obiekty dla misji
            map.zones                // strefy: gpsDenied, danger (dyski wirników), noFly
            map.spawn                // { pos, heading } — płyta startowa bazy

   UKŁAD (metry, +Y w górę):
     morze          x < -100                  (poziom wody y = 0)
     kanał          |z| < 20, x od -100 do 210
     brzeg północny z < -20   → port: suwnice, kontenery, silosy, hala, komin, statek, BAZA
     brzeg południowy z > 20  → przemysł: linia WN, farma PV, budowa, las (SAR), plaża
     ląd ma poziom y = 4 (nabrzeże), woda y = 0
   ============================================================ */
var PortMap = (function () {
  'use strict';

  const QUAY = 4;            // poziom lądu (korona nabrzeża)
  const SEA_X = -100;        // linia brzegowa od strony morza
  const CH = 20;             // połowa szerokości kanału (|z| < CH to woda)
  const CH_END = 210;        // koniec basenu w głębi lądu

  function create(THREE, scene, renderer) {
    const V3 = THREE.Vector3;
    const colliders = [];
    const landmarks = {};
    const zones = { gpsDenied: [], danger: [], noFly: [] };
    const spinners = [];       // { obj, speed } — łopaty, radar, latarnia
    const root = new THREE.Group();
    scene.add(root);

    let seed = 77771;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const rr = (a, b) => a + (b - a) * rnd();
    const aniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;

    /* ---------- materiały ---------- */
    const M = {
      concrete: new THREE.MeshStandardMaterial({ color: 0x9a9c98, roughness: 0.94 }),
      concreteDark: new THREE.MeshStandardMaterial({ color: 0x6d716f, roughness: 0.95 }),
      asphalt: new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.98 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x8d949b, roughness: 0.55, metalness: 0.65 }),
      steelDark: new THREE.MeshStandardMaterial({ color: 0x4a5158, roughness: 0.6, metalness: 0.5 }),
      paintRed: new THREE.MeshStandardMaterial({ color: 0xc7452f, roughness: 0.7 }),
      paintWhite: new THREE.MeshStandardMaterial({ color: 0xdcd9d0, roughness: 0.75 }),
      paintYellow: new THREE.MeshStandardMaterial({ color: 0xe8b53c, roughness: 0.7 }),
      paintBlue: new THREE.MeshStandardMaterial({ color: 0x2f5f8e, roughness: 0.7 }),
      paintGreen: new THREE.MeshStandardMaterial({ color: 0x2f7a52, roughness: 0.7 }),
      rust: new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.95 }),
      /* baza pod kontenery: ciemniejsza, żeby kolory instancji nie wychodziły pastelowe */
      container: new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.82, metalness: 0.15 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x16242c, roughness: 0.18, metalness: 0.7 }),
      panel: new THREE.MeshStandardMaterial({ color: 0x1b2b46, roughness: 0.25, metalness: 0.55 }),
      sand: new THREE.MeshStandardMaterial({ color: 0xcfba8a, roughness: 1 }),
      grass: new THREE.MeshStandardMaterial({ color: 0x54693c, roughness: 1 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 1 }),
      hull: new THREE.MeshStandardMaterial({ color: 0x27384a, roughness: 0.75, metalness: 0.2 }),
      hullRed: new THREE.MeshStandardMaterial({ color: 0x7d2a22, roughness: 0.85 }),
      light: new THREE.MeshBasicMaterial({ color: 0xfff2c0 })
    };

    /* ---------- helpery ---------- */
    function addCollider(mesh) {
      mesh.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(mesh);
      colliders.push({ min: bb.min, max: bb.max });
      return mesh;
    }
    /* box(w,h,d, x,y,z, mat, opts) — y to ŚRODEK bryły, chyba że opts.base */
    function box(w, h, d, x, y, z, mat, opts) {
      const o = opts || {};
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || M.concrete);
      m.position.set(x, o.base ? y + h / 2 : y, z);
      if (o.ry) m.rotation.y = o.ry;
      if (o.rz) m.rotation.z = o.rz;
      if (o.rx) m.rotation.x = o.rx;
      m.castShadow = o.shadow !== false;
      m.receiveShadow = o.shadow !== false;
      (o.parent || root).add(m);
      if (o.solid !== false) addCollider(m);
      return m;
    }
    function cyl(rt, rb, h, x, y, z, mat, opts) {
      const o = opts || {};
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, o.seg || 12, 1, !!o.open), mat || M.steel);
      m.position.set(x, o.base ? y + h / 2 : y, z);
      if (o.rx) m.rotation.x = o.rx;
      if (o.rz) m.rotation.z = o.rz;
      if (o.ry) m.rotation.y = o.ry;
      m.castShadow = o.shadow !== false;
      m.receiveShadow = o.shadow !== false;
      (o.parent || root).add(m);
      if (o.solid) addCollider(m);
      return m;
    }
    /* rura/lina między dwoma punktami — kable, cięgna, przewody */
    function tube(a, b, r, mat, parent) {
      const dir = new V3().subVectors(b, a);
      const len = dir.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat || M.steelDark);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
      (parent || root).add(m);
      return m;
    }
    /* kratownica słupa/wieży: 4 krawężniki + krzyżulce (tanio, a wygląda jak krata) */
    function lattice(x, z, base, top, wBot, wTop, mat, parent) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      (parent || root).add(g);
      const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const pts = legs.map(([sx, sz]) => [
        new V3(sx * wBot / 2, base, sz * wBot / 2),
        new V3(sx * wTop / 2, top, sz * wTop / 2)
      ]);
      for (const [a, b] of pts) tube(a, b, 0.22, mat, g);
      const rows = Math.max(2, Math.round((top - base) / 6));
      for (let r = 0; r <= rows; r++) {
        const t = r / rows, y = base + (top - base) * t, w = wBot + (wTop - wBot) * t;
        for (let i = 0; i < 4; i++) {
          const a = legs[i], b = legs[(i + 1) % 4];
          tube(new V3(a[0] * w / 2, y, a[1] * w / 2), new V3(b[0] * w / 2, y, b[1] * w / 2), 0.13, mat, g);
          if (r < rows) {
            const t2 = (r + 1) / rows, y2 = base + (top - base) * t2, w2 = wBot + (wTop - wBot) * t2;
            tube(new V3(a[0] * w / 2, y, a[1] * w / 2), new V3(b[0] * w2 / 2, y2, b[1] * w2 / 2), 0.1, mat, g);
          }
        }
      }
      return g;
    }
    function instanced(geo, mat, list, colors) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3(1, 1, 1), e = new THREE.Euler();
      list.forEach((t, i) => {
        e.set(t.rx || 0, t.ry || 0, t.rz || 0);
        q.setFromEuler(e);
        s.set(t.sx || 1, t.sy || 1, t.sz || 1);
        mx.compose(new V3(t.x, t.y, t.z), q, s);
        im.setMatrixAt(i, mx);
        if (colors) im.setColorAt(i, colors[i]);
      });
      im.castShadow = true; im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      root.add(im);
      return im;
    }

    /* ============================================================
       1. WODA I LĄD
       ============================================================ */
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000, 1, 1),
      new THREE.ShaderMaterial({
        uniforms: {
          t: { value: 0 }, sun: { value: new V3(-0.45, 0.62, 0.64).normalize() },
          eye: { value: new V3() }, fogCol: { value: new THREE.Color(0xa9c2d2) }
        },
        vertexShader: `varying vec3 vW; void main(){
          vW = (modelMatrix * vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
        fragmentShader: `uniform float t; uniform vec3 sun, eye, fogCol; varying vec3 vW;
          float w(vec2 p){ return sin(p.x*0.09 + t*1.1)*0.5 + sin(p.y*0.13 - t*0.9)*0.5
                                + sin((p.x+p.y)*0.05 + t*0.6)*0.4; }
          void main(){
            vec2 p = vW.xz;
            float d = length(vW - eye);
            // fale wygaszane z odległością — bez tego daleka woda robi mory/szachownicę
            float fade = 1.0 - clamp((d - 90.0) / 320.0, 0.0, 1.0);
            float h = w(p), hx = w(p+vec2(1.3,0.0))-h, hy = w(p+vec2(0.0,1.3))-h;
            vec3 n = normalize(mix(vec3(0.0,1.0,0.0), vec3(-hx*0.9, 1.0, -hy*0.9), fade));
            vec3 base = mix(vec3(0.045,0.135,0.185), vec3(0.09,0.26,0.32), (h*0.5+0.5)*fade + 0.35);
            float spec = pow(max(dot(reflect(vec3(0.0,-1.0,0.0), n), normalize(sun)), 0.0), 24.0);
            vec3 c = base + vec3(1.0,0.96,0.85) * spec * 0.5 * (0.35 + 0.65*fade);
            c = mix(c, fogCol, clamp((d - 300.0) / 1200.0, 0.0, 0.85));   // zlanie się z mgłą
            gl_FragColor = vec4(c, 1.0);
          }`
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    root.add(water);
    landmarks.waterLevel = 0;

    /* teren: piaszczysto-betonowa tekstura pod nabrzeża i pola */
    function groundTex(base, spots) {
      const s = 512, c = document.createElement('canvas'); c.width = c.height = s;
      const g = c.getContext('2d');
      g.fillStyle = base; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.05).toFixed(3) + ')';
        g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 4, 2 + Math.random() * 4);
      }
      for (let i = 0; i < spots; i++) {
        g.fillStyle = 'rgba(255,255,255,' + (0.02 + Math.random() * 0.05).toFixed(3) + ')';
        g.beginPath();
        g.ellipse(Math.random() * s, Math.random() * s, 20 + Math.random() * 90, 15 + Math.random() * 60,
          Math.random() * 3.14, 0, 6.283);
        g.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      t.encoding = THREE.sRGBEncoding;
      return t;
    }
    const texQuay = groundTex('#8f9290', 30), texField = groundTex('#5d6b46', 26);
    const texSand = groundTex('#b9a679', 34);
    texQuay.repeat.set(140, 140); texField.repeat.set(120, 120);   // ~10 m na kafel
    texSand.repeat.set(30, 34);
    M.sand.map = texSand; M.sand.color.setHex(0xb2a37c); M.sand.needsUpdate = true;
    const matQuay = new THREE.MeshStandardMaterial({ map: texQuay, roughness: 0.95 });
    const matField = new THREE.MeshStandardMaterial({ map: texField, roughness: 1 });

    /* brzegi kanału: dwie płyty lądu z pionową ścianą nabrzeża.
       Ląd zaczyna się dokładnie na linii brzegowej SEA_X — na zachód od niej jest morze. */
    function bank(zMin, zMax, mat) {
      const d = zMax - zMin, w = 900;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, QUAY + 8, d), mat);
      m.position.set(SEA_X + w / 2, (QUAY - 8) / 2, (zMin + zMax) / 2);
      m.receiveShadow = true; m.castShadow = false;
      root.add(m);
      colliders.push({
        min: new V3(SEA_X, -50, zMin),
        max: new V3(SEA_X + w, QUAY, zMax)
      });
      return m;
    }
    bank(-620, -CH, matQuay);        // północny (port)
    bank(CH, 620, matField);         // południowy (przemysł)
    /* zamknięcie basenu w głębi lądu (koniec kanału) */
    box(60, QUAY + 8, 2 * CH + 4, CH_END + 30, -2, 0, M.concreteDark, { shadow: true });

    /* pas asfaltu wzdłuż nabrzeża portu + pola trawy */
    box(620, 0.12, 34, 10, QUAY + 0.06, -42, M.asphalt, { solid: false });
    box(360, 0.1, 220, 60, QUAY + 0.05, 150, M.grass, { solid: false });

    /* PLAŻA: piaszczysta mierzeja wchodząca w morze na południowo-zachodnim krańcu */
    const BEACH_Y = 0.9;
    (function beachSpit() {
      const x0 = -280, x1 = SEA_X, z0 = 110, z1 = 300;
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 8, z1 - z0), M.sand);
      m.position.set((x0 + x1) / 2, BEACH_Y - 4, (z0 + z1) / 2);
      m.receiveShadow = true; root.add(m);
      colliders.push({ min: new V3(x0, -50, z0), max: new V3(x1, BEACH_Y, z1) });
      // łagodne zejście do wody na zachodnim skraju mierzei
      const ramp = new THREE.Mesh(new THREE.PlaneGeometry(46, z1 - z0), M.sand);
      ramp.rotation.set(-Math.PI / 2, 0, 0);
      ramp.rotation.x += 0.03;
      ramp.position.set(x0 - 21, BEACH_Y - 0.55, (z0 + z1) / 2);
      ramp.receiveShadow = true; root.add(ramp);
    })();
    landmarks.beachY = BEACH_Y;

    /* ============================================================
       2. BAZA — płyta startowa i stanowisko operatora
       ============================================================ */
    (function base() {
      const bx = -66, bz = -215;      // z dala od yardu kontenerowego, z widokiem na kanał
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.2, 28), M.asphalt);
      pad.position.set(bx, QUAY + 0.1, bz); pad.receiveShadow = true; root.add(pad);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.16, 6, 40), M.paintYellow);
      ring.rotation.x = -Math.PI / 2; ring.position.set(bx, QUAY + 0.22, bz); root.add(ring);
      box(1.2, 0.06, 7, bx, QUAY + 0.24, bz, M.paintYellow, { solid: false, shadow: false });
      box(7, 0.06, 1.2, bx, QUAY + 0.24, bz, M.paintYellow, { solid: false, shadow: false });
      // van + namiot ekipy + maszt anteny
      box(6, 2.6, 2.4, bx + 14, QUAY, bz + 6, M.paintWhite, { base: true });
      box(4, 2.2, 4, bx + 14, QUAY, bz - 6, M.paintBlue, { base: true });
      const mast = lattice(bx + 22, bz, QUAY, QUAY + 18, 1.4, 0.8, M.steelDark);
      const dish = cyl(1.8, 1.8, 0.4, bx + 22, QUAY + 17, bz, M.paintWhite, { rx: Math.PI / 2.4, seg: 16 });
      spinners.push({ obj: dish, speed: 0.25, axis: 'y' });
      landmarks.pad = new V3(bx, QUAY + 0.3, bz);
      landmarks.baseMast = new V3(bx + 22, QUAY + 18, bz);
    })();

    /* ============================================================
       3. SUWNICE STS nad kanałem (przelot między nogami / pod belką)
       ============================================================ */
    landmarks.cranes = [];
    /* Suwnica STS: oba torowiska na nabrzeżu (z < -CH), wysięgnik wychodzi nad kanał.
       zc = środek rozstawu nóg, cx = pozycja wzdłuż nabrzeża. */
    function stsCrane(cx) {
      const g = new THREE.Group(); root.add(g);
      const zc = -46, span = 26, top = QUAY + 44;      // nogi na -59 i -33 → obie na lądzie
      const zBack = zc - span / 2, zSea = zc + span / 2;
      for (const zz of [zBack, zSea]) for (const sx of [-1, 1])
        box(2.2, top - QUAY, 2.2, cx + sx * 9, QUAY, zz, M.paintRed, { base: true, parent: g });
      // portale poprzeczne
      box(24, 3, 4, cx, top, zBack, M.paintRed, { parent: g });
      box(24, 3, 4, cx, top, zSea, M.paintRed, { parent: g });
      // wysięgnik: od zaplecza (-62) nad kanał (+12)
      box(6, 2.6, 74, cx, top + 4, -25, M.paintRed, { parent: g });
      // maszynownia nad zapleczem + pylon i cięgna
      box(10, 6, 12, cx, top + 8, zBack - 8, M.paintWhite, { parent: g });
      box(3, 26, 3, cx, top + 9, zc, M.paintRed, { parent: g });
      const apex = new V3(cx, top + 22, zc);
      tube(apex, new V3(cx, top + 5, 10), 0.18, M.steelDark, g);
      tube(apex, new V3(cx, top + 5, -60), 0.18, M.steelDark, g);
      // wózek + spreader na linach, zawieszony nad statkiem — cel inspekcji z bliska
      const zT = -8;
      const trolley = box(5, 3, 5, cx, top + 1, zT, M.paintYellow, { parent: g, solid: false });
      tube(new V3(cx, top + 1, zT), new V3(cx, QUAY + 16, zT), 0.1, M.steelDark, g);
      box(12.4, 1.4, 3, cx, QUAY + 15, zT, M.paintYellow, { parent: g });
      landmarks.cranes.push({
        pos: new V3(cx, top, zc),
        boomTip: new V3(cx, top + 4, 10),
        spreader: new V3(cx, QUAY + 15, zT),
        trolley
      });
      return g;
    }
    stsCrane(-30); stsCrane(40);

    /* ============================================================
       4. KONTENEROWY YARD (ciasne alejki — technika lotu)
       ============================================================ */
    (function yard() {
      const cols = [0xc0392b, 0x1f6f8b, 0x2e7d4f, 0xd6a12b, 0x8e44ad, 0x555f66, 0xb8532f];
      const list = [], colors = [];
      for (let row = 0; row < 7; row++) {
        const z = -70 - row * 13;
        for (let bay = 0; bay < 9; bay++) {
          const x = -86 + bay * 14;
          const stack = 1 + Math.floor(rnd() * 4);
          for (let k = 0; k < stack; k++) {
            list.push({ x: x + rr(-0.3, 0.3), y: QUAY + 1.3 + k * 2.65, z, ry: rr(-0.02, 0.02) });
            colors.push(new THREE.Color(cols[(rnd() * cols.length) | 0]));
          }
          if (stack > 0) {
            colliders.push({
              min: new V3(x - 6.2, QUAY, z - 1.35),
              max: new V3(x + 6.2, QUAY + stack * 2.65, z + 1.35)
            });
          }
        }
      }
      instanced(new THREE.BoxGeometry(12.2, 2.6, 2.5), M.container, list, colors);
      landmarks.yard = { center: new V3(-30, QUAY, -110), aisleZ: -70 - 3 * 13 };
    })();

    /* ============================================================
       5. SILOSY, HALA (wnętrze = brak GPS), KOMIN
       ============================================================ */
    (function silos() {
      const g = new THREE.Group(); root.add(g);
      for (let i = 0; i < 5; i++) {
        const x = 100 + i * 17;
        cyl(8, 8, 34, x, QUAY, -80, M.paintWhite, { base: true, seg: 18, solid: true, parent: g });
        cyl(8.4, 8.4, 1.2, x, QUAY + 34, -80, M.concreteDark, { seg: 18, parent: g });
      }
      box(90, 6, 10, 134, QUAY + 36, -80, M.steelDark, { parent: g });   // galeria przesypowa
      landmarks.silos = new V3(134, QUAY + 34, -80);
    })();

    (function hall() {
      // hala z otwartą bramą od strony kanału: wlot FPV + strefa bez GPS
      const x0 = 120, z0 = -150, w = 70, d = 40, h = 16;
      const g = new THREE.Group(); root.add(g);
      box(w, 0.3, d, x0, QUAY + 0.15, z0, M.concreteDark, { parent: g, solid: false });
      box(w, h, 1.2, x0, QUAY, z0 - d / 2, M.paintWhite, { base: true, parent: g });        // tył
      box(1.2, h, d, x0 - w / 2, QUAY, z0, M.paintWhite, { base: true, parent: g });         // lewa
      box(1.2, h, d, x0 + w / 2, QUAY, z0, M.paintWhite, { base: true, parent: g });         // prawa
      // przód z bramą 14×9 w środku
      const doorW = 14, side = (w - doorW) / 2;
      box(side, h, 1.2, x0 - doorW / 2 - side / 2, QUAY, z0 + d / 2, M.paintWhite, { base: true, parent: g });
      box(side, h, 1.2, x0 + doorW / 2 + side / 2, QUAY, z0 + d / 2, M.paintWhite, { base: true, parent: g });
      box(doorW, h - 9, 1.2, x0, QUAY + 9, z0 + d / 2, M.paintWhite, { base: true, parent: g });
      // dach + świetliki + słupy w środku
      box(w + 2, 0.8, d + 2, x0, QUAY + h, z0, M.steelDark, { parent: g });
      for (let i = -1; i <= 1; i++) box(w - 10, 0.3, 3, x0, QUAY + h + 0.5, z0 + i * 12, M.glass, { parent: g, solid: false });
      for (const sx of [-1, 1]) for (const sz of [-1, 0, 1])
        cyl(0.5, 0.5, h, x0 + sx * 18, QUAY, z0 + sz * 12, M.steel, { base: true, solid: true, parent: g });
      // regały w środku (przeszkody dla inspekcji wewnątrz)
      for (let i = 0; i < 4; i++)
        box(50, 6, 2.5, x0, QUAY, z0 - 14 + i * 9, M.rust, { base: true, parent: g });
      zones.gpsDenied.push({
        min: new V3(x0 - w / 2, QUAY, z0 - d / 2), max: new V3(x0 + w / 2, QUAY + h, z0 + d / 2),
        name: 'hala magazynowa'
      });
      landmarks.hall = { door: new V3(x0, QUAY + 4.5, z0 + d / 2 + 6), center: new V3(x0, QUAY + 7, z0) };
    })();

    (function stack() {
      // komin z pasami — inspekcja pionowa i orbita
      const x = 200, z = -60, h = 74;
      const g = new THREE.Group(); root.add(g);
      cyl(3.2, 5.5, h, x, QUAY, z, M.paintWhite, { base: true, seg: 20, solid: true, parent: g });
      for (let i = 0; i < 4; i++)
        cyl(3.35 + i * 0.18, 3.35 + i * 0.18, 5, x, QUAY + h - 8 - i * 15, z, M.paintRed, { seg: 20, parent: g });
      cyl(3.6, 3.6, 1.5, x, QUAY + h, z, M.steelDark, { seg: 20, parent: g });
      // drabina + platforma serwisowa (cel "zrób zdjęcie spoiny")
      box(0.8, h - 4, 0.15, x + 3.4, QUAY + h / 2, z, M.steelDark, { parent: g, solid: false });
      const plat = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.3, 6, 24), M.paintYellow);
      plat.rotation.x = -Math.PI / 2; plat.position.set(x, QUAY + h - 12, z); g.add(plat);
      landmarks.stack = { base: new V3(x, QUAY, z), top: new V3(x, QUAY + h, z), platform: new V3(x, QUAY + h - 12, z), r: 5 };
    })();

    /* ============================================================
       6. STATEK PRZY NABRZEŻU (inspekcja kadłuba, przelot nad pokładem)
       ============================================================ */
    (function ship() {
      const g = new THREE.Group(); root.add(g);
      const zc = -8, x0 = -10, L = 170;      // zacumowany w kanale, wzdłuż nabrzeża portu
      box(L, 9, 22, x0, 1.5, zc, M.hull, { parent: g });                       // kadłub
      box(L, 1.4, 22, x0, 6.6, zc, M.hullRed, { parent: g, solid: false });    // pas wodnicy
      box(L - 30, 1, 20, x0, 7.4, zc, M.concreteDark, { parent: g, solid: false });
      // nadbudówka na rufie
      box(20, 14, 18, x0 + L / 2 - 14, 8, zc, M.paintWhite, { base: true, parent: g });
      box(16, 3, 14, x0 + L / 2 - 14, 22.5, zc, M.glass, { parent: g });
      cyl(1.2, 1.2, 12, x0 + L / 2 - 14, 24, zc, M.paintYellow, { base: true, parent: g });
      // kontenery na pokładzie w dwóch warstwach
      const list = [], colors = [], cols = [0xc0392b, 0x1f6f8b, 0x2e7d4f, 0xd6a12b];
      for (let i = 0; i < 9; i++) for (let j = -1; j <= 1; j++) for (let k = 0; k < 2; k++) {
        list.push({ x: x0 - L / 2 + 20 + i * 14, y: 9.2 + k * 2.65, z: zc + j * 3 });
        colors.push(new THREE.Color(cols[(rnd() * 4) | 0]));
      }
      instanced(new THREE.BoxGeometry(12.2, 2.6, 2.5), M.container, list, colors);
      colliders.push({
        min: new V3(x0 - L / 2 + 12, 8, zc - 5), max: new V3(x0 + L / 2 - 26, 14.4, zc + 5)
      });
      landmarks.ship = { bow: new V3(x0 - L / 2, 8, zc), stern: new V3(x0 + L / 2, 8, zc), mid: new V3(x0, 5, zc - 12) };
    })();

    /* ============================================================
       7. MOST NAD KANAŁEM (przelot pod pomostem, strefa bez GPS)
       ============================================================ */
    (function bridge() {
      const bx = 130, deck = 22, g = new THREE.Group(); root.add(g);
      // filary w wodzie
      for (const sz of [-1, 1]) box(9, deck, 9, bx, 0, sz * (CH + 3), M.concreteDark, { base: true, parent: g });
      // pomost + krawężniki (pod nim leci się w cieniu — brak GPS)
      box(16, 1.6, 2 * CH + 34, bx, deck, 0, M.concreteDark, { parent: g });
      for (const sx of [-1, 1]) box(1, 2.4, 2 * CH + 34, bx + sx * 8, deck + 1.6, 0, M.paintWhite, { parent: g });
      // pylony A + cięgna
      for (const sz of [-1, 1]) {
        const pz = sz * (CH + 3);
        for (const sx of [-1, 1]) {
          const a = new V3(bx + sx * 7, deck, pz), b = new V3(bx + sx * 1.5, deck + 34, pz);
          tube(a, b, 1.5, M.paintWhite, g);
        }
        box(6, 1.5, 4, bx, deck + 34, pz, M.paintWhite, { parent: g });
        for (let i = 1; i <= 6; i++) {
          const off = sz * i * 5.5;
          tube(new V3(bx, deck + 33, pz), new V3(bx, deck + 0.4, off), 0.14, M.steelDark, g);
        }
      }
      zones.gpsDenied.push({
        min: new V3(bx - 12, 0, -CH - 6), max: new V3(bx + 12, deck, CH + 6), name: 'pod pomostem mostu'
      });
      landmarks.bridge = {
        deckY: deck, west: new V3(bx, 8, -CH - 10), east: new V3(bx, 8, CH + 10),
        under: [new V3(bx, 8, -14), new V3(bx, 7, 0), new V3(bx, 8, 14)],
        pylonTop: new V3(bx, deck + 34, CH + 3)
      };
    })();

    /* ============================================================
       8. LINIA WYSOKIEGO NAPIĘCIA (korytarz + inspekcja izolatorów)
       ============================================================ */
    (function powerline() {
      const z = 95, ys = [30, 26, 22], pylons = [];
      const xs = [-70, 10, 90, 170, 250];
      for (const x of xs) {
        lattice(x, z, QUAY, QUAY + 34, 9, 3.4, M.steelDark);
        for (let i = 0; i < 3; i++)
          box(22, 0.8, 0.8, x, QUAY + ys[i], z, M.steelDark, { solid: false });
        // izolatory (cele inspekcji)
        for (let i = 0; i < 3; i++) for (const sx of [-1, 1])
          cyl(0.5, 0.5, 2.2, x + sx * 10, QUAY + ys[i] - 1.4, z, M.paintWhite, { seg: 8, solid: false });
        pylons.push(new V3(x, QUAY + 34, z));
      }
      // przewody z prowisem (łamana z 6 odcinków)
      for (let s = 0; s < xs.length - 1; s++) {
        const x1 = xs[s], x2 = xs[s + 1], sag = 5;
        for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) {
          const y0 = QUAY + ys[i] - 2.6, xo = sx * 10;
          let prev = new V3(x1 + xo, y0, z);
          for (let k = 1; k <= 6; k++) {
            const t = k / 6, xx = x1 + (x2 - x1) * t;
            const yy = y0 - Math.sin(Math.PI * t) * sag;
            const p = new V3(xx + xo, yy, z);
            tube(prev, p, 0.12, M.steelDark);
            prev = p;
          }
        }
      }
      // stacja transformatorowa na końcu korytarza
      box(40, 8, 26, -120, QUAY, z, M.concreteDark, { base: true });
      for (let i = 0; i < 3; i++) cyl(2.4, 2.4, 6, -132 + i * 12, QUAY + 8, z + 6, M.steel, { base: true, solid: true });
      landmarks.powerline = { pylons, z, corridor: xs.map(x => new V3(x, QUAY + 26, z)), substation: new V3(-120, QUAY + 8, z) };
      zones.noFly.push({ center: new V3(10, QUAY + 26, z), r: 6, name: 'przewody pod napięciem' });
    })();

    /* ============================================================
       9. FARMA PV (siatkowy przelot / mapowanie)
       ============================================================ */
    (function solar() {
      const list = [], rows = 11, perRow = 16;
      for (let r = 0; r < rows; r++) for (let i = 0; i < perRow; i++) {
        list.push({ x: 60 + i * 11, y: QUAY + 1.6, z: 170 + r * 9, rx: -0.55 });
      }
      instanced(new THREE.BoxGeometry(10, 0.14, 4.4), M.panel, list);
      for (let r = 0; r < rows; r++) for (let i = 0; i < perRow; i++)
        colliders.push({
          min: new V3(60 + i * 11 - 5, QUAY, 170 + r * 9 - 2),
          max: new V3(60 + i * 11 + 5, QUAY + 2.4, 170 + r * 9 + 2)
        });
      // inwertery + jeden panel "uszkodzony" (cel do znalezienia)
      for (let i = 0; i < 3; i++) box(3, 2.2, 1.4, 50, QUAY, 180 + i * 30, M.paintWhite, { base: true });
      const bad = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.2, 4.6),
        new THREE.MeshStandardMaterial({ color: 0x6b2b22, roughness: 0.5, metalness: 0.3 }));
      bad.rotation.x = -0.55; bad.position.set(60 + 9 * 11, QUAY + 1.65, 170 + 6 * 9); root.add(bad);
      landmarks.solar = {
        rows, rowZ: r => 170 + r * 9, xMin: 55, xMax: 60 + (perRow - 1) * 11 + 5,
        alt: QUAY + 26, faulty: new V3(60 + 9 * 11, QUAY + 1.7, 170 + 6 * 9)
      };
    })();

    /* ============================================================
       10. BUDOWA (żuraw wieżowy, szkielet budynku)
       ============================================================ */
    (function site() {
      const x = -40, z = 55;
      // szkielet: 6 stropów na słupach
      for (let f = 0; f < 6; f++) {
        box(34, 0.5, 24, x, QUAY + 4 + f * 4, z, M.concrete);
        if (f < 5) for (const sx of [-1, 0, 1]) for (const sz of [-1, 1])
          box(1.2, 4, 1.2, x + sx * 15, QUAY + 4.25 + f * 4, z + sz * 10.5, M.concrete, { base: true });
      }
      // żuraw wieżowy z wysięgnikiem i przeciwwagą
      const cx = x + 26, cz = z - 4, top = QUAY + 56;
      lattice(cx, cz, QUAY, top, 3.6, 3.6, M.paintYellow);
      const jib = new THREE.Group(); jib.position.set(cx, top, cz); root.add(jib);
      box(1.8, 1.8, 92, 0, 1.6, -30, M.paintYellow, { parent: jib, solid: false });
      box(3, 3, 16, 0, 1.6, 20, M.concreteDark, { parent: jib, solid: false });
      box(4, 3.4, 4, 0, 0, 4, M.paintYellow, { parent: jib, solid: false });
      tube(new V3(0, 9, 2), new V3(0, 2.4, -70), 0.14, M.steelDark, jib);
      const hook = box(1.6, 1.2, 1.6, 0, -22, -44, M.steelDark, { parent: jib, solid: false });
      tube(new V3(0, 1.2, -44), new V3(0, -21, -44), 0.08, M.steelDark, jib);
      spinners.push({ obj: jib, speed: 0.05, axis: 'y' });
      // hałdy, kontenery biurowe, betoniarka
      box(8, 3, 6, x - 24, QUAY, z + 16, M.paintBlue, { base: true });
      box(8, 3, 6, x - 24, QUAY, z + 24, M.paintWhite, { base: true });
      cyl(4.5, 6, 3, x + 6, QUAY, z - 20, M.sand, { base: true, seg: 10 });
      landmarks.site = { building: new V3(x, QUAY + 14, z), craneTop: new V3(cx, top, cz), hook, jib };
    })();

    /* ============================================================
       11. LAS + POLANA (SAR) i mała wioska przy plaży
       ============================================================ */
    (function forest() {
      const trunks = [], crowns = [];
      for (let i = 0; i < 220; i++) {
        const x = rr(150, 330), z = rr(40, 150);
        if (Math.hypot(x - 240, z - 100) < 26) continue;           // polana (miejsce zdarzenia)
        const h = rr(9, 17), s = h / 13;
        trunks.push({ x, y: QUAY + h * 0.22, z, sx: s, sy: s, sz: s });
        crowns.push({ x, y: QUAY + h * 0.62, z, sx: s, sy: s, sz: s, ry: rr(0, 3) });
        colliders.push({ min: new V3(x - 1, QUAY, z - 1), max: new V3(x + 1, QUAY + h * 0.5, z + 1) });
      }
      instanced(new THREE.CylinderGeometry(0.3, 0.5, 5.7, 6), M.trunk, trunks);
      instanced(new THREE.ConeGeometry(3.4, 9, 8), M.leaf, crowns);
      // polana: rozbity quad + sygnalizacja (cel SAR)
      const t = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 1.8), M.paintRed);
      t.position.set(240, QUAY + 0.7, 100); t.rotation.set(0.3, 0.7, 0.2); t.castShadow = true; root.add(t);
      const flare = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), M.light);
      flare.position.set(242, QUAY + 1.2, 103); root.add(flare);
      landmarks.sar = { clearing: new V3(240, QUAY, 100), target: new V3(242, QUAY + 1, 103), searchBox: { min: new V3(150, 0, 40), max: new V3(330, 0, 150) } };
    })();

    (function village() {
      // domki letniskowe na mierzei (wszystkie na piasku, poziom BEACH_Y)
      for (let i = 0; i < 8; i++) {
        const x = -252 + i * 15 + rr(-4, 4), z = 132 + rr(-12, 30);
        const h = rr(4, 6.5);
        box(9, h, 8, x, BEACH_Y, z, M.paintWhite, { base: true });
        const roof = new THREE.Mesh(new THREE.ConeGeometry(7.4, 3.4, 4), M.hullRed);
        roof.rotation.y = Math.PI / 4; roof.position.set(x, BEACH_Y + h + 1.7, z); roof.castShadow = true; root.add(roof);
      }
      // wieża ratownika + parasole
      const tw = -190, tz = 230;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
        box(0.4, 6, 0.4, tw + sx * 2, BEACH_Y, tz + sz * 2, M.trunk, { base: true });
      box(6, 2.6, 6, tw, BEACH_Y + 6, tz, M.paintWhite, { base: true });
      box(0.15, 4, 0.15, tw, BEACH_Y + 8.6, tz, M.steelDark, { base: true, solid: false });
      box(2.2, 1.4, 0.1, tw + 1.1, BEACH_Y + 11.4, tz, M.paintRed, { solid: false });
      for (let i = 0; i < 8; i++) {
        const x = tw + rr(-60, 60), z = tz + rr(-45, 40);
        cyl(0.08, 0.08, 2.2, x, BEACH_Y, z, M.paintWhite, { base: true, solid: false, shadow: false });
        const um = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.8, 8), i % 2 ? M.paintRed : M.paintBlue);
        um.position.set(x, BEACH_Y + 2.3, z); root.add(um);
      }
      landmarks.beach = {
        tower: new V3(tw, BEACH_Y + 7.5, tz),
        dropZone: new V3(tw + 8, BEACH_Y, tz + 10),
        ground: BEACH_Y
      };
    })();

    /* ============================================================
       12. MORZE: farma offshore, latarnia, falochron, boje, wrak
       ============================================================ */
    landmarks.turbines = [];
    function turbine(x, z, hub, bladeR, offshore) {
      const g = new THREE.Group(); root.add(g);
      const base = offshore ? 0 : QUAY;
      if (offshore) cyl(5, 6.5, 12, x, base - 4, z, M.paintYellow, { base: true, seg: 14, solid: true, parent: g });
      cyl(2.2, 3.6, hub, x, base, z, M.paintWhite, { base: true, seg: 16, solid: true, parent: g });
      const nac = new THREE.Group(); nac.position.set(x, base + hub, z); g.add(nac);
      box(9, 3.2, 3.4, 0, 0, 0, M.paintWhite, { parent: nac, solid: false });
      const rotor = new THREE.Group(); rotor.position.set(-5.2, 0, 0); nac.add(rotor);
      cyl(1.5, 1.5, 1.6, 0, 0, 0, M.paintWhite, { rz: Math.PI / 2, seg: 12, parent: rotor });
      for (let b = 0; b < 3; b++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(0.8, bladeR, 2.6), M.paintWhite);
        bl.position.set(0, Math.cos(b * 2.094) * bladeR / 2, Math.sin(b * 2.094) * bladeR / 2);
        bl.rotation.x = b * 2.094;
        bl.castShadow = true;
        rotor.add(bl);
      }
      spinners.push({ obj: rotor, speed: 0.55 + rnd() * 0.25, axis: 'x' });
      // wirnik = strefa śmierci: dysk o promieniu bladeR w płaszczyźnie YZ
      zones.danger.push({
        center: new V3(x - 5.2, base + hub, z), normal: new V3(1, 0, 0), r: bladeR + 2, halfThick: 4,
        name: 'wirnik turbiny'
      });
      landmarks.turbines.push({
        pos: new V3(x, base, z), hub: new V3(x, base + hub, z), bladeR,
        towerMid: new V3(x, base + hub * 0.5, z), r: 3.6, rotor
      });
      return g;
    }
    turbine(-230, -120, 78, 38, true);
    turbine(-320, -10, 78, 38, true);
    turbine(-250, 90, 78, 38, true);
    turbine(-370, 130, 78, 38, true);
    turbine(300, -170, 62, 30, false);        // jedna na lądzie, przy silosach

    (function breakwaterAndLighthouse() {
      // falochron z narzutu + latarnia na końcu
      for (let i = 0; i < 22; i++) {
        const x = -110 - i * 9, z = -60 - Math.sin(i * 0.22) * 8;
        box(11, 7, 9, x, -1.5, z, M.concreteDark, { base: true, shadow: true });
      }
      const lx = -305, lz = -76;
      cyl(3.4, 4.6, 26, lx, 3, lz, M.paintWhite, { base: true, seg: 16, solid: true });
      for (let i = 0; i < 3; i++) cyl(3.5 - i * 0.05, 3.5 - i * 0.05, 3, lx, 8 + i * 8, lz, M.paintRed, { seg: 16 });
      cyl(3.9, 3.9, 3, lx, 29, lz, M.glass, { base: true, seg: 16 });
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.4, 60, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      beam.rotation.z = Math.PI / 2; beam.position.set(lx, 30.5, lz);
      const beamPivot = new THREE.Group(); beamPivot.position.set(lx, 30.5, lz);
      beam.position.set(30, 0, 0); beamPivot.add(beam); root.add(beamPivot);
      spinners.push({ obj: beamPivot, speed: 0.6, axis: 'y' });
      cyl(3.2, 3.2, 1, lx, 33, lz, M.steelDark, { seg: 16 });
      landmarks.lighthouse = { pos: new V3(lx, 0, lz), top: new V3(lx, 30, lz), r: 4.6 };
    })();

    (function buoysAndWreck() {
      // boje toru wodnego — naturalny slalom od morza do kanału
      const list = [], colors = [];
      for (let i = 0; i < 12; i++) {
        const x = -420 + i * 28, z = (i % 2 ? -1 : 1) * 26 + Math.sin(i * 0.6) * 10;
        list.push({ x, y: 1.2, z });
        colors.push(new THREE.Color(i % 2 ? 0xc0392b : 0x2e7d4f));
        colliders.push({ min: new V3(x - 1.4, 0, z - 1.4), max: new V3(x + 1.4, 3.4, z + 1.4) });
      }
      instanced(new THREE.CylinderGeometry(1.1, 1.5, 4.4, 8), M.paintWhite, list, colors);
      landmarks.channelBuoys = list.map(b => new V3(b.x, 2, b.z));

      // wrak wyrzucony na mieliznę przy mierzei (inspekcja / dokumentacja)
      const w = new THREE.Group(); root.add(w);
      box(46, 8, 12, -302, 1.2, 250, M.rust, { parent: w, rz: 0.22, ry: 0.5 });
      box(10, 9, 8, -288, 6, 246, M.rust, { parent: w, ry: 0.5, solid: false });
      landmarks.wreck = new V3(-302, 3, 250);
    })();

    /* ============================================================
       13. MEWY (ruchome tło, bez kolizji) + wieżowce w tle miasta
       ============================================================ */
    (function seagullsAndSkyline() {
      const birds = new THREE.Group(); root.add(birds);
      const gs = [];
      for (let i = 0; i < 14; i++) {
        const b = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 4), M.paintWhite);
        b.rotation.z = Math.PI / 2;
        b.position.set(rr(-260, 120), rr(14, 44), rr(-160, 160));
        birds.add(b);
        gs.push({ m: b, r: rr(24, 70), a: rr(0, 6.28), s: rr(0.15, 0.4), cx: b.position.x, cz: b.position.z });
      }
      spinners.push({ custom: (dt, t) => {
        for (const g of gs) {
          g.a += g.s * dt;
          g.m.position.set(g.cx + Math.cos(g.a) * g.r, g.m.position.y + Math.sin(t + g.a) * 0.02, g.cz + Math.sin(g.a) * g.r);
          g.m.rotation.y = -g.a;
        }
      }});
      // sylwetka miasta na horyzoncie (bez kolizji, tanio) — tylko tam, gdzie jest ląd
      let placed = 0, guard = 0;
      while (placed < 70 && guard++ < 600) {
        const a = rr(-1.2, 2.6), r = rr(420, 780);
        const x = 120 + Math.cos(a) * r, z = 60 + Math.sin(a) * r;
        if (x < SEA_X + 40 || x > SEA_X + 880 || Math.abs(z) < CH + 30) continue;   // nie na wodzie
        const h = rr(20, 90), w = rr(16, 38);
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), placed % 3 ? M.concreteDark : M.concrete);
        m.position.set(x, QUAY + h / 2, z);
        root.add(m);
        placed++;
      }
    })();

    /* ============================================================
       API
       ============================================================ */
    let time = 0;
    /* update(dt, eyePos) — eyePos (kamera/dron) tylko do wygaszania fal; opcjonalny */
    function update(dt, eyePos) {
      time += dt;
      water.material.uniforms.t.value = time;
      if (eyePos) {
        water.material.uniforms.eye.value.copy(eyePos);
        water.position.set(eyePos.x, 0, eyePos.z);      // woda jedzie z kamerą, brak widocznych krawędzi
      }
      for (const s of spinners) {
        if (s.custom) { s.custom(dt, time); continue; }
        if (s.axis === 'x') s.obj.rotation.x += s.speed * dt;
        else if (s.axis === 'y') s.obj.rotation.y += s.speed * dt;
        else s.obj.rotation.z += s.speed * dt;
      }
    }

    /* surfaceAt(x,z) — co jest pod dronem: wysokość powierzchni i czy to woda.
       Pionowe ściany nabrzeża obsługują zwykłe collidery AABB; to jest „podłoga". */
    function surfaceAt(x, z) {
      if (x >= -280 && x <= SEA_X && z >= 110 && z <= 300) return { y: BEACH_Y, water: false }; // mierzeja
      if (x < SEA_X) return { y: 0, water: true };                                              // morze
      if (Math.abs(z) < CH && x <= CH_END) return { y: 0, water: true };                        // kanał
      return { y: QUAY, water: false };                                                         // nabrzeże / ląd
    }

    return {
      root, water, colliders, landmarks, zones, update, surfaceAt,
      heightAt: (x, z) => surfaceAt(x, z).y,
      name: 'PORT MEWI',
      quayLevel: QUAY,
      spawn: { pos: landmarks.pad.clone(), heading: Math.PI * 0.5 },
      /* punkty do szybkiego podglądu w viewerze (i późniejszych misji) */
      pois: [
        ['Baza / płyta startowa', landmarks.pad, 30],
        ['Suwnice STS', landmarks.cranes[0].pos, 90],
        ['Kontenerowy yard', landmarks.yard.center, 70],
        ['Statek przy nabrzeżu', landmarks.ship.mid, 80],
        ['Silosy + galeria', landmarks.silos, 80],
        ['Hala (brama, brak GPS)', landmarks.hall.door, 45],
        ['Komin 74 m', landmarks.stack.platform, 60],
        ['Most nad kanałem', landmarks.bridge.under[1], 70],
        ['Linia WN', landmarks.powerline.pylons[1], 90],
        ['Farma PV', landmarks.solar.faulty, 70],
        ['Budowa + żuraw', landmarks.site.craneTop, 90],
        ['Las / polana SAR', landmarks.sar.target, 60],
        ['Plaża + wieża ratownika', landmarks.beach.tower, 60],
        ['Farma offshore', landmarks.turbines[0].hub, 110],
        ['Latarnia + falochron', landmarks.lighthouse.top, 70],
        ['Wrak', landmarks.wreck, 50]
      ]
    };
  }

  return { create };
})();
