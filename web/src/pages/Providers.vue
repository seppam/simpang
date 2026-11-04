<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { api, type ProviderStatus } from '../api';
import StateBlock from '../components/StateBlock.vue';
import { formatInt, formatMs, formatPercent } from '../format';
import { useResource } from '../useResource';

const providers = useResource(() => api.providers());
onMounted(() => providers.load());

const list = computed<ProviderStatus[]>(() => providers.data.value?.data ?? []);
const isEmpty = computed(() => providers.data.value !== null && list.value.length === 0);

// Routes name a chain of "provider/model" candidates. A candidate whose provider has no
// configured client can never answer, so it is flagged rather than hidden.
const configured = computed(() => new Set(list.value.map((p) => p.name)));
const routes = computed(() =>
  Object.entries(providers.data.value?.routes ?? {}).sort(([a], [b]) => a.localeCompare(b)),
);

function providerOf(candidate: string): string {
  return candidate.split('/')[0] ?? candidate;
}

function statusOf(p: ProviderStatus): { label: string; tone: 'ok' | 'danger' | 'neutral' } {
  if (p.circuitOpen) return { label: 'Circuit open', tone: 'danger' };
  if (p.requests === 0) return { label: 'No traffic', tone: 'neutral' };
  return { label: 'OK', tone: 'ok' };
}
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>Providers</h1>
      <p v-if="providers.data.value" class="muted">
        Catalog version <span class="mono">{{ providers.data.value.catalogVersion }}</span>. Traffic figures cover the last 15 minutes.
      </p>
    </header>

    <StateBlock :loading="providers.loading.value" :error="providers.error.value" :empty="isEmpty" empty-text="No providers are configured.">
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Status</th>
              <th scope="col" class="num">Requests (15m)</th>
              <th scope="col" class="num">Error rate (15m)</th>
              <th scope="col" class="num">p95 latency</th>
              <th scope="col">Models</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in list" :key="p.name">
              <th scope="row">{{ p.name }}</th>
              <td>
                <span class="badge" :class="`badge-${statusOf(p).tone}`">{{ statusOf(p).label }}</span>
                <div v-if="p.consecutiveFailures > 0" class="cell-note">{{ p.consecutiveFailures }} consecutive failures</div>
              </td>
              <td class="num">{{ formatInt(p.requests) }}</td>
              <td class="num" :class="{ 'is-bad': p.errorRate > 0.05 }">{{ formatPercent(p.requests > 0 ? p.errorRate : null) }}</td>
              <td class="num">{{ p.requests > 0 ? formatMs(p.p95LatencyMs) : '—' }}</td>
              <td>
                <ul class="plain-list mono">
                  <li v-for="model in p.models" :key="model">{{ model }}</li>
                  <li v-if="p.models.length === 0" class="muted">No models in the catalog</li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Routes</h2>
      <p class="muted">Each route tries its candidates in order. Candidates marked "not configured" have no client on this gateway.</p>
      <p v-if="routes.length === 0" class="state">No routes are defined.</p>
      <div v-else class="route-grid">
        <article v-for="[name, chain] in routes" :key="name" class="card">
          <h3 class="mono">{{ name }}</h3>
          <ol class="chain">
            <li v-for="(candidate, index) in chain" :key="`${index}-${candidate}`">
              <span class="chain-step">{{ index + 1 }}</span>
              <span class="mono">{{ candidate }}</span>
              <span v-if="!configured.has(providerOf(candidate))" class="badge badge-warn">not configured</span>
            </li>
          </ol>
        </article>
      </div>
    </StateBlock>
  </section>
</template>
