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
import { createLitLighting } from "./lit-lighting";
import { createLitMaterials } from "./lit-materials";
import { PixelRenderPass } from "./lit-pixel-pass";
import { createLitTextures } from "./lit-textures";
import { LIT_PRESETS, type LitTuning, type ToneMappingName } from "./lit-tuning";

const VIEW_GRID = { width: 420, height: 238, minScale: 3 };
const TONE_MAPPINGS: Record<ToneMappingName, ToneMapping> = {
  neutral: NeutralToneMapping,
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
};
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
  material: ShaderMaterial;
  shadowMaterials: [MeshDepthMaterial, MeshDistanceMaterial];
  /** 脚下的落地阴影。 */
  footShadow: Mesh<CircleGeometry, MeshBasicMaterial>;
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
  private readonly pixelPass: PixelRenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly gradingPass: ShaderPass;

  private readonly characterGeo: PlaneGeometry;
  private readonly yuuno: CharacterEntity;
  private readonly heldMoves: { code: string; dir: Direction4 }[] = [];
  // 开局站在吧台里、前台后面，面朝顾客；左右避开台面上的蛋糕和面包篮。
  private readonly self = { x: -0.5, z: 0.05, dir: "down" as Direction4 };
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
  ) {
    this.container = container;
    this.onStationaryLoopChange = onStationaryLoopChange;
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
    mesh.scale.set(CARD_PIXELS * LIT_PIXEL, (CARD_PIXELS * LIT_PIXEL) / LIT_COS, 1);
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
    footShadow.scale.set(9 * LIT_PIXEL, 1, (3.5 * LIT_PIXEL) / LIT_SIN);
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

  private placeCharacter(entity: CharacterEntity, x: number, z: number) {
    const depthStep = LIT_PIXEL / LIT_SIN;
    const snappedX = Math.round(x / LIT_PIXEL) * LIT_PIXEL;
    const snappedZ = Math.round(z / depthStep) * depthStep;
    entity.mesh.position.set(
      snappedX,
      -(entity.card.groundRowFromBottom * LIT_PIXEL) / LIT_COS,
      snappedZ,
    );
    entity.footShadow.position.x = snappedX;
    entity.footShadow.position.z = snappedZ;
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
    this.camera.getWorldDirection(this.yuuno.material.uniforms.cameraForward.value);

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
