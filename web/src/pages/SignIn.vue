<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { consoleSession } from '../session';
import { describeError } from '../useResource';

const router = useRouter();

const clientId = ref('');
const clientSecret = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

const notice = computed(() => (consoleSession.lastEnded.value === 'expired' ? 'Your session expired. Sign in again.' : null));

async function submit() {
  if (submitting.value) return;
  const id = clientId.value.trim();
  if (!id || !clientSecret.value) {
    error.value = 'Enter the client id and client secret.';
    return;
  }
  // Copy the secret out and clear the field before the request, so it does not linger in the form.
  const secret = clientSecret.value;
  clientSecret.value = '';

  submitting.value = true;
  error.value = null;
  try {
    await api.login(id, secret);
    await router.push({ name: 'overview' });
  } catch (cause) {
    error.value = describeError(cause);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="auth">
    <form class="auth-card" novalidate @submit.prevent="submit">
      <h1>Sign in</h1>
      <p class="muted">Use the client id and secret issued for your role. The console keeps the access token for this tab only.</p>

      <p v-if="notice" class="notice notice-warn" role="status">{{ notice }}</p>
      <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>

      <label class="field">
        <span>Client id</span>
        <input v-model="clientId" type="text" autocomplete="username" spellcheck="false" autocapitalize="off" :disabled="submitting" />
      </label>
      <label class="field">
        <span>Client secret</span>
        <input v-model="clientSecret" type="password" autocomplete="current-password" spellcheck="false" :disabled="submitting" />
      </label>

      <button type="submit" class="button button-primary button-block" :disabled="submitting">
        {{ submitting ? 'Signing in...' : 'Sign in' }}
      </button>
    </form>
  </section>
</template>
