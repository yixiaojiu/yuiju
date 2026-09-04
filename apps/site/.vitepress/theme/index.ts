import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import HomeCharacter from "./HomeCharacter.vue";
import HomeHeroBackground from "./HomeHeroBackground.vue";

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "home-hero-image": () => h(HomeCharacter),
      "home-hero-before": () => h(HomeHeroBackground),
    }),
};
