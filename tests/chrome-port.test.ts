import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChromeBrowserPort,
  confirmedBrokenPinnedPlaceholderIds,
  fromChromeTab,
  installGuardInPage,
  isBrokenPinnedPlaceholder,
  showSwitchHintInPage,
} from "../src/core/chrome-port";

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeChromeTab(overrides: Partial<chrome.tabs.Tab> & { id: number }): chrome.tabs.Tab {
  return {
    windowId: 1,
    index: 0,
    pinned: false,
    active: false,
    highlighted: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    groupId: -1,
    status: "complete",
    title: "",
    ...overrides,
  } as chrome.tabs.Tab;
}

describe("fromChromeTab", () => {
  it("uses pendingUrl for a lazy Chrome session-restore placeholder", () => {
    const restored = fromChromeTab({
      id: 42,
      windowId: 3,
      index: 0,
      active: false,
      pinned: true,
      highlighted: false,
      incognito: false,
      selected: false,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      groupId: -1,
      status: "loading",
      title: "",
      pendingUrl: "https://www.bilibili.com/",
    });

    expect(restored).toMatchObject({
      id: 42,
      url: "https://www.bilibili.com/",
      title: "www.bilibili.com",
      pending: true,
      status: "loading",
    });
  });

  it("prefers the known URL when Chrome reports about:blank", () => {
    const created = fromChromeTab(
      makeChromeTab({ id: 9, pinned: true, url: "about:blank" }),
      "https://mail.example.com/",
    );

    expect(created).toMatchObject({
      url: "https://mail.example.com/",
      pending: true,
    });
  });

  it("counts a navigation as pending only while the page has not committed", () => {
    expect(
      fromChromeTab(
        makeChromeTab({
          id: 11,
          url: "https://app.example.com/",
          pendingUrl: "https://app.example.com/next",
        }),
      )?.pending,
    ).toBe(false);

    expect(
      fromChromeTab(
        makeChromeTab({ id: 12, url: "about:blank", pendingUrl: "https://app.example.com/" }),
      )?.pending,
    ).toBe(true);
  });

  it("keeps an idle about:blank tab visible so the controller can repair it", () => {
    const blank = fromChromeTab(makeChromeTab({ id: 9, pinned: true, url: "about:blank" }));

    expect(blank?.url).toBe("about:blank");
  });

  it("keeps a newly created tab mapped when Chrome temporarily omits its URL", () => {
    const created = fromChromeTab(
      {
        id: 84,
        windowId: 3,
        index: 1,
        active: false,
        pinned: true,
        highlighted: false,
        incognito: false,
        selected: false,
        discarded: false,
        autoDiscardable: true,
        frozen: false,
        groupId: -1,
        status: "loading",
        title: "",
      },
      "https://www.youtube.com/",
    );

    expect(created).toMatchObject({
      id: 84,
      url: "https://www.youtube.com/",
      title: "www.youtube.com",
      pending: true,
    });
  });
});

describe("isBrokenPinnedPlaceholder", () => {
  const brokenBase: chrome.tabs.Tab = {
    id: 91,
    windowId: 3,
    index: 0,
    active: false,
    pinned: true,
    highlighted: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    groupId: -1,
    status: "loading",
  };

  it.each([undefined, "", "无标题", "Untitled"])(
    "recognizes a localized empty pinned placeholder (%s)",
    (title) => {
      expect(isBrokenPinnedPlaceholder({ ...brokenBase, title })).toBe(true);
    },
  );

  it("does not remove a valid Chrome restore placeholder", () => {
    expect(
      isBrokenPinnedPlaceholder({
        ...brokenBase,
        title: "无标题",
        pendingUrl: "https://www.bilibili.com/",
      }),
    ).toBe(false);
  });

  it("recognizes an idle blank pinned tab but not one that is still loading", () => {
    expect(
      isBrokenPinnedPlaceholder(
        makeChromeTab({ id: 93, pinned: true, active: false, url: "about:blank" }),
      ),
    ).toBe(true);
    expect(
      isBrokenPinnedPlaceholder(
        makeChromeTab({
          id: 94,
          pinned: true,
          active: false,
          url: "about:blank",
          pendingUrl: "https://www.bilibili.com/",
        }),
      ),
    ).toBe(false);
  });

  it("does not remove the active tab", () => {
    expect(isBrokenPinnedPlaceholder({ ...brokenBase, title: "无标题", active: true })).toBe(
      false,
    );
  });

  it("requires the same broken tab to remain broken across two scans", () => {
    const recovered = {
      ...brokenBase,
      id: 92,
      title: "Bilibili",
      url: "https://www.bilibili.com/",
      status: "complete" as const,
    };
    expect(
      confirmedBrokenPinnedPlaceholderIds(
        [brokenBase, { ...brokenBase, id: 92 }],
        [brokenBase, recovered],
      ),
    ).toEqual([91]);
  });
});

