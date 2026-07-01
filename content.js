// Reddit Karma Assistant — content script
// Runs on https://www.reddit.com/r/*/comments/* (a thread page).
// 1. Injects a floating "Draft reply" button + panel.
// 2. Reads the post via a SAME-ORIGIN .json fetch (carries your login cookies,
//    so it looks like you — this is what bypasses the 403 we hit server-side).
// 3. Asks the background worker to draft a reply via OpenAI.
// 4. Shows the draft for you to copy. You submit on Reddit yourself (draft-only).

(function () {
  if (window.__rka_loaded) return;
  window.__rka_loaded = true;

  // A thread page looks like /r/<sub>/comments/<id>/...
  const THREAD_RE = /^\/r\/[^/]+\/comments\//;
  const isThreadPage = () => THREAD_RE.test(location.pathname);

  // ---- UI ----------------------------------------------------------------
  const btn = document.createElement("button");
  btn.id = "rka-btn";
  btn.textContent = "✦ Draft reply";
  document.body.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = "rka-panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div id="rka-panel-head">
      <span>Draft reply</span>
      <button id="rka-close" title="Close">✕</button>
    </div>
    <div id="rka-status"></div>
    <textarea id="rka-draft" placeholder="Your draft will appear here…"></textarea>
    <div id="rka-refine-row">
      <input id="rka-refine" type="text" placeholder="What to change? e.g. shorter, less formal, add a question" />
      <button id="rka-improve">Improve</button>
    </div>
    <div id="rka-actions">
      <button id="rka-generate">Regenerate</button>
      <button id="rka-copy">Copy</button>
    </div>
    <div id="rka-hint">Read it, edit it, then paste &amp; submit on Reddit yourself.</div>
  `;
  document.body.appendChild(panel);

  const statusEl = panel.querySelector("#rka-status");
  const draftEl = panel.querySelector("#rka-draft");
  const refineEl = panel.querySelector("#rka-refine");

  let lastPost = null; // cached post context so Improve doesn't re-fetch

  btn.addEventListener("click", () => {
    panel.style.display = "flex";
    btn.style.display = "none";
    if (!draftEl.value) generate();
  });
  panel.querySelector("#rka-close").addEventListener("click", () => {
    panel.style.display = "none";
    updateVisibility();
  });
  panel.querySelector("#rka-generate").addEventListener("click", generate);
  panel.querySelector("#rka-improve").addEventListener("click", improve);
  refineEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") improve();
  });
  panel.querySelector("#rka-copy").addEventListener("click", async () => {
    if (!draftEl.value.trim()) return;
    await navigator.clipboard.writeText(draftEl.value);
    setStatus("Copied — paste it into Reddit.", "ok");
  });

  // ---- Show the button only on thread pages, and survive SPA navigation ---
  function updateVisibility() {
    if (isThreadPage()) {
      if (panel.style.display === "none") btn.style.display = "block";
    } else {
      btn.style.display = "none";
      panel.style.display = "none";
    }
  }

  // New Reddit routes client-side (no full reload), so poll for URL changes.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Moved to a different post/page — drop stale context and draft.
      lastPost = null;
      draftEl.value = "";
      refineEl.value = "";
      setStatus("", "");
      panel.style.display = "none";
      updateVisibility();
    }
  }, 700);

  updateVisibility();

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = kind || "";
  }

  // ---- Read the post (same-origin JSON) ----------------------------------
  async function readPost() {
    // Strip query/hash, ensure trailing .json on the thread permalink.
    const path = location.pathname.replace(/\/+$/, "");
    const res = await fetch(`${path}.json?raw_json=1&limit=100`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(
        `Reddit returned ${res.status} for the post JSON. ` +
          `If this is 403, the same-origin trick is blocked and we'll need a DOM fallback.`
      );
    }
    const data = await res.json();
    const post = data[0]?.data?.children?.[0]?.data;
    if (!post) throw new Error("Could not parse the post from Reddit's JSON.");

    const op = post.author;

    // Flatten the whole comment tree (top-level + nested replies).
    const all = [];
    (function walk(children) {
      for (const child of children || []) {
        if (child.kind !== "t1") continue; // skip "more" placeholders
        const c = child.data;
        if (c && c.body) all.push(c);
        walk(c.replies?.data?.children);
      }
    })(data[1]?.data?.children);

    // OP's own follow-up comments — usually the richest extra context.
    const opComments = all
      .filter((c) => c.author === op)
      .map((c) => String(c.body).slice(0, 500));

    // Top community comments by score (excluding OP, already captured above).
    const topComments = all
      .filter((c) => c.author !== op)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 5)
      .map((c) => `[+${c.score}] ${String(c.body).slice(0, 400)}`);

    return {
      subreddit: post.subreddit,
      title: post.title,
      body: (post.selftext || "").slice(0, 1800),
      opComments,
      topComments,
    };
  }

  // ---- Generate ----------------------------------------------------------
  async function generate() {
    setStatus("Reading post…", "");
    draftEl.value = "";
    try {
      lastPost = await readPost();
    } catch (e) {
      setStatus(e.message, "err");
      return;
    }
    setStatus("Drafting…", "");
    sendToBackground({ type: "draft", post: lastPost });
  }

  // ---- Improve (refine the current draft with an instruction) -------------
  async function improve() {
    const instruction = refineEl.value.trim();
    const current = draftEl.value.trim();
    if (!current) {
      setStatus("Generate a draft first.", "err");
      return;
    }
    if (!instruction) {
      setStatus("Type what you'd like changed.", "err");
      return;
    }
    // If we don't have the post context cached, fetch it so the revision
    // still understands the original thread.
    if (!lastPost) {
      try {
        lastPost = await readPost();
      } catch (e) {
        setStatus(e.message, "err");
        return;
      }
    }
    setStatus("Improving…", "");
    sendToBackground({
      type: "refine",
      post: lastPost,
      draft: current,
      instruction,
    });
  }

  // Shared messaging + error handling for both draft and refine.
  function sendToBackground(message) {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          setStatus(chrome.runtime.lastError.message, "err");
          return;
        }
        if (!resp || resp.error) {
          setStatus(resp?.error || "Unknown error from background.", "err");
          return;
        }
        draftEl.value = resp.draft;
        refineEl.value = "";
        setStatus("Draft ready. Edit before posting.", "ok");
      });
    } catch (e) {
      // Thrown synchronously when the extension was reloaded but this tab's
      // old content script is still running ("Extension context invalidated").
      if (String(e.message).includes("context invalidated")) {
        setStatus("Extension was reloaded — refresh this Reddit tab (Cmd+R) and try again.", "err");
      } else {
        setStatus(e.message, "err");
      }
    }
  }
})();
