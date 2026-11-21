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
import type { PixelActionName } from "../character/pixel-actions";
import {
  createPixelCamera,
  createPixelCharacter,
  ELEVATION,
  type EmoteName,
  type ExpressionName,
  OVERLAY_LAYER,
  PIXEL,
} from "../character/pixel-character";

export type Direction4 = "down" | "right" | "up" | "left";

export const CARD_PIXELS = 64;

const DIRECTION_YAW: Record<Direction4, number> = {
  down: 0,
  right: Math.PI / 2,
  up: Math.PI,
  left: -Math.PI / 2,
};

/**
 * 将 3D 三渲二像素角色离屏渲染为 64×64 最近邻纹理：
 * 先按角色专用 30° 正交相机对齐脸部像素网格并附加 #3d2a36 描边，再交给喫茶店场景立牌投射 3D 阴影。
 */
export function createLitCharacterCard() {
  const scene = new Scene();
  const camera = createPixelCamera(CARD_PIXELS, CARD_PIXELS);
  const character = createPixelCharacter(camera);
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
      outline: { value: new Color("#3d2a36") },
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
      uniform vec3 outline;
      uniform float depthGap;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(source, vUv);
        vec2 dx = vec2(texel.x, 0.0);
        vec2 dy = vec2(0.0, texel.y);
        if (c.a < 0.5) {
          float edge = max(
            max(texture2D(source, vUv + dx).a, texture2D(source, vUv - dx).a),
            max(texture2D(source, vUv + dy).a, texture2D(source, vUv - dy).a)
          );
          if (edge > 0.5) {
            gl_FragColor = vec4(outline, 1.0);
          } else {
            gl_FragColor = vec4(0.0);
          }
        } else {
          float nearest = min(
            min(texture2D(depth, vUv + dx).r, texture2D(depth, vUv - dx).r),
            min(texture2D(depth, vUv + dy).r, texture2D(depth, vUv - dy).r)
          );
          if (texture2D(depth, vUv).r - nearest > depthGap) {
            c.rgb = mix(c.rgb, outline, 0.6);
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

  const groundNdc = new Vector3(0, 0, 0).project(camera);
  // 脚底外侧还有 1px 轮廓描边，向下多扣 1 格让描边底沿正好落在地板平面。
  const groundRowFromBottom = ((groundNdc.y + 1) / 2) * CARD_PIXELS - 1;
  // 角色脚底所在的竖直平面到相机的距离（沿视线方向），用来把深度贴图换算成「比这个平面靠前还是靠后多少」。
  const forward = camera.getWorldDirection(new Vector3());
  const rootDistance = new Vector3(0, 0, 0).sub(camera.position).dot(forward);

  const savedClearColor = new Color();
  let currentLoop: PixelActionName = "idle";

  return {
    texture: outlinedTarget.texture,
    groundRowFromBottom,
    /** 角色这一层的深度贴图（描边像素没有深度，取相邻像素的）。 */
    depthTexture: rawTarget.depthTexture!,
    /** 角色这一层的法线贴图：相机空间的法线压到 0–1；透明的地方是描边或空白，不参与受光。 */
    normalTexture: normalTarget.texture,
    /**
     * 把深度贴图换算回角色空间距离要用的参数：相机近远平面、脚底平面的距离、
     * 一个贴图像素对应的角色空间尺寸、俯角的正切。立牌着色器据此按像素写入场景深度。
     */
    depthReconstruction: {
      near: camera.near,
      far: camera.far,
      rootDistance,
      pixel: PIXEL,
      tanElevation: Math.tan(ELEVATION),
    },
    setDirection(direction: Direction4) {
      character.root.rotation.y = DIRECTION_YAW[direction];
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
