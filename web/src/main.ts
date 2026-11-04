import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { consoleSession } from './session';
import './style.css';

// Any ended session (expiry, a 401 from the API, sign-out) returns the operator to sign-in.
consoleSession.onEnd(() => {
  void router.push({ name: 'signin' });
});

createApp(App).use(router).mount('#app');
