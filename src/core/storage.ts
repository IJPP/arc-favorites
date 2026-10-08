import type { Favorite, FavoriteRuntime, FavoriteStore } from "./types";
import { favoriteIdentityForUrl, normalizeWebUrl, opensSameSiteInNewTabByDefault, siteKeyForUrl } from "./url";

const FAVORITES_KEY = "arcFavorites.v1";
const RUNTIMES_KEY = "arcFavoriteRuntimes.v1";

interface StoredFavoritesV1 {
  version: 1;
  items: Favorite[];
}

interface StoredFavoritesV2 {
  version: 2;
  items: Favorite[];
}

type StoredFavorites = StoredFavoritesV1 | StoredFavoritesV2;

interface StoredRuntimes {
  version: 1;
  items: Record<string, FavoriteRuntime>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JSON.stringify is key-order sensitive, so objects that are semantically
// identical can produce different strings. Normalized items are rebuilt with a
// canonical key order, which would otherwise look like a repair candidate on
// every load and trigger a pointless storage write.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function validWebUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return normalizeWebUrl(value);
  } catch {
    return undefined;
  }
}

function normalizeFavorite(
  value: unknown,
  fallbackOrder: number,
  forceGuardEnabled: boolean,
): Favorite | undefined {
  if (!isRecord(value)) return undefined;
  const id = nonEmptyString(value.id);
  const homeUrl = validWebUrl(value.homeUrl);
  if (!id || !homeUrl) return undefined;

  const title = nonEmptyString(value.title) ?? new URL(homeUrl).hostname;
  const lastKnownUrl = validWebUrl(value.lastKnownUrl);
  const order =
    typeof value.order === "number" && Number.isFinite(value.order)
      ? value.order
      : fallbackOrder;
  const createdAt =
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
      ? value.createdAt
      : 0;
  const lastTabId =
    typeof value.lastTabId === "number" && Number.isInteger(value.lastTabId)
      ? value.lastTabId
      : undefined;

  return {
    id,
    homeUrl,
    title,
    customTitle: nonEmptyString(value.customTitle),
    customIcon: nonEmptyString(value.customIcon),
    appName: nonEmptyString(value.appName),
    order,
    createdAt,
    lastKnownUrl,
    lastKnownTitle: nonEmptyString(value.lastKnownTitle),
    lastKnownIconUrl: nonEmptyString(value.lastKnownIconUrl),
    lastTabId,
    siteKey: siteKeyForUrl(homeUrl),
    guardEnabled:
      forceGuardEnabled || typeof value.guardEnabled !== "boolean"
        ? true
        : value.guardEnabled,
    // Entries saved before 0.6.0 pick up the site's default once.
    sameSiteInNewTab: typeof value.sameSiteInNewTab === "boolean"
      ? value.sameSiteInNewTab
      : opensSameSiteInNewTabByDefault(homeUrl) || undefined,
  };
}

function normalizeRuntime(value: unknown, favoriteId: string): FavoriteRuntime | undefined {
  if (!isRecord(value)) return undefined;
  const tabId = value.tabId;
  const windowId = value.windowId;
  const currentUrl = validWebUrl(value.currentUrl);
  if (
    typeof tabId !== "number" ||
    !Number.isInteger(tabId) ||
    typeof windowId !== "number" ||
    !Number.isInteger(windowId) ||
    !currentUrl
  ) {
    return undefined;
  }

  return {
    favoriteId,
    tabId,
    windowId,
    currentUrl,
    currentTitle: nonEmptyString(value.currentTitle) ?? new URL(currentUrl).hostname,
    currentIconUrl: nonEmptyString(value.currentIconUrl),
    discarded: value.discarded === true,
    loading: value.loading === true,
    audible: value.audible === true,
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : 0,
  };
}

export class ChromeFavoriteStore implements FavoriteStore {
  async loadFavorites(): Promise<Favorite[]> {
    const result = await chrome.storage.local.get(FAVORITES_KEY);
    const stored = result[FAVORITES_KEY] as StoredFavorites | undefined;
    if (
      !stored ||
      (stored.version !== 1 && stored.version !== 2) ||
      !Array.isArray(stored.items)
    ) {
      return [];
    }

    // v0.1 could silently disable the link guard when optional access was
    // declined or when a Favorite was added through the page context menu.
    // v0.2 makes this core behavior deterministic and upgrades old entries.
    const seenIds = new Set<string>();
    const parsed = (stored.items as unknown[])
      .flatMap((favorite, index) => {
        const item = normalizeFavorite(favorite, index, stored.version === 1);
        if (!item || seenIds.has(item.id)) return [];
        seenIds.add(item.id);
        return [item];
      })
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);

    // Older versions allowed several Favorites for the same app. Arc-style
    // entries are site level, so keep the first one and leave the other pinned
    // tabs alone instead of dropping the whole store.
    const seenIdentities = new Set<string>();
    const normalized = parsed
      .filter((favorite) => {
        const identity = favoriteIdentityForUrl(favorite.homeUrl);
        if (seenIdentities.has(identity)) return false;
        seenIdentities.add(identity);
        return true;
      })
      .map((favorite, order) => ({ ...favorite, order }));

    if (parsed.length !== stored.items.length) {
      console.warn(
        `[Favorites] Ignored ${stored.items.length - parsed.length} invalid stored item(s).`,
      );
    }
    if (normalized.length !== parsed.length) {
      console.warn(
        `[Favorites] Merged ${parsed.length - normalized.length} duplicate site entries.`,
      );
    }
    if (stored.version === 1 || stableStringify(normalized) !== stableStringify(stored.items)) {
      await this.saveFavorites(normalized);
    }
    return normalized;
  }

  async saveFavorites(favorites: Favorite[]): Promise<void> {
    const value: StoredFavoritesV2 = { version: 2, items: favorites };
    await chrome.storage.local.set({ [FAVORITES_KEY]: value });
  }

  async loadRuntimes(): Promise<Record<string, FavoriteRuntime>> {
    const result = await chrome.storage.session.get(RUNTIMES_KEY);
    const stored = result[RUNTIMES_KEY] as StoredRuntimes | undefined;
    if (!stored || stored.version !== 1 || !isRecord(stored.items)) return {};

    const normalized = Object.fromEntries(
      Object.entries(stored.items).flatMap(([favoriteId, runtime]) => {
        const cleanId = nonEmptyString(favoriteId);
        const item = cleanId ? normalizeRuntime(runtime, cleanId) : undefined;
        return item ? [[cleanId!, item]] : [];
      }),
    );
    if (stableStringify(normalized) !== stableStringify(stored.items)) {
      console.warn("[Favorites] Repaired invalid session runtime data.");
      await this.saveRuntimes(normalized);
    }
    return normalized;
  }

  async saveRuntimes(runtimes: Record<string, FavoriteRuntime>): Promise<void> {
    const value: StoredRuntimes = { version: 1, items: runtimes };
    await chrome.storage.session.set({ [RUNTIMES_KEY]: value });
  }
}
