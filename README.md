# amazon-in-mcp

A **stdio MCP server** for **Amazon.in** that drives a single, persistent,
logged-in Playwright/Chromium session. It lets an MCP client (Claude Code,
Claude Desktop, etc.) search products, read your orders, and analyze your order
trends.

> ⚠️ **Personal-use tool, unofficial.** Not affiliated with, endorsed by, or
> associated with Amazon. It automates *your own* logged-in Amazon account via a
> browser — there is **no official consumer API** for order history, so it reads
> the same pages you see. Heavy automation can trip CAPTCHAs and brushes against
> Amazon's Terms of Service. Use it privately and responsibly; you are
> responsible for your own account and how you use it.

## Tools

| Tool | Auth needed | What it returns |
|------|-------------|-----------------|
| `login_status` | – | Whether you're signed in / walled by CAPTCHA |
| `get_browser_state` | – | Current mode (headless/headed), whether a browser is open, idle timeout, profile dir |
| `set_browser_mode` | – | Switch headless ↔ headed at runtime (relaunches on next call; login preserved) |
| `search_items` | no | title, price ₹, rating, ASIN, URL |
| `list_orders` | yes | order id, date, total, item titles (paginated) |
| `get_order` | yes | readable detail of one order |
| `analyze_order_trends` | yes | total spend, avg order value, spend by month, top repeated items, biggest orders |

## Install as a Claude Desktop extension (MCPB) — easiest

A prebuilt **MCPB bundle** (`.mcpb`) is attached to each
[GitHub Release](https://github.com/kausikram/amazon-in-marketplace-mcp/releases/latest).
This is the one-click path for **Claude Desktop** — no cloning or building.

1. **Download** `amazon-in-marketplace-mcp.mcpb` from the
   [latest release](https://github.com/kausikram/amazon-in-marketplace-mcp/releases/latest).
2. **Install it:** open Claude Desktop → **Settings → Extensions** → drag the
   `.mcpb` file in (or double-click the file). Review the tools it exposes and
   click **Install**.
3. **Configure** (optional) in the extension's settings pane:
   - **Run headless** — on by default (no window). Turn off if order pages start
     showing CAPTCHAs.
   - **Idle auto-close (ms)** — how long the browser lingers before closing
     itself (default 45000; `0` = never).
4. **First-time requirements:**
   - **Chromium** must be present. If Playwright's Chromium isn't installed yet,
     run once in a terminal: `npx playwright install chromium`
   - **Sign in once.** Ask Claude to run the `login_status` tool. If it says you
     aren't signed in, do the one-time interactive login (clone the repo and run
     `npm run login`, or set `AMAZON_MCP_HEADLESS` off and sign in when a window
     appears). Your session is saved to `~/.amazon-in-mcp/profile` and reused.

> The bundle contains the server + its Node dependencies, but **not** the
> Chromium browser binary (Playwright keeps that in a shared cache) — hence the
> one-time `npx playwright install chromium`.

To build the `.mcpb` yourself: `npm run build && npx @anthropic-ai/mcpb pack .`

## Install from Git

Clone the repo and build from source (there is no npm-registry package — install
straight from Git):

```bash
# 1. Clone
git clone git@github.com:kausikram/amazon-in-marketplace-mcp.git
cd amazon-in-marketplace-mcp

# 2. Install deps (postinstall also downloads the Chromium browser binary)
npm install

# 3. Build the TypeScript
npm run build

# 4. One-time interactive login (opens a real Chrome window; sign in, clear
#    any OTP/CAPTCHA, then press Enter in the terminal to save the session)
npm run login
```

You can also install a specific commit or branch by cloning that ref, e.g.
`git clone -b main git@github.com:kausikram/amazon-in-marketplace-mcp.git`.
After `npm run build`, the runnable entry
point is `dist/index.js` — that's the path you register with your MCP client
(see **Register** below).

> Requires Node 18+ and enough disk for the Chromium download (~150 MB).

## Setup

```bash
cd amazon-in-mcp
npm install            # also runs `playwright install chromium`
npm run build

# One-time: sign in by hand. Opens a real Chrome window sharing the server's
# profile. Complete OTP/CAPTCHA, then press Enter in the terminal.
npm run login
```

The login session is stored in a persistent profile at
`~/.amazon-in-mcp/profile` (override with `AMAZON_MCP_PROFILE_DIR`). The server
reuses it, so you normally sign in once.

### Environment variables

| Var | Default | Meaning |
|-----|---------|---------|
| `AMAZON_MCP_PROFILE_DIR` | `~/.amazon-in-mcp/profile` | Chrome profile dir (holds your session) |
| `AMAZON_MCP_HEADLESS` | `1` (headless) | Set `0` to run headed (visible window). Headed draws fewer CAPTCHAs on order pages. Also switchable at runtime via `set_browser_mode`. |
| `AMAZON_MCP_IDLE_MS` | `45000` | Idle ms before the browser auto-closes. `0` = never close. |

## Register with Claude Code

Add to your `.mcp.json` (or `claude mcp add`):

```json
{
  "mcpServers": {
    "amazon-in": {
      "command": "node",
      "args": ["/Users/kausikram/MCP_Servers/amazon-in-mcp/dist/index.js"],
      "env": {
        "AMAZON_MCP_HEADLESS": "0"
      }
    }
  }
}
```

Then, in a chat: *"search amazon for a 100W usb-c charger"*, *"list my orders
from the last 3 months"*, *"analyze my 2024 amazon spending."*

## How it works / where to fix things

- `src/browser.ts` — the single persistent Chromium context (profile reuse, stealth touches).
- `src/auth.ts` — sign-in / CAPTCHA detection; every order tool guards on it.
- `src/parse.ts` — **all fragile DOM selectors live here.** When Amazon changes
  markup, fix this one file.
- `src/tools/*` — the five tools.
- `src/index.ts` — MCP wiring over stdio.

## Known limitations

- Order-history has no API; scraping breaks when Amazon changes HTML — update `parse.ts`.
- CAPTCHA/OTP require a manual `npm run login` again.
- Trend analysis derives from the order-*list* view (dates, totals, item titles),
  not deep per-item category data. Extend `get_order` + `trends.ts` for category-level analysis.

## License

Released into the **public domain** under [The Unlicense](LICENSE) — the most
lenient option available. Do anything you like with it: copy, modify, sell,
redistribute, no attribution required, no warranty. See [`LICENSE`](LICENSE).
