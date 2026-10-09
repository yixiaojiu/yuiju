import { defineConfig } from "vitepress";

export default defineConfig({
  title: "yuiju",
  description: "LLM 驱动的角色自主生活模拟项目",
  lang: "zh-Hans",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "首页", link: "/" },
      { text: "项目介绍", link: "/project/introduction" },
      { text: "参与开发", link: "/development/" },
    ],
    sidebar: {
      "/project/": [
        {
          text: "项目",
          items: [{ text: "项目介绍", link: "/project/introduction" }],
        },
      ],
      "/development/": [
        {
          text: "参与开发",
          items: [
            { text: "开发指南", link: "/development/" },
            { text: "本地开发", link: "/development/getting-started" },
            { text: "技术架构", link: "/development/architecture" },
            { text: "LLM 协定", link: "/development/llm-contract" },
            { text: "外部依赖", link: "/development/dependencies" },
          ],
        },
      ],
    },
    outline: {
      level: [2, 4],
      label: "本页内容",
    },
    docFooter: {
      prev: "上一页",
      next: "下一页",
    },
    darkModeSwitchLabel: "外观模式",
    sidebarMenuLabel: "菜单",
    returnToTopLabel: "返回顶部",
    socialLinks: [{ icon: "github", link: "https://github.com/yixiaojiu/yuiju" }],
  },
});
