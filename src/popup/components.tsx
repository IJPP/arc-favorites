import type { ComponentChildren, JSX, RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { appNameFromTitle } from "../core/names";
import { siteKeyForUrl } from "../core/url";
import type { CurrentTabContext, FavoriteView, UpdateFavoriteInput } from "../core/types";
import { favoriteApi } from "./api";
import { displayName, displayUrl, favoriteState, shortState, tileState } from "./view";
import { t } from "../core/i18n";

export const SPRING =
  "linear(0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%, 0.721 25.3%, 0.849 31.5%, 0.937 38.1%, 0.968 41.8%, 0.991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001 85.9%, 1)";
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ——— Icons ——————————————————————————————————————————————————————————————————

const paths = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></>,
  open: <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  home: <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
  pin: <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  plus: <path d="M12 5v14M5 12h14" />,
  broom: <path d="M14 4 9 13M6 13h8l2 7H4zM9 17v3M12 17v3" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  keyboard: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></>,
};
export type IconName = keyof typeof paths | "more" | "audio";

export function Icon({ name }: { name: IconName }) {
  if (name === "more") {
    return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="18.5" r="1.8" /></svg>;
  }
  if (name === "audio") {
    return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" /></svg>;
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

// ——— App icon ——————————————————————————————————————————————————————————————

export function AppIcon(props: { pageUrl: string; label: string; emoji?: string; onBrand?: (image: HTMLImageElement) => void }) {
  const [failed, setFailed] = useState(false);
  if (props.emoji) return <span class="emoji" aria-hidden="true">{props.emoji}</span>;
  if (failed) return <span class="letter" aria-hidden="true">{props.label.slice(0, 1).toUpperCase()}</span>;
  return (
    <img
      src={favoriteApi.faviconUrl(props.pageUrl)}
      alt=""
      draggable={false}
      onLoad={(event) => props.onBrand?.(event.currentTarget)}
      onError={() => setFailed(true)}
    />
  );
}

// ——— Tile ——————————————————————————————————————————————————————————————————

export function Tile(props: {
  favorite: FavoriteView;
  index: number;
  brand: string;
  selected: boolean;
  hidden: boolean;
  dragging: boolean;
  tileRef: (element: HTMLDivElement | null) => void;
  onBrand: (image: HTMLImageElement) => void;
  onActivate: () => void;
  onMenu: (x: number, y: number, fromButton: boolean) => void;
  onHover: (hovering: boolean) => void;
  onPointerDown: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
}) {
  const { favorite } = props;
  const name = displayName(favorite);
  const state = tileState(favorite);
  const pageUrl = favorite.runtime?.currentUrl ?? favorite.lastKnownUrl ?? favorite.homeUrl;
  const classes = [
    "tile",
    favorite.active && state !== "sleeping" ? "is-active" : "",
    props.selected ? "is-selected" : "",
    props.hidden ? "is-hidden" : "",
    props.dragging ? "is-dragging" : "",
  ].join(" ");
  return (
    <div
      ref={props.tileRef}
      class={classes}
      data-state={state}
      style={{ "--brand": props.brand }}
      onPointerEnter={() => props.onHover(true)}
      onPointerLeave={() => props.onHover(false)}
    >
      <button
        type="button"
        class="face"
        id={`fav-${favorite.id}`}
        role="option"
        aria-selected={props.selected}
        aria-label={`${name}，${favoriteState(favorite)}`}
        title={`${name} · ${favoriteState(favorite)}\n${displayUrl(pageUrl)}`}
        tabIndex={-1}
        onClick={props.onActivate}
        onPointerDown={props.onPointerDown}
        onMouseDown={(event) => event.preventDefault()}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onMenu(event.clientX, event.clientY, false);
        }}
      >
        {props.index < 9 && <span class="num" aria-hidden="true">{props.index + 1}</span>}
        <span class="icon">
          <span class="glow" />
          <AppIcon pageUrl={pageUrl} label={name} emoji={favorite.customIcon} onBrand={props.onBrand} />
          <span class="badge" aria-hidden="true">{state === "audible" && <Icon name="audio" />}</span>
        </span>
        <span class="name">{name}</span>
        <span class="state">{shortState(favorite)}</span>
        <span class="bar" />
      </button>
      <button
        type="button"
        class="more"
        tabIndex={-1}
        aria-label={t("manage", { name })}
        aria-haspopup="menu"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          props.onMenu(bounds.right, bounds.bottom + 4, true);
        }}
      >
        <Icon name="more" />
      </button>
    </div>
  );
}

