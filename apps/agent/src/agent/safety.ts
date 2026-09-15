// Safety hook — pre-tool-use inspector for shell commands the agent wants to run.
// See specs/08-safety.md.
//
// Three outcomes:
//   - allow: execute normally.
//   - soft-block: synthetic tool result returned to the agent; it can retry.
//   - hard-block: agent loop terminates; runs.status = 'error',
//     runs.error prefixed with 'safety:'.
//
// Credentials are the primary read-only boundary. This hook is belt-and-suspenders
// with ergonomics: soft-block dominates so the agent can self-correct.

export type SafetyDecision =
  | { kind: 'allow' }
  | { kind: 'soft-block'; reason: string; hint?: string }
  | { kind: 'hard-block'; reason: string };

// ────────────────────────────────────────────────────────────────────────────
// Hard-block patterns. Match the whole command string (can span subcommands
// — e.g. `curl ... | sh`). Regex forms are conceptual; tests pin behavior.
// ────────────────────────────────────────────────────────────────────────────

interface HardBlockPattern {
  name: string;
  re: RegExp;
  reason: string;
}

const HARD_BLOCK_PATTERNS: readonly HardBlockPattern[] = [
  // Destructive file ops
  {
    name: 'rm-recursive-or-force',
    re: /\brm\b[^|;&]*?(-[a-zA-Z]*[rRfF]|--recursive|--force)/,
    reason: 'destructive: rm with -r/-f/--recursive/--force',
  },
  { name: 'mkfs', re: /\bmkfs\b/, reason: 'destructive: filesystem format' },
  {
    name: 'dd-of-dev',
    re: /\bdd\b[^|;&]*?\bof=\/dev\//,
    reason: 'destructive: dd writing to a device',
  },

  // Privilege escalation
  { name: 'sudo-su-doas', re: /\b(sudo|doas|su)\b(?!\w)/, reason: 'privilege escalation' },

  // Shell execution from data
  {
    name: 'pipe-to-shell',
    re: /\|\s*(sh|bash|zsh|ash|dash)\b/,
    reason: 'shell execution from data (... | sh)',
  },
  { name: 'eval', re: /\beval\b/, reason: 'eval' },
  {
    name: 'shell-c-quoted',
    re: /\b(bash|sh|zsh|ash|dash)\b\s+-c\b/,
    reason: 'shell -c invocation',
  },

  // Block-device or raw-disk redirects
  { name: 'device-redirect', re: />\s*\/dev\/(sd[a-z]|nvme)/, reason: 'raw-disk redirect' },

  // Secret-path reads
  {
    name: 'secret-path-read',
    re: /\b(cat|less|more|head|tail|strings|xxd|od|base64|cp|tar|rsync)\b[^|;&]*?(\/run\/iris\/|\/etc\/iris\/secrets\/)/,
    reason: 'secret path read',
  },

  // Background / async
  { name: 'trailing-bg', re: /(?:^|[^&])&\s*$/, reason: 'background job (trailing &)' },
  { name: 'nohup-disown', re: /\b(nohup|disown)\b/, reason: 'nohup/disown' },
  { name: 'heredoc', re: /<<-?['"]?\w+/, reason: 'heredoc' },
  { name: 'exec-redirect', re: /\bexec\b\s*[<>]/, reason: 'exec redirection' },

  // Permission relaxation
  { name: 'chmod-permissive', re: /\bchmod\b\s+(777|a\+rwx|a\+x|\+rwx)/, reason: 'chmod permissive' },
  { name: 'chown', re: /\bchown\b/, reason: 'chown' },
];

function checkHardBlock(command: string): SafetyDecision | null {
  for (const p of HARD_BLOCK_PATTERNS) {
    if (p.re.test(command)) {
      return { kind: 'hard-block', reason: p.reason };
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Subcommand split — by top-level pipes, && / ||, and semicolons.
// Subshells ($(...)/ backticks) contribute their inner text as extra subcommands.
// ────────────────────────────────────────────────────────────────────────────

function splitSubcommands(command: string): string[] {
  const subshells: string[] = [];
  let working = command;

  // Extract $(...) subshells.
  working = working.replace(/\$\(([^)]*)\)/g, (_m, inner: string) => {
    subshells.push(inner);
    return ' ';
  });
  // Extract `...` subshells.
  working = working.replace(/`([^`]*)`/g, (_m, inner: string) => {
    subshells.push(inner);
    return ' ';
  });

  const tokens = working
    .split(/\|\||&&|\||;/)
    .map((s) => s.trim())
    .filter(Boolean);

  return [...tokens, ...subshells];
}

// ────────────────────────────────────────────────────────────────────────────
// Adapter-level allowlists.
// ────────────────────────────────────────────────────────────────────────────

function stripTenantFlag(args: string): string {
  return args.replace(/^\s*--tenant\s+\S+\s+/, '').trim();
}

function firstNonFlag(args: string): string {
  return (
    args
      .split(/\s+/)
      .find((t) => t.length > 0 && !t.startsWith('-')) ?? '?'
  );
}

function checkAzAs(command: string): SafetyDecision {
  const m = command.match(/^az-as(?:\s+(.*))?$/);
  if (!m) return { kind: 'allow' };
  const args = stripTenantFlag(m[1] ?? '');
  if (!args) return { kind: 'allow' };

  if (/^monitor\s+(metrics|activity-log|log-analytics)\b/.test(args)) {
    return { kind: 'allow' };
  }
  if (/^(\S+\s+)?(show|list|get|query)\b/.test(args)) {
    return { kind: 'allow' };
  }

  const verb = firstNonFlag(args);
  return {
    kind: 'soft-block',
    reason: `az-as: verb "${verb}" not in allowlist`,
    hint: 'Watchfire is read-only. Use az-as ... show/list/get/query, or ... monitor metrics/activity-log/log-analytics.',
  };
}

function checkHcloudAs(command: string): SafetyDecision {
  const m = command.match(/^hcloud-as(?:\s+(.*))?$/);
  if (!m) return { kind: 'allow' };
  const args = stripTenantFlag(m[1] ?? '');
  if (!args) return { kind: 'allow' };

  if (/^(\S+\s+)?(list|describe)\b/.test(args)) {
    return { kind: 'allow' };
  }

  const verb = firstNonFlag(args);
  return {
    kind: 'soft-block',
    reason: `hcloud-as: verb "${verb}" not in allowlist`,
    hint: 'Watchfire is read-only. Use hcloud-as ... list or ... describe.',
  };
}

const KUBECTL_ALLOWED_VERBS = new Set([
  'get',
  'describe',
  'logs',
  'top',
  'explain',
  'api-resources',
  'api-versions',
]);

const KUBECTL_MUTATION_HINTS: Record<string, string> = {
  edit: 'Use `kubectl-as describe` to inspect; Watchfire cannot mutate.',
  delete: 'Watchfire is read-only. To inspect, try `describe` or `logs`.',
  exec: 'Shell-into-pod is not permitted. Read container state via `logs` or `describe`.',
  apply: 'Watchfire is read-only.',
  patch: 'Watchfire is read-only.',
  scale: 'Watchfire is read-only.',
  rollout: 'Watchfire is read-only.',
  drain: 'Watchfire is read-only.',
  cordon: 'Watchfire is read-only.',
  uncordon: 'Watchfire is read-only.',
  create: 'Watchfire is read-only.',
  run: 'Watchfire is read-only.',
  replace: 'Watchfire is read-only.',
  label: 'Watchfire is read-only.',
  annotate: 'Watchfire is read-only.',
};

function checkKubectlAs(command: string): SafetyDecision {
  const m = command.match(/^kubectl-as(?:\s+(.*))?$/);
  if (!m) return { kind: 'allow' };
  const args = stripTenantFlag(m[1] ?? '');
  if (!args) return { kind: 'allow' };

  const first = args.split(/\s+/)[0] ?? '';

  if (KUBECTL_ALLOWED_VERBS.has(first)) return { kind: 'allow' };

  if (first === 'auth') {
    if (/^auth\s+can-i\b/.test(args)) return { kind: 'allow' };
    return {
      kind: 'soft-block',
      reason: 'kubectl-as: only `auth can-i` permitted under auth',
      hint: 'Use `kubectl-as auth can-i <verb> <resource>` to check permissions.',
    };
  }
  if (first === 'config') {
    if (/^config\s+view\b/.test(args)) return { kind: 'allow' };
    return {
      kind: 'soft-block',
      reason: 'kubectl-as: only `config view` permitted under config',
      hint: 'Use `kubectl-as config view`.',
    };
  }

  const hint =
    KUBECTL_MUTATION_HINTS[first] ??
    'Use kubectl-as get/describe/logs/top/explain/api-resources/api-versions/auth can-i/config view.';
  return {
    kind: 'soft-block',
    reason: `kubectl-as: verb "${first}" not in allowlist`,
    hint,
  };
}

// Obs and check adapters are read-only by construction; anything goes.
const UNRESTRICTED_ADAPTERS = new Set([
  'ssh-as',
  'obs-search',
  'obs-metrics',
  'obs-streams',
  'obs-alerts',
  'check-ssl',
  'check-http',
  'check-ado',
]);

// ────────────────────────────────────────────────────────────────────────────
// Generic-utility allowlist (composes tool output on the Watchfire host side).
// ────────────────────────────────────────────────────────────────────────────

const GENERIC_UTILS = new Set([
  'cat',
  'grep',
  'egrep',
  'fgrep',
  'head',
  'tail',
  'wc',
  'sort',
  'uniq',
  'cut',
  'awk',
  'sed',
  'tr',
  'jq',
  'date',
  'echo',
  'printf',
  'test',
  '[',
  'true',
  'false',
]);

function checkSed(args: string): SafetyDecision {
  // -i / --in-place mutates files in place.
  if (/(^|\s)-i\b/.test(args) || /(^|\s)--in-place\b/.test(args)) {
    return {
      kind: 'soft-block',
      reason: 'sed -i edits files in place',
      hint: 'Use sed without -i and redirect to a new file if you need persistence.',
    };
  }
  return { kind: 'allow' };
}

// ────────────────────────────────────────────────────────────────────────────
// Single-subcommand check.
// ────────────────────────────────────────────────────────────────────────────

function checkSingleCommand(sub: string): SafetyDecision {
  const trimmed = sub.trim();
  if (!trimmed) return { kind: 'allow' };

  const tokens = trimmed.split(/\s+/);
  const head = tokens[0]!;
  const args = tokens.slice(1).join(' ');

  // Strip leading ENV=val assignments — they shift the head to the next token.
  if (/^[A-Z_][A-Z0-9_]*=\S+$/.test(head)) {
    return checkSingleCommand(tokens.slice(1).join(' '));
  }

  // Adapter wrappers.
  if (head === 'az-as') return checkAzAs(trimmed);
  if (head === 'hcloud-as') return checkHcloudAs(trimmed);
  if (head === 'kubectl-as') return checkKubectlAs(trimmed);
  if (UNRESTRICTED_ADAPTERS.has(head)) return { kind: 'allow' };

  // emit-finding and conclude-watch are SDK tools, not Bash — but if the
  // agent ever invokes them through Bash, treat as allowed (defense in depth
  // is at the SDK layer).
  if (head === 'emit-finding' || head === 'conclude-watch') return { kind: 'allow' };

  // curl / wget — redirect to adapters.
  if (head === 'curl' || head === 'wget') {
    return {
      kind: 'soft-block',
      reason: `${head} is not a permitted adapter`,
      hint: 'Use `check-http` for endpoint probes, `obs-*` for OpenObserve, or an adapter.',
    };
  }

  // Generic utilities.
  if (GENERIC_UTILS.has(head)) {
    if (head === 'sed') return checkSed(args);
    return { kind: 'allow' };
  }

  return {
    kind: 'soft-block',
    reason: `unrecognized command: ${head}`,
    hint: 'Use an Watchfire adapter from the system prompt.',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public entry point.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Inspect a Bash command before the Agent SDK executes it.
 * Most-restrictive outcome wins (hard-block > soft-block > allow).
 */
export function checkBashCommand(command: string): SafetyDecision {
  const hard = checkHardBlock(command);
  if (hard) return hard;

  const subs = splitSubcommands(command);
  let firstSoft: { kind: 'soft-block'; reason: string; hint?: string } | null = null;
  for (const sub of subs) {
    const result = checkSingleCommand(sub);
    if (result.kind === 'hard-block') return result;
    if (result.kind === 'soft-block' && !firstSoft) firstSoft = result;
  }
  return firstSoft ?? { kind: 'allow' };
}
