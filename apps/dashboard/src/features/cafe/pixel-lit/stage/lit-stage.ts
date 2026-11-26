import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CircleGeometry,
  Color,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  NeutralToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  RGBADepthPacking,
  Scene,
  ShaderMaterial,
  type ToneMapping,
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
import type { OutfitName } from "../character/character-design";
import type { PixelActionName } from "../character/pixel-actions";
import type { EmoteName, ExpressionName } from "../character/pixel-character";
import {
  buildLitCafe,
  LIT_CUSTOMER_RADIUS,
  LIT_OBSTACLES,
  LIT_PIXEL,
  LIT_ROOM,
  LIT_WALKABLE,
  type LitWallSide,
} from "./lit-cafe-builder";
import { CARD_PIXELS, createLitCharacterCard, type LitCharacterCard } from "./lit-character-card";
import { createLitLighting } from "./lit-lighting";
import { createLitMaterials } from "./lit-materials";
import { PixelRenderPass } from "./lit-pixel-pass";
import { createLitTextures } from "./lit-textures";
import { LIT_PRESETS, type LitTuning, type ToneMappingName } from "./lit-tuning";

const VIEW_GRID = { width: 336, height: 190, minScale: 3 };
const TONE_MAPPINGS: Record<ToneMappingName, ToneMapping> = {
  neutral: NeutralToneMapping,
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
};
/** 走路、跑步（按住 Shift）的移动速度，米每秒。都是小碎步，速度和步频对得上，脚下不打滑。 */
const WALK_SPEED = 1.15;
const RUN_SPEED = 2.4;

/**
 * 四个视角：相机从店的正面开始，每档绕店中心转 90°（从上往下看是逆时针）。
 * 转动过程是连续的，只停在这四档：像素画只有正面、侧面、背面，斜着停下来就缺一张图。
 */
export type LitViewName = "front" | "right" | "back" | "left";
/** 相机状态：水平视角和俯视角（度）。 */
export type LitCameraState = { view: LitViewName; elevation: number };
const VIEWS: readonly LitViewName[] = ["front", "right", "back", "left"];
/** 相机转一档（90°）用的秒数。 */
const VIEW_TURN_SECONDS = 0.36;
/** 四面墙朝店外的方向（x, z）：镜头在墙外侧时，这面墙挡在镜头前面，要藏起来。 */
const WALL_OUTWARD: Record<LitWallSide, readonly [number, number]> = {
  back: [0, -1],
  left: [-1, 0],
  right: [1, 0],
  front: [0, 1],
};
/**
 * 俯视角在 0°~30° 之间连续可调（度）：0° 是平视，像横版游戏只看到立面；30° 是上限也是开局角度，
 * 贴图和家具按它设计。再高的话，脸部像素画始终按屏幕方向投影，角色会像在仰头看镜头。
 */
const MAX_ELEVATION = 30;
/** 按住 R/F 时俯视角每秒变化的度数：从 0° 调到 30° 大约 1.2 秒。 */
const ELEVATION_SPEED = 25;
/** 镜头跟着玩家走，画面中心对准角色的半身高（米）。 */
const FOLLOW_HEIGHT = 0.55;
const MAX_RENDER_WIDTH = 2200;

/** 屏幕上的四个移动方向：W 总是往屏幕上方走。 */
type ScreenDirection = "up" | "down" | "left" | "right";

const KEY_TO_DIRECTION: Partial<Record<string, ScreenDirection>> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

/**
 * 相机在正面时，往各个屏幕方向走对应的朝向角度（0 面朝镜头往 +z 走，π/2 往 +x 走）。
 * 相机转了多少，世界里的朝向就跟着加多少。
 */
const SCREEN_DIRECTION_YAW: Record<ScreenDirection, number> = {
  down: 0,
  right: Math.PI / 2,
  up: Math.PI,
  left: -Math.PI / 2,
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
  material: ShaderMaterial;
  shadowMaterials: [MeshDepthMaterial, MeshDistanceMaterial];
  /** 脚下的落地阴影。 */
  footShadow: Mesh<CircleGeometry, MeshBasicMaterial>;
};

