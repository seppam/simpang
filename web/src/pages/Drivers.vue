<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { api, type DriverInfo, type EvalEntry } from '../api';
import StateBlock from '../components/StateBlock.vue';
import { formatDateTime, formatInt, formatMetric, formatMs, formatPercent, formatUsd, shortSha } from '../format';
import { bestVersion, metricDirection } from '../metrics';
import { useResource } from '../useResource';

const drivers = useResource(() => api.drivers());
onMounted(() => drivers.load());

type Comparison = {
  versions: string[];
  metrics: string[];
  evals: Record<string, EvalEntry | null>;
  best: Record<string, string | null>;
  hasAnyEval: boolean;
};

// Metric rows are the union of every version's metrics. A cell is highlighted when its
// version is the better one on that row, judged by the metric's direction.
function compare(driver: DriverInfo): Comparison {
  const evals = driver.eval;
  const versions = driver.versions;
  const metrics = [...new Set(versions.flatMap((v) => Object.keys(evals[v]?.metrics ?? {})))].sort();
  const best: Record<string, string | null> = {};
  for (const metric of metrics) {
    const values = Object.fromEntries(versions.map((v) => [v, evals[v]?.metrics[metric] ?? null]));
    best[metric] = bestVersion(metric, values);
  }
  return { versions, metrics, evals, best, hasAnyEval: versions.some((v) => evals[v] != null) };
}

const list = computed(() => drivers.data.value?.data ?? []);
const isEmpty = computed(() => drivers.data.value !== null && list.value.length === 0);
const cards = computed(() => list.value.map((driver) => ({ driver, cmp: compare(driver) })));

function channelOf(driver: DriverInfo, version: string): 'stable' | 'canary' | null {
  if (driver.channels?.stable === version) return 'stable';
  if (driver.channels?.canary === version) return 'canary';
  return null;
}

function metricLabel(metric: string): string {
  const direction = metricDirection(metric);
  if (direction === 'higher') return `${metric} (higher is better)`;
  if (direction === 'lower') return `${metric} (lower is better)`;
  return metric;
}
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>Drivers</h1>
      <p class="muted">Versioned agent drivers, their offline evaluation, and live shadow traffic between the stable and canary versions.</p>
    </header>

    <StateBlock :loading="drivers.loading.value" :error="drivers.error.value" :empty="isEmpty" empty-text="No drivers are registered.">
      <article v-for="{ driver, cmp } in cards" :key="driver.name" class="card driver">
        <header class="driver-header">
          <h2 class="mono">{{ driver.name }}</h2>
          <div class="chips">
            <span v-for="version in driver.versions" :key="version" class="chip">
              <span class="mono">{{ version }}</span>
              <span v-if="channelOf(driver, version)" class="badge" :class="channelOf(driver, version) === 'canary' ? 'badge-warn' : 'badge-ok'">
                {{ channelOf(driver, version) }}
              </span>
            </span>
          </div>
        </header>
        <p v-if="driver.description" class="muted">{{ driver.description }}</p>

        <h3>Offline evaluation</h3>
        <template v-if="cmp.hasAnyEval">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th v-for="version in cmp.versions" :key="version" scope="col" class="num">
                    <span class="mono">{{ version }}</span>
                    <div class="cell-note">
                      <template v-if="cmp.evals[version]">
                        {{ formatDateTime(cmp.evals[version]?.createdAt) }}<br />
                        git <span class="mono">{{ shortSha(cmp.evals[version]?.gitSha) }}</span>
                      </template>
                      <template v-else>not evaluated</template>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="metric in cmp.metrics" :key="metric">
                  <th scope="row" class="metric-name">{{ metricLabel(metric) }}</th>
                  <td
                    v-for="version in cmp.versions"
                    :key="version"
                    class="num"
                    :class="{ 'is-best': cmp.best[metric] === version }"
                  >
                    {{ formatMetric(cmp.evals[version]?.metrics[metric], metric) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="muted small">Highlighted cells are the better value on that metric. Metrics with no known direction are not highlighted.</p>
        </template>
        <p v-else class="state">No offline evaluation has been recorded for this driver.</p>

        <h3>Shadow traffic</h3>
        <p v-if="driver.shadow.length === 0" class="state">No shadow traffic recorded yet.</p>
        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Stable and canary</th>
                <th scope="col" class="num">Runs</th>
                <th scope="col" class="num">Agreement</th>
                <th scope="col" class="num">Errors</th>
                <th scope="col" class="num">Latency stable / canary</th>
                <th scope="col" class="num">Cost stable / canary (USD)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in driver.shadow" :key="`${s.stableVersion}-${s.canaryVersion}`">
                <th scope="row" class="mono">{{ s.stableVersion }} / {{ s.canaryVersion }}</th>
                <td class="num">{{ formatInt(s.runs) }}</td>
                <td class="num">{{ formatPercent(s.agreeRate) }}</td>
                <td class="num" :class="{ 'is-bad': s.errors > 0 }">{{ formatInt(s.errors) }}</td>
                <td class="num">{{ formatMs(s.avgStableLatencyMs) }} / {{ formatMs(s.avgCanaryLatencyMs) }}</td>
                <td class="num">{{ formatUsd(s.stableCostUsd) }} / {{ formatUsd(s.canaryCostUsd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </StateBlock>
  </section>
</template>
