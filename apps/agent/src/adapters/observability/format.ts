import type { SearchHit, SearchLogsResult, StreamInfo } from './openobserve.js';

function short(s: string | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Pretty-print a search result as compact log lines. */
export function renderSearchResult(r: SearchLogsResult, tenant: string, stream: string): string {
  const lines: string[] = [];
  lines.push(
    `tenant=${tenant} stream=${stream} hits=${r.hits.length} total=${r.total} took=${r.tookMs}ms`,
  );
  if (r.hits.length === 0) {
    lines.push('(no hits)');
    return lines.join('\n');
  }
  for (const h of r.hits) {
    lines.push(formatHit(h));
  }
  return lines.join('\n');
}

function formatHit(h: SearchHit): string {
  const ts = h.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  const lvl = h.level ? `[${h.level}]`.padEnd(8) : ''.padEnd(8);
  const svc = h.service ? `${h.service} `.padEnd(20) : ''.padEnd(20);
  const msg = short(oneLine(h.message), 180);
  return `${ts} ${lvl} ${svc} ${msg}`;
}

export function renderStreams(tenant: string, streams: readonly StreamInfo[]): string {
  const lines: string[] = [`tenant=${tenant} streams=${streams.length}`];
  if (streams.length === 0) {
    lines.push('(none)');
    return lines.join('\n');
  }
  for (const s of streams) {
    const type = s.type ? ` [${s.type}]` : '';
    const storage = s.storageType ? ` storage=${s.storageType}` : '';
    lines.push(`  ${s.name}${type}${storage}`);
  }
  return lines.join('\n');
}
