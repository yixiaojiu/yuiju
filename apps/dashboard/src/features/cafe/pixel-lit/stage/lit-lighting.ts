import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  PlaneGeometry,
  PointLight,
  Points,
  ShaderMaterial,
  SpotLight,
  type Vector3,
} from "three";
import type { LitCafeHandles } from "./lit-cafe-builder";

export type LightingPresetId = "afternoon" | "dusk";

type PresetConfig = {
  background: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  windowLightColor: string;
  windowLightIntensity: number;
  windowBackdropColor: string;
  windowBackdropIntensity: number;
  shaftColor: string;
  shaftStrength: number;
  pendantIntensity: number;
  coneStrength: number;
  accentColor: string;
  accentIntensity: number;
  exposure: number;
};

const PRESETS: Record<LightingPresetId, PresetConfig> = {
  afternoon: {
    background: "#10111a",
    hemiSky: "#52628a",
    hemiGround: "#332219",
    hemiIntensity: 0.42,
    ambientColor: "#2e3348",
    ambientIntensity: 0.28,
    windowLightColor: "#ffcb7d",
    windowLightIntensity: 5.0,
    windowBackdropColor: "#ffe5aa",
    windowBackdropIntensity: 2.15,
    shaftColor: "#ffd48c",
    shaftStrength: 0.2,
    pendantIntensity: 1.65,
    coneStrength: 0.08,
    accentColor: "#9bd0ff",
    accentIntensity: 4.8,
    exposure: 1.06,
  },
  dusk: {
    background: "#0d0d16",
    hemiSky: "#4d619c",
    hemiGround: "#3b2214",
    hemiIntensity: 0.36,
    ambientColor: "#25263d",
    ambientIntensity: 0.24,
    windowLightColor: "#86abff",
    windowLightIntensity: 3.4,
    windowBackdropColor: "#9cbcff",
    windowBackdropIntensity: 2.35,
    shaftColor: "#8ab0ff",
    shaftStrength: 0.18,
    pendantIntensity: 2.35,
    coneStrength: 0.105,
    accentColor: "#ffab57",
    accentIntensity: 3.4,
    exposure: 1.1,
  },
};

