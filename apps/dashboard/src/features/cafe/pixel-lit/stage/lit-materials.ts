import {
  Color,
  type DataTexture,
  DoubleSide,
  FrontSide,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Texture,
  Vector2,
} from "three";

export type LitMaterialOptions = {
  map?: Texture;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** 叶片这类单层薄片要两面都画。 */
  doubleSide?: boolean;
};

/** 场景材质工厂：所有材质集中创建、集中释放。 */
export function createLitMaterials() {
  const created: Material[] = [];

  function material(color: string, options: LitMaterialOptions = {}) {
    const mat = new MeshStandardMaterial({
      color: new Color(color),
      map: options.map ?? null,
      roughness: options.roughness ?? 0.82,
      metalness: options.metalness ?? 0.04,
      emissive: options.emissive ? new Color(options.emissive) : new Color(0x000000),
      emissiveIntensity: options.emissiveIntensity ?? 0,
      side: options.doubleSide ? DoubleSide : FrontSide,
    });
    created.push(mat);
    return mat;
  }

  /**
   * 按世界坐标铺贴图的材质：一个纹素固定是 texelMeters 米见方，和物体大小、朝向无关。
   * 地面、台面按 xz 铺，朝前后的立面按 xy 铺，朝左右的立面按 zy 铺；只用在不旋转的方块和地面上。
   * 纹素格从世界原点量起，和相机对齐的像素网格是同一套，镜头跟着人走时纹理不闪。
   */
  function worldMaterial(map: DataTexture, texelMeters: number, roughness: number) {
    const mat = material("#ffffff", { map, roughness });
    const tileMeters = new Vector2(map.image.width * texelMeters, map.image.height * texelMeters);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tileMeters = { value: tileMeters };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vWorldSpot;\nvarying vec3 vWorldFacing;",
        )
        .replace(
          "#include <worldpos_vertex>",
          `#include <worldpos_vertex>
          vWorldSpot = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWorldFacing = abs(normalize(mat3(modelMatrix) * objectNormal));`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec2 tileMeters;\nvarying vec3 vWorldSpot;\nvarying vec3 vWorldFacing;",
        )
        .replace(
          "#include <map_fragment>",
          `vec2 worldUv = vWorldFacing.y > 0.5 ? vec2(vWorldSpot.x, -vWorldSpot.z)
            : vWorldFacing.x > 0.5 ? vWorldSpot.zy : vWorldSpot.xy;
          diffuseColor *= texture2D(map, worldUv / tileMeters);`,
        );
    };
    return mat;
  }

  /** 只投影子、画面上看不见的材质：给藏起来的墙留一份挡光的替身。 */
  function shadowOnly() {
    const mat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    created.push(mat);
    return mat;
  }

  return {
    material,
    worldMaterial,
    shadowOnly,
    dispose() {
      for (const mat of created) {
        mat.dispose();
      }
    },
  };
}

export type LitMaterials = ReturnType<typeof createLitMaterials>;
