import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

/** 官方地址未包含版本号，用已验证文件的 SHA-256 固定内容；升级时需重新核对。 */
const sourceUrl = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
const expectedSha256 = "25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f";

/** 先下载并校验，成功后才写入 public；宿主只负责复制静态目录。 */
async function main() {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Cubism Core 下载失败：HTTP ${response.status}`);
  }
  const content = new Uint8Array(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (sha256 !== expectedSha256) {
    throw new Error(`Cubism Core SHA-256 不匹配：${sha256}，请核对下载来源及 SDK 版本`);
  }

  const directory = new URL("../public/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL("live2dcubismcore.min.js", directory), content);
  console.info("Cubism Core 已下载并通过 SHA-256 校验：public/live2dcubismcore.min.js");
}

main();