function createWindowGodRays() {
  const material = new ShaderMaterial({
    uniforms: {
      color: { value: new Color("#ffd48c") },
      strength: { value: 0.2 },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float strength;
      uniform float time;
      varying vec2 vUv;
      void main() {
        float along = vUv.y;
        float lengthFade = pow(clamp(along, 0.0, 1.0), 1.55) * smoothstep(1.0, 0.9, along);
        float edge = pow(sin(vUv.x * 3.14159265), 1.7);
        float slats = 0.72 + 0.28 * sin((vUv.x * 9.0 + along * 2.4) * 3.14159265);
        float drift = 0.92 + 0.08 * sin(vUv.y * 8.0 - time * 0.45 + vUv.x * 4.0);
        float alpha = lengthFade * edge * slats * drift * strength;
        gl_FragColor = vec4(color * alpha, alpha);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
  });

  const group = new Group();
  const planeGeo = new PlaneGeometry(2.35, 6.4);
  for (const layer of [
    { dx: 0, dy: 0.15, dz: 0, rotY: 0, sx: 1.0 },
    { dx: 0.18, dy: -0.08, dz: 0.16, rotY: 0.24, sx: 0.92 },
    { dx: -0.18, dy: 0.02, dz: -0.1, rotY: -0.22, sx: 0.9 },
  ]) {
    const mesh = new Mesh(planeGeo, material);
    mesh.position.set(layer.dx, layer.dy, layer.dz);
    mesh.rotation.y = layer.rotY;
    mesh.scale.set(layer.sx, 1, 1);
    group.add(mesh);
  }

  const holder = new Group();
  holder.position.set(-3.9, 1.96, -3.72);
  group.position.set(1.85, -1.45, 2.25);
  group.rotation.set(-0.88, 0.34, 0.62);
  holder.add(group);

  return {
    root: holder,
    material,
    dispose() {
      planeGeo.dispose();
      material.dispose();
    },
  };
}

function createPendantCones(positions: Vector3[]) {
  const height = 1.05;
  const geometry = new CylinderGeometry(0.11, 0.6, height, 28, 1, true);
  const material = new ShaderMaterial({
    uniforms: {
      color: { value: new Color("#ffca82") },
      strength: { value: 0.08 },
    },
    vertexShader: `
      varying float vFall;
      varying vec3 vNormalView;
      varying vec3 vPositionView;
      void main() {
        vFall = 0.5 - position.y / ${height.toFixed(2)};
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vPositionView = mvPos.xyz;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float strength;
      varying float vFall;
      varying vec3 vNormalView;
      varying vec3 vPositionView;
      void main() {
        float facing = abs(dot(normalize(vNormalView), normalize(-vPositionView)));
        float alpha = pow(max(1.0 - vFall, 0.0), 1.85) * pow(facing, 1.8) * strength;
        gl_FragColor = vec4(color * alpha, alpha);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
  });

  const group = new Group();
  for (const pos of positions) {
    const cone = new Mesh(geometry, material);
    cone.position.set(pos.x, pos.y - height / 2, pos.z);
    group.add(cone);
  }

  return {
    root: group,
    material,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function createParticles(steamAnchors: Vector3[]) {
  const dustCount = 180;
  const dustPos = new Float32Array(dustCount * 3);
  const dustPhase = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() * 2 - 1) * 4.8;
    dustPos[i * 3 + 1] = 0.4 + Math.random() * 2.2;
    dustPos[i * 3 + 2] = -3.2 + Math.random() * 5.8;
    dustPhase[i] = Math.random() * Math.PI * 2;
  }
  const dustGeo = new BufferGeometry();
  dustGeo.setAttribute("position", new BufferAttribute(dustPos, 3));
  dustGeo.setAttribute("aPhase", new BufferAttribute(dustPhase, 1));
  const dustMat = new ShaderMaterial({
    uniforms: { time: { value: 0 }, color: { value: new Color("#ffdfa8") } },
    vertexShader: `
      attribute float aPhase;
      uniform float time;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.x += sin(time * 0.35 + aPhase) * 0.14;
        p.y += cos(time * 0.28 + aPhase * 1.3) * 0.1;
        vAlpha = 0.4 + 0.6 * sin(time * 1.1 + aPhase * 2.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 2.5;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      varying float vAlpha;
      void main() {
        float soft = smoothstep(0.5, 0.08, length(gl_PointCoord - 0.5));
        float a = soft * vAlpha * 0.52;
        gl_FragColor = vec4(color * a, a);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });

  const puffsPerAnchor = 6;
  const steamCount = steamAnchors.length * puffsPerAnchor;
  const steamPos = new Float32Array(steamCount * 3);
  const steamSeed = new Float32Array(steamCount);
  let idx = 0;
  for (const anchor of steamAnchors) {
    for (let k = 0; k < puffsPerAnchor; k++) {
      steamPos[idx * 3] = anchor.x;
      steamPos[idx * 3 + 1] = anchor.y;
      steamPos[idx * 3 + 2] = anchor.z;
      steamSeed[idx] = k / puffsPerAnchor + Math.random() * 0.1;
      idx += 1;
    }
  }
  const steamGeo = new BufferGeometry();
  steamGeo.setAttribute("position", new BufferAttribute(steamPos, 3));
  steamGeo.setAttribute("aSeed", new BufferAttribute(steamSeed, 1));
  const steamMat = new ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      attribute float aSeed;
      uniform float time;
      varying float vFade;
      void main() {
        float life = fract(time * 0.22 + aSeed);
        vec3 p = position;
        p.y += life * 0.38;
        p.x += sin(life * 5.2 + aSeed * 12.0) * 0.04;
        vFade = sin(life * 3.14159265) * (1.0 - life * 0.4);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 3.2 + life * 4.0;
      }
    `,
    fragmentShader: `
      varying float vFade;
      void main() {
        float soft = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5));
        float a = soft * vFade * 0.15;
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.85) * a, a);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });

  const group = new Group();
  group.add(new Points(dustGeo, dustMat), new Points(steamGeo, steamMat));
  return {
    root: group,
    dustMat,
    steamMat,
    dispose() {
      dustGeo.dispose();
      dustMat.dispose();
      steamGeo.dispose();
      steamMat.dispose();
    },
  };
}

