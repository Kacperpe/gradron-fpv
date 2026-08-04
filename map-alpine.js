/* ============================================================
   MAPA 3 — "DOLINA WILCZA" (górska dolina, misje ratunkowe)
   Tylko geometria + punkty misyjne. Bez fizyki i bez logiki misji.

   API identyczne jak w map-port.js:
     const map = AlpineMap.create(THREE, scene, renderer);
     map.update(dt, eyePos); map.colliders; map.landmarks; map.zones; map.spawn; map.pois;
     map.heightAt(x, z)   — wysokość terenu (dolina jest górzysta, więc to potrzebne)

   UKŁAD (metry): dolina biegnie wzdłuż osi X. Rzeka i droga na dnie (y ~ 40),
   zbocza w górę na ±Z, zapora zamyka dolinę na wschodzie (x ~ +260) i trzyma zbiornik.
   ============================================================ */
var AlpineMap = (function () {
  'use strict';

  function create(THREE, scene, renderer) {
    const V3 = THREE.Vector3;
    const colliders = [];
    const landmarks = {};
    const zones = { gpsDenied: [], danger: [], noFly: [] };
    const spinners = [];
    const root = new THREE.Group();
    scene.add(root);

    let seed = 424242;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const rr = (a, b) => a + (b - a) * rnd();
    const aniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;

    const VALLEY_Y = 40;          // dno doliny
    const LAKE_Y = 96;            // poziom zbiornika za zaporą
    const DAM_X = 250;            // gdzie stoi zapora

    /* ---------- ukształtowanie terenu ----------
       Dolina wzdłuż X: dno płaskie w pasie |z| < 60, potem strome zbocza,
       za zaporą (x > DAM_X) terén jest wyżej i zalany do LAKE_Y.            */
    function ridge(x) {                       // linia dna doliny — łagodnie się podnosi
      return VALLEY_Y + Math.max(0, (x + 300) * 0.035) + Math.sin(x * 0.004) * 6;
    }
    function riverZ(x) { return Math.sin(x * 0.006) * 26; }      // meandry rzeki
    function heightAt(x, z) {
      const az = Math.abs(z);
      let h = ridge(x);
      if (az <= 55) {
        const dr = Math.abs(z - riverZ(x));
        if (dr < 16) h -= (1 - dr / 16) * 3.6;                  // wcięte koryto rzeki
      }
      if (az > 55) {
        const t = (az - 55) / 150;
        h += Math.pow(Math.min(t, 1), 1.35) * 210;            // zbocza
        h += Math.sin(x * 0.012 + z * 0.004) * 14 * Math.min(t * 2, 1);   // grzbiety i żebra
        if (az > 205) h += (az - 205) * 1.15;                 // ściany szczytowe
      } else {
        h += Math.sin(x * 0.02) * 1.5 + Math.cos(z * 0.05) * 0.8;
      }
      // Uwaga: terenu za zaporą NIE podnosimy — dno doliny (≈60–75 m) jest naturalnie
      // niżej niż poziom zbiornika (96 m), więc woda zalewa je sama i daje poprawną linię brzegową.
      return h;
    }
    landmarks.valleyY = VALLEY_Y;
    landmarks.lakeY = LAKE_Y;

    /* siatka terenu */
    const SIZE = 1400, SEG = 190;
    const terrGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    terrGeo.rotateX(-Math.PI / 2);
    {
      const p = terrGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) + 100, z = p.getZ(i);
        p.setY(i, heightAt(x, z));
        p.setX(i, x);
      }
      terrGeo.computeVertexNormals();
    }
    function terrainTex() {
      const s = 1024, c = document.createElement('canvas'); c.width = c.height = s;
      const g = c.getContext('2d');
      g.fillStyle = '#4e5c3a'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 24000; i++) {
        const v = Math.random();
        g.fillStyle = v > 0.6 ? 'rgba(110,120,92,.16)' : 'rgba(30,42,26,.16)';
        g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 6, 2 + Math.random() * 6);
      }
      for (let i = 0; i < 40; i++) {                      // wysypy skalne
        g.fillStyle = 'rgba(120,116,108,' + (0.08 + Math.random() * 0.22).toFixed(2) + ')';
        g.beginPath();
        g.ellipse(Math.random() * s, Math.random() * s, 30 + Math.random() * 140, 20 + Math.random() * 90,
          Math.random() * 3.14, 0, 6.283); g.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60);
      t.anisotropy = aniso; t.encoding = THREE.sRGBEncoding;
      return t;
    }
    /* kolor zależny od wysokości i nachylenia: trawa → skała → śnieg */
    const terrMat = new THREE.MeshStandardMaterial({ map: terrainTex(), roughness: 1 });
    terrMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying float vH; varying float vSlope;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vH = position.y; vSlope = 1.0 - normal.y;');
      sh.fragmentShader = 'varying float vH; varying float vSlope;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 grass = vec3(0.30,0.36,0.22);
          vec3 rock  = vec3(0.42,0.41,0.39);
          vec3 snow  = vec3(0.92,0.94,0.97);
          float rockF = smoothstep(0.28, 0.55, vSlope) + smoothstep(150.0, 230.0, vH)*0.6;
          float snowF = smoothstep(215.0, 275.0, vH) * (1.0 - smoothstep(0.55, 0.8, vSlope));
          vec3 tint = mix(grass, rock, clamp(rockF,0.0,1.0));
          tint = mix(tint, snow, clamp(snowF,0.0,1.0));
          diffuseColor.rgb *= tint * 2.1;`);
    };
    const terrain = new THREE.Mesh(terrGeo, terrMat);
    terrain.receiveShadow = true;
    root.add(terrain);

    /* ---------- helpery (te same konwencje co w map-port.js) ---------- */
    const detailLoader = new THREE.TextureLoader();
    const stoneDetail = detailLoader.load('assets/textures/weathered-concrete.jpg');
    stoneDetail.wrapS = stoneDetail.wrapT = THREE.RepeatWrapping;
    stoneDetail.repeat.set(2, 2); stoneDetail.anisotropy = aniso;
    stoneDetail.encoding = THREE.sRGBEncoding;
    const M = {
      concrete: new THREE.MeshStandardMaterial({ map: stoneDetail, color: 0xb0b0aa, roughness: 0.95 }),
      concreteDark: new THREE.MeshStandardMaterial({ map: stoneDetail, color: 0x767b76, roughness: 0.95 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x8b9299, roughness: 0.55, metalness: 0.6 }),
      steelDark: new THREE.MeshStandardMaterial({ color: 0x474d52, roughness: 0.6, metalness: 0.5 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 }),
      woodDark: new THREE.MeshStandardMaterial({ color: 0x4a331f, roughness: 0.95 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x53382a, roughness: 0.9 }),
      red: new THREE.MeshStandardMaterial({ color: 0xb8392a, roughness: 0.8 }),
      white: new THREE.MeshStandardMaterial({ color: 0xdad7ce, roughness: 0.8 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xdcae3a, roughness: 0.8 }),
      asphalt: new THREE.MeshStandardMaterial({ color: 0x3c4043, roughness: 0.98 }),
      rock: new THREE.MeshStandardMaterial({ map: stoneDetail, color: 0x77736c, roughness: 1 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x40301f, roughness: 1 }),
      pine: new THREE.MeshStandardMaterial({ color: 0x24401f, roughness: 1 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x1a2830, roughness: 0.2, metalness: 0.6 }),
      light: new THREE.MeshBasicMaterial({ color: 0xfff3c4 })
    };
    function addCollider(mesh) {
      mesh.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(mesh);
      colliders.push({ min: bb.min, max: bb.max });
      return mesh;
    }
    function box(w, h, d, x, y, z, mat, opts) {
      const o = opts || {};
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || M.concrete);
      m.position.set(x, o.base ? y + h / 2 : y, z);
      if (o.rx) m.rotation.x = o.rx;
      if (o.ry) m.rotation.y = o.ry;
      if (o.rz) m.rotation.z = o.rz;
      m.castShadow = o.shadow !== false; m.receiveShadow = o.shadow !== false;
      (o.parent || root).add(m);
      if (o.solid !== false) addCollider(m);
      return m;
    }
    function cyl(rt, rb, h, x, y, z, mat, opts) {
      const o = opts || {};
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, o.seg || 12), mat || M.steel);
      m.position.set(x, o.base ? y + h / 2 : y, z);
      if (o.rx) m.rotation.x = o.rx;
      if (o.rz) m.rotation.z = o.rz;
      m.castShadow = o.shadow !== false; m.receiveShadow = o.shadow !== false;
      (o.parent || root).add(m);
      if (o.solid) addCollider(m);
      return m;
    }
    function tube(a, b, r, mat, parent) {
      const dir = new V3().subVectors(b, a), len = dir.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat || M.steelDark);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
      (parent || root).add(m);
      return m;
    }
    function instanced(geo, mat, list) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      list.forEach((t, i) => {
        e.set(t.rx || 0, t.ry || 0, t.rz || 0); q.setFromEuler(e);
        mx.compose(new V3(t.x, t.y, t.z), q, new V3(t.s || 1, t.sy || t.s || 1, t.s || 1));
        im.setMatrixAt(i, mx);
      });
      im.castShadow = true; im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      root.add(im);
      return im;
    }

    /* ============================================================
       WODA: rzeka na dnie doliny + zbiornik za zaporą
       ============================================================ */
    const waterMat = (level, col) => new THREE.ShaderMaterial({
      uniforms: {
        t: { value: 0 }, eye: { value: new V3() },
        base: { value: new THREE.Color(col) }, fogCol: { value: new THREE.Color(0xb9ccd8) }
      },
      vertexShader: `varying vec3 vW; void main(){ vW = (modelMatrix*vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
      fragmentShader: `uniform float t; uniform vec3 eye, base, fogCol; varying vec3 vW;
        float w(vec2 p){ return sin(p.x*0.22+t*1.6)*0.5 + sin(p.y*0.3-t*1.2)*0.5; }
        void main(){
          float d = length(vW-eye);
          float fade = 1.0 - clamp((d-70.0)/260.0, 0.0, 1.0);
          float h = w(vW.xz), hx = w(vW.xz+vec2(0.7,0.0))-h, hy = w(vW.xz+vec2(0.0,0.7))-h;
          vec3 n = normalize(mix(vec3(0.0,1.0,0.0), vec3(-hx,1.0,-hy), fade));
          float spec = pow(max(dot(reflect(vec3(0.0,-1.0,0.0), n), normalize(vec3(-0.4,0.7,0.6))),0.0), 26.0);
          vec3 c = base*(0.85+0.3*(h*0.5+0.5)) + vec3(1.0)*spec*0.5*fade;
          c = mix(c, fogCol, clamp((d-260.0)/900.0, 0.0, 0.8));
          gl_FragColor = vec4(c,1.0); }`
    });

    /* rzeka: wąski pas wzdłuż dna doliny, podąża za profilem ridge() */
    (function river() {
      const w = 14, segs = 60, x0 = -560, x1 = DAM_X - 6;
      const geo = new THREE.PlaneGeometry(x1 - x0, w, segs, 1);
      geo.rotateX(-Math.PI / 2);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) + (x0 + x1) / 2;
        p.setX(i, x);
        p.setY(i, ridge(x) - 1.5);                               // tafla poniżej brzegów, nad dnem
        p.setZ(i, p.getZ(i) + riverZ(x));
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, waterMat(0, 0x2a4a52));
      root.add(m);
      landmarks.river = { at: x => new V3(x, ridge(x) - 1.4, riverZ(x)) };
      spinners.push({ water: m });
    })();

    /* zbiornik za zaporą */
    (function lake() {
      // tafla zaczyna się dokładnie za koroną zapory; brzeg powstaje z przecięcia z terenem
      const m = new THREE.Mesh(new THREE.PlaneGeometry(760, 760), waterMat(LAKE_Y, 0x1d3a48));
      m.rotation.x = -Math.PI / 2;
      m.position.set(DAM_X + 392, LAKE_Y, 0);
      root.add(m);
      spinners.push({ water: m });
      landmarks.lake = new V3(DAM_X + 130, LAKE_Y, 0);
    })();

    /* ============================================================
       ZAPORA (inspekcja korony, ściany odpowietrznej, przelewów)
       ============================================================ */
    (function dam() {
      const g = new THREE.Group(); root.add(g);
      const h = LAKE_Y + 12 - VALLEY_Y + 24, y0 = VALLEY_Y - 20;
      // łukowy korpus z segmentów (od zbocza do zbocza)
      const segs = 15, halfW = 120;
      for (let i = 0; i < segs; i++) {
        const t = (i + 0.5) / segs, z = -halfW + t * halfW * 2;
        const bow = Math.cos((t - 0.5) * Math.PI) * 16;      // wybrzuszenie łuku w stronę wody
        const seg = box(14 + bow * 0.25, h, halfW * 2 / segs + 1.5, DAM_X + bow, y0, z, M.concrete,
          { base: true, parent: g });
      }
      // korona z barierkami + latarnie
      box(16, 1.2, halfW * 2 + 6, DAM_X, y0 + h + 0.6, 0, M.concreteDark, { parent: g });
      for (let i = -1; i <= 1; i += 2)
        for (let k = 0; k <= 16; k++)
          box(0.3, 1.3, 0.3, DAM_X + i * 7.4, y0 + h + 1.9, -halfW + k * (halfW * 2 / 16), M.steelDark,
            { parent: g, solid: false, shadow: false });
      for (let k = 0; k <= 8; k++)
        cyl(0.2, 0.2, 5, DAM_X - 6, y0 + h + 4, -halfW + k * (halfW / 4), M.steelDark, { parent: g });
      // przelewy i wypływ
      for (let i = -1; i <= 1; i++)
        box(9, 6, 16, DAM_X - 4, y0 + h - 8, i * 34, M.concreteDark, { parent: g, solid: false });
      box(20, 8, 26, DAM_X - 16, VALLEY_Y - 2, 0, M.concreteDark, { base: true, parent: g });
      // budynek elektrowni u podnóża
      box(26, 12, 18, DAM_X - 52, ridge(DAM_X - 52), -34, M.white, { base: true, parent: g });
      box(24, 3, 16, DAM_X - 52, ridge(DAM_X - 52) + 13, -34, M.glass, { parent: g });
      // rurociąg zrzutowy
      tube(new V3(DAM_X - 8, y0 + h - 26, 52), new V3(DAM_X - 52, ridge(DAM_X - 52) + 6, 52), 2.2, M.steel, g);
      landmarks.dam = {
        crest: new V3(DAM_X, y0 + h + 2, 0),
        crestEnds: [new V3(DAM_X, y0 + h + 2, -halfW), new V3(DAM_X, y0 + h + 2, halfW)],
        face: new V3(DAM_X - 26, y0 + h * 0.55, 0),         // punkt przed ścianą odpowietrzną
        spillways: [-34, 0, 34].map(z => new V3(DAM_X - 12, y0 + h - 6, z)),
        powerhouse: new V3(DAM_X - 52, ridge(DAM_X - 52) + 12, -34),
        height: h
      };
    })();

    /* ============================================================
       WYCIĄG KRZESEŁKOWY (podpory na zboczu — inspekcja i slalom)
       ============================================================ */
    (function chairlift() {
      const g = new THREE.Group(); root.add(g);
      const pts = [];
      for (let i = 0; i <= 7; i++) {
        const t = i / 7;
        const x = -180 + t * 40;
        const z = -40 - t * 190;                    // w górę północnego zbocza
        const yTerr = heightAt(x, z);
        const top = yTerr + (i === 0 || i === 7 ? 10 : 16);
        pts.push(new V3(x, top, z));
        // podpora kratowa
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
          tube(new V3(x + sx * 1.6, yTerr, z + sz * 1.6), new V3(x + sx * 0.7, top, z + sz * 0.7), 0.22, M.steelDark, g);
        for (let r = 1; r < 4; r++) {
          const y = yTerr + (top - yTerr) * r / 4;
          box(3.4, 0.25, 3.4, x, y, z, M.steelDark, { parent: g, solid: false, shadow: false });
        }
        box(7, 0.6, 1.2, x, top, z, M.steelDark, { parent: g });      // jarzmo z krążkami
        colliders.push({ min: new V3(x - 2, yTerr, z - 2), max: new V3(x + 2, top, z + 2) });
      }
      // lina + krzesełka
      for (let i = 0; i < pts.length - 1; i++) {
        for (const off of [-2.6, 2.6]) {
          const a = pts[i].clone(), b = pts[i + 1].clone();
          a.x += off; b.x += off;
          a.y -= 0.4; b.y -= 0.4;
          tube(a, b, 0.09, M.steelDark, g);
        }
      }
      for (let i = 0; i < 16; i++) {
        const t = i / 16;
        const seg = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
        const f = t * (pts.length - 1) - seg;
        const p = pts[seg].clone().lerp(pts[seg + 1], f);
        const side = i % 2 ? 2.6 : -2.6;
        box(1.8, 0.3, 1.2, p.x + side, p.y - 3.2, p.z, M.red, { parent: g, solid: false });
        tube(new V3(p.x + side, p.y - 0.5, p.z), new V3(p.x + side, p.y - 3.2, p.z), 0.07, M.steelDark, g);
      }
      // stacje dolna i górna
      const bot = pts[0], topSt = pts[pts.length - 1];
      box(18, 8, 12, bot.x, heightAt(bot.x, bot.z), bot.z, M.white, { base: true, parent: g });
      box(16, 7, 12, topSt.x, heightAt(topSt.x, topSt.z), topSt.z, M.white, { base: true, parent: g });
      landmarks.lift = { pylons: pts, bottom: bot.clone(), top: topSt.clone() };
    })();

    /* ============================================================
       SCHRONISKO + LĄDOWISKO + DROGA SERPENTYNAMI
       ============================================================ */
    (function hut() {
      const x = 40, z = -150, y = heightAt(x, z);
      const g = new THREE.Group(); root.add(g);
      box(22, 8, 14, x, y, z, M.wood, { base: true, parent: g });
      const roof = new THREE.Mesh(new THREE.ConeGeometry(17, 7, 4), M.roof);
      roof.rotation.y = Math.PI / 4; roof.position.set(x, y + 11.5, z); roof.castShadow = true; g.add(roof);
      box(6, 3, 4, x - 14, y, z + 4, M.woodDark, { base: true, parent: g });      // dobudówka
      cyl(0.6, 0.6, 4, x + 6, y + 12, z, M.concreteDark, { base: true, parent: g });
      // taras z parasolami
      box(24, 0.4, 8, x, y + 0.2, z + 11, M.wood, { parent: g, solid: false });
      for (let i = 0; i < 4; i++) {
        cyl(0.08, 0.08, 2.4, x - 9 + i * 6, y + 0.4, z + 11, M.white, { base: true, parent: g, solid: false, shadow: false });
        const um = new THREE.Mesh(new THREE.ConeGeometry(2, 0.7, 8), i % 2 ? M.red : M.yellow);
        um.position.set(x - 9 + i * 6, y + 3.1, z + 11); g.add(um);
      }
      // lądowisko H obok schroniska (cel dostaw)
      const hx = x + 34, hz = z + 6, hy = heightAt(hx, hz);
      const padM = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.3, 26), M.asphalt);
      padM.position.set(hx, hy + 0.15, hz); padM.receiveShadow = true; g.add(padM);
      box(2, 0.08, 8, hx, hy + 0.32, hz, M.white, { parent: g, solid: false, shadow: false });
      box(6, 0.08, 1.6, hx, hy + 0.32, hz, M.white, { parent: g, solid: false, shadow: false });
      landmarks.hut = { pos: new V3(x, y + 8, z), helipad: new V3(hx, hy + 0.4, hz), terrace: new V3(x, y + 3, z + 11) };
    })();

    (function road() {
      // droga dnem doliny + serpentyny do schroniska (nawigacja wzdłuż korytarza)
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const x = -560 + i * 20, z = riverZ(x) + 28;
        pts.push(new V3(x, heightAt(x, z) + 0.35, z));      // droga leży na terenie, nie w powietrzu
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = a.distanceTo(b);
        const m = new THREE.Mesh(new THREE.BoxGeometry(len + 1, 0.3, 7), M.asphalt);
        m.position.copy(a).lerp(b, 0.5);
        m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        m.receiveShadow = true; root.add(m);
      }
      // serpentyny: 5 zakrętów w górę zbocza do schroniska
      const sw = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        const x = 10 + t * 30, z = 20 - t * 170;
        sw.push(new V3(x, heightAt(x, z) + 0.4, z));
      }
      for (let i = 0; i < sw.length - 1; i++) {
        const a = sw[i], b = sw[i + 1], len = a.distanceTo(b);
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 6), M.asphalt);
        m.position.copy(a).lerp(b, 0.5);
        m.lookAt(b);
        m.rotateY(Math.PI / 2);
        m.receiveShadow = true; root.add(m);
      }
      landmarks.road = { valley: pts, switchbacks: sw };
      // dwa samochody na drodze (punkty odniesienia / cel dokumentacji)
      for (const [i, col] of [[8, M.red], [26, M.white]]) {
        const p = pts[i];
        box(4.4, 1.5, 1.9, p.x, p.y + 0.9, p.z, col, { solid: false });
      }
    })();

    /* ============================================================
       LAS, GŁAZY, URWISKA, MIEJSCE ZDARZENIA (SAR)
       ============================================================ */
    (function forest() {
      const trunks = [], crowns = [];
      for (let i = 0; i < 3200; i++) {
        const x = rr(-560, DAM_X - 20), z = rr(-330, 330);
        const y = heightAt(x, z);
        const az = Math.abs(z);
        if (y > 235 || az < 22) continue;                        // nie na szczytach ani w rzece
        if (Math.hypot(x - 40, z + 150) < 60) continue;          // nie na schronisku
        if (Math.hypot(x - (-120), z - 210) < 40) continue;      // polana z wrakiem (SAR)
        const s = rr(0.7, 1.5);
        trunks.push({ x, y: y + 4 * s, z, s });
        crowns.push({ x, y: y + 13 * s, z, s, ry: rr(0, 3) });
        if (i % 3 === 0) colliders.push({ min: new V3(x - 1, y, z - 1), max: new V3(x + 1, y + 9 * s, z + 1) });
      }
      instanced(new THREE.CylinderGeometry(0.35, 0.6, 8, 6), M.trunk, trunks);
      instanced(new THREE.ConeGeometry(3.2, 18, 8), M.pine, crowns);

      // głazy: rzadko i w ludzkiej skali (1–5 m), skupione na zboczach i w rzece
      const rocks = [];
      for (let i = 0; i < 420; i++) {
        const x = rr(-560, DAM_X), z = rr(-340, 340);
        const az = Math.abs(z);
        if (az > 40 && az < 90) continue;                 // pas leśny bez głazowisk
        const y = heightAt(x, z);
        const s = rr(0.5, 1.8);
        rocks.push({ x, y: y + s * 0.5, z, s, ry: rr(0, 3), rx: rr(0, 1) });
        if (s > 1.4) colliders.push({
          min: new V3(x - s * 1.6, y, z - s * 1.6), max: new V3(x + s * 1.6, y + s * 2, z + s * 1.6)
        });
      }
      instanced(new THREE.DodecahedronGeometry(1.6, 0), M.rock, rocks);

      // MIEJSCE ZDARZENIA: rozbity paralotniarz na polanie wysoko na zboczu
      const sx = -120, sz = 210, sy = heightAt(sx, sz);
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(7, 14, 8, 0, 6.28, 0, 1.1),
        new THREE.MeshStandardMaterial({ color: 0xd83b3b, roughness: 0.9, side: THREE.DoubleSide }));
      canopy.position.set(sx, sy + 2.5, sz); canopy.rotation.z = 0.5; root.add(canopy);
      const person = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.4, 1.2, 4, 8) : new THREE.CylinderGeometry(0.4, 0.4, 1.8, 8),
        new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.8 }));
      person.rotation.z = Math.PI / 2;
      person.position.set(sx + 6, sy + 0.6, sz + 3); root.add(person);
      const flare = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), M.light);
      flare.position.set(sx + 8, sy + 1.2, sz + 5); root.add(flare);
      landmarks.sar = {
        target: new V3(sx + 6, sy + 1, sz + 3),
        clearing: new V3(sx, sy, sz),
        searchBox: { min: new V3(-260, 0, 120), max: new V3(20, 0, 320) }
      };

      // OKAP SKALNY: płyta wsparta na filarach, wciśnięta w zbocze — lot pod skałą bez GPS
      const cx = -300, cz = -150, cy = heightAt(cx, cz);
      const slab = box(54, 9, 34, cx - 6, cy + 17, cz - 6, M.rock, { rx: -0.07, ry: 0.25 });
      box(30, 16, 22, cx - 22, cy + 4, cz - 14, M.rock, { base: true, ry: 0.25 });   // masyw z tyłu
      for (const [ox, oz] of [[18, 12], [14, -12]])                                   // filary skalne
        cyl(3.2, 5, 14, cx + ox, cy, cz + oz, M.rock, { base: true, solid: true, seg: 7 });
      for (let i = 0; i < 7; i++) {                                                   // gruz pod okapem
        const s = rr(0.8, 2.2);
        box(s * 2, s, s * 1.6, cx + rr(-16, 18), cy + s / 2, cz + rr(-12, 12), M.rock,
          { ry: rr(0, 3), solid: false });
      }
      zones.gpsDenied.push({
        min: new V3(cx - 26, cy, cz - 18), max: new V3(cx + 22, cy + 13, cz + 12), name: 'okap skalny'
      });
      landmarks.overhang = new V3(cx + 4, cy + 5, cz);
    })();

    /* ============================================================
       LINIA ŚREDNIEGO NAPIĘCIA DO SCHRONISKA + MASZT PRZEKAŹNIKOWY
       ============================================================ */
    (function power() {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, x = -20 + t * 62, z = 30 - t * 175;
        const y = heightAt(x, z);
        pts.push(new V3(x, y + 12, z));
        cyl(0.28, 0.4, 12, x, y, z, M.woodDark, { base: true, solid: true, seg: 6 });
        box(3.4, 0.3, 0.3, x, y + 11.4, z, M.woodDark, { solid: false });
      }
      for (let i = 0; i < pts.length - 1; i++)
        for (const off of [-1.5, 0, 1.5]) {
          const a = pts[i].clone(), b = pts[i + 1].clone();
          a.z += off; b.z += off; a.y -= 0.6; b.y -= 0.6;
          tube(a, b, 0.07, M.steelDark);
        }
      landmarks.mvLine = pts;

      // maszt przekaźnikowy na grzbiecie (orbita + inspekcja anten)
      const mx = 140, mz = -240, my = heightAt(mx, mz);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        tube(new V3(mx + sx * 2.4, my, mz + sz * 2.4), new V3(mx + sx * 0.6, my + 42, mz + sz * 0.6), 0.24, M.steelDark);
      for (let r = 1; r < 8; r++)
        box(4.4, 0.2, 4.4, mx, my + r * 5.2, mz, M.steelDark, { solid: false, shadow: false });
      for (let i = 0; i < 3; i++) {
        const a = i * 2.09;
        box(0.5, 3.2, 1.6, mx + Math.cos(a) * 2.6, my + 34, mz + Math.sin(a) * 2.6, M.white, { solid: false });
      }
      const dish = cyl(2.4, 2.4, 0.5, mx, my + 26, mz, M.white, { rx: Math.PI / 2.2, seg: 18 });
      cyl(0.4, 0.4, 44, mx, my, mz, M.red, { base: true, solid: true, seg: 8 });
      colliders.push({ min: new V3(mx - 3, my, mz - 3), max: new V3(mx + 3, my + 44, mz + 3) });
      zones.noFly.push({ center: new V3(mx, my + 34, mz), r: 8, name: 'sektor antenowy (RF)' });
      landmarks.relay = { base: new V3(mx, my, mz), top: new V3(mx, my + 44, mz), dish: new V3(mx, my + 26, mz) };
    })();

    /* ============================================================
       BAZA RATUNKOWA (start) NA DNIE DOLINY
       ============================================================ */
    (function base() {
      const x = -260, z = 30, y = heightAt(x, z);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 0.25, 26), M.asphalt);
      pad.position.set(x, y + 0.12, z); pad.receiveShadow = true; root.add(pad);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.16, 6, 40), M.yellow);
      ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.3, z); root.add(ring);
      box(7, 3, 2.6, x + 16, y, z + 8, M.red, { base: true });            // ambulans
      box(5, 2.6, 4, x + 16, y, z - 6, M.white, { base: true });          // namiot sztabu
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        tube(new V3(x + 24 + sx, y, z + sz), new V3(x + 24 + sx * 0.4, y + 16, z + sz * 0.4), 0.16, M.steelDark);
      landmarks.pad = new V3(x, y + 0.4, z);
      landmarks.baseGround = y;
    })();

    /* ============================================================
       WIATR / CHMURY / PTAKI (tło)
       ============================================================ */
    (function sceneryMotion() {
      // chmury wysoko nad pułapem lotu (niżej wyglądały jak białe wielokąty na drodze kamery)
      const clouds = new THREE.Group(); root.add(clouds);
      const cl = [];
      for (let i = 0; i < 11; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(rr(30, 70), 16, 10),
          new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 1, transparent: true, opacity: 0.5 }));
        m.scale.y = 0.3;
        m.position.set(rr(-500, 300), rr(430, 540), rr(-320, 320));
        clouds.add(m); cl.push(m);
      }
      const birds = [];
      for (let i = 0; i < 8; i++) {
        const b = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.8, 4), M.white);
        b.rotation.z = Math.PI / 2;
        b.position.set(rr(-300, 100), rr(150, 240), rr(-200, 200));
        root.add(b);
        birds.push({ m: b, r: rr(30, 90), a: rr(0, 6.28), s: rr(0.1, 0.3), cx: b.position.x, cz: b.position.z });
      }
      spinners.push({ custom: (dt, t) => {
        for (const c of cl) { c.position.x += dt * 1.6; if (c.position.x > 340) c.position.x = -540; }
        for (const b of birds) {
          b.a += b.s * dt;
          b.m.position.set(b.cx + Math.cos(b.a) * b.r, b.m.position.y, b.cz + Math.sin(b.a) * b.r);
          b.m.rotation.y = -b.a;
        }
      }});
    })();

    /* ============================================================
       API
       ============================================================ */
    let time = 0;
    function update(dt, eyePos) {
      time += dt;
      for (const s of spinners) {
        if (s.water) {
          s.water.material.uniforms.t.value = time;
          if (eyePos) s.water.material.uniforms.eye.value.copy(eyePos);
          continue;
        }
        if (s.custom) { s.custom(dt, time); continue; }
        if (s.axis === 'y') s.obj.rotation.y += s.speed * dt;
      }
    }

    /* surfaceAt(x,z) — powierzchnia pod dronem: teren, tafla zbiornika albo rzeka */
    function surfaceAt(x, z) {
      const t = heightAt(x, z);
      if (x > DAM_X + 8 && t < LAKE_Y) return { y: LAKE_Y, water: true };          // zbiornik
      if (x < DAM_X - 6 && Math.abs(z - riverZ(x)) < 7) return { y: ridge(x) - 1.4, water: true }; // rzeka
      return { y: t, water: false };
    }

    return {
      root, colliders, landmarks, zones, update, heightAt, surfaceAt,
      name: 'DOLINA WILCZA',
      spawn: { pos: landmarks.pad.clone(), heading: 0 },
      pois: [
        ['Baza ratunkowa (start)', landmarks.pad, 40],
        ['Zapora — korona', landmarks.dam.crest, 90],
        ['Zapora — ściana', landmarks.dam.face, 80],
        ['Elektrownia u podnóża', landmarks.dam.powerhouse, 60],
        ['Zbiornik', landmarks.lake, 160],
        ['Schronisko + lądowisko', landmarks.hut.helipad, 60],
        ['Wyciąg — stacja dolna', landmarks.lift.bottom, 60],
        ['Wyciąg — podpory', landmarks.lift.pylons[4], 70],
        ['Wyciąg — stacja górna', landmarks.lift.top, 70],
        ['Miejsce zdarzenia (SAR)', landmarks.sar.target, 50],
        ['Okap skalny (brak GPS)', landmarks.overhang, 60],
        ['Maszt przekaźnikowy', landmarks.relay.dish, 70],
        ['Linia SN do schroniska', landmarks.mvLine[3], 60],
        ['Droga dnem doliny', landmarks.road.valley[14], 70],
        ['Serpentyny', landmarks.road.switchbacks[3], 80]
      ]
    };
  }

  return { create };
})();
