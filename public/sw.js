/**
 * Service Worker for Push Notifications
 * Handles notification clicks and other push events
 */

self.addEventListener('push', (event) => {
  console.log('Push event received:', event);
  // Notifications are sent via showNotification() from main thread, not via push server
  // This handler is for future server-sent push notifications
});

self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event.notification.tag);
  event.notification.close();

  // Handle notification actions
  if (event.action === 'open' || !event.action) {
    // Click on notification body or "open" action
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        // Focus existing window if open
        for (let client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        // Or open new window
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }

  if (event.action === 'dismiss') {
    event.notification.close();
  }
});

self.addEventListener('notificationclose', (event) => {
  console.log('Notification dismissed:', event.notification.tag);
});
