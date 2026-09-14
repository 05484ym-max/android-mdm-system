(() => {
  'use strict';

  // All panel features share the same cookie-backed admin session. Older
  // inline handlers did not all handle 401 themselves, which could make a
  // button appear to do nothing after the session expired. Keep the original
  // Response intact for feature-specific handling, but always return the UI
  // to the login screen for admin API 401s.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const input = args[0];
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (response.status === 401 && (url.startsWith('/api/') || url.includes('/api/'))) {
      const login = document.getElementById('loginScreen');
      if (login) login.style.display = 'flex';
    }
    return response;
  };

  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('Admin PWA service worker registration failed:', err);
    });
  });
})();
