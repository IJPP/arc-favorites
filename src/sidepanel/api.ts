import { updateFavorite, reorderFavorites } from "../core/domain";
import { FavoritesError } from "../core/errors";
import type {
  AddFavoriteResult,
  AppSnapshot,
  ClientMessage,
  FavoriteView,
  MessageResponse,
  UpdateFavoriteInput,
} from "../core/types";
import { permissionPatternForSite, siteKeyForUrl } from "../core/url";

const hasExtensionRuntime = Boolean(globalThis.chrome?.runtime?.id);

let mockSnapshot: AppSnapshot = {
  maxFavorites: 12,
  favorites: [
    mockFavorite("mail", "https://mail.google.com/", "Gmail", "✉️", true, true, 0),
    mockFavorite("calendar", "https://calendar.google.com/", "Calendar", "◫", true, false, 1),
    mockFavorite("music", "https://music.youtube.com/", "YouTube Music", "♪", false, false, 2),
    mockFavorite("notes", "https://www.notion.so/", "Notion", "N", false, false, 3),
    mockFavorite("chat", "https://chatgpt.com/", "ChatGPT", "✦", true, false, 4),
  ],
};

function mockFavorite(
  id: string,
  homeUrl: string,
  title: string,
  customIcon: string,
  live: boolean,
  active: boolean,
  order: number,
): FavoriteView {
  return {
    id,
    homeUrl,
    title,
    customIcon,
    order,
    createdAt: Date.now() + order,
    lastKnownUrl: homeUrl,
    lastKnownTitle: title,
    siteKey: siteKeyForUrl(homeUrl),
    guardEnabled: true,
    active,
    runtime: live
      ? {
          favoriteId: id,
          tabId: order + 1,
          windowId: 1,
          currentUrl: homeUrl,
          currentTitle: title,
          updatedAt: Date.now(),
        }
      : undefined,
  };
}

async function send<T = AppSnapshot>(message: ClientMessage): Promise<T> {
  if (!hasExtensionRuntime) return handleMockMessage(message) as T;
  const response = (await chrome.runtime.sendMessage(message)) as MessageResponse<T>;
  if (!response?.ok) {
    throw new FavoritesError(
      response?.error?.code ?? "no-response",
      response?.error?.message ?? "后台没有响应，请重新加载扩展",
    );
  }
  return response.data;
}

function handleMockMessage(message: ClientMessage): AppSnapshot | null {
  if (message.type === "get-state") return structuredClone(mockSnapshot);
  if (message.type === "activate") {
    mockSnapshot = {
      ...mockSnapshot,
      favorites: mockSnapshot.favorites.map((favorite) => ({
        ...favorite,
        active: favorite.id === message.favoriteId,
        runtime:
          favorite.id === message.favoriteId
            ? (favorite.runtime ?? {
                favoriteId: favorite.id,
                tabId: Date.now(),
                windowId: 1,
                currentUrl: favorite.homeUrl,
                currentTitle: favorite.title,
                updatedAt: Date.now(),
              })
            : favorite.runtime,
      })),
    };
    const active = mockSnapshot.favorites.find((favorite) => favorite.id === message.favoriteId);
    if (active?.runtime) active.runtime.discarded = false;
  }
  if (message.type === "sleep-runtime") {
    const favorite = mockSnapshot.favorites.find((item) => item.id === message.favoriteId);
    if (favorite?.runtime) {
      if (favorite.active || favorite.runtime.audible) throw new FavoritesError("tab-in-use", "请先切换到其他标签并暂停播放，再让这个 Favorite 休眠");
      favorite.runtime.discarded = true;
    }
  }
  if (message.type === "reset-home" || message.type === "use-current-as-home") {
    const favorite = mockSnapshot.favorites.find((item) => item.id === message.favoriteId);
    if (favorite?.runtime) {
      if (message.type === "reset-home") favorite.runtime.currentUrl = favorite.homeUrl;
      else favorite.homeUrl = favorite.runtime.currentUrl;
    }
  }
  if (message.type === "close-runtime") {
    mockSnapshot = {
      ...mockSnapshot,
      favorites: mockSnapshot.favorites.map((favorite) =>
        favorite.id === message.favoriteId
          ? { ...favorite, runtime: undefined, active: false }
          : favorite,
      ),
    };
  }
  if (message.type === "remove-favorite") {
    mockSnapshot = {
      ...mockSnapshot,
      favorites: mockSnapshot.favorites
        .filter((favorite) => favorite.id !== message.favoriteId)
        .map((favorite, order) => ({ ...favorite, order })),
    };
  }
  if (message.type === "reorder") {
    const ordered = reorderFavorites(mockSnapshot.favorites, message.orderedIds);
    const byId = new Map(mockSnapshot.favorites.map((favorite) => [favorite.id, favorite]));
    mockSnapshot = {
      ...mockSnapshot,
      favorites: ordered.map((favorite) => ({ ...byId.get(favorite.id)!, order: favorite.order })),
    };
  }
  if (message.type === "update-favorite") {
    mockSnapshot = {
      ...mockSnapshot,
      favorites: mockSnapshot.favorites.map((favorite) =>
        favorite.id === message.favoriteId ? { ...favorite, ...updateFavorite(favorite, message.changes) } : favorite,
      ),
    };
  }
  return structuredClone(mockSnapshot);
}

export const favoriteApi = {
  isPreview: !hasExtensionRuntime,
  getState: () => send<AppSnapshot>({ type: "get-state" }),
  activate: (favoriteId: string) => send<AppSnapshot>({ type: "activate", favoriteId }),
  sleepRuntime: (favoriteId: string) => send<AppSnapshot>({ type: "sleep-runtime", favoriteId }),
  closeRuntime: (favoriteId: string) =>
    send<AppSnapshot>({ type: "close-runtime", favoriteId }),
  resetHome: (favoriteId: string) => send<AppSnapshot>({ type: "reset-home", favoriteId }),
  useCurrentAsHome: (favoriteId: string) =>
    send<AppSnapshot>({ type: "use-current-as-home", favoriteId }),
  remove: (favoriteId: string) =>
    send<AppSnapshot>({ type: "remove-favorite", favoriteId }),
  update: (favoriteId: string, changes: UpdateFavoriteInput) =>
    send<AppSnapshot>({ type: "update-favorite", favoriteId, changes }),
  reorder: (orderedIds: string[]) => send<AppSnapshot>({ type: "reorder", orderedIds }),

  async addCurrent(): Promise<AddFavoriteResult> {
    if (!hasExtensionRuntime) {
      throw new FavoritesError("preview-only", "预览模式不能读取当前标签");
    }
    return send<AddFavoriteResult>({ type: "add-current", guardEnabled: true });
  },

  async hasSiteAccess(siteKey: string): Promise<boolean> {
    if (!hasExtensionRuntime) return true;
    return chrome.permissions.contains({ origins: [permissionPatternForSite(siteKey)] });
  },

  faviconUrl(favorite: FavoriteView): string | undefined {
    if (!hasExtensionRuntime) return undefined;
    const pageUrl = favorite.runtime?.currentUrl ?? favorite.lastKnownUrl ?? favorite.homeUrl;
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
