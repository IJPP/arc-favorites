/**
 * UI strings for the popup, the background and error messages. English is the
 * default; Chinese is used when Chrome's UI language is Chinese. Manifest
 * fields (name, description) live in public/_locales instead.
 */
const en = {
  // Errors
  errUnknown: "Something went wrong",
  errSiteExists: "This site is already a Favorite",
  errLimit: "You can add up to {max} Favorites",
  errInvalidOrder: "Invalid Favorite order",
  errInvalidUrl: "Enter a full http or https address",
  errUnsupportedUrl: "Only http and https pages can be Favorites",
  errUrlCredentials: "Addresses can't contain a username or password",
  errUnsupportedPage: "This page can't be added as a Favorite",
  errAlreadyFavorite: "This tab is already a Favorite",
  errPinFailed: "Chrome couldn't pin this tab. Reload the page and try again",
  errTabInUse: "Switch away and pause playback before putting this Favorite to sleep",
  errDiscardFailed: "Chrome can't put this tab to sleep right now. Try again later",
  errNotFound: "This Favorite no longer exists",
  errNotRunning: "Open this Favorite first",
  errUnpinFailed: "Chrome couldn't unpin the tab. Try again later",
  errInvalidLink: "This link can't be opened",
  errUnmanagedTab: "This page isn't a managed Favorite",
  errUnknownMessage: "Unknown action",
  errUnauthorized: "Rejected a message from outside the extension",
  errNoResponse: "The background didn't respond. Reload the extension",
  errNoTab: "Chrome didn't return the new tab",

  // Background
  menuAddCurrent: "Add to Favorites (pin tab)",
  switchHint: "Switched to your existing Favorite",

  // States
  stateClosed: "Not open",
  stateSleeping: "Asleep",
  stateLoading: "Loading",
  statePlaying: "Playing",
  stateCurrent: "Open now",
  stateRunning: "Running",
  shortCurrent: "Current",
  shortPlaying: "Playing",
  shortRunning: "Running",

  // Popup: header, grid, empty
  filterLabel: "Filter Favorites, or press 1–9 to open",
  filterPlaceholder: "Favorites",
  countLabel: "{count} / {max}, open diagnostics and shortcuts",
  metaTitle: "Diagnostics and shortcuts",
  emptyTitle: "Turn your everyday sites into apps",
  emptyBody: "Add the current page below, or pin a tab in Chrome, and it shows up here.",
  noMatch: "No app matches “{query}”",
  retry: "Retry",
  manage: "Manage {name}",

  // Detail strip
  current: "current",
  sleepTitle: "Sleep, keep the entry",
  sleepBlocked: "Can't sleep the current page or one that's playing",
  sleep: "Sleep",
  closePageTitle: "Close the page, keep the entry",
  closePage: "Close page",
  more: "More",

  // Context card
  browserPage: "Browser page",
  browserPageNote: "Chrome's own pages can't be Favorites",
  usingNow: "Using {name}",
  usingNowNote: "This tab is its Favorite",
  edit: "Edit",
  leftHome: "Away from home",
  backHome: "Back to home",
  setHome: "Set as home",
  alreadyFavorite: "{name} is already a Favorite",
  sameSiteNote: "Another tab on the same site",
  switchTo: "Switch",
  listFull: "Full ({max}). Remove one first",
  currentPage: "current page",
  add: "Add",

  // Menus
  switchHere: "Switch here",
  open: "Open",
  setCurrentAsHome: "Use current page as home",
  editEllipsis: "Edit…",
  remove: "Remove",
  closeBlanks: "Close {count} blank pinned tabs",
  noBlanks: "No blank pinned tabs",
  copyDiagnostics: "Copy diagnostics",
  shortcutsNote: "1–9 open · arrows select · ↵ open\nF2 edit · ⇧F10 menu · ⌥⇧ + arrows reorder",

  // Banners
  noAccess: "Chrome hasn't allowed access to {sites}, so link handling is off",
  allow: "Allow",
  blanksFound: "Found {count} blank pinned tabs, likely left by an older version",
  closeThem: "Close them",
  listSeparator: ", ",

  // Toasts
  refreshFailed: "Couldn't refresh",
  loadFailed: "Couldn't load Favorites",
  actionFailed: "Something went wrong",
  saved: "Saved",
  removedKeepPage: "Removed {name}; the page stays as a normal tab",
  removed: "Removed {name}",
  existingSwitched: "This site is already a Favorite. Switched to it",
  adopted: "Took over this tab for the existing Favorite",
  added: "Added “{name}”",
  rename: "Rename",
  addFailed: "Couldn't add",
  reordered: "Order synced to pinned tabs",
  wentHome: "Back home",
  homeUpdated: "Home updated",
  slept: "Asleep. Click to wake it",
  pageClosed: "Page closed, entry kept",
  blanksClosed: "Closed {count} blank tabs",
  diagnosticsCopied: "Diagnostics copied (local records only)",
  copyFailed: "Couldn't copy",
  accessGranted: "Allowed. Link handling is on",
  accessDenied: "Chrome denied the request: {error}",
  accessNotGranted: "Chrome didn't grant access",

  // Editor
  editTitle: "Edit {name}",
  name: "Name",
  nameCustom: "Custom name · clear to use the site's name",
  nameAuto: "Using the site's own name",
  close: "Close",
  closeEsc: "Close (Esc)",
  icon: "Icon",
  iconPlaceholder: "Leave empty for the site icon, or type an emoji",
  startPage: "Home page",
  useCurrent: "Use current",
  guardTitle: "Open other sites in a new tab",
  guardOnAppHome: "On: links to other sites open in a new tab",
  guardOn: "On: links within {site} stay here; other sites open in a new tab",
  guardOff: "Off: every link opens in this tab, like a normal page",
  appHomeTitle: "Open in-site links in a new tab too",
  appHomeNeedsGuard: "Turn on the switch above first",
  appHomeOn: "On: like an app home, videos and articles open in new tabs and this tab stays put",
  appHomeOff: "Off: links within {site} keep browsing in this tab",
  removeConfirm: "Click again to remove",
  cancel: "Cancel",
  save: "Save",
  saving: "Saving…",
  saveFailed: "Couldn't save",
};

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  errUnknown: "发生了未知错误",
  errSiteExists: "这个站点已经是 Favorite 了",
  errLimit: "最多只能添加 {max} 个 Favorite",
  errInvalidOrder: "Favorite 排序数据无效",
  errInvalidUrl: "请输入完整的 http 或 https 网址",
  errUnsupportedUrl: "只能将 http 或 https 页面添加为 Favorite",
  errUrlCredentials: "网址不能包含用户名或密码",
  errUnsupportedPage: "当前页面不能添加为 Favorite",
  errAlreadyFavorite: "当前标签已经是 Favorite",
  errPinFailed: "Chrome 无法固定这个标签，请重新打开页面后再试",
  errTabInUse: "请先切换到其他标签并暂停播放，再让这个 Favorite 休眠",
  errDiscardFailed: "Chrome 暂时无法休眠这个标签，请稍后再试",
  errNotFound: "找不到这个 Favorite",
  errNotRunning: "请先打开这个 Favorite",
  errUnpinFailed: "Chrome 无法取消固定，请稍后再试",
  errInvalidLink: "无法打开这个外部链接",
  errUnmanagedTab: "该页面不是受管理的 Favorite",
  errUnknownMessage: "无法识别该操作",
  errUnauthorized: "已拒绝非扩展来源的消息",
  errNoResponse: "后台没有响应，请重新加载扩展",
  errNoTab: "Chrome 没有返回新建标签的信息",

  menuAddCurrent: "加入 Favorites（固定标签页）",
  switchHint: "已切换到已有 Favorite",

  stateClosed: "未打开",
  stateSleeping: "已休眠",
  stateLoading: "加载中",
  statePlaying: "正在播放",
  stateCurrent: "当前打开",
  stateRunning: "正在运行",
  shortCurrent: "当前",
  shortPlaying: "播放中",
  shortRunning: "运行中",

  filterLabel: "筛选 Favorites，或按 1–9 直接打开",
  filterPlaceholder: "Favorites",
  countLabel: "{count} / {max}，打开诊断与快捷键菜单",
  metaTitle: "诊断与快捷键",
  emptyTitle: "把常用网站变成 App",
  emptyBody: "添加下面的当前页面，或在 Chrome 里固定一个标签，它就会出现在这里。",
  noMatch: "没有匹配“{query}”的应用",
  retry: "重试",
  manage: "管理 {name}",

  current: "当前",
  sleepTitle: "休眠，保留入口",
  sleepBlocked: "当前页面或正在播放时不能休眠",
  sleep: "休眠",
  closePageTitle: "关闭页面，保留入口",
  closePage: "关闭页面",
  more: "更多",

  browserPage: "浏览器页面",
  browserPageNote: "浏览器自带页面不能加入 Favorites",
  usingNow: "正在使用 {name}",
  usingNowNote: "这个标签就是它的 Favorite",
  edit: "编辑",
  leftHome: "已离开初始页面",
  backHome: "回到初始页面",
  setHome: "设为初始页",
  alreadyFavorite: "{name} 已在 Favorites",
  sameSiteNote: "这是同一网站的另一个标签",
  switchTo: "切换过去",
  listFull: "已满 {max} 个，先移除一个",
  currentPage: "当前页面",
  add: "添加",

  switchHere: "切换到这里",
  open: "打开",
  setCurrentAsHome: "把当前页面设为初始页面",
  editEllipsis: "编辑…",
  remove: "移除",
  closeBlanks: "关闭 {count} 个空白固定标签",
  noBlanks: "没有空白固定标签",
  copyDiagnostics: "复制诊断信息",
  shortcutsNote: "1–9 打开 · 方向键选择 · ↵ 打开\nF2 编辑 · ⇧F10 菜单 · ⌥⇧ + 方向键 排序",

  noAccess: "Chrome 未允许访问 {sites}，链接分流不会生效",
  allow: "允许",
  blanksFound: "发现 {count} 个空白固定标签，可能是旧版本留下的",
  closeThem: "关闭它们",
  listSeparator: "、",

  refreshFailed: "无法刷新",
  loadFailed: "无法加载 Favorites",
  actionFailed: "操作失败",
  saved: "已保存",
  removedKeepPage: "已移除 {name}，页面保留为普通标签",
  removed: "已移除 {name}",
  existingSwitched: "这个网站已在 Favorites，已切换过去",
  adopted: "已接管这个标签，作为已有 Favorite 的实例",
  added: "已添加「{name}」",
  rename: "改名",
  addFailed: "添加失败",
  reordered: "顺序已同步到固定标签",
  wentHome: "已回到初始页面",
  homeUpdated: "初始页面已更新",
  slept: "已休眠，点击即可唤醒",
  pageClosed: "页面已关闭，入口保留",
  blanksClosed: "已关闭 {count} 个空白标签",
  diagnosticsCopied: "诊断信息已复制，只含本机记录",
  copyFailed: "复制失败",
  accessGranted: "已允许，链接分流立即生效",
  accessDenied: "Chrome 拒绝了请求：{error}",
  accessNotGranted: "Chrome 没有授予访问权限",

  editTitle: "编辑 {name}",
  name: "名称",
  nameCustom: "自定义名称 · 清空即恢复网站名",
  nameAuto: "使用网站自己的名称",
  close: "关闭",
  closeEsc: "关闭 (Esc)",
  icon: "图标",
  iconPlaceholder: "留空使用网站图标，或输入一个 Emoji",
  startPage: "初始页面",
  useCurrent: "用当前页",
  guardTitle: "其他网站的链接另开标签",
  guardOnAppHome: "开：去其他网站的链接在新的普通标签打开",
  guardOn: "开：{site} 内的链接留在这里，去其他网站的链接在新的普通标签打开",
  guardOff: "关：所有链接都在这个标签里打开，和普通网页一样",
  appHomeTitle: "站内链接也开新标签",
  appHomeNeedsGuard: "需要先打开上面的开关",
  appHomeOn: "开：像 App 主页一样，点开视频、文章会进入新标签，这里停在原处",
  appHomeOff: "关：在 {site} 内点链接，就在这个标签里继续浏览",
  removeConfirm: "再点一次移除",
  cancel: "取消",
  save: "保存",
  saving: "保存中…",
  saveFailed: "保存失败",
};

export const dictionaries = { en, zh } as const;
export type Locale = keyof typeof dictionaries;

function detectLocale(): Locale {
  const params = globalThis.location?.search ? new URLSearchParams(globalThis.location.search) : undefined;
  const requested = params?.get("lang");
  const language =
    requested ??
    globalThis.chrome?.i18n?.getUILanguage?.() ??
    globalThis.navigator?.language ??
    "en";
  return /^zh\b/i.test(language) ? "zh" : "en";
}

let locale: Locale = detectLocale();

export function getLocale(): Locale {
  return locale;
}

/** Tests and previews pin a language explicitly. */
export function setLocale(next: Locale): void {
  locale = next;
}

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = dictionaries[locale][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
