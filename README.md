# Card Rewards PWA

A static GitHub Pages PWA that recommends the best credit card for a merchant based on:

- card reward rules
- point valuations
- merchant/category matching
- active cashback deals
- optional purchase amount

The app has no backend, no serverless worker, no server database, and no token in browser code. GitHub Pages only serves static files; all search and reward calculation runs locally in the browser. The included PWA service worker only caches static files for offline use.

## Local use

Run a tiny local static server:

```sh
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

Published site:

```text
https://guanzhousong.github.io/card-rewards-pwa/index.html
```

## GitHub Pages

This repo includes `.github/workflows/pages.yml`, which deploys the static site from `main` using GitHub Pages. In the repository settings, set **Pages** to use **GitHub Actions** if it is not already enabled.

## Data files

The app loads these JSON files at startup:

```text
data/cards.json      card reward rules and point values
data/merchants.json  merchant names, aliases, and categories
data/deals.json      committed cashback/statement-credit offers
```

Screenshot/OCR-assisted deal import is browser-only. If the browser does not support built-in text detection, paste the offer text manually. New deals are saved to local browser storage first, then the app can download or copy a merged `deals.json` for you to commit back to the repo.

For Chase Offers, copy the visible text from the **Added** offers page and paste it into **Offer text**. The app recognizes rows like:

```text
eBay
Use online only
10% cash back
40d left
```

It bulk-parses the merchant, online-only flag, cashback percent, card, activated status, and relative expiration date. Always review the parsed preview before saving.

## Agent import workflow

This repo includes a project-local Copilot CLI extension:

```text
.github/extensions/cashback-deals/extension.mjs
```

When Copilot CLI is running from this repo, the agent can call the `cashback_import_deals` tool. Paste a full card-offer page and ask:

```text
Use cashback_import_deals with writeToRepo=true and baseDate=2026-07-05 to update data/deals.json from this pasted page:

<paste offer page text here>
```

The tool extracts merchant, card, cashback percent, online-only flag, activation status, and expiration date. It updates only `data/deals.json`; review `git diff` before committing.

The extension also has an auto-detection hook. If you paste a whole offer page while Copilot CLI is running from this repo, Copilot receives hidden guidance to call `cashback_import_deals` automatically. A bare pasted offer page is treated as an update request; include words like `preview` or `do not write` if you only want extraction without changing `data/deals.json`.

Project extensions are discovered only when Copilot CLI starts in this repository or one of its subdirectories. If Copilot is started from another directory, run:

```sh
cd /Users/guanzhou/codebase/card-rewards-pwa
```

Then restart or reload Copilot CLI extensions.

You can also run the same importer directly:

```sh
pbpaste | node scripts/import-offers.mjs --base-date 2026-07-05 --write
```

Preview without writing:

```sh
node scripts/import-offers.mjs --input /tmp/chase-offers.txt --base-date 2026-07-05
```

## Security model

Do not store full card numbers, CVV, bank passwords, session cookies, or bank login data. The intended data is card nicknames, public reward rules, merchant aliases, and offer terms.
