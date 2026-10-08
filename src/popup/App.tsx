import type { JSX } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AppSnapshot, CurrentTabContext, FavoriteView, UpdateFavoriteInput } from "../core/types";
import { favoriteApi, previewBrands } from "./api";
import { cachedBrand, extractBrand, fallbackBrand, rememberBrand } from "./brand";
import {
  Banner, ContextCard, DetailStrip, Editor, Icon, Menu, SPRING, Tile, Toast,
  reducedMotion, type ContextAction, type MenuItem, type ToastState,
} from "./components";
import { gridLayout, moveSelection, shiftId } from "./layout";
import { displayName, displayUrl, snapshotKey } from "./view";

interface MenuState { favoriteId?: string; x: number; y: number }
interface EditorState { favoriteId: string; origin?: DOMRect }
interface DragState {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  /** Slot position (offsetLeft/Top) when the drag began. */
  originLeft: number;
  originTop: number;
  moved: boolean;
}

const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [context, setContext] = useState<CurrentTabContext>();
  const [strays, setStrays] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string>();
  const [menu, setMenu] = useState<MenuState>();
  const [editor, setEditor] = useState<EditorState>();
  const [dragOrder, setDragOrder] = useState<string[]>();
  const [draggingId, setDraggingId] = useState<string>();
  const [toast, setToast] = useState<ToastState>();
  const [busy, setBusy] = useState(false);
  const [brands, setBrands] = useState<Record<string, string>>({});

  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tileEls = useRef(new Map<string, HTMLDivElement>());
  const lastSlots = useRef(new Map<string, { x: number; y: number; w: number; h: number }>());
  const drag = useRef<DragState>();
  const dragOrderRef = useRef<string[]>();
  dragOrderRef.current = dragOrder;
  const suppressClick = useRef(false);
  const snapshotRef = useRef<AppSnapshot>();
  const blockedRef = useRef(false);
  const deferredRefresh = useRef(false);
  const toastId = useRef(0);
  snapshotRef.current = snapshot;
  blockedRef.current = Boolean(menu || editor || draggingId || busy);

  const showToast = useCallback((text: string, options: Omit<ToastState, "id" | "text"> = {}) => {
    setToast({ id: ++toastId.current, text, ...options });
  }, []);

  // ——— Data ————————————————————————————————————————————————————————————————

  const refresh = useCallback(async () => {
    try {
      const [next, nextContext, blanks] = await Promise.all([
        favoriteApi.getState(),
        favoriteApi.getContext().catch(() => undefined),
        favoriteApi.countStrayBlanks().catch(() => 0),
      ]);
      // Background updates must never yank a menu, an editor or a drag away.
      if (blockedRef.current && snapshotRef.current) {
        deferredRefresh.current = true;
        return;
      }
      setSnapshot((previous) => previous && snapshotKey(previous) === snapshotKey(next) ? previous : next);
      setContext(nextContext);
      setStrays(blanks);
      setLoadError(undefined);
    } catch (error) {
      if (snapshotRef.current) showToast(errorText(error, "无法刷新"), { error: true });
      else setLoadError(errorText(error, "无法加载 Favorites"));
    }
  }, [showToast]);

  useEffect(() => {
    void refresh();
    return favoriteApi.onStateChanged(() => void refresh());
  }, [refresh]);

  useEffect(() => {
    if (!blockedRef.current && deferredRefresh.current) {
      deferredRefresh.current = false;
      void refresh();
    }
  }, [menu, editor, draggingId, busy, refresh]);

  const run = useCallback(async (
    operation: () => Promise<AppSnapshot>,
    options: { success?: string; closePopup?: boolean } = {},
  ): Promise<AppSnapshot | undefined> => {
    if (busy) return undefined;
    setBusy(true);
    try {
      const next = await operation();
      setSnapshot(next);
      void favoriteApi.getContext().then(setContext).catch(() => undefined);
      if (options.success) showToast(options.success);
      if (options.closePopup && !favoriteApi.isPreview) window.close();
      return next;
    } catch (error) {
      showToast(errorText(error, "操作失败"), { error: true });
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [busy, showToast]);

  // ——— Derived ————————————————————————————————————————————————————————————

  const favorites = useMemo(() => {
    const list = snapshot?.favorites ?? [];
    if (!dragOrder) return list;
    const byId = new Map(list.map((favorite) => [favorite.id, favorite]));
    return dragOrder.flatMap((id) => byId.get(id) ?? []);
  }, [snapshot, dragOrder]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return favorites.flatMap((favorite, index) => {
      if (!q) return [index];
      const haystack = `${displayName(favorite)} ${displayUrl(favorite.homeUrl)}`.toLowerCase();
      return haystack.includes(q) ? [index] : [];
    });
  }, [favorites, query]);

  const { cols, size } = gridLayout(favorites.length);
  const selectedIndex = selectedId ? favorites.findIndex((favorite) => favorite.id === selectedId) : -1;
  const byId = (id?: string) => id ? favorites.find((favorite) => favorite.id === id) : undefined;
  const detailFavorite = byId(hoveredId) ?? byId(selectedId) ?? favorites.find((favorite) => favorite.active) ?? favorites[0];

  const brandOf = (favorite: FavoriteView) =>
    brands[favorite.siteKey] ?? cachedBrand(favorite.siteKey)
    ?? (favoriteApi.isPreview ? previewBrands[favorite.siteKey] : undefined)
    ?? fallbackBrand(favorite.siteKey);

  const learnBrand = (favorite: FavoriteView) => (image: HTMLImageElement) => {
    if (favorite.customIcon) return;
    const color = extractBrand(image);
    if (!color || brands[favorite.siteKey] === color) return;
    rememberBrand(favorite.siteKey, color);
    setBrands((previous) => ({ ...previous, [favorite.siteKey]: color }));
  };

  // Keep the selection on something that still exists and still matches.
  useEffect(() => {
    if (!selectedId) return;
    const index = favorites.findIndex((favorite) => favorite.id === selectedId);
    if (index < 0) setSelectedId(undefined);
    else if (!visible.includes(index)) setSelectedId(favorites[visible[0] ?? -1]?.id);
  }, [favorites, visible, selectedId]);

  // ——— Motion: FLIP every tile whose slot changed ——————————————————————————

  useLayoutEffect(() => {
    const animate = !reducedMotion() && lastSlots.current.size > 0;
    const seen = new Set<string>();
    for (const [id, element] of tileEls.current) {
      seen.add(id);
      const slot = { x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight };
      const previous = lastSlots.current.get(id);
      lastSlots.current.set(id, slot);
      if (id === drag.current?.id && drag.current.moved) {
        positionDragged(element);
        continue;
      }
      if (!animate) continue;
      if (!previous) {
        element.animate([{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "none" }], { duration: 460, easing: SPRING });
        continue;
      }
      const dx = previous.x - slot.x;
      const dy = previous.y - slot.y;
      const sx = previous.w / slot.w;
      const sy = previous.h / slot.h;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      element.animate(
        [{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: "0 0", transform: "none" }],
        { duration: 520, easing: SPRING },
      );
    }
    for (const id of [...lastSlots.current.keys()]) if (!seen.has(id)) lastSlots.current.delete(id);
  });

  // ——— Actions ——————————————————————————————————————————————————————————

  const activate = (favorite: FavoriteView) => run(() => favoriteApi.activate(favorite.id), { closePopup: true });

  const openEditor = (favoriteId: string) => {
    setMenu(undefined);
    setEditor({ favoriteId, origin: tileEls.current.get(favoriteId)?.getBoundingClientRect() });
  };

  const closeEditor = () => setEditor(undefined);

  // Typing always lands in the filter once nothing else holds the focus.
  useEffect(() => {
    if (!editor && !menu) inputRef.current?.focus({ preventScroll: true });
  }, [editor, menu]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (editor || menu || target?.matches("input, textarea") || event.metaKey || event.ctrlKey) return;
      if (event.key.length === 1 || event.key.startsWith("Arrow") || event.key === "Enter") {
        inputRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [editor, menu]);

  const saveEditor = async (favoriteId: string, changes: UpdateFavoriteInput) => {
    const target = byId(favoriteId);
    if (changes.guardEnabled && changes.homeUrl && target) {
      let siteKey = target.siteKey;
      try { siteKey = new URL(changes.homeUrl).hostname; } catch { /* Validation happens in the background. */ }
      if (!(await favoriteApi.hasSiteAccess(siteKey).catch(() => true))) {
        throw new Error("Chrome 尚未允许访问这个网站。请在扩展详情的“网站访问权限”中允许，再开启外链分流。");
      }
    }
    // Errors propagate to the editor, which keeps the form open.
    const next = await favoriteApi.update(favoriteId, changes);
    setSnapshot(next);
    closeEditor();
    showToast("已保存");
  };

  const removeFavorite = async (favorite: FavoriteView) => {
    setEditor(undefined);
    const name = displayName(favorite);
    await run(() => favoriteApi.remove(favorite.id), {
      success: favorite.runtime ? `已移除 ${name}，页面保留为普通标签` : `已移除 ${name}`,
    });
  };

  const addCurrent = async () => {
    if (busy) return;
    setBusy(true);
    const before = new Set(favorites.map((favorite) => favorite.id));
    try {
      const result = await favoriteApi.addCurrent();
      setSnapshot(result.snapshot);
      void favoriteApi.getContext().then(setContext).catch(() => undefined);
      const added = result.snapshot.favorites.find((favorite) => !before.has(favorite.id));
      if (result.outcome === "focused-existing") showToast("这个网站已在 Favorites，已切换过去");
      else if (result.outcome === "adopted") showToast("已接管这个标签，作为已有 Favorite 的实例");
      else if (added) showToast(`已添加「${displayName(added)}」`, { action: { label: "改名", run: () => openEditor(added.id) } });
    } catch (error) {
      showToast(errorText(error, "添加失败"), { error: true });
    } finally {
      setBusy(false);
    }
  };

  const reorderTo = (ids: string[]) => {
    const current = (snapshot?.favorites ?? []).map((favorite) => favorite.id);
    if (ids.join() === current.join()) return Promise.resolve(undefined);
    return run(() => favoriteApi.reorder(ids), { success: "顺序已同步到固定标签" });
  };

  const onContextAction = (action: ContextAction) => {
    const favoriteId = context?.favoriteId;
    const target = byId(favoriteId);
    if (action === "add") void addCurrent();
    else if (action === "edit" && favoriteId) openEditor(favoriteId);
    else if (action === "home" && favoriteId) void run(() => favoriteApi.resetHome(favoriteId), { success: "已回到初始页面" });
    else if (action === "set-home" && favoriteId) void run(() => favoriteApi.useCurrentAsHome(favoriteId), { success: "初始页面已更新" });
    else if (action === "switch" && target) void activate(target);
  };

  const favoriteMenu = (favorite: FavoriteView): MenuItem[] => {
    const live = Boolean(favorite.runtime);
    const sleeping = Boolean(favorite.runtime?.discarded);
    return [
      { kind: "action", icon: "open", label: live ? "切换到这里" : "打开", hint: "↵", run: () => void activate(favorite) },
      {
        kind: "action", icon: "moon", label: "休眠", run: () => void run(() => favoriteApi.sleepRuntime(favorite.id), { success: "已休眠，点击即可唤醒" }),
        disabled: !live || sleeping || favorite.active || Boolean(favorite.runtime?.audible),
      },
      { kind: "action", icon: "close", label: "关闭页面", disabled: !live, run: () => void run(() => favoriteApi.closeRuntime(favorite.id), { success: "页面已关闭，入口保留" }) },
      { kind: "separator" },
      { kind: "action", icon: "home", label: "回到初始页面", disabled: !live, run: () => void run(() => favoriteApi.resetHome(favorite.id), { success: "已回到初始页面" }) },
      { kind: "action", icon: "pin", label: "把当前页面设为初始页面", disabled: !live, run: () => void run(() => favoriteApi.useCurrentAsHome(favorite.id), { success: "初始页面已更新" }) },
      { kind: "action", icon: "edit", label: "编辑…", hint: "F2", run: () => openEditor(favorite.id) },
      { kind: "separator" },
      { kind: "action", icon: "trash", label: "移除", danger: true, run: () => void removeFavorite(favorite) },
    ];
  };

  const metaMenu = (): MenuItem[] => [
    {
      kind: "action", icon: "broom", label: strays ? `关闭 ${strays} 个空白固定标签` : "没有空白固定标签", disabled: !strays,
      run: () => void favoriteApi.closeStrayBlanks().then((count) => { setStrays(0); showToast(`已关闭 ${count} 个空白标签`); }),
    },
    {
      kind: "action", icon: "copy", label: "复制诊断信息",
      run: () => void favoriteApi.diagnostics()
        .then((data) => navigator.clipboard.writeText(JSON.stringify(data, null, 2)))
        .then(() => showToast("诊断信息已复制，只含本机记录"))
        .catch((error) => showToast(errorText(error, "复制失败"), { error: true })),
    },
    { kind: "separator" },
    { kind: "note", text: "1–9 打开 · 方向键选择 · ↵ 打开\nF2 编辑 · ⇧F10 菜单 · ⌥⇧ + 方向键 排序" },
  ];

  // ——— Drag to reorder (pointer based, FLIP for the others) ——————————————

  function positionDragged(element: HTMLElement) {
    const state = drag.current;
    if (!state) return;
    const x = state.lastX - state.startX + state.originLeft - element.offsetLeft;
    const y = state.lastY - state.startY + state.originTop - element.offsetTop;
    element.style.transform = `translate(${x}px, ${y}px) scale(1.06)`;
  }

  const onTilePointerDown = (favorite: FavoriteView) => (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || query) return;
    const element = tileEls.current.get(favorite.id);
    if (!element) return;
    drag.current = {
      id: favorite.id, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY,
      originLeft: element.offsetLeft, originTop: element.offsetTop, moved: false,
    };
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      if (!state.moved) {
        if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 5) return;
        state.moved = true;
        setMenu(undefined);
        setDraggingId(state.id);
        setDragOrder((snapshotRef.current?.favorites ?? []).map((favorite) => favorite.id));
      }
      const element = tileEls.current.get(state.id);
      if (element) positionDragged(element);
      // Hit-test against slots (offsets ignore running animations, so the
      // tile that just moved away cannot bounce straight back).
      const grid = gridRef.current;
      if (!grid) return;
      const box = grid.getBoundingClientRect();
      const px = event.clientX - box.left;
      const py = event.clientY - box.top;
      for (const [id, tile] of tileEls.current) {
        if (id === state.id) continue;
        if (px > tile.offsetLeft && px < tile.offsetLeft + tile.offsetWidth && py > tile.offsetTop && py < tile.offsetTop + tile.offsetHeight) {
          setDragOrder((order) => {
            if (!order) return order;
            const next = order.filter((item) => item !== state.id);
            next.splice(order.indexOf(id), 0, state.id);
            return next.join() === order.join() ? order : next;
          });
          break;
        }
      }
    };
    const onUp = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      drag.current = undefined;
      if (!state.moved) return;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      const element = tileEls.current.get(state.id);
      if (element) {
        element.style.transition = reducedMotion() ? "" : `transform 420ms ${SPRING}`;
        element.style.transform = "";
        setTimeout(() => { element.style.transition = ""; }, 440);
      }
      const order = dragOrderRef.current;
      setDraggingId(undefined);
      // Keep the dragged order on screen until the background confirms it.
      if (order) void reorderTo(order).finally(() => setDragOrder(undefined));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  });

  // ——— Keyboard ——————————————————————————————————————————————————————————

  const onInputKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    const selected = selectedIndex >= 0 ? favorites[selectedIndex] : undefined;

    if (plain && !event.shiftKey && !query && /^[1-9]$/.test(event.key)) {
      const favorite = favorites[Number(event.key) - 1];
      if (favorite) {
        event.preventDefault();
        void activate(favorite);
      }
      return;
    }
    const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (event.altKey && event.shiftKey && arrows.includes(event.key) && selected) {
      event.preventDefault();
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[event.key]!;
      const ids = shiftId(favorites.map((favorite) => favorite.id), selected.id, delta);
      void reorderTo(ids);
      return;
    }
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (arrows.includes(event.key) && plain && (!horizontal || !query || selected)) {
      event.preventDefault();
      setHoveredId(undefined);
      setSelectedId(favorites[moveSelection(event.key, selectedIndex, visible, cols)]?.id);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = selected ?? (query ? favorites[visible[0] ?? -1] : undefined);
      if (target) void activate(target);
      return;
    }
    if (event.key === "Escape" && (query || selected)) {
      // Keep the popup open: the first Escape only clears the filter.
      event.preventDefault();
      setQuery("");
      setSelectedId(undefined);
      return;
    }
    if (event.key === "F2") {
      const target = selected ?? favorites.find((favorite) => favorite.active);
      if (target) {
        event.preventDefault();
        openEditor(target.id);
      }
      return;
    }
    if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && selected) {
      event.preventDefault();
      const bounds = tileEls.current.get(selected.id)?.getBoundingClientRect();
      if (bounds) setMenu({ favoriteId: selected.id, x: bounds.left + 8, y: bounds.bottom + 4 });
    }
  };

  // ——— Render ——————————————————————————————————————————————————————————

  if (loadError && !snapshot) {
    return (
      <main class="shell" ref={rootRef}>
        <div class="fatal">
          <p>{loadError}</p>
          <button type="button" class="pill" onClick={() => void refresh()}>重试</button>
        </div>
      </main>
    );
  }

  const editing = editor ? byId(editor.favoriteId) : undefined;
  const menuFavorite = menu?.favoriteId ? byId(menu.favoriteId) : undefined;
  const contextFavorite = byId(context?.favoriteId);
  const max = snapshot?.maxFavorites ?? 12;

  return (
    <main class={`shell${snapshot ? "" : " is-loading"}`} ref={rootRef}>
      {editing ? (
        <Editor
          key={editing.id}
          favorite={editing}
          brand={brandOf(editing)}
          origin={editor?.origin}
          onSave={(changes) => saveEditor(editing.id, changes)}
          onRemove={() => void removeFavorite(editing)}
          onClose={closeEditor}
        />
      ) : (
        <>
          <label class={`omni${query ? " has-query" : ""}`}>
            <Icon name="search" />
            <input
              ref={inputRef}
              autoFocus
              value={query}
              placeholder="Favorites"
              role="combobox"
              aria-label="筛选 Favorites，或按 1–9 直接打开"
              aria-expanded="true"
              aria-controls="favorites-grid"
              aria-activedescendant={selectedId ? `fav-${selectedId}` : undefined}
              spellcheck={false}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setQuery(value);
                setHoveredId(undefined);
                if (!value) setSelectedId(undefined);
                else {
                  const q = value.trim().toLowerCase();
                  const first = favorites.find((favorite) => `${displayName(favorite)} ${displayUrl(favorite.homeUrl)}`.toLowerCase().includes(q));
                  setSelectedId(first?.id);
                }
              }}
              onKeyDown={onInputKeyDown}
            />
            {query ? <kbd class="esc">esc</kbd> : (
              <button
                type="button"
                class={`count${strays ? " has-alert" : ""}`}
                title="诊断与快捷键"
                aria-label={`${favorites.length} / ${max}，打开诊断与快捷键菜单`}
                aria-haspopup="menu"
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setMenu({ x: bounds.right, y: bounds.bottom + 6 });
                }}
              >
                {favorites.length} / {max}
              </button>
            )}
          </label>

          {snapshot && favorites.length === 0 ? (
            <section class="empty">
              <div class="empty-art" aria-hidden="true"><span /><span /><span /></div>
              <strong>把常用网站变成 App</strong>
              <p>添加下面的当前页面，或在 Chrome 里固定一个标签，它就会出现在这里。</p>
            </section>
          ) : (
            <div
              ref={gridRef}
              id="favorites-grid"
              class={`grid size-${size}${draggingId ? " is-sorting" : ""}`}
              style={{ "--cols": cols }}
              role="listbox"
              aria-label="Favorites"
              onPointerLeave={() => setHoveredId(undefined)}
            >
              {favorites.map((favorite, index) => (
                <Tile
                  key={favorite.id}
                  favorite={favorite}
                  index={index}
                  brand={brandOf(favorite)}
                  selected={favorite.id === selectedId}
                  hidden={!visible.includes(index)}
                  dragging={favorite.id === draggingId}
                  tileRef={(element) => {
                    if (element) tileEls.current.set(favorite.id, element);
                    else tileEls.current.delete(favorite.id);
                  }}
                  onBrand={learnBrand(favorite)}
                  onActivate={() => {
                    if (suppressClick.current) return;
                    void activate(favorite);
                  }}
                  onMenu={(x, y) => setMenu({ favoriteId: favorite.id, x, y })}
                  onHover={(hovering) => {
                    if (draggingId) return;
                    setHoveredId((current) => hovering ? favorite.id : current === favorite.id ? undefined : current);
                  }}
                  onPointerDown={onTilePointerDown(favorite)}
                />
              ))}
              {query && visible.length === 0 && <p class="no-match">没有匹配“{query}”的应用</p>}
            </div>
          )}

          {detailFavorite && (
            <DetailStrip
              favorite={detailFavorite}
              brand={brandOf(detailFavorite)}
              onSleep={() => void run(() => favoriteApi.sleepRuntime(detailFavorite.id), { success: "已休眠，点击即可唤醒" })}
              onClose={() => void run(() => favoriteApi.closeRuntime(detailFavorite.id), { success: "页面已关闭，入口保留" })}
              onMenu={(x, y) => setMenu({ favoriteId: detailFavorite.id, x, y })}
            />
          )}

          {strays > 0 && (
            <Banner>
              <span>发现 {strays} 个空白固定标签，可能是旧版本留下的</span>
              <button type="button" class="text-btn" onClick={() => void favoriteApi.closeStrayBlanks().then((count) => { setStrays(0); showToast(`已关闭 ${count} 个空白标签`); })}>
                关闭它们
              </button>
            </Banner>
          )}

          {context && (
            <ContextCard context={context} favorite={contextFavorite} max={max} busy={busy} onAction={onContextAction} />
          )}
        </>
      )}

      {menu && (
        <Menu
          key={`${menu.favoriteId ?? "meta"}-${menu.x}-${menu.y}`}
          items={menuFavorite ? favoriteMenu(menuFavorite) : metaMenu()}
          x={menu.x}
          y={menu.y}
          label={menuFavorite ? `管理 ${displayName(menuFavorite)}` : "诊断与快捷键"}
          rootRef={rootRef}
          onClose={() => setMenu(undefined)}
        />
      )}
      {toast && <Toast key={toast.id} toast={toast} onDone={() => setToast((current) => current?.id === toast.id ? undefined : current)} />}
    </main>
  );
}
