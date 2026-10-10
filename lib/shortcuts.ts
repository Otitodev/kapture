export function isMacPlatform(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return /Mac|iPhone|iPad/i.test(userAgent);
}

/** 'mod+shift+1' -> '⌘ ⇧ 1' on macOS, 'Ctrl ⇧ 1' elsewhere. */
export function formatShortcut(combo: string, mac: boolean = isMacPlatform()): string {
  return combo
    .split('+')
    .map((part) => {
      switch (part.toLowerCase()) {
        case 'mod':
          return mac ? '⌘' : 'Ctrl';
        case 'shift':
          return '⇧';
        case 'alt':
          return mac ? '⌥' : 'Alt';
        default:
          return part.toUpperCase();
      }
    })
    .join(' ');
}
