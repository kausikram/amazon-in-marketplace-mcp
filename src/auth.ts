import type { Page } from "playwright";
import {
  getPage,
  BASE_URL,
  setHeadless,
  setHoldOpen,
  getBrowserState,
} from "./browser.js";

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

/**
 * Interactive login, tool-driven — no terminal needed. Forces a visible
 * (headed) Chromium window, opens the Amazon.in sign-in page, and holds the
 * window open so the idle timer can't close it while the user signs in. The
 * user signs in by hand (including OTP/CAPTCHA); cookies are saved to the
 * on-disk profile automatically. They then call finish_login to confirm.
 */
export async function openLogin(): Promise<{
  opened: boolean;
  alreadySignedIn: boolean;
  nextStep: string;
  message: string;
}> {
  await setHeadless(false); // ensure a visible window; closes any headless ctx
  setHoldOpen(true); // keep it open while the user signs in
  const page = await getPage();
  await page.goto(`${BASE_URL}/ap/signin`, { waitUntil: "domcontentloaded" });

  const state = await inspectAuth(page);
  if (state.signedIn) {
    return {
      opened: true,
      alreadySignedIn: true,
      nextStep: "finish_login",
      message:
        "You're already signed in — no login needed. Run finish_login to close the window and return to headless.",
    };
  }
  return {
    opened: true,
    alreadySignedIn: false,
    nextStep: "finish_login",
    message:
      "A Chrome window opened at the Amazon.in sign-in page. Sign in there and complete any OTP/CAPTCHA. Your session saves automatically. When the homepage shows 'Hello, <name>', run the finish_login tool.",
  };
}

/**
 * Confirm login succeeded, release the hold, and (by default) switch back to
 * headless — which closes the visible window. Pass keepHeaded=true to stay
 * headed for a session where you want to watch the browser.
 */
export async function finishLogin(
  args: { keepHeaded?: boolean } = {},
): Promise<{ signedIn: boolean; mode: string; message: string }> {
  const page = await getPage();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const state = await inspectAuth(page);

  if (!state.signedIn) {
    // Stay held open so the window remains available to finish signing in.
    return {
      signedIn: false,
      mode: getBrowserState().mode,
      message:
        "Still not signed in. Finish signing in in the open window, then run finish_login again. " +
        state.detail,
    };
  }

  setHoldOpen(false); // allow the idle timer to manage the window again
  const keepHeaded = args.keepHeaded === true;
  if (!keepHeaded) await setHeadless(true); // closes the window; relaunch headless next call

  return {
    signedIn: true,
    mode: getBrowserState().mode,
    message: keepHeaded
      ? `${state.detail} Staying headed for this session.`
      : `${state.detail} Login saved; switched back to headless.`,
  };
}
