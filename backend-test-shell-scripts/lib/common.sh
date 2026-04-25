#!/usr/bin/env bash
# test-plan/lib/common.sh — shared helpers for curl-based API tests.
#
# Sourced by every suite (and by run.sh). DO NOT execute directly.
#
# Provides:
#   - API_BASE / VERBOSE configuration
#   - api_call METHOD PATH [JSON_BODY]  -> fills HTTP_STATUS + RESPONSE_BODY
#   - register_and_login EMAIL [PW] [NAME]  -> fills AUTH_TOKEN
#   - assert_status / assert_json_eq / assert_json_nonempty / assert_json_contains
#   - begin_test / pass_test / fail_test / print_summary
#   - future_at MINUTES -> ISO datetime string, portable across BSD + GNU date
#
# Design notes:
#   - No `set -e`: we want to continue on test failures so the summary tallies
#     everything. We do rely on `set -u` to catch typos in test code.
#   - Uses mktemp files for curl response bodies — simpler than -w with
#     HEREDOC and plays nicer with multi-line JSON.

set -u

# ---------- Config ----------
API_BASE="${API_BASE:-http://localhost:8000/api/v1}"
VERBOSE="${VERBOSE:-0}"

# Resolve the test-plan root once so suites can be run from anywhere.
if [ -z "${TEST_PLAN_ROOT:-}" ]; then
  # shellcheck disable=SC2155
  TEST_PLAN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
FIXTURES_DIR="$TEST_PLAN_ROOT/fixtures"
mkdir -p "$FIXTURES_DIR"

# ---------- Colors ----------
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && tput setaf 1 >/dev/null 2>&1; then
  C_RED="$(tput setaf 1)"
  C_GREEN="$(tput setaf 2)"
  C_YELLOW="$(tput setaf 3)"
  C_BLUE="$(tput setaf 4)"
  C_DIM="$(tput dim 2>/dev/null || printf '\033[2m')"
  C_BOLD="$(tput bold)"
  C_RESET="$(tput sgr0)"
else
  C_RED="" C_GREEN="" C_YELLOW="" C_BLUE="" C_DIM="" C_BOLD="" C_RESET=""
fi

# ---------- State ----------
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
ASSERTIONS_RUN=0
FAILED_DETAILS=()

CURRENT_SUITE_TITLE=""
CURRENT_TEST_NAME=""

AUTH_TOKEN=""
HTTP_STATUS=""
RESPONSE_BODY=""

# ---------- Logging ----------
_info() { printf "  %s%s%s\n" "$C_DIM" "$*" "$C_RESET"; }
_note() { printf "  %s%s%s\n" "$C_BLUE" "$*" "$C_RESET"; }
_warn() { printf "  %s%s%s\n" "$C_YELLOW" "$*" "$C_RESET"; }
_pass() { printf "    %s✓%s %s\n" "$C_GREEN" "$C_RESET" "$*"; }
_fail() { printf "    %s✗%s %s\n" "$C_RED" "$C_RESET" "$*"; }

begin_suite() {
  CURRENT_SUITE_TITLE="$1"
  printf "\n%s━━━ %s ━━━%s\n" "$C_BOLD" "$CURRENT_SUITE_TITLE" "$C_RESET"
}

begin_test() {
  CURRENT_TEST_NAME="$1"
  TESTS_RUN=$((TESTS_RUN + 1))
  printf "%s[%02d]%s %s\n" "$C_DIM" "$TESTS_RUN" "$C_RESET" "$CURRENT_TEST_NAME"
}

