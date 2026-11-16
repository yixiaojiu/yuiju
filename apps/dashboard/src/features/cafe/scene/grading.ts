import { ShaderMaterial } from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * 最后一道调色：略微提高饱和度，四角压暗一点，把视线收向画面中央。
 * 放在色调映射之后，处理的是已经转成显示颜色的画面。
 */
export function createGradingPass() {
  return new ShaderPass(
    new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        saturation: { value: 1.12 },
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
          vec4 texel = texture2D(tDiffuse, vUv);
          float luminance = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
          vec3 color = mix(vec3(luminance), texel.rgb, saturation);
          float edge = smoothstep(0.35, 0.95, length(vUv - 0.5));
          gl_FragColor = vec4(color * (1.0 - edge * vignette), texel.a);
        }
      `,
    }),
  );
}
