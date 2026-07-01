// Background service worker — holds the OpenAI call.
// Content scripts can't call api.openai.com directly (CORS), but the service
// worker can, because host_permissions grants it cross-origin fetch.
// The OpenAI call is isolated here so it can later be swapped for your own
// backend (the "sell to others" version) without touching the content script.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "draft") {
    draftReply(msg.post)
      .then((draft) => sendResponse({ draft }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep the message channel open for the async response
  }
  if (msg.type === "refine") {
    refineReply(msg.post, msg.draft, msg.instruction)
      .then((draft) => sendResponse({ draft }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

async function draftReply(post) {
  const { openaiKey, model, instructions, voiceSamples } =
    await chrome.storage.local.get([
      "openaiKey",
      "model",
      "instructions",
      "voiceSamples",
    ]);

  if (!openaiKey) {
    throw new Error("No OpenAI API key set. Click the extension icon → Settings.");
  }

  const system = buildSystemPrompt(post.subreddit, instructions, voiceSamples);
  const user = buildUserPrompt(post);

  return callOpenAI(openaiKey, model, [
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
}

async function refineReply(post, draft, instruction) {
  const { openaiKey, model, instructions, voiceSamples } =
    await chrome.storage.local.get([
      "openaiKey",
      "model",
      "instructions",
      "voiceSamples",
    ]);

  if (!openaiKey) {
    throw new Error("No OpenAI API key set. Click the extension icon → Settings.");
  }

  // Same persona/voice rules, but now revising an existing draft. We pass the
  // original thread context, the current draft, and the user's change request.
  const system = buildSystemPrompt(post.subreddit, instructions, voiceSamples);
  const user =
    buildUserPrompt(post) +
    `\n\nHere is the current draft reply:\n"""${draft}"""\n\n` +
    `Revise it based on this instruction: ${instruction}\n` +
    `Return only the revised reply, nothing else.`;

  return callOpenAI(openaiKey, model, [
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
}

async function callOpenAI(openaiKey, model, messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      max_tokens: 220,
      temperature: 0.9,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const out = data.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error("OpenAI returned no text.");
  return out;
}

function buildSystemPrompt(subreddit, instructions, voiceSamples) {
  let p =
    "You write Reddit comments that sound like a real person, to help the user build karma. " +
    "RULES:\n" +
    "- Keep it SHORT: 2-4 sentences, occasionally up to 6. Never multiple paragraphs.\n" +
    "- Casual and direct. Use contractions. It's fine to be a little blunt.\n" +
    "- React like a human would, not a counselor. Give one concrete take or piece of advice, not a balanced essay.\n" +
    "- BANNED phrases/patterns (these scream AI): 'It sounds like', 'It might help to', " +
    "'can go a long way', 'navigate', 'I'm sorry you're going through', 'reach out', " +
    "'communicate openly and honestly', 'resilient', em-dashes used like asides, and tidy 4-paragraph structure.\n" +
    "- No preamble, no sign-off, no bullet points, never mention being an AI.\n" +
    "- Sound like someone typing a quick reply on their phone, not writing an essay.";

  // Per-subreddit tone modifier
  const tone = {
    personalfinance:
      " This is r/personalfinance: be measured, practical, and concrete with numbers where relevant.",
    relationship_advice:
      " This is r/relationship_advice: be warm but honest, avoid being preachy.",
    Advice: " This is r/Advice: be supportive and down-to-earth.",
  };
  if (tone[subreddit]) p += tone[subreddit];

  // User's custom instructions (free-form, layered on top of the defaults)
  if (instructions && instructions.trim()) {
    p += "\n\nAdditional instructions from the user (follow these):\n" + instructions.trim();
  }

  // Few-shot voice samples (the user's own writing)
  if (voiceSamples && voiceSamples.trim()) {
    p +=
      "\n\nMatch the user's personal writing voice. Here are samples of how they write:\n" +
      voiceSamples.trim();
  }
  return p;
}

function buildUserPrompt(post) {
  const opFollowups = post.opComments?.length
    ? `\n\nOP's own follow-up comments (important extra context — use this):\n${post.opComments.join("\n\n")}`
    : "";
  const comments = post.topComments?.length
    ? `\n\nTop community comments so far:\n${post.topComments.join("\n\n")}`
    : "";
  return `Subreddit: r/${post.subreddit}\nTitle: ${post.title}\n\nPost:\n${post.body}${opFollowups}${comments}\n\nWrite a reply.`;
}
