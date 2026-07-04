import { getPage, BASE_URL } from "../browser.js";
import { guardSignedIn } from "../auth.js";
import { extractOrderList, type OrderSummary } from "../parse.js";

/**
 * Amazon paginates "Your Orders" by time filter. The `timeFilter` query param
 * accepts values like `year-2024`, `months-3`, `months-6`, `last30`. We page
 * through with the `startIndex` param (10 orders per page).
 */

export type ListOrdersArgs = {
  timeFilter?: string; // e.g. "months-3", "year-2024", "last30"
  maxOrders?: number;
};

export async function listOrders(args: ListOrdersArgs = {}): Promise<{
  timeFilter: string;
  count: number;
  orders: OrderSummary[];
}> {
  const { timeFilter = "months-6", maxOrders = 30 } = args;
  const page = await getPage();

  const all: OrderSummary[] = [];
  const seen = new Set<string>();

  for (let start = 0; all.length < maxOrders; start += 10) {
    const url = `${BASE_URL}/your-orders/orders?timeFilter=${encodeURIComponent(
      timeFilter,
    )}&startIndex=${start}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await guardSignedIn(page);

    await page
      .waitForSelector(".order-card, .js-order-card, .a-box-group.order", {
        timeout: 10_000,
      })
      .catch(() => undefined);

    const batch = await extractOrderList(page);
    if (batch.length === 0) break;

    let added = 0;
    for (const o of batch) {
      const key = o.orderId ?? `${o.orderDate}|${o.totalText}|${o.items[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(o);
      added++;
      if (all.length >= maxOrders) break;
    }
    // No new orders on this page -> we've reached the end.
    if (added === 0) break;
  }

  return { timeFilter, count: all.length, orders: all };
}

export type GetOrderArgs = { orderId: string };

export async function getOrder(args: GetOrderArgs): Promise<{
  orderId: string;
  url: string;
  text: string;
}> {
  const { orderId } = args;
  const page = await getPage();
  const url = `${BASE_URL}/gp/your-account/order-details?orderID=${encodeURIComponent(
    orderId,
  )}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await guardSignedIn(page);

  // Order-detail markup varies enough that returning the readable text of the
  // detail container is more robust than brittle per-field selectors.
  const container = page
    .locator("#orderDetails, #od-subtotals, .a-box-group")
    .first();
  const text =
    (await container.innerText().catch(() => null)) ??
    (await page.locator("body").innerText());

  return { orderId, url, text: text.replace(/\n{3,}/g, "\n\n").trim() };
}
