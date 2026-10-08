import { createFavorite, reorderFavorites, sortFavorites, updateFavorite } from "./domain";
import { FavoritesError } from "./errors";
import { appNameFromTitle } from "./names";
import {
  MAX_FAVORITES,
  type AddFavoriteInput,
  type AddFavoriteOutcome,
  type AddFavoriteResult,
  type AppSnapshot,
  type BrowserPort,
  type BrowserTab,
  type CurrentTabContext,
  type Favorite,
  type FavoriteRuntime,
  type FavoriteStore,
  type Logger,
  type UpdateFavoriteInput,
} from "./types";
import {
  favoriteIdentityForUrl,
  isSupportedPage,
  normalizeWebUrl,
  siteKeyForUrl,
} from "./url";

interface ControllerOptions {
  now?: () => number;
  createId?: () => string;
  log?: Logger;
}

interface ReconcileOptions {
  adoptPinnedTabs?: boolean;
  restoreMissing?: boolean;
}

export class FavoriteController {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly log: Logger;
  /** Favorites whose page was already asked for its name in this worker. */
  private readonly nameChecked = new Set<string>();

  constructor(
    private readonly browser: BrowserPort,
    private readonly store: FavoriteStore,
    options: ControllerOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.log = options.log ?? (() => undefined);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async getSnapshot(): Promise<AppSnapshot> {
    return this.serialize(async () => {
      const favorites = sortFavorites(await this.store.loadFavorites());
      const runtimes = await this.store.loadRuntimes();
      const activeIds = new Set((await this.browser.getActiveTabs()).map((tab) => tab.id));
      let changed = false;

      for (const [favoriteId, runtime] of Object.entries(runtimes)) {
        const tab = await this.browser.getTab(runtime.tabId);
        // A mapping is only valid while the tab exists, is still pinned and
        // still has a definition behind it.
        if (
          !tab ||
          !tab.pinned ||
          !favorites.some((favorite) => favorite.id === favoriteId)
        ) {
          delete runtimes[favoriteId];
          changed = true;
        } else {
          // Read Chrome's actual lifecycle flags, including automatic memory saving.
          const fresh = this.runtimeFromTab(favoriteId, tab);
          fresh.updatedAt = runtime.updatedAt;
          runtimes[favoriteId] = fresh;
        }
      }
      if (changed) await this.store.saveRuntimes(runtimes);

      return {
        maxFavorites: MAX_FAVORITES,
        favorites: favorites.map((favorite) => ({
          ...favorite,
          runtime: runtimes[favorite.id],
          active: activeIds.has(runtimes[favorite.id]?.tabId ?? -1),
        })),
      };
    });
  }

  async addCurrent(input: AddFavoriteInput = {}): Promise<AddFavoriteResult> {
    let outcome: AddFavoriteOutcome = "added";
    let guardEnabled = input.guardEnabled ?? true;

    await this.serialize(async () => {
      const tab = input.tab ?? (await this.browser.getActiveTab());
      if (!tab || !isSupportedPage(tab.url)) {
        throw new FavoritesError("unsupported-page", "当前页面不能添加为 Favorite");
      }

      const favorites = sortFavorites(await this.store.loadFavorites());
      const runtimes = await this.store.loadRuntimes();
      const managed = Object.values(runtimes).find((runtime) => runtime.tabId === tab.id);
      if (managed) {
        throw new FavoritesError("already-favorite", "当前标签已经是 Favorite");
      }

      const identity = favoriteIdentityForUrl(tab.url);
      const existing = favorites.find(
        (favorite) => favoriteIdentityForUrl(favorite.homeUrl) === identity,
      );

      if (existing) {
        guardEnabled = existing.guardEnabled;
        const runtime = runtimes[existing.id];
        const live = runtime ? await this.browser.getTab(runtime.tabId) : undefined;
        if (live?.pinned) {
          outcome = "focused-existing";
          const focused = await this.focusFavoriteTab(live, tab.windowId);
          runtimes[existing.id] = this.runtimeFromTab(existing.id, focused);
          await this.store.saveRuntimes(runtimes);
          return;
        }

        // The entry is asleep: adopt this tab as its instance instead of
        // registering the site twice.
        outcome = "adopted";
        const pinnedTab = await this.browser.updateTab(tab.id, { pinned: true });
        if (!pinnedTab?.pinned) throw new FavoritesError("pin-failed", "Chrome 无法固定这个标签，请重新打开页面后再试");
        const index = favorites.findIndex((favorite) => favorite.id === existing.id);
        favorites[index] = {
          ...existing,
          lastTabId: pinnedTab.id,
          lastKnownUrl: pinnedTab.url,
          lastKnownTitle: pinnedTab.title,
          lastKnownIconUrl: pinnedTab.favIconUrl ?? existing.lastKnownIconUrl,
        };
        runtimes[existing.id] = this.runtimeFromTab(existing.id, pinnedTab);
        await Promise.all([
          this.store.saveFavorites(favorites),
          this.store.saveRuntimes(runtimes),
        ]);
        await this.syncPinnedOrder(favorites, runtimes);
        await this.maybeInstallGuard(
          favorites[index]!,
          pinnedTab.id,
          pinnedTab.url,
          this.favoriteHosts(favorites),
        );
        return;
      }

      const favorite = {
        ...createFavorite(favorites, {
          id: this.createId(),
          url: tab.url,
          title: tab.title,
          iconUrl: tab.favIconUrl,
          guardEnabled,
          now: this.now(),
        }),
        appName: await this.resolveAppName(tab),
        lastTabId: tab.id,
      };

      const pinnedTab = await this.browser.updateTab(tab.id, { pinned: true });
      if (!pinnedTab?.pinned) throw new FavoritesError("pin-failed", "Chrome 无法固定这个标签，请重新打开页面后再试");
      favorites.push(favorite);
      runtimes[favorite.id] = this.runtimeFromTab(favorite.id, pinnedTab);
      await Promise.all([
        this.store.saveFavorites(sortFavorites(favorites)),
        this.store.saveRuntimes(runtimes),
      ]);
      // A brand new site joined the list, so every live guard needs the new host.
      await this.refreshGuards(favorites, runtimes);
    });

    return { snapshot: await this.getSnapshot(), outcome, guardEnabled };
  }

  async activate(favoriteId: string): Promise<AppSnapshot> {
    await this.serialize(async () => {
      const favorites = await this.store.loadFavorites();
      const favorite = this.requireFavorite(favorites, favoriteId);
      const runtimes = await this.store.loadRuntimes();
      const origin = await this.browser.getActiveTab();
      let tab = runtimes[favoriteId]
        ? await this.browser.getTab(runtimes[favoriteId]!.tabId)
        : undefined;
      if (tab && !tab.pinned) tab = undefined;
      let adopted = false;
      if (!tab) {
        // An extra pinned tab for the same app stands in for the missing
        // instance: one app should never own two pinned tabs at once.
        tab = await this.findAdoptablePinnedTab(favorite);
        adopted = Boolean(tab);
      }

      if (tab) {
        tab = await this.repairUnsupportedTab(tab, favorite);
        try {
          tab = await this.focusFavoriteTab(tab, origin?.windowId);
        } catch {
          // The remembered instance disappeared between the lookup and the
          // switch (closed window); fall through and open a fresh one.
          tab = undefined;
        }
      }
      if (!tab) {
        tab = await this.browser.createPinnedTab(favorite.homeUrl);
      }

      runtimes[favoriteId] = this.runtimeFromTab(favoriteId, tab);
      const index = favorites.findIndex((item) => item.id === favoriteId);
      favorites[index] = adopted
        ? {
            ...favorite,
            lastTabId: tab.id,
            lastKnownUrl: tab.url,
            lastKnownTitle: tab.title,
            lastKnownIconUrl: tab.favIconUrl ?? favorite.lastKnownIconUrl,
          }
        : { ...favorite, lastTabId: tab.id };
      await Promise.all([
        this.store.saveFavorites(favorites),
        this.store.saveRuntimes(runtimes),
      ]);
      await this.syncPinnedOrder(favorites, runtimes);
      await this.maybeInstallGuard(favorite, tab.id, tab.url, this.favoriteHosts(favorites));
    });
    return this.getSnapshot();
  }

  async sleepRuntime(favoriteId: string): Promise<AppSnapshot> {
    await this.serialize(async () => {
      this.requireFavorite(await this.store.loadFavorites(), favoriteId);
      const runtimes = await this.store.loadRuntimes();
      const runtime = runtimes[favoriteId];
      const tab = runtime ? await this.browser.getTab(runtime.tabId) : undefined;
      if (!tab?.pinned || tab.discarded) return;
      if (tab.active || tab.audible) {
        throw new FavoritesError("tab-in-use", "请先切换到其他标签并暂停播放，再让这个 Favorite 休眠");
      }
      const discarded = await this.browser.discardTab(tab.id);
      if (!discarded?.discarded) {
        throw new FavoritesError("discard-failed", "Chrome 暂时无法休眠这个标签，请稍后再试");
      }
      runtimes[favoriteId] = this.runtimeFromTab(favoriteId, discarded);
      await this.store.saveRuntimes(runtimes);
    });
    return this.getSnapshot();
  }

  async closeRuntime(favoriteId: string): Promise<AppSnapshot> {
    await this.serialize(async () => {
      const runtimes = await this.store.loadRuntimes();
      const runtime = runtimes[favoriteId];
      if (!runtime) return;
      delete runtimes[favoriteId];
      const favorites = await this.store.loadFavorites();
      const index = favorites.findIndex((favorite) => favorite.id === favoriteId);
      if (index >= 0) favorites[index] = { ...favorites[index]!, lastTabId: undefined };
      await Promise.all([
        this.store.saveFavorites(favorites),
        this.store.saveRuntimes(runtimes),
      ]);
      await this.browser.removeTab(runtime.tabId);
    });
    return this.getSnapshot();
  }

  async resetHome(favoriteId: string): Promise<AppSnapshot> {
    await this.serialize(async () => {
      const favorites = await this.store.loadFavorites();
      const favorite = this.requireFavorite(favorites, favoriteId);
      const runtimes = await this.store.loadRuntimes();
      const runtime = runtimes[favoriteId];
      if (!runtime) return;
      const tab = await this.browser.updateTab(runtime.tabId, { url: favorite.homeUrl });
      if (!tab) {
        delete runtimes[favoriteId];
      } else {
        runtimes[favoriteId] = this.runtimeFromTab(favoriteId, tab);
      }
      await this.store.saveRuntimes(runtimes);
    });
    return this.getSnapshot();
  }

  async useCurrentAsHome(favoriteId: string): Promise<AppSnapshot> {
    await this.serialize(async () => {
      const favorites = await this.store.loadFavorites();
      const index = favorites.findIndex((favorite) => favorite.id === favoriteId);
      if (index < 0) throw new FavoritesError("not-found", "找不到这个 Favorite");
      const runtimes = await this.store.loadRuntimes();
      const runtime = runtimes[favoriteId];
      const tab = runtime ? await this.browser.getTab(runtime.tabId) : undefined;
      if (!tab || !isSupportedPage(tab.url)) {
        throw new FavoritesError("not-running", "请先打开这个 Favorite");
      }

      const current = favorites[index]!;
      const nextHomeUrl = normalizeWebUrl(tab.url);
      const nextIdentity = favoriteIdentityForUrl(nextHomeUrl);
      if (
        favorites.some(
          (favorite, position) =>
            position !== index && favoriteIdentityForUrl(favorite.homeUrl) === nextIdentity,
        )
      ) {
        throw new FavoritesError("site-already-favorite", "这个站点已经是 Favorite 了");
      }
      favorites[index] = {
        ...current,
        homeUrl: nextHomeUrl,
        siteKey: siteKeyForUrl(tab.url),
        title: tab.title || current.title,
        lastKnownUrl: tab.url,
        lastKnownTitle: tab.title,
        lastKnownIconUrl: tab.favIconUrl,
      };
      await this.store.saveFavorites(favorites);
      // The Favorite now owns a different host; refresh every live guard.
      await this.refreshGuards(favorites, runtimes);
    });
    return this.getSnapshot();
  }

  async update(favoriteId: string, changes: UpdateFavoriteInput): Promise<AppSnapshot> {
    await this.serialize(async () => {
      const favorites = await this.store.loadFavorites();
      const index = favorites.findIndex((favorite) => favorite.id === favoriteId);
      if (index < 0) throw new FavoritesError("not-found", "找不到这个 Favorite");

      const updated = updateFavorite(favorites[index]!, changes);
      const updatedIdentity = favoriteIdentityForUrl(updated.homeUrl);
      if (
        favorites.some(
          (favorite, position) =>
            position !== index && favoriteIdentityForUrl(favorite.homeUrl) === updatedIdentity,
        )
      ) {
        throw new FavoritesError("site-already-favorite", "这个站点已经是 Favorite 了");
      }
      if (updated.guardEnabled && !(await this.browser.hasSiteAccess(updated.siteKey))) {
        throw new FavoritesError("site-access-needed", "需要先允许该网站的链接访问权限");
      }
      favorites[index] = updated;
      await this.store.saveFavorites(favorites);

      const runtimes = await this.store.loadRuntimes();
      const runtime = runtimes[favoriteId];
      if (runtime && !updated.guardEnabled) {
        await this.browser.disableLinkGuard(runtime.tabId);
      }
      // The home identity or the guard flag may have changed; every live guard
      // needs the refreshed Favorite host list.
      await this.refreshGuards(favorites, runtimes);
    });
    return this.getSnapshot();
  }

  async remove(favoriteId: string): Promise<AppSnapshot> {
    await this.serialize(async () => {
      const favorites = await this.store.loadFavorites();
      const runtimes = await this.store.loadRuntimes();
      const runtime = runtimes[favoriteId];
      const remaining = sortFavorites(favorites.filter((favorite) => favorite.id !== favoriteId)).map(
        (favorite, order) => ({ ...favorite, order }),
      );
      if (remaining.length === favorites.length) {
        throw new FavoritesError("not-found", "找不到这个 Favorite");
      }

      if (runtime) {
        const tab = await this.browser.getTab(runtime.tabId);
        if (tab?.pinned) {
          const unpinned = await this.browser.updateTab(runtime.tabId, { pinned: false });
          if (!unpinned && await this.browser.getTab(runtime.tabId)) {
            throw new FavoritesError("unpin-failed", "Chrome 无法取消固定，请稍后再试");
          }
        }
        await this.browser.disableLinkGuard(runtime.tabId);
      }
      delete runtimes[favoriteId];
      await Promise.all([
        this.store.saveFavorites(remaining),
        this.store.saveRuntimes(runtimes),
      ]);
      // The removed host must disappear from every other live guard.
      await this.refreshGuards(remaining, runtimes);
    });
    return this.getSnapshot();
  }

  async reorder(orderedIds: string[]): Promise<AppSnapshot> {
    await this.serialize(async () => {
      const favorites = await this.store.loadFavorites();
      const reordered = reorderFavorites(favorites, orderedIds);
      await this.syncPinnedOrder(reordered, await this.store.loadRuntimes());
      await this.store.saveFavorites(reordered);
    });
    return this.getSnapshot();
  }

  async handleTabMoved(windowId: number): Promise<boolean> {
    return this.serialize(async () => {
      const favorites = sortFavorites(await this.store.loadFavorites());
      const runtimes = await this.store.loadRuntimes();
      const pinned = (await this.browser.getPinnedTabs())
        .filter((tab) => tab.windowId === windowId).sort((a, b) => a.index - b.index);
      const byTab = new Map(favorites.flatMap((favorite) => {
        const runtime = runtimes[favorite.id];
        return runtime ? [[runtime.tabId, favorite] as const] : [];
      }));
      const ordered = pinned.flatMap((tab) => byTab.has(tab.id) ? [byTab.get(tab.id)!] : []);
      const localIds = new Set(ordered.map((favorite) => favorite.id));
      let index = 0;
      const ids = favorites.map((favorite) => localIds.has(favorite.id) ? ordered[index++]!.id : favorite.id);
      if (ids.every((id, position) => id === favorites[position]!.id)) return false;
      await this.store.saveFavorites(reorderFavorites(favorites, ids));
      return true;
    });
  }

  async handleTabUpdated(tab: BrowserTab): Promise<boolean> {
    return this.serialize(async () => {
      const runtimes = await this.store.loadRuntimes();
      const runtime = Object.values(runtimes).find((item) => item.tabId === tab.id);
      if (!runtime) return false;
      // about:blank, chrome:// and friends must not overwrite the saved URL of
      // a Favorite, otherwise the entry loses the page it stands for.
      if (!isSupportedPage(tab.url)) return false;

      const favorites = await this.store.loadFavorites();
      const index = favorites.findIndex((favorite) => favorite.id === runtime.favoriteId);
      if (index < 0) {
        // Orphaned mapping: the definition is gone, so stop tracking the tab
        // and let the caller re-evaluate it (adopt it or leave it alone).
        delete runtimes[runtime.favoriteId];
        await this.store.saveRuntimes(runtimes);
        return false;
      }

      runtimes[runtime.favoriteId] = this.runtimeFromTab(runtime.favoriteId, tab);
      const favorite = favorites[index]!;
      let appName = favorite.appName;
      if (!appName && tab.status === "complete" && !tab.discarded && !this.nameChecked.has(favorite.id)) {
        this.nameChecked.add(favorite.id);
        appName = await this.browser.readAppName?.(tab.id);
      }
      favorites[index] = {
        ...favorite,
        ...(appName ? { appName } : {}),
        lastKnownUrl: tab.url,
        lastKnownTitle: tab.title,
        lastKnownIconUrl: tab.favIconUrl ?? favorite.lastKnownIconUrl,
        lastTabId: tab.id,
      };
      await this.maybeInstallGuard(
        favorites[index]!,
        tab.id,
        tab.url,
        this.favoriteHosts(favorites),
      );
      await Promise.all([
        this.store.saveFavorites(favorites),
        this.store.saveRuntimes(runtimes),
      ]);
      return true;
    });
  }

  async handlePinnedChanged(tab: BrowserTab): Promise<boolean> {
    return this.serialize(async () => {
      const currentTab = await this.browser.getTab(tab.id);
      if (!currentTab) return false;
      tab = currentTab;
      const favorites = sortFavorites(await this.store.loadFavorites());
      const runtimes = await this.store.loadRuntimes();
      const remembered = favorites.find((favorite) => favorite.lastTabId === tab.id);
      const runtime = Object.values(runtimes).find((item) => item.tabId === tab.id)
        ?? (remembered ? this.runtimeFromTab(remembered.id, tab) : undefined);

      if (!tab.pinned) {
        if (!runtime) return false;
        const remaining = favorites
          .filter((favorite) => favorite.id !== runtime.favoriteId)
          .map((favorite, order) => ({ ...favorite, order }));
        delete runtimes[runtime.favoriteId];
        await Promise.all([
          this.store.saveFavorites(remaining),
          this.store.saveRuntimes(runtimes),
        ]);
        await this.browser.disableLinkGuard(tab.id);
        await this.refreshGuards(remaining, runtimes);
        return true;
      }

      if (!isSupportedPage(tab.url)) return false;
      let favorite = runtime
        ? favorites.find((item) => item.id === runtime.favoriteId)
        : undefined;
      let droppedOrphan = false;
      if (runtime && !favorite) {
        // The definition is gone; drop the orphaned mapping so this tab can be
        // registered cleanly instead of being mapped twice.
        delete runtimes[runtime.favoriteId];
        droppedOrphan = true;
      }

      if (!favorite) {
        const identity = favoriteIdentityForUrl(tab.url);
        const existing = favorites.find(
          (item) => favoriteIdentityForUrl(item.homeUrl) === identity,
        );
        // Reuse an existing entry only while it has no live instance. A second
        // pinned tab of a running Favorite stays a plain pinned tab.
        if (existing) {
          const existingRuntime = runtimes[existing.id];
          const existingTab = existingRuntime ? await this.browser.getTab(existingRuntime.tabId) : undefined;
          if (existingTab?.pinned) {
            if (droppedOrphan) await this.store.saveRuntimes(runtimes);
            return false;
          }
          favorite = existing;
        }
      }

      let created = false;
      if (!favorite) {
        favorite = {
          ...createFavorite(favorites, {
            id: this.createId(),
            url: tab.url,
            title: tab.title,
            iconUrl: tab.favIconUrl,
            guardEnabled: true,
            now: this.now(),
          }),
          appName: await this.resolveAppName(tab),
        };
        favorites.push(favorite);
        created = true;
      }

      const index = favorites.findIndex((item) => item.id === favorite.id);
      favorites[index] = {
        ...favorite,
        lastKnownUrl: tab.url,
        lastKnownTitle: tab.title,
        lastKnownIconUrl: tab.favIconUrl ?? favorite.lastKnownIconUrl,
        lastTabId: tab.id,
      };
      runtimes[favorite.id] = this.runtimeFromTab(favorite.id, tab);
      await Promise.all([
        this.store.saveFavorites(sortFavorites(favorites)),
        this.store.saveRuntimes(runtimes),
      ]);
      if (created) {
        // A new site joined the list; refresh the host list in every live guard.
        await this.refreshGuards(favorites, runtimes);
      } else {
        await this.maybeInstallGuard(
          favorites[index]!,
          tab.id,
          tab.url,
          this.favoriteHosts(favorites),
        );
      }
      return true;
    });
  }

  async handleTabRemoved(tabId: number, restorePinned = false, windowId?: number): Promise<boolean> {
    return this.serialize(async () => {
      const favorites = await this.store.loadFavorites();
      const runtimes = await this.store.loadRuntimes();
      const entry = Object.entries(runtimes).find(([, runtime]) => runtime.tabId === tabId);
      const favoriteId =
        entry?.[0] ?? favorites.find((favorite) => favorite.lastTabId === tabId)?.id;
      if (!favoriteId) return false;
      delete runtimes[favoriteId];

      if (restorePinned) {
        const favorite = this.requireFavorite(favorites, favoriteId);
        const adopted = await this.findAdoptablePinnedTab(favorite, tabId);
        const restored =
          adopted ?? (await this.browser.createPinnedTab(favorite.homeUrl, false, true, windowId ?? entry?.[1].windowId));
        this.log("restore-after-close", { favoriteId, closedTabId: tabId, restoredTabId: restored.id, adopted: Boolean(adopted) });
        runtimes[favorite.id] = this.runtimeFromTab(favorite.id, restored);
        const index = favorites.findIndex((item) => item.id === favorite.id);
        favorites[index] = adopted
          ? {
              ...favorite,
              lastTabId: restored.id,
              lastKnownUrl: restored.url,
              lastKnownTitle: restored.title,
              lastKnownIconUrl: restored.favIconUrl ?? favorite.lastKnownIconUrl,
            }
          : { ...favorite, lastTabId: restored.id };
        await this.syncPinnedOrder(favorites, runtimes);
        await this.maybeInstallGuard(
          favorites[index]!,
          restored.id,
          restored.url,
          this.favoriteHosts(favorites),
        );
      }

      await Promise.all([
        this.store.saveFavorites(favorites),
        this.store.saveRuntimes(runtimes),
      ]);
      return true;
    });
  }

  /**
   * Tab ids are only unique inside one browser session, so the remembered ids
   * are dropped when the profile starts again. Within a session they still let
   * a close event be recognised even if the session mapping was cleared.
   */
  async forgetRememberedTabs(): Promise<void> {
    await this.serialize(async () => {
      const favorites = await this.store.loadFavorites();
      if (!favorites.some((favorite) => favorite.lastTabId !== undefined)) return;
      await this.store.saveFavorites(
        favorites.map((favorite) => ({ ...favorite, lastTabId: undefined })),
      );
    });
  }

  async handleTabAttached(tabId: number, windowId: number): Promise<boolean> {
    return this.serialize(async () => {
      const runtimes = await this.store.loadRuntimes();
      const runtime = Object.values(runtimes).find((item) => item.tabId === tabId);
      if (!runtime) return false;
      runtimes[runtime.favoriteId] = { ...runtime, windowId, updatedAt: this.now() };
      await this.store.saveRuntimes(runtimes);
      return true;
    });
  }

  async handleTabReplaced(addedTabId: number, removedTabId: number): Promise<boolean> {
    return this.serialize(async () => {
      const runtimes = await this.store.loadRuntimes();
      const runtime = Object.values(runtimes).find((item) => item.tabId === removedTabId);
      if (!runtime) return false;
      const tab = await this.browser.getTab(addedTabId);
      if (!tab) return false;
      runtimes[runtime.favoriteId] = this.runtimeFromTab(runtime.favoriteId, tab);
      const favorites = await this.store.loadFavorites();
      const index = favorites.findIndex((favorite) => favorite.id === runtime.favoriteId);
      if (index >= 0) favorites[index] = { ...favorites[index]!, lastTabId: tab.id };
      await Promise.all([
        this.store.saveFavorites(favorites),
        this.store.saveRuntimes(runtimes),
      ]);
      return true;
    });
  }

  async reconcile(options: ReconcileOptions = {}): Promise<void> {
    await this.serialize(async () => {
      const favorites = sortFavorites(await this.store.loadFavorites());
      const previous = await this.store.loadRuntimes();
      const pinnedTabs = await this.browser.getPinnedTabs();
      const runtimes: Record<string, FavoriteRuntime> = {};
      const usedTabIds = new Set<number>();

      for (const favorite of favorites) {
        const prior = previous[favorite.id];
        let tab = prior ? await this.browser.getTab(prior.tabId) : undefined;
        if (tab && !tab.pinned) tab = undefined;
        if (tab && usedTabIds.has(tab.id)) tab = undefined;
        if (!tab) {
          tab = this.pickReconciliationCandidate(favorite, pinnedTabs, usedTabIds);
        }
        if (!tab && favorite.lastTabId !== undefined) {
          const remembered = await this.browser.getTab(favorite.lastTabId);
          // Only a pinned tab without a usable URL is trusted here (a Favorite
          // stuck on about:blank), never a recycled id that now belongs to
          // somebody else.
          if (
            remembered &&
            remembered.pinned &&
            !usedTabIds.has(remembered.id) &&
            !isSupportedPage(remembered.url)
          ) {
            tab = remembered;
          }
        }
        if (!tab) continue;
        if (!isSupportedPage(tab.url)) {
          // A tab that came back on about:blank is navigated to its saved URL
          // again instead of being abandoned as a blank Favorite.
          tab = await this.repairUnsupportedTab(tab, favorite);
        }
        usedTabIds.add(tab.id);
        favorite.lastTabId = tab.id;
        runtimes[favorite.id] = this.runtimeFromTab(favorite.id, tab);
      }

      if (options.adoptPinnedTabs) {
        const coveredIdentities = new Set(
          favorites.map((favorite) => favoriteIdentityForUrl(favorite.homeUrl)),
        );
        for (const tab of pinnedTabs) {
          if (usedTabIds.has(tab.id) || !isSupportedPage(tab.url)) continue;
          // Extra pinned tabs for a site that already has a Favorite stay plain
          // pinned tabs instead of becoming duplicate entries.
          if (coveredIdentities.has(favoriteIdentityForUrl(tab.url))) continue;
          if (favorites.length >= MAX_FAVORITES) break;
          const settledTab = tab;
          const favorite = createFavorite(favorites, {
            id: this.createId(),
            url: settledTab.url,
            title: settledTab.title,
            iconUrl: settledTab.favIconUrl,
            guardEnabled: true,
            now: this.now(),
          });
          favorites.push(favorite);
          coveredIdentities.add(favoriteIdentityForUrl(settledTab.url));
          usedTabIds.add(settledTab.id);
          favorite.lastTabId = settledTab.id;
          runtimes[favorite.id] = this.runtimeFromTab(favorite.id, settledTab);
        }
      }

      if (options.restoreMissing) {
        // Tab ids do not survive a restart, so a Favorite that came back as a
        // blank pinned tab cannot be recognised by id. Such idle blanks are
        // reused (in tab-strip order) before any new tab is created, so a
        // blank left by an earlier session is consumed instead of piling up.
        const blanks = pinnedTabs
          .filter((tab) => !usedTabIds.has(tab.id) && this.isIdleBlank(tab))
          .sort((a, b) => a.windowId - b.windowId || a.index - b.index);
        for (const favorite of favorites) {
          if (runtimes[favorite.id]) continue;
          const blank = blanks.shift();
          const tab = blank
            ? await this.repairUnsupportedTab(blank, favorite)
            : await this.browser.createPinnedTab(favorite.homeUrl, false, true);
          this.log(blank ? "restore-reused-blank" : "restore-created", { favoriteId: favorite.id, tabId: tab.id });
          usedTabIds.add(tab.id);
          favorite.lastTabId = tab.id;
          runtimes[favorite.id] = this.runtimeFromTab(favorite.id, tab);
        }
      }
      this.log("reconcile", {
        restoreMissing: Boolean(options.restoreMissing),
        favorites: favorites.length,
        matched: Object.keys(runtimes).length,
        pinned: pinnedTabs.length,
        blanks: pinnedTabs.filter((tab) => this.isIdleBlank(tab)).length,
      });

      if (options.restoreMissing) await this.syncPinnedOrder(favorites, runtimes);
      // Install once, with the final Favorite list, so every live tab knows
      // which hosts belong to other entries.
      await this.refreshGuards(favorites, runtimes);

      await Promise.all([
        this.store.saveFavorites(sortFavorites(favorites)),
        this.store.saveRuntimes(runtimes),
      ]);
    });
  }

  /** Describes the active tab for the popup's context card. */
  async getContext(): Promise<CurrentTabContext> {
    return this.serialize(async () => {
      const tab = await this.browser.getActiveTab();
      if (!tab || !isSupportedPage(tab.url)) return { kind: "unsupported", url: tab?.url, title: tab?.title };
      const favorites = await this.store.loadFavorites();
      const runtimes = await this.store.loadRuntimes();
      const base = { url: tab.url, title: tab.title };
      const own = Object.values(runtimes).find((runtime) => runtime.tabId === tab.id);
      const owner = own && favorites.find((favorite) => favorite.id === own.favoriteId);
      if (owner) {
        return {
          ...base,
          kind: "favorite",
          favoriteId: owner.id,
          atHome: this.comparableUrl(tab.url) === this.comparableUrl(owner.homeUrl),
        };
      }
      const identity = favoriteIdentityForUrl(tab.url);
      const sameSite = favorites.find((favorite) => favoriteIdentityForUrl(favorite.homeUrl) === identity);
      if (sameSite) return { ...base, kind: "same-site", favoriteId: sameSite.id };
      return { ...base, kind: favorites.length >= MAX_FAVORITES ? "full" : "addable" };
    });
  }

  /** Pinned about:blank tabs that no Favorite owns (leftovers of older versions). */
  async findStrayBlanks(): Promise<number[]> {
    return this.serialize(async () => {
      const runtimes = await this.store.loadRuntimes();
      const owned = new Set(Object.values(runtimes).map((runtime) => runtime.tabId));
      return (await this.browser.getPinnedTabs())
        .filter((tab) => !owned.has(tab.id) && this.isIdleBlank(tab))
        .map((tab) => tab.id);
    });
  }

  async closeStrayBlanks(): Promise<number> {
    const ids = await this.findStrayBlanks();
    for (const id of ids) await this.browser.removeTab(id);
    this.log("close-stray-blanks", { count: ids.length });
    return ids.length;
  }

  async getDiagnosticState(): Promise<{
    favorites: Favorite[];
    runtimes: Record<string, FavoriteRuntime>;
    pinnedTabs: BrowserTab[];
  }> {
    return this.serialize(async () => ({
      favorites: sortFavorites(await this.store.loadFavorites()),
      runtimes: await this.store.loadRuntimes(),
      pinnedTabs: await this.browser.getPinnedTabs(),
    }));
  }

  /** Opens a link from a Favorite in an ordinary tab; "navigate" asks the page to follow it in place. */
  async openExternal(url: string, senderTab: BrowserTab | undefined, sameSite = false): Promise<"opened" | "navigate"> {
    return this.serialize(async () => {
      if (!senderTab || !isSupportedPage(url)) {
        throw new FavoritesError("invalid-external-link", "无法打开这个外部链接");
      }
      const runtimes = await this.store.loadRuntimes();
      const runtime = Object.values(runtimes).find((item) => item.tabId === senderTab.id);
      if (!runtime) throw new FavoritesError("unmanaged-tab", "该页面不是受管理的 Favorite");
      const favorite = this.requireFavorite(await this.store.loadFavorites(), runtime.favoriteId);
      // The guard follows the page that is actually displayed, so links within
      // that page's own site keep navigating in place even after the Favorite
      // tab has been redirected somewhere else.
      const senderSiteKey = isSupportedPage(senderTab.url)
        ? siteKeyForUrl(senderTab.url)
        : favorite.siteKey;
      // Same-site links only leave the Favorite in app-home mode.
      if (siteKeyForUrl(url) === senderSiteKey && !(sameSite && favorite.sameSiteInNewTab)) return "navigate";
      await this.browser.openOrdinaryTab(url, senderTab);
      return "opened";
    });
  }

  /**
   * Handles a left click on a link that points at another Favorite. The entry's
   * own tab is reused: a running instance is focused, a sleeping one is woken
   * at the clicked URL. The sender tab is left untouched.
   */
  async routeLink(
    url: string,
    senderTab: BrowserTab | undefined,
  ): Promise<"navigate" | "handled"> {
    return this.serialize(async () => {
      if (!senderTab || !isSupportedPage(url)) {
        throw new FavoritesError("invalid-external-link", "无法打开这个外部链接");
      }
      const favorites = sortFavorites(await this.store.loadFavorites());
      const runtimes = await this.store.loadRuntimes();
      const runtime = Object.values(runtimes).find((item) => item.tabId === senderTab.id);
      if (!runtime) throw new FavoritesError("unmanaged-tab", "该页面不是受管理的 Favorite");
      const senderFavorite = this.requireFavorite(favorites, runtime.favoriteId);
      const destinationIdentity = favoriteIdentityForUrl(url);
      if (destinationIdentity === favoriteIdentityForUrl(senderFavorite.homeUrl)) {
        // Back into the sender's own app: the guard can navigate in place.
        return "navigate";
      }

      const target = favorites.find(
        (favorite) => favoriteIdentityForUrl(favorite.homeUrl) === destinationIdentity,
      );
      if (!target) return "navigate";

      const favoriteHosts = this.favoriteHosts(favorites);
      const targetRuntime = runtimes[target.id];
      let live = targetRuntime ? await this.browser.getTab(targetRuntime.tabId) : undefined;
      if (live && !live.pinned) live = undefined;
      live ??= await this.findAdoptablePinnedTab(target);

      if (live) {
        live = await this.repairUnsupportedTab(live, target);
        if (live.discarded) live = (await this.browser.updateTab(live.id, { url })) ?? live;
        const focused = await this.focusFavoriteTab(live, senderTab.windowId);
        runtimes[target.id] = this.runtimeFromTab(target.id, focused);
        const index = favorites.findIndex((favorite) => favorite.id === target.id);
        favorites[index] = { ...target, lastTabId: focused.id };
        await Promise.all([this.store.saveFavorites(favorites), this.store.saveRuntimes(runtimes)]);
        await this.maybeInstallGuard(target, focused.id, focused.url, favoriteHosts);
        return "handled";
      }

      const tab = await this.browser.createPinnedTab(url, true, false, senderTab.windowId);
      runtimes[target.id] = this.runtimeFromTab(target.id, tab);
      const index = favorites.findIndex((favorite) => favorite.id === target.id);
      favorites[index] = {
        ...target,
        lastTabId: tab.id,
        lastKnownUrl: tab.url,
        lastKnownTitle: tab.title,
        lastKnownIconUrl: tab.favIconUrl ?? target.lastKnownIconUrl,
      };
      await Promise.all([
        this.store.saveFavorites(favorites),
        this.store.saveRuntimes(runtimes),
      ]);
      await this.syncPinnedOrder(favorites, runtimes);
      await this.maybeInstallGuard(favorites[index]!, tab.id, tab.url, favoriteHosts);
      return "handled";
    });
  }

  private pickReconciliationCandidate(
    favorite: Favorite,
    tabs: BrowserTab[],
    usedTabIds: Set<number>,
  ): BrowserTab | undefined {
    const available = tabs.filter((tab) => !usedTabIds.has(tab.id));
    const exact = (expected?: string) =>
      expected
        ? available.find((tab) => this.comparableUrl(tab.url) === this.comparableUrl(expected))
        : undefined;
    const identity = favoriteIdentityForUrl(favorite.homeUrl);
    return (
      exact(favorite.lastKnownUrl) ??
      exact(favorite.homeUrl) ??
      available.find(
        (tab) => isSupportedPage(tab.url) && favoriteIdentityForUrl(tab.url) === identity,
      )
    );
  }

  private comparableUrl(value: string): string {
    try {
      const url = new URL(value);
      url.hash = "";
      return url.toString();
    } catch {
      return value;
    }
  }

  /** A pinned tab sitting on about:blank with nothing about to load. */
  private isIdleBlank(tab: BrowserTab): boolean {
    return tab.pinned && !tab.active && !tab.pending && !isSupportedPage(tab.url);
  }

  private async resolveAppName(tab: BrowserTab): Promise<string> {
    const declared = tab.discarded || tab.pending ? undefined : await this.browser.readAppName?.(tab.id);
    return declared ?? appNameFromTitle(tab.title, tab.url);
  }

  /**
   * A Favorite tab can end up on about:blank (a load cancelled by an early
   * discard, a crashed restore, a manual navigation). Point it back at the last
   * known page so the entry never stays blank.
   */
  private async repairUnsupportedTab(
    tab: BrowserTab,
    favorite: Favorite,
  ): Promise<BrowserTab> {
    if (isSupportedPage(tab.url)) return tab;
    const repairUrl = isSupportedPage(favorite.lastKnownUrl)
      ? favorite.lastKnownUrl
      : favorite.homeUrl;
    this.log("repair-blank", { favoriteId: favorite.id, tabId: tab.id });
    return (await this.browser.updateTab(tab.id, { url: repairUrl })) ?? tab;
  }

  private runtimeFromTab(favoriteId: string, tab: BrowserTab): FavoriteRuntime {
    return {
      favoriteId,
      tabId: tab.id,
      windowId: tab.windowId,
      currentUrl: tab.url,
      currentTitle: tab.title,
      currentIconUrl: tab.favIconUrl,
      discarded: Boolean(tab.discarded),
      loading: !tab.discarded && tab.status === "loading",
      audible: Boolean(tab.audible),
      updatedAt: this.now(),
    };
  }

  private requireFavorite(favorites: Favorite[], favoriteId: string): Favorite {
    const favorite = favorites.find((item) => item.id === favoriteId);
    if (!favorite) throw new FavoritesError("not-found", "找不到这个 Favorite");
    return favorite;
  }

  /**
   * Focuses a Favorite instance. When it lives in another window the jump is
   * easy to miss, so a short badge + in-page hint marks the landing spot.
   */
  private async focusFavoriteTab(
    tab: BrowserTab,
    originWindowId: number | undefined,
  ): Promise<BrowserTab> {
    const focused = await this.browser.focusTab(tab);
    if (originWindowId !== undefined && originWindowId !== focused.windowId) {
      await this.browser.showSwitchHint(focused.id);
    }
    return focused;
  }

  /** An extra pinned tab of the same app can stand in for a missing instance. */
  private async findAdoptablePinnedTab(
    favorite: Favorite,
    excludeTabId?: number,
  ): Promise<BrowserTab | undefined> {
    const identity = favoriteIdentityForUrl(favorite.homeUrl);
    const pinned = await this.browser.getPinnedTabs();
    const runtimes = await this.store.loadRuntimes();
    const ownedByOthers = new Set(Object.values(runtimes)
      .filter((runtime) => runtime.favoriteId !== favorite.id).map((runtime) => runtime.tabId));
    return pinned.find(
      (tab) =>
        tab.id !== excludeTabId &&
        !ownedByOthers.has(tab.id) &&
        isSupportedPage(tab.url) &&
        favoriteIdentityForUrl(tab.url) === identity,
    );
  }

  private async syncPinnedOrder(favorites: Favorite[], runtimes: Record<string, FavoriteRuntime>): Promise<void> {
    await this.browser.reorderPinnedTabs(sortFavorites(favorites).flatMap((favorite) => {
      const runtime = runtimes[favorite.id];
      return runtime ? [runtime.tabId] : [];
    }));
  }

  private favoriteHosts(favorites: Favorite[]): string[] {
    return favorites.map((favorite) => favoriteIdentityForUrl(favorite.homeUrl));
  }

  private async refreshGuards(
    favorites: Favorite[],
    runtimes: Record<string, FavoriteRuntime>,
  ): Promise<void> {
    const favoriteHosts = this.favoriteHosts(favorites);
    for (const favorite of favorites) {
      const runtime = runtimes[favorite.id];
      if (!runtime) continue;
      const tab = await this.browser.getTab(runtime.tabId);
      if (!tab || tab.discarded) continue;
      await this.maybeInstallGuard(favorite, tab.id, tab.url, favoriteHosts);
    }
  }

  private async maybeInstallGuard(
    favorite: Favorite,
    tabId: number,
    currentUrl: string | undefined,
    favoriteHosts: string[],
  ): Promise<void> {
    if (!favorite.guardEnabled) return;
    const current = await this.browser.getTab(tabId);
    if (current?.discarded) return;
    // Anchor the guard to the page that is actually open. A Favorite tab can be
    // redirected (OAuth, typed URL, script navigation) to another site, and
    // from then on links within that site should stay in the same tab.
    const siteKey = isSupportedPage(currentUrl) ? siteKeyForUrl(currentUrl) : favorite.siteKey;
    if (await this.browser.hasSiteAccess(siteKey)) {
      await this.browser.installLinkGuard(tabId, siteKey, favoriteHosts, Boolean(favorite.sameSiteInNewTab));
    } else {
      this.log("guard-no-site-access", { favoriteId: favorite.id, siteKey });
    }
  }
}
