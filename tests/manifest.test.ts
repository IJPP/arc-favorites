import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Manifest {
  manifest_version: number;
  minimum_chrome_version: string;
  permissions: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  background?: { service_worker?: string; type?: string };
  side_panel?: { default_path?: string };
  action?: { default_popup?: string };
}

const manifest = JSON.parse(
  readFileSync(resolve("public/manifest.json"), "utf8"),
) as Manifest;

describe("extension manifest", () => {
  it("uses a temporary toolbar popup with a module service worker", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("116");
    expect(manifest.side_panel).toBeUndefined();
    expect(manifest.action?.default_popup).toBe("popup.html");
    expect(manifest.background).toEqual({
      service_worker: "background.js",
      type: "module",
    });
  });

  it("declares website access so core link routing is reliable", () => {
    expect(manifest.host_permissions).toEqual([
      "http://*/*",
      "https://*/*",
    ]);
    expect(manifest.optional_host_permissions).toBeUndefined();
  });

  it("declares only the APIs used by the implementation", () => {
    expect(new Set(manifest.permissions)).toEqual(
      new Set(["tabs", "storage", "contextMenus", "scripting", "favicon"]),
    );
  });
});
