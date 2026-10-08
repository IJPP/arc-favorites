import type { AddFavoriteResult, AppSnapshot, FavoriteView } from "../core/types";
import { siteKeyForUrl } from "../core/url";
import { favoriteApi } from "./api";
import { tileFocusIndex } from "./keyboard";
import { favoriteState, snapshotKey } from "./view";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#app")!;
let snapshot: AppSnapshot = { favorites: [], maxFavorites: 12 };
let renderedSnapshot: string | undefined;
let busy = false;
let draggedId: string | undefined;
let menuCleanup: (() => void) | undefined;
let layout: "grid" | "list" = "grid";
try { if (localStorage.getItem("favorites.layout") === "list") layout = "list"; } catch { /* Storage may be restricted. */ }
let pendingRefresh = false;
let refreshRunning = false;
let refreshRequested = false;

function flushRefresh(): void {
  if (pendingRefresh && !menuCleanup && !document.querySelector("dialog[open]") && !draggedId && !busy) {
    pendingRefresh = false;
    void refresh();
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function displayTitle(favorite: FavoriteView): string {
  return (
    favorite.customTitle ||
    favorite.runtime?.currentTitle ||
    favorite.lastKnownTitle ||
    favorite.title
  );
}

function displayDomain(favorite: FavoriteView): string {
  try {
    return new URL(favorite.runtime?.currentUrl ?? favorite.homeUrl).hostname.replace(/^www\./, "");
  } catch {
    return favorite.siteKey;
  }
}

async function run(
  operation: () => Promise<AppSnapshot>,
  successMessage?: string,
  closeAfter = false,
): Promise<void> {
  if (busy) return;
  busy = true;
  document.body.dataset.busy = "true";
  try {
    snapshot = await operation();
    render();
    if (successMessage) showToast(successMessage);
    if (closeAfter && !favoriteApi.isPreview) window.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    showToast(message, true);
  } finally {
    busy = false;
    delete document.body.dataset.busy;
    flushRefresh();
  }
}

function render(): void {
  const previousScroll =
    document.querySelector<HTMLElement>(".favorites-section")?.scrollTop ?? 0;
  const focused = document.activeElement as HTMLElement | null;
  const focusId = focused?.dataset.favoriteId;
  const focusMore = focused?.classList.contains("more-button");
  const focusLayout = focused?.classList.contains("layout-button");
  menuCleanup?.();
  root.replaceChildren();

  const shell = element("main", `shell layout-${layout}`);
  shell.append(buildHeader());
  if (snapshot.favorites.length === 0) {
    shell.append(buildEmptyState());
  } else {
    shell.append(buildGrid());
  }
  shell.append(buildFooter());
  root.append(shell);
  if (previousScroll > 0) {
    const section = shell.querySelector<HTMLElement>(".favorites-section");
    if (section) section.scrollTop = previousScroll;
  }
  if (focusId) {
    const match = [...shell.querySelectorAll<HTMLElement>(focusMore ? ".more-button" : ".favorite-button")]
      .find((item) => item.dataset.favoriteId === focusId);
    match?.focus({ preventScroll: true });
  } else if (focusLayout) shell.querySelector<HTMLElement>(".layout-button")?.focus();
  renderedSnapshot = snapshotKey(snapshot);
}

function buildHeader(): HTMLElement {
  const header = element("header", "header");
  const identity = element("div", "identity");
  const labels = element("div", "identity-labels");
  labels.append(element("h1", "title", "Favorites"));
  labels.append(
    element(
      "span",
      "count",
      `${snapshot.favorites.length.toString().padStart(2, "0")} / ${snapshot.maxFavorites}`,
    ),
  );
  identity.append(labels);

  const add = element("button", "add-button");
  add.type = "button";
  add.title =
    snapshot.favorites.length >= snapshot.maxFavorites
      ? `已达到 ${snapshot.maxFavorites} 个上限`
      : "添加当前标签";
  add.setAttribute("aria-label", add.title);
  add.disabled = snapshot.favorites.length >= snapshot.maxFavorites || favoriteApi.isPreview;
  add.textContent = "＋ 添加当前页";
  add.addEventListener("click", () => {
    void addCurrent();
  });
  const actions = element("div", "header-actions");
  const toggle = element("button", "layout-button", layout === "grid" ? "☰" : "⊞");
  toggle.type = "button";
  toggle.title = layout === "grid" ? "切换到列表视图" : "切换到图标视图";
  toggle.setAttribute("aria-label", toggle.title);
  toggle.addEventListener("click", () => {
    layout = layout === "grid" ? "list" : "grid";
    try { localStorage.setItem("favorites.layout", layout); } catch { /* Use this view for the current popup. */ }
    render();
  });
  actions.append(toggle, add);
  header.append(identity, actions);
  return header;
}

function buildEmptyState(): HTMLElement {
  const empty = element("section", "empty");
  const icon = element("span", "empty-icon", "＋");
  icon.setAttribute("aria-hidden", "true");
  empty.append(icon);
  empty.append(element("h2", undefined, "还没有 Favorite"));
  empty.append(
    element("p", undefined, "固定一个标签页，或把当前页面加入 Favorites。"),
  );
  const add = element("button", "primary-button", "添加当前标签");
  add.type = "button";
  add.disabled = favoriteApi.isPreview;
  add.addEventListener("click", () => void addCurrent());
  empty.append(add);
  return empty;
}

function buildGrid(): HTMLElement {
  const section = element("section", "favorites-section");
  section.setAttribute("aria-label", "Favorite 应用");
  const grid = element("div", "favorites-grid");
  grid.setAttribute("role", "list");

  for (const favorite of snapshot.favorites) {
    grid.append(buildTile(favorite));
  }

  grid.addEventListener("keydown", (event) => {
    const tiles = [...grid.querySelectorAll<HTMLButtonElement>(".favorite-button")];
    const currentIndex = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0) return;
    if (event.key === "F2") {
      event.preventDefault();
      openEditDialog(snapshot.favorites[currentIndex]!);
      return;
    }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const bounds = tiles[currentIndex]!.getBoundingClientRect();
      openContextMenu(snapshot.favorites[currentIndex]!, bounds.left, bounds.bottom);
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = tileFocusIndex(event.key, currentIndex, tiles.length, layout === "grid" ? 4 : 1);
    if (event.altKey && event.shiftKey && nextIndex !== currentIndex) {
      const ids = snapshot.favorites.map((favorite) => favorite.id);
      ids.splice(nextIndex, 0, ids.splice(currentIndex, 1)[0]!);
      void run(() => favoriteApi.reorder(ids), "顺序已更新");
    } else tiles[nextIndex]?.focus();
  });

  section.append(grid);
  return section;
}

function buildTile(favorite: FavoriteView): HTMLElement {
  const wrapper = element("article", "favorite-item");
  wrapper.setAttribute("role", "listitem");
  wrapper.draggable = true;
  wrapper.dataset.favoriteId = favorite.id;

  const button = element("button", "favorite-button");
  button.type = "button";
  button.dataset.favoriteId = favorite.id;
  button.classList.toggle("is-active", favorite.active);
  button.classList.toggle("is-live", Boolean(favorite.runtime));
  const stateText = favoriteState(favorite);
  wrapper.classList.toggle("is-sleeping", Boolean(favorite.runtime?.discarded));
  wrapper.classList.toggle("is-loading", Boolean(favorite.runtime?.loading));
  if (favorite.active) button.setAttribute("aria-current", "page");
  button.title = `${displayTitle(favorite)} · ${stateText}\n${favorite.runtime?.currentUrl ?? favorite.homeUrl}`;
  button.setAttribute("aria-label", `${displayTitle(favorite)}，${stateText}`);

  const surface = element("span", "tile-surface");
  surface.append(buildIcon(favorite));
  if (favorite.runtime && !favorite.runtime.discarded) {
    const liveDot = element("span", "live-dot");
    liveDot.setAttribute("aria-hidden", "true");
    surface.append(liveDot);
  }
  const copy = element("span", "favorite-copy");
  copy.append(element("strong", undefined, displayTitle(favorite)));
  copy.append(element("small", undefined, displayDomain(favorite)));
  const state = element("span", "favorite-state", stateText);
  button.append(surface, copy, state);

  button.addEventListener("click", () => {
    void run(() => favoriteApi.activate(favorite.id), undefined, true);
  });
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openContextMenu(favorite, event.clientX, event.clientY);
  });

  wrapper.addEventListener("dragstart", (event) => {
    menuCleanup?.();
    draggedId = favorite.id;
    wrapper.classList.add("is-dragging");
    event.dataTransfer?.setData("text/plain", favorite.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  wrapper.addEventListener("dragend", () => {
    draggedId = undefined;
    document.querySelectorAll(".is-dragging, .is-drop-target").forEach((node) => node.classList.remove("is-dragging", "is-drop-target"));
    flushRefresh();
  });
  wrapper.addEventListener("dragover", (event) => {
    if (!draggedId || draggedId === favorite.id) return;
    event.preventDefault();
    wrapper.classList.add("is-drop-target");
  });
  wrapper.addEventListener("dragleave", () => wrapper.classList.remove("is-drop-target"));
  wrapper.addEventListener("drop", (event) => {
    event.preventDefault();
    wrapper.classList.remove("is-drop-target");
    const sourceId = event.dataTransfer?.getData("text/plain") || draggedId;
    if (!sourceId || sourceId === favorite.id) return;
    const ids = snapshot.favorites.map((item) => item.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(favorite.id);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    void run(() => favoriteApi.reorder(ids), "顺序已更新");
  });

  const more = element("button", "more-button", "⋮");
  more.type = "button";
  more.dataset.favoriteId = favorite.id;
  more.setAttribute("aria-haspopup", "menu");
  more.title = `管理 ${displayTitle(favorite)}`;
  more.setAttribute("aria-label", more.title);
  more.addEventListener("click", (event) => {
    event.stopPropagation();
    const bounds = more.getBoundingClientRect();
    openContextMenu(favorite, bounds.right, bounds.bottom + 2);
  });

  wrapper.append(button, more);
  return wrapper;
}

function buildIcon(favorite: FavoriteView): HTMLElement {
  if (favorite.customIcon) {
    const emoji = element("span", "emoji-icon");
    emoji.textContent = favorite.customIcon;
    emoji.setAttribute("aria-hidden", "true");
    return emoji;
  }

  const url = favoriteApi.faviconUrl(favorite);
  if (!url) {
    const fallback = element("span", "letter-icon");
    fallback.textContent = displayTitle(favorite).slice(0, 1).toUpperCase();
    fallback.setAttribute("aria-hidden", "true");
    return fallback;
  }

  const image = element("img", "favicon");
  image.src = url;
  image.alt = "";
  image.draggable = false;
  image.addEventListener("error", () => {
    const fallback = element("span", "letter-icon");
    fallback.textContent = displayTitle(favorite).slice(0, 1).toUpperCase();
    fallback.setAttribute("aria-hidden", "true");
    image.replaceWith(fallback);
  });
  return image;
}

function buildFooter(): HTMLElement {
  const footer = element("footer", "footer");
  const note = "拖动排序 · 1–9 快速打开";
  footer.append(element("span", undefined, note));
  const privacy = element("span", "privacy-mark", "仅本机保存");
  privacy.title = "扩展不读取网页正文，也不会上传数据";
  footer.title = "方向键移动 · Alt + Shift + 方向键排序 · F2 编辑 · Shift + F10 管理";
  if (favoriteApi.isPreview) privacy.textContent = "交互预览";
  footer.append(privacy);
  return footer;
}

function reservePopupHeight(requestedHeight: number): () => void {
  const shell = document.querySelector<HTMLElement>(".shell");
  if (!shell) return () => undefined;

  const previousMinHeight = shell.style.minHeight;
  const currentHeight = shell.getBoundingClientRect().height;
  const targetHeight = Math.min(560, Math.max(currentHeight, requestedHeight));
  shell.style.minHeight = `${targetHeight}px`;

  return () => {
    if (shell.isConnected) shell.style.minHeight = previousMinHeight;
  };
}

async function addCurrent(): Promise<void> {
  if (busy) return;
  busy = true;
  document.body.dataset.busy = "true";
  try {
    const result = await favoriteApi.addCurrent();
    snapshot = result.snapshot;
    render();
    showToast(addOutcomeMessage(result));
  } catch (error) {
    showToast(error instanceof Error ? error.message : "添加失败", true);
  } finally {
    busy = false;
    delete document.body.dataset.busy;
    flushRefresh();
  }
}

function addOutcomeMessage(result: AddFavoriteResult): string {
  if (result.outcome === "focused-existing") return "该站点已经是 Favorite，已切换过去";
  if (result.outcome === "adopted") return "已接管当前标签，加入已有 Favorite";
  return result.guardEnabled ? "已添加，并启用外链分流" : "已添加";
}

function openContextMenu(favorite: FavoriteView, x: number, y: number): void {
  menuCleanup?.();
  const returnFocus = document.activeElement as HTMLElement | null;
  const menu = element("div", "context-menu");
  menu.setAttribute("aria-label", `管理 ${displayTitle(favorite)}`);
  menu.setAttribute("role", "menu");

  const addAction = (
    label: string,
    action: () => void,
    options: { danger?: boolean; disabled?: boolean } = {},
  ) => {
    const item = element("button", `menu-item${options.danger ? " danger" : ""}`, label);
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.disabled = options.disabled ?? false;
    item.addEventListener("click", () => {
      menuCleanup?.();
      action();
    });
    menu.append(item);
  };

  addAction(favorite.runtime ? "切换到这里" : "打开", () => {
    void run(() => favoriteApi.activate(favorite.id), undefined, true);
  });
  addAction("休眠，保留固定标签", () => {
    void run(() => favoriteApi.sleepRuntime(favorite.id), "已释放内存，点击即可唤醒");
  }, { disabled: !favorite.runtime || favorite.runtime.discarded || favorite.active || favorite.runtime.audible });
  addAction("关闭页面，保留 Favorite", () => {
    void run(() => favoriteApi.closeRuntime(favorite.id), "页面已关闭，下次从初始网址打开");
  }, { disabled: !favorite.runtime });
  menu.append(element("hr", "menu-separator"));
  addAction("取消固定并移除…", () => openRemoveDialog(favorite), { danger: true });
  menu.append(element("hr", "menu-separator"));
  addAction("回到初始页面", () => {
    void run(() => favoriteApi.resetHome(favorite.id), "已回到初始页面");
  }, { disabled: !favorite.runtime });
  addAction("将当前页面设为初始页面", () => {
    void run(() => favoriteApi.useCurrentAsHome(favorite.id), "初始页面已更新");
  }, { disabled: !favorite.runtime });
  addAction("编辑名称、图标和网址…", () => openEditDialog(favorite));

  document.body.append(menu);
  const margin = 8;
  const releaseHeight = reservePopupHeight(menu.scrollHeight + margin * 2);
  menu.style.visibility = "hidden";

  const positionMenu = () => {
    const shellBounds = document.querySelector<HTMLElement>(".shell")?.getBoundingClientRect();
    const rightEdge = Math.min(shellBounds?.right ?? innerWidth, innerWidth);
    const bottomEdge = Math.min(shellBounds?.bottom ?? innerHeight, innerHeight);
    menu.style.maxHeight = `${Math.max(96, bottomEdge - margin * 2)}px`;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(margin, Math.min(x, rightEdge - bounds.width - margin))}px`;
    menu.style.top = `${Math.max(margin, Math.min(y, bottomEdge - bounds.height - margin))}px`;
    menu.style.visibility = "visible";
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  };
  requestAnimationFrame(() => requestAnimationFrame(positionMenu));

  const close = (event?: Event) => {
    if (event && menu.contains(event.target as Node)) return;
    menu.remove();
    releaseHeight();
    document.removeEventListener("pointerdown", close, true);
    document.removeEventListener("keydown", onKey, true);
    menuCleanup = undefined;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    queueMicrotask(flushRefresh);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  };
  document.addEventListener("pointerdown", close, true);
  document.addEventListener("keydown", onKey, true);
  menuCleanup = () => close();


}

function openEditDialog(favorite: FavoriteView): void {
  const returnFocus = document.activeElement as HTMLElement | null;
  const releaseHeight = reservePopupHeight(520);
  const dialog = element("dialog", "dialog");
  const form = element("form", "dialog-form");
  form.method = "dialog";
  const heading = element("div", "dialog-heading");
  heading.append(element("span", "eyebrow", "Favorite 设置"));
  heading.append(element("h2", undefined, displayTitle(favorite)));
  form.append(heading);

  const nameInput = buildField("显示名称", "text", favorite.customTitle ?? "", "跟随页面标题");
  const iconInput = buildField("自定义图标", "text", favorite.customIcon ?? "", "输入一个 Emoji");
  nameInput.input.maxLength = 120;
  iconInput.input.maxLength = 32;
  const urlInput = buildField("初始页面", "url", favorite.homeUrl, "https://example.com/");
  form.append(nameInput.wrapper, iconInput.wrapper, urlInput.wrapper);

  const guardLabel = element("label", "toggle-row");
  const guardCopy = element("span", "toggle-copy");
  guardCopy.append(element("strong", undefined, "外站链接开普通标签"));
  guardCopy.append(element("small", undefined, "当前站点内继续浏览，跨站链接开普通标签"));
  const guard = element("input", "toggle-input");
  guard.type = "checkbox";
  guard.checked = favorite.guardEnabled;
  guardLabel.append(guardCopy, guard);
  form.append(guardLabel);

  const actions = element("div", "dialog-actions");
  const cancel = element("button", "secondary-button", "取消");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  const save = element("button", "primary-button", "保存更改");
  save.type = "submit";
  actions.append(cancel, save);
  form.append(actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      if (save.disabled) return;
      save.disabled = true;
      try {
        const guardEnabled = guard.checked;
        const nextSite = siteKeyForUrl(urlInput.input.value);
        if (guardEnabled && !(await favoriteApi.hasSiteAccess(nextSite))) {
          throw new Error(
            "Chrome 尚未允许 Favorites 访问这个网站；请在扩展详情的“网站访问权限”中允许后再启用外链分流。",
          );
        }
        snapshot = await favoriteApi.update(favorite.id, {
          customTitle: nameInput.input.value,
          customIcon: iconInput.input.value,
          homeUrl: urlInput.input.value,
          guardEnabled,
        });
        dialog.close();
        render();
        showToast("更改已保存");
      } catch (error) {
        showInlineError(form, error instanceof Error ? error.message : "保存失败");
      } finally { save.disabled = false; }
    })();
  });

  dialog.setAttribute("aria-label", displayTitle(favorite));
  dialog.addEventListener("close", () => {
    releaseHeight();
    dialog.remove();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    flushRefresh();
  });
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  nameInput.input.focus();
}

function buildField(
  labelText: string,
  type: string,
  value: string,
  placeholder: string,
): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = element("label", "field");
  wrapper.append(element("span", undefined, labelText));
  const input = element("input", "text-input");
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  wrapper.append(input);
  return { wrapper, input };
}

function openRemoveDialog(favorite: FavoriteView): void {
  const returnFocus = document.activeElement as HTMLElement | null;
  const releaseHeight = reservePopupHeight(300);
  const dialog = element("dialog", "dialog confirm-dialog");
  const form = element("form", "dialog-form");
  form.method = "dialog";
  form.append(element("span", "eyebrow", "取消固定并移除"));
  form.append(element("h2", undefined, displayTitle(favorite)));
  form.append(
    element(
      "p",
      "dialog-copy",
      favorite.runtime
        ? "这个入口会被移除；当前网页会保留为普通未固定标签。"
        : "入口会被移除。这个操作不会删除浏览记录或网站数据。",
    ),
  );
  const actions = element("div", "dialog-actions");
  const cancel = element("button", "secondary-button", "保留");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  const remove = element("button", "danger-button", "取消固定");
  remove.type = "button";
  remove.addEventListener("click", () => {
    dialog.close();
    void run(() => favoriteApi.remove(favorite.id), "Favorite 已移除");
  });
  actions.append(cancel, remove);
  form.append(actions);
  dialog.setAttribute("aria-label", displayTitle(favorite));
  dialog.addEventListener("close", () => {
    releaseHeight();
    dialog.remove();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    flushRefresh();
  });
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  cancel.focus();
}

function showInlineError(form: HTMLElement, message: string): void {
  form.querySelector(".inline-error")?.remove();
  const error = element("p", "inline-error", message);
  error.setAttribute("role", "alert");
  form.querySelector(".dialog-actions")?.before(error);
}

function showToast(message: string, isError = false): void {
  document.querySelector(".toast")?.remove();
  const toast = element("div", `toast${isError ? " is-error" : ""}`, message);
  toast.setAttribute("role", isError ? "alert" : "status");
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 180);
  }, 2600);
}

async function refresh(): Promise<void> {
  if (refreshRunning) { refreshRequested = true; return; }
  refreshRunning = true;
  try {
    do {
      refreshRequested = false;
      const next = await favoriteApi.getState();
      if (renderedSnapshot === snapshotKey(next)) continue;
      if (menuCleanup || document.querySelector("dialog[open]") || draggedId || busy) {
        pendingRefresh = true;
        continue;
      }
      snapshot = next;
      render();
    } while (refreshRequested);
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法加载 Favorites";
    if (renderedSnapshot) showToast(message, true);
    else {
      const failure = element("section", "empty");
      failure.append(element("p", "fatal-error", message));
      const retry = element("button", "primary-button", "重试");
      retry.addEventListener("click", () => void refresh());
      failure.append(retry);
      root.replaceChildren(failure);
    }
  } finally { refreshRunning = false; }
}

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || menuCleanup || document.querySelector("dialog[open]")) return;
  if ((event.target as HTMLElement)?.matches("input, textarea, [contenteditable]")) return;
  const index = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
  const favorite = snapshot.favorites[index];
  if (favorite) {
    event.preventDefault();
    void run(() => favoriteApi.activate(favorite.id), undefined, true);
  }
});
favoriteApi.onStateChanged(() => { void refresh(); });
void refresh();
