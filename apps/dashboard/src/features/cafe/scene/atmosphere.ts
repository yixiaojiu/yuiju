import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  Points,
  ShaderMaterial,
  type Vector3,
} from "three";

/** 光锥从灯罩口向下的长度和底部半径，单位米。 */
const CONE_HEIGHT = 0.62;
const CONE_BOTTOM_RADIUS = 0.36;
const CONE_TOP_RADIUS = 0.06;

/**
 * 吊灯下的体积光锥。不做逐像素的体积雾计算，而是在每盏灯下放一个半透明的圆台：
 * 越往下越淡，侧面掠射处也淡出，叠加混合后读起来像灯光照亮了空气里的微尘。
 * positions 是每盏灯灯罩口的位置。
 */
export function createLightCones(positions: Vector3[]) {
  const material = new ShaderMaterial({
    uniforms: { color: { value: new Color(0xffc98e) }, strength: { value: 0.085 } },
    vertexShader: `
      varying float vFall;
      varying vec3 vNormalView;
      varying vec3 vPositionView;
      void main() {
        // 圆台几何体的 y 从 -0.5 到 0.5，顶部为 0，底部为 1。
        vFall = 0.5 - position.y / ${CONE_HEIGHT.toFixed(2)};
        vec4 positionView = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vPositionView = positionView.xyz;
        gl_Position = projectionMatrix * positionView;
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
        // 插值误差会让 1.0 - vFall 略小于 0，对负数做幂运算会得到无效数值，再被泛光扩散到整个画面。
        float alpha = pow(max(1.0 - vFall, 0.0), 1.6) * pow(facing, 2.0) * strength;
        gl_FragColor = vec4(color * alpha, alpha);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const geometry = new CylinderGeometry(
    CONE_TOP_RADIUS,
    CONE_BOTTOM_RADIUS,
    CONE_HEIGHT,
    48,
    1,
    true,
  );
  const cones = new Group();
  for (const position of positions) {
    const cone = new Mesh(geometry, material);
    cone.position.set(position.x, position.y - CONE_HEIGHT / 2, position.z);
    cones.add(cone);
  }
  return cones;
}

/**
 * 空气里缓慢漂浮的微尘。每粒微尘绕自己的初始位置做小幅度的漂移，
 * 漂移由着色器里的 time 驱动，调用方每帧更新 `material.uniforms.time.value`。
 * halfWidth / height / halfDepth 是微尘分布的范围，单位米。
 */
export function createDust(halfWidth: number, height: number, halfDepth: number) {
  const count = 360;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    positions[index * 3] = (Math.random() * 2 - 1) * halfWidth;
    positions[index * 3 + 1] = 0.4 + Math.random() * (height - 0.6);
    positions[index * 3 + 2] = (Math.random() * 2 - 1) * halfDepth;
    phases[index] = Math.random() * Math.PI * 2;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("phase", new BufferAttribute(phases, 1));
  const material = new ShaderMaterial({
    uniforms: { time: { value: 0 }, color: { value: new Color(0xffd9ae) } },
    vertexShader: `
      attribute float phase;
      uniform float time;
      varying float vTwinkle;
      void main() {
        vec3 drift = vec3(
          sin(time * 0.11 + phase) * 0.12,
          sin(time * 0.07 + phase * 1.7) * 0.08,
          cos(time * 0.09 + phase * 1.3) * 0.12
        );
        vec4 positionView = modelViewMatrix * vec4(position + drift, 1.0);
        vTwinkle = 0.55 + 0.45 * sin(time * 0.6 + phase * 3.0);
        gl_PointSize = 5.0 / -positionView.z;
        gl_Position = projectionMatrix * positionView;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      varying float vTwinkle;
      void main() {
        float falloff = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        float alpha = falloff * vTwinkle * 0.35;
        gl_FragColor = vec4(color * alpha, alpha);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  return new Points(geometry, material);
}
