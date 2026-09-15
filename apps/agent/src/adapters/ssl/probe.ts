import { connect, type PeerCertificate } from 'node:tls';

export interface CertProbe {
  host: string;
  connected: boolean;
  subject?: string | undefined;
  issuer?: string | undefined;
  validFrom?: string | undefined; // ISO 8601
  validTo?: string | undefined; // ISO 8601
  daysUntilExpiry?: number | undefined;
  hostnameMatch?: boolean | undefined;
  chainValid?: boolean | undefined;
  error?: string | undefined;
}

export interface ProbeOptions {
  port?: number;
  timeoutMs?: number;
  /** Override the current time; used for testability of daysUntilExpiry. */
  now?: number;
}

/**
 * TLS probe a single host. Connects, reads the peer certificate, closes.
 * Does NOT use rejectUnauthorized — we want to report expired / mismatched
 * certs, not throw on them.
 */
export function probeCert(host: string, options: ProbeOptions = {}): Promise<CertProbe> {
  const port = options.port ?? 443;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now ?? Date.now();

  return new Promise<CertProbe>((resolve) => {
    const socket = connect({
      host,
      port,
      servername: host, // SNI
      rejectUnauthorized: false,
    });

    let settled = false;
    const settle = (result: CertProbe) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      settle({ host, connected: false, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    timeout.unref?.();

    socket.once('secureConnect', () => {
      clearTimeout(timeout);

      const peerCert = socket.getPeerCertificate(true);
      const authorized = socket.authorized;
      const authError = socket.authorizationError?.message;

      // Empty object = no certificate presented.
      if (!peerCert || Object.keys(peerCert).length === 0) {
        settle({ host, connected: true, error: 'no certificate presented' });
        return;
      }

      const validFromMs = peerCert.valid_from ? Date.parse(peerCert.valid_from) : NaN;
      const validToMs = peerCert.valid_to ? Date.parse(peerCert.valid_to) : NaN;
      const daysUntilExpiry = Number.isFinite(validToMs)
        ? Math.floor((validToMs - now) / 86_400_000)
        : undefined;

      const result: CertProbe = {
        host,
        connected: true,
        subject: formatDN(peerCert.subject as Record<string, string> | undefined),
        issuer: formatDN(peerCert.issuer as Record<string, string> | undefined),
        hostnameMatch: checkHostnameMatch(peerCert, host),
        chainValid: authorized,
      };
      if (Number.isFinite(validFromMs)) result.validFrom = new Date(validFromMs).toISOString();
      if (Number.isFinite(validToMs)) result.validTo = new Date(validToMs).toISOString();
      if (daysUntilExpiry !== undefined) result.daysUntilExpiry = daysUntilExpiry;
      if (!authorized && authError) result.error = authError;

      settle(result);
    });

    socket.once('error', (err: Error) => {
      clearTimeout(timeout);
      settle({ host, connected: false, error: err.message });
    });
  });
}

function formatDN(dn: Record<string, string> | undefined): string | undefined {
  if (!dn) return undefined;
  const entries = Object.entries(dn);
  if (entries.length === 0) return undefined;
  return entries.map(([k, v]) => `${k}=${v}`).join(', ');
}

export function hostnameMatches(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  const h = host.trim().toLowerCase();
  if (p === h) return true;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // includes the leading '.'
    if (!h.endsWith(suffix)) return false;
    const prefix = h.slice(0, h.length - suffix.length);
    // Wildcard must replace a single label; no dots in the prefix.
    return prefix.length > 0 && !prefix.includes('.');
  }
  return false;
}

function checkHostnameMatch(cert: PeerCertificate, host: string): boolean {
  const names: string[] = [];

  const san = cert.subjectaltname;
  if (san) {
    for (const entry of san.split(/,\s*/)) {
      const m = entry.match(/^DNS:(.+)$/i);
      if (m?.[1]) names.push(m[1]);
    }
  }

  const cn = (cert.subject as Record<string, string> | undefined)?.['CN'];
  if (cn && names.length === 0) {
    // Per RFC 6125, CN is only used as a fallback when SAN is absent.
    names.push(cn);
  }

  return names.some((n) => hostnameMatches(n, host));
}
