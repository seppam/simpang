<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type TenantRow } from '../api';
import StateBlock from '../components/StateBlock.vue';
import { formatInt, parseQuotaInput } from '../format';
import { consoleSession } from '../session';
import { describeError, useResource } from '../useResource';

const session = consoleSession.current;
const isAdmin = computed(() => session.value?.role === 'admin');

const tenants = useResource(() => api.tenants());
const list = computed<TenantRow[]>(() => tenants.data.value?.data ?? []);
const isEmpty = computed(() => tenants.data.value !== null && list.value.length === 0);

onMounted(() => tenants.load());

// Usage against quota. Above 90 percent the bar turns amber; at or over the limit it turns red.
type Meter = { percent: number; tone: 'ok' | 'warn' | 'over' } | null;

function meterOf(t: TenantRow): Meter {
  if (t.monthlyTokenLimit === null || t.monthlyTokenLimit <= 0) return null;
  const share = t.usedThisMonth / t.monthlyTokenLimit;
  const tone = share >= 1 ? 'over' : share >= 0.9 ? 'warn' : 'ok';
  return { percent: Math.min(100, Math.round(share * 100)), tone };
}

// Inline quota editing (admins only).
const editingId = ref<string | null>(null);
const draft = ref('');
const saving = ref(false);
const saveError = ref<string | null>(null);

function startEdit(t: TenantRow) {
  editingId.value = t.id;
  draft.value = t.monthlyTokenLimit === null ? '' : String(t.monthlyTokenLimit);
  saveError.value = null;
}

function cancelEdit() {
  editingId.value = null;
  saveError.value = null;
}

async function saveQuota(t: TenantRow) {
  const limit = parseQuotaInput(draft.value);
  if (limit === 'invalid') {
    saveError.value = 'Enter a whole number of tokens, or leave it empty for no limit.';
    return;
  }
  saving.value = true;
  saveError.value = null;
  try {
    await api.setQuota(t.id, limit);
    editingId.value = null;
    void tenants.load();
  } catch (cause) {
    saveError.value = describeError(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>Tenants</h1>
      <p class="muted">Monthly token quotas and usage this calendar month. An empty quota means no limit.</p>
    </header>

    <StateBlock :loading="tenants.loading.value" :error="tenants.error.value" :empty="isEmpty" empty-text="No tenants exist yet.">
      <p v-if="saveError" class="notice notice-error" role="alert">Could not save the quota. {{ saveError }}</p>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Tenant</th>
              <th scope="col" class="num">Monthly quota (tokens)</th>
              <th scope="col">Used this month</th>
              <th v-if="isAdmin" scope="col"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in list" :key="t.id">
              <th scope="row">{{ t.name }}</th>
              <td class="num">
                <template v-if="editingId === t.id">
                  <label class="field-inline">
                    <span class="visually-hidden">Monthly token limit for {{ t.name }}</span>
                    <input
                      v-model="draft"
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      placeholder="Unlimited"
                      class="mono quota-input"
                      :disabled="saving"
                      @keydown.enter.prevent="saveQuota(t)"
                      @keydown.esc="cancelEdit"
                    />
                  </label>
                </template>
                <template v-else>{{ t.monthlyTokenLimit === null ? 'Unlimited' : formatInt(t.monthlyTokenLimit) }}</template>
              </td>
              <td class="usage-cell">
                <div class="usage-figures">{{ formatInt(t.usedThisMonth) }}</div>
                <div v-if="meterOf(t)" class="meter" role="progressbar" :aria-valuenow="meterOf(t)?.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="`${t.name} quota used`">
                  <div class="meter-fill" :class="`meter-${meterOf(t)?.tone}`" :style="{ width: `${meterOf(t)?.percent}%` }"></div>
                </div>
                <div v-if="meterOf(t)" class="cell-note">
                  {{ meterOf(t)?.percent }}% of quota<span v-if="meterOf(t)?.tone === 'over'"> (over limit)</span>
                </div>
                <div v-else-if="t.monthlyTokenLimit === null" class="cell-note">No limit set</div>
              </td>
              <td v-if="isAdmin" class="actions">
                <template v-if="editingId === t.id">
                  <button type="button" class="button button-primary" :disabled="saving" @click="saveQuota(t)">
                    {{ saving ? 'Saving...' : 'Save' }}
                  </button>
                  <button type="button" class="button" :disabled="saving" @click="cancelEdit">Cancel</button>
                </template>
                <button v-else type="button" class="button" @click="startEdit(t)">Edit quota</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="editingId" class="muted small">Enter whole tokens. Leave the field empty for no limit. Press Enter to save or Escape to cancel.</p>
    </StateBlock>
  </section>
</template>
