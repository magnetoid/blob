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
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute(
        "content",
        tokens["--primary"] || (mode === "dark" ? "#e5e5e5" : "#171717"),
      );
    }
  } else if (
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    var defaultThemeColor = document.querySelector('meta[name="theme-color"]');
    if (defaultThemeColor) defaultThemeColor.setAttribute("content", "#e5e5e5");
  }
} catch (e) {}
