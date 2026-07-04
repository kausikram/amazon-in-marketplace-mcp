import { listOrders } from "./orders.js";
import type { OrderSummary } from "../parse.js";

/**
 * Pulls a window of orders and computes spend trends entirely in-process.
 * Deliberately schema-light: it reports what can be derived reliably from the
 * order-list view (dates + totals + item titles) without deep per-order scraping.
 */

export type TrendArgs = {
  timeFilter?: string;
  maxOrders?: number;
};

type MonthBucket = { month: string; orders: number; spend: number };

export async function analyzeOrderTrends(args: TrendArgs = {}): Promise<{
  window: { timeFilter: string; ordersAnalyzed: number };
  totals: {
    totalSpend: number;
    orderCount: number;
    avgOrderValue: number;
    ordersWithKnownTotal: number;
  };
  byMonth: MonthBucket[];
  topItems: { item: string; count: number }[];
  biggestOrders: { orderId: string | null; date: string | null; total: number }[];
}> {
  const { timeFilter = "year-2024", maxOrders = 100 } = args;
  const { orders } = await listOrders({ timeFilter, maxOrders });

  const monthMap = new Map<string, MonthBucket>();
  const itemMap = new Map<string, number>();
  let totalSpend = 0;
  let ordersWithTotal = 0;

  for (const o of orders) {
    if (typeof o.total === "number") {
      totalSpend += o.total;
      ordersWithTotal++;
    }

    const month = monthKey(o.orderDate);
    if (month) {
      const b = monthMap.get(month) ?? { month, orders: 0, spend: 0 };
      b.orders++;
      if (typeof o.total === "number") b.spend += o.total;
      monthMap.set(month, b);
    }

    for (const raw of o.items) {
      const item = normalizeItem(raw);
      if (item) itemMap.set(item, (itemMap.get(item) ?? 0) + 1);
    }
  }

  const byMonth = [...monthMap.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );

  const topItems = [...itemMap.entries()]
    .map(([item, count]) => ({ item, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const biggestOrders = orders
    .filter((o): o is OrderSummary & { total: number } => typeof o.total === "number")
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map((o) => ({ orderId: o.orderId, date: o.orderDate, total: o.total }));

  return {
    window: { timeFilter, ordersAnalyzed: orders.length },
    totals: {
      totalSpend: round2(totalSpend),
      orderCount: orders.length,
      avgOrderValue: ordersWithTotal ? round2(totalSpend / ordersWithTotal) : 0,
      ordersWithKnownTotal: ordersWithTotal,
    },
    byMonth: byMonth.map((b) => ({ ...b, spend: round2(b.spend) })),
    topItems,
    biggestOrders,
  };
}

// "26 December 2024" / "December 26, 2024" -> "2024-12"
function monthKey(dateText: string | null): string | null {
  if (!dateText) return null;
  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Collapse a full product title to a short signature so "repeat purchases" of
// the same item group together instead of fragmenting on variant text.
function normalizeItem(raw: string): string {
  const words = raw.split(/\s+/).slice(0, 6).join(" ");
  return words.trim();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
