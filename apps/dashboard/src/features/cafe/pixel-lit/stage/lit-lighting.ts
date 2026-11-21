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
import type { LitTuning } from "./lit-tuning";

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

  const background = new Color();
  const shadowCasters = [windowLight, barSpot, accentLamp, leftTableSpot];

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
    leftTableSpot.intensity = tuning.pendantIntensity * 2.3;
    for (const fill of fills) {
      fill.light.intensity = tuning.pendantIntensity * 0.92 * fill.weight;
    }
    accentLamp.color.set(tuning.accentColor);
    accentLamp.intensity = tuning.accentIntensity;
    cafe.accentShadeMaterial.emissive.set(tuning.accentColor);
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
      points: [accentLamp, ...fills.map((fill) => fill.light)],
      spots: [barSpot, leftTableSpot],
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
