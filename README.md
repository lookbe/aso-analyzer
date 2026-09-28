# ASO Analyzer

A local, zero-cost App Store Optimization tool. Compare your iOS or Android app against up to four competitors in one click — no API keys, no subscriptions, no data leaving your machine (except the standard store requests).

Runs at **http://localhost:3131**.

---

## Quick Start

**Requirements:** Node.js 18+

```bash
npm install
node server.js
# open http://localhost:3131
```

The server handles CORS for Play Store requests automatically. You don't need Python or any external proxy.

---

## How It Works

| Data source | How |
|---|---|
| iOS App Store | iTunes Search API (public, no key) |
| Google Play | Local Express proxy → Play Store HTML scraping |
| Keyword rankings (iOS) | iTunes Search API, scans top 200 results |
| Keyword rankings (Android) | Local proxy → Play Store search HTML |
| AI analysis | Any OpenAI-compatible local LLM (LM Studio, Ollama, etc.) |

---

## Features

### App Comparison
- Search for apps by name on both App Store and Google Play — results appear in a dropdown picker
- Compare up to 5 apps simultaneously (your app + 4 competitors)
- Cross-platform comparison (iOS vs Android apps side by side)
- App cards with icon, developer, rating, and direct store link

### Metrics Table
Side-by-side view of every extractable store metric, with best/worst highlighting and a winner score:

| Metric | iOS | Android |
|---|---|---|
| Rating | ✓ | ✓ |
| Total ratings | ✓ | ✓ |
| Price | ✓ | ✓ |
| Category | ✓ | ✓ |
| Developer | ✓ | ✓ |
| Version | ✓ | — (not in store HTML) |
| Last updated | ✓ | — |
| App size | ✓ | — |
| Age rating | ✓ | — |
| Languages supported | ✓ | — |

### Charts
- Bar chart: overall rating per app
- Bar chart: total number of ratings per app

### ASO Health Score
Composite 0–100 score (A–F grade) for each app across five dimensions:

| Dimension | Max |
|---|---|
| Rating quality | 25 |
| Social proof (review count) | 20 |
| Keyword coverage in name + description | 20 |
| Update freshness | 20 |
| Localization (language count) | 15 |

### Keyword Rankings
- Auto-extracts candidate keywords from app names, categories, and descriptions
- Chip selector to choose which keywords to analyze (add custom ones too)
- Looks up real-time search position for each keyword on both stores
- Shows the top 10 ranked apps per keyword with icons
- Your app highlighted in results when it appears

### Keyword Gap Analysis
Identifies keywords where at least one competitor ranks in the top 10 but your app does not — direct ranking opportunities, presented as an action list.

### AI Analysis (Local LLM)
Connects to any OpenAI-compatible local server (LM Studio default: `http://localhost:1234/v1`, Ollama, etc.). Five analysis modes:

| Mode | Output |
|---|---|
| Competitive Analysis | Position, strengths, gaps, quick wins, strategic plays |
| Keyword Strategy | Performance review, gap opportunities, long-tail targets, priority list |
| Description Rewrite | Full store description optimized for conversion and keywords |
| Metadata Optimization | Title, subtitle, iOS keyword field, description fold, category |
| Positioning & Differentiation | USP, competitor weaknesses, underserved audiences, taglines |

The LLM receives all fetched app data and keyword rankings so analysis is grounded in real numbers.

### Export
- **CSV export** — all metrics + keyword rankings in one file, named `aso-analysis-YYYY-MM-DD.csv`

### UX
- Dark mode (follows OS preference)
- In-session app data caching (re-selecting a recently fetched app is instant)
- Parallel fetching with per-app progress steps

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
| **ASO health score** | ✓ | ✓ (varies by tool) |
| **AI-powered copywriting** | ✓ local LLM | ✓ cloud LLM |
| **CSV export** | ✓ | ✓ |
| **Cross-platform comparison** | ✓ | ✓ |
| **No API key / subscription** | ✓ | ✗ ($50–500/mo) |
| **Data stays local** | ✓ | ✗ sent to vendor |
| — | — | — |
| **Keyword search volume** | ✗ | ✓ (proprietary panel) |
| **Keyword difficulty score** | ✗ | ✓ |
| **Historical rank tracking** | ✗ | ✓ (days/weeks/months) |
| **Rating trend over time** | ✗ | ✓ |
| **Download / revenue estimates** | ✗ | ✓ (estimate, not exact) |
| **Category chart position** | ✗ | ✓ |
| **Featured placement tracking** | ✗ | ✓ (some tools) |
| **Review monitoring & alerts** | ✗ | ✓ |
| **Review sentiment analysis** | ✗ | ✓ |
| **Reply to reviews in-tool** | ✗ | ✓ (AppFollow, etc.) |
| **Competitor update alerts** | ✗ | ✓ |
| **Localization quality audit** | ✗ | ✓ (some tools) |
| **Screenshot / icon analysis** | ✗ | ✓ (some tools) |
| **Apple Search Ads intelligence** | ✗ | ✓ (MobileAction, AppTweak) |
| **Market share / install share** | ✗ | ✓ (data.ai, Sensor Tower) |
| **Team collaboration** | ✗ | ✓ |
| **API access** | ✗ | ✓ |
| **Bulk app analysis** | ✗ | ✓ |

### What "snapshot only" means

This tool is designed for on-demand, point-in-time analysis. It has no database, no scheduler, and no background jobs. Everything it shows reflects the stores at the moment you click "Analyze Apps." The features marked ✗ above all require storing data over time — that's a deliberate architectural choice that keeps the tool simple, local, and free.

---

## Limitations

- **Android metadata is partial.** Version, size, last-updated date, and age rating are not reliably present in Play Store HTML and show as `—` in the table.
- **Keyword volume/difficulty is unavailable.** The iTunes API and Play Store search HTML don't expose these signals. Paid tools derive them from install-panel data (tens of millions of tracked devices).
- **Rankings beyond position 200 (iOS) are not checked.** The iTunes Search API caps results at 200.
- **Android keyword ranks are positional estimates.** Derived from scraping the search results page (typically 30–50 visible results).
- **No history.** Refresh the page and previous data is gone.

---

## Project Structure

```
aso-analyzer/
├── server.js          # Express server + Play Store proxy (port 3131)
├── proxy.py           # Python alternative proxy (optional)
├── public/
│   └── index.html     # Entire frontend (single-file HTML/CSS/JS)
└── package.json
```
