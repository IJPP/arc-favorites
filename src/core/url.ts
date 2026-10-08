import { getDomain } from "tldts";
import { FavoritesError } from "./errors";

export function normalizeWebUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new FavoritesError("invalid-url", "请输入完整的 http 或 https 网址");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FavoritesError("unsupported-url", "只能将 http 或 https 页面添加为 Favorite");
  }

  if (url.username || url.password) {
    throw new FavoritesError("url-credentials-not-allowed", "网址不能包含用户名或密码");
  }

  return url.toString();
}

export function siteKeyForUrl(value: string): string {
  const url = new URL(normalizeWebUrl(value));
  return getDomain(url.hostname, { allowPrivateDomains: true }) ?? url.hostname;
}

/**
 * Identity that decides whether two Favorites describe the same app entry.
 * Arc-style Favorites are site level (Gmail and Calendar both live on
 * google.com but are separate entries), so the hostname is the key. `www.` is
 * cosmetic, while a non-default port is part of the app.
 */
export function favoriteIdentityForUrl(value: string): string {
  const url = new URL(normalizeWebUrl(value));
  const hostname = url.hostname.replace(/^www\./i, "");
  return url.port ? `${hostname}:${url.port}` : hostname;
}

export function permissionPatternForSite(siteKey: string): string {
  const isIpAddress = /^[\d.]+$/.test(siteKey) || siteKey.includes(":");
  if (siteKey === "localhost" || isIpAddress) {
    const host = siteKey.includes(":") && !siteKey.startsWith("[") ? `[${siteKey}]` : siteKey;
    return `*://${host}/*`;
  }
  return `*://*.${siteKey}/*`;
}

export function isSupportedPage(value?: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
