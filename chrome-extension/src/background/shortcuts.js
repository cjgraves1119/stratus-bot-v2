/**
 * Stratus AI Chrome Extension — Keyboard Shortcuts
 *
 * Handles chrome.commands for keyboard shortcuts.
 */

import { COMMANDS, MSG } from '../lib/constants.js';

/**
 * Handle keyboard shortcut commands.
 */
export async function handleCommand(command) {
  // Get the active Gmail tab
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*', active: true, currentWindow: true });
  if (tabs.length === 0) return;

  const tab = tabs[0];

  switch (command) {
    case COMMANDS.OPEN_SIDEBAR:
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
      } catch (err) {
        console.warn('[Stratus Shortcuts] Side panel not available, opening popup.');
      }
      break;

    case COMMANDS.QUICK_QUOTE:
      await chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: MSG.SIDEBAR_NAVIGATE,
          panel: 'quote',
        });
      }, 300);
      break;

    case COMMANDS.CRM_LOOKUP:
      await chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: MSG.SIDEBAR_NAVIGATE,
          panel: 'crm',
        });
      }, 300);
      break;

    case COMMANDS.ANALYZE_EMAIL:
      await chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: MSG.SIDEBAR_NAVIGATE,
          panel: 'email',
          action: 'analyze',
        });
      }, 300);
      break;

    case COMMANDS.VIEW_TASKS:
      await chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: MSG.SIDEBAR_NAVIGATE,
          panel: 'tasks',
        });
      }, 300);
      break;

    case COMMANDS.DRAFT_REPLY:
      await chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: MSG.SIDEBAR_NAVIGATE,
          panel: 'draft',
        });
      }, 300);
      break;
  }
}
