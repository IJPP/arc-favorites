import { reorderFavorites, updateFavorite } from "../core/domain";
import { appendLog } from "../core/log";
import { FavoritesError } from "../core/errors";
import type {
  AddFavoriteResult,
  AppSnapshot,
  ClientMessage,
  CurrentTabContext,
  Diagnostics,
  FavoriteView,
  MessageResponse,
  UpdateFavoriteInput,
} from "../core/types";
import { opensSameSiteInNewTabByDefault, permissionPatternsForSite, siteKeyForUrl } from "../core/url";

const hasExtensionRuntime = Boolean(globalThis.chrome?.runtime?.id);

// ——— Preview data (npm run dev, no extension runtime) ———————————————————————

type MockState = "closed" | "sleeping" | "running" | "audible" | "loading";

function mockFavorite(id: string, homeUrl: string, appName: string, state: MockState, active = false): FavoriteView {
  const order = mockSnapshot?.favorites.length ?? 0;
  return {
    id,
    homeUrl,
    title: appName,
    appName,
    order,
    createdAt: order,
    lastKnownUrl: homeUrl,
    siteKey: siteKeyForUrl(homeUrl),
    guardEnabled: true,
    sameSiteInNewTab: opensSameSiteInNewTabByDefault(homeUrl) || undefined,
    active,
    runtime: state === "closed" ? undefined : {
      favoriteId: id,
      tabId: order + 1,
      windowId: 1,
      currentUrl: homeUrl,
      currentTitle: appName,
      discarded: state === "sleeping",
      loading: state === "loading",
      audible: state === "audible",
      updatedAt: 0,
    },
  };
}

const previewCount = Number(new URLSearchParams(globalThis.location?.search).get("n") ?? 6);
let mockSnapshot: AppSnapshot = { maxFavorites: 12, favorites: [] };
const mockSeed: Array<[string, string, string, MockState]> = [
  ["bili", "https://www.bilibili.com/", "哔哩哔哩", "running"],
  ["yt", "https://www.youtube.com/", "YouTube", "audible"],
  ["gmail", "https://mail.google.com/mail/u/0/#inbox", "Gmail", "sleeping"],
  ["notion", "https://www.notion.so/", "Notion", "running"],
  ["gpt", "https://chatgpt.com/", "ChatGPT", "closed"],
  ["gh", "https://github.com/notifications", "GitHub", "loading"],
  ["figma", "https://www.figma.com/files/recent", "Figma", "running"],
  ["x", "https://x.com/home", "X", "sleeping"],
  ["spotify", "https://open.spotify.com/", "Spotify", "closed"],
  ["linear", "https://linear.app/inbox", "Linear", "running"],
  ["cal", "https://calendar.google.com/", "Calendar", "sleeping"],
  ["zhihu", "https://www.zhihu.com/", "知乎", "closed"],
];
for (const [id, url, name, state] of mockSeed.slice(0, Math.max(0, Math.min(12, previewCount)))) {
  mockSnapshot.favorites.push(mockFavorite(id, url, name, state, id === "bili"));
}

export const previewBrands: Record<string, string> = {
  "bilibili.com": "#00a1d6", "youtube.com": "#ff0033", "google.com": "#ea4335", "notion.so": "#787774",
  "chatgpt.com": "#10a37f", "github.com": "#8250df", "figma.com": "#a259ff", "x.com": "#536471",
  "spotify.com": "#1db954", "linear.app": "#5e6ad2", "zhihu.com": "#1772f6", "sspai.com": "#d71a1b",
};

