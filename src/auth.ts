import type { Page } from "playwright";
import { getPage, BASE_URL } from "./browser.js";

/**
 * Detects whether we are actually signed in, and whether a page has been walled
 * off by a sign-in prompt or a CAPTCHA. Every tool calls guardSignedIn() first
 * so it can return a clear "run login" message instead of parsing garbage.
 */

export type AuthState = {
  signedIn: boolean;
  captcha: boolean;
  detail: string;
};

/** Inspect the currently loaded page for sign-in / CAPTCHA walls. */
export async function inspectAuth(page: Page): Promise<AuthState> {
  const url = page.url();

  // CAPTCHA / robot check pages.
  const captcha =
    /\/errors\/validateCaptcha/i.test(url) ||
    (await page
      .locator('form[action*="validateCaptcha"], input#captchacharacters')
      .count()) > 0;
  if (captcha) {
    return {
      signedIn: false,
      captcha: true,
      detail:
        "Amazon is showing a CAPTCHA / robot check. Run the one-time login (`npm run login`) in a headed window and solve it, then retry.",
    };
  }

  // Sign-in pages.
  if (/\/ap\/signin/i.test(url)) {
    return {
      signedIn: false,
      captcha: false,
      detail:
        "Not signed in — Amazon redirected to the sign-in page. Run `npm run login` once to establish the session.",
    };
  }

  // Presence of the account greeting ("Hello, <name>") is a reliable signal.
  const greeting = await page
    .locator("#nav-link-accountList-nav-line-1")
    .first()
    .textContent()
    .catch(() => null);
  const signedIn = !!greeting && !/sign in/i.test(greeting);

  return {
    signedIn,
    captcha: false,
    detail: signedIn
      ? `Signed in (${greeting?.trim()}).`
      : "Session present but not recognised as signed in.",
  };
}

/** Load the homepage and report auth state without touching order pages. */
export async function loginStatus(): Promise<AuthState> {
  const page = await getPage();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  return inspectAuth(page);
}

/**
 * Throws a descriptive error if the given page is walled. Tools await this right
 * after navigation so the failure surfaces to the model as actionable text.
 */
export async function guardSignedIn(page: Page): Promise<void> {
  const state = await inspectAuth(page);
  if (!state.signedIn) {
    throw new Error(state.detail);
  }
}
