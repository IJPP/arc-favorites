export const MAX_FAVORITES = 12;

export interface Favorite {
  id: string;
  homeUrl: string;
  title: string;
  customTitle?: string;
  customIcon?: string;
  order: number;
  createdAt: number;
  lastKnownUrl?: string;
  lastKnownTitle?: string;
  lastKnownIconUrl?: string;
  lastTabId?: number;
  siteKey: string;
  guardEnabled: boolean;
}

export interface FavoriteRuntime {
  favoriteId: string;
  tabId: number;
  windowId: number;
  currentUrl: string;
  currentTitle: string;
  currentIconUrl?: string;
  discarded?: boolean;
  loading?: boolean;
  audible?: boolean;
  updatedAt: number;
}

export interface FavoriteView extends Favorite {
  runtime?: FavoriteRuntime;
  active: boolean;
}

export interface AppSnapshot {
  favorites: FavoriteView[];
  maxFavorites: number;
}

export interface BrowserTab {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  pending?: boolean;
  discarded?: boolean;
  audible?: boolean;
  status?: "loading" | "complete" | "unloaded";
}

export interface BrowserPort {
  getActiveTab(): Promise<BrowserTab | undefined>;
  getTab(tabId: number): Promise<BrowserTab | undefined>;
  getPinnedTabs(): Promise<BrowserTab[]>;
  getActiveTabs(): Promise<BrowserTab[]>;
  createPinnedTab(url: string, active?: boolean, discardAfterCreate?: boolean, windowId?: number): Promise<BrowserTab>;
  reorderPinnedTabs(orderedTabIds: number[]): Promise<void>;
  focusTab(tab: BrowserTab): Promise<BrowserTab>;
  updateTab(
    tabId: number,
    changes: { pinned?: boolean; url?: string },
  ): Promise<BrowserTab | undefined>;
  discardTab(tabId: number): Promise<BrowserTab | undefined>;
  removeTab(tabId: number): Promise<void>;
  openOrdinaryTab(url: string, opener?: BrowserTab): Promise<BrowserTab>;
  installLinkGuard(tabId: number, siteKey: string, favoriteHosts: string[]): Promise<void>;
  disableLinkGuard(tabId: number): Promise<void>;
  showSwitchHint(tabId: number): Promise<void>;
  hasSiteAccess(siteKey: string): Promise<boolean>;
}

export interface FavoriteStore {
  loadFavorites(): Promise<Favorite[]>;
  saveFavorites(favorites: Favorite[]): Promise<void>;
  loadRuntimes(): Promise<Record<string, FavoriteRuntime>>;
  saveRuntimes(runtimes: Record<string, FavoriteRuntime>): Promise<void>;
}

export interface AddFavoriteInput {
  tab?: BrowserTab;
  guardEnabled?: boolean;
}

export type AddFavoriteOutcome = "added" | "adopted" | "focused-existing";

export interface AddFavoriteResult {
  snapshot: AppSnapshot;
  outcome: AddFavoriteOutcome;
  guardEnabled: boolean;
}

export interface UpdateFavoriteInput {
  customTitle?: string;
  customIcon?: string;
  homeUrl?: string;
  guardEnabled?: boolean;
}

export type ClientMessage =
  | { type: "get-state" }
  | { type: "add-current"; guardEnabled?: boolean }
  | { type: "activate"; favoriteId: string }
  | { type: "close-runtime"; favoriteId: string }
  | { type: "sleep-runtime"; favoriteId: string }
  | { type: "reset-home"; favoriteId: string }
  | { type: "use-current-as-home"; favoriteId: string }
  | { type: "remove-favorite"; favoriteId: string }
  | { type: "update-favorite"; favoriteId: string; changes: UpdateFavoriteInput }
  | { type: "reorder"; orderedIds: string[] }
  | { type: "open-external"; url: string }
  | { type: "route-link"; url: string };

export type ServerMessage = { type: "state-changed" };

export type MessageResponse<T = AppSnapshot> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
