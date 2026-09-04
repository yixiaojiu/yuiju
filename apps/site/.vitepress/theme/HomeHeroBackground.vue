<script setup lang="ts">
import sleepingYuijuWatercolor from "./assets/sleeping-yuiju-watercolor.webp";
</script>

<template>
  <div class="home-hero-background" aria-hidden="true">
    <img
      :src="sleepingYuijuWatercolor"
      alt=""
      width="1536"
      height="1024"
      decoding="async"
    />
  </div>
</template>

<style scoped>
.home-hero-background {
  position: absolute;
  z-index: 0;
  top: 250px;
  right: 0;
  left: 0;
  pointer-events: none;
}

.home-hero-background img {
  display: block;
  width: 100%;
  height: auto;
  opacity: 0.56;
  filter: saturate(0.88);
  mask-image: radial-gradient(
    ellipse 50% 50% at 50% 50%,
    #000 0 72%,
    rgb(0 0 0 / 90%) 80%,
    rgb(0 0 0 / 58%) 88%,
    rgb(0 0 0 / 24%) 95%,
    transparent 100%
  );
}

:global(.VPHome) {
  position: relative;
  isolation: isolate;
}

:global(.VPHomeHero),
:global(.VPHomeFeatures) {
  position: relative;
  z-index: 1;
}

@media (min-width: 640px) {
  .home-hero-background {
    top: 300px;
  }
}

@media (min-width: 960px) {
  .home-hero-background {
    top: 64px;
  }
}

:global(.dark) .home-hero-background img {
  opacity: 0.26;
  filter: brightness(0.62) saturate(0.78);
}
</style>
