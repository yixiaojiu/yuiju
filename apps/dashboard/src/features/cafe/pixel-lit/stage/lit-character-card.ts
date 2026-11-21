import {
  Color,
  DepthTexture,
  Mesh,
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
import type { PixelActionName } from "../../scene/pixel-actions";
import {
  createPixelCamera,
  createPixelCharacter,
  type EmoteName,
  type ExpressionName,
} from "../../scene/pixel-character";

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
 * 先按角色专用 35° 正交相机对齐脸部像素网格并附加 #3d2a36 描边，再交给喫茶店场景立牌投射 3D 阴影。
 */
export function createLitCharacterCard() {
  const scene = new Scene();
  const camera = createPixelCamera(CARD_PIXELS, CARD_PIXELS);
  const character = createPixelCharacter(camera);
  scene.add(character.root);

  const rawTarget = new WebGLRenderTarget(CARD_PIXELS, CARD_PIXELS, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthTexture: new DepthTexture(CARD_PIXELS, CARD_PIXELS),
  });
  rawTarget.texture.generateMipmaps = false;

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

  const savedClearColor = new Color();
  let currentLoop: PixelActionName = "idle";

  return {
    texture: outlinedTarget.texture,
    groundRowFromBottom,
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
      outlinedTarget.dispose();
    },
  };
}

export type LitCharacterCard = ReturnType<typeof createLitCharacterCard>;
