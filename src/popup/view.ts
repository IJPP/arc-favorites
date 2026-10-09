import { appNameFromTitle } from "../core/names";
import type { AppSnapshot, FavoriteView } from "../core/types";
import { t } from "../core/i18n";

export type TileState = "closed" | "sleeping" | "loading" | "audible" | "running";

export function tileState(favorite: FavoriteView): TileState {
  const runtime = favorite.runtime;
  if (!runtime) return "closed";
  if (runtime.discarded) return "sleeping";
  if (runtime.loading) return "loading";
  if (runtime.audible) return "audible";
  return "running";
}

/** Full state wording for the detail strip and assistive technology. */
export function favoriteState(favorite: FavoriteView): string {
  if (!favorite.runtime) return t("stateClosed");
  if (favorite.runtime.discarded) return t("stateSleeping");
  if (favorite.runtime.loading) return t("stateLoading");
  if (favorite.runtime.audible) return t("statePlaying");
  return favorite.active ? t("stateCurrent") : t("stateRunning");
}

/** Compact wording under a tile. */
export function shortState(favorite: FavoriteView): string {
  if (favorite.active && favorite.runtime && !favorite.runtime.discarded) return t("shortCurrent");
  const short = { closed: "stateClosed", sleeping: "stateSleeping", loading: "stateLoading", audible: "shortPlaying", running: "shortRunning" } as const;
  return t(short[tileState(favorite)]);
}

export function displayName(favorite: Pick<FavoriteView, "customTitle" | "appName" | "title" | "homeUrl">): string {
  return favorite.customTitle || favorite.appName || appNameFromTitle(favorite.title, favorite.homeUrl);
}

/** "mail.google.com/mail/u/0/#inbox" without the protocol or a bare trailing slash. */
export function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    const rest = `${url.pathname}${url.search}${url.hash}`;
    return `${url.host.replace(/^www\./, "")}${rest === "/" ? "" : rest}`;
  } catch {
    return value;
  }
}

// Internal timestamps must never dismiss a menu or move keyboard focus.
export function snapshotKey(snapshot: AppSnapshot): string {
  return JSON.stringify(snapshot, (key, value) => key === "updatedAt" ? undefined : value);
}
