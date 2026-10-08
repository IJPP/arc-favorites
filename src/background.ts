import { ChromeBrowserPort, fromChromeTab } from "./core/chrome-port";
import { FavoriteController } from "./core/controller";
import { errorMessage, FavoritesError } from "./core/errors";
import { ChromeFavoriteStore } from "./core/storage";
import { appendLog, readLog } from "./core/log";
import type { ClientMessage, Diagnostics, MessageResponse } from "./core/types";

const ADD_CURRENT_MENU = "arc-favorites-add-current";
const SESSION_READY_KEY = "arcFavorites.sessionReady.v1";
const browserPort = new ChromeBrowserPort(appendLog);
const controller = new FavoriteController(browserPort, new ChromeFavoriteStore(), { log: appendLog });

async function diagnostics(): Promise<Diagnostics> {
  const state = await controller.getDiagnosticState();
  return {
    version: chrome.runtime.getManifest().version,
    generatedAt: new Date().toISOString(),
    favorites: state.favorites.map(({ id, homeUrl, lastKnownUrl, lastTabId, order }) => ({ id, homeUrl, lastKnownUrl, lastTabId, order })),
    runtimes: state.runtimes,
    pinnedTabs: state.pinnedTabs.map(({ id, windowId, index, url, discarded, status, pending }) => ({ id, windowId, index, url, discarded, status, pending })),
    log: await readLog(),
  };
}

async function broadcastStateChanged(): Promise<void> {
  try { await chrome.runtime.sendMessage({ type: "state-changed" }); }
  catch { /* The popup is usually closed. */ }
}

// A service worker also starts on ordinary tab events. Only a fresh browser
// session may invalidate old tab IDs, and this must happen BEFORE reconciliation.
// Gate event handlers too, so a startup event cannot race the initial scan.
const workerReady = (async () => {
  const session = await chrome.storage.session.get(SESSION_READY_KEY);
  if (!session[SESSION_READY_KEY]) {
    appendLog("browser-session-start");
    await controller.forgetRememberedTabs();
  }
  await controller.reconcile({ adoptPinnedTabs: true, restoreMissing: false });
  await chrome.storage.session.set({ [SESSION_READY_KEY]: true });
})();
void workerReady.then(broadcastStateChanged).catch((error) => console.warn("[Favorites] Startup failed", error));

async function runEvent(operation: () => Promise<unknown>): Promise<void> {
  try {
    await workerReady;
    if (await operation()) await broadcastStateChanged();
  } catch (error) { console.warn("[Favorites] Tab operation failed", error); }
}

async function setupMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: ADD_CURRENT_MENU,
    title: "加入 Favorites（固定标签页）",
    contexts: ["page"],
    documentUrlPatterns: ["http://*/*", "https://*/*"],
  });
}
void setupMenus().catch((error) => console.warn("[Favorites] Menu setup failed", error));

chrome.runtime.onInstalled.addListener(() => {
  void runEvent(async () => {
    await controller.reconcile({ adoptPinnedTabs: true, restoreMissing: false });
    return true;
  });
});
chrome.runtime.onStartup.addListener(() => {
  // Let Chrome restore its own tabs first; only then fill missing entrances.
  setTimeout(() => {
    void runEvent(async () => {
      await controller.reconcile({ adoptPinnedTabs: true, restoreMissing: true });
      return true;
    });
  }, 5_000);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== ADD_CURRENT_MENU || !tab) return;
  const converted = fromChromeTab(tab);
  if (!converted) return;
  void runEvent(async () => {
    try { return await controller.addCurrent({ tab: converted, guardEnabled: true }); }
    catch (error) {
      await chrome.action.setBadgeBackgroundColor({ tabId: converted.id, color: "#d93025" });
      await chrome.action.setBadgeText({ tabId: converted.id, text: "!" });
      await chrome.action.setTitle({ tabId: converted.id, title: errorMessage(error) });
      setTimeout(() => {
        void Promise.all([
          chrome.action.setBadgeText({ tabId: converted.id, text: "" }),
          chrome.action.setTitle({ tabId: converted.id, title: "管理 Favorites" }),
        ]).catch(() => undefined);
      }, 5_000);
      throw error;
    }
  });
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!["pinned", "url", "status", "title", "favIconUrl", "discarded", "audible"].some((key) => key in changeInfo)) return;
  const converted = fromChromeTab(tab);
  if (!converted) return;
  void runEvent(async () => {
    const changed = changeInfo.pinned !== undefined
      ? await controller.handlePinnedChanged(converted)
      : await controller.handleTabUpdated(converted);
    return changed || (converted.pinned && await controller.handlePinnedChanged(converted));
  });
});
chrome.tabs.onCreated.addListener((tab) => {
  const converted = fromChromeTab(tab);
  if (converted?.pinned) void runEvent(() => controller.handlePinnedChanged(converted));
});
chrome.tabs.onRemoved.addListener((tabId, info) => {
  void runEvent(() => controller.handleTabRemoved(tabId, !info.isWindowClosing, info.windowId));
});

