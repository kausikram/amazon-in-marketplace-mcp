import type { Page } from "playwright";

/**
 * All fragile DOM knowledge lives here. When Amazon changes its markup, this is
 * the only file you should need to touch. Each extractor uses several fallback
 * selectors because Amazon serves different layouts to different sessions.
 */

export type SearchResult = {
  asin: string | null;
  title: string;
  price: number | null;
  priceText: string | null;
  rating: number | null;
  ratingCount: number | null;
  url: string | null;
  sponsored: boolean;
};

export type OrderSummary = {
  orderId: string | null;
  orderDate: string | null;
  total: number | null;
  totalText: string | null;
  items: string[];
  detailUrl: string | null;
};

/** "₹1,299.00" / "1,299" -> 1299 ; returns null if unparseable. */
export function parseRupees(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export async function extractSearchResults(page: Page): Promise<SearchResult[]> {
  return page.$$eval(
    'div[data-component-type="s-search-result"]',
    (cards) => {
      const parseNum = (t: string | null | undefined) => {
        if (!t) return null;
        const c = t.replace(/[^0-9.]/g, "");
        const n = Number.parseFloat(c);
        return Number.isFinite(n) ? n : null;
      };
      return cards.map((card) => {
        const asin = card.getAttribute("data-asin") || null;

        const titleEl =
          card.querySelector("h2 a span") ||
          card.querySelector("h2 span") ||
          card.querySelector("h2");
        const title = titleEl?.textContent?.trim() ?? "";

        const linkEl =
          (card.querySelector("h2 a") as HTMLAnchorElement | null) ||
          (card.querySelector("a.a-link-normal.s-no-outline") as HTMLAnchorElement | null);
        const href = linkEl?.getAttribute("href") || null;
        const url = href
          ? href.startsWith("http")
            ? href
            : `https://www.amazon.in${href}`
          : asin
            ? `https://www.amazon.in/dp/${asin}`
            : null;

        const priceText =
          card.querySelector(".a-price .a-offscreen")?.textContent?.trim() ??
          card.querySelector(".a-price-whole")?.textContent?.trim() ??
          null;

        const ratingText =
          card.querySelector("span.a-icon-alt")?.textContent?.trim() ?? null;
        const ratingMatch = ratingText?.match(/([0-9.]+)\s+out of/);
        const rating = ratingMatch ? Number.parseFloat(ratingMatch[1]) : null;

        const ratingCountText =
          card
            .querySelector('[aria-label*="ratings"], span.a-size-base.s-underline-text')
            ?.textContent?.trim() ?? null;
        const ratingCount = parseNum(ratingCountText);

        const sponsored =
          !!card.querySelector('[data-component-type="sp-sponsored-result"]') ||
          /Sponsored/i.test(card.textContent || "");

        return {
          asin,
          title,
          price: parseNum(priceText),
          priceText,
          rating,
          ratingCount,
          url,
          sponsored,
        };
      });
    },
  );
}

export async function extractOrderList(page: Page): Promise<OrderSummary[]> {
  return page.$$eval(
    ".order-card, .js-order-card, .a-box-group.order",
    (cards) => {
      const parseNum = (t: string | null | undefined) => {
        if (!t) return null;
        const c = t.replace(/[^0-9.]/g, "");
        const n = Number.parseFloat(c);
        return Number.isFinite(n) ? n : null;
      };
      return cards.map((card) => {
        // The order header holds date, total, and order id.
        const labels = Array.from(
          card.querySelectorAll(
            ".a-column .a-size-caption, .order-info span, .a-row .a-color-secondary",
          ),
        ).map((e) => e.textContent?.trim() || "");

        // Order date — Amazon labels it "Order placed".
        let orderDate: string | null = null;
        let totalText: string | null = null;
        for (let i = 0; i < labels.length; i++) {
          if (/order placed/i.test(labels[i]) && labels[i + 1]) orderDate = labels[i + 1];
          if (/^total$/i.test(labels[i]) && labels[i + 1]) totalText = labels[i + 1];
        }
        // Fallbacks by direct selectors.
        if (!totalText) {
          totalText =
            card.querySelector(".yohtmlc-order-total .value, .a-price .a-offscreen")
              ?.textContent?.trim() ?? null;
        }

        // Order id lives in a value span or an href.
        let orderId: string | null = null;
        const idEl = card.querySelector(
          ".yohtmlc-order-id span:last-child, bdi, [dir='ltr']",
        );
        const idText = idEl?.textContent?.trim() || "";
        const idMatch = idText.match(/\d{3}-\d{7}-\d{7}/);
        if (idMatch) orderId = idMatch[0];
        if (!orderId) {
          const html = card.innerHTML.match(/\d{3}-\d{7}-\d{7}/);
          if (html) orderId = html[0];
        }

        const items = Array.from(
          card.querySelectorAll(
            ".yohtmlc-product-title, .a-link-normal .a-text-bold, a.a-link-normal[href*='/product/'], .item-view-left-col-inner a",
          ),
        )
          .map((e) => e.textContent?.trim() || "")
          .filter(Boolean);

        const detailAnchor = card.querySelector(
          "a[href*='order-details'], a[href*='orderID']",
        ) as HTMLAnchorElement | null;
        const detailHref = detailAnchor?.getAttribute("href") || null;
        const detailUrl = detailHref
          ? detailHref.startsWith("http")
            ? detailHref
            : `https://www.amazon.in${detailHref}`
          : orderId
            ? `https://www.amazon.in/gp/your-account/order-details?orderID=${orderId}`
            : null;

        return {
          orderId,
          orderDate,
          total: parseNum(totalText),
          totalText,
          items,
          detailUrl,
        };
      });
    },
  );
}