// ——— Detail strip ——————————————————————————————————————————————————————————

export function DetailStrip(props: {
  favorite: FavoriteView;
  brand: string;
  onSleep: () => void;
  onClose: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const { favorite } = props;
  const state = tileState(favorite);
  const live = state !== "closed";
  const url = favorite.runtime?.currentUrl ?? favorite.homeUrl;
  const canSleep = live && state !== "sleeping" && state !== "audible" && !favorite.active;
  return (
    <div class="detail" data-state={state} style={{ "--brand": props.brand }} aria-live="polite">
      <span class="dot" aria-hidden="true" />
      <div class="meta" key={favorite.id}>
        <strong>{displayName(favorite)}{favorite.active && live ? <em> · {t("current")}</em> : null}</strong>
        <small>{favoriteState(favorite)} · {displayUrl(url)}</small>
      </div>
      <button type="button" class="icon-btn" title={canSleep ? t("sleepTitle") : t("sleepBlocked")} aria-label={t("sleep")} disabled={!canSleep} onClick={props.onSleep}>
        <Icon name="moon" />
      </button>
      <button type="button" class="icon-btn" title={t("closePageTitle")} aria-label={t("closePage")} disabled={!live} onClick={props.onClose}>
        <Icon name="close" />
      </button>
      <button
        type="button"
        class="icon-btn"
        title={t("more")}
        aria-label={t("manage", { name: displayName(favorite) })}
        aria-haspopup="menu"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          props.onMenu(bounds.right, bounds.top - 4);
        }}
      >
        <Icon name="more" />
      </button>
    </div>
  );
}

// ——— Context card ——————————————————————————————————————————————————————————

export type ContextAction = "add" | "edit" | "home" | "set-home" | "switch";

export function ContextCard(props: {
  context: CurrentTabContext;
  favorite?: FavoriteView;
  max: number;
  busy: boolean;
  onAction: (action: ContextAction) => void;
}) {
  const { context, favorite } = props;
  const pageIcon = context.url && /^https?:/.test(context.url)
    ? <AppIcon pageUrl={context.url} label={context.title ?? "?"} />
    : <span class="letter">·</span>;

  if (context.kind === "unsupported") {
    return (
      <div class="ctx is-quiet">
        <span class="ctx-icon">{pageIcon}</span>
        <div class="meta"><strong>{context.title || t("browserPage")}</strong><small>{t("browserPageNote")}</small></div>
      </div>
    );
  }
  if (context.kind === "favorite" && favorite) {
    const name = displayName(favorite);
    return context.atHome ? (
      <div class="ctx is-own">
        <span class="ctx-icon">{pageIcon}</span>
        <div class="meta"><strong>{t("usingNow", { name })}</strong><small>{t("usingNowNote")}</small></div>
        <button type="button" class="pill tonal" onClick={() => props.onAction("edit")}>{t("edit")}</button>
      </div>
    ) : (
      <div class="ctx is-own">
        <span class="ctx-icon">{pageIcon}</span>
        <div class="meta"><strong>{t("leftHome")}</strong><small>{displayUrl(context.url ?? "")}</small></div>
        <button type="button" class="icon-btn" title={t("backHome")} aria-label={t("backHome")} disabled={props.busy} onClick={() => props.onAction("home")}>
          <Icon name="home" />
        </button>
        <button type="button" class="pill tonal" disabled={props.busy} onClick={() => props.onAction("set-home")}>{t("setHome")}</button>
      </div>
    );
  }
  if (context.kind === "same-site" && favorite) {
    return (
      <div class="ctx is-own">
        <span class="ctx-icon">{pageIcon}</span>
        <div class="meta"><strong>{t("alreadyFavorite", { name: displayName(favorite) })}</strong><small>{t("sameSiteNote")}</small></div>
        <button type="button" class="pill tonal" disabled={props.busy} onClick={() => props.onAction("switch")}>{t("switchTo")}</button>
      </div>
    );
  }
  const full = context.kind === "full";
  const name = appNameFromTitle(context.title, context.url ?? "https://example.com/");
  return (
    <div class="ctx is-addable">
      <span class="ctx-icon">{pageIcon}</span>
      <div class="meta">
        <strong>{name}</strong>
        <small>{full ? t("listFull", { max: props.max }) : `${displayUrl(context.url ?? "")} · ${t("currentPage")}`}</small>
      </div>
      <button type="button" class="pill" disabled={full || props.busy} onClick={() => props.onAction("add")}>
        <Icon name="plus" />{t("add")}
      </button>
    </div>
  );
}

