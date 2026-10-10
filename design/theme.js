(function () {
  var K = 'kapture-theme', t = 'dark';
  try { t = localStorage.getItem(K) || 'dark'; } catch (e) {}
  var root = document.documentElement;
  root.setAttribute('data-theme', t);
  function mount() {
    var b = document.createElement('button');
    b.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:1000;font:400 12px/16px var(--font-mono);padding:6px 12px;border:1px solid var(--rule-strong);border-radius:4px;background:var(--surface);color:var(--fg);cursor:pointer';
    function label() { b.textContent = root.getAttribute('data-theme') === 'dark' ? 'switch to light' : 'switch to dark'; }
    b.onclick = function () {
      var n = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', n);
      try { localStorage.setItem(K, n); } catch (e) {}
      label();
    };
    label();
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