class FakeElement {}

class FakeAnchor extends FakeElement {
  readonly download = "";

  constructor(
    readonly href: string,
    readonly target: string,
    private readonly attributes: Set<string>,
  ) {
    super();
  }

  hasAttribute(name: string): boolean {
    return name === "href" || this.attributes.has(name);
  }
}

function runGuardClick(
  anchor: FakeAnchor,
  sendMessage: ReturnType<typeof vi.fn>,
  favoriteHosts: string[] = [],
  sameSiteInNewTab = false,
): { assign: ReturnType<typeof vi.fn>; preventDefault: ReturnType<typeof vi.fn> } {
  let clickListener: ((event: MouseEvent) => void) | undefined;
  const assign = vi.fn();
  vi.stubGlobal("window", {});
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLAnchorElement", FakeAnchor);
  vi.stubGlobal("location", { href: "https://app.example.com/", assign });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  vi.stubGlobal("document", {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      if (type === "click" && typeof listener === "function") {
        clickListener = listener as (event: MouseEvent) => void;
      }
    },
  });

  installGuardInPage("example.com", favoriteHosts, sameSiteInNewTab);
  const preventDefault = vi.fn();
  clickListener?.({
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: anchor,
    composedPath: () => [anchor],
    preventDefault,
    stopImmediatePropagation: vi.fn(),
  } as unknown as MouseEvent);
  return { assign, preventDefault };
}