pass_test() {
  ASSERTIONS_RUN=$((ASSERTIONS_RUN + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  _pass "${1:-ok}"
}

fail_test() {
  ASSERTIONS_RUN=$((ASSERTIONS_RUN + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAILED_DETAILS+=("$CURRENT_SUITE_TITLE :: $CURRENT_TEST_NAME :: $*")
  _fail "$*"
  if [ "${SHOW_BODY_ON_FAIL:-1}" = "1" ]; then
    local body_preview
    body_preview="$(echo "$RESPONSE_BODY" | head -c 400)"
    printf "      %sstatus=%s body=%s%s\n" "$C_DIM" "$HTTP_STATUS" "$body_preview" "$C_RESET"
  fi
}

print_summary() {
  printf "\n%sSummary:%s %d tests, %d assertion(s) passed" \
    "$C_BOLD" "$C_RESET" "$TESTS_RUN" "$TESTS_PASSED"
  if [ "$TESTS_FAILED" -gt 0 ]; then
    printf " %s(%d failed)%s\n" "$C_RED" "$TESTS_FAILED" "$C_RESET"
    printf "\n%sFailed tests:%s\n" "$C_RED" "$C_RESET"
    for d in "${FAILED_DETAILS[@]}"; do
      printf "  • %s\n" "$d"
    done
    return 1
  fi
  printf " %s✓%s\n" "$C_GREEN" "$C_RESET"
  return 0
}

# ---------- API helper ----------
# Usage: api_call METHOD PATH [JSON_BODY]
# After return: HTTP_STATUS (int as string) and RESPONSE_BODY are set.
api_call() {
  local method="$1" path="$2" body="${3:-}"
  local url="$API_BASE$path"
  local tmp
  tmp="$(mktemp "$FIXTURES_DIR/resp.XXXXXX")"

  local -a headers=(-H "Accept: application/json")
  if [ -n "$body" ]; then
    headers+=(-H "Content-Type: application/json")
  fi
  if [ -n "$AUTH_TOKEN" ]; then
    headers+=(-H "Authorization: Bearer $AUTH_TOKEN")
  fi

  if [ "$VERBOSE" = "1" ]; then
    printf "    %s→ %s %s%s\n" "$C_DIM" "$method" "$url" "$C_RESET"
    [ -n "$body" ] && printf "      %sbody:%s %s\n" "$C_DIM" "$C_RESET" "$body"
  fi

  if [ -n "$body" ]; then
    HTTP_STATUS="$(
      curl --silent --show-error \
        -o "$tmp" \
        -w "%{http_code}" \
        -X "$method" \
        "${headers[@]}" \
        --data "$body" \
        "$url"
    )"
  else
    HTTP_STATUS="$(
      curl --silent --show-error \
        -o "$tmp" \
        -w "%{http_code}" \
        -X "$method" \
        "${headers[@]}" \
        "$url"
    )"
  fi

  RESPONSE_BODY="$(cat "$tmp")"
  rm -f "$tmp"

  if [ "$VERBOSE" = "1" ]; then
    printf "      %s← %s%s %s\n" "$C_DIM" "$HTTP_STATUS" "$C_RESET" "$RESPONSE_BODY"
  fi
}

# ---------- Assertions ----------
assert_status() {
  local expected="$1" label="${2:-}"
  if [ "$HTTP_STATUS" = "$expected" ]; then
    pass_test "status $expected${label:+ ($label)}"
  else
    fail_test "expected status $expected but got $HTTP_STATUS${label:+ — $label}"
  fi
}

assert_status_in() {
  # Accept any of the space-separated codes; useful when the server may
  # return 200 or 201 for similar success semantics.
  local actual="$HTTP_STATUS"
  for code in "$@"; do
    if [ "$actual" = "$code" ]; then
      pass_test "status $actual (allowed: $*)"
      return
    fi
  done
  fail_test "expected status in ($*) but got $actual"
}

# Extracts a jq path from RESPONSE_BODY; returns empty string on null/missing.
json_get() {
  local path="$1"
  echo "$RESPONSE_BODY" | jq -r "$path // empty" 2>/dev/null
}

# Extract raw JSON (does NOT unquote strings) — useful for nested objects.
json_get_raw() {
  local path="$1"
  echo "$RESPONSE_BODY" | jq -c "$path" 2>/dev/null
}

assert_json_eq() {
  local path="$1" expected="$2" label="${3:-}"
  local actual
  actual="$(json_get "$path")"
  if [ "$actual" = "$expected" ]; then
    pass_test "${label:-$path} == $expected"
  else
    fail_test "${label:-$path}: expected '$expected' got '$actual'"
  fi
}

assert_json_nonempty() {
  local path="$1" label="${2:-}"
  local actual
  actual="$(json_get "$path")"
  if [ -n "$actual" ]; then
    pass_test "${label:-$path} is present"
  else
    fail_test "${label:-$path}: expected non-empty value, got empty"
  fi
}

assert_json_contains() {
  local path="$1" needle="$2" label="${3:-}"
  local actual
  actual="$(json_get "$path")"
  if echo "$actual" | grep -qF -- "$needle"; then
    pass_test "${label:-$path} contains '$needle'"
  else
    fail_test "${label:-$path}: expected to contain '$needle' but got '$actual'"
  fi
}

assert_json_int_gt() {
  local path="$1" threshold="$2" label="${3:-}"
  local actual
  actual="$(json_get "$path")"
  if [ -n "$actual" ] && [ "$actual" -gt "$threshold" ] 2>/dev/null; then
    pass_test "${label:-$path} > $threshold (got $actual)"
  else
    fail_test "${label:-$path}: expected integer > $threshold, got '$actual'"
  fi
}

assert_json_eq_int() {
  # Same as assert_json_eq but normalizes both sides with jq tonumber so
  # we don't care whether the value came through as '4' vs '4.0'.
  local path="$1" expected="$2" label="${3:-}"
  local actual
  actual="$(echo "$RESPONSE_BODY" | jq -r "$path | tonumber? // empty")"
  if [ "$actual" = "$expected" ]; then
    pass_test "${label:-$path} == $expected"
  else
    fail_test "${label:-$path}: expected int '$expected' got '$actual'"
  fi
}

assert_json_array_length() {
  local path="$1" expected="$2" label="${3:-}"
  local actual
  actual="$(echo "$RESPONSE_BODY" | jq -r "$path | length // 0")"
  if [ "$actual" = "$expected" ]; then
    pass_test "${label:-$path} has length $expected"
  else
    fail_test "${label:-$path}: expected length $expected got $actual"
  fi
}

assert_json_array_length_at_least() {
  local path="$1" min="$2" label="${3:-}"
  local actual
  actual="$(echo "$RESPONSE_BODY" | jq -r "$path | length // 0")"
  if [ -n "$actual" ] && [ "$actual" -ge "$min" ] 2>/dev/null; then
    pass_test "${label:-$path} length ≥ $min (got $actual)"
  else
    fail_test "${label:-$path}: expected length ≥ $min, got $actual"
  fi
}

# ---------- Auth ----------
# Register (tolerating "already exists") + login + stash token.
register_and_login() {
  local email="$1" password="${2:-Password123!}" full_name="${3:-Test Creator}"

  local body
  body="$(jq -nc \
    --arg e "$email" --arg p "$password" --arg n "$full_name" \
    '{email:$e,password:$p,full_name:$n}')"
  api_call POST /auth/register "$body"
  # Register: 200 / 201 on success, 400/409 on duplicate. Either is OK — we
  # just want to get a token next.

  body="$(jq -nc --arg e "$email" --arg p "$password" '{email:$e,password:$p}')"
  api_call POST /auth/login "$body"
  if [ "$HTTP_STATUS" != "200" ]; then
    printf "%sFATAL:%s could not log in as %s (status=%s): %s\n" \
      "$C_RED" "$C_RESET" "$email" "$HTTP_STATUS" "$RESPONSE_BODY" >&2
    exit 1
  fi

  AUTH_TOKEN="$(json_get .access_token)"
  if [ -z "$AUTH_TOKEN" ]; then
    printf "%sFATAL:%s login response missing access_token\n" "$C_RED" "$C_RESET" >&2
    exit 1
  fi
}

clear_auth() { AUTH_TOKEN=""; }

# ---------- Time helpers (BSD + GNU compatible) ----------
# Minutes-from-now in ISO-8601 (naive; matches what the frontend + backend
# use post-004 TZ fix).
future_at() {
  local minutes="${1:-0}"
  # Try BSD (macOS) first; fall back to GNU.
  if date -u -v+"${minutes}"M +"%Y-%m-%dT%H:%M:%S" >/dev/null 2>&1; then
    date -u -v+"${minutes}"M +"%Y-%m-%dT%H:%M:%S"
  elif date -u -d "+${minutes} minutes" +"%Y-%m-%dT%H:%M:%S" >/dev/null 2>&1; then
    date -u -d "+${minutes} minutes" +"%Y-%m-%dT%H:%M:%S"
  else
    printf "%sFATAL:%s neither BSD nor GNU date recognized\n" "$C_RED" "$C_RESET" >&2
    exit 1
  fi
}

# ---------- Fresh identities ----------
unique_email() {
  local prefix="${1:-tester}"
  echo "${prefix}-$(date +%s)-$$-${RANDOM}@example.com"
}

# ---------- Platform + stage helpers ----------
stage_payload() {
  # Usage: stage_payload STAGE_LABEL PLATFORM TITLE MINUTES_FROM_NOW
  # Emits a single JSON object for use inside a stages[] array.
  local stage="$1" platform="$2" title="$3" minutes="$4"
  local at
  at="$(future_at "$minutes")"
  jq -nc \
    --arg stage "$stage" \
    --arg platform "$platform" \
    --arg title "$title" \
    --arg at "$at" \
    '{stage:$stage, platform:$platform, title:$title, body:null, scheduled_at:$at}'
}

# ---------- Preflight ----------
require_deps() {
  local missing=()
  for dep in curl jq; do
    command -v "$dep" >/dev/null 2>&1 || missing+=("$dep")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    printf "%sFATAL:%s missing required tool(s): %s\n" "$C_RED" "$C_RESET" "${missing[*]}" >&2
    printf "  Install with: brew install %s  |  apt-get install %s\n" "${missing[*]}" "${missing[*]}" >&2
    exit 1
  fi
}

# Quick reachability probe — hits a protected endpoint expecting 401.
require_server_up() {
  # Use curl directly since api_call would carry any stale AUTH_TOKEN.
  local code
  code="$(
    curl --silent --show-error -o /dev/null -w "%{http_code}" \
      --max-time 5 \
      -H "Accept: application/json" \
      "$API_BASE/series" 2>/dev/null
  )" || code=""
  if [ -z "$code" ] || [ "$code" = "000" ]; then
    printf "%sFATAL:%s backend not reachable at %s\n" "$C_RED" "$C_RESET" "$API_BASE" >&2
    printf "       start it with: cd backend && uvicorn app.main:app --reload --port 8000\n" >&2
    exit 1
  fi
  if [ "$code" != "401" ] && [ "$code" != "403" ]; then
    printf "%sWARNING:%s /series returned %s (expected 401 when unauthenticated)\n" \
      "$C_YELLOW" "$C_RESET" "$code" >&2
  fi
}
