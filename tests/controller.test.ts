import { beforeEach, describe, expect, it, vi } from "vitest";
import { FavoriteController } from "../src/core/controller";
import type {
  BrowserPort,
  BrowserTab,
  Favorite,
  FavoriteRuntime,
  FavoriteStore,
} from "../src/core/types";
import { siteKeyForUrl } from "../src/core/url";

class MemoryStore implements FavoriteStore {
  favorites: Favorite[] = [];
  runtimes: Record<string, FavoriteRuntime> = {};

  async loadFavorites() {
    return structuredClone(this.favorites);
  }
  async saveFavorites(favorites: Favorite[]) {
    this.favorites = structuredClone(favorites);
  }
  async loadRuntimes() {
    return structuredClone(this.runtimes);
  }
  async saveRuntimes(runtimes: Record<string, FavoriteRuntime>) {
    this.runtimes = structuredClone(runtimes);
  }
}

class FakeBrowser implements BrowserPort {
  tabs = new Map<number, BrowserTab>();
  nextId = 10;
  createdUrls: string[] = [];
  createdOptions: Array<{ active: boolean; discardAfterCreate: boolean }> = [];
  focused: BrowserTab[] = [];
  externalUrls: string[] = [];
  guards: Array<[number, string, string[]]> = [];
  disabledGuards: number[] = [];
  hintedTabs: number[] = [];
  discardedIds: number[] = [];
  focusFailureIds = new Set<number>();

  async getActiveTab() {
    return [...this.tabs.values()].find((tab) => tab.active);
  }
  async getTab(tabId: number) {
    return this.tabs.get(tabId);
  }
  async getPinnedTabs() {
    return [...this.tabs.values()].filter((tab) => tab.pinned);
  }
  async getActiveTabs() {
    return [...this.tabs.values()].filter((tab) => tab.active);
  }
  async createPinnedTab(url: string, active = true, discardAfterCreate = false, windowId = 1) {
    this.createdUrls.push(url);
    this.createdOptions.push({ active, discardAfterCreate });
    const tab = this.makeTab(this.nextId++, url, true, windowId);
    if (active) this.setOnlyActive(tab.id);
    return tab;
  }
  reordered: number[][] = [];
  async reorderPinnedTabs(ids: number[]) { this.reordered.push(ids); }
  async focusTab(tab: BrowserTab) {
    if (this.focusFailureIds.has(tab.id)) throw new Error("no such window");
    this.setOnlyActive(tab.id);
    const focused = { ...this.tabs.get(tab.id)!, pinned: true, active: true, discarded: false };
    this.tabs.set(tab.id, focused);
    this.focused.push(focused);
    return focused;
  }
  async updateTab(tabId: number, changes: { pinned?: boolean; url?: string }) {
    const current = this.tabs.get(tabId);
    if (!current) return undefined;
    const updated = {
      ...current,
      ...(changes.pinned !== undefined ? { pinned: changes.pinned } : {}),
      ...(changes.url !== undefined
        ? { url: changes.url, title: new URL(changes.url).hostname }
        : {}),
    };
    this.tabs.set(tabId, updated);
    return updated;
  }
  async discardTab(tabId: number) {
    const current = this.tabs.get(tabId);
    if (!current) return undefined;
    this.discardedIds.push(tabId);
    const discarded = {
      ...current,
      pending: false,
      discarded: true,
      status: "complete" as const,
    };
    this.tabs.set(tabId, discarded);
    return discarded;
  }
  async removeTab(tabId: number) {
    this.tabs.delete(tabId);
  }
  async openOrdinaryTab(url: string, opener?: BrowserTab) {
    this.externalUrls.push(url);
    return this.makeTab(this.nextId++, url, false, opener?.windowId ?? 1);
  }
  async installLinkGuard(tabId: number, siteKey: string, favoriteHosts: string[]) {
    this.guards.push([tabId, siteKey, favoriteHosts]);
  }
  async disableLinkGuard(tabId: number) {
    this.disabledGuards.push(tabId);
  }
  async showSwitchHint(tabId: number) {
    this.hintedTabs.push(tabId);
  }
  async hasSiteAccess() {
    return true;
  }

  makeTab(id: number, url: string, pinned = false, windowId = 1): BrowserTab {
    const tab: BrowserTab = {
      id,
      windowId,
      index: this.tabs.size,
      url,
      title: new URL(url).hostname,
      pinned,
      active: false,
    };
    this.tabs.set(id, tab);
    return tab;
  }

  setOnlyActive(tabId: number) {
    for (const [id, tab] of this.tabs) {
      this.tabs.set(id, { ...tab, active: id === tabId });
    }
  }
}

function seedFavorite(id: string, url: string, order = 0): Favorite {
  const hostname = new URL(url).hostname;
  return {
    id,
    homeUrl: url,
    title: hostname,
    order,
    createdAt: order + 1,
    lastKnownUrl: url,
    lastKnownTitle: hostname,
    siteKey: siteKeyForUrl(url),
    guardEnabled: false,
  };
}

let store: MemoryStore;
let browser: FakeBrowser;
let controller: FavoriteController;

