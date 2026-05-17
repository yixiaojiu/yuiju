import { defineConfig } from "vitepress";

const version = "0.10.0";
const releases = "https://github.com/yixiaojiu/yuiju/releases";
const repo = "https://github.com/yixiaojiu/yuiju";
const webLive = "/";

export default defineConfig({
  title: "ゆいじゅ",
  description: "LLM 驱动的角色自主生活模拟项目",
  lang: "zh-Hans",
  cleanUrls: true,
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: "文档（待补充）", link: "/docs/overview/" },
      { text: "博客 / 开发日志（待补充）", link: "/blog/" },
      {
        text: "访问连接",
        link: "https://yuiju-web.yixiaojiu.top",
      },
      {
        text: "关于",
        items: [
          { text: "隐私政策", link: "/about/privacy" },
          { text: "使用条款", link: "/about/terms" },
        ],
      },
    ],
    outline: {
      level: [2, 6],
      label: "本页内容",
    },
    docFooter: {
      prev: "上一页",
      next: "下一页",
    },
    editLink: {
      pattern: `${repo}/edit/main/apps/site/:path`,
      text: "在 GitHub 编辑此页",
    },
    lastUpdated: {
      text: "最后更新",
    },
    darkModeSwitchLabel: "外观模式",
    sidebarMenuLabel: "菜单",
    returnToTopLabel: "返回顶部",
    langMenuLabel: "切换语言",
    logo: "https://raw.githubusercontent.com/yixiaojiu/yuiju/main/packages/source/picture/repo_avatar.webp",
    sidebar: [
      {
        text: "概览",
        items: [
          { text: "这是什么项目？", link: "/docs/overview/" },
          { text: "版本与下载", link: "/docs/overview/versions" },
          { text: "有关 AI VTuber", link: "/docs/overview/about-ai-vtuber" },
          { text: "有关 Neuro-sama", link: "/docs/overview/about-neuro-sama" },
          { text: "其他类似项目", link: "/docs/overview/other-similar-projects" },
        ],
      },
      {
        text: "用户手册",
        items: [
          {
            text: "快速开始",
            items: [
              { text: "桌面版", link: "/docs/manual/tamagotchi/" },
              { text: "网页版", link: "/docs/manual/web/" },
            ],
          },
          {
            text: "安装与使用",
            link: "/docs/manual/tamagotchi/setup-and-use/",
          },
          {
            text: "配置",
            items: [{ text: "配置指南", link: "/docs/manual/config/" }],
          },
        ],
      },
      {
        text: "贡献指南",
        items: [
          {
            text: "基础配置与开发",
            items: [
              { text: "环境配置与基础准备", link: "/docs/contributing/" },
              { text: "桌面端", link: "/docs/contributing/tamagotchi" },
              { text: "网页端", link: "/docs/contributing/webui" },
              { text: "文档站", link: "/docs/contributing/docs" },
            ],
          },
          {
            text: "游戏与社交平台",
            items: [
              { text: "Minecraft", link: "/docs/contributing/services/minecraft" },
              { text: "Satori Bot", link: "/docs/contributing/services/satori" },
              { text: "Telegram Bot", link: "/docs/contributing/services/telegram" },
              { text: "Discord Bot", link: "/docs/contributing/services/discord" },
            ],
          },
          {
            text: "设计指南",
            items: [
              { text: "介绍", link: "/docs/contributing/design-guidelines/" },
              {
                text: "艺术家与开发者 (参考资源)",
                link: "/docs/contributing/design-guidelines/resources",
              },
              { text: "工具", link: "/docs/contributing/design-guidelines/tools" },
            ],
          },
        ],
      },
      {
        text: "编年史",
        items: [
          { text: "首次公开 v0.1.0", link: "/docs/chronicles/version-v0.1.0/" },
          { text: "先前的故事 v0.0.1", link: "/docs/chronicles/version-v0.0.1/" },
        ],
      },
      {
        text: "角色",
        link: "/characters/",
      },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    homepage: {
      buttons: [
        {
          text: "网页版",
          link: webLive,
          primary: true,
          target: "_self",
        },
        {
          text: "下载",
          link: "/docs/overview/versions",
        },
        {
          text: "使用教程",
          link: "/docs/overview/",
        },
      ],
    },
  },
});
