# ASO Analyzer

A local, zero-cost App Store Optimization tool. Compare your iOS or Android app against up to four competitors in one click — no subscription, no data leaving your machine (except the standard store requests).

Runs at **http://localhost:3131**.

---

## Quick Start

**Requirements:** Node.js 18+

```bash
npm install
node server.js
# open http://localhost:3131
```

The server handles CORS for Play Store and autocomplete requests automatically.

---

## How It Works

| Data source | How |
|---|---|
| iOS app metadata | iTunes Search API (public, no key) |
| iOS keyword rankings | iTunes Search API — scans top 200 results |
| iOS category chart | iTunes RSS API — `itunes.apple.com/{country}/rss/…` |
| iOS keyword volume | Apple Search Ads API (optional credentials) or autocomplete hints proxy |
| iOS reviews | iTunes RSS customer reviews API |
| Android app metadata | Local Express proxy → Play Store HTML scraping |
| Android keyword rankings | Local proxy → Play Store search HTML |
| AI analysis | Any OpenAI-compatible local LLM (LM Studio, Ollama, etc.) |

---

## Features

### App Search & Selection
- Search apps by name on both App Store and Google Play — results appear in a grouped dropdown with icons and ratings
- Compare up to 5 apps simultaneously: your app + up to 4 competitors
- Cross-platform comparison — mix iOS and Android apps freely
- In-session caching: re-selecting a recently fetched app is instant

### App Cards
- Icon, name, developer, platform badge, rating, and direct store link per app

### Metrics Comparison Table
Side-by-side view of all extractable store metrics with best/worst highlighting and an overall winner score:

| Metric | iOS | Android |
|---|---|---|
| Rating | ✓ | ✓ |
| Total ratings | ✓ | ✓ |
| Price | ✓ | ✓ |
| Category | ✓ | ✓ |
| Developer | ✓ | ✓ |
| Version | ✓ | — |
| Last updated | ✓ | — |
| App size | ✓ | — |
| Age rating | ✓ | — |
| Languages supported | ✓ | — |
| **Title length** (vs store limit) | ✓ 30-char limit | ✓ 50-char limit |
| **Description length** (vs 4 000-char limit) | ✓ | ✓ |

### Metadata Character Counters
Title and description fields show current length against the store character limits inline in the metrics table, flagging over-limit values.

### Charts
- Bar chart: overall rating per app
- Bar chart: total number of ratings per app

### iOS Category Chart Position
For each iOS app, looks up its current rank in three Top Charts using the iTunes RSS API:
- Top Free / Top Paid (based on app price)
- Top Grossing

Checks the app's own category first, then the overall chart. Reports position out of top 200.

### ASO Health Score
Composite 0–100 score with A–F grade for each app:

| Dimension | Max | iOS | Android |
|---|---|---|---|
| Rating quality | 25 | ✓ | ✓ |
| Social proof (review count) | 20 | ✓ | ✓ |
| Keyword coverage in name + description | 20 | ✓ | ✓ |
| Update freshness | 20 | ✓ | — |
| Localization (language count) | 15 | ✓ | — |

Android metrics not available in Play Store HTML are shown as N/A with a note.

### Keyword Analysis

#### Keyword Extraction & Selection
- Auto-extracts candidate keywords from app names, categories, and descriptions
- Chip-based selector to pick which keywords to analyze; add your own custom keywords

#### Keyword Rankings
- Real-time search position for each keyword on both stores
- iOS: scans iTunes Search API (up to top 200 results)
- Android: scrapes Play Store search results page
- Shows top 10 apps per keyword with icons; your app is highlighted when it appears

#### Keyword Volume (iOS only)
Search volume on a 1–5 scale:

| Score | Label |
|---|---|
| 5 | Very High |
| 4 | High |
| 3 | Medium |
| 2 | Low |
| 1 | Very Low |