describe("link guard in app-home mode", () => {
  it("opens a same-site page in a new tab before the site can navigate in place", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: "opened" });
    const anchor = new FakeAnchor("https://app.example.com/watch?v=42", "", new Set());

    const { assign, preventDefault } = runGuardClick(anchor, sendMessage, [], true);
    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({ type: "open-external", url: "https://app.example.com/watch?v=42", sameSite: true });
    expect(assign).not.toHaveBeenCalled();
  });

  it("follows the link in place when the background declines", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: "navigate" });
    const anchor = new FakeAnchor("https://app.example.com/watch?v=42", "", new Set());

    const { assign } = runGuardClick(anchor, sendMessage, [], true);
    await Promise.resolve();

    expect(assign).toHaveBeenCalledWith("https://app.example.com/watch?v=42");
  });

  it("leaves in-page anchors and the mode-off case alone", () => {
    const sendMessage = vi.fn();
    expect(runGuardClick(new FakeAnchor("https://app.example.com/#comments", "", new Set()), sendMessage, [], true).preventDefault).not.toHaveBeenCalled();
    expect(runGuardClick(new FakeAnchor("https://app.example.com/watch?v=1", "", new Set()), sendMessage, [], false).preventDefault).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("link guard", () => {
  it("leaves a value-less download link to Chrome", () => {
    const sendMessage = vi.fn();
    const anchor = new FakeAnchor("https://outside.test/file.zip", "", new Set(["download"]));

    const { assign, preventDefault } = runGuardClick(anchor, sendMessage);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("falls back to the original navigation when the tab is no longer managed", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: false });
    const anchor = new FakeAnchor("https://outside.test/article", "", new Set());

    const { assign, preventDefault } = runGuardClick(anchor, sendMessage);
    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("https://outside.test/article");
  });

  it("keeps the Favorite in place when the background opened the ordinary tab", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: "opened" });
    const anchor = new FakeAnchor("https://outside.test/article", "", new Set());

    const { assign } = runGuardClick(anchor, sendMessage);
    await Promise.resolve();

    expect(assign).not.toHaveBeenCalled();
  });

  it("falls back to the original navigation when messaging throws synchronously", () => {
    const sendMessage = vi.fn(() => {
      throw new Error("Extension context invalidated.");
    });
    const anchor = new FakeAnchor("https://outside.test/article", "", new Set());

    const { assign, preventDefault } = runGuardClick(anchor, sendMessage);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("https://outside.test/article");
  });

  it("falls back when sendMessage resolves without a response", async () => {
    const sendMessage = vi.fn().mockReturnValue(undefined);
    const anchor = new FakeAnchor("https://outside.test/article", "", new Set());

    const { assign } = runGuardClick(anchor, sendMessage);
    await Promise.resolve();
    await Promise.resolve();

    expect(assign).toHaveBeenCalledWith("https://outside.test/article");
  });

  it("hands links that belong to another Favorite to the background", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: "handled" });
    const anchor = new FakeAnchor("https://drive.example.com/file/7", "", new Set());

    const { assign, preventDefault } = runGuardClick(anchor, sendMessage, [
      "drive.example.com",
    ]);
    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({
      type: "route-link",
      url: "https://drive.example.com/file/7",
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("navigates in place when the background reports the app itself", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: "navigate" });
    const anchor = new FakeAnchor("https://drive.example.com/file/7", "", new Set());

    const { assign } = runGuardClick(anchor, sendMessage, ["drive.example.com"]);
    await Promise.resolve();

    expect(assign).toHaveBeenCalledWith("https://drive.example.com/file/7");
  });

  it("routes target=_blank links that point at another Favorite", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: "handled" });
    const anchor = new FakeAnchor("https://drive.example.com/file/7", "_blank", new Set());

    const { assign, preventDefault } = runGuardClick(anchor, sendMessage, [
      "drive.example.com",
    ]);
    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({
      type: "route-link",
      url: "https://drive.example.com/file/7",
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("falls back to in-place navigation when routing is unreachable", async () => {
    const sendMessage = vi.fn(() => {
      throw new Error("Extension context invalidated.");
    });
    const anchor = new FakeAnchor("https://drive.example.com/file/7", "", new Set());

    const { assign } = runGuardClick(anchor, sendMessage, ["drive.example.com"]);

    expect(assign).toHaveBeenCalledWith("https://drive.example.com/file/7");
  });
});

