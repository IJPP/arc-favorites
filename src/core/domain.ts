import { FavoritesError } from "./errors";
import { MAX_FAVORITES, type Favorite, type UpdateFavoriteInput } from "./types";
import { favoriteIdentityForUrl, normalizeWebUrl, opensSameSiteInNewTabByDefault, siteKeyForUrl } from "./url";

export function sortFavorites(favorites: Favorite[]): Favorite[] {
  return [...favorites].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function createFavorite(
  favorites: Favorite[],
  input: {
    id: string;
    url: string;
    title: string;
    iconUrl?: string;
    guardEnabled: boolean;
    now: number;
  },
): Favorite {
  const homeUrl = normalizeWebUrl(input.url);
  const identity = favoriteIdentityForUrl(homeUrl);
  if (favorites.some((favorite) => favoriteIdentityForUrl(favorite.homeUrl) === identity)) {
    throw new FavoritesError("site-already-favorite", "这个站点已经是 Favorite 了");
  }

  if (favorites.length >= MAX_FAVORITES) {
    throw new FavoritesError("limit-reached", `最多只能添加 ${MAX_FAVORITES} 个 Favorite`);
  }

  return {
    id: input.id,
    homeUrl,
    title: input.title.trim() || new URL(homeUrl).hostname,
    order: favorites.length,
    createdAt: input.now,
    lastKnownUrl: homeUrl,
    lastKnownTitle: input.title.trim() || new URL(homeUrl).hostname,
    lastKnownIconUrl: input.iconUrl,
    siteKey: siteKeyForUrl(homeUrl),
    guardEnabled: input.guardEnabled,
    ...(opensSameSiteInNewTabByDefault(homeUrl) ? { sameSiteInNewTab: true } : {}),
  };
}

export function updateFavorite(
  favorite: Favorite,
  changes: UpdateFavoriteInput,
): Favorite {
  const next = { ...favorite };

  if (changes.customTitle !== undefined) {
    const value = changes.customTitle.trim();
    next.customTitle = value || undefined;
  }

  if (changes.customIcon !== undefined) {
    const value = changes.customIcon.trim();
    next.customIcon = value || undefined;
  }

  if (changes.homeUrl !== undefined) {
    next.homeUrl = normalizeWebUrl(changes.homeUrl);
    next.siteKey = siteKeyForUrl(next.homeUrl);
  }

  if (changes.guardEnabled !== undefined) {
    next.guardEnabled = changes.guardEnabled;
  }

  if (changes.sameSiteInNewTab !== undefined) {
    next.sameSiteInNewTab = changes.sameSiteInNewTab;
  }

  return next;
}

export function reorderFavorites(favorites: Favorite[], orderedIds: string[]): Favorite[] {
  if (
    orderedIds.length !== favorites.length ||
    new Set(orderedIds).size !== favorites.length ||
    favorites.some((favorite) => !orderedIds.includes(favorite.id))
  ) {
    throw new FavoritesError("invalid-order", "Favorite 排序数据无效");
  }

  const byId = new Map(favorites.map((favorite) => [favorite.id, favorite]));
  return orderedIds.map((id, order) => ({ ...byId.get(id)!, order }));
}