function mockContext(): CurrentTabContext {
  const kind = new URLSearchParams(globalThis.location?.search).get("ctx") ?? "addable";
  const active = mockSnapshot.favorites.find((favorite) => favorite.active);
  if ((kind === "favorite" || kind === "deep") && active) {
    return {
      kind: "favorite",
      favoriteId: active.id,
      atHome: kind === "favorite",
      url: kind === "deep" ? "https://www.bilibili.com/video/BV1GJ411x7h7" : active.homeUrl,
      title: active.appName,
    };
  }
  if (kind === "unsupported") return { kind: "unsupported", url: "chrome://settings/", title: "设置" };
  return {
    kind: mockSnapshot.favorites.length >= 12 ? "full" : "addable",
    url: "https://sspai.com/",
    title: "少数派 - 高效工作，品质生活",
  };
}

function patchMock(id: string, change: (favorite: FavoriteView) => FavoriteView): void {
  mockSnapshot = { ...mockSnapshot, favorites: mockSnapshot.favorites.map((favorite) => favorite.id === id ? change(favorite) : favorite) };
}

function handleMockMessage(message: ClientMessage): unknown {
  switch (message.type) {
    case "activate":
      mockSnapshot = {
        ...mockSnapshot,
        favorites: mockSnapshot.favorites.map((favorite) => {
          const active = favorite.id === message.favoriteId;
          if (!active) return { ...favorite, active: false };
          const runtime = favorite.runtime ?? { favoriteId: favorite.id, tabId: 99, windowId: 1, currentUrl: favorite.homeUrl, currentTitle: favorite.title, updatedAt: 0 };
          return { ...favorite, active: true, runtime: { ...runtime, discarded: false, loading: false } };
        }),
      };
      break;
    case "sleep-runtime": {
      const favorite = mockSnapshot.favorites.find((item) => item.id === message.favoriteId);
      if (favorite?.active || favorite?.runtime?.audible) throw new FavoritesError("tab-in-use", "请先切换到其他标签并暂停播放，再让它休眠");
      patchMock(message.favoriteId, (item) => item.runtime ? { ...item, runtime: { ...item.runtime, discarded: true } } : item);
      break;
    }
    case "close-runtime":
      patchMock(message.favoriteId, (item) => ({ ...item, runtime: undefined, active: false }));
      break;
    case "reset-home":
      patchMock(message.favoriteId, (item) => item.runtime ? { ...item, runtime: { ...item.runtime, currentUrl: item.homeUrl } } : item);
      break;
    case "use-current-as-home":
      patchMock(message.favoriteId, (item) => item.runtime ? { ...item, homeUrl: item.runtime.currentUrl } : item);
      break;
    case "remove-favorite":
      mockSnapshot = { ...mockSnapshot, favorites: mockSnapshot.favorites.filter((item) => item.id !== message.favoriteId).map((item, order) => ({ ...item, order })) };
      break;
    case "reorder": {
      const byId = new Map(mockSnapshot.favorites.map((favorite) => [favorite.id, favorite]));
      mockSnapshot = { ...mockSnapshot, favorites: reorderFavorites(mockSnapshot.favorites, message.orderedIds).map((item) => ({ ...byId.get(item.id)!, order: item.order })) };
      break;
    }
    case "update-favorite":
      patchMock(message.favoriteId, (item) => ({ ...item, ...updateFavorite(item, message.changes) }));
      break;
    case "get-context": return mockContext();
    case "count-stray-blanks": return Number(new URLSearchParams(globalThis.location?.search).get("blanks") ?? 0);
    case "close-stray-blanks": return 0;
    case "get-diagnostics": return { version: "preview", generatedAt: new Date().toISOString(), favorites: [], runtimes: {}, pinnedTabs: [], log: [] } satisfies Diagnostics;
    case "add-current": {
      const favorite = mockFavorite(`sspai-${Date.now()}`, "https://sspai.com/", "少数派", "running");
      mockSnapshot = { ...mockSnapshot, favorites: [...mockSnapshot.favorites, { ...favorite, order: mockSnapshot.favorites.length }] };
      return { snapshot: structuredClone(mockSnapshot), outcome: "added", guardEnabled: true } satisfies AddFavoriteResult;
    }
    default: break;
  }
  return structuredClone(mockSnapshot);
}

