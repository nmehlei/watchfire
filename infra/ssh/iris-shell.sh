#!/usr/bin/env bash
# iris-shell — forced SSH command on Watchfire target hosts.
# See specs/08-safety.md §Layer 3.
#
# Invoked via authorized_keys command="/usr/local/bin/iris-shell".
# Parses $SSH_ORIGINAL_COMMAND against a strict allowlist of read-only
# binaries and exits 2 with a single stderr line on any deviation.

set -u  # not -e: we want to die via explicit `die` calls with clear messages.

PATHS_ALLOW="${IRIS_PATHS_ALLOW:-/etc/iris/paths.allow}"

die() {
  echo "iris-shell: $1" >&2
  exit 2
}

orig="${SSH_ORIGINAL_COMMAND:-}"
[[ -n "$orig" ]] || die "no command"

# Tokenize on whitespace with no escape processing.
read -r -a args <<< "$orig"
cmd="${args[0]:-}"
[[ -n "$cmd" ]] || die "empty command"

# Check a path against the per-host whitelist. Each line is a bash glob pattern;
# blank / comment lines ignored.
check_path() {
  local candidate="$1" pattern
  [[ -f "$PATHS_ALLOW" ]] || die "paths.allow missing at $PATHS_ALLOW"
  while IFS= read -r pattern; do
    [[ -z "$pattern" || "$pattern" =~ ^[[:space:]]*# ]] && continue
    # shellcheck disable=SC2254
    case "$candidate" in
      $pattern) return 0 ;;
    esac
  done < "$PATHS_ALLOW"
  return 1
}

case "$cmd" in
  df)
    case "${#args[@]}" in
      1) exec df ;;
      2)
        [[ "${args[1]}" == "-h" ]] || die "command not permitted: df ${args[1]}"
        exec df -h
        ;;
      3)
        [[ "${args[1]}" == "-h" ]] || die "command not permitted: df ${args[1]}"
        exec df -h "${args[2]}"
        ;;
      *) die "command not permitted: df (too many args)" ;;
    esac
    ;;

  free)
    case "${#args[@]}" in
      1) exec free ;;
      2)
        [[ "${args[1]}" == "-h" ]] || die "command not permitted: free ${args[1]}"
        exec free -h
        ;;
      *) die "command not permitted: free (too many args)" ;;
    esac
    ;;

  uptime)
    [[ "${#args[@]}" -eq 1 ]] || die "command not permitted: uptime (no args)"
    exec uptime
    ;;

  journalctl)
    # --since is mandatory (prevents unbounded log dumps).
    has_since=false
    i=1
    while [[ $i -lt ${#args[@]} ]]; do
      case "${args[i]}" in
        --since|--since=*) has_since=true ;;
        -u|-n|--no-pager) ;;
        *)
          # Allow values that follow -u, --since (when space-separated), or -n.
          prev="${args[$((i-1))]:-}"
          case "$prev" in
            -u|--since|-n) ;;
            *) die "command not permitted: journalctl ${args[i]}" ;;
          esac
          ;;
      esac
      i=$((i + 1))
    done
    $has_since || die "command not permitted: journalctl without --since"
    exec journalctl "${args[@]:1}"
    ;;

  tail)
    # tail -n <N> <whitelisted-log-path>
    [[ "${#args[@]}" -eq 4 ]] || die "command not permitted: tail must be 'tail -n <N> <path>'"
    [[ "${args[1]}" == "-n" ]] || die "command not permitted: tail ${args[1]}"
    [[ "${args[2]}" =~ ^[0-9]+$ ]] || die "command not permitted: tail -n needs a number"
    check_path "${args[3]}" || die "command not permitted: path not in paths.allow: ${args[3]}"
    exec tail -n "${args[2]}" "${args[3]}"
    ;;

  ps)
    case "${args[*]:1}" in
      "") exec ps ;;
      "aux") exec ps aux ;;
      "-ef") exec ps -ef ;;
      *) die "command not permitted: ps ${args[*]:1}" ;;
    esac
    ;;

  ss)
    case "${args[*]:1}" in
      "") exec ss ;;
      "-t") exec ss -t ;;
      "-tn") exec ss -tn ;;
      "-l") exec ss -l ;;
      *) die "command not permitted: ss ${args[*]:1}" ;;
    esac
    ;;

  systemctl)
    [[ "${args[1]:-}" == "status" ]] || die "command not permitted: systemctl without status"
    [[ -n "${args[2]:-}" ]] || die "command not permitted: systemctl status needs a unit"
    [[ "${#args[@]}" -eq 3 ]] || die "command not permitted: systemctl status (single unit only)"
    exec systemctl status "${args[2]}"
    ;;

  cat)
    [[ "${#args[@]}" -eq 2 ]] || die "command not permitted: cat (single path only)"
    check_path "${args[1]}" || die "command not permitted: path not in paths.allow: ${args[1]}"
    exec cat "${args[1]}"
    ;;

  *)
    die "command not permitted: $cmd"
    ;;
esac
