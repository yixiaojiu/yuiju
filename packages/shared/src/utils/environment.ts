/** 读取项目运行环境；必须明确指定 development 或 production，不设置默认环境。 */
export function getEnvironment(): "development" | "production" {
  const environment = process.env.NODE_ENV;
  if (environment !== "production" && environment !== "development") {
    throw new Error("项目运行需要 NODE_ENV 为 production 或 development");
  }
  return environment;
}
