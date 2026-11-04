<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, type UsageRow } from '../api';
import BarChart, { type Bar } from '../components/BarChart.vue';
import StatCard from '../components/StatCard.vue';
import StateBlock from '../components/StateBlock.vue';
import { formatInt, formatPercent, formatUsd, ratio } from '../format';
import { useResource } from '../useResource';

const PERIODS = [1, 7, 30] as const;
type Period = (typeof PERIODS)[number];

const days = ref<Period>(7);
const usage = useResource(() => api.usage(days.value));

onMounted(() => usage.load());
watch(days, () => usage.load());

const rows = computed<UsageRow[]>(() => usage.data.value?.data ?? []);
const isEmpty = computed(() => usage.data.value !== null && rows.value.length === 0);

const totals = computed(() => {
  let requests = 0;
  let errors = 0;
  let tokens = 0;
  let costUsd = 0;
  for (const row of rows.value) {
    requests += row.requests;
    errors += row.errors;
    tokens += row.tokens;
    costUsd += row.costUsd;
  }
  return { requests, errors, tokens, costUsd, errorRate: ratio(errors, requests) };
});

// Only days with traffic appear, in order.
const dailyBars = computed<Bar[]>(() => {
  const byDay = new Map<string, { ok: number; errors: number }>();
  for (const row of rows.value) {
    const entry = byDay.get(row.day) ?? { ok: 0, errors: 0 };
    entry.ok += row.requests - row.errors;
    entry.errors += row.errors;
    byDay.set(row.day, entry);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, entry]) => ({ label: day.slice(5), ok: entry.ok, errors: entry.errors }));
});

type ModelTotal = { key: string; provider: string; model: string; requests: number; errors: number; tokens: number; costUsd: number };

const byModel = computed<ModelTotal[]>(() => {
  const map = new Map<string, ModelTotal>();
  for (const row of rows.value) {
    const key = `${row.provider}/${row.model}`;
    const entry = map.get(key) ?? { key, provider: row.provider, model: row.model, requests: 0, errors: 0, tokens: 0, costUsd: 0 };
    entry.requests += row.requests;
    entry.errors += row.errors;
    entry.tokens += row.tokens;
    entry.costUsd += row.costUsd;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key));
});

const chartCaption = computed(() => `Requests per day over the last ${days.value} day${days.value === 1 ? '' : 's'}`);
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>Overview</h1>
      <div class="segmented" role="group" aria-label="Period">
        <button
          v-for="period in PERIODS"
          :key="period"
          type="button"
          class="segmented-option"
          :aria-pressed="days === period"
          @click="days = period"
        >
          {{ period }}d
        </button>
      </div>
    </header>

    <StateBlock :loading="usage.loading.value" :error="usage.error.value" :empty="isEmpty" :empty-text="`No requests in the last ${days} day${days === 1 ? '' : 's'}.`">
      <div class="stat-grid">
        <StatCard label="Requests" :value="formatInt(totals.requests)" />
        <StatCard label="Error rate" :value="formatPercent(totals.errorRate)" :hint="`${formatInt(totals.errors)} errors`" />
        <StatCard label="Tokens" :value="formatInt(totals.tokens)" />
        <StatCard label="Cost (USD)" :value="formatUsd(totals.costUsd)" />
      </div>

      <h2>Requests per day</h2>
      <BarChart :bars="dailyBars" :caption="chartCaption" />

      <h2>By provider and model</h2>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Model</th>
              <th scope="col" class="num">Requests</th>
              <th scope="col" class="num">Errors</th>
              <th scope="col" class="num">Error rate</th>
              <th scope="col" class="num">Tokens</th>
              <th scope="col" class="num">Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in byModel" :key="row.key">
              <td>{{ row.provider }}</td>
              <td class="mono nowrap">{{ row.model }}</td>
              <td class="num">{{ formatInt(row.requests) }}</td>
              <td class="num" :class="{ 'is-bad': row.errors > 0 }">{{ formatInt(row.errors) }}</td>
              <td class="num">{{ formatPercent(ratio(row.errors, row.requests)) }}</td>
              <td class="num">{{ formatInt(row.tokens) }}</td>
              <td class="num">{{ formatUsd(row.costUsd) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </StateBlock>
  </section>
</template>
