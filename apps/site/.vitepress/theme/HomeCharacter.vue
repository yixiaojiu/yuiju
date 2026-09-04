<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import characterAtlasMeta from "./assets/character/character-atlas.json";
import characterAtlas from "./assets/character/character-atlas.png";

const MIN_WINK_DELAY_MS = 5_000;
const MAX_WINK_DELAY_MS = 30_000;

type FrameName = keyof typeof characterAtlasMeta.frames;

const idleAnimation = characterAtlasMeta.animations.idle;

const isReady = ref(false);
const currentFrame = ref(characterAtlasMeta.frames["idle/0"].frame);
let frameTimer: number | undefined;
let winkTimer: number | undefined;
let isWinkPending = false;
let isMounted = false;

function showFrame(frameName: string) {
  currentFrame.value = characterAtlasMeta.frames[frameName as FrameName].frame;
}

function startIdle() {
  let frameIndex = 0;
  showFrame(idleAnimation.frames[frameIndex]);
  frameTimer = window.setInterval(() => {
    frameIndex = (frameIndex + 1) % idleAnimation.frames.length;
    showFrame(idleAnimation.frames[frameIndex]);
    if (isWinkPending && frameIndex === 0) {
      startWink();
    }
  }, 1_000 / idleAnimation.frameRate);
}

function scheduleWink() {
  winkTimer = window.setTimeout(
    () => {
      winkTimer = undefined;
      if (currentFrame.value.x === characterAtlasMeta.frames["idle/0"].frame.x) {
        startWink();
      } else {
        isWinkPending = true;
      }
    },
    MIN_WINK_DELAY_MS + Math.random() * (MAX_WINK_DELAY_MS - MIN_WINK_DELAY_MS),
  );
}

function startWink() {
  isWinkPending = false;
  if (frameTimer !== undefined) {
    window.clearInterval(frameTimer);
    frameTimer = undefined;
  }

  const animation =
    Math.random() < 0.5
      ? characterAtlasMeta.animations.wink
      : characterAtlasMeta.animations.wink1;
  let sequenceIndex = 0;
  showFrame(animation.frames[sequenceIndex]);
  frameTimer = window.setInterval(() => {
    sequenceIndex += 1;
    if (sequenceIndex === animation.frames.length) {
      window.clearInterval(frameTimer);
      frameTimer = undefined;
      startIdle();
      scheduleWink();
    } else {
      showFrame(animation.frames[sequenceIndex]);
    }
  }, 1_000 / animation.frameRate);
}

onMounted(async () => {
  isMounted = true;
  const image = new Image();
  image.src = characterAtlas;
  await image.decode();

  if (!isMounted) {
    return;
  }

  isReady.value = true;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  startIdle();
  scheduleWink();
});

onBeforeUnmount(() => {
  isMounted = false;

  if (frameTimer !== undefined) {
    window.clearInterval(frameTimer);
  }

  if (winkTimer !== undefined) {
    window.clearTimeout(winkTimer);
  }
});
</script>

<template>
  <div v-if="isReady" class="home-character" aria-hidden="true">
    <div
      class="home-character__sprite"
      :style="{
        backgroundImage: `url(${characterAtlas})`,
        backgroundPosition: `${-currentFrame.x}px ${-currentFrame.y}px`,
      }"
    />
  </div>
</template>

<style scoped>
.home-character {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.home-character__sprite {
  width: 128px;
  height: 128px;
  background-position: 0 0;
  background-repeat: no-repeat;
  background-size: auto 128px;
  image-rendering: crisp-edges;
  image-rendering: pixelated;
}
</style>
