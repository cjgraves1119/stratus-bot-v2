/**
 * Stratus AI Chrome Extension — Desktop Notifications
 *
 * Sends desktop notifications for tasks due, completed quotes, etc.
 */

import { getSettings } from '../lib/storage.js';

/**
 * Show a desktop notification.
 * @param {string} title
 * @param {string} message
 * @param {Object} [options] - Additional options
 */
export async function showNotification(title, message, options = {}) {
  const settings = await getSettings();
  if (!settings.enableNotifications) return;

  const notifId = options.id || `stratus-${Date.now()}`;

  chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: `Stratus AI — ${title}`,
    message,
    priority: options.priority || 1,
    requireInteraction: options.requireInteraction || false,
  });

  // Auto-clear after 10 seconds unless requireInteraction is set
  if (!options.requireInteraction) {
    setTimeout(() => {
      chrome.notifications.clear(notifId);
    }, 10000);
  }
}

/**
 * Handle notification click events.
 */
export function handleNotificationClick(notifId) {
  // Task reschedule notification — route to Tasks panel
  if (notifId === 'task-reschedule') {
    chrome.tabs.query({ url: 'https://mail.google.com/*', active: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.sidePanel.open({ tabId: tabs[0].id }).catch(() => {});
        // Send message to sidebar to switch to Tasks panel
        setTimeout(() => {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'NAVIGATE_TO_TASKS',
          }).catch(() => {});
        }, 100);
      }
    });
  } else {
    // Default behavior — open the sidebar for other notifications
    chrome.tabs.query({ url: 'https://mail.google.com/*', active: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.sidePanel.open({ tabId: tabs[0].id }).catch(() => {});
      }
    });
  }
  chrome.notifications.clear(notifId);
}

/**
 * Check for tasks due today and send notifications.
 * Called on extension startup and periodically via alarm.
 */
export async function checkDueTasks() {
  const settings = await getSettings();
  if (!settings.enableNotifications || !settings.apiKey) return;

  // This will be called from the background service worker
  // after fetching tasks from the API
  try {
    const { fetchTasks } = await import('./api-client.js');
    const result = await fetchTasks([], [settings.userEmail]);

    if (result && result.tasks && result.tasks.length > 0) {
      const dueToday = result.tasks.filter(t => {
        if (!t.dueDate) return false;
        const today = new Date().toISOString().split('T')[0];
        return t.dueDate <= today;
      });

      if (dueToday.length > 0) {
        showNotification(
          'Tasks Due',
          `You have ${dueToday.length} task${dueToday.length > 1 ? 's' : ''} due today.`,
          { id: 'stratus-due-tasks', requireInteraction: true }
        );
      }
    }
  } catch (err) {
    console.warn('[Stratus Notifications] Due task check failed:', err.message);
  }
}
