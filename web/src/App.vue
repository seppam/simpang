<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { api } from './api';
import { consoleSession, roleAtLeast, type Role } from './session';

type NavItem = { to: string; label: string; minRole?: Role };

const navItems: NavItem[] = [
  { to: '/', label: 'Overview' },
  { to: '/providers', label: 'Providers' },
  { to: '/drivers', label: 'Drivers' },
  { to: '/keys', label: 'Keys', minRole: 'operator' },
  { to: '/tenants', label: 'Tenants', minRole: 'operator' },
];

const session = consoleSession.current;
const role = computed(() => session.value?.role ?? null);
const visibleNav = computed(() => navItems.filter((item) => !item.minRole || roleAtLeast(role.value, item.minRole)));

// Sessions also end while the page sits idle, so check the expiry on a timer, not only on navigation.
let expiryTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  expiryTimer = setInterval(() => consoleSession.checkExpiry(), 15_000);
});
onBeforeUnmount(() => clearInterval(expiryTimer));

function signOut() {
  api.signOut();
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-name">simpang</span>
        <span class="brand-sub">operator console</span>
      </div>

      <template v-if="session">
        <nav class="nav" aria-label="Main">
          <RouterLink v-for="item in visibleNav" :key="item.to" :to="item.to" class="nav-link">{{ item.label }}</RouterLink>
        </nav>
        <div class="identity">
          <span class="identity-client" :title="session.clientId ?? ''">{{ session.clientId ?? 'client' }}</span>
          <span class="badge badge-neutral">{{ session.role }}</span>
          <button type="button" class="button button-quiet" @click="signOut">Sign out</button>
        </div>
      </template>
    </header>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>
