<script setup lang="ts">
// Every data area shows exactly one of: loading, error, empty, or its content.
defineProps<{
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyText: string;
}>();
</script>

<template>
  <p v-if="error" class="state state-error" role="alert">Could not load this data. {{ error }}</p>
  <p v-else-if="loading" class="state state-loading" role="status">Loading...</p>
  <p v-else-if="empty" class="state">{{ emptyText }}</p>
  <slot v-else />
</template>