/**
 * 光影喫茶店舞台：3D 场景按像素网格渲染，镜头跟着玩家走；
 * 角色复用 3D 三渲二像素小人离屏渲染至 64×64 立牌，仅限四向移动。
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
  private readonly pixelPass: PixelRenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly gradingPass: ShaderPass;

  private readonly characterGeo: PlaneGeometry;
  private readonly yuuno: CharacterEntity;
  /** 按住的移动键，dir 是屏幕方向，移动时按当前相机角度换算成世界里的朝向。 */
  private readonly heldMoves: { code: string; dir: ScreenDirection }[] = [];
  /** 按住 Shift 时跑步。 */
  private running = false;
  // 开局站在吧台里、后厨门前，面朝顾客。facing 是世界里的朝向角度。
  private readonly self = { x: 0.7, z: -2.05, facing: 0 };
  /** 相机环绕和对准的中心，每帧跟着玩家重新算。 */
  private readonly viewCenter = new Vector3();
  /** 相机要转到的档位：每档 90°，不取模，往一个方向连续转几圈也能顺着转过去。 */
  private viewTarget = 0;
  /** 相机当前绕竖直轴转过的角度（弧度），每帧朝 viewTarget 那一档匀速转。 */
  private viewYaw = 0;
  /** 按住 Q（-1）或 E（1）时，转到一档后接着转下一档；松开为 0。 */
  private heldTurn: 1 | -1 | 0 = 0;
  /** 当前俯视角（度）。 */
  private elevationDegrees = MAX_ELEVATION;
  /** 按住 R（1）或 F（-1）时俯视角持续抬高或压低；松开为 0。 */
  private heldTilt: 1 | -1 | 0 = 0;
  private readonly onCameraChange?: (camera: LitCameraState) => void;
  private stationaryLoop: PixelActionName = "idle";
  private tuning: LitTuning = LIT_PRESETS.afternoon;
  private readonly onStationaryLoopChange?: (action: PixelActionName) => void;

  private time = 0;
  private lastFrame = performance.now();
  private frameId = 0;
  private readonly resizeObserver: ResizeObserver;

  /** outfit 是角色一开始穿的衣服，之后用 setOutfit 切换。 */
  constructor(
    container: HTMLElement,
    outfit: OutfitName,
    onStationaryLoopChange?: (action: PixelActionName) => void,
    onCameraChange?: (camera: LitCameraState) => void,
  ) {
    this.container = container;
    this.onStationaryLoopChange = onStationaryLoopChange;
    this.onCameraChange = onCameraChange;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    // PCF 阴影才能按 shadow.radius 调软硬。
    this.renderer.shadowMap.type = PCFShadowMap;

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
    this.yuuno = this.createCharacter(outfit);

    const composerTarget = new WebGLRenderTarget(2, 2, { type: HalfFloatType });
    this.composer = new EffectComposer(this.renderer, composerTarget);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.pixelPass = new PixelRenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new Vector2(2, 2), 0.34, 0.56, 1.2);
    this.outputPass = new OutputPass();
    this.gradingPass = createGradingPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.pixelPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.gradingPass);

    this.applyTuning(this.tuning);
    this.resize();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    this.frameId = requestAnimationFrame(this.tick);
  }

  /** 应用一整套调光参数：灯光、色调映射和曝光、泛光、调色、渲染方式；角色受光在每帧按位置采样。 */
  applyTuning(tuning: LitTuning) {
    this.tuning = tuning;
    this.lighting.apply(tuning);
    this.renderer.toneMapping = TONE_MAPPINGS[tuning.toneMapping];
    this.renderer.toneMappingExposure = tuning.exposure;
    this.bloomPass.strength = tuning.bloomStrength;
    this.bloomPass.radius = tuning.bloomRadius;
    this.bloomPass.threshold = tuning.bloomThreshold;
    this.gradingPass.uniforms.saturation.value = tuning.saturation;
    this.gradingPass.uniforms.vignette.value = tuning.vignette;
    this.renderPass.enabled = tuning.renderMode === "full";
    this.pixelPass.enabled = tuning.renderMode === "pixel";
    // 像素网格下一个画面像素放大了好几倍，浮尘和蒸汽按 1 个像素格左右的大小画。
    this.lighting.setPointScale(tuning.renderMode === "pixel" ? 0.4 : 1);
    this.yuuno.footShadow.material.opacity = tuning.characterContactShadow;
    this.updateCharacterLighting();
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

  setOutfit(outfit: OutfitName) {
    this.yuuno.card.setOutfit(outfit);
  }

  /** 视角转一档（90°）：1 是相机往店的右侧转，-1 往左侧转。相机在之后几帧里平滑转过去。 */
  rotateView(step: 1 | -1) {
    this.viewTarget += step;
    this.reportCamera();
  }

  /** 开始或停止调俯视角：1 抬高（更俯瞰），-1 压低（更平视），0 停在当前角度。 */
  holdTilt(direction: 1 | -1 | 0) {
    this.heldTilt = direction;
  }

  /**
   * 按住时俯视角匀速变化，到 0° 或 30° 停住。
   * 场景相机和角色专用相机一起换，角色立牌按新角度换算脚底位置和深度。
   */
  private tiltCamera(dt: number) {
    if (this.heldTilt === 0) {
      return;
    }
    const next = Math.min(
      Math.max(this.elevationDegrees + this.heldTilt * ELEVATION_SPEED * dt, 0),
      MAX_ELEVATION,
    );
    if (next === this.elevationDegrees) {
      return;
    }
    this.elevationDegrees = next;
    const { card, material } = this.yuuno;
    card.setElevation(this.elevation);
    const { rootDistance, tanElevation } = card.depthReconstruction;
    material.uniforms.groundRow.value = card.groundRowFromBottom;
    material.uniforms.cameraRange.value.z = rootDistance;
    material.uniforms.tanElevation.value = tanElevation;
    this.reportCamera();
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.yuuno.card.dispose();
    this.yuuno.material.dispose();
    for (const material of this.yuuno.shadowMaterials) {
      material.dispose();
    }
    this.yuuno.footShadow.geometry.dispose();
    this.yuuno.footShadow.material.dispose();
    this.characterGeo.dispose();
    this.pixelPass.dispose();
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

  /**
   * 角色立牌，三件事都在这块平面上完成：
   * - 受光：按角色每个像素的法线，用和场景材质相同的公式计算环境光、天光、窗光、各盏点光源和聚光灯，
   *   朝灯的一侧亮、背光的一侧暗，冷暖色跟着灯走；角色自带的固定明暗已关掉。
   * - 遮挡：按角色那一层的深度逐像素写入场景深度，手伸到台面上方、端着的杯子、被吧台挡住的下半身都按像素遮挡。
   * - 阴影：渲染阴影时立牌临时转过去正对那盏灯，每盏灯投出的都是完整的剪影，不会被侧光拉扯变形。
   */
  private createCharacter(outfit: OutfitName): CharacterEntity {
    const card = createLitCharacterCard(outfit);
    const { near, far, rootDistance, pixel, tanElevation } = card.depthReconstruction;
    const { points, spots } = this.lighting.characterLights;
    const vectors = (count: number) => Array.from({ length: count }, () => new Vector3());
    const pairs = (count: number) => Array.from({ length: count }, () => new Vector2());
    const material = new ShaderMaterial({
      uniforms: {
        map: { value: card.texture },
        characterDepth: { value: card.depthTexture },
        normalMap: { value: card.normalTexture },
        texel: { value: 1 / CARD_PIXELS },
        groundRow: { value: card.groundRowFromBottom },
        cameraRange: { value: new Vector3(near, far, rootDistance) },
        characterPixel: { value: pixel },
        tanElevation: { value: tanElevation },
        sceneScale: { value: LIT_PIXEL / pixel },
        sceneDepthRange: { value: this.camera.far - this.camera.near },
        cameraForward: { value: new Vector3() },
        ambientColor: { value: new Color() },
        hemiSky: { value: new Color() },
        hemiGround: { value: new Color() },
        sunColor: { value: new Color() },
        sunDirection: { value: new Vector3() },
        pointPositions: { value: vectors(points.length) },
        pointColors: { value: vectors(points.length) },
        pointRanges: { value: pairs(points.length) },
        spotPositions: { value: vectors(spots.length) },
        spotColors: { value: vectors(spots.length) },
        spotRanges: { value: pairs(spots.length) },
        spotDirections: { value: vectors(spots.length) },
        spotCones: { value: pairs(spots.length) },
        lightStrength: { value: 1 },
        minLight: { value: 0 },
        maxLight: { value: 0 },
        bands: { value: 0 },
      },
      defines: { POINT_COUNT: points.length, SPOT_COUNT: spots.length },
      vertexShader: `
        varying vec2 vUv; varying vec3 vWorld;
        void main(){
          vUv=uv;
          vec4 world=modelMatrix*vec4(position,1.);
          vWorld=world.xyz;
          gl_Position=projectionMatrix*viewMatrix*world;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform sampler2D characterDepth; uniform sampler2D normalMap; uniform float texel;
        uniform float groundRow; uniform vec3 cameraRange; uniform float characterPixel;
        uniform float tanElevation; uniform float sceneScale; uniform float sceneDepthRange; uniform vec3 cameraForward;
        uniform vec3 ambientColor; uniform vec3 hemiSky; uniform vec3 hemiGround;
        uniform vec3 sunColor; uniform vec3 sunDirection;
        uniform vec3 pointPositions[POINT_COUNT]; uniform vec3 pointColors[POINT_COUNT]; uniform vec2 pointRanges[POINT_COUNT];
        uniform vec3 spotPositions[SPOT_COUNT]; uniform vec3 spotColors[SPOT_COUNT]; uniform vec2 spotRanges[SPOT_COUNT];
        uniform vec3 spotDirections[SPOT_COUNT]; uniform vec2 spotCones[SPOT_COUNT];
        uniform float lightStrength; uniform float minLight; uniform float maxLight; uniform float bands;
        varying vec2 vUv; varying vec3 vWorld;

        // 和 three.js 点光源、聚光灯的物理衰减一致：range.x 是照射距离，range.y 是衰减指数。
        float falloff(float distance, vec2 range){
          float cutoff=range.x>0. ? pow(clamp(1.-pow(distance/range.x,4.),0.,1.),2.) : 1.;
          return cutoff/max(pow(distance,range.y),.01);
        }

        void main(){
          vec4 color=texture2D(map,vUv);
          if(color.a<.5)discard;
          // 描边像素没有深度，取相邻像素里最近的；头顶的情绪符号四周都没有深度，就当作在立牌平面上。
          float depth=texture2D(characterDepth,vUv).r;
          if(depth>=1.){
            depth=min(
              min(texture2D(characterDepth,vUv+vec2(texel,0.)).r,texture2D(characterDepth,vUv-vec2(texel,0.)).r),
              min(texture2D(characterDepth,vUv+vec2(0.,texel)).r,texture2D(characterDepth,vUv-vec2(0.,texel)).r));
          }
          float offset=0.;
          if(depth<1.){
            // 这个像素沿视线比脚底平面靠后多少，再扣掉立牌平面在这一行本身的前后位置：竖直平面越往上越靠近相机。
            float along=cameraRange.x+depth*(cameraRange.y-cameraRange.x)-cameraRange.z;
            float rise=(vUv.y/texel-groundRow)*characterPixel;
            offset=(along+rise*tanElevation)*sceneScale;
          }
          // 正交相机的深度和距离成正比，直接按距离差换算。
          gl_FragDepth=gl_FragCoord.z+offset/sceneDepthRange;

          // 身体按法线受光。描边像素自己没有法线，借相邻像素的法线一起受光，暗处变暗、灯下变暖；
          // 头顶的情绪符号四周都没有法线，保持原色。
          vec3 shaded=color.rgb;
          vec4 packed=texture2D(normalMap,vUv);
          if(packed.a<.5){packed=texture2D(normalMap,vUv+vec2(texel,0.));}
          if(packed.a<.5){packed=texture2D(normalMap,vUv-vec2(texel,0.));}
          if(packed.a<.5){packed=texture2D(normalMap,vUv+vec2(0.,texel));}
          if(packed.a<.5){packed=texture2D(normalMap,vUv-vec2(0.,texel));}
          if(packed.a>.5){
            vec3 n=normalize(transpose(mat3(viewMatrix))*(packed.xyz*2.-1.));
            vec3 p=vWorld+cameraForward*offset;
            vec3 irradiance=ambientColor+mix(hemiGround,hemiSky,.5*n.y+.5)+sunColor*max(dot(n,sunDirection),0.);
            for(int i=0;i<POINT_COUNT;i++){
              vec3 l=pointPositions[i]-p;
              float d=length(l);
              irradiance+=pointColors[i]*falloff(d,pointRanges[i])*max(dot(n,l/d),0.);
            }
            for(int i=0;i<SPOT_COUNT;i++){
              vec3 l=spotPositions[i]-p;
              float d=length(l);
              float cone=smoothstep(spotCones[i].x,spotCones[i].y,dot(l/d,spotDirections[i]));
              irradiance+=spotColors[i]*falloff(d,spotRanges[i])*cone*max(dot(n,l/d),0.);
            }
            // 漫反射按 Lambert（除以 π），和场景材质一致；再按面板设置放大、限定上下限、分档。
            vec3 level=max(irradiance*.3183099*lightStrength,vec3(minLight));
            // 浅色衣服离灯很近时会被照得发白并触发泛光，超过上限按亮度整体缩回，保留灯光的颜色。
            float luminance=dot(level,vec3(.2126,.7152,.0722));
            level*=min(1.,maxLight/max(luminance,1e-4));
            if(bands>.5){
              luminance=dot(level,vec3(.2126,.7152,.0722));
              level*=(ceil(luminance*bands)/bands)/max(luminance,1e-4);
            }
            shaded=color.rgb*level;
          }
          gl_FragColor=vec4(shaded,1.);
          #include <colorspace_fragment>
        }`,
    });

    // 渲染阴影时立牌转过去正对阴影相机，也就是那盏灯：按立牌中心到灯的水平方向重新摆放四个顶点。
    const faceLight = (shader: { vertexShader: string }) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        `vec4 cardCenter=modelMatrix*vec4(0.,0.,0.,1.);
        vec2 toLight=normalize(cameraPosition.xz-cardCenter.xz);
        vec3 across=vec3(toLight.y,0.,-toLight.x);
        vec3 cardWorld=cardCenter.xyz+across*transformed.x*length(modelMatrix[0].xyz)+vec3(0.,transformed.y*length(modelMatrix[1].xyz),0.);
        vec4 mvPosition=viewMatrix*vec4(cardWorld,1.);
        gl_Position=projectionMatrix*mvPosition;`,
      );
    };
    const depthMaterial = new MeshDepthMaterial({
      depthPacking: RGBADepthPacking,
      map: card.texture,
      alphaTest: 0.5,
    });
    depthMaterial.onBeforeCompile = faceLight;
    // 点光源的阴影按到灯的距离记录，世界坐标也要换成转过去之后的位置。
    const distanceMaterial = new MeshDistanceMaterial({ map: card.texture, alphaTest: 0.5 });
    distanceMaterial.onBeforeCompile = (shader) => {
      faceLight(shader);
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        "vec4 worldPosition=vec4(cardWorld,1.);",
      );
    };

    const mesh = new Mesh(this.characterGeo, material);
    mesh.scale.x = CARD_PIXELS * LIT_PIXEL;
    mesh.castShadow = true;
    mesh.customDepthMaterial = depthMaterial;
    mesh.customDistanceMaterial = distanceMaterial;
    this.scene.add(mesh);

    // 落地阴影：贴在地板和地毯上方一点的半透明暗色椭圆，跟着角色走，角色才像站在地上。
    // 灯光投下的剪影在多灯的地方会被冲淡，这块阴影不受灯光影响，始终压在脚下。
    // 大小和角色预览页一致：屏幕上左右 9 像素、上下 3.5 像素；地面的前后方向在 30° 俯视下缩成 sin30。
    const footShadow = new Mesh(
      new CircleGeometry(1, 24).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: "#000000", transparent: true, depthWrite: false }),
    );
    footShadow.scale.x = 9 * LIT_PIXEL;
    footShadow.position.y = 0.012;
    this.scene.add(footShadow);
    return {
      card,
      mesh,
      material,
      shadowMaterials: [depthMaterial, distanceMaterial],
      footShadow,
    };
  }

  /** 把当前各盏灯的位置、颜色、强度、照射范围写进角色立牌的受光参数。调光参数改变后调用。 */
  private updateCharacterLighting() {
    const uniforms = this.yuuno.material.uniforms;
    const { ambient, hemi, sun, points, spots } = this.lighting.characterLights;
    uniforms.ambientColor.value.copy(ambient.color).multiplyScalar(ambient.intensity);
    uniforms.hemiSky.value.copy(hemi.color).multiplyScalar(hemi.intensity);
    uniforms.hemiGround.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity);
    uniforms.sunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
    uniforms.sunDirection.value.subVectors(sun.position, sun.target.position).normalize();
    for (const [index, light] of points.entries()) {
      uniforms.pointPositions.value[index].copy(light.position);
      uniforms.pointColors.value[index]
        .set(light.color.r, light.color.g, light.color.b)
        .multiplyScalar(light.intensity);
      uniforms.pointRanges.value[index].set(light.distance, light.decay);
    }
    for (const [index, light] of spots.entries()) {
      uniforms.spotPositions.value[index].copy(light.position);
      uniforms.spotColors.value[index]
        .set(light.color.r, light.color.g, light.color.b)
        .multiplyScalar(light.intensity);
      uniforms.spotRanges.value[index].set(light.distance, light.decay);
      uniforms.spotDirections.value[index]
        .subVectors(light.position, light.target.position)
        .normalize();
      uniforms.spotCones.value[index].set(
        Math.cos(light.angle),
        Math.cos(light.angle * (1 - light.penumbra)),
      );
    }
    uniforms.lightStrength.value = this.tuning.characterLightStrength;
    uniforms.minLight.value = this.tuning.characterMinLight;
    uniforms.maxLight.value = this.tuning.characterMaxLight;
    uniforms.bands.value = this.tuning.characterBands;
  }

  /** 当前俯视角（弧度）。 */
  private get elevation() {
    return (this.elevationDegrees * Math.PI) / 180;
  }

  private reportCamera() {
    this.onCameraChange?.({
      view: VIEWS[((this.viewTarget % VIEWS.length) + VIEWS.length) % VIEWS.length],
      elevation: Math.round(this.elevationDegrees),
    });
  }

  /** 相机绕竖直轴转过的角度：正面为 0。 */
  private get cameraYaw() {
    return this.viewYaw;
  }

  /** 相机朝目标档位匀速转；转到了而 Q/E 还按着，就接着转下一档。 */
  private turnCamera(dt: number) {
    const goal = (this.viewTarget * Math.PI) / 2;
    if (this.viewYaw === goal) {
      return;
    }
    const step = (Math.PI / 2 / VIEW_TURN_SECONDS) * dt;
    this.viewYaw =
      Math.abs(goal - this.viewYaw) <= step
        ? goal
        : this.viewYaw + Math.sign(goal - this.viewYaw) * step;
    if (this.viewYaw === goal && this.heldTurn !== 0) {
      this.rotateView(this.heldTurn);
    }
  }

  /**
   * 落点对齐屏幕像素，像素网格从世界原点量起，和相机中心对齐的是同一套：
   * 沿屏幕左右方向对齐 1 个像素；前后方向不取整（低俯视角下一个屏幕像素对应很长一段地面，
   * 取整会把角色挪出去很远、遮挡错位），而是把立牌上下挪不到 1 个像素，让脚底落在屏幕像素行上：
   * 立牌竖直挪 h，屏幕上挪 h·cos(俯角)。
   */
  private placeCharacter(entity: CharacterEntity, x: number, z: number) {
    const sin = Math.sin(this.cameraYaw);
    const cos = Math.cos(this.cameraYaw);
    const across = Math.round((x * cos - z * sin) / LIT_PIXEL) * LIT_PIXEL;
    const toward = x * sin + z * cos;
    const drop = toward * Math.sin(this.elevation);
    const lift = (drop - Math.round(drop / LIT_PIXEL) * LIT_PIXEL) / Math.cos(this.elevation);
    const placedX = across * cos + toward * sin;
    const placedZ = -across * sin + toward * cos;
    entity.mesh.position.set(
      placedX,
      lift - (entity.card.groundRowFromBottom * LIT_PIXEL) / Math.cos(this.elevation),
      placedZ,
    );
    entity.footShadow.position.x = placedX;
    entity.footShadow.position.z = placedZ;
  }

  /**
   * 相机对准玩家，转到当前视角和俯角；角色立牌和脚下阴影转向镜头并按俯角缩放，挡在镜头前的墙藏起来。
   *
   * 屏幕坐标用 across（向右）和 rise（向上）：一个世界点的 rise = 高度·cos(俯角) − 朝镜头的距离·sin(俯角)。
   * - 跟随：中心的 across、rise 取角色的位置和半身高。
   * - 不出店：店在某个方向比画面大时，中心限制在画面边缘不超出店外沿的范围里；比画面小时，店在画面里居中。
   *   画面最高处是远端的墙顶，最低处是近端的地面（近端的墙藏起来了）。
   * - 不闪：中心的 across、rise 都取整到 1 个像素，镜头移动时整幅画面按整像素平移。
   * 中心取在角色那一层进深上，高度按 rise 反推；正交相机沿视线前后挪中心，画面不变。
   */
  private aimCamera() {
    const yaw = this.cameraYaw;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const cos = Math.cos(this.elevation);
    const sin = Math.sin(this.elevation);
    const across = (x: number, z: number) => x * cosYaw - z * sinYaw;
    const toward = (x: number, z: number) => x * sinYaw + z * cosYaw;
    const corners = [
      [LIT_ROOM.minX, LIT_ROOM.minZ],
      [LIT_ROOM.maxX, LIT_ROOM.minZ],
      [LIT_ROOM.minX, LIT_ROOM.maxZ],
      [LIT_ROOM.maxX, LIT_ROOM.maxZ],
    ] as const;
    const roomAcross = corners.map(([x, z]) => across(x, z));
    const roomToward = corners.map(([x, z]) => toward(x, z));
    const fit = (value: number, min: number, max: number, half: number) =>
      max - min <= 2 * half ? (min + max) / 2 : Math.min(Math.max(value, min + half), max - half);
    const selfToward = toward(this.self.x, this.self.z);
    const centerAcross =
      Math.round(
        fit(
          across(this.self.x, this.self.z),
          Math.min(...roomAcross),
          Math.max(...roomAcross),
          this.camera.right,
        ) / LIT_PIXEL,
      ) * LIT_PIXEL;
    const centerRise =
      Math.round(
        fit(
          FOLLOW_HEIGHT * cos - selfToward * sin,
          Math.min(...roomToward.map((t) => -t * sin)),
          Math.max(...roomToward.map((t) => LIT_ROOM.wallHeight * cos - t * sin)),
          this.camera.top,
        ) / LIT_PIXEL,
      ) * LIT_PIXEL;
    this.viewCenter.set(
      centerAcross * cosYaw + selfToward * sinYaw,
      (centerRise + selfToward * sin) / cos,
      -centerAcross * sinYaw + selfToward * cosYaw,
    );

    this.camera.position.set(
      this.viewCenter.x + 16 * cos * sinYaw,
      this.viewCenter.y + 16 * sin,
      this.viewCenter.z + 16 * cos * cosYaw,
    );
    this.camera.lookAt(this.viewCenter);
    this.camera.updateMatrixWorld();
    this.camera.getWorldDirection(this.yuuno.material.uniforms.cameraForward.value);
    this.yuuno.mesh.rotation.y = yaw;
    // 立牌是竖直的平面，俯视下高度缩成 cos，放大回来正好一格对一个屏幕像素；脚下阴影同理按 sin。
    this.yuuno.mesh.scale.y = (CARD_PIXELS * LIT_PIXEL) / cos;
    this.yuuno.footShadow.rotation.y = yaw;
    // 0° 平视时地面是一条线，脚下阴影看不到，藏起来。
    this.yuuno.footShadow.visible = this.elevation > 0;
    // 15° 以下按 sin 放大会在地面上拉成很长一条，保持 15° 时的地面大小，屏幕上随俯视角压扁。
    this.yuuno.footShadow.scale.z = (3.5 * LIT_PIXEL) / Math.max(sin, Math.sin(Math.PI / 12));
    this.cafe.cutAwayWalls(
      (["back", "left", "right", "front"] as const).filter(
        (side) => WALL_OUTWARD[side][0] * sinYaw + WALL_OUTWARD[side][1] * cosYaw > 0.01,
      ),
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

    const cssW = pixelW * scale;
    const cssH = pixelH * scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dprScale = Math.min(dpr, MAX_RENDER_WIDTH / Math.max(1, cssW));
    const renderW = Math.max(2, Math.round(cssW * dprScale));
    const renderH = Math.max(2, Math.round(cssH * dprScale));

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(renderW, renderH, false);
    this.pixelPass.setPixelSize(pixelW, pixelH);
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

    this.lighting.update(this.time);

    this.turnCamera(dt);
    this.tiltCamera(dt);
    const walking = this.moveFourWay(dt);
    this.aimCamera();
    this.yuuno.card.setFacing(this.self.facing, this.cameraYaw);
    this.yuuno.card.setLoop(walking ? (this.running ? "run" : "walk") : this.stationaryLoop);
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
    // 屏幕方向换成世界里的朝向：按相机要停的那一档换算，转动途中也只沿店里的四个方向走，
    // 朝向始终是 90° 的整数倍，停下来后和镜头的相对朝向正好是正面、侧面或背面。
    this.self.facing = SCREEN_DIRECTION_YAW[active.dir] + (this.viewTarget * Math.PI) / 2;
    if (this.stationaryLoop !== "idle") {
      this.stationaryLoop = "idle";
      this.onStationaryLoopChange?.("idle");
    }
    const speed = this.running ? RUN_SPEED : WALK_SPEED;
    const nextX = this.self.x + Math.sin(this.self.facing) * speed * dt;
    const nextZ = this.self.z + Math.cos(this.self.facing) * speed * dt;
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
    this.running = event.shiftKey;
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
      if (event.code === "KeyQ") {
        this.heldTurn = -1;
        this.rotateView(-1);
      } else if (event.code === "KeyE") {
        this.heldTurn = 1;
        this.rotateView(1);
      } else if (event.code === "KeyR") {
        this.holdTilt(1);
      } else if (event.code === "KeyF") {
        this.holdTilt(-1);
      } else if (event.code === "Digit1") {
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
    this.running = event.shiftKey;
    const index = this.heldMoves.findIndex((item) => item.code === event.code);
    if (index !== -1) {
      this.heldMoves.splice(index, 1);
    }
    if (
      (event.code === "KeyQ" && this.heldTurn === -1) ||
      (event.code === "KeyE" && this.heldTurn === 1)
    ) {
      this.heldTurn = 0;
    }
    if (
      (event.code === "KeyR" && this.heldTilt === 1) ||
      (event.code === "KeyF" && this.heldTilt === -1)
    ) {
      this.heldTilt = 0;
    }
  };

  private handleBlur = () => {
    this.heldMoves.length = 0;
    this.heldTurn = 0;
    this.heldTilt = 0;
    this.running = false;
  };
}
