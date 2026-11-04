<script setup lang="ts">
defineProps<{
  label: string;
  value: string;
  hint?: string;
}>();
</script>

<template>
  <div class="stat">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value">{{ value }}</div>
    <div v-if="hint" class="stat-hint">{{ hint }}</div>
  </div>
</template>