// Coalesce move events and re-read the final order, including our own moves.
const moveTimers = new Map<number, ReturnType<typeof setTimeout>>();
chrome.tabs.onMoved.addListener((_tabId, info) => {
  clearTimeout(moveTimers.get(info.windowId));
  moveTimers.set(info.windowId, setTimeout(() => {
    moveTimers.delete(info.windowId);
    void runEvent(() => controller.handleTabMoved(info.windowId));
  }, 120));
});
// Site access can be granted later (popup prompt, extension details page);
// install the guards right away instead of waiting for the next page load.
chrome.permissions.onAdded.addListener(() => {
  appendLog("site-access-added");
  void runEvent(async () => {
    await controller.refreshAllGuards();
    return true;
  });
});
chrome.windows.onFocusChanged.addListener(() => { void broadcastStateChanged(); });
chrome.tabs.onActivated.addListener(() => { void broadcastStateChanged(); });
chrome.tabs.onAttached.addListener((tabId, info) => {
  void runEvent(() => controller.handleTabAttached(tabId, info.newWindowId));
});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void runEvent(() => controller.handleTabReplaced(addedTabId, removedTabId));
});

async function handleMessage(message: ClientMessage, sender: chrome.runtime.MessageSender): Promise<MessageResponse<unknown>> {
  try {
    await workerReady;
    let data: unknown;
    switch (message.type) {
      case "get-state": data = await controller.getSnapshot(); break;
      case "get-context": data = await controller.getContext(); break;
      case "get-diagnostics": data = await diagnostics(); break;
      case "count-stray-blanks": data = (await controller.findStrayBlanks()).length; break;
      case "close-stray-blanks": data = await controller.closeStrayBlanks(); break;
      case "add-current": data = await controller.addCurrent({ guardEnabled: message.guardEnabled }); break;
      case "activate": data = await controller.activate(message.favoriteId); break;
      case "sleep-runtime": data = await controller.sleepRuntime(message.favoriteId); break;
      case "close-runtime": data = await controller.closeRuntime(message.favoriteId); break;
      case "reset-home": data = await controller.resetHome(message.favoriteId); break;
      case "use-current-as-home": data = await controller.useCurrentAsHome(message.favoriteId); break;
      case "remove-favorite": data = await controller.remove(message.favoriteId); break;
      case "update-favorite": data = await controller.update(message.favoriteId, message.changes); break;
      case "reorder": data = await controller.reorder(message.orderedIds); break;
      case "open-external":
        data = await controller.openExternal(message.url, sender.tab ? fromChromeTab(sender.tab) : undefined, message.sameSite);
        break;
      case "route-link":
        data = await controller.routeLink(message.url, sender.tab ? fromChromeTab(sender.tab) : undefined);
        break;
      default: throw new FavoritesError("unknown-message", "无法识别该操作");
    }
    const readOnly = ["get-state", "get-context", "get-diagnostics", "count-stray-blanks", "open-external"];
    if (!readOnly.includes(message.type)) void broadcastStateChanged();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: {
      code: error instanceof FavoritesError ? error.code : "unexpected-error",
      message: errorMessage(error),
    } };
  }
}

chrome.runtime.onMessage.addListener((message: ClientMessage | { type: string }, sender, sendResponse) => {
  if (message?.type === "state-changed") return false;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: { code: "unauthorized-sender", message: "已拒绝非扩展来源的消息" } } satisfies MessageResponse<never>);
    return false;
  }
  void handleMessage(message as ClientMessage, sender).then(sendResponse);
  return true;
});
