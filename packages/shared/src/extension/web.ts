import type { ComponentType } from "react";

/** 浏览器只得到可公开的角色身份和接口地址，不接收扩展配置或服务端实例。 */
export type ExtensionPageProps = {
  character: { id: string; name: string };
  apiBasePath: string;
};

export type ExtensionWebDefinition = {
  pages: {
    id: string;
    title: string;
    access: "public" | "private";
    /** standalone 使用独立透明页面，不渲染后台导航，也不加入菜单；省略时使用后台布局。 */
    layout?: "standalone";
    component: ComponentType<ExtensionPageProps>;
  }[];
};

export type ExtensionWebImport = {
  extension: string;
  load(): Promise<{ default: ExtensionWebDefinition }>;
};
