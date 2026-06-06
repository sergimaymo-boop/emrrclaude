/**
 * Push Notifications Service
 * Sends Web Push notifications to iPhone 16 Pro Max (and other devices)
 * Uses Service Worker + Web Push API (compatible with iOS 16.4+)
 */

export interface PushOptions {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;      // groups notifications with same tag
  requireInteraction?: boolean;
  actions?: { action: string; title: string }[];
}

class PushNotificationService {
  private registration: ServiceWorkerRegistration | null = null;

  /**
   * Request permission and register service worker
   * Call this once on app load
   */
  async initialize() {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      console.warn('Push notifications not supported in this browser');
      return false;
    }

    if (Notification.permission === 'granted') {
      return this.registerServiceWorker();
    }

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        return this.registerServiceWorker();
      }
    }

    return false;
  }

  private async registerServiceWorker(): Promise<boolean> {
    try {
      this.registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('✅ Service Worker registered for push notifications');
      return true;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      return false;
    }
  }

  /**
   * Send push notification
   * Works on: Chrome, Firefox, Edge, iOS Safari (16.4+), Android Chrome
   */
  async send(options: PushOptions): Promise<void> {
    if (!this.registration) {
      console.warn('Service Worker not registered. Call initialize() first.');
      return;
    }

    const notificationOptions = {
      body: options.body,
      icon: options.icon || '/logo.png',
      badge: options.badge || '/badge.png',
      tag: options.tag || 'emrr-default',
      requireInteraction: options.requireInteraction ?? true,
      vibrate: [200, 100, 200],              // vibration pattern: iPhone buzz
      timestamp: Date.now(),
      actions: options.actions,
      data: {
        timestamp: new Date().toISOString(),
        url: window.location.href,
      },
    };

    try {
      await this.registration.showNotification(options.title, notificationOptions);
      console.log('✅ Push notification sent:', options.title);
    } catch (error) {
      console.error('Failed to send push notification:', error);
    }
  }

  /**
   * Send "Ticket Perfecto" notification
   * Called from OptimalSignalPanel when bestCandidateExists && !alarma
   */
  async notifyPerfectTicket(ticker: string, sector: string, score: number): Promise<void> {
    await this.send({
      title: `🎯 Ticket Perfecto: ${ticker}`,
      body: `${sector} · Score ${score.toFixed(1)} · Toca para ir a EMRR`,
      tag: `ticket-${ticker}`, // Replace notification if same stock appears again
      requireInteraction: true, // Keep on screen until user interacts
      icon: '/emrr-logo.png',
      badge: '/emrr-badge.png',
      actions: [
        { action: 'open', title: 'Ver en EMRR' },
        { action: 'dismiss', title: 'Cerrar' },
      ],
    });
  }

  /**
   * Send "Señal Óptima Actualizada" notification after scan completes
   */
  async notifySignalUpdate(ticketsFound: number): Promise<void> {
    await this.send({
      title: '✓ Análisis Completo',
      body: ticketsFound > 0
        ? `${ticketsFound} confluencia${ticketsFound > 1 ? 's' : ''} detectada${ticketsFound > 1 ? 's' : ''}`
        : 'Sin confluencia perfecta hoy',
      tag: 'signal-update',
      requireInteraction: false, // Auto-dismiss after 5s
      icon: '/emrr-logo.png',
    });
  }

  /**
   * Check if notifications are enabled
   */
  isEnabled(): boolean {
    return Notification.permission === 'granted' && !!this.registration;
  }
}

export const pushNotifications = new PushNotificationService();
