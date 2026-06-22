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
  themeConfig: {
    nav: [
      { text: "首页", link: "/" },
      { text: "开发文档", link: `${repo}/blob/main/docs/README.md` },
      { text: "新人上手", link: `${repo}/blob/main/docs/onboarding.md` },
      {
        text: "访问连接",
        link: "https://yuiju-web.yixiaojiu.top",
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
    sidebar: [],
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
