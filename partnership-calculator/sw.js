// Cleanup only. A partnership tax calculator briefly lived here (Nov 23, 2026).
// Browsers that saved it load this file on their next visit; it clears the saved
// copy and removes itself.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('basis-calc-')).map(k => caches.delete(k)));
    await self.registration.unregister();
  })());
});
