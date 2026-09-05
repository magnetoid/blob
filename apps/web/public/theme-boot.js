// Runs before first paint: the server's answer is a round trip away, so the last known
// palette is mirrored in localStorage and replayed here.
//
// A file rather than an inline <script> in index.html, because the Content-Security-Policy
// is `script-src 'self'`: an inline script needs a hash that changes with every build or a
// nonce that needs a server-rendered page, and Blob has neither. Same behaviour — a
// blocking script in <head> — from a URL the policy already allows.
try {
  var saved = JSON.parse(localStorage.getItem('blob.theme') || 'null');
  if (saved) {
    var root = document.documentElement;
    if (saved.preference && saved.preference !== 'system') {
      root.setAttribute('data-theme', saved.preference);
    }
    if (saved.mode) root.style.colorScheme = saved.mode;
    for (var name in saved.tokens || {}) {
      root.style.setProperty(name, saved.tokens[name]);
    }
  }
} catch (e) {}
