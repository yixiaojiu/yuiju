import { Color, DoubleSide, MeshStandardMaterial, type Texture } from "three";

export type LitMaterialOptions = {
  map?: Texture;
  roughnessMap?: Texture;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveMap?: Texture;
  emissiveIntensity?: number;
  alphaTest?: number;
  doubleSide?: boolean;
};

/**
 * 完美像素 HD-2D 场景 PBR 材质工厂。
 * 支持统一像素密度的方块材质，以及 alphaTest = 0.5、DoubleSide 的 2D 完美像素立牌材质（同时接收真 3D 光照并投射像素轮廓软阴影）。
 */
export function createLitMaterials() {
  const created: MeshStandardMaterial[] = [];

  function material(color: string, options: LitMaterialOptions = {}) {
    const mat = new MeshStandardMaterial({
      color: new Color(color),
      map: options.map ?? null,
      roughnessMap: options.roughnessMap ?? null,
      roughness: options.roughness ?? 0.82,
      metalness: options.metalness ?? 0.04,
      emissive: options.emissive ? new Color(options.emissive) : new Color(0x000000),
      emissiveMap: options.emissiveMap ?? null,
      emissiveIntensity: options.emissiveIntensity ?? 0,
      alphaTest: options.alphaTest ?? 0,
      side: options.doubleSide ? DoubleSide : undefined,
    });
    created.push(mat);
    return mat;
  }

  /** 创建 2D 像素立牌材质；可附带温和自发光让灯具立牌或主角暗部保持清透。 */
  function spriteCardMaterial(texture: Texture, emissiveBoost = 0, emissiveTint = "#ffffff") {
    return material("#ffffff", {
      map: texture,
      roughness: 0.86,
      metalness: 0.02,
      alphaTest: 0.5,
      doubleSide: true,
      emissive: emissiveBoost > 0 ? emissiveTint : undefined,
      emissiveMap: emissiveBoost > 0 ? texture : undefined,
      emissiveIntensity: emissiveBoost,
    });
  }

  return {
    material,
    spriteCardMaterial,
    dispose() {
      for (const mat of created) {
        mat.dispose();
      }
    },
  };
}

export type LitMaterials = ReturnType<typeof createLitMaterials>;
