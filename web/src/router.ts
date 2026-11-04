import { createRouter, createWebHistory } from 'vue-router';
import { consoleSession, roleAtLeast, type Role } from './session';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    public?: boolean;
    minRole?: Role;
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/signin', name: 'signin', component: () => import('./pages/SignIn.vue'), meta: { title: 'Sign in', public: true } },
    { path: '/', name: 'overview', component: () => import('./pages/Overview.vue'), meta: { title: 'Overview' } },
    { path: '/providers', name: 'providers', component: () => import('./pages/Providers.vue'), meta: { title: 'Providers' } },
    { path: '/drivers', name: 'drivers', component: () => import('./pages/Drivers.vue'), meta: { title: 'Drivers' } },
    { path: '/keys', name: 'keys', component: () => import('./pages/Keys.vue'), meta: { title: 'Keys', minRole: 'operator' } },
    { path: '/tenants', name: 'tenants', component: () => import('./pages/Tenants.vue'), meta: { title: 'Tenants', minRole: 'operator' } },
    { path: '/:pathMatch(.*)*', redirect: { name: 'overview' } },
  ],
});

router.beforeEach((to) => {
  // Re-check expiry on every navigation, so a lapsed session never shows a page.
  const signedIn = consoleSession.checkExpiry();
  if (!to.meta.public && !signedIn) return { name: 'signin' };
  if (to.name === 'signin' && signedIn) return { name: 'overview' };
  if (to.meta.minRole && !roleAtLeast(consoleSession.current.value?.role, to.meta.minRole)) return { name: 'overview' };
  return true;
});

router.afterEach((to) => {
  document.title = `${to.meta.title ?? 'Console'} | simpang console`;
});

export default router;
