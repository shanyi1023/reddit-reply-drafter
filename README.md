# Reddit Reply Drafter

A Chrome extension that drafts thoughtful Reddit replies with AI, right on the
thread page. **Draft-only** — it never posts for you. You read, edit, and submit
the comment yourself.

It runs inside your logged-in browser, so it reads posts via a same-origin
request (no Reddit API key, no server) and calls the OpenAI API directly with
your own key.

## Features

- Floating **Draft reply** button on any Reddit thread (`/r/*/comments/*`)
- Reads the post **and OP's follow-up comments** for better context
- **Improve** box — refine a draft with an instruction ("shorter", "less formal")
  without leaving the page
- Custom **instructions** and **voice examples** so drafts sound like you
- Works with new Reddit's single-page navigation

## Install (unpacked)

1. Clone this repo.
2. Go to `chrome://extensions` and turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. Click the extension icon → **Settings** and paste your
   [OpenAI API key](https://platform.openai.com/api-keys). Optionally add voice
   examples and custom instructions.

## Usage

1. Open a Reddit thread on `www.reddit.com`.
2. Click the orange **✦ Draft reply** button (bottom-right).
3. Review the draft, refine it with the **Improve** box if needed, edit it to
   sound like you, then **Copy** and paste it into Reddit's reply box yourself.

## Notes

- Your OpenAI key is stored locally in `chrome.storage.local` — it is never
  committed or sent anywhere except OpenAI.
- Use it sparingly and genuinely. Low-quality or high-volume AI replies get
  downvoted and can get accounts flagged.

## Files

| File | Role |
|------|------|
| `manifest.json` | Manifest V3 config |
| `content.js` | Injects the UI, reads the post, talks to the worker |
| `background.js` | Service worker; OpenAI call (isolated for a future backend) |
| `options.html` / `options.js` | Settings: key, model, instructions, voice |
| `content.css` | Panel styling |