// ——— Menu ——————————————————————————————————————————————————————————————————

export type MenuItem =
  | { kind: "action"; icon: IconName; label: string; run: () => void; disabled?: boolean; danger?: boolean; hint?: string }
  | { kind: "separator" }
  | { kind: "note"; text: string };

export function Menu(props: {
  items: MenuItem[];
  x: number;
  y: number;
  label: string;
  rootRef: RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number; origin: string }>();

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const root = props.rootRef.current;
    if (!menu || !root) return;
    const box = root.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    // Reserve room so Chrome grows the popup instead of clipping the menu.
    root.style.minHeight = `${Math.max(box.height, height + 16)}px`;
    const bottom = Math.max(box.height, height + 16);
    let left = props.x - box.left;
    let top = props.y - box.top;
    const flipX = left + width > box.width - 8;
    const flipY = top + height > bottom - 8;
    if (flipX) left = left - width;
    if (flipY) top = top - height;
    setPlacement({
      left: Math.max(8, Math.min(left, box.width - width - 8)),
      top: Math.max(8, Math.min(top, bottom - height - 8)),
      origin: `${flipY ? "bottom" : "top"} ${flipX ? "right" : "left"}`,
    });
    return () => { root.style.minHeight = ""; };
  }, []);

  useEffect(() => {
    if (!placement) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [placement]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) props.onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, []);

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div
      ref={menuRef}
      class="menu"
      role="menu"
      aria-label={props.label}
      onKeyDown={onKeyDown}
      style={placement
        ? { left: `${placement.left}px`, top: `${placement.top}px`, transformOrigin: placement.origin }
        : { visibility: "hidden", left: "0", top: "0" }}
    >
      {props.items.map((item, index) => {
        if (item.kind === "separator") return <hr key={index} />;
        if (item.kind === "note") return <p key={index} class="menu-note">{item.text}</p>;
        return (
          <button
            key={index}
            type="button"
            role="menuitem"
            class={item.danger ? "danger" : undefined}
            disabled={item.disabled}
            onClick={() => {
              props.onClose();
              item.run();
            }}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.hint && <kbd>{item.hint}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

// ——— Editor ————————————————————————————————————————————————————————————————

export function Editor(props: {
  favorite: FavoriteView;
  brand: string;
  origin?: DOMRect;
  onSave: (changes: UpdateFavoriteInput) => Promise<void>;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { favorite } = props;
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(favorite.customTitle ?? "");
  const [emoji, setEmoji] = useState(favorite.customIcon ?? "");
  const [homeUrl, setHomeUrl] = useState(favorite.homeUrl);
  const [guard, setGuard] = useState(favorite.guardEnabled);
  const [appHome, setAppHome] = useState(Boolean(favorite.sameSiteInNewTab));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const autoName = favorite.appName || appNameFromTitle(favorite.title, favorite.homeUrl);
  const currentUrl = favorite.runtime?.currentUrl;
  let siteLabel = favorite.siteKey;
  // The guard works per registrable domain (mail.google.com → google.com).
  try { siteLabel = siteKeyForUrl(homeUrl); } catch { /* Keep the saved site while typing. */ }
  const canUseCurrent = Boolean(currentUrl && currentUrl !== homeUrl && /^https?:/.test(currentUrl));

  // Grow out of the tile that was edited.
  useLayoutEffect(() => {
    const form = formRef.current;
    if (form && props.origin && !reducedMotion()) {
      const box = form.getBoundingClientRect();
      const o = props.origin;
      const inset = [o.top - box.top, box.right - o.right, box.bottom - o.bottom, o.left - box.left]
        .map((value) => `${Math.max(0, value)}px`).join(" ");
      form.animate(
        [{ clipPath: `inset(${inset} round 12px)`, opacity: 0.6 }, { clipPath: "inset(0 round 12px)", opacity: 1 }],
        { duration: 420, easing: SPRING },
      );
    }
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!confirmRemove) return;
    const timer = setTimeout(() => setConfirmRemove(false), 3_000);
    return () => clearTimeout(timer);
  }, [confirmRemove]);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await props.onSave({ customTitle: name, customIcon: emoji, homeUrl, guardEnabled: guard, sameSiteInNewTab: appHome });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("saveFailed"));
      setSaving(false);
    }
  };

  return (
    <form
      ref={formRef}
      class="editor"
      style={{ "--brand": props.brand }}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        }
      }}
      aria-label={t("editTitle", { name: displayName(favorite) })}
    >
      <header class="editor-head">
        <span class="editor-icon">
          <span class="glow" />
          <AppIcon pageUrl={favorite.homeUrl} label={name || autoName} emoji={emoji.trim() || undefined} />
        </span>
        <div class="editor-title">
          <input
            ref={nameRef}
            class="name-input"
            value={name}
            placeholder={autoName}
            maxLength={120}
            aria-label={t("name")}
            onInput={(event) => setName(event.currentTarget.value)}
          />
          <small>{name ? t("nameCustom") : t("nameAuto")}</small>
        </div>
        <button type="button" class="icon-btn" aria-label={t("close")} title={t("closeEsc")} onClick={props.onClose}>
          <Icon name="close" />
        </button>
      </header>

      <label class="field">
        <span>{t("icon")}</span>
        <input
          class="text-input"
          value={emoji}
          placeholder={t("iconPlaceholder")}
          maxLength={32}
          onInput={(event) => setEmoji(event.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>{t("startPage")}</span>
        <span class="input-row">
          <input
            class="text-input"
            type="url"
            value={homeUrl}
            spellcheck={false}
            onInput={(event) => setHomeUrl(event.currentTarget.value)}
          />
          {canUseCurrent && (
            <button type="button" class="text-btn" title={currentUrl} onClick={() => setHomeUrl(currentUrl!)}>{t("useCurrent")}</button>
          )}
        </span>
      </label>

      <label class="switch-row">
        <span>
          <strong>{t("guardTitle")}</strong>
          <small>
            {guard
              ? appHome
                ? t("guardOnAppHome")
                : t("guardOn", { site: siteLabel })
              : t("guardOff")}
          </small>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={guard} onChange={(event) => setGuard(event.currentTarget.checked)} />
      </label>

      <label class={`switch-row${guard ? "" : " is-disabled"}`}>
        <span>
          <strong>{t("appHomeTitle")}</strong>
          <small>
            {!guard
              ? t("appHomeNeedsGuard")
              : appHome
                ? t("appHomeOn")
                : t("appHomeOff", { site: siteLabel })}
          </small>
        </span>
        <input type="checkbox" role="switch" class="switch" disabled={!guard} checked={guard && appHome} onChange={(event) => setAppHome(event.currentTarget.checked)} />
      </label>

      {error && <p class="inline-error" role="alert">{error}</p>}

      <footer class="editor-foot">
        <button
          type="button"
          class={`danger-btn${confirmRemove ? " is-armed" : ""}`}
          onClick={() => confirmRemove ? props.onRemove() : setConfirmRemove(true)}
        >
          <Icon name="trash" />{confirmRemove ? t("removeConfirm") : t("remove")}
        </button>
        <span class="spacer" />
        <button type="button" class="pill tonal" onClick={props.onClose}>{t("cancel")}</button>
        <button type="submit" class="pill" disabled={saving}>{saving ? t("saving") : t("save")}</button>
      </footer>
    </form>
  );
}

// ——— Toast ————————————————————————————————————————————————————————————————

export interface ToastState {
  id: number;
  text: string;
  error?: boolean;
  action?: { label: string; run: () => void };
}

export function Toast(props: { toast: ToastState; onDone: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = requestAnimationFrame(() => setVisible(true));
    const hide = setTimeout(() => setVisible(false), props.toast.action ? 4_200 : 2_600);
    const done = setTimeout(props.onDone, props.toast.action ? 4_500 : 2_900);
    return () => { cancelAnimationFrame(show); clearTimeout(hide); clearTimeout(done); };
  }, [props.toast.id]);
  return (
    <div class={`toast${props.toast.error ? " is-error" : ""}${visible ? " is-visible" : ""}`} role={props.toast.error ? "alert" : "status"}>
      <span>{props.toast.text}</span>
      {props.toast.action && (
        <button type="button" onClick={() => { props.toast.action!.run(); props.onDone(); }}>{props.toast.action.label}</button>
      )}
    </div>
  );
}

export function Banner(props: { children: ComponentChildren }) {
  return <div class="banner" role="status">{props.children}</div>;
}
