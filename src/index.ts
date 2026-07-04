#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loginStatus } from "./auth.js";
import { searchItems } from "./tools/search.js";
import { listOrders, getOrder } from "./tools/orders.js";
import { analyzeOrderTrends } from "./tools/trends.js";
import {
  closeBrowser,
  scheduleIdleClose,
  setHeadless,
  getBrowserState,
} from "./browser.js";

const server = new McpServer({
  name: "amazon-in-mcp",
  version: "0.1.0",
});

// Wrap a handler so any thrown error becomes a clean isError tool result
// (with the actionable "run login" text) instead of crashing the transport.
function tool<T>(fn: (args: T) => Promise<unknown>) {
  return async (args: T) => {
    try {
      const data = await fn(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    } finally {
      // Arm idle auto-close; a subsequent call cancels it.
      scheduleIdleClose();
    }
  };
}

server.registerTool(
  "login_status",
  {
    title: "Check Amazon.in login status",
    description:
      "Loads the Amazon.in homepage in the persistent browser session and reports whether you are signed in, or whether a CAPTCHA/sign-in wall is blocking access. Run `npm run login` once if not signed in.",
    inputSchema: {},
  },
  tool(async () => loginStatus()),
);

server.registerTool(
  "get_browser_state",
  {
    title: "Get browser mode & state",
    description:
      "Report the current browser configuration: whether it's running headless or headed, whether a browser is currently open, the idle auto-close timeout, and the profile directory.",
    inputSchema: {},
  },
  tool(async () => getBrowserState()),
);

server.registerTool(
  "set_browser_mode",
  {
    title: "Switch headless / headed",
    description:
      "Switch the browser between headless (no window) and headed (visible window). If the browser is currently open, it is closed so the next tool call relaunches in the new mode. Your login is preserved. Returns the resulting state.",
    inputSchema: {
      headless: z
        .boolean()
        .describe("true = headless (no window), false = headed (visible window)."),
    },
  },
  tool(async ({ headless }: { headless: boolean }) => {
    const { changed } = await setHeadless(headless);
    return {
      changed,
      note: changed
        ? "Mode changed; browser relaunches on the next tool call."
        : "Already in that mode; nothing to do.",
      state: getBrowserState(),
    };
  }),
);

server.registerTool(
  "search_items",
  {
    title: "Search Amazon.in",
    description:
      "Search Amazon.in for products. Returns title, price (₹), rating, rating count, ASIN and product URL. Works without being signed in.",
    inputSchema: {
      query: z.string().describe("Search terms, e.g. 'usb c cable 100w'"),
      maxResults: z.number().int().min(1).max(50).optional().describe("Default 10"),
      includeSponsored: z
        .boolean()
        .optional()
        .describe("Include sponsored/ad results. Default false."),
    },
  },
  tool(searchItems),
);

server.registerTool(
  "list_orders",
  {
    title: "List my Amazon.in orders",
    description:
      "List your recent Amazon.in orders (requires a signed-in session). Returns order id, date, total, and item titles. Paginates automatically up to maxOrders.",
    inputSchema: {
      timeFilter: z
        .string()
        .optional()
        .describe(
          "Amazon time filter: 'last30', 'months-3', 'months-6', or 'year-2024'. Default 'months-6'.",
        ),
      maxOrders: z.number().int().min(1).max(200).optional().describe("Default 30"),
    },
  },
  tool(listOrders),
);

server.registerTool(
  "get_order",
  {
    title: "Get one Amazon.in order's details",
    description:
      "Open a single order's detail page by order id (format 123-1234567-1234567) and return its readable contents: items, prices, shipping and payment summary.",
    inputSchema: {
      orderId: z.string().describe("Order id, e.g. 402-1234567-1234567"),
    },
  },
  tool(getOrder),
);

server.registerTool(
  "analyze_order_trends",
  {
    title: "Analyze Amazon.in order trends",
    description:
      "Pull a window of orders and compute spend trends: total spend, average order value, spend by month, most-repeated items, and biggest orders.",
    inputSchema: {
      timeFilter: z
        .string()
        .optional()
        .describe("Time window, e.g. 'year-2024' or 'months-6'. Default 'year-2024'."),
      maxOrders: z.number().int().min(1).max(200).optional().describe("Default 100"),
    },
  },
  tool(analyzeOrderTrends),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP channel — log to stderr only.
  process.stderr.write("amazon-in-mcp ready (stdio)\n");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await closeBrowser().catch(() => undefined);
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
