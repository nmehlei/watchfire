export const TELEGRAM_LIMIT = 4096;

/**
 * Split a composed message at section-divider boundaries (`━ `) so that no part
 * exceeds `limit` chars. If a single section exceeds the limit, split within it
 * at blank-line (paragraph) boundaries; within a paragraph, truncate with a
 * marker pointing the reader at the transcript.
 */
export function splitForTelegram(message: string, limit = TELEGRAM_LIMIT): string[] {
  if (message.length <= limit) return [message];

  const sections = splitAtSections(message);
  const parts: string[] = [];
  let buffer = '';

  for (const section of sections) {
    if (section.length > limit) {
      if (buffer) {
        parts.push(buffer);
        buffer = '';
      }
      parts.push(...splitAtParagraphs(section, limit));
      continue;
    }
    const candidate = buffer ? `${buffer}\n\n${section}` : section;
    if (candidate.length > limit) {
      parts.push(buffer);
      buffer = section;
    } else {
      buffer = candidate;
    }
  }

  if (buffer) parts.push(buffer);
  return parts;
}

function splitAtSections(message: string): string[] {
  const lines = message.split('\n');
  const sectionStarts: number[] = [0];
  for (let i = 1; i < lines.length; i++) {
    if (/^━ /.test(lines[i]!)) sectionStarts.push(i);
  }
  const sections: string[] = [];
  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i]!;
    const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1]! : lines.length;
    sections.push(lines.slice(start, end).join('\n'));
  }
  return sections;
}

function splitAtParagraphs(text: string, limit: number): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const parts: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (candidate.length > limit) {
      if (current) parts.push(current);
      current = p.length > limit ? truncateToLimit(p, limit) : p;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function truncateToLimit(s: string, limit: number): string {
  const suffix = '\n… [truncated; full text in transcript]';
  return s.slice(0, limit - suffix.length) + suffix;
}
