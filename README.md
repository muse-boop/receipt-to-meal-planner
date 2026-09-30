# Receipt to Meal Planner

Upload a grocery receipt, get a meal plan built around what you actually bought.

**Live:** https://muse-boop.github.io/receipt-to-meal-planner/

## How it works

1. **Upload** a photo of a grocery receipt (or paste the text, or try the sample).
2. The receipt is read with on-device OCR (Tesseract.js) and parsed into items —
   quantities, weights, and junk lines like totals and tax are handled automatically.
3. **Review** the item list — fix anything the scanner misread.
4. Check off your **pantry staples** and pick how many days to plan.
5. Get a day-by-day **meal plan** (breakfast, lunch, dinner) that:
   - uses your receipt items first,
   - **re-uses ingredients across meals** so nothing goes to waste,
   - fills gaps from your pantry,
   - and produces a shopping list only for what's genuinely missing.

Everything runs in the browser. Your receipt never leaves your device.

## The planning engine

Recipes are scored per meal slot on three factors:

- **Coverage** (45%) — how many of the recipe's ingredients you already have
- **Receipt priority** (35%) — bonus for using what you just bought
- **Re-use** (20%) — bonus for ingredients already used elsewhere in the plan

Recipes aren't repeated within a plan unless the database runs out of options
for a slot.

## AI-generated recipes (optional)

On the pantry step you can tick "Generate recipes with AI" to have recipes
created fresh for your receipt instead of picked from the built-in box. It
uses your own API key with any OpenAI-compatible `/chat/completions`
endpoint (OpenAI, OpenRouter, etc.):

- The key is stored only in your browser's localStorage and sent only to the
  endpoint you configure — never anywhere else.
- The AI gets your receipt items, pantry staples, and day count, with the
  same priorities: use up the receipt first, re-use ingredients across meals,
  lean on pantry staples, and keep extra purchases minimal.
- "Shuffle the plan" re-runs whichever engine produced the current plan.
- If the AI call fails, the built-in planner remains available as a fallback.

## Tech

- Plain HTML/CSS/JS — no build step, no backend
- [Tesseract.js](https://tesseract.projectnaptha.com/) (CDN) for receipt OCR
- 30 built-in recipes across breakfast, lunch, and dinner

## Local development

Serve the directory with any static server, e.g.:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000.

---

Built by [Muse](https://github.com/muse-boop) · Idea pitched via the project idea form on muse-boop.github.io
