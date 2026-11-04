<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type CreatedKey, type KeyRow } from '../api';
import StateBlock from '../components/StateBlock.vue';
import { formatDateTime } from '../format';
import { consoleSession } from '../session';
import { describeError, useResource } from '../useResource';

const session = consoleSession.current;
const isAdmin = computed(() => session.value?.role === 'admin');

const keys = useResource(() => api.keys());
const tenants = useResource(() => api.tenants());

const list = computed<KeyRow[]>(() => keys.data.value?.data ?? []);
const isEmpty = computed(() => keys.data.value !== null && list.value.length === 0);

onMounted(() => {
  void keys.load();
  // Admins choose which tenant a new key belongs to; operators always get their own tenant.
  if (isAdmin.value) void tenants.load();
});

// Creating a key
const tenantChoice = ref('');
const creating = ref(false);
const createError = ref<string | null>(null);
// Shown once. It lives only in this component, never in storage, and goes when dismissed.
const created = ref<CreatedKey | null>(null);

async function createKey() {
  creating.value = true;
  createError.value = null;
  created.value = null;
  try {
    created.value = await api.createKey(tenantChoice.value || undefined);
  } catch (cause) {
    createError.value = describeError(cause);
  } finally {
    creating.value = false;
  }
  void keys.load();
}

function dismissCreated() {
  created.value = null;
}

function selectKey(event: FocusEvent) {
  (event.target as HTMLInputElement).select();
}

// Revoking: a row asks for confirmation before anything is sent.
const pendingRevoke = ref<string | null>(null);
const revoking = ref(false);
const revokeError = ref<string | null>(null);

async function confirmRevoke(id: string) {
  revoking.value = true;
  revokeError.value = null;
  try {
    await api.revokeKey(id);
    pendingRevoke.value = null;
  } catch (cause) {
    revokeError.value = describeError(cause);
  } finally {
    revoking.value = false;
  }
  void keys.load();
}
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>Keys</h1>
      <p class="muted">API keys that callers use on /v1. A key's secret is shown once, at creation.</p>
    </header>

    <form class="toolbar" @submit.prevent="createKey">
      <template v-if="isAdmin">
        <label class="field">
          <span>Tenant</span>
          <select v-model="tenantChoice" :disabled="creating">
            <option value="">Your tenant</option>
            <option v-for="t in tenants.data.value?.data ?? []" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </label>
      </template>
      <button type="submit" class="button button-primary" :disabled="creating">
        {{ creating ? 'Creating...' : 'Create key' }}
      </button>
    </form>
    <p v-if="createError" class="notice notice-error" role="alert">Could not create the key. {{ createError }}</p>

    <div v-if="created" class="notice notice-warn key-once" role="status">
      <p><strong>Copy this key now.</strong> It is shown only once and cannot be retrieved later. The gateway stores just a hash of it.</p>
      <div class="key-row">
        <input class="mono key-input" type="text" readonly :value="created.key" aria-label="New API key" @focus="selectKey" />
        <button type="button" class="button" @click="dismissCreated">Dismiss</button>
      </div>
      <p class="muted small">{{ created.note }}</p>
    </div>

    <p v-if="revokeError" class="notice notice-error" role="alert">Could not revoke the key. {{ revokeError }}</p>

    <StateBlock :loading="keys.loading.value" :error="keys.error.value" :empty="isEmpty" empty-text="No keys yet. Create one above.">
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Prefix</th>
              <th scope="col">Tenant</th>
              <th scope="col">Created</th>
              <th scope="col">Status</th>
              <th scope="col"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in list" :key="key.id">
              <th scope="row" class="mono">{{ key.prefix }}</th>
              <td>{{ key.tenantName }}</td>
              <td>{{ formatDateTime(key.createdAt) }}</td>
              <td>
                <span v-if="key.revokedAt" class="badge badge-neutral">Revoked {{ formatDateTime(key.revokedAt) }}</span>
                <span v-else class="badge badge-ok">Active</span>
              </td>
              <td class="actions">
                <template v-if="!key.revokedAt">
                  <div v-if="pendingRevoke === key.id" class="confirm">
                    <span>Requests with this key will fail at once.</span>
                    <button type="button" class="button button-danger" :disabled="revoking" @click="confirmRevoke(key.id)">
                      {{ revoking ? 'Revoking...' : 'Confirm revoke' }}
                    </button>
                    <button type="button" class="button" :disabled="revoking" @click="pendingRevoke = null">Cancel</button>
                  </div>
                  <button v-else type="button" class="button" @click="pendingRevoke = key.id">Revoke</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </StateBlock>
  </section>
</template>
