import { chromium, type BrowserContext, type Page } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * A single, long-lived persistent Chromium context is shared across every tool
 * call. Using launchPersistentContext with an on-disk profile is what makes the
 * logged-in Amazon session survive between runs and makes us look like a
 * returning human rather than a fresh headless bot.
 */

// Where the Chrome profile (cookies, localStorage, the whole logged-in session)
// lives. Override with AMAZON_MCP_PROFILE_DIR.
export const PROFILE_DIR =
  process.env.AMAZON_MCP_PROFILE_DIR ??
  join(homedir(), ".amazon-in-mcp", "profile");

export const BASE_URL = "https://www.amazon.in";

// Headless by default so no window pops up. Set AMAZON_MCP_HEADLESS=0 to start
// headed. This is the *initial* value only — it can be flipped at runtime via
// setHeadless() (the set_browser_mode tool), which relaunches the browser.
let headlessMode = process.env.AMAZON_MCP_HEADLESS !== "0";

export function getHeadless(): boolean {
  return headlessMode;
}

/**
 * Change headless/headed at runtime. Since the mode is fixed at browser launch,
 * a real change closes the current browser so the next tool call relaunches in
 * the new mode. Login persists in the on-disk profile, so nothing is lost.
 * Returns whether a relaunch was triggered.
 */
export async function setHeadless(next: boolean): Promise<{ changed: boolean }> {
  if (next === headlessMode) return { changed: false };
  headlessMode = next;
  const wasOpen = contextPromise !== null;
  if (wasOpen) await closeBrowser();
  return { changed: true };
}

export type BrowserState = {
  headless: boolean;
  mode: "headless" | "headed";
  browserOpen: boolean;
  idleMs: number;
  profileDir: string;
};

export function getBrowserState(): BrowserState {
  return {
    headless: headlessMode,
    mode: headlessMode ? "headless" : "headed",
    browserOpen: contextPromise !== null,
    idleMs: IDLE_MS,
    profileDir: PROFILE_DIR,
  };
}

// After this many ms with no tool activity, the browser closes itself so it
// doesn't linger. Login survives in the on-disk profile, so the next call just
// relaunches. Set AMAZON_MCP_IDLE_MS=0 to keep it open indefinitely.
const IDLE_MS = Number(process.env.AMAZON_MCP_IDLE_MS ?? 45_000);

// A realistic desktop UA/viewport — the default Playwright UA is a giveaway.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let contextPromise: Promise<BrowserContext> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export function getContext(): Promise<BrowserContext> {
  cancelIdle(); // a call is starting — don't let the idle timer close under us
  if (!contextPromise) {
    contextPromise = createContext();
  }
  return contextPromise;
}

function cancelIdle(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/**
 * Arm the idle timer. Called after each tool call finishes; the next call
 * cancels it. When it fires, the browser (and its window) closes itself.
 */
export function scheduleIdleClose(): void {
  cancelIdle();
  if (!Number.isFinite(IDLE_MS) || IDLE_MS <= 0) return;
  idleTimer = setTimeout(() => {
    closeBrowser().catch(() => undefined);
  }, IDLE_MS);
  // Don't keep the Node event loop alive just for this timer.
  idleTimer.unref?.();
}

async function createContext(): Promise<BrowserContext> {
  mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: headlessMode,
    channel: "chromium",
    viewport: { width: 1366, height: 900 },
    userAgent: USER_AGENT,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-default-browser-check",
    ],
  });

  // Small stealth touch: hide the webdriver flag that headless Chromium sets.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  return context;
}

/** Get a page to work with — reuses an existing tab so we don't leak tabs. */
export async function getPage(): Promise<Page> {
  const context = await getContext();
  const pages = context.pages();
  return pages.length > 0 ? pages[0] : await context.newPage();
}

/** A fresh page for a one-off navigation (search), closed by the caller. */
export async function newPage(): Promise<Page> {
  const context = await getContext();
  return context.newPage();
}

export async function closeBrowser(): Promise<void> {
  cancelIdle();
  if (contextPromise) {
    const ctx = await contextPromise;
    await ctx.close();
    contextPromise = null;
  }
}
