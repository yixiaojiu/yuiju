import {
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Sprite,
  SpriteMaterial,
  type Vector3,
} from "three";
import type { CafeState } from "../session/state";

/** 唱片每秒转过的弧度：33⅓ 转每分钟。 */
const SPIN_SPEED = (33.33 / 60) * Math.PI * 2;
/** 唱臂在静止位置和落在唱片上时绕转轴转过的角度，单位弧度。 */
const TONEARM_REST = 0;
const TONEARM_PLAYING = 0.42;
const NOTE_COUNT = 4;
/** 一个音符从出现到消失的时间，单位秒。 */
const NOTE_LIFETIME = 3.2;

/**
 * 唱片机会动的部分：转盘上的唱片、唱臂、播放时飘出的音符。底座是烘焙进场景里的静止模型。
 * center 是唱片中心（转盘顶面），pivot 是唱臂转轴的顶端，都来自场景文件的锚点。
 */
export function createRecordPlayer(center: Vector3, pivot: Vector3) {
  const object = new Group();

  const record = new Group();
  record.position.copy(center);
  const vinyl = new Mesh(
    new CylinderGeometry(0.145, 0.145, 0.006, 48),
    new MeshStandardMaterial({ color: 0x1b1716, roughness: 0.35 }),
  );
  vinyl.position.y = 0.003;
  record.add(vinyl);
  const labelMaterial = new MeshStandardMaterial({ color: 0xc8955a, roughness: 0.8 });
  const label = new Mesh(new CylinderGeometry(0.048, 0.048, 0.007, 32), labelMaterial);
  label.position.y = 0.0035;
  record.add(label);
  // 标签上一道浅色的条纹，转起来时能看出唱片在转。
  const stripe = new Mesh(
    new CylinderGeometry(0.008, 0.008, 0.0075, 12),
    new MeshStandardMaterial({ color: 0xf3e9d6 }),
  );
  stripe.position.set(0.03, 0.0037, 0);
  record.add(stripe);
  object.add(record);

  // 唱臂建在转轴的局部坐标里：沿 -z 伸向唱片，末端是唱头。
  const tonearm = new Group();
  tonearm.position.copy(pivot);
  const armMaterial = new MeshStandardMaterial({ color: 0xd0cbc0, roughness: 0.3, metalness: 0.8 });
  const arm = new Mesh(new CylinderGeometry(0.004, 0.004, 0.22, 8), armMaterial);
  arm.rotation.x = Math.PI / 2;
  arm.position.z = -0.11;
  tonearm.add(arm);
  const head = new Mesh(
    new CylinderGeometry(0.009, 0.009, 0.03, 8),
    new MeshStandardMaterial({ color: 0x2a2623, roughness: 0.5 }),
  );
  head.position.set(0, -0.006, -0.22);
  tonearm.add(head);
  object.add(tonearm);

  // 音符：从唱片上方升起、左右摆动、渐渐淡去，错开相位轮流出现。
  const noteTexture = createNoteTexture();
  const notes = Array.from({ length: NOTE_COUNT }, (_, index) => {
    const sprite = new Sprite(
      new SpriteMaterial({ map: noteTexture, transparent: true, depthWrite: false }),
    );
    sprite.scale.setScalar(0.07);
    object.add(sprite);
    return { sprite, phase: (index / NOTE_COUNT) * NOTE_LIFETIME };
  });

  let tonearmAngle = TONEARM_REST;
  let elapsed = 0;

  /** 每帧调用：按唱片机状态转动唱片、移动唱臂、播放音符。 */
  function update(music: CafeState["music"], deltaSeconds: number) {
    const playing = music.status === "playing" && music.record !== null;
    record.visible = music.record !== null;
    if (music.record) {
      labelMaterial.color.set(music.record.color);
    }
    if (playing) {
      record.rotation.y -= SPIN_SPEED * deltaSeconds;
    }
    // 唱臂平滑地落下或抬起。
    const targetAngle = playing ? TONEARM_PLAYING : TONEARM_REST;
    tonearmAngle += (targetAngle - tonearmAngle) * Math.min(deltaSeconds * 3, 1);
    tonearm.rotation.y = tonearmAngle;

    elapsed += deltaSeconds;
    for (const note of notes) {
      const life = ((elapsed + note.phase) % NOTE_LIFETIME) / NOTE_LIFETIME;
      note.sprite.visible = playing;
      note.sprite.position.set(
        center.x + Math.sin(life * Math.PI * 2 + note.phase) * 0.06,
        center.y + 0.08 + life * 0.35,
        center.z + Math.cos(life * Math.PI * 2 + note.phase) * 0.04,
      );
      note.sprite.material.opacity = Math.sin(life * Math.PI) * 0.85;
    }
  }

  return { object, update };
}

/** 一个暖白色的八分音符，画在透明画布上。 */
function createNoteTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffe6c0";
  context.font = "bold 52px serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(255, 190, 110, 0.9)";
  context.shadowBlur = 10;
  context.fillText("♪", 32, 34);
  return new CanvasTexture(canvas);
}
