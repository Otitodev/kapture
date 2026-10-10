// Replaces <i data-i="name" data-s="18"></i> with an inline stroke icon.
(function () {
  var I = {
    select: '<path d="M5 3l14 8-6 2-2 6z"/>',
    arrow: '<path d="M5 19L19 5M9 5h10v10"/>',
    box: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
    pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    blur: '<path d="M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z"/>',
    steps: '<circle cx="12" cy="12" r="8"/><path d="M11 9l1-1v8"/>',
    crop: '<path d="M7 3v14h14M3 7h14v14"/>',
    undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>',
    redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
    micoff: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3M4 4l16 16"/>',
    cam: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
    screen: '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M9 20h6"/>',
    visible: '<path d="M4 9V6a2 2 0 012-2h3M15 4h3a2 2 0 012 2v3M20 15v3a2 2 0 01-2 2h-3M9 20H6a2 2 0 01-2-2v-3"/>',
    region: '<rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 3"/>',
    fullpage: '<rect x="7" y="3" width="10" height="18" rx="1"/><path d="M12 8v8M9.5 13.5L12 16l2.5-2.5"/>',
    element: '<rect x="4" y="4" width="12" height="12" rx="1"/><path d="M12 12l8 3-3.5 1.5L15 20z"/>',
    delay: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 1.5M9.5 3h5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
    list: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="8" cy="9" r="1"/>',
    trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    draw: '<path d="M3 17c3-8 5-8 7-3s4 3 11-8"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    sparkle: '<path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    pin: '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/>',
    user: '<circle cx="12" cy="9" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4M8.5 11h5M11 8.5v5"/>'
  };
  function run() {
    document.querySelectorAll('i[data-i]').forEach(function (el) {
      var s = el.getAttribute('data-s') || 18;
      var w = el.getAttribute('data-w') || 1.6;
      var svg = '<svg class="i ' + (el.className || '') + '" width="' + s + '" height="' + s +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + w +
        '" stroke-linecap="round" stroke-linejoin="round">' + (I[el.getAttribute('data-i')] || '') + '</svg>';
      el.outerHTML = svg;
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
