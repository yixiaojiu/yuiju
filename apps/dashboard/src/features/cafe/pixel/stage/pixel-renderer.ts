import {
  Color,
  DepthTexture,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  type Scene,
  ShaderMaterial,
  Vector2,
  type Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

/** 画面放大倍数的下限：再小像素就看不清了，窗口装不下整家店时由相机跟随补上。 */
const MIN_SCALE = 3;

/**
 * 像素渲染管线。场景和角色分两层渲染到同样大小的低分辨率目标，合成时按深度比较：
 * 角色被前面的家具挡住的部分不画，露出来的部分外面描一圈深色轮廓（场景不描边）。
 *
 * 画面的像素数按容器大小算：放大倍数取能装下 preferred 大小的最大整数倍（至少 MIN_SCALE），
 * 再用这个倍数把容器铺满。大窗口一屏看完整家店，小窗口只看到一部分。
 */
export function createPixelRenderer(
  container: HTMLElement,
  preferred: { width: number; height: number },
) {
  const renderer = new WebGLRenderer({ antialias: false });
  const canvas = renderer.domElement;
  canvas.style.imageRendering = "pixelated";
  canvas.style.position = "absolute";
  container.appendChild(canvas);

  function layerTarget() {
    return new WebGLRenderTarget(2, 2, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthTexture: new DepthTexture(2, 2),
    });
  }
  const sceneLayer = layerTarget();
  const characterLayer = layerTarget();

  const composite = new ShaderMaterial({
    uniforms: {
      sceneColor: { value: sceneLayer.texture },
      sceneDepth: { value: sceneLayer.depthTexture },
      characterColor: { value: characterLayer.texture },
      characterDepth: { value: characterLayer.depthTexture },
      texel: { value: new Vector2() },
      outline: { value: new Color("#3d2a36") },
      depthGap: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `
      uniform sampler2D sceneColor; uniform sampler2D sceneDepth;
      uniform sampler2D characterColor; uniform sampler2D characterDepth;
      uniform vec2 texel; uniform vec3 outline; uniform float depthGap;
      varying vec2 vUv;
      // 角色像素露出来的条件：有角色，并且比同一位置的场景更靠前。
      // 不写深度的贴片（头顶的情绪符号）深度留在 1，总是画在最上面。
      bool shown(vec2 at){
        float depth=texture2D(characterDepth,at).r;
        return texture2D(characterColor,at).a>.5 && (depth>=1. || depth<texture2D(sceneDepth,at).r);
      }
      void main(){
        vec2 dx=vec2(texel.x,0.),dy=vec2(0.,texel.y);
        vec2 around[4]; around[0]=vUv+dx; around[1]=vUv-dx; around[2]=vUv+dy; around[3]=vUv-dy;
        vec3 color;
        if(shown(vUv)){
          // 角色内部前后部件相距较远时（马尾和身体之间），在靠后的一侧画内描边。
          color=texture2D(characterColor,vUv).rgb;
          float depth=texture2D(characterDepth,vUv).r;
          for(int i=0;i<4;i++){
            if(shown(around[i]) && texture2D(characterDepth,around[i]).r<depth-depthGap)color=mix(color,outline,.6);
          }
        }else{
          // 紧挨着露出的角色、并且在角色后面的场景像素画成轮廓色；挡在角色前面的家具不描边。
          color=texture2D(sceneColor,vUv).rgb;
          float behind=texture2D(sceneDepth,vUv).r;
          for(int i=0;i<4;i++){
            float depth=texture2D(characterDepth,around[i]).r;
            if(shown(around[i]) && (depth>=1. || depth<behind))color=outline;
          }
        }
        gl_FragColor=vec4(color,1.);
        #include <colorspace_fragment>
      }`,
  });
  const screen = new Mesh(new PlaneGeometry(2, 2), composite);
  screen.frustumCulled = false;
  const screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);

  // 当前画面的像素数、放大倍数和画布在容器里的偏移，舞台按 size 调整相机取景。
  const size = { width: 2, height: 2 };
  const view = { scale: 1, left: 0, top: 0 };
  function resize() {
    view.scale = Math.max(
      MIN_SCALE,
      Math.floor(
        Math.min(
          container.clientWidth / preferred.width,
          container.clientHeight / preferred.height,
        ),
      ),
    );
    // 像素数取偶数，画面中心落在像素边界上。
    size.width = 2 * Math.ceil(container.clientWidth / view.scale / 2);
    size.height = 2 * Math.ceil(container.clientHeight / view.scale / 2);
    renderer.setSize(size.width, size.height, false);
    sceneLayer.setSize(size.width, size.height);
    characterLayer.setSize(size.width, size.height);
    composite.uniforms.texel.value.set(1 / size.width, 1 / size.height);
    view.left = Math.floor((container.clientWidth - size.width * view.scale) / 2);
    view.top = Math.floor((container.clientHeight - size.height * view.scale) / 2);
    canvas.style.width = `${size.width * view.scale}px`;
    canvas.style.height = `${size.height * view.scale}px`;
    canvas.style.left = `${view.left}px`;
    canvas.style.top = `${view.top}px`;
  }
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  return {
    size,
    /** 把世界坐标换算成容器里的 CSS 像素位置，用来摆放头顶的气泡和名字。 */
    project(world: Vector3, camera: OrthographicCamera) {
      const ndc = world.clone().project(camera);
      return {
        x: view.left + ((ndc.x + 1) / 2) * size.width * view.scale,
        y: view.top + ((1 - ndc.y) / 2) * size.height * view.scale,
      };
    },
    render(scene: Scene, characters: Scene, camera: OrthographicCamera, background: Color) {
      composite.uniforms.depthGap.value = 0.1 / (camera.far - camera.near);
      renderer.setClearColor(background, 1);
      renderer.setRenderTarget(sceneLayer);
      renderer.render(scene, camera);
      renderer.setClearColor(0, 0);
      renderer.setRenderTarget(characterLayer);
      renderer.render(characters, camera);
      renderer.setRenderTarget(null);
      renderer.render(screen, screenCamera);
    },
    dispose() {
      observer.disconnect();
      sceneLayer.dispose();
      characterLayer.dispose();
      composite.dispose();
      screen.geometry.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