beforeEach(() => {
  store = new MemoryStore();
  browser = new FakeBrowser();
  controller = new FavoriteController(browser, store, {
    now: () => 100,
    createId: () => "favorite-1",
  });
});

describe("FavoriteController", () => {
  it("adds and pins the active tab", async () => {
    const tab = browser.makeTab(1, "https://mail.example.com/inbox");
    browser.setOnlyActive(tab.id);

    const { snapshot } = await controller.addCurrent({ guardEnabled: true });

    expect(snapshot.favorites).toHaveLength(1);
    expect(browser.tabs.get(1)?.pinned).toBe(true);
    expect(snapshot.favorites[0]?.runtime?.tabId).toBe(1);
    expect(browser.guards).toEqual([[1, "example.com", ["mail.example.com"]]]);
  });

  it("focuses the existing global instance instead of creating a duplicate", async () => {
    const tab = browser.makeTab(1, "https://mail.example.com/", false, 9);
    browser.setOnlyActive(tab.id);
    await controller.addCurrent();
    browser.makeTab(2, "https://other.example.org/");
    browser.setOnlyActive(2);

    await controller.activate("favorite-1");
    await controller.activate("favorite-1");

    expect(browser.createdUrls).toEqual([]);
    expect(browser.focused.at(-1)?.windowId).toBe(9);
    expect(browser.focused).toHaveLength(2);
  });

  it("closes only the runtime and reopens from the saved home URL", async () => {
    const tab = browser.makeTab(1, "https://music.example.com/");
    browser.setOnlyActive(tab.id);
    await controller.addCurrent();
    const navigated = { ...browser.tabs.get(1)!, url: "https://music.example.com/album/42" };
    browser.tabs.set(1, navigated);
    await controller.handleTabUpdated(navigated);

    await controller.closeRuntime("favorite-1");
    expect(store.favorites).toHaveLength(1);
    expect(store.runtimes["favorite-1"]).toBeUndefined();

    const reopened = await controller.activate("favorite-1");
    expect(browser.createdUrls).toEqual(["https://music.example.com/"]);
    expect(reopened.favorites[0]?.runtime).toBeDefined();
  });

  it("restores a matching pinned tab after a browser restart", async () => {
    store.favorites = [
      {
        id: "favorite-1",
        homeUrl: "https://calendar.example.com/",
        title: "Calendar",
        order: 0,
        createdAt: 1,
        lastKnownUrl: "https://calendar.example.com/week",
        siteKey: "example.com",
        guardEnabled: false,
      },
    ];
    browser.makeTab(44, "https://calendar.example.com/week", true, 3);

    await controller.reconcile();

    expect(store.runtimes["favorite-1"]?.tabId).toBe(44);
    expect(store.runtimes["favorite-1"]?.windowId).toBe(3);
  });

  it("recreates a missing pinned Favorite after Chrome restarts", async () => {
    store.favorites = [
      {
        id: "favorite-1",
        homeUrl: "https://calendar.example.com/",
        title: "Calendar",
        order: 0,
        createdAt: 1,
        lastKnownUrl: "https://calendar.example.com/week",
        siteKey: "example.com",
        guardEnabled: true,
      },
    ];

    await controller.reconcile({ restoreMissing: true });

    expect(store.favorites).toHaveLength(1);
    expect(browser.createdUrls).toEqual(["https://calendar.example.com/"]);
    expect(store.runtimes["favorite-1"]?.tabId).toBe(10);
    expect(browser.tabs.get(10)?.active).toBe(false);
    expect(browser.createdOptions).toEqual([{ active: false, discardAfterCreate: true }]);
  });

  it("treats native pin and unpin actions as add and remove", async () => {
    const tab = browser.makeTab(1, "https://mail.example.com/inbox", true);

    expect(await controller.handlePinnedChanged(tab)).toBe(true);
    expect(store.favorites).toHaveLength(1);
    expect(store.runtimes["favorite-1"]?.tabId).toBe(1);

    const unpinned = { ...tab, pinned: false };
    browser.tabs.set(tab.id, unpinned);
    expect(await controller.handlePinnedChanged(unpinned)).toBe(true);
    expect(store.favorites).toEqual([]);
    expect(store.runtimes).toEqual({});
    expect(browser.disabledGuards).toEqual([1]);
  });

  it("adopts pinned tabs that already exist when the extension starts", async () => {
    browser.makeTab(7, "https://music.example.com/", true);

    await controller.reconcile({ adoptPinnedTabs: true });

    expect(store.favorites).toHaveLength(1);
    expect(store.favorites[0]?.homeUrl).toBe("https://music.example.com/");
    expect(store.runtimes["favorite-1"]?.tabId).toBe(7);
  });

  it("adopts and discards an inactive Chrome restore placeholder", async () => {
    const tab = browser.makeTab(7, "https://music.example.com/", true);
    browser.tabs.set(tab.id, {
      ...tab,
      title: "music.example.com",
      pending: true,
      discarded: false,
      status: "loading",
    });

    await controller.reconcile({ adoptPinnedTabs: true });

    expect(store.favorites).toHaveLength(1);
    expect(store.runtimes["favorite-1"]?.tabId).toBe(7);
    expect(browser.discardedIds).toEqual([7]);
    expect(browser.tabs.get(7)?.discarded).toBe(true);
  });

  it("recreates a directly closed pinned Favorite without stealing focus", async () => {
    const tab = browser.makeTab(1, "https://notes.example.com/");
    browser.setOnlyActive(tab.id);
    await controller.addCurrent();
    browser.tabs.delete(tab.id);

    expect(await controller.handleTabRemoved(tab.id, true)).toBe(true);

    expect(store.favorites).toHaveLength(1);
    expect(browser.createdUrls).toEqual(["https://notes.example.com/"]);
    expect(browser.tabs.get(10)?.pinned).toBe(true);
    expect(browser.tabs.get(10)?.active).toBe(false);
    expect(browser.createdOptions).toEqual([{ active: false, discardAfterCreate: true }]);
  });

  it("recreates a closed Favorite even when Chrome cleared session storage", async () => {
    store.favorites = [
      {
        id: "favorite-1",
        homeUrl: "https://www.bilibili.com/",
        title: "Bilibili",
        order: 0,
        createdAt: 1,
        lastKnownUrl: "https://www.bilibili.com/video/42",
        lastTabId: 88,
        siteKey: "bilibili.com",
        guardEnabled: true,
      },
    ];

    expect(await controller.handleTabRemoved(88, true)).toBe(true);

    expect(browser.createdUrls).toEqual(["https://www.bilibili.com/"]);
    expect(store.runtimes["favorite-1"]?.tabId).toBe(10);
    expect(store.favorites[0]?.lastTabId).toBe(10);
    expect(browser.createdOptions).toEqual([{ active: false, discardAfterCreate: true }]);
  });

  it("keeps cross-site links out of the managed tab", async () => {
    const tab = browser.makeTab(1, "https://docs.example.com/");
    browser.setOnlyActive(tab.id);
    await controller.addCurrent({ guardEnabled: true });

    await controller.openExternal("https://outside.test/article", browser.tabs.get(1));

    expect(browser.externalUrls).toEqual(["https://outside.test/article"]);
    expect(browser.tabs.get(1)?.url).toBe("https://docs.example.com/");
  });

  it("re-anchors the link guard when the Favorite tab lands on another site", async () => {
    const tab = browser.makeTab(1, "https://docs.example.com/");
    browser.setOnlyActive(tab.id);
    await controller.addCurrent({ guardEnabled: true });
    expect(browser.guards.at(-1)).toEqual([1, "example.com", ["docs.example.com"]]);

    const navigated = {
      ...browser.tabs.get(1)!,
      url: "https://other.test/page",
      title: "other.test",
    };
    browser.tabs.set(1, navigated);
    await controller.handleTabUpdated(navigated);

    expect(browser.guards.at(-1)).toEqual([1, "other.test", ["docs.example.com"]]);
  });

  it("keeps links inside the site the Favorite tab is currently showing", async () => {
    const tab = browser.makeTab(1, "https://docs.example.com/");
    browser.setOnlyActive(tab.id);
    await controller.addCurrent({ guardEnabled: true });

    const navigated = {
      ...browser.tabs.get(1)!,
      url: "https://other.test/page",
      title: "other.test",
    };
    browser.tabs.set(1, navigated);
    await controller.handleTabUpdated(navigated);

    await controller.openExternal("https://other.test/article", browser.tabs.get(1));
    await controller.openExternal("https://third.test/article", browser.tabs.get(1));

    expect(browser.externalUrls).toEqual(["https://third.test/article"]);
  });

  it("removes the definition but leaves a live tab open and unpinned", async () => {
    const tab = browser.makeTab(1, "https://notes.example.com/");
    browser.setOnlyActive(tab.id);
    await controller.addCurrent();

    await controller.remove("favorite-1");

    expect(store.favorites).toEqual([]);
    expect(browser.tabs.get(1)?.pinned).toBe(false);
    expect(browser.disabledGuards).toEqual([1]);
  });

  it("focuses an existing Favorite instead of registering the site twice", async () => {
    const first = browser.makeTab(1, "https://mail.example.com/inbox");
    browser.setOnlyActive(first.id);
    await controller.addCurrent({ guardEnabled: true });

    const second = browser.makeTab(2, "https://mail.example.com/sent");
    browser.setOnlyActive(second.id);
    const result = await controller.addCurrent({ guardEnabled: true });

    expect(result.outcome).toBe("focused-existing");
    expect(result.snapshot.favorites).toHaveLength(1);
    expect(browser.focused.at(-1)?.id).toBe(1);
    expect(browser.tabs.get(2)?.pinned).toBe(false);
  });

  it("adopts the current tab when the site's Favorite is asleep", async () => {
    const first = browser.makeTab(1, "https://mail.example.com/inbox");
    browser.setOnlyActive(first.id);
    await controller.addCurrent({ guardEnabled: true });
    await controller.closeRuntime("favorite-1");

    const reopened = browser.makeTab(5, "https://mail.example.com/sent");
    browser.setOnlyActive(reopened.id);
    const result = await controller.addCurrent({ guardEnabled: true });

    expect(result.outcome).toBe("adopted");
    expect(result.snapshot.favorites).toHaveLength(1);
    expect(store.runtimes["favorite-1"]?.tabId).toBe(5);
    expect(browser.tabs.get(5)?.pinned).toBe(true);
  });

  it("allows separate subdomains to be separate Favorites", async () => {
    let counter = 0;
    controller = new FavoriteController(browser, store, {
      now: () => 100,
      createId: () => `favorite-${(counter += 1)}`,
    });

    const mail = browser.makeTab(1, "https://mail.example.com/");
    browser.setOnlyActive(mail.id);
    await controller.addCurrent({ guardEnabled: true });

    const calendar = browser.makeTab(2, "https://calendar.example.com/");
    browser.setOnlyActive(calendar.id);
    const result = await controller.addCurrent({ guardEnabled: true });

    expect(result.outcome).toBe("added");
    expect(result.snapshot.favorites).toHaveLength(2);
  });

  it("keeps a second pinned tab of a running Favorite as a plain pinned tab", async () => {
    const first = browser.makeTab(1, "https://mail.example.com/");
    browser.setOnlyActive(first.id);
    await controller.addCurrent({ guardEnabled: true });

    const second = browser.makeTab(2, "https://mail.example.com/inbox", true);

    expect(await controller.handlePinnedChanged(second)).toBe(false);
    expect(store.favorites).toHaveLength(1);
    expect(store.runtimes["favorite-1"]?.tabId).toBe(1);
    expect(browser.tabs.get(2)?.pinned).toBe(true);
  });

  it("adopts a pinned tab when its Favorite has no live instance", async () => {
    store.favorites = [seedFavorite("favorite-9", "https://mail.example.com/")];

    const tab = browser.makeTab(3, "https://mail.example.com/inbox", true);

    expect(await controller.handlePinnedChanged(tab)).toBe(true);
    expect(store.favorites).toHaveLength(1);
    expect(store.favorites[0]?.id).toBe("favorite-9");
    expect(store.runtimes["favorite-9"]?.tabId).toBe(3);
  });

  it("replaces an orphaned session mapping instead of doubling it", async () => {
    store.runtimes = {
      ghost: {
        favoriteId: "ghost",
        tabId: 4,
        windowId: 1,
        currentUrl: "https://mail.example.com/",
        currentTitle: "mail.example.com",
        updatedAt: 1,
      },
    };
    const tab = browser.makeTab(4, "https://mail.example.com/inbox", true);

    expect(await controller.handlePinnedChanged(tab)).toBe(true);
    expect(store.favorites).toHaveLength(1);
    expect(Object.keys(store.runtimes)).toEqual(["favorite-1"]);
    expect(store.runtimes["favorite-1"]?.tabId).toBe(4);
  });

  it("reuses a same-site pinned tab when reconnecting an asleep Favorite", async () => {
    store.favorites = [seedFavorite("favorite-9", "https://mail.example.com/")];
    browser.makeTab(2, "https://mail.example.com/inbox", true);

    await controller.reconcile();

    expect(store.favorites).toHaveLength(1);
    expect(store.runtimes["favorite-9"]?.tabId).toBe(2);
  });

  it("does not turn an extra pinned tab into a duplicate Favorite on restart", async () => {
    store.favorites = [seedFavorite("favorite-9", "https://mail.example.com/")];
    store.runtimes = {
      "favorite-9": {
        favoriteId: "favorite-9",
        tabId: 1,
        windowId: 1,
        currentUrl: "https://mail.example.com/",
        currentTitle: "mail.example.com",
        updatedAt: 1,
      },
    };
    browser.makeTab(1, "https://mail.example.com/", true);
    browser.makeTab(2, "https://mail.example.com/inbox", true);

    await controller.reconcile({ adoptPinnedTabs: true });

    expect(store.favorites).toHaveLength(1);
    expect(Object.keys(store.runtimes)).toEqual(["favorite-9"]);
    expect(store.runtimes["favorite-9"]?.tabId).toBe(1);
  });

  it("refuses to edit a Favorite onto another Favorite's site", async () => {
    store.favorites = [
      seedFavorite("favorite-1", "https://mail.example.com/"),
      seedFavorite("favorite-2", "https://calendar.example.com/", 1),
    ];

    await expect(
      controller.update("favorite-2", { homeUrl: "https://mail.example.com/inbox" }),
    ).rejects.toThrow("已经是 Favorite");
  });

  it("refuses to use the current page as home when another Favorite owns the site", async () => {
    store.favorites = [
      seedFavorite("favorite-1", "https://mail.example.com/"),
      seedFavorite("favorite-2", "https://calendar.example.com/", 1),
    ];
    store.runtimes = {
      "favorite-2": {
        favoriteId: "favorite-2",
        tabId: 7,
        windowId: 1,
        currentUrl: "https://mail.example.com/inbox",
        currentTitle: "Inbox",
        updatedAt: 1,
      },
    };
    browser.makeTab(7, "https://mail.example.com/inbox");

    await expect(controller.useCurrentAsHome("favorite-2")).rejects.toThrow(
      "已经是 Favorite",
    );
  });

  it("hints when a running Favorite lives in another window", async () => {
    const tab = browser.makeTab(1, "https://mail.example.com/", false, 9);
    browser.setOnlyActive(tab.id);
    await controller.addCurrent({ guardEnabled: true });
    const other = browser.makeTab(2, "https://notes.example.org/", false, 1);
    browser.setOnlyActive(other.id);

    await controller.activate("favorite-1");

    expect(browser.focused.at(-1)?.windowId).toBe(9);
    expect(browser.hintedTabs).toEqual([1]);
  });

  it("does not hint when the instance is in the current window", async () => {
    const tab = browser.makeTab(1, "https://mail.example.com/", false, 1);
    browser.setOnlyActive(tab.id);
    await controller.addCurrent({ guardEnabled: true });
    const other = browser.makeTab(2, "https://notes.example.org/", false, 1);
    browser.setOnlyActive(other.id);

    await controller.activate("favorite-1");

    expect(browser.hintedTabs).toEqual([]);
  });

  it("hints when routing a link to an instance in another window", async () => {
    store.favorites = [
      seedFavorite("mail", "https://mail.example.com/"),
      seedFavorite("drive", "https://drive.example.com/", 1),
    ];
    store.runtimes = {
      mail: {
        favoriteId: "mail",
        tabId: 1,
        windowId: 1,
        currentUrl: "https://mail.example.com/",
        currentTitle: "Mail",
        updatedAt: 1,
      },
      drive: {
        favoriteId: "drive",
        tabId: 2,
        windowId: 7,
        currentUrl: "https://drive.example.com/",
        currentTitle: "Drive",
        updatedAt: 1,
      },
    };
    browser.makeTab(1, "https://mail.example.com/", false, 1);
    browser.makeTab(2, "https://drive.example.com/", true, 7);

    const outcome = await controller.routeLink(
      "https://drive.example.com/file/7",
      browser.tabs.get(1),
    );

    expect(outcome).toBe("handled");
    expect(browser.hintedTabs).toEqual([2]);
  });

  it("reclaims an extra pinned tab instead of opening a duplicate", async () => {
    const first = browser.makeTab(1, "https://mail.example.com/");
    browser.setOnlyActive(first.id);
    await controller.addCurrent({ guardEnabled: true });
    await controller.closeRuntime("favorite-1");
    browser.makeTab(2, "https://mail.example.com/inbox", true);

    const snapshot = await controller.activate("favorite-1");

    expect(browser.createdUrls).toEqual([]);
    expect(snapshot.favorites[0]?.runtime?.tabId).toBe(2);
    expect(store.favorites[0]?.lastKnownUrl).toBe("https://mail.example.com/inbox");
  });

  it("reclaims an extra pinned tab when a Favorite tab is closed", async () => {
    const tab = browser.makeTab(1, "https://mail.example.com/");
    browser.setOnlyActive(tab.id);
    await controller.addCurrent({ guardEnabled: true });
    browser.makeTab(2, "https://mail.example.com/inbox", true);
    browser.tabs.delete(1);

    expect(await controller.handleTabRemoved(1, true)).toBe(true);

    expect(browser.createdUrls).toEqual([]);
    expect(store.runtimes["favorite-1"]?.tabId).toBe(2);
  });

  it("does not restore a Favorite from a remembered id of another session", async () => {
    store.favorites = [
      { ...seedFavorite("mail", "https://mail.example.com/"), lastTabId: 42 },
    ];
    await controller.forgetRememberedTabs();
    const unrelated = browser.makeTab(42, "https://news.example.org/");

    expect(await controller.handleTabRemoved(unrelated.id, true)).toBe(false);
    expect(browser.createdUrls).toEqual([]);
    expect(store.favorites[0]?.lastTabId).toBeUndefined();
  });

  it("opens a fresh instance when the remembered one cannot be focused", async () => {
    store.favorites = [seedFavorite("mail", "https://mail.example.com/")];
    store.runtimes = {
      mail: {
        favoriteId: "mail",
        tabId: 1,
        windowId: 1,
        currentUrl: "https://mail.example.com/",
        currentTitle: "Mail",
        updatedAt: 1,
      },
    };
    browser.makeTab(1, "https://mail.example.com/", true);
    browser.focusFailureIds.add(1);

    const snapshot = await controller.activate("mail");

    expect(browser.createdUrls).toEqual(["https://mail.example.com/"]);
    expect(snapshot.favorites[0]?.runtime?.tabId).toBe(10);
  });

  it("treats an unpinned tab as a stale instance", async () => {
    store.favorites = [seedFavorite("mail", "https://mail.example.com/")];
    store.runtimes = {
      mail: {
        favoriteId: "mail",
        tabId: 1,
        windowId: 1,
        currentUrl: "https://mail.example.com/",
        currentTitle: "Mail",
        updatedAt: 1,
      },
    };
    browser.makeTab(1, "https://mail.example.com/", false, 1);

    const snapshot = await controller.getSnapshot();

    expect(snapshot.favorites[0]?.runtime).toBeUndefined();
    expect(store.runtimes).toEqual({});
  });

  it("repairs the remembered tab when it is stuck on about:blank", async () => {
    store.favorites = [
      { ...seedFavorite("mail", "https://mail.example.com/"), lastTabId: 7 },
    ];
    browser.makeTab(7, "about:blank", true);

    await controller.reconcile();

    expect(browser.tabs.get(7)?.url).toBe("https://mail.example.com/");
    expect(store.runtimes["mail"]?.tabId).toBe(7);
  });

  it("drops an orphaned session mapping instead of tracking it forever", async () => {
    store.runtimes = {
      ghost: {
        favoriteId: "ghost",
        tabId: 1,
        windowId: 1,
        currentUrl: "https://mail.example.com/",
        currentTitle: "Mail",
        updatedAt: 1,
      },
    };
    const tab = browser.makeTab(1, "https://mail.example.com/", true);

    expect(await controller.handleTabUpdated(tab)).toBe(false);
    expect(store.runtimes).toEqual({});
  });

  it("repairs a Favorite tab that Chrome left on about:blank", async () => {
    store.favorites = [seedFavorite("mail", "https://mail.example.com/")];
    store.runtimes = {
      mail: {
        favoriteId: "mail",
        tabId: 1,
        windowId: 1,
        currentUrl: "about:blank",
        currentTitle: "",
        updatedAt: 1,
      },
    };
    browser.makeTab(1, "about:blank", true);

    await controller.activate("mail");

    expect(browser.tabs.get(1)?.url).toBe("https://mail.example.com/");
    expect(store.runtimes["mail"]?.currentUrl).toBe("https://mail.example.com/");
  });

  it("repairs a blank Favorite tab during startup reconciliation", async () => {
    store.favorites = [seedFavorite("mail", "https://mail.example.com/")];
    store.runtimes = {
      mail: {
        favoriteId: "mail",
        tabId: 1,
        windowId: 1,
        currentUrl: "about:blank",
        currentTitle: "",
        updatedAt: 1,
      },
    };
    browser.makeTab(1, "about:blank", true);

    await controller.reconcile();

    expect(browser.tabs.get(1)?.url).toBe("https://mail.example.com/");
    expect(store.runtimes["mail"]?.tabId).toBe(1);
    expect(store.runtimes["mail"]?.currentUrl).toBe("https://mail.example.com/");
  });

  it("ignores unsupported navigation so a blank page cannot erase the saved URL", async () => {
    store.favorites = [seedFavorite("mail", "https://mail.example.com/")];
    store.runtimes = {
      mail: {
        favoriteId: "mail",
        tabId: 1,
        windowId: 1,
        currentUrl: "https://mail.example.com/",
        currentTitle: "Mail",
        updatedAt: 1,
      },
    };
    const tab = browser.makeTab(1, "https://mail.example.com/", false, 1);

    expect(await controller.handleTabUpdated({ ...tab, url: "about:blank", title: "" })).toBe(
      false,
    );
    expect(store.favorites[0]?.lastKnownUrl).toBe("https://mail.example.com/");
    expect(store.runtimes["mail"]?.currentUrl).toBe("https://mail.example.com/");
  });

  it("refreshes live guards after a Favorite is removed", async () => {
    let counter = 0;
    controller = new FavoriteController(browser, store, {
      now: () => 100,
      createId: () => `favorite-${(counter += 1)}`,
    });
    const mail = browser.makeTab(1, "https://mail.example.com/");
    browser.setOnlyActive(mail.id);
    await controller.addCurrent({ guardEnabled: true });
    const drive = browser.makeTab(2, "https://drive.example.com/");
    browser.setOnlyActive(drive.id);
    await controller.addCurrent({ guardEnabled: true });
    browser.guards.length = 0;

    await controller.remove("favorite-2");

    expect(browser.guards.at(-1)).toEqual([1, "example.com", ["mail.example.com"]]);
  });

  it("refreshes live guards after the home URL changes", async () => {
    store.favorites = [
      { ...seedFavorite("mail", "https://mail.example.com/"), guardEnabled: true },
      { ...seedFavorite("drive", "https://drive.example.com/", 1), guardEnabled: true },
    ];
    store.runtimes = {
      mail: {
        favoriteId: "mail",
        tabId: 1,
        windowId: 1,
        currentUrl: "https://mail.example.com/",
        currentTitle: "Mail",
        updatedAt: 1,
      },
      drive: {
        favoriteId: "drive",
        tabId: 2,
        windowId: 1,
        currentUrl: "https://docs.example.com/",
        currentTitle: "Docs",
        updatedAt: 1,
      },
    };
    browser.makeTab(1, "https://mail.example.com/");
    browser.makeTab(2, "https://docs.example.com/");

    await controller.useCurrentAsHome("drive");

    expect(store.favorites.find((favorite) => favorite.id === "drive")?.homeUrl).toBe(
      "https://docs.example.com/",
    );
    expect(browser.guards).toContainEqual([
      1,
      "example.com",
      ["mail.example.com", "docs.example.com"],
    ]);
  });

  it("focuses another running Favorite when a link points at its site", async () => {
    let counter = 0;
    controller = new FavoriteController(browser, store, {
      now: () => 100,
      createId: () => `favorite-${(counter += 1)}`,
    });
    const mail = browser.makeTab(1, "https://mail.example.com/");
    browser.setOnlyActive(mail.id);
    await controller.addCurrent({ guardEnabled: true });
    const drive = browser.makeTab(2, "https://drive.example.com/");
    browser.setOnlyActive(drive.id);
    await controller.addCurrent({ guardEnabled: true });
    browser.setOnlyActive(1);

    const outcome = await controller.routeLink(
      "https://drive.example.com/file/7",
      browser.tabs.get(1),
    );

    expect(outcome).toBe("handled");
    expect(browser.focused.at(-1)?.id).toBe(2);
    expect(browser.createdUrls).toEqual([]);
    expect(browser.tabs.get(1)?.url).toBe("https://mail.example.com/");
  });

  it("wakes a sleeping Favorite at the clicked link", async () => {
    store.favorites = [
      seedFavorite("mail", "https://mail.example.com/"),
      seedFavorite("drive", "https://drive.example.com/", 1),
    ];
    store.runtimes = {
      mail: {
        favoriteId: "mail",
        tabId: 1,
        windowId: 1,
        currentUrl: "https://mail.example.com/",
        currentTitle: "Mail",
        updatedAt: 1,
      },
    };
    browser.makeTab(1, "https://mail.example.com/");

    const outcome = await controller.routeLink(
      "https://drive.example.com/file/7",
      browser.tabs.get(1),
    );

    expect(outcome).toBe("handled");
    expect(browser.createdUrls).toEqual(["https://drive.example.com/file/7"]);
    expect(store.runtimes["drive"]?.tabId).toBe(10);
    expect(store.favorites.find((favorite) => favorite.id === "drive")?.lastKnownUrl).toBe(
      "https://drive.example.com/file/7",
    );
  });

  it("tells the guard to navigate when a link returns to the sender's own app", async () => {
    store.favorites = [seedFavorite("mail", "https://mail.example.com/")];
    store.runtimes = {
      mail: {
        favoriteId: "mail",
        tabId: 1,
        windowId: 1,
        currentUrl: "https://accounts.example.com/",
        currentTitle: "Accounts",
        updatedAt: 1,
      },
    };
    browser.makeTab(1, "https://accounts.example.com/");

    const outcome = await controller.routeLink(
      "https://mail.example.com/inbox",
      browser.tabs.get(1),
    );

    expect(outcome).toBe("navigate");
    expect(browser.createdUrls).toEqual([]);
  });

  it("stops intercepting cross-site links when the guard is switched off", async () => {
    const tab = browser.makeTab(1, "https://docs.example.com/");
    browser.setOnlyActive(tab.id);
    await controller.addCurrent({ guardEnabled: true });

    await controller.update("favorite-1", { guardEnabled: false });

    expect(store.favorites[0]?.guardEnabled).toBe(false);
    expect(browser.disabledGuards).toEqual([1]);

    await controller.update("favorite-1", { guardEnabled: true });

    expect(store.favorites[0]?.guardEnabled).toBe(true);
    expect(browser.guards.at(-1)).toEqual([1, "example.com", ["docs.example.com"]]);
  });
});

