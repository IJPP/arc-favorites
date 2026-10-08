import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeFavoriteStore } from "../src/core/storage";

describe("ChromeFavoriteStore migrations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("upgrades v0.1 Favorites so link routing is enabled after reload", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            "arcFavorites.v1": {
              version: 1,
              items: [
                {
                  id: "favorite-1",
                  homeUrl: "https://example.com/",
                  title: "Example",
                  order: 0,
                  createdAt: 1,
                  siteKey: "example.com",
                  guardEnabled: false,
                },
              ],
            },
          }),
          set,
        },
      },
    });

    const favorites = await new ChromeFavoriteStore().loadFavorites();

    expect(favorites[0]?.guardEnabled).toBe(true);
    expect(set).toHaveBeenCalledWith({
      "arcFavorites.v1": {
        version: 2,
        items: [expect.objectContaining({ id: "favorite-1", guardEnabled: true })],
      },
    });
  });

  it("repairs valid Favorites and drops corrupt or duplicate entries", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            "arcFavorites.v1": {
              version: 2,
              items: [
                {
                  id: "favorite-1",
                  homeUrl: "https://app.example.com/#/inbox",
                  title: "Example",
                  order: 9,
                  createdAt: 3,
                  siteKey: "wrong.example",
                  guardEnabled: true,
                },
                {
                  id: "favorite-1",
                  homeUrl: "https://duplicate.example.com/",
                  title: "Duplicate",
                  order: 2,
                  createdAt: 4,
                  siteKey: "example.com",
                  guardEnabled: true,
                },
                {
                  id: "bad",
                  homeUrl: "https://user:secret@example.com/",
                  title: "Bad",
                  order: 1,
                  createdAt: 5,
                  siteKey: "example.com",
                  guardEnabled: true,
                },
              ],
            },
          }),
          set,
        },
      },
    });

    const favorites = await new ChromeFavoriteStore().loadFavorites();

    expect(favorites).toHaveLength(1);
    expect(favorites[0]).toMatchObject({
      id: "favorite-1",
      homeUrl: "https://app.example.com/#/inbox",
      siteKey: "example.com",
      order: 0,
    });
    expect(set).toHaveBeenCalledOnce();
  });

  it("filters malformed session runtimes instead of poisoning initialization", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn().mockResolvedValue({
            "arcFavoriteRuntimes.v1": {
              version: 1,
              items: {
                good: {
                  favoriteId: "wrong-id",
                  tabId: 7,
                  windowId: 2,
                  currentUrl: "https://example.com/#open",
                  currentTitle: "Example",
                  updatedAt: 10,
                },
                bad: {
                  favoriteId: "bad",
                  tabId: "not-a-tab",
                  windowId: 2,
                  currentUrl: "not a URL",
                  currentTitle: "Bad",
                  updatedAt: 10,
                },
              },
            },
          }),
          set,
        },
      },
    });

    const runtimes = await new ChromeFavoriteStore().loadRuntimes();

    expect(runtimes).toEqual({
      good: {
        favoriteId: "good",
        tabId: 7,
        windowId: 2,
        currentUrl: "https://example.com/#open",
        currentTitle: "Example",
        currentIconUrl: undefined,
        discarded: false,
        loading: false,
        audible: false,
        updatedAt: 10,
      },
    });
    expect(set).toHaveBeenCalledOnce();
  });

  it("does not rewrite a healthy store just because normalized keys were rebuilt", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    // Mirrors what the controller persists after adding a Favorite:
    // createFavorite emits keys in domain order and lastTabId is appended.
    const storedFavorite = {
      id: "favorite-1",
      homeUrl: "https://example.com/",
      title: "Example",
      order: 0,
      createdAt: 1,
      lastKnownUrl: "https://example.com/",
      lastKnownTitle: "Example",
      lastKnownIconUrl: undefined,
      siteKey: "example.com",
      guardEnabled: true,
      lastTabId: 7,
    };
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            "arcFavorites.v1": { version: 2, items: [storedFavorite] },
          }),
          set,
        },
      },
    });

    const favorites = await new ChromeFavoriteStore().loadFavorites();

    expect(favorites).toHaveLength(1);
    expect(favorites[0]?.lastTabId).toBe(7);
    expect(set).not.toHaveBeenCalled();
  });

  it("merges duplicate Favorites for the same site and keeps the first", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            "arcFavorites.v1": {
              version: 2,
              items: [
                {
                  id: "later",
                  homeUrl: "https://mail.example.com/inbox",
                  title: "Mail",
                  order: 3,
                  createdAt: 9,
                  siteKey: "example.com",
                  guardEnabled: true,
                },
                {
                  id: "first",
                  homeUrl: "https://mail.example.com/",
                  title: "Mail home",
                  order: 0,
                  createdAt: 1,
                  siteKey: "example.com",
                  guardEnabled: true,
                },
              ],
            },
          }),
          set,
        },
      },
    });

    const favorites = await new ChromeFavoriteStore().loadFavorites();

    expect(favorites.map((favorite) => favorite.id)).toEqual(["first"]);
    expect(favorites[0]?.order).toBe(0);
    expect(set).toHaveBeenCalledOnce();
  });
});
