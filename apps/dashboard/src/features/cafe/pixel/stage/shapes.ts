import {
  BoxGeometry,
  CylinderGeometry,
  type Group,
  type Material,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
} from "three";

type Range = readonly [number, number];

/**
 * 搭场景用的基本形体。一个舞台创建一套，所有物件共用三份单位几何体，按尺寸缩放摆放；
 * 场景是平涂加分档光照，缩放后的法线方向对这种着色足够用。
 */
export function createShapes() {
  const unitBox = new BoxGeometry(1, 1, 1);
  const unitCylinder = new CylinderGeometry(1, 1, 1, 14);
  const unitSphere = new SphereGeometry(1, 14, 10);
  const unitPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  return {
    /** 用两端坐标描述的长方体：x、y、z 各给一个 [起, 止] 区间。 */
    box(parent: Group, material: Material, [x0, x1]: Range, [y0, y1]: Range, [z0, z1]: Range) {
      const mesh = new Mesh(unitBox, material);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      mesh.scale.set(x1 - x0, y1 - y0, z1 - z0);
      parent.add(mesh);
      return mesh;
    },
    /** 立在 (x, z) 的圆柱，从 y0 到 y1。 */
    cylinder(
      parent: Group,
      material: Material,
      x: number,
      z: number,
      [y0, y1]: Range,
      radius: number,
    ) {
      const mesh = new Mesh(unitCylinder, material);
      mesh.position.set(x, (y0 + y1) / 2, z);
      mesh.scale.set(radius, y1 - y0, radius);
      parent.add(mesh);
      return mesh;
    },
    /** 中心在 (x, y, z)、三个方向半径分别为 rx、ry、rz 的椭球。 */
    blob(
      parent: Group,
      material: Material,
      [x, y, z]: readonly [number, number, number],
      [rx, ry, rz]: readonly [number, number, number],
    ) {
      const mesh = new Mesh(unitSphere, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(rx, ry, rz);
      parent.add(mesh);
      return mesh;
    },
    /** 贴在地面上的一块平面，x、z 各给一个 [起, 止] 区间，用来画接地阴影和地毯。 */
    floorPatch(
      parent: Group,
      material: Material,
      [x0, x1]: Range,
      [z0, z1]: Range,
      height: number,
    ) {
      const mesh = new Mesh(unitPlane, material);
      mesh.position.set((x0 + x1) / 2, height, (z0 + z1) / 2);
      mesh.scale.set(x1 - x0, 1, z1 - z0);
      parent.add(mesh);
      return mesh;
    },
    dispose() {
      unitPlane.dispose();
      unitBox.dispose();
      unitCylinder.dispose();
      unitSphere.dispose();
    },
  };
}

export type Shapes = ReturnType<typeof createShapes>;
