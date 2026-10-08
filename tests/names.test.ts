import { describe, expect, it } from "vitest";
import { appNameFromTitle, cleanDeclaredName } from "../src/core/names";

describe("appNameFromTitle", () => {
  it.each([
    ["首页-个性推荐-哔哩哔哩", "https://www.bilibili.com/", "哔哩哔哩"],
    ["Inbox (3) - me@example.com - Gmail", "https://mail.google.com/", "Gmail"],
    ["(12) YouTube", "https://www.youtube.com/", "YouTube"],
    ["www.youtube.com", "https://www.youtube.com/", "Youtube"],
    ["Notion – The all-in-one workspace", "https://www.notion.so/", "Notion"],
    ["X-Men", "https://example.com/", "X-Men"],
    ["Pull requests · octo/repo · GitHub", "https://github.com/pulls", "GitHub"],
    ["", "https://linear.app/", "Linear"],
    ["少数派 - 高效工作，品质生活", "https://sspai.com/", "少数派"],
    ["How we build things - Medium", "https://medium.com/x", "Medium"],
  ])("%s → %s", (title, url, expected) => {
    expect(appNameFromTitle(title, url)).toBe(expected);
  });
});

describe("cleanDeclaredName", () => {
  it("accepts short names and rejects junk", () => {
    expect(cleanDeclaredName("  YouTube ")).toBe("YouTube");
    expect(cleanDeclaredName("")).toBeUndefined();
    expect(cleanDeclaredName(42)).toBeUndefined();
    expect(cleanDeclaredName("x".repeat(80))).toBeUndefined();
  });
});
