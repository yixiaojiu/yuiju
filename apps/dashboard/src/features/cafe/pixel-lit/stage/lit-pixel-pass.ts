import {
  type Camera,
  HalfFloatType,
  NearestFilter,
  type Scene,
  ShaderMaterial,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";

/**
 * 把场景和光影按像素网格渲染（一个像素对应场景里的一个贴图像素），再按最近邻放大到全分辨率，
 * 交给后面的泛光和调色。物体边缘、光照渐变、阴影边缘都对齐像素网格；泛光仍是全分辨率的柔和光晕。
 * 用来替换普通的 RenderPass。
 */
export class PixelRenderPass extends Pass {
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly target = new WebGLRenderTarget(2, 2, {
    type: HalfFloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
  });
  private readonly upscale = new FullScreenQuad(
    new ShaderMaterial({
      uniforms: { source: { value: this.target.texture } },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `uniform sampler2D source; varying vec2 vUv; void main(){gl_FragColor=texture2D(source,vUv);}`,
    }),
  );

  constructor(scene: Scene, camera: Camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
  }

  /** 像素网格的大小，和相机取景的像素数一致。 */
  setPixelSize(width: number, height: number) {
    this.target.setSize(width, height);
  }

  render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget) {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.upscale.render(renderer);
  }

  dispose() {
    this.target.dispose();
    this.upscale.material.dispose();
    this.upscale.dispose();
  }
}
