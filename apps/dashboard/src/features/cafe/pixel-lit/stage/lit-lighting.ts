import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Mesh,
  PointLight,
  Points,
  ShaderMaterial,
  SpotLight,
  Vector3,
} from "three";
import { LIT_ROOM, type LitCafeHandles } from "./lit-cafe-builder";
import type { LitTuning } from "./lit-tuning";

/**
 * 窗光的光柱：每扇障子窗的上沿和下沿各拉一片斜面，顺着窗光方向一直落到地面。
 * uv.y 在窗口是 1、落地是 0，uv.x 横跨窗宽。
 */
function createWindowGodRays(windows: LitCafeHandles["sunWindows"], sunDirection: Vector3) {
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
        float drift = 0.92 + 0.08 * sin(vUv.y * 8.0 - time * 0.45 + vUv.x * 4.0);
        float alpha = lengthFade * edge * drift * strength;
        gl_FragColor = vec4(color * alpha, alpha);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
  });

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const window of windows) {
    for (const y of window.y) {
      const reach = y / -sunDirection.y;
      const base = positions.length / 3;
      for (const [z, u] of [
        [window.z[0], 0],
        [window.z[1], 1],
      ] as const) {
        positions.push(LIT_ROOM.minX, y, z);
        uvs.push(u, 1);
        positions.push(LIT_ROOM.minX + sunDirection.x * reach, 0, z + sunDirection.z * reach);
        uvs.push(u, 0);
      }
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  return {
    root: new Mesh(geometry, material),
    material,
    dispose() {
      geometry.dispose();
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
  const dustCount = 320;
  const dustPos = new Float32Array(dustCount * 3);
  const dustPhase = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = LIT_ROOM.minX + Math.random() * (LIT_ROOM.maxX - LIT_ROOM.minX);
    dustPos[i * 3 + 1] = 0.4 + Math.random() * 1.8;
    dustPos[i * 3 + 2] = LIT_ROOM.minZ + Math.random() * (LIT_ROOM.maxZ - LIT_ROOM.minZ);
    dustPhase[i] = Math.random() * Math.PI * 2;
  }
  const dustGeo = new BufferGeometry();
  dustGeo.setAttribute("position", new BufferAttribute(dustPos, 3));
  dustGeo.setAttribute("aPhase", new BufferAttribute(dustPhase, 1));
  const dustMat = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      color: { value: new Color("#ffdfa8") },
      pointScale: { value: 1 },
      strength: { value: 0.52 },
    },
    vertexShader: `
      attribute float aPhase;
      uniform float time;
      uniform float pointScale;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.x += sin(time * 0.35 + aPhase) * 0.14;
        p.y += cos(time * 0.28 + aPhase * 1.3) * 0.1;
        vAlpha = 0.4 + 0.6 * sin(time * 1.1 + aPhase * 2.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 2.5 * pointScale;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float strength;
      varying float vAlpha;
      void main() {
        float soft = smoothstep(0.5, 0.08, length(gl_PointCoord - 0.5));
        float a = soft * vAlpha * strength;
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
    uniforms: { time: { value: 0 }, pointScale: { value: 1 } },
    vertexShader: `
      attribute float aSeed;
      uniform float time;
      uniform float pointScale;
      varying float vFade;
      void main() {
        float life = fract(time * 0.22 + aSeed);
        vec3 p = position;
        p.y += life * 0.38;
        p.x += sin(life * 5.2 + aSeed * 12.0) * 0.04;
        vFade = sin(life * 3.14159265) * (1.0 - life * 0.4);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (3.2 + life * 4.0) * pointScale;
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

  // 1. 窗光：从左墙外斜照进来，只能穿过两扇障子窗，窗格的影子落在长椅角前面的地上。
  const windowLight = new DirectionalLight("#ffcb7d", 5.0);
  windowLight.position.set(-12, 7.5, 0.5);
  windowLight.target.position.set(-2, 0, -0.8);
  windowLight.castShadow = true;
  windowLight.shadow.mapSize.set(2048, 2048);
  windowLight.shadow.camera.left = -6.5;
  windowLight.shadow.camera.right = 6.5;
  windowLight.shadow.camera.top = 6.5;
  windowLight.shadow.camera.bottom = -6.5;
  windowLight.shadow.camera.near = 3;
  windowLight.shadow.camera.far = 24;
  windowLight.shadow.bias = -0.0005;
  windowLight.shadow.normalBias = 0.02;
  windowLight.shadow.radius = 2.4;
  lightGroup.add(windowLight, windowLight.target);

  // 2. 吧台主光：从客区上方斜照吧台，台面、器物和她的正面受光，吧台是全店最亮的地方。
  // 灯挂在挡光顶板下面，顶板才不会挡住它。
  const barSpot = new SpotLight("#ffbe70", 7.2, 6, Math.PI * 0.36, 0.72, 1.3);
  barSpot.position.set(0.4, 2.3, 0.6);
  barSpot.target.position.set(0.4, 0.3, -2.2);
  barSpot.castShadow = true;
  barSpot.shadow.mapSize.set(1024, 1024);
  barSpot.shadow.bias = -0.0004;
  barSpot.shadow.radius = 2.6;
  lightGroup.add(barSpot, barSpot.target);

  // 3. 长椅角两张小桌的吊灯聚光
  const benchSpot = new SpotLight("#ffbe6e", 4.2, 3.6, Math.PI * 0.4, 0.76, 1.4);
  benchSpot.position.set(-2.9, 1.9, -0.65);
  benchSpot.target.position.set(-3.17, 0, -0.65);
  benchSpot.castShadow = true;
  benchSpot.shadow.mapSize.set(1024, 1024);
  benchSpot.shadow.bias = -0.0005;
  benchSpot.shadow.radius = 2.4;
  lightGroup.add(benchSpot, benchSpot.target);

  // 暖色点光：吊灯、台灯、落地灯、壁灯、后厨门透出的光，weight 区分看得见的灯具和背景里的暗补光。
  const fills: { light: PointLight; weight: number }[] = [];
  for (const [x, y, z, dist, weight] of [
    // 吧台三盏吊灯
    [-0.55, 1.7, -1.0, 3.2, 1.2],
    [0.45, 1.7, -1.0, 3.2, 1.2],
    [1.45, 1.7, -1.0, 3.2, 1.2],
    // 小桌的吊灯和中间圆桌的台灯
    [-3.17, 1.2, -1.45, 2.4, 1.0],
    [-3.17, 1.2, 0.15, 2.4, 1.0],
    [0.72, 0.62, 0.9, 2.4, 1.1],
    // 收银台台灯
    [2.68, 0.75, -2.05, 2.4, 1.5],
    // 黑板壁灯
    [1.9, 1.6, -2.75, 2.4, 0.9],
    // 后厨门纸格透出的光
    [0.7, 1.2, -2.75, 2.8, 0.8],
    // 阅读角落地灯和右墙壁灯
    [3.8, 1.2, -2.42, 3.0, 1.5],
    [3.75, 1.6, -1.85, 2.2, 0.7],
    // 陈列架
    [3.4, 1.5, 0.1, 3.0, 0.7],
    // 窗边吧台的蜡烛
    [-2.5, 0.75, 2.6, 2.0, 0.7],
    // 店门口
    [1.95, 1.7, 2.4, 3.0, 0.7],
  ] as const) {
    const p = new PointLight("#ffba66", 1.55 * weight, dist, 1.65);
    p.position.set(x, y, z);
    lightGroup.add(p);
    fills.push({ light: p, weight });
  }

  const godRays = createWindowGodRays(
    cafe.sunWindows,
    new Vector3().subVectors(windowLight.target.position, windowLight.position).normalize(),
  );
  const pendantCones = createPendantCones(cafe.pendantPositions);
  const particles = createParticles(cafe.steamAnchors);
  lightGroup.add(godRays.root, pendantCones.root, particles.root);

  const background = new Color();
  const shadowCasters = [windowLight, barSpot, benchSpot];

  function apply(tuning: LitTuning) {
    background.set(tuning.background);

    hemiLight.color.set(tuning.hemiSky);
    hemiLight.groundColor.set(tuning.hemiGround);
    hemiLight.intensity = tuning.hemiIntensity;
    ambientLight.color.set(tuning.ambientColor);
    ambientLight.intensity = tuning.ambientIntensity;

    windowLight.color.set(tuning.windowLightColor);
    windowLight.intensity = tuning.windowLightIntensity;
    cafe.windowBackdropMaterial.color.set(tuning.windowBackdropColor);
    cafe.windowBackdropMaterial.emissive.set(tuning.windowBackdropColor);
    cafe.windowBackdropMaterial.emissiveIntensity = tuning.windowBackdropIntensity;

    barSpot.intensity = tuning.pendantIntensity * 3.8;
    benchSpot.intensity = tuning.pendantIntensity * 2.3;
    for (const fill of fills) {
      fill.light.intensity = tuning.pendantIntensity * 0.92 * fill.weight;
    }
    for (const light of shadowCasters) {
      light.shadow.radius = tuning.shadowSoftness;
    }

    godRays.material.uniforms.color.value.set(tuning.shaftColor);
    godRays.material.uniforms.strength.value = tuning.shaftStrength;
    pendantCones.material.uniforms.strength.value = tuning.coneStrength;
    particles.dustMat.uniforms.color.value.set(tuning.shaftColor);
    particles.dustMat.uniforms.strength.value = tuning.dustStrength;
  }

  return {
    lightGroup,
    background,
    apply,
    /**
     * 角色立牌受光要用的灯：环境光、天光、窗光，以及各盏点光源和聚光灯。
     * 立牌着色器按和场景材质相同的公式计算，角色和家具受到的是同一套光。
     */
    characterLights: {
      ambient: ambientLight,
      hemi: hemiLight,
      sun: windowLight,
      points: fills.map((fill) => fill.light),
      spots: [barSpot, benchSpot],
    },
    /** 粒子大小的倍率：像素网格渲染时一个画面像素更大，粒子要相应缩小。 */
    setPointScale(scale: number) {
      particles.dustMat.uniforms.pointScale.value = scale;
      particles.steamMat.uniforms.pointScale.value = scale;
    },
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
