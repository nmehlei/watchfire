import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SHELL = fileURLToPath(new URL('./watchfire-shell.sh', import.meta.url));

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

let tempDir: string;
let pathsAllow: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'watchfire-shell-test-'));
  pathsAllow = join(tempDir, 'paths.allow');
  writeFileSync(
    pathsAllow,
    [
      '# test paths',
      '/var/log/syslog',
      '/var/log/mssql/*.log',
      '/etc/nginx/nginx.conf',
      '',
    ].join('\n'),
  );
});

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

function run(sshOriginalCommand: string): RunResult {
  const result = spawnSync('bash', [SHELL], {
    env: {
      ...process.env,
      SSH_ORIGINAL_COMMAND: sshOriginalCommand,
      WATCHFIRE_PATHS_ALLOW: pathsAllow,
    },
    encoding: 'utf8',
    timeout: 5000,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('watchfire-shell — denial', () => {
  it('empty command exits 2', () => {
    const r = run('');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/watchfire-shell: no command/);
  });

  it.each([
    ['rm -rf /', 'rm'],
    ['sudo ls', 'sudo'],
    ['cat /etc/shadow', 'path'], // not in paths.allow
    ['echo hi', 'echo'],
    ['nc -l 4444', 'nc'],
    ['bash -c "x"', 'bash'],
  ])('denies %s', (cmd) => {
    const r = run(cmd);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/watchfire-shell: command not permitted/);
  });

  it('denies journalctl without --since', () => {
    const r = run('journalctl -u kubelet --no-pager');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/without --since/);
  });

  it('denies tail without -n', () => {
    const r = run('tail /var/log/syslog');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/tail/);
  });

  it('denies tail on a non-whitelisted path', () => {
    const r = run('tail -n 10 /etc/shadow');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/paths.allow/);
  });

  it('denies cat on a non-whitelisted path', () => {
    const r = run('cat /etc/shadow');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/paths.allow/);
  });

  it('denies systemctl without status', () => {
    const r = run('systemctl restart kubelet');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/without status/);
  });

  it('denies systemctl status with extra args', () => {
    const r = run('systemctl status kubelet --no-pager');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/single unit only/);
  });

  it('denies ps with unexpected flags', () => {
    const r = run('ps -f --forest');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/ps/);
  });
});

describe('watchfire-shell — permit (dispatch OK, exec may still succeed/fail)', () => {
  // We can't reliably exec these in a test sandbox (df/free might not exist
  // in minimal containers), so we test that watchfire-shell's gate passes.
  // Strategy: override PATH to point at a stub dir that returns 0.

  let stubDir: string;
  const stubCommand = (name: string) => join(stubDir, name);

  beforeAll(() => {
    stubDir = mkdtempSync(join(tmpdir(), 'watchfire-shell-stubs-'));
    for (const name of ['df', 'free', 'uptime', 'journalctl', 'tail', 'ps', 'ss', 'systemctl', 'cat']) {
      writeFileSync(
        stubCommand(name),
        '#!/bin/sh\necho "STUB: ' + name + ' $@"\nexit 0\n',
        { mode: 0o755 },
      );
      // macOS (Gatekeeper/XProtect) scans a brand-new executable the first
      // time it's exec'd, adding a multi-second one-off delay that can blow
      // past the per-test spawnSync timeout below — especially for whichever
      // stub happens to run first in the suite. Trigger that scan here, once,
      // outside any timed assertion, so every timed run below hits the fast
      // (already-scanned) path. Sequential and unbounded on purpose: a
      // concurrent version of this warmup was tried and made things worse
      // (heavy contention on the scan, observed 240s+ hangs) — sequential,
      // one at a time, is the reliable shape here.
      spawnSync(stubCommand(name), [], { timeout: 10_000 });
    }
  }, 60_000);

  afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

  function runWithStubs(cmd: string): RunResult {
    const result = spawnSync('bash', [SHELL], {
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env['PATH']}`,
        SSH_ORIGINAL_COMMAND: cmd,
        WATCHFIRE_PATHS_ALLOW: pathsAllow,
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    return {
      code: result.status ?? -1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  it.each([
    'df',
    'df -h',
    'df -h /data',
    'free',
    'free -h',
    'uptime',
    'journalctl --since 1h',
    'journalctl --since=1h',
    'journalctl --since 1h -u kubelet',
    'journalctl --since 1h --no-pager',
    'tail -n 100 /var/log/syslog',
    'ps',
    'ps aux',
    'ps -ef',
    'ss',
    'ss -tn',
    'systemctl status kubelet',
  ])('permits %s', (cmd) => {
    const r = runWithStubs(cmd);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('STUB:');
  });

  it('permits tail on a glob-matched path', () => {
    const r = runWithStubs('tail -n 50 /var/log/mssql/errorlog.log');
    expect(r.code).toBe(0);
  });

  it('permits cat on a whitelisted config path', () => {
    const r = runWithStubs('cat /etc/nginx/nginx.conf');
    expect(r.code).toBe(0);
  });
});
