import {
  Color,
  DoubleSide,
  EquirectangularReflectionMapping,
  type Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  type Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * 二次元画风的玻璃：中间几乎透明，边缘向内透出一圈暖色的亮边，靠左上一侧有一道白色高光。
 * 写实的反射在小物件上几乎看不出来，这种画法能让蛋糕罩、豆罐、虹吸壶的轮廓一眼可辨。
 * 玻璃都是没有厚度的单层曲面，双面渲染，正反两面都画出轮廓。
 */
function createGlassMaterial() {
  return new ShaderMaterial({
    uniforms: {
      rimColor: { value: new Color(0xffe6c4) },
      highlightColor: { value: new Color(0xfffaf0) },
    },
    vertexShader: `
      varying vec3 vNormalView;
      varying vec3 vPositionView;
      void main() {
        vec4 positionView = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vPositionView = positionView.xyz;
        gl_Position = projectionMatrix * positionView;
      }
    `,
    fragmentShader: `
      uniform vec3 rimColor;
      uniform vec3 highlightColor;
      varying vec3 vNormalView;
      varying vec3 vPositionView;
      void main() {
        vec3 normal = normalize(vNormalView);
        vec3 toCamera = normalize(-vPositionView);
        // 背面朝向相机时翻转法线，正反两面用同一套计算。
        if (dot(normal, toCamera) < 0.0) {
          normal = -normal;
        }
        float rim = pow(1.0 - clamp(dot(normal, toCamera), 0.0, 1.0), 2.2);
        // 法线朝向左上方的一小条区域画成高光。
        float highlight = smoothstep(0.78, 0.86, dot(normal, normalize(vec3(-0.55, 0.65, 0.5))));
        vec3 color = mix(rimColor, highlightColor, highlight);
        float alpha = clamp(0.05 + rim * 0.55 + highlight * 0.7, 0.0, 0.9);
        gl_FragColor = vec4(color, alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/**
 * 加载 Blender 烘焙导出的咖啡店场景（由 packages/yuiju-assets/cafe-scene 构建）。
 *
 * 场景文件里的物体按光照方式分组，组名和方式写在每组的自定义属性里：
 * - lightmap：结构和家具，光照来自第二套 UV 上的光照贴图。
 * - vertex：小件道具，光照烘焙在顶点色里。
 * - none：灯泡等自发光物体和金属不受烘焙光照影响，金属靠房间全景图做反射；玻璃换成专门的画法。
 *
 * 烘焙的光照强度导出时除以了 lightScale，这里乘回去。场景里没有任何实时光源照亮环境。
 *
 * 返回场景本身、房间全景图，以及场景文件里以 Anchor_ 开头的锚点位置（机位、角色站位、吊灯光锥）。
 */
export async function loadEnvironment(onProgress: (event: ProgressEvent) => void) {
  const textureLoader = new TextureLoader();
  // 只有场景文件汇报下载进度；两张贴图很小，图片加载也不提供进度。
  const [gltf, lightMap, reflection] = await Promise.all([
    new GLTFLoader().loadAsync("/large/cafe-scene.glb", onProgress),
    textureLoader.loadAsync("/large/cafe-lightmap.jpg"),
    textureLoader.loadAsync("/large/cafe-environment.jpg"),
  ]);
  // glTF 的 UV 原点在左上角，光照贴图要和场景文件里的贴图用同一种朝向。
  lightMap.flipY = false;
  lightMap.colorSpace = SRGBColorSpace;
  lightMap.channel = 1;
  reflection.mapping = EquirectangularReflectionMapping;
  reflection.colorSpace = SRGBColorSpace;

  const glassMaterial = createGlassMaterial();
  const anchors: Record<string, Vector3> = {};
  for (const child of gltf.scene.children) {
    if (child.name.startsWith("Anchor_")) {
      anchors[child.name] = child.position.clone();
      continue;
    }
    const bake: string = child.userData.bake;
    const lightScale: number = child.userData.lightScale;
    child.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return;
      }
      const exported: MeshStandardMaterial = object.material;
      let material: Material = exported;
      if (bake === "lightmap") {
        // 基础材质里光照贴图的贡献会被除以 π，这里补回来。
        material = new MeshBasicMaterial({
          map: exported.map,
          color: exported.color,
          side: exported.side,
          lightMap,
          lightMapIntensity: lightScale * Math.PI,
        });
      } else if (bake === "vertex") {
        material = new MeshBasicMaterial({
          map: exported.map,
          color: exported.color.clone().multiplyScalar(lightScale),
          side: exported.side,
          alphaTest: exported.alphaTest,
          vertexColors: true,
        });
      } else if (exported.name === "Glass") {
        material = glassMaterial;
      }
      if (material !== exported) {
        exported.dispose();
        object.material = material;
      }
    });
  }

  const scene: Group = gltf.scene;
  return { scene, reflection, anchors };
}