describe('Arc lifecycle regressions', () => {
  async function addMail(windowId = 1) {
    const tab = browser.makeTab(1, 'https://mail.example.com/', false, windowId);
    browser.setOnlyActive(tab.id);
    await controller.addCurrent();
  }

  it('reports Chrome memory saver state instead of calling a discarded tab running', async () => {
    await addMail();
    browser.tabs.set(1, { ...browser.tabs.get(1)!, active: false, discarded: true, status: 'loading' });
    const view = (await controller.getSnapshot()).favorites[0]!;
    expect(view.runtime).toMatchObject({ discarded: true, loading: false });
    expect(view.active).toBe(false);
  });

  it('sleeps in place without removing the native pinned entrance or its current URL', async () => {
    await addMail();
    browser.makeTab(2, 'https://other.test/');
    browser.setOnlyActive(2);
    browser.tabs.set(1, { ...browser.tabs.get(1)!, url: 'https://mail.example.com/message/42' });
    await controller.sleepRuntime('favorite-1');
    expect(browser.tabs.get(1)).toMatchObject({ pinned: true, discarded: true, url: 'https://mail.example.com/message/42' });
    await controller.activate('favorite-1');
    expect(browser.createdUrls).toEqual([]);
    expect(browser.tabs.get(1)?.discarded).toBe(false);
  });

  it('refuses to discard the active page or interrupt background audio', async () => {
    await addMail();
    await expect(controller.sleepRuntime('favorite-1')).rejects.toThrow('先切换');
    browser.tabs.set(1, { ...browser.tabs.get(1)!, active: false, audible: true });
    await expect(controller.sleepRuntime('favorite-1')).rejects.toThrow('暂停播放');
    expect(browser.discardedIds).toEqual([]);
  });

  it('restores a closed Favorite in its original window', async () => {
    await addMail(9);
    browser.tabs.delete(1);
    browser.makeTab(2, 'https://other.test/', false, 1);
    browser.setOnlyActive(2);
    await controller.handleTabRemoved(1, true, 9);
    expect(browser.tabs.get(10)).toMatchObject({ windowId: 9, active: false, pinned: true });
    expect(browser.reordered.at(-1)).toEqual([10]);
  });

  it('does not reopen a whole window when that window closes', async () => {
    await addMail(9);
    browser.tabs.delete(1);
    await controller.handleTabRemoved(1, false, 9);
    expect(browser.createdUrls).toEqual([]);
    expect(store.favorites).toHaveLength(1);
  });

  it('does not re-adopt a stale pin event after explicitly closing a page', async () => {
    await addMail();
    const stale = browser.tabs.get(1)!;
    await controller.closeRuntime('favorite-1');
    expect(await controller.handlePinnedChanged(stale)).toBe(false);
    expect(store.runtimes).toEqual({});
  });

  it('unpin still removes the entry after a popup snapshot cleaned its stale runtime', async () => {
    await addMail();
    const unpinned = { ...browser.tabs.get(1)!, pinned: false };
    browser.tabs.set(1, unpinned);
    await controller.getSnapshot();
    await controller.handlePinnedChanged(unpinned);
    expect(store.favorites).toEqual([]);
  });

  it('syncs popup ordering into the actual pinned tabs', async () => {
    store.favorites = [seedFavorite('a', 'https://a.test/'), seedFavorite('b', 'https://b.test/', 1)];
    browser.makeTab(1, 'https://a.test/', true);
    browser.makeTab(2, 'https://b.test/', true);
    await controller.reconcile();
    await controller.reorder(['b', 'a']);
    expect(browser.reordered.at(-1)).toEqual([2, 1]);
    expect(store.favorites.map((favorite) => favorite.id)).toEqual(['b', 'a']);
  });

  it('merges native order without moving Favorites from another window', async () => {
    store.favorites = [seedFavorite('a', 'https://a.test/'), seedFavorite('b', 'https://b.test/', 1), seedFavorite('c', 'https://c.test/', 2)];
    browser.makeTab(1, 'https://a.test/', true, 1);
    browser.makeTab(2, 'https://b.test/', true, 2);
    browser.makeTab(3, 'https://c.test/', true, 1);
    await controller.reconcile();
    browser.tabs.set(3, { ...browser.tabs.get(3)!, index: 0 });
    browser.tabs.set(1, { ...browser.tabs.get(1)!, index: 1 });
    expect(await controller.handleTabMoved(1)).toBe(true);
    expect(store.favorites.map((favorite) => favorite.id)).toEqual(['c', 'b', 'a']);
    expect(await controller.handleTabMoved(1)).toBe(false);
  });

  it('routes into an existing discarded tab at the clicked URL', async () => {
    await addMail();
    store.favorites.push(seedFavorite('drive', 'https://drive.example.com/', 1));
    const drive = browser.makeTab(2, 'https://drive.example.com/', true);
    browser.tabs.set(2, { ...drive, discarded: true });
    await controller.reconcile();
    await controller.routeLink('https://drive.example.com/file/42', browser.tabs.get(1));
    expect(browser.createdUrls).toEqual([]);
    expect(browser.tabs.get(2)?.url).toBe('https://drive.example.com/file/42');
  });

  it('adopts an existing extra pinned tab when routing to a missing instance', async () => {
    await addMail();
    store.favorites.push(seedFavorite('drive', 'https://drive.example.com/', 1));
    browser.makeTab(2, 'https://drive.example.com/file/42', true);
    await controller.routeLink('https://drive.example.com/', browser.tabs.get(1));
    expect(browser.createdUrls).toEqual([]);
    expect(store.runtimes.drive?.tabId).toBe(2);
  });

  it('never adopts a tab owned by another Favorite after it redirects to the target site', async () => {
    await addMail();
    store.favorites.push(seedFavorite('drive', 'https://drive.example.com/', 1));
    browser.tabs.set(1, { ...browser.tabs.get(1)!, url: 'https://drive.example.com/' });
    await controller.activate('drive');
    expect(store.runtimes.drive?.tabId).not.toBe(1);
    expect(store.runtimes['favorite-1']?.tabId).toBe(1);
  });

  it('does not inject a guard and accidentally wake discarded pages during startup', async () => {
    await addMail();
    browser.guards.length = 0;
    browser.tabs.set(1, { ...browser.tabs.get(1)!, active: false, discarded: true });
    await controller.reconcile();
    expect(browser.guards).toEqual([]);
  });
});


describe('failed Chrome mutations', () => {
  it('does not save a phantom Favorite when Chrome rejects pinning', async () => {
    browser.makeTab(1, 'https://mail.test/');
    browser.setOnlyActive(1);
    vi.spyOn(browser, 'updateTab').mockResolvedValue(undefined);
    await expect(controller.addCurrent()).rejects.toThrow('无法固定');
    expect(store.favorites).toEqual([]);
    expect(store.runtimes).toEqual({});
  });

  it('keeps the Favorite when Chrome rejects unpinning a live tab', async () => {
    browser.makeTab(1, 'https://mail.test/');
    browser.setOnlyActive(1);
    await controller.addCurrent();
    vi.spyOn(browser, 'updateTab').mockResolvedValue(undefined);
    await expect(controller.remove('favorite-1')).rejects.toThrow('无法取消固定');
    expect(store.favorites).toHaveLength(1);
    expect(store.runtimes['favorite-1']?.tabId).toBe(1);
  });
});
