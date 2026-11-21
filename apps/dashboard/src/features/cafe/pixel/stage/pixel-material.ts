import { Color, MeshBasicMaterial, ShaderMaterial, type Vector3, Vector4 } from "three";

/** 线性空间的 RGB，用作光照的乘数。 */
export type Rgb = readonly [number, number, number];

/**
 * 场景里的一盏灯：在半径 radius 内照出一圈分档的光，越靠近灯越亮。
 * 光照只作用在场景上；角色有自己的卡通着色，不受这些灯影响。
 */
export type PoolLight = { position: Vector3; radius: number; color: Rgb };

/** 木纹条带：沿 axis 方向每隔 period 米出现一道深色细缝，用来画地板、护墙板和吧台立面的木条。 */
export type Stripe = { axis: "x" | "y" | "z"; period: number };

/** 一个着色器最多支持的灯数。 */
const MAX_LIGHTS = 16;

/**
 * 场景材质的工厂。所有场景物件共用同一组灯光和环境光，材质按颜色和花纹缓存。
 * 像素风的光照：表面按朝向分三档明暗（顶面最亮，正面次之，侧面最暗），拉开差距让物件轮廓清楚；
 * 灯光只照朝上的面（地板、台面、架子），按 3 档阶梯叠加成光圈，墙上不画光环。
 */
export function createSceneMaterials(lights: PoolLight[], ambient: Rgb) {
  const lightPositions = lights.map(
    ({ position, radius }) => new Vector4(position.x, position.y, position.z, radius),
  );
  const lightColors = lights.map(({ color }) => new Color(...color));
  while (lightPositions.length < MAX_LIGHTS) {
    lightPositions.push(new Vector4(0, -100, 0, 0.001));
    lightColors.push(new Color(0, 0, 0));
  }
  const materials = new Map<string, ShaderMaterial>();

  /** emissive 为 true 的物件（灯罩、纸窗、烛火）不受光照，按自身颜色显示。 */
  function material(color: string, options: { stripe?: Stripe; emissive?: boolean } = {}) {
    const key = `${color}|${options.stripe?.axis ?? ""}${options.stripe?.period ?? ""}|${options.emissive ? 1 : 0}`;
    const existing = materials.get(key);
    if (existing) {
      return existing;
    }
    const axisIndex = { x: 0, y: 1, z: 2 }[options.stripe?.axis ?? "x"];
    const created = new ShaderMaterial({
      uniforms: {
        pigment: { value: new Color(color) },
        ambient: { value: new Color(...ambient) },
        lightPositions: { value: lightPositions },
        lightColors: { value: lightColors },
        stripeAxis: { value: axisIndex },
        stripePeriod: { value: options.stripe?.period ?? 0 },
      },
      defines: {
        MAX_LIGHTS,
        ...(options.emissive ? { EMISSIVE: 1 } : {}),
        ...(options.stripe ? { STRIPE: 1 } : {}),
      },
      vertexShader: `
        varying vec3 vWorld; varying vec3 vNormal;
        void main(){
          vec4 world=modelMatrix*vec4(position,1.);
          vWorld=world.xyz;
          vNormal=normalize(mat3(modelMatrix)*normal);
          gl_Position=projectionMatrix*viewMatrix*world;
        }`,
      fragmentShader: `
        uniform vec3 pigment; uniform vec3 ambient;
        uniform vec4 lightPositions[MAX_LIGHTS]; uniform vec3 lightColors[MAX_LIGHTS];
        uniform int stripeAxis; uniform float stripePeriod;
        varying vec3 vWorld; varying vec3 vNormal;
        void main(){
          vec3 base=pigment;
          #ifdef STRIPE
          float along=stripeAxis==0 ? vWorld.x : stripeAxis==1 ? vWorld.y : vWorld.z;
          if(fract(along/stripePeriod)<.18)base*=.78;
          #endif
          #ifdef EMISSIVE
          gl_FragColor=vec4(base,1.);
          #else
          vec3 n=normalize(vNormal);
          bool up=n.y>.6;
          float facing=up ? 1. : abs(n.z)>.6 ? .74 : .56;
          vec3 light=ambient;
          for(int i=0;i<MAX_LIGHTS;i++){
            vec4 lamp=lightPositions[i];
            float k=clamp(1.-distance(vWorld,lamp.xyz)/lamp.w,0.,1.);
            if(up)light+=lightColors[i]*floor(k*3.)/3.;
          }
          gl_FragColor=vec4(base*facing*light,1.);
          #endif
          #include <colorspace_fragment>
        }`,
    });
    materials.set(key, created);
    return created;
  }

  /** 家具底下和墙脚的接地阴影：半透明的深色，叠在地板上。 */
  const contactShadow = new MeshBasicMaterial({
    color: 0x1a0f0a,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });

  return {
    material,
    contactShadow,
    dispose() {
      for (const created of materials.values()) {
        created.dispose();
      }
      contactShadow.dispose();
    },
  };
}

export type SceneMaterials = ReturnType<typeof createSceneMaterials>;
