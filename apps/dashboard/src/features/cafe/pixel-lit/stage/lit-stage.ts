import {
  ACESFilmicToneMapping,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { PixelActionName } from "../../scene/pixel-actions";
import type { EmoteName, ExpressionName } from "../../scene/pixel-character";
import {
  buildLitCafe,
  LIT_COS,
  LIT_CUSTOMER_RADIUS,
  LIT_OBSTACLES,
  LIT_PIXEL,
  LIT_SIN,
  LIT_WALKABLE,
} from "./lit-cafe-builder";
import {
  CARD_PIXELS,
  createLitCharacterCard,
  type Direction4,
  type LitCharacterCard,
} from "./lit-character-card";
import { createLitLighting, type LightingPresetId } from "./lit-lighting";
import { createLitMaterials } from "./lit-materials";
import { createLitTextures } from "./lit-textures";

const VIEW_GRID = { width: 420, height: 238, minScale: 3 };
const WALK_SPEED = 1.55;
const MAX_RENDER_WIDTH = 2200;

const KEY_TO_DIRECTION: Partial<Record<string, Direction4>> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

const DIRECTION_STEP: Record<Direction4, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

function createGradingPass() {
  return new ShaderPass(
    new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        saturation: { value: 1.08 },
        vignette: { value: 0.32 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float saturation;
        uniform float vignette;
        varying vec2 vUv;
        void main() {
          vec4 tex = texture2D(tDiffuse, vUv);
          float luma = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
          vec3 color = mix(vec3(luma), tex.rgb, saturation);
          vec3 shadowLift = vec3(0.012, 0.008, 0.015) * (1.0 - smoothstep(0.0, 0.32, luma));
          color += shadowLift;
          float edge = smoothstep(0.38, 0.98, length(vUv - 0.5));
          gl_FragColor = vec4(color * (1.0 - edge * vignette), tex.a);
        }
      `,
    }),
  );
}

type CharacterEntity = {
  card: LitCharacterCard;
  mesh: Mesh;
};

/**
 * HD-2D 光影喫茶店舞台：
 * 场景采用真像素家具立牌与 3D 体积光/软阴影，角色复用 3D 三渲二像素小人离屏渲染至 64×64 立牌，仅限四向移动。
 */
export class LitCafeStage {
  private readonly container: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 35);
  private readonly scene = new Scene();
  private readonly textures = createLitTextures();
  private readonly materials = createLitMaterials();
  private readonly cafe: ReturnType<typeof buildLitCafe>;
  private readonly lighting: ReturnType<typeof createLitLighting>;

  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly gradingPass: ShaderPass;

  private readonly characterGeo: PlaneGeometry;
  private readonly yuuno: CharacterEntity;
  private readonly heldMoves: { code: string; dir: Direction4 }[] = [];
  private readonly self = { x: -0.16, z: 1.72, dir: "down" as Direction4 };
  private stationaryLoop: PixelActionName = "idle";
  private readonly onStationaryLoopChange?: (action: PixelActionName) => void;

  private time = 0;
  private lastFrame = performance.now();
  private frameId = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, onStationaryLoopChange?: (action: PixelActionName) => void) {
    this.container = container;
    this.onStationaryLoopChange = onStationaryLoopChange;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    const canvas = this.renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.display = "block";
    container.appendChild(canvas);

    this.cafe = buildLitCafe(this.textures, this.materials);
    this.lighting = createLitLighting(this.cafe);
    this.scene.add(this.cafe.root, this.lighting.lightGroup);
    this.scene.background = this.lighting.background;

    this.characterGeo = new PlaneGeometry(1, 1);
    this.characterGeo.translate(0, 0.5, 0);
    // 将立牌法线向头顶仰起，使其像地面一样接收上方吊灯、左后方窗光及身旁台灯的全向漫反射。
    const normalAttr = this.characterGeo.getAttribute("normal");
    const normalY = 0.95;
    const normalZ = Math.sqrt(1 - normalY * normalY);
    for (let i = 0; i < normalAttr.count; i++) {
      normalAttr.setXYZ(i, 0, normalY, normalZ);
    }
    this.yuuno = this.createCharacter();

    const composerTarget = new WebGLRenderTarget(2, 2, { type: HalfFloatType });
    this.composer = new EffectComposer(this.renderer, composerTarget);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new Vector2(2, 2), 0.34, 0.56, 1.2);
    this.outputPass = new OutputPass();
    this.gradingPass = createGradingPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.gradingPass);

    this.resize();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    this.frameId = requestAnimationFrame(this.tick);
  }

  setPreset(preset: LightingPresetId) {
    this.lighting.applyPreset(preset);
    this.renderer.toneMappingExposure = this.lighting.exposure;
  }

  playOneShot(action: PixelActionName) {
    this.yuuno.card.playAction(action);
  }

  toggleStationaryLoop(action: PixelActionName): PixelActionName {
    this.stationaryLoop = this.stationaryLoop === action ? "idle" : action;
    if (this.heldMoves.length === 0) {
      this.yuuno.card.setLoop(this.stationaryLoop);
    }
    this.onStationaryLoopChange?.(this.stationaryLoop);
    return this.stationaryLoop;
  }

  setExpression(expression: ExpressionName) {
    this.yuuno.card.setExpression(expression);
  }

  showEmote(emote: EmoteName) {
    this.yuuno.card.showEmote(emote);
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.yuuno.card.dispose();
    this.characterGeo.dispose();
    this.bloomPass.dispose();
    this.gradingPass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
    this.lighting.dispose();
    this.cafe.dispose();
    this.materials.dispose();
    this.textures.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private createCharacter(): CharacterEntity {
    const card = createLitCharacterCard();
    const mat = this.materials.spriteCardMaterial(card.texture, 0.04, "#fff6eb");
    const mesh = new Mesh(this.characterGeo, mat);
    mesh.scale.set(CARD_PIXELS * LIT_PIXEL, (CARD_PIXELS * LIT_PIXEL) / LIT_COS, 1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return { card, mesh };
  }

  private placeCharacter(entity: CharacterEntity, x: number, z: number) {
    const depthStep = LIT_PIXEL / LIT_SIN;
    const snappedX = Math.round(x / LIT_PIXEL) * LIT_PIXEL;
    const snappedZ = Math.round(z / depthStep) * depthStep;
    entity.mesh.position.set(
      snappedX,
      -(entity.card.groundRowFromBottom * LIT_PIXEL) / LIT_COS,
      snappedZ,
    );
  }

  private resize = () => {
    const clientW = Math.max(1, this.container.clientWidth);
    const clientH = Math.max(1, this.container.clientHeight);
    const scale = Math.max(
      VIEW_GRID.minScale,
      Math.floor(Math.min(clientW / VIEW_GRID.width, clientH / VIEW_GRID.height)),
    );
    const pixelW = 2 * Math.ceil(clientW / scale / 2);
    const pixelH = 2 * Math.ceil(clientH / scale / 2);

    this.camera.left = (-pixelW * LIT_PIXEL) / 2;
    this.camera.right = (pixelW * LIT_PIXEL) / 2;
    this.camera.top = (pixelH * LIT_PIXEL) / 2;
    this.camera.bottom = (-pixelH * LIT_PIXEL) / 2;
    this.camera.updateProjectionMatrix();

    const center = new Vector3(0, 1.04, -0.32);
    this.camera.position.set(center.x, center.y + 16 * LIT_SIN, center.z + 16 * LIT_COS);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld();

    const cssW = pixelW * scale;
    const cssH = pixelH * scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dprScale = Math.min(dpr, MAX_RENDER_WIDTH / Math.max(1, cssW));
    const renderW = Math.max(2, Math.round(cssW * dprScale));
    const renderH = Math.max(2, Math.round(cssH * dprScale));

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(renderW, renderH, false);
    this.composer.setSize(renderW, renderH);
    this.bloomPass.setSize(renderW, renderH);

    const canvas = this.renderer.domElement;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.style.left = `${Math.floor((clientW - cssW) / 2)}px`;
    canvas.style.top = `${Math.floor((clientH - cssH) / 2)}px`;
  };

  private tick = (now: number) => {
    this.frameId = requestAnimationFrame(this.tick);
    const dt = Math.min(0.06, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;

    this.cafe.fanBlades.rotation.y = this.time * 0.85;
    this.lighting.update(this.time);

    const walking = this.moveFourWay(dt);
    this.yuuno.card.setDirection(this.self.dir);
    this.yuuno.card.setLoop(walking ? "walk" : this.stationaryLoop);
    this.placeCharacter(this.yuuno, this.self.x, this.self.z);
    this.yuuno.card.render(this.renderer, this.time);

    this.composer.render();
  };

  /** 严格四向移动：只响应最近按下的单一方向键，不允许斜向位移与斜向朝向。 */
  private moveFourWay(dt: number): boolean {
    const active = this.heldMoves.at(-1);
    if (!active) {
      return false;
    }
    this.self.dir = active.dir;
    if (this.stationaryLoop !== "idle") {
      this.stationaryLoop = "idle";
      this.onStationaryLoopChange?.("idle");
    }
    const [dx, dz] = DIRECTION_STEP[active.dir];
    const nextX = this.self.x + dx * WALK_SPEED * dt;
    const nextZ = this.self.z + dz * WALK_SPEED * dt;
    if (!this.blocked(nextX, nextZ)) {
      this.self.x = nextX;
      this.self.z = nextZ;
    }
    return true;
  }

  private blocked(x: number, z: number) {
    if (
      x < LIT_WALKABLE.minX ||
      x > LIT_WALKABLE.maxX ||
      z < LIT_WALKABLE.minZ ||
      z > LIT_WALKABLE.maxZ
    ) {
      return true;
    }
    return LIT_OBSTACLES.some((rect) => {
      const nx = Math.min(Math.max(x, rect.minX), rect.maxX);
      const nz = Math.min(Math.max(z, rect.minZ), rect.maxZ);
      return Math.hypot(x - nx, z - nz) < LIT_CUSTOMER_RADIUS;
    });
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      return;
    }
    const dir = KEY_TO_DIRECTION[event.code];
    if (dir) {
      event.preventDefault();
      if (!this.heldMoves.some((item) => item.code === event.code)) {
        this.heldMoves.push({ code: event.code, dir });
      }
      return;
    }
    if (!event.repeat) {
      if (event.code === "Digit1") {
        this.playOneShot("wave");
      } else if (event.code === "Digit2") {
        this.playOneShot("bow");
      } else if (event.code === "Digit3") {
        this.playOneShot("serve");
      } else if (event.code === "Digit4") {
        this.toggleStationaryLoop("wipe");
      } else if (event.code === "Digit5") {
        this.showEmote("heart");
      }
    }
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    const index = this.heldMoves.findIndex((item) => item.code === event.code);
    if (index !== -1) {
      this.heldMoves.splice(index, 1);
    }
  };

  private handleBlur = () => {
    this.heldMoves.length = 0;
  };
}
