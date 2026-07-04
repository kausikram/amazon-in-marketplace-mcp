import { newPage, BASE_URL } from "../browser.js";
import { inspectAuth } from "../auth.js";
import { extractSearchResults, type SearchResult } from "../parse.js";

export type SearchArgs = {
  query: string;
  maxResults?: number;
  includeSponsored?: boolean;
};

export async function searchItems(args: SearchArgs): Promise<{
  query: string;
  count: number;
  results: SearchResult[];
}> {
  const { query, maxResults = 10, includeSponsored = false } = args;
  const page = await newPage();
  try {
    const url = `${BASE_URL}/s?k=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Search works signed-out, but a CAPTCHA wall still blocks us.
    const auth = await inspectAuth(page);
    if (auth.captcha) throw new Error(auth.detail);

    // Wait for at least one result card (or bail after a short grace period).
    await page
      .waitForSelector('div[data-component-type="s-search-result"]', {
        timeout: 15_000,
      })
      .catch(() => undefined);

    let results = await extractSearchResults(page);
    if (!includeSponsored) results = results.filter((r) => !r.sponsored);
    results = results.filter((r) => r.title).slice(0, maxResults);

    return { query, count: results.length, results };
  } finally {
    await page.close();
  }
}
