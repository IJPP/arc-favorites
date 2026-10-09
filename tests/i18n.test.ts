import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dictionaries, setLocale, t } from "../src/core/i18n";

afterEach(() => setLocale("zh"));

describe("i18n", () => {
  it("has every message in both languages, with the same placeholders", () => {
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    expect(Object.keys(dictionaries.zh).sort()).toEqual(Object.keys(dictionaries.en).sort());
    for (const key of Object.keys(dictionaries.en) as (keyof typeof dictionaries.en)[]) {
      expect(placeholders(dictionaries.zh[key]), key).toEqual(placeholders(dictionaries.en[key]));
    }
  });

  it("fills placeholders and switches language", () => {
    setLocale("en");
    expect(t("errLimit", { max: 12 })).toBe("You can add up to 12 Favorites");
    setLocale("zh");
    expect(t("errLimit", { max: 12 })).toBe("最多只能添加 12 个 Favorite");
  });

  it("defaults to English unless Chrome's UI language is Chinese", async () => {
    for (const [language, expected] of [["en-US", "Open"], ["fr", "Open"], ["zh-CN", "打开"], ["zh-TW", "打开"]] as const) {
      vi.resetModules();
      vi.stubGlobal("chrome", { i18n: { getUILanguage: () => language } });
      const fresh = await import("../src/core/i18n");
      expect(fresh.t("open"), language).toBe(expected);
    }
    vi.unstubAllGlobals();
  });

  it("localizes the manifest in both languages", () => {
    const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8"));
    expect(manifest.default_locale).toBe("en");
    for (const locale of ["en", "zh_CN"]) {
      const messages = JSON.parse(readFileSync(`public/_locales/${locale}/messages.json`, "utf8"));
      for (const field of [manifest.name, manifest.description, manifest.action.default_title]) {
        expect(messages[field.replace(/^__MSG_|__$/g, "")]?.message, `${locale} ${field}`).toBeTruthy();
      }
    }
  });
});
