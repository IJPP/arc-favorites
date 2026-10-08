import { getDomain } from "tldts";

const MAX_NAME_LENGTH = 40;
const SPACED_SEPARATOR = /\s+[-–—|·•:：]\s+|\s*[|｜·•]\s*/;
const TIGHT_SEPARATOR = /[-–—_]/;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

function domainLabel(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    const domain = getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
    return domain.split(".")[0] ?? hostname;
  } catch {
    return "";
  }
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function squash(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Turns a page title into the name of the app behind it:
 * "首页-个性推荐-哔哩哔哩" → "哔哩哔哩", "Inbox (3) - me@x.com - Gmail" → "Gmail".
 */
export function appNameFromTitle(title: string | undefined, url: string): string {
  const label = domainLabel(url);
  const cleaned = (title ?? "")
    .replace(/^\(\d+\+?\)\s*/, "")
    .replace(/^[•●]\s*/, "")
    .trim();
  if (!cleaned) return capitalize(label);

  // A title that is just the hostname says nothing beyond the domain.
  if (/^[\w.-]+\.[a-z]{2,}$/i.test(cleaned) && !cleaned.includes(" ")) return capitalize(label);

  let parts = cleaned.split(SPACED_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    const tight = cleaned.split(TIGHT_SEPARATOR).map((part) => part.trim()).filter(Boolean);
    // "X-Men" is a name; "首页-个性推荐-哔哩哔哩" is breadcrumbs.
    if (tight.length >= 3 || (tight.length === 2 && CJK.test(cleaned))) parts = tight;
  }
  if (parts.length === 1) return parts[0]!.slice(0, MAX_NAME_LENGTH);

  const target = squash(label);
  const matching = target
    ? parts.find((part) => squash(part) === target) ?? parts.find((part) => squash(part).includes(target))
    : undefined;
  if (matching) return matching.slice(0, MAX_NAME_LENGTH);

  const usable = (part: string) => part.length <= 16 && !part.includes("@");
  // "少数派 - 高效工作，品质生活", "Article title - Medium": of two parts the
  // name is the short one; the other is a tagline or a page title.
  if (parts.length === 2) {
    const shorter = [...parts].sort((a, b) => a.length - b.length)[0]!;
    if (usable(shorter)) return shorter;
  }
  const last = parts[parts.length - 1]!;
  const first = parts[0]!;
  if (usable(last)) return last;
  if (usable(first)) return first;
  return capitalize(label);
}

/** Validates a name declared by the page (meta tags); undefined when unusable. */
export function cleanDeclaredName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return undefined;
  return trimmed;
}