Sources (in priority order):
1. **Apple Search Ads API** — requires ASA credentials (see [Configuration](#optional-apple-search-ads-credentials) below)
2. **Autocomplete hints** — matches the keyword against `search.itunes.apple.com` position; requires server to be running (it proxies the request)

Volume appears as filled dots (●●●○○) in the keyword table with the source labeled in the tooltip.

#### Keyword Difficulty Score
Computed proxy score (0–100) derived entirely from public iTunes data — no paid panel required:

| Range | Label |
|---|---|
| 0–25 | Easy (green) |
| 26–50 | Medium (yellow) |
| 51–75 | Hard (orange) |
| 76–100 | Very Hard (red) |

Formula uses three signals from the top 10 search results for each keyword:
- Average review count (log-scaled, 50 pts max)
- Total result count vs 200 cap (30 pts max)
- Average rating on a 3–5 scale (20 pts max)

#### Keyword Gap Analysis
Identifies keywords where at least one competitor ranks in the top 10 but your app does not — presented as an action list with competitor positions shown.

#### Keyword Density
Table showing how many times each analyzed keyword appears in each app's title and description, with title-count and description-count broken out (`nT+nD`). High-density cells are highlighted.

### App Reviews (iOS only)
- Loads up to 100 recent App Store reviews (2 pages of 50)
- Displays star rating, title, body, date, and author
- **Analyze with AI (local LLM):** streams a structured sentiment analysis (praise, complaints, feature requests, ASO insights, prioritized improvements) using your connected LLM
- **Open in external AI:** copies a pre-built review prompt to the clipboard and opens ChatGPT, Gemini, or Claude.ai in a new tab

### Screenshot Analysis
- Drag-and-drop screenshots or let the tool auto-load store screenshots for each analyzed app
- Select any combination across apps for comparison
- Three analysis modes (via vision-capable local LLM):
  - UX critique
  - Creative brief
  - Competitor compare

### Metadata Optimizer
In-browser field editor with:
- **Title** — with character counter and limit indicator
- **Subtitle** — iOS-specific
- **iOS Keyword Field** — 100-char keyword string
- **Developer Name**
- **Description** — full 4 000-char field

Actions:
- **Prefill from your app** — auto-fills all fields from the first analyzed app's live store data
- **Check keyword coverage** — highlights which of your analyzed keywords appear in the metadata draft
- **Optimize with AI** — sends the current draft to your local LLM and streams back an optimized version

### AI Analysis (Local LLM)
Connects to any OpenAI-compatible local server (LM Studio default: `http://localhost:1234/v1`, Ollama, etc.). Six analysis modes, each receiving all fetched app data and keyword results:

| Mode | Output |
|---|---|
| Competitive Analysis | Position, strengths, gaps, quick wins, strategic plays |
| Keyword Strategy | Performance review, gap opportunities, long-tail targets, priority list |
| 📦 Full Metadata Package | Title, subtitle, keyword field, description, and positioning — all in one prompt |
| Description Rewrite | Full store description optimized for conversion and keywords |
| Positioning & Differentiation | USP, competitor weaknesses, underserved audiences, taglines |
| Localization Opportunities | Languages to prioritize, cultural considerations, missing market segments |

Output streams in real time. Results can be copied or used to prefill the Metadata Optimizer.

### Export
- **CSV export** — all metrics + keyword rankings in one file named `aso-analysis-YYYY-MM-DD.csv`

### UX
- Dark mode (follows OS preference)
- Parallel fetching with per-app progress steps
- In-session app data cache (avoid re-fetching recently loaded apps)

---

## Optional: Apple Search Ads Credentials

Without credentials, keyword volume falls back to the autocomplete-hints method (less accurate). With credentials, volume comes from the official ASA keyword popularity API.

Create a `.env` file or set environment variables before starting the server:

```bash
ASA_CLIENT_ID=your-client-id
ASA_TEAM_ID=your-team-id
ASA_KEY_ID=your-key-id
ASA_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----"
ASA_ORG_ID=          # optional — auto-fetched if blank
```

Then start the server:
```bash
node server.js
```

---

## Feature Parity vs Paid Tools

Paid tools compared: AppTweak, Sensor Tower, AppFollow, MobileAction, data.ai.

| Feature | This tool | Paid tools |
|---|---|---|
| **App metadata comparison** | ✓ | ✓ |
| **Rating / review count** | ✓ | ✓ |
| **Keyword ranking lookup** | ✓ real-time | ✓ real-time + history |
| **Top apps per keyword** | ✓ | ✓ |
| **Keyword gap analysis** | ✓ | ✓ |
| **Keyword density analysis** | ✓ | ✓ |
| **Keyword difficulty score** | ✓ computed proxy | ✓ panel-based |
| **Keyword search volume** | ✓ iOS (ASA or autocomplete) | ✓ (proprietary panel) |
| **Category chart position** | ✓ iOS (iTunes RSS top 200) | ✓ real-time |
| **ASO health score** | ✓ | ✓ (varies by tool) |
| **Metadata character counters** | ✓ | ✓ |
| **Metadata optimizer / editor** | ✓ | ✓ |
| **App reviews display** | ✓ iOS | ✓ |
| **Review sentiment analysis** | ✓ local LLM | ✓ cloud LLM |
| **AI-powered copywriting** | ✓ local LLM (6 modes) | ✓ cloud LLM |
| **Screenshot / creative analysis** | ✓ local vision LLM | ✓ (some tools) |
| **CSV export** | ✓ | ✓ |
| **Cross-platform comparison** | ✓ | ✓ |
| **No API key / subscription** | ✓ | ✗ ($50–500/mo) |
| **Data stays local** | ✓ | ✗ sent to vendor |
| — | — | — |
| **Historical rank tracking** | ✗ | ✓ (days/weeks/months) |
| **Rating trend over time** | ✗ | ✓ |
| **Download / revenue estimates** | ✗ | ✓ (estimate, not exact) |
| **Featured placement tracking** | ✗ | ✓ (some tools) |
| **Reply to reviews in-tool** | ✗ | ✓ (AppFollow, etc.) |
| **Competitor update alerts** | ✗ | ✓ |
| **Market share / install share** | ✗ | ✓ (data.ai, Sensor Tower) |
| **Team collaboration** | ✗ | ✓ |
| **API access** | ✗ | ✓ |
| **Bulk app analysis** | ✗ | ✓ |

---

## Limitations

- **Android metadata is partial.** Version, size, last-updated date, and age rating are not reliably present in Play Store HTML and show as `—` in the metrics table.
- **Keyword volume is iOS-only.** The Play Store doesn't expose a usable suggest API; Android volume is not shown.
- **Keyword volume accuracy.** ASA volume requires optional credentials. The autocomplete fallback is a positional proxy — useful as a rough signal, not a precise number.
- **Category chart is iOS-only.** Android doesn't expose a comparable public chart API.
- **Rankings beyond position 200 (iOS) are not checked.** The iTunes Search API caps results at 200.
- **Android keyword ranks are positional estimates.** Derived from scraping the Play Store search results page (typically 30–50 visible results).
- **No history.** Everything is a point-in-time snapshot. Refresh the page and previous data is gone.
- **Screenshot analysis requires a vision-capable LLM.** Standard text-only models will not produce useful output.

---

## Project Structure

```
aso-analyzer/
├── server.js          # Express server: Play Store proxy + ASA volume endpoint (port 3131)
├── proxy.py           # Python alternative proxy (optional, if Node.js unavailable)
├── public/
│   └── index.html     # Entire frontend (single-file HTML/CSS/JS)
└── package.json
```
