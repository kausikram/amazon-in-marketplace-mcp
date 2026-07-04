/**
 * One-time interactive login. Run `npm run login`. This opens a real headed
 * Chromium window using the SAME persistent profile the MCP server uses, so once
 * you sign in (and clear any OTP/CAPTCHA) by hand, the session is saved and the
 * server reuses it silently on every later run.
 */
import { chromium } from "playwright";
import { PROFILE_DIR, BASE_URL } from "./browser.js";
import { mkdirSync } from "node:fs";

async function main() {
  mkdirSync(PROFILE_DIR, { recursive: true });
  process.stderr.write(`Using profile: ${PROFILE_DIR}\n`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: "chromium",
    viewport: { width: 1366, height: 900 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = context.pages()[0] ?? (await context.newPage());
  // Land on the homepage; the /ap/signin deep link can error without params.
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  process.stderr.write(
    "\n>>> Click 'Sign in' (top right) and sign in to Amazon.in in the opened window.\n" +
      ">>> Complete any OTP / CAPTCHA. When you see the header with 'Hello, <name>',\n" +
      ">>> come back here and press Enter to save the session and close.\n\n",
  );

  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  await context.close();
  process.stderr.write("Session saved. You can now run the MCP server.\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`login failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
