const keyEl = document.getElementById("key");
const modelEl = document.getElementById("model");
const instructionsEl = document.getElementById("instructions");
const voiceEl = document.getElementById("voice");
const savedEl = document.getElementById("saved");

// Load existing settings
chrome.storage.local.get(
  ["openaiKey", "model", "instructions", "voiceSamples"],
  (s) => {
    if (s.openaiKey) keyEl.value = s.openaiKey;
    if (s.model) modelEl.value = s.model;
    if (s.instructions) instructionsEl.value = s.instructions;
    if (s.voiceSamples) voiceEl.value = s.voiceSamples;
  }
);

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.set(
    {
      openaiKey: keyEl.value.trim(),
      model: modelEl.value,
      instructions: instructionsEl.value,
      voiceSamples: voiceEl.value,
    },
    () => {
      savedEl.textContent = "Saved.";
      setTimeout(() => (savedEl.textContent = ""), 1500);
    }
  );
});
