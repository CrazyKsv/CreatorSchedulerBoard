#!/usr/bin/env bash
# test-plan/run.sh — run one / some / all API test suites.
#
# Usage:
#   ./run.sh                  # all suites
#   ./run.sh auth posts       # run suites matching those substrings
#   ./run.sh --verbose auth   # dump raw curl traffic
#   API_BASE=https://stg/api/v1 ./run.sh
#
# Exit code: number of failed suites (0 = all green).

set -u

# ---------- Resolve paths ----------
TEST_PLAN_ROOT="$(cd "$(dirname "$0")" && pwd)"
export TEST_PLAN_ROOT
# shellcheck source=lib/common.sh
source "$TEST_PLAN_ROOT/lib/common.sh"

# ---------- Args ----------
SUITE_FILTERS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --verbose|-v) export VERBOSE=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) SUITE_FILTERS+=("$1") ;;
  esac
  shift
done

# ---------- Preflight ----------
require_deps
require_server_up

# ---------- Enumerate suites ----------
suites=("$TEST_PLAN_ROOT"/suites/*.sh)

matches_filter() {
  local path="$1"
  [ ${#SUITE_FILTERS[@]} -eq 0 ] && return 0
  local name
  name="$(basename "$path" .sh)"
  for f in "${SUITE_FILTERS[@]}"; do
    case "$name" in
      *"$f"*) return 0 ;;
    esac
  done
  return 1
}

# ---------- Run ----------
printf "%sAPI test harness%s  base=%s\n" "$C_BOLD" "$C_RESET" "$API_BASE"

overall_passed=0
overall_failed=0
failed_suites=()

for suite in "${suites[@]}"; do
  [ -x "$suite" ] || chmod +x "$suite" 2>/dev/null || true
  matches_filter "$suite" || continue

  # Run in a subshell so each suite has isolated state (counters, token).
  # Capture exit code to tally.
  if bash "$suite"; then
    overall_passed=$((overall_passed + 1))
  else
    overall_failed=$((overall_failed + 1))
    failed_suites+=("$(basename "$suite" .sh)")
  fi
done

# ---------- Global summary ----------
printf "\n%s══════════════════════════════════════════════════%s\n" "$C_BOLD" "$C_RESET"
printf "%sOverall:%s %d suite(s) passed, %d suite(s) failed\n" \
  "$C_BOLD" "$C_RESET" "$overall_passed" "$overall_failed"

if [ "$overall_failed" -gt 0 ]; then
  printf "%sFailed suites:%s %s\n" "$C_RED" "$C_RESET" "${failed_suites[*]}"
  exit "$overall_failed"
fi

printf "%sAll green ✓%s\n" "$C_GREEN" "$C_RESET"
exit 0
