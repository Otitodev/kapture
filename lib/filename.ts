export const DEFAULT_FILENAME_TEMPLATE = '{domain}-{date}-{time}';

interface FilenameInput {
  url?: string;
  title?: string;
  date?: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

function domainOf(url?: string): string {
  if (!url) return 'capture';
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'capture';
  } catch {
    return 'capture';
  }
}

/** Expands {domain} {title} {date} {time} and strips characters Windows and macOS reject. */
export function buildFilename(template: string, input: FilenameInput = {}): string {
  const d = input.date ?? new Date();
  const values: Record<string, string> = {
    domain: domainOf(input.url),
    title: input.title?.trim() || 'untitled',
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`,
  };
  const expanded = (template || DEFAULT_FILENAME_TEMPLATE).replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
  const cleaned = expanded
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .slice(0, 120);
  return cleaned || 'capture';
}
