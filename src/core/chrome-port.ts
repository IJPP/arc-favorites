import { cleanDeclaredName } from "./names";
import type { BrowserPort, BrowserTab, Logger } from "./types";
import { isSupportedPage, permissionPatternsForSite } from "./url";

const COMMIT_POLL_MS = 150;
const COMMIT_TIMEOUT_MS = 6_000;

export function fromChromeTab(
  tab: chrome.tabs.Tab,
  fallbackUrl?: string,
): BrowserTab | undefined {
  const rawUrl = tab.pendingUrl ?? tab.url;
  // `about:blank` means "no page yet". Chrome can leave a tab there when it is
  // discarded before its navigation commits, so it must never outrank the URL
  // we already know, while still staying visible so the controller can repair it.
  const committedUrl = tab.url && tab.url !== "about:blank" ? tab.url : undefined;
  const usableUrl = rawUrl && rawUrl !== "about:blank" ? rawUrl : undefined;
  const effectiveUrl = usableUrl ?? fallbackUrl ?? rawUrl;
  if (tab.id === undefined || tab.windowId === undefined || !effectiveUrl) return undefined;
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    url: effectiveUrl,
    title: tab.title || new URL(effectiveUrl).hostname,
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned,
    active: tab.active,
    // Only a navigation that has not committed yet counts as pending. A tab
    // that is navigating away from a loaded page still owns that page, so it
    // must not be treated as a lazy restore placeholder.
    pending: Boolean((!committedUrl && tab.pendingUrl) || (!usableUrl && Boolean(fallbackUrl))),
    discarded: tab.discarded,
    audible: tab.audible,
    status: tab.status,
  };
}

export function isBrokenPinnedPlaceholder(tab: chrome.tabs.Tab): boolean {
  const title = tab.title?.trim();
  const isUntitled = !title || title === "无标题" || title === "Untitled";
  const hasNoTarget = !tab.url && !tab.pendingUrl;
  // A tab Chrome left sitting on about:blank after a cancelled restore.
  const isIdleBlank = tab.url === "about:blank" && !tab.pendingUrl;
  return Boolean(
    tab.id !== undefined &&
      tab.pinned &&
      !tab.active &&
      (hasNoTarget || isIdleBlank) &&
      isUntitled &&
      (tab.status === "loading" || isIdleBlank),
  );
}

export function confirmedBrokenPinnedPlaceholderIds(
  firstScan: chrome.tabs.Tab[],
  secondScan: chrome.tabs.Tab[],
): number[] {
  const firstIds = new Set(
    firstScan.flatMap((tab) =>
      isBrokenPinnedPlaceholder(tab) && tab.id !== undefined ? [tab.id] : [],
    ),
  );
  return secondScan.flatMap((tab) =>
    isBrokenPinnedPlaceholder(tab) && tab.id !== undefined && firstIds.has(tab.id)
      ? [tab.id]
      : [],
  );
}

