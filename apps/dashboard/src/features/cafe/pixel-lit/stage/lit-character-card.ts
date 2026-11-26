import {
  Color,
  DepthTexture,
  Mesh,
  MeshNormalMaterial,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { defaultCharacterDesign, type OutfitName } from "../character/character-design";
import type { PixelActionName } from "../character/pixel-actions";
import {
  aimPixelCamera,
  createPixelCamera,
  createPixelCharacter,
  ELEVATION,
  type EmoteName,
  type ExpressionName,
  INNER_SHADE,
  OUTLINE_SHADE,
  OVERLAY_LAYER,
  PIXEL,
  type PixelFocus,
} from "../character/pixel-character";

export const CARD_PIXELS = 64;
/** 角色在 64×64 画面里的取景：画面中心比头部中心低 10 个像素。 */
const CARD_FOCUS: PixelFocus = { x: 0, z: 0, up: -10 };

/**
 * 将 3D 三渲二像素角色离屏渲染为 64×64 最近邻纹理：
 * 先按角色专用 30° 正交相机对齐脸部像素网格并附加自选色描边，再交给喫茶店场景立牌受光、遮挡、投射阴影。
 */
export function createLitCharacterCard(outfit: OutfitName) {
  const scene = new Scene();
  const camera = createPixelCamera(CARD_PIXELS, CARD_PIXELS, CARD_FOCUS);
  const character = createPixelCharacter(camera, defaultCharacterDesign, outfit);
  // 明暗由场景灯光决定（见 lit-stage 的立牌着色器），角色自带的固定两档明暗关掉。
  character.setCelShading(false);
  scene.add(character.root);

  const rawTarget = new WebGLRenderTarget(CARD_PIXELS, CARD_PIXELS, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthTexture: new DepthTexture(CARD_PIXELS, CARD_PIXELS),
  });
  rawTarget.texture.generateMipmaps = false;

  // 每个像素的法线（相机空间），立牌着色器按它计算场景灯光的明暗和方向。
  const normalTarget = new WebGLRenderTarget(CARD_PIXELS, CARD_PIXELS, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
  });
  normalTarget.texture.generateMipmaps = false;
  const normalMaterial = new MeshNormalMaterial();

  const outlinedTarget = new WebGLRenderTarget(CARD_PIXELS, CARD_PIXELS, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
  });
  outlinedTarget.texture.generateMipmaps = false;

  const outlineMaterial = new ShaderMaterial({
    uniforms: {
      source: { value: rawTarget.texture },
      depth: { value: rawTarget.depthTexture },
      texel: { value: new Vector2(1 / CARD_PIXELS, 1 / CARD_PIXELS) },
      shade: { value: OUTLINE_SHADE },
      innerShade: { value: INNER_SHADE },
      depthGap: { value: 0.1 / (camera.far - camera.near) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D source;
      uniform sampler2D depth;
      uniform vec2 texel;
      uniform vec3 shade;
      uniform vec3 innerShade;
      uniform float depthGap;
      varying vec2 vUv;
      // 沿一个方向判断要不要画内描边：近的一侧比自己近出 depthGap 以上才算两个部件前后相叠。
      // 同一个斜面上（比如压扁的帽顶、30° 俯视时几乎平行于视线），另一侧会远出差不多的量，
      // 减掉它就不会误画线。另一侧是透明背景时不画：这个像素挨着外轮廓，
      // 多半是曲面转到侧面的边缘，深度变化最陡，分不出是不是两个部件。
      bool crease(vec2 uv, vec2 offset, float d) {
        float a = texture2D(depth, uv + offset).r;
        float b = texture2D(depth, uv - offset).r;
        if (texture2D(source, a > b ? uv + offset : uv - offset).a < 0.5) {
          return false;
        }
        return d - min(a, b) - max(max(a, b) - d, 0.0) > depthGap;
      }
      // 记下四邻里最靠前（深度最小）的不透明像素，外描边取它的颜色。
      void closer(vec2 uv, inout vec4 picked, inout float pickedDepth) {
        vec4 c = texture2D(source, uv);
        float d = texture2D(depth, uv).r;
        if (c.a > 0.5 && d < pickedDepth) {
          picked = c;
          pickedDepth = d;
        }
      }
      void main() {
        vec4 c = texture2D(source, vUv);
        vec2 dx = vec2(texel.x, 0.0);
        vec2 dy = vec2(0.0, texel.y);
        if (c.a < 0.5) {
          vec4 picked = vec4(0.0);
          float pickedDepth = 2.0;
          closer(vUv + dx, picked, pickedDepth);
          closer(vUv - dx, picked, pickedDepth);
          closer(vUv + dy, picked, pickedDepth);
          closer(vUv - dy, picked, pickedDepth);
          if (picked.a > 0.5) {
            gl_FragColor = vec4(picked.rgb * shade, 1.0);
          } else {
            gl_FragColor = vec4(0.0);
          }
        } else {
          float d = texture2D(depth, vUv).r;
          if (crease(vUv, dx, d) || crease(vUv, dy, d)) {
            c.rgb *= innerShade;
          }
          gl_FragColor = c;
        }
      }
    `,
  });

  const quadGeo = new PlaneGeometry(2, 2);
  const quadMesh = new Mesh(quadGeo, outlineMaterial);
  quadMesh.frustumCulled = false;
  const quadScene = new Scene();
  quadScene.add(quadMesh);
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);

  let elevation = ELEVATION;
  // 脚底在画面里的行（从下往数）。脚底外侧还有 1px 轮廓描边，向下多扣 1 格让描边底沿正好落在地板平面。
  const groundRow = () => ((new Vector3(0, 0, 0).project(camera).y + 1) / 2) * CARD_PIXELS - 1;
  // 角色脚底所在的竖直平面到相机的距离（沿视线方向），用来把深度贴图换算成「比这个平面靠前还是靠后多少」。
  const rootDistance = () =>
    new Vector3(0, 0, 0).sub(camera.position).dot(camera.getWorldDirection(new Vector3()));

  const savedClearColor = new Color();
  let currentLoop: PixelActionName = "idle";

  return {
    texture: outlinedTarget.texture,
    get groundRowFromBottom() {
      return groundRow();
    },
    /** 角色这一层的深度贴图（描边像素没有深度，取相邻像素的）。 */
    depthTexture: rawTarget.depthTexture!,
    /** 角色这一层的法线贴图：相机空间的法线压到 0–1；透明的地方是描边或空白，不参与受光。 */
    normalTexture: normalTarget.texture,
    /**
     * 把深度贴图换算回角色空间距离要用的参数：相机近远平面、脚底平面的距离、
     * 一个贴图像素对应的角色空间尺寸、俯角的正切。立牌着色器据此按像素写入场景深度。
     */
    get depthReconstruction() {
      return {
        near: camera.near,
        far: camera.far,
        rootDistance: rootDistance(),
        pixel: PIXEL,
        tanElevation: Math.tan(elevation),
      };
    },
    /** 换俯角：角色专用相机跟着场景相机一起换，脚底的行和深度换算参数随之变化。 */
    setElevation(next: number) {
      elevation = next;
      aimPixelCamera(camera, CARD_PIXELS, CARD_PIXELS, CARD_FOCUS, next);
    },
    /**
     * facing 是角色在店里面朝的方向（绕竖直轴的角度，0 面朝店门口 +z，π/2 面朝 +x），
     * cameraYaw 是场景相机绕竖直轴转过的角度。角色专用相机不动，角色反过来转 cameraYaw。
     * 脸部像素画只有正面、侧面、背面三张，相对镜头的朝向吸附到最近的 90°（镜头转动途中会跟着跳一档）。
     */
    setFacing(facing: number, cameraYaw: number) {
      character.root.rotation.y = Math.round((facing - cameraYaw) / (Math.PI / 2)) * (Math.PI / 2);
    },
    setLoop(action: PixelActionName) {
      if (currentLoop === action) {
        return;
      }
      currentLoop = action;
      character.play(action);
    },
    playAction(action: PixelActionName) {
      character.play(action);
    },
    setExpression(expression: ExpressionName) {
      character.setExpression(expression);
    },
    showEmote(emote: EmoteName) {
      character.showEmote(emote);
    },
    setOutfit(outfit: OutfitName) {
      character.setOutfit(outfit);
    },
    render(renderer: WebGLRenderer, time: number) {
      character.animate(time);

      const previousTarget = renderer.getRenderTarget();
      const previousClearAlpha = renderer.getClearAlpha();
      renderer.getClearColor(savedClearColor);

      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(rawTarget);
      renderer.clear();
      renderer.render(scene, camera);

      // 法线只要身体网格：情绪符号飘在头顶，不受光，排除在外。
      scene.overrideMaterial = normalMaterial;
      camera.layers.disable(OVERLAY_LAYER);
      renderer.setRenderTarget(normalTarget);
      renderer.clear();
      renderer.render(scene, camera);
      camera.layers.enable(OVERLAY_LAYER);
      scene.overrideMaterial = null;

      renderer.setRenderTarget(outlinedTarget);
      renderer.clear();
      renderer.render(quadScene, quadCamera);

      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(savedClearColor, previousClearAlpha);
    },
    dispose() {
      character.dispose();
      quadGeo.dispose();
      outlineMaterial.dispose();
      rawTarget.dispose();
      normalTarget.dispose();
      normalMaterial.dispose();
      outlinedTarget.dispose();
    },
  };
}

export type LitCharacterCard = ReturnType<typeof createLitCharacterCard>;