export function createLitLighting(cafe: LitCafeHandles) {
  const lightGroup = new Group();

  const hemiLight = new HemisphereLight("#52628a", "#332219", 0.42);
  const ambientLight = new AmbientLight("#2e3348", 0.28);
  lightGroup.add(hemiLight, ambientLight);

  // 1. 窗外主方向光（投射百叶窗条纹、旋转吊扇与立牌软阴影）
  const windowLight = new DirectionalLight("#ffcb7d", 5.0);
  windowLight.position.set(-7.2, 5.2, -7.8);
  windowLight.target.position.set(-0.9, 0.2, 0.45);
  windowLight.castShadow = true;
  windowLight.shadow.mapSize.set(2048, 2048);
  windowLight.shadow.camera.left = -7.2;
  windowLight.shadow.camera.right = 7.2;
  windowLight.shadow.camera.top = 6.2;
  windowLight.shadow.camera.bottom = -6.2;
  windowLight.shadow.camera.near = 1.0;
  windowLight.shadow.camera.far = 22.0;
  windowLight.shadow.bias = -0.0005;
  windowLight.shadow.normalBias = 0.02;
  windowLight.shadow.radius = 2.4;
  lightGroup.add(windowLight, windowLight.target);

  // 2. 吧台中央主暖聚光灯（从前上方照向吧台与立牌正面，让草莓蛋糕、面包篮、咖啡机和角色正面温润受光）
  const barSpot = new SpotLight("#ffbe70", 7.2, 9.5, Math.PI * 0.4, 0.72, 1.3);
  barSpot.position.set(0.0, 2.85, 2.65);
  barSpot.target.position.set(0.0, 0.35, -0.6);
  barSpot.castShadow = true;
  barSpot.shadow.mapSize.set(1024, 1024);
  barSpot.shadow.bias = -0.0004;
  barSpot.shadow.radius = 2.6;
  lightGroup.add(barSpot, barSpot.target);

  // 3. 右前景陈列台氛围灯（制造冷暖光对比与硬朗前景阴影）
  const accentLamp = new PointLight("#9bd0ff", 4.8, 7.6, 1.55);
  accentLamp.position.set(3.85, 1.34, 2.15);
  accentLamp.castShadow = true;
  accentLamp.shadow.mapSize.set(1024, 1024);
  accentLamp.shadow.bias = -0.0008;
  accentLamp.shadow.radius = 2.2;
  lightGroup.add(accentLamp);

  // 4. 左圆桌吊灯聚光
  const leftTableSpot = new SpotLight("#ffbe6e", 4.2, 5.2, Math.PI * 0.42, 0.76, 1.4);
  leftTableSpot.position.set(-4.1, 1.65, -1.05);
  leftTableSpot.target.position.set(-4.1, 0.1, -1.25);
  leftTableSpot.castShadow = true;
  leftTableSpot.shadow.mapSize.set(1024, 1024);
  leftTableSpot.shadow.bias = -0.0005;
  leftTableSpot.shadow.radius = 2.4;
  lightGroup.add(leftTableSpot, leftTableSpot.target);

  // 暖色局部灯源与辅助补光（weight 区分实体可见台灯/吊灯的近场亮度与背景暗补光）
  const fills: { light: PointLight; weight: number }[] = [];
  for (const [x, y, z, dist, weight] of [
    [-1.7, 1.6, -0.95, 4.4, 1.25],
    [1.7, 1.6, -0.95, 4.4, 1.25],
    [4.1, 1.58, -0.95, 4.6, 2.1],
    [1.66, 1.32, 1.05, 3.4, 2.4],
    [-4.5, 1.35, 2.45, 3.6, 0.8],
    [-0.4, 2.0, -3.1, 4.5, 1.0],
    [2.15, 1.55, -3.35, 4.2, 0.9],
    [3.8, 1.9, -3.1, 4.0, 0.9],
  ] as const) {
    const p = new PointLight("#ffba66", 1.55 * weight, dist, 1.65);
    p.position.set(x, y, z);
    lightGroup.add(p);
    fills.push({ light: p, weight });
  }

  const godRays = createWindowGodRays();
  const pendantCones = createPendantCones(cafe.pendantPositions);
  const particles = createParticles(cafe.steamAnchors);
  lightGroup.add(godRays.root, pendantCones.root, particles.root);

  const background = new Color(PRESETS.afternoon.background);
  let exposure = PRESETS.afternoon.exposure;

  function applyPreset(id: LightingPresetId) {
    const cfg = PRESETS[id];
    background.set(cfg.background);
    exposure = cfg.exposure;

    hemiLight.color.set(cfg.hemiSky);
    hemiLight.groundColor.set(cfg.hemiGround);
    hemiLight.intensity = cfg.hemiIntensity;
    ambientLight.color.set(cfg.ambientColor);
    ambientLight.intensity = cfg.ambientIntensity;

    windowLight.color.set(cfg.windowLightColor);
    windowLight.intensity = cfg.windowLightIntensity;
    cafe.windowBackdropMaterial.color.set(cfg.windowBackdropColor);
    cafe.windowBackdropMaterial.emissive.set(cfg.windowBackdropColor);
    cafe.windowBackdropMaterial.emissiveIntensity = cfg.windowBackdropIntensity;

    barSpot.intensity = cfg.pendantIntensity * 3.8;
    leftTableSpot.intensity = cfg.pendantIntensity * 2.3;
    for (const fill of fills) {
      fill.light.intensity = cfg.pendantIntensity * 0.92 * fill.weight;
    }
    accentLamp.color.set(cfg.accentColor);
    accentLamp.intensity = cfg.accentIntensity;
    cafe.accentShadeMaterial.emissive.set(cfg.accentColor);

    godRays.material.uniforms.color.value.set(cfg.shaftColor);
    godRays.material.uniforms.strength.value = cfg.shaftStrength;
    pendantCones.material.uniforms.strength.value = cfg.coneStrength;
    particles.dustMat.uniforms.color.value.set(cfg.shaftColor);
  }

  applyPreset("afternoon");

  return {
    lightGroup,
    get background() {
      return background;
    },
    get exposure() {
      return exposure;
    },
    applyPreset,
    update(time: number) {
      godRays.material.uniforms.time.value = time;
      particles.dustMat.uniforms.time.value = time;
      particles.steamMat.uniforms.time.value = time;
    },
    dispose() {
      godRays.dispose();
      pendantCones.dispose();
      particles.dispose();
    },
  };
}
