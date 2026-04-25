#!/usr/bin/env bash
# 05-family — clone joins family_id; clone-of-clone stays flat; unknown source 404.
set -u

if [ -z "${TEST_PLAN_ROOT:-}" ]; then
  TEST_PLAN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  export TEST_PLAN_ROOT
fi
# shellcheck source=../lib/common.sh
source "$TEST_PLAN_ROOT/lib/common.sh"
require_deps
require_server_up

begin_suite "05-family — clone-to-another-platform family grouping"

register_and_login "$(unique_email family)"

# Build the source series on Instagram. Space stages 3h apart so subsequent
# clone times don't trip the 15-min gap on the NEW platform either.
make_stages() {
  local platform="$1" prefix="$2" base="$3"
  local s1 s2 s3 s4
  s1="$(future_at "$base")"
  s2="$(future_at "$((base + 180))")"
  s3="$(future_at "$((base + 360))")"
  s4="$(future_at "$((base + 540))")"
  jq -nc \
    --arg platform "$platform" \
    --arg prefix "$prefix" \
    --arg s1 "$s1" --arg s2 "$s2" --arg s3 "$s3" --arg s4 "$s4" \
    '[
      {stage:"Teaser",       platform:$platform, title:($prefix + " — Teaser"),       body:null, scheduled_at:$s1},
      {stage:"Announcement", platform:$platform, title:($prefix + " — Announcement"), body:null, scheduled_at:$s2},
      {stage:"Follow-up",    platform:$platform, title:($prefix + " — Follow-up"),    body:null, scheduled_at:$s3},
      {stage:"Reminder",     platform:$platform, title:($prefix + " — Reminder"),     body:null, scheduled_at:$s4}
    ]'
}

# -----------------------------------------------------------------------
begin_test "POST /series source on IG — family_id == id"
body="$(jq -nc \
  --arg t "Spring Launch" \
  --argjson s "$(make_stages instagram "Spring IG" 180)" \
  '{title:$t, description:"Spring drop", stages:$s}')"
api_call POST /series "$body"
assert_status 201
SRC_ID="$(json_get .id)"
SRC_FAMILY="$(json_get .family_id)"
if [ -n "$SRC_ID" ] && [ "$SRC_ID" = "$SRC_FAMILY" ]; then
  pass_test "family_id == id ($SRC_ID)"
else
  fail_test "expected family_id == id, got id=$SRC_ID family_id=$SRC_FAMILY"
fi

# -----------------------------------------------------------------------
begin_test "POST /series clone to Twitter via source_series_id joins the family"
body="$(jq -nc \
  --arg t "Spring Launch (X)" \
  --argjson sid "$SRC_ID" \
  --argjson s "$(make_stages twitter "Spring X" 900)" \
  '{title:$t, description:"Spring drop X", stages:$s, source_series_id:$sid}')"
api_call POST /series "$body"
assert_status 201
CLONE_ID="$(json_get .id)"
CLONE_FAMILY="$(json_get .family_id)"
if [ "$CLONE_FAMILY" = "$SRC_ID" ]; then
  pass_test "clone.family_id == source.id ($SRC_ID)"
else
  fail_test "expected clone.family_id=$SRC_ID got $CLONE_FAMILY (clone id=$CLONE_ID)"
fi
if [ "$CLONE_ID" != "$CLONE_FAMILY" ]; then
  pass_test "clone.id ($CLONE_ID) != clone.family_id ($CLONE_FAMILY)"
else
  fail_test "clone should not self-reference — family_id=$CLONE_FAMILY equals own id"
fi

# -----------------------------------------------------------------------
begin_test "Clone-of-clone stays flat — still points at original anchor"
body="$(jq -nc \
  --arg t "Spring Launch (LinkedIn)" \
  --argjson sid "$CLONE_ID" \
  --argjson s "$(make_stages linkedin "Spring LI" 1620)" \
  '{title:$t, description:"Spring drop LI", stages:$s, source_series_id:$sid}')"
api_call POST /series "$body"
assert_status 201
GRAND_ID="$(json_get .id)"
GRAND_FAMILY="$(json_get .family_id)"
if [ "$GRAND_FAMILY" = "$SRC_ID" ]; then
  pass_test "grand.family_id == source.id (flat chain)"
else
  fail_test "expected grand.family_id=$SRC_ID got $GRAND_FAMILY — chain went linked-list"
fi

# -----------------------------------------------------------------------
begin_test "GET /series returns all 3 siblings, sharing family_id"
api_call GET /series
assert_status 200
same_family="$(
  echo "$RESPONSE_BODY" \
    | jq --argjson anchor "$SRC_ID" \
      '[.[] | select(.family_id == $anchor)] | length'
)"
if [ "$same_family" -ge 3 ]; then
  pass_test "list shows ≥3 rows with family_id=$SRC_ID (got $same_family)"
else
  fail_test "expected ≥3 rows with family_id=$SRC_ID, got $same_family"
fi

# -----------------------------------------------------------------------
begin_test "POST /series with unknown source_series_id returns 404"
body="$(jq -nc \
  --arg t "Dangling clone" \
  --argjson s "$(make_stages youtube "YT orphan" 2340)" \
  '{title:$t, stages:$s, source_series_id:999999999}')"
api_call POST /series "$body"
assert_status 404
assert_json_contains '.detail.error' "source_series_not_found"

# -----------------------------------------------------------------------
# Cleanup — delete clones first (to keep constraints clean), then source.
for id in "$GRAND_ID" "$CLONE_ID" "$SRC_ID"; do
  [ -n "$id" ] && api_call DELETE "/series/$id" >/dev/null
done

print_summary