describe("discarding tabs safely", () => {
  it("never discards a new pinned tab before its page commits", async () => {
    vi.useFakeTimers();
    const pendingTab = makeChromeTab({
      id: 5,
      pinned: true,
      pendingUrl: "https://mail.example.com/",
      status: "loading",
    });
    const discard = vi.fn();
    vi.stubGlobal("chrome", {
      windows: { getLastFocused: vi.fn().mockRejectedValue(new Error("no window")) },
      tabs: {
        create: vi.fn().mockResolvedValue(pendingTab),
        discard,
        get: vi.fn().mockResolvedValue(pendingTab),
      },
    });

    const tab = await new ChromeBrowserPort().createPinnedTab("https://mail.example.com/", false, true);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(tab.url).toBe("https://mail.example.com/");
    expect(discard).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("puts a new pinned tab to sleep once its page has committed", async () => {
    vi.useFakeTimers();
    const created = makeChromeTab({ id: 6, pinned: true, pendingUrl: "https://mail.example.com/", status: "loading" });
    const committed = makeChromeTab({ id: 6, pinned: true, url: "https://mail.example.com/", status: "loading" });
    const discarded = makeChromeTab({ id: 6, pinned: true, url: "https://mail.example.com/", discarded: true });
    const get = vi.fn().mockResolvedValueOnce(created).mockResolvedValue(committed);
    const discard = vi.fn().mockImplementation(async () => {
      get.mockResolvedValue(discarded);
      return discarded;
    });
    const update = vi.fn();
    vi.stubGlobal("chrome", {
      windows: { getLastFocused: vi.fn().mockRejectedValue(new Error("no window")) },
      tabs: { create: vi.fn().mockResolvedValue(created), discard, get, update },
    });

    await new ChromeBrowserPort().createPinnedTab("https://mail.example.com/", false, true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(discard).toHaveBeenCalledWith(6);
    expect(update).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("navigates a tab that a discard left on about:blank back to its URL", async () => {
    const before = makeChromeTab({ id: 5, pinned: true, url: "https://mail.example.com/" });
    const blanked = makeChromeTab({ id: 5, pinned: true, url: "about:blank", discarded: true });
    const restored = makeChromeTab({ id: 5, pinned: true, pendingUrl: "https://mail.example.com/", status: "loading" });
    const update = vi.fn().mockResolvedValue(restored);
    vi.stubGlobal("chrome", {
      tabs: {
        discard: vi.fn().mockResolvedValue(blanked),
        get: vi.fn().mockResolvedValueOnce(before).mockResolvedValue(blanked),
        update,
      },
    });

    const tab = await new ChromeBrowserPort().discardTab(5);

    expect(update).toHaveBeenCalledWith(5, { url: "https://mail.example.com/" });
    expect(tab?.url).toBe("https://mail.example.com/");
  });
});

describe("switch hint", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("injects the page hint and clears the toolbar badge afterwards", async () => {
    vi.useFakeTimers();
    const executeScript = vi.fn().mockResolvedValue([]);
    const setBadgeText = vi.fn().mockResolvedValue(undefined);
    const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      scripting: { executeScript },
      action: { setBadgeText, setBadgeBackgroundColor },
    });

    await new ChromeBrowserPort().showSwitchHint(42);

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      func: showSwitchHintInPage,
    });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#1a73e8" });
    expect(setBadgeText).toHaveBeenCalledWith({ text: "↗" });

    await vi.advanceTimersByTimeAsync(2_600);

    expect(setBadgeText).toHaveBeenLastCalledWith({ text: "" });
  });
});

describe('native tab ordering', () => {
  it('reorders managed tabs in each window, preserving ordinary pinned slots', async () => {
    const windows = [
      [makeChromeTab({ id: 1, pinned: true, url: 'https://a.test/' }), makeChromeTab({ id: 9, pinned: true, url: 'https://unmanaged.test/' }), makeChromeTab({ id: 2, pinned: true, url: 'https://b.test/' })],
      [makeChromeTab({ id: 3, pinned: true, windowId: 2, url: 'https://c.test/' })],
    ];
    const moves: number[] = [];
    vi.stubGlobal('chrome', { tabs: {
      query: async () => windows.flatMap((tabs) => tabs.map((tab, index) => ({ ...tab, index }))),
      move: async (id: number, { index }: { index: number }) => {
        moves.push(id);
        const tabs = windows.find((tabs) => tabs.some((tab) => tab.id === id))!;
        const from = tabs.findIndex((tab) => tab.id === id);
        tabs.splice(index, 0, tabs.splice(from, 1)[0]!);
      },
    } });
    const port = new ChromeBrowserPort();
    await port.reorderPinnedTabs([2, 3, 1]);
    expect(windows.map((tabs) => tabs.map((tab) => tab.id))).toEqual([[2, 9, 1], [3]]);
    const count = moves.length;
    await port.reorderPinnedTabs([2, 3, 1]);
    expect(moves).toHaveLength(count);
  });

  it('marks only the last focused normal window active in the popup', async () => {
    const query = vi.fn().mockResolvedValue([]);
    vi.stubGlobal('chrome', { tabs: { query } });
    await new ChromeBrowserPort().getActiveTabs();
    expect(query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true, windowType: 'normal' });
  });
});
