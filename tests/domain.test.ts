import { describe, expect, it } from "vitest";
import { createFavorite, reorderFavorites, updateFavorite } from "../src/core/domain";
import { MAX_FAVORITES, type Favorite } from "../src/core/types";
import { favoriteIdentityForUrl, permissionPatternsForSite } from "../src/core/url";

function favorite(id: string, order: number): Favorite {
  return {
    id,
    homeUrl: `https://${id}.example.com/`,
    title: id,
    order,
    createdAt: order,
    siteKey: "example.com",
    guardEnabled: false,
  };
}

describe("Favorite domain", () => {
  it("creates a normalized Favorite", () => {
    const result = createFavorite([], {
      id: "mail",
      url: "https://mail.example.com/inbox#today",
      title: "Mail",
      guardEnabled: true,
      now: 10,
    });
    expect(result.homeUrl).toBe("https://mail.example.com/inbox#today");
    expect(result.siteKey).toBe("example.com");
    expect(result.order).toBe(0);
  });

  it("enforces the twelve Favorite limit", () => {
    const favorites = Array.from({ length: MAX_FAVORITES }, (_, index) =>
      favorite(`item-${index}`, index),
    );
    expect(() =>
      createFavorite(favorites, {
        id: "extra",
        url: "https://extra.example.com/",
        title: "Extra",
        guardEnabled: false,
        now: 20,
      }),
    ).toThrow("最多只能添加 12 个 Favorite");
  });

  it("reorders every Favorite deterministically", () => {
    const result = reorderFavorites(
      [favorite("a", 0), favorite("b", 1), favorite("c", 2)],
      ["c", "a", "b"],
    );
    expect(result.map((item) => [item.id, item.order])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("updates the home URL and clears blank custom values", () => {
    const result = updateFavorite(favorite("a", 0), {
      customTitle: "  ",
      customIcon: " ✦ ",
      homeUrl: "https://docs.example.org/start",
    });
    expect(result.customTitle).toBeUndefined();
    expect(result.customIcon).toBe("✦");
    expect(result.siteKey).toBe("example.org");
  });

  it("checks host access per scheme, never with a wildcard scheme", () => {
    // `*://` is wider than the manifest's http/https grants in current Chrome.
    expect(permissionPatternsForSite("example.com")).toEqual(["http://*.example.com/*", "https://*.example.com/*"]);
    expect(permissionPatternsForSite("localhost")).toEqual(["http://localhost/*", "https://localhost/*"]);
    expect(permissionPatternsForSite("127.0.0.1")).toEqual(["http://127.0.0.1/*", "https://127.0.0.1/*"]);
    expect(permissionPatternsForSite("::1")).toEqual(["http://[::1]/*", "https://[::1]/*"]);
  });

  it("refuses a second Favorite for the same site", () => {
    const existing = favorite("mail", 0);
    expect(() =>
      createFavorite([existing], {
        id: "mail-second",
        url: "https://mail.example.com/inbox",
        title: "Mail",
        guardEnabled: true,
        now: 20,
      }),
    ).toThrow("已经是 Favorite");
  });

  it("treats the www prefix as the same site but keeps subdomains apart", () => {
    const existing = favorite("site", 0);
    expect(() =>
      createFavorite([existing], {
        id: "site-www",
        url: "https://www.site.example.com/",
        title: "Site",
        guardEnabled: true,
        now: 21,
      }),
    ).toThrow("已经是 Favorite");
    expect(
      createFavorite([existing], {
        id: "docs",
        url: "https://docs.site.example.com/",
        title: "Docs",
        guardEnabled: true,
        now: 22,
      }).id,
    ).toBe("docs");
  });

  it("treats a non-default port as part of the app identity", () => {
    expect(favoriteIdentityForUrl("http://localhost:3000/")).toBe("localhost:3000");
    expect(favoriteIdentityForUrl("https://www.example.com/app")).toBe("example.com");
  });

  it("refuses to persist credentials embedded in a Favorite URL", () => {
    expect(() =>
      createFavorite([], {
        id: "unsafe",
        url: "https://user:secret@example.com/",
        title: "Unsafe",
        guardEnabled: true,
        now: 1,
      }),
    ).toThrow("网址不能包含用户名或密码");
  });
});