export function installGuardInPage(siteKey: string, favoriteHosts: string[], sameSiteInNewTab = false): void {
  // Bump the marker whenever the listener logic changes: an extension update
  // keeps the page's isolated world, so an older guard would otherwise keep
  // running and the new one would never be installed.
  const marker = "__arcFavoritesLinkGuard_v2";
  const pageWindow = window as typeof window & {
    [key: string]:
      | { siteKey: string; favoriteHosts: string[]; enabled: boolean; sameSiteInNewTab?: boolean }
      | undefined;
  };
  const legacy = pageWindow["__arcFavoritesLinkGuard_v1"];
  if (legacy) legacy.enabled = false;
  const existing = pageWindow[marker];
  if (existing) {
    existing.siteKey = siteKey;
    existing.favoriteHosts = favoriteHosts;
    existing.sameSiteInNewTab = sameSiteInNewTab;
    existing.enabled = true;
    return;
  }

  const state = { siteKey, favoriteHosts, enabled: true, sameSiteInNewTab };
  const withoutHash = (url: URL | Location): string => url.href.replace(/#.*$/, "");
  pageWindow[marker] = state;

  const identityOf = (url: URL): string =>
    `${url.hostname.replace(/^www\./i, "")}${url.port ? `:${url.port}` : ""}`;
  const pageIdentity = identityOf(new URL(location.href));

  // Window capture runs before any listener a page registers on document, so
  // single-page apps cannot turn the click into an in-place navigation first.
  window.addEventListener(
    "click",
    (event) => {
      if (
        !state.enabled ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      const path = event.composedPath();
      // YouTube's hover preview plays in an overlay outside the thumbnail link;
      // the link it stands for lives inside that overlay.
      const preview = path.find((node): node is Element =>
        node instanceof Element && node.matches("ytd-video-preview, #video-preview"));
      const anchor =
        path.find((node): node is HTMLAnchorElement =>
          node instanceof HTMLAnchorElement && node.hasAttribute("href"),
        ) ?? target.closest<HTMLAnchorElement>("a[href]")
        ?? preview?.querySelector<HTMLAnchorElement>('a[href*="/watch"], a[href*="/shorts/"]') ?? null;
      if (!anchor || anchor.hasAttribute("download")) return;

      let destination: URL;
      try {
        destination = new URL(anchor.href, location.href);
      } catch {
        return;
      }

      if (destination.protocol !== "http:" && destination.protocol !== "https:") return;
      const opensNewTab = anchor.target.toLowerCase() === "_blank";
      const hostname = destination.hostname;
      const destinationIdentity = identityOf(destination);

      // A link into another Favorite is handed to the background so that the
      // entry's own tab is reused instead of swallowing this tab.
      if (
        destinationIdentity !== pageIdentity &&
        state.favoriteHosts.includes(destinationIdentity)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        let settled = false;
        const navigateInPlace = () => {
          if (settled) return;
          settled = true;
          location.assign(destination.toString());
        };
        try {
          const response = chrome.runtime.sendMessage({
            type: "route-link",
            url: destination.toString(),
          }) as
            | Promise<{ ok?: boolean; data?: "navigate" | "handled" } | undefined>
            | undefined;
          void Promise.resolve(response)
            .then((result: { ok?: boolean; data?: "navigate" | "handled" } | undefined) => {
              if (result?.data !== "handled") navigateInPlace();
            })
            .catch(navigateInPlace);
        } catch {
          // The extension context can be invalidated while the page stays open.
          navigateInPlace();
        }
        return;
      }

      const isSameSite = hostname === state.siteKey || hostname.endsWith(`.${state.siteKey}`);
      // App-home mode: content opens in its own tab and the Favorite stays put.
      // The capture-phase listener runs before single-page apps such as
      // YouTube can turn the click into an in-place navigation.
      if (isSameSite && state.sameSiteInNewTab && withoutHash(destination) !== withoutHash(location)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        let settled = false;
        const navigateInPlace = () => {
          if (settled) return;
          settled = true;
          location.assign(destination.toString());
        };
        try {
          const response = chrome.runtime.sendMessage({
            type: "open-external",
            url: destination.toString(),
            sameSite: true,
          }) as Promise<{ ok?: boolean; data?: string } | undefined> | undefined;
          void Promise.resolve(response)
            .then((result: { ok?: boolean; data?: string } | undefined) => {
              if (result?.data !== "opened") navigateInPlace();
            })
            .catch(navigateInPlace);
        } catch {
          navigateInPlace();
        }
        return;
      }
      // Within the site, the site decides: a plain link stays here and a
      // target=_blank link (bilibili videos) keeps opening its own tab.
      if (isSameSite) return;

      // A cross-site _blank link is already an ordinary Chrome tab, which is
      // exactly the desired result and does not need extension handling.
      if (opensNewTab) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      let settled = false;
      const fallbackToOriginalNavigation = () => {
        if (settled) return;
        settled = true;
        location.assign(destination.toString());
      };
      try {
        const response = chrome.runtime.sendMessage({
          type: "open-external",
          url: destination.toString(),
        }) as Promise<{ ok?: boolean; data?: string } | undefined> | undefined;
        void Promise.resolve(response)
          .then((result: { ok?: boolean; data?: string } | undefined) => {
            if (result?.data !== "opened") fallbackToOriginalNavigation();
          })
          .catch(fallbackToOriginalNavigation);
      } catch {
        // The extension context can be invalidated while the page stays open.
        fallbackToOriginalNavigation();
      }
    },
    true,
  );
}

export function showSwitchHintInPage(): void {
  const marker = "__arcFavoritesSwitchHint";
  document.getElementById(marker)?.remove();

  const container = document.createElement("div");
  container.id = marker;
  container.setAttribute("aria-hidden", "true");
  container.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 2147483647",
    "pointer-events: none",
    "display: flex",
    "align-items: flex-end",
    "justify-content: center",
    "padding-bottom: 22px",
    "opacity: 0",
    "transition: opacity 140ms ease",
    "box-shadow: inset 0 0 0 2px rgba(138, 180, 248, 0.55)",
  ].join(";");

  const pill = document.createElement("div");
  pill.textContent = "已切换到已有 Favorite";
  pill.style.cssText = [
    "display: flex",
    "align-items: center",
    "gap: 6px",
    "padding: 6px 11px",
    "border-radius: 999px",
    "background: rgba(32, 33, 36, 0.92)",
    "color: #ffffff",
    "font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif",
    "box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25)",
  ].join(";");

  const dot = document.createElement("span");
  dot.style.cssText =
    "width: 6px; height: 6px; border-radius: 50%; background: #8ab4f8;";
  pill.prepend(dot);
  container.append(pill);
  document.documentElement.append(container);

  requestAnimationFrame(() => {
    container.style.opacity = "1";
  });
  setTimeout(() => {
    container.style.opacity = "0";
  }, 1_400);
  setTimeout(() => container.remove(), 1_700);
}

function disableLinkGuardInPage(): void {
  const pageWindow = window as typeof window & {
    [key: string]: { siteKey: string; enabled: boolean } | undefined;
  };
  for (const marker of ["__arcFavoritesLinkGuard_v1", "__arcFavoritesLinkGuard_v2"]) {
    const existing = pageWindow[marker];
    if (existing) existing.enabled = false;
  }
}

export function readAppNameInPage(): string | undefined {
  const selectors = [
    'meta[name="application-name"]',
    'meta[name="apple-mobile-web-app-title"]',
    'meta[property="og:site_name"]',
  ];
  for (const selector of selectors) {
    const content = document.querySelector<HTMLMetaElement>(selector)?.content?.trim();
    if (content) return content;
  }
  return undefined;
}

export class ChromeBrowserPort implements BrowserPort {
  private badgeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly loggedGuards = new Set<string>();

  constructor(private readonly log: Logger = () => undefined) {}

  async getActiveTab(): Promise<BrowserTab | undefined> {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
      windowType: "normal",
    });
    return tab ? fromChromeTab(tab) : undefined;
  }

  async getTab(tabId: number): Promise<BrowserTab | undefined> {
    try {
      return fromChromeTab(await chrome.tabs.get(tabId));
    } catch {
      return undefined;
    }
  }

  async getPinnedTabs(): Promise<BrowserTab[]> {
    const tabs = await chrome.tabs.query({ pinned: true, windowType: "normal" });
    return tabs.flatMap((tab) => {
      const converted = fromChromeTab(tab);
      return converted ? [converted] : [];
    });
  }

  async getActiveTabs(): Promise<BrowserTab[]> {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: "normal" });
    return tabs.flatMap((tab) => {
      const converted = fromChromeTab(tab);
      return converted ? [converted] : [];
    });
  }

  async createPinnedTab(url: string, active = true, discardAfterCreate = false, windowId?: number): Promise<BrowserTab> {
    if (windowId === undefined) try {
      const lastFocused = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      windowId = lastFocused.id;
    } catch {
      windowId = undefined;
    }

    const created = await chrome.tabs.create({
      url,
      active,
      pinned: true,
      ...(windowId !== undefined ? { windowId } : {}),
    });
    const finalTab = fromChromeTab(created, url);
    if (discardAfterCreate && created.id !== undefined) {
      // Discarding before the first navigation commits freezes the tab on
      // about:blank, which is how blank pinned tabs used to pile up after a
      // restart. Sleep only once the page committed, off the caller's path;
      // the resulting onUpdated(discarded) event refreshes the runtime.
      void this.discardOnceCommitted(created.id, url);
    }
    if (!finalTab) throw new Error("Chrome 没有返回新建标签的信息");
    return finalTab;
  }

  private async discardOnceCommitted(tabId: number, url: string): Promise<void> {
    const committed = await this.waitForCommit(tabId);
    const discarded = committed && !committed.active ? await this.discardTab(tabId) : undefined;
    this.log("create-pinned", { tabId, url, committed: Boolean(committed), discarded: Boolean(discarded?.discarded) });
  }

  /** Resolves once the tab shows a real web page, or undefined on timeout/close. */
  private async waitForCommit(tabId: number): Promise<chrome.tabs.Tab | undefined> {
    const deadline = Date.now() + COMMIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      let tab: chrome.tabs.Tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        return undefined;
      }
      if (isSupportedPage(tab.url)) return tab;
      await new Promise((resolve) => setTimeout(resolve, COMMIT_POLL_MS));
    }
    return undefined;
  }

  async reorderPinnedTabs(orderedTabIds: number[]): Promise<void> {
    const tabs = await this.getPinnedTabs();
    const rank = new Map(orderedTabIds.map((id, index) => [id, index]));
    for (const windowId of new Set(tabs.map((tab) => tab.windowId))) {
      const current = tabs.filter((tab) => tab.windowId === windowId).sort((a, b) => a.index - b.index);
      const managed = current.filter((tab) => rank.has(tab.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
      let position = 0;
      // Keep ordinary pinned tabs in their existing slots.
      const desired = current.map((tab) => rank.has(tab.id) ? managed[position++]! : tab);
      for (let index = 0; index < desired.length; index++) {
        const from = current.findIndex((tab) => tab.id === desired[index]!.id);
        if (from === index) continue;
        await chrome.tabs.move(desired[index]!.id, { index });
        current.splice(index, 0, current.splice(from, 1)[0]!);
      }
    }
  }

  async removeBrokenPinnedPlaceholders(ownedTabIds: number[] = []): Promise<number> {
    if (ownedTabIds.length === 0) return 0;
    const firstScan = await chrome.tabs.query({ pinned: true, windowType: "normal" });
    if (!firstScan.some(isBrokenPinnedPlaceholder)) return 0;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const secondScan = await chrome.tabs.query({ pinned: true, windowType: "normal" });
    const brokenIds = confirmedBrokenPinnedPlaceholderIds(firstScan, secondScan)
      .filter((id) => ownedTabIds.includes(id));
    if (brokenIds.length > 0) await chrome.tabs.remove(brokenIds);
    return brokenIds.length;
  }

  async focusTab(tab: BrowserTab): Promise<BrowserTab> {
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch {
      // The window may already be gone; activating the tab below still works
      // whenever it is really there.
    }
    const updated = await chrome.tabs.update(tab.id, { active: true, pinned: true });
    return (updated ? fromChromeTab(updated) : undefined) ?? {
      ...tab,
      active: true,
      pinned: true,
    };
  }

  async updateTab(
    tabId: number,
    changes: { pinned?: boolean; url?: string },
  ): Promise<BrowserTab | undefined> {
    try {
      const updated = await chrome.tabs.update(tabId, changes);
      return updated ? fromChromeTab(updated) : undefined;
    } catch {
      return undefined;
    }
  }

  async discardTab(tabId: number): Promise<BrowserTab | undefined> {
    let before: BrowserTab | undefined;
    try {
      before = fromChromeTab(await chrome.tabs.get(tabId));
    } catch {
      return undefined;
    }
    if (!before) return undefined;

    try {
      const discarded = await chrome.tabs.discard(tabId);
      if (!discarded) return undefined;
      return (await this.settleDiscardedTab(tabId, before.url)) ?? fromChromeTab(discarded);
    } catch {
      return undefined;
    }
  }

  /**
   * Chrome can discard a tab whose navigation has not committed yet, which
   * freezes it on about:blank. Detecting that here lets us navigate the known
   * URL back instead of leaving a blank Favorite behind.
   */
  private async settleDiscardedTab(
    tabId: number,
    expectedUrl: string,
  ): Promise<BrowserTab | undefined> {
    let current: chrome.tabs.Tab | undefined;
    try {
      current = await chrome.tabs.get(tabId);
    } catch {
      return undefined;
    }
    if (current.url && current.url !== "about:blank") {
      return fromChromeTab(current, expectedUrl);
    }
    this.log("discard-left-blank", { tabId, url: expectedUrl });
    return this.updateTab(tabId, { url: expectedUrl });
  }

  async removeTab(tabId: number): Promise<void> {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // The tab may already have been closed by Chrome.
    }
  }

  async openOrdinaryTab(url: string, opener?: BrowserTab): Promise<BrowserTab> {
    const created = await chrome.tabs.create({
      url,
      active: true,
      ...(opener
        ? {
            windowId: opener.windowId,
            index: opener.index + 1,
            openerTabId: opener.id,
          }
        : {}),
    });
    const tab = created ? fromChromeTab(created, url) : undefined;
    if (!tab) throw new Error("Chrome 没有返回新建标签的信息");
    return tab;
  }

  async installLinkGuard(
    tabId: number,
    siteKey: string,
    favoriteHosts: string[],
    sameSiteInNewTab = false,
  ): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: installGuardInPage,
        args: [siteKey, favoriteHosts, sameSiteInNewTab],
      });
      const key = `${tabId}:${siteKey}:${sameSiteInNewTab}`;
      if (!this.loggedGuards.has(key)) {
        this.loggedGuards.add(key);
        this.log("guard-installed", { tabId, siteKey, sameSiteInNewTab });
      }
    } catch (error) {
      // Restricted pages and pages that are still navigating cannot be injected.
      this.log("guard-failed", { tabId, siteKey, error: String(error) });
    }
  }

  async showSwitchHint(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: showSwitchHintInPage,
      });
    } catch {
      // Restricted pages and pages that are still navigating cannot be injected.
    }

    try {
      await chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
      await chrome.action.setBadgeText({ text: "↗" });
      if (this.badgeTimer !== undefined) clearTimeout(this.badgeTimer);
      this.badgeTimer = setTimeout(() => {
        this.badgeTimer = undefined;
        void Promise.resolve(chrome.action.setBadgeText({ text: "" })).catch(
          () => undefined,
        );
      }, 2_500);
    } catch {
      // The action API is unavailable in some contexts; the page hint still ran.
    }
  }

  async disableLinkGuard(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: disableLinkGuardInPage,
      });
    } catch {
      // The tab may be navigating or already closed.
    }
  }

  async readAppName(tabId: number): Promise<string | undefined> {
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: readAppNameInPage });
      return cleanDeclaredName(result?.result);
    } catch {
      return undefined;
    }
  }

  async hasSiteAccess(siteKey: string): Promise<boolean> {
    return chrome.permissions.contains({
      origins: permissionPatternsForSite(siteKey),
    });
  }
}
