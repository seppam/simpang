<script setup lang="ts">
import { computed } from 'vue';
import { formatInt } from '../format';

// One bar per period. Successful requests sit at the bottom, errors stacked on top.
export type Bar = { label: string; ok: number; errors: number };

const props = defineProps<{ bars: Bar[]; caption: string }>();

const WIDTH = 480;
const HEIGHT = 180;
const TOP = 12;
const BOTTOM = 24;
const LEFT = 4;

const plotHeight = HEIGHT - TOP - BOTTOM;
const plotWidth = WIDTH - LEFT * 2;

const peak = computed(() => Math.max(1, ...props.bars.map((b) => b.ok + b.errors)));
const slot = computed(() => plotWidth / Math.max(1, props.bars.length));
// Show at most about seven x-axis labels, so they stay readable on a phone.
const labelEvery = computed(() => Math.max(1, Math.ceil(props.bars.length / 7)));

function barX(index: number): number {
  return LEFT + index * slot.value + slot.value * 0.15;
}

function barHeight(value: number): number {
  return (value / peak.value) * plotHeight;
}

function total(bar: Bar): number {
  return bar.ok + bar.errors;
}
</script>

<template>
  <figure class="chart">
    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" role="img" :aria-label="caption" class="chart-svg">
      <line :x1="LEFT" :x2="WIDTH - LEFT" :y1="HEIGHT - BOTTOM" :y2="HEIGHT - BOTTOM" class="chart-axis" />
      <text :x="LEFT" :y="TOP - 2" class="chart-tick">{{ formatInt(peak) }}</text>
      <text :x="LEFT" :y="HEIGHT - BOTTOM + 14" class="chart-tick">0</text>

      <g v-for="(bar, index) in bars" :key="bar.label">
        <title>{{ bar.label }}: {{ formatInt(total(bar)) }} requests, {{ formatInt(bar.errors) }} errors</title>
        <rect
          :x="barX(index)"
          :width="slot * 0.7"
          :y="HEIGHT - BOTTOM - barHeight(bar.ok)"
          :height="barHeight(bar.ok)"
          class="bar-ok"
        />
        <rect
          v-if="bar.errors > 0"
          :x="barX(index)"
          :width="slot * 0.7"
          :y="HEIGHT - BOTTOM - barHeight(bar.ok) - barHeight(bar.errors)"
          :height="barHeight(bar.errors)"
          class="bar-error"
        />
        <text
          v-if="index % labelEvery === 0"
          :x="barX(index) + slot * 0.35"
          :y="HEIGHT - 6"
          text-anchor="middle"
          class="chart-tick"
        >{{ bar.label }}</text>
      </g>
    </svg>
    <figcaption class="chart-legend">
      <span class="swatch swatch-ok" aria-hidden="true"></span> Succeeded
      <span class="swatch swatch-error" aria-hidden="true"></span> Errors
    </figcaption>
  </figure>
</template>
