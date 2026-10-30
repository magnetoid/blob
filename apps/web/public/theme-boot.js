// Runs before first paint: the server's answer is a round trip away, so the last known
// palette is mirrored in localStorage and replayed here.
//
// A file rather than an inline <script> in index.html, because the Content-Security-Policy
// is `script-src 'self'`: an inline script needs a hash that changes with every build or a
// nonce that needs a server-rendered page, and Blob has neither. Same behaviour — a
// blocking script in <head> — from a URL the policy already allows.
try {
  // `.v2` since the palette is written in shadcn's names: an entry under the old key
  // holds `--accent` as Blob's brand green, which would now paint shadcn's hover wash.
  var saved = JSON.parse(localStorage.getItem("blob.theme.v2") || "null");
  if (!saved) {
    // The first load after the move has nothing under `.v2` yet. Whoever chose a mode
    // keeps it — otherwise a viewer who chose dark on a light OS sees a light page until
    // the bootstrap answers — but only the choice is read from the old entry, never its
    // tokens: they are Blob's old names.
    var previous = JSON.parse(localStorage.getItem("blob.theme") || "null");
    if (
      previous &&
      (previous.preference === "light" || previous.preference === "dark")
    ) {
      saved = { preference: previous.preference, mode: previous.preference };
    }
  }
  if (saved) {
    var root = document.documentElement;
    if (saved.preference && saved.preference !== "system") {
      root.setAttribute("data-theme", saved.preference);
    }
    var systemMode =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    var mode =
      saved.preference === "light" || saved.preference === "dark"
        ? saved.preference
        : systemMode;
    var tokens =
      (saved.palettes && saved.palettes[mode]) ||
      (saved.mode === mode ? saved.tokens : {}) ||
      {};
    var tokenNames = [];
    root.dataset.resolvedTheme = mode;
    root.style.colorScheme = mode;
    for (var name in tokens) {
      root.style.setProperty(name, tokens[name]);
      tokenNames.push(name);
    }
    root.dataset.themeTokens = tokenNames.join(" ");
    // Browser chrome follows the page (`--background`), as in lib/theme.ts. This writes the
    // stored value raw — it may be oklch() or rgb() — and hydration normalises it to hex.
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute(
        "content",
        tokens["--background"] || (mode === "dark" ? "#0a0a0a" : "#ffffff"),
      );
    }
  } else if (
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    var defaultThemeColor = document.querySelector('meta[name="theme-color"]');
    if (defaultThemeColor) defaultThemeColor.setAttribute("content", "#0a0a0a");
  }
} catch (e) {}
