import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const controller = vi.hoisted(() => ({
  forgetRememberedTabs: vi.fn(), reconcile: vi.fn(), handleTabRemoved: vi.fn(),
  handleTabMoved: vi.fn(), getSnapshot: vi.fn(),
}));
vi.mock('../src/core/controller', () => ({ FavoriteController: class { constructor() { return controller; } } }));

const event = () => ({ addListener: vi.fn() });
function browserMock(sessionReady: boolean) {
  return {
    runtime: { id: 'test', sendMessage: vi.fn().mockResolvedValue(undefined), onInstalled: event(), onStartup: event(), onMessage: event() },
    storage: { session: { get: vi.fn().mockResolvedValue(sessionReady ? { 'arcFavorites.sessionReady.v1': true } : {}), set: vi.fn() } },
    contextMenus: { removeAll: vi.fn(), create: vi.fn(), onClicked: event() },
    tabs: { onUpdated: event(), onCreated: event(), onRemoved: event(), onMoved: event(), onActivated: event(), onAttached: event(), onReplaced: event() },
    windows: { onFocusChanged: event() },
    permissions: { onAdded: event() },
  };
}
async function boot(sessionReady: boolean) {
  const chrome = browserMock(sessionReady);
  vi.stubGlobal('chrome', chrome);
  await import('../src/background');
  await vi.waitFor(() => expect(chrome.storage.session.set).toHaveBeenCalled());
  return chrome;
}

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('service worker startup and native events', () => {
  it('forgets IDs before the very first scan in a new browser session', async () => {
    await boot(false);
    expect(controller.forgetRememberedTabs).toHaveBeenCalledOnce();
    expect(controller.forgetRememberedTabs.mock.invocationCallOrder[0]).toBeLessThan(controller.reconcile.mock.invocationCallOrder[0]!);
    expect(controller.reconcile).toHaveBeenCalledWith({ adoptPinnedTabs: true, restoreMissing: false });
  });

  it('keeps IDs when Chrome wakes the worker again in the same session', async () => {
    await boot(true);
    expect(controller.forgetRememberedTabs).not.toHaveBeenCalled();
  });

  it('waits for Chrome restoration before creating missing Favorites', async () => {
    const chrome = await boot(false);
    vi.useFakeTimers();
    chrome.runtime.onStartup.addListener.mock.calls[0]![0]();
    await vi.advanceTimersByTimeAsync(4999);
    expect(controller.reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.reconcile).toHaveBeenLastCalledWith({ adoptPinnedTabs: true, restoreMissing: true });
    expect(controller.forgetRememberedTabs).toHaveBeenCalledOnce();
  });

  it('passes the closing window identity and coalesces native move events', async () => {
    const chrome = await boot(true);
    vi.useFakeTimers();
    chrome.tabs.onRemoved.addListener.mock.calls[0]![0](42, { windowId: 7, isWindowClosing: false });
    const moved = chrome.tabs.onMoved.addListener.mock.calls[0]![0];
    moved(1, { windowId: 7 });
    moved(2, { windowId: 7 });
    await vi.advanceTimersByTimeAsync(120);
    expect(controller.handleTabRemoved).toHaveBeenCalledWith(42, true, 7);
    expect(controller.handleTabMoved).toHaveBeenCalledExactlyOnceWith(7);
  });
});