// ——— Messaging ———————————————————————————————————————————————————————————————

async function send<T = AppSnapshot>(message: ClientMessage): Promise<T> {
  if (!hasExtensionRuntime) {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return handleMockMessage(message) as T;
  }
  const response = (await chrome.runtime.sendMessage(message)) as MessageResponse<T>;
  if (!response?.ok) {
    throw new FavoritesError(
      response?.error?.code ?? "no-response",
      response?.error?.message ?? "后台没有响应，请重新加载扩展",
    );
  }
  return response.data;
}

export const favoriteApi = {
  isPreview: !hasExtensionRuntime,
  getState: () => send({ type: "get-state" }),
  getContext: () => send<CurrentTabContext>({ type: "get-context" }),
  activate: (favoriteId: string) => send({ type: "activate", favoriteId }),
  sleepRuntime: (favoriteId: string) => send({ type: "sleep-runtime", favoriteId }),
  closeRuntime: (favoriteId: string) => send({ type: "close-runtime", favoriteId }),
  resetHome: (favoriteId: string) => send({ type: "reset-home", favoriteId }),
  useCurrentAsHome: (favoriteId: string) => send({ type: "use-current-as-home", favoriteId }),
  remove: (favoriteId: string) => send({ type: "remove-favorite", favoriteId }),
  update: (favoriteId: string, changes: UpdateFavoriteInput) => send({ type: "update-favorite", favoriteId, changes }),
  reorder: (orderedIds: string[]) => send({ type: "reorder", orderedIds }),
  addCurrent: () => send<AddFavoriteResult>({ type: "add-current", guardEnabled: true }),
  countStrayBlanks: () => send<number>({ type: "count-stray-blanks" }),
  closeStrayBlanks: () => send<number>({ type: "close-stray-blanks" }),
  diagnostics: () => send<Diagnostics>({ type: "get-diagnostics" }),

  async hasSiteAccess(siteKey: string): Promise<boolean> {
    if (!hasExtensionRuntime) return true;
    return chrome.permissions.contains({ origins: permissionPatternsForSite(siteKey) });
  },

  /** Sites (registrable domains) that Chrome currently withholds from the extension. */
  async missingSiteAccess(siteKeys: string[]): Promise<string[]> {
    if (!hasExtensionRuntime) {
      const forced = new URLSearchParams(globalThis.location?.search).get("noaccess");
      return forced ? siteKeys.filter((key) => forced.split(",").includes(key)) : [];
    }
    const results = await Promise.all(siteKeys.map((key) => favoriteApi.hasSiteAccess(key)));
    return siteKeys.filter((_, index) => !results[index]);
  },

  /**
   * Asks Chrome for access to these sites. Must be the first await inside a
   * click handler: Chrome only shows the prompt during a user gesture. Already
   * granted sites resolve true without a prompt.
   */
  async requestSiteAccess(siteKeys: string[]): Promise<{ granted: boolean; error?: string }> {
    if (!hasExtensionRuntime || siteKeys.length === 0) return { granted: true };
    const origins = siteKeys.flatMap(permissionPatternsForSite);
    try {
      const granted = await chrome.permissions.request({ origins });
      appendLog("site-access-request", { origins, granted });
      return { granted };
    } catch (error) {
      appendLog("site-access-request", { origins, granted: false, error: String(error) });
      return { granted: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  /** Chrome's own favicon cache: no network, same origin (so colours can be read). */
  faviconUrl(pageUrl: string): string {
    if (!hasExtensionRuntime) {
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(pageUrl).hostname)}&sz=64`;
    }
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", pageUrl);
    url.searchParams.set("size", "64");
    return url.toString();
  },

  onStateChanged(callback: () => void): () => void {
    if (!hasExtensionRuntime) return () => undefined;
    const listener = (message: { type?: string }) => {
      if (message?.type === "state-changed") callback();
      return false;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  },
};
