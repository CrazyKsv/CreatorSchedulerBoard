#!/usr/bin/env bash
# 07-ownership — cross-user isolation (FR-028).
#
# Confirms that user B cannot see or mutate user A's posts / series. Every
# protected endpoint should return 404 when the resource exists but is
# owned by someone else — the backend deliberately collapses "not yours"
# into "not found" so we don't leak resource existence across tenants.

set -u

if [ -z "${TEST_PLAN_ROOT:-}" ]; then
  TEST_PLAN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  export TEST_PLAN_ROOT
fi
# shellcheck source=../lib/common.sh
source "$TEST_PLAN_ROOT/lib/common.sh"
require_deps
require_server_up

begin_suite "07-ownership — user-A resources are invisible to user-B"

# ---------- Setup as user A ----------
EMAIL_A="$(unique_email alice)"
register_and_login "$EMAIL_A" "Password123!" "Alice"
TOKEN_A="$AUTH_TOKEN"

# Create a standalone post owned by A.
IG_AT="$(future_at 240)"
body="$(jq -nc --arg t "Alice's private post" --arg p "instagram" --arg at "$IG_AT" \
  '{title:$t, platform:$p, status:"scheduled", scheduled_at:$at}')"
api_call POST /posts "$body"
if [ "$HTTP_STATUS" != "201" ]; then
  printf "FATAL: couldn't seed user A's post (status=%s body=%s)\n" "$HTTP_STATUS" "$RESPONSE_BODY" >&2
  exit 1
fi
ALICE_POST_ID="$(json_get .id)"

# Create a 4-stage series owned by A.
S1="$(future_at 1440)"
S2="$(future_at 2880)"
S3="$(future_at 4320)"
S4="$(future_at 5760)"
stages="$(jq -nc \
  --arg s1 "$S1" --arg s2 "$S2" --arg s3 "$S3" --arg s4 "$S4" \
  '[
    {stage:"Teaser",       platform:"instagram", title:"A-T", body:null, scheduled_at:$s1},
    {stage:"Announcement", platform:"instagram", title:"A-A", body:null, scheduled_at:$s2},
    {stage:"Follow-up",    platform:"instagram", title:"A-F", body:null, scheduled_at:$s3},
    {stage:"Reminder",     platform:"instagram", title:"A-R", body:null, scheduled_at:$s4}
  ]')"
body="$(jq -nc --arg t "Alice's private series" --argjson s "$stages" \
  '{title:$t, description:"private", stages:$s}')"
api_call POST /series "$body"
if [ "$HTTP_STATUS" != "201" ]; then
  printf "FATAL: couldn't seed user A's series (status=%s body=%s)\n" "$HTTP_STATUS" "$RESPONSE_BODY" >&2
  exit 1
fi
ALICE_SERIES_ID="$(json_get .id)"

# ---------- Switch to user B ----------
EMAIL_B="$(unique_email bob)"
register_and_login "$EMAIL_B" "Password123!" "Bob"
# register_and_login re-assigned AUTH_TOKEN to B's token. Good.
TOKEN_B="$AUTH_TOKEN"

# -----------------------------------------------------------------------
# Posts — B cannot read/mutate A's post
# -----------------------------------------------------------------------
begin_test "user B: GET /posts/{A_post_id} returns 404"
api_call GET "/posts/$ALICE_POST_ID"
assert_status 404

begin_test "user B: PATCH /posts/{A_post_id} returns 404"
api_call PATCH "/posts/$ALICE_POST_ID" '{"title":"hijacked by Bob"}'
assert_status 404

begin_test "user B: POST /posts/{A_post_id}/archive returns 404"
api_call POST "/posts/$ALICE_POST_ID/archive"
assert_status 404

begin_test "user B: POST /posts/{A_post_id}/unarchive returns 404"
api_call POST "/posts/$ALICE_POST_ID/unarchive"
assert_status 404

begin_test "user B: DELETE /posts/{A_post_id} returns 404"
api_call DELETE "/posts/$ALICE_POST_ID"
assert_status 404

# -----------------------------------------------------------------------
# Series — B cannot read/mutate A's series
# -----------------------------------------------------------------------
begin_test "user B: GET /series/{A_series_id} returns 404"
api_call GET "/series/$ALICE_SERIES_ID"
assert_status 404

begin_test "user B: PATCH /series/{A_series_id} returns 404"
api_call PATCH "/series/$ALICE_SERIES_ID" '{"title":"hijacked by Bob"}'
assert_status 404

begin_test "user B: POST /series/{A_series_id}/archive returns 404"
api_call POST "/series/$ALICE_SERIES_ID/archive"
assert_status 404

begin_test "user B: POST /series/{A_series_id}/unarchive returns 404"
api_call POST "/series/$ALICE_SERIES_ID/unarchive"
assert_status 404

begin_test "user B: DELETE /series/{A_series_id} returns 404"
api_call DELETE "/series/$ALICE_SERIES_ID"
assert_status 404

# -----------------------------------------------------------------------
# Clone flow — B cannot clone A's series through source_series_id
# -----------------------------------------------------------------------
begin_test "user B: cloning A's series via source_series_id is rejected (404)"
body="$(jq -nc \
  --argjson sid "$ALICE_SERIES_ID" \
  --argjson s "$stages" \
  --arg t "Bob's steal" \
  '{title:$t, stages:$s, source_series_id:$sid}')"
api_call POST /series "$body"
assert_status 404
assert_json_contains '.detail.error' "source_series_not_found" \
  "structured error code"

# -----------------------------------------------------------------------
# List endpoints — B's lists must not leak A's rows
# -----------------------------------------------------------------------
begin_test "user B: GET /posts excludes user A's post"
api_call GET /posts
assert_status 200
leaked_posts="$(echo "$RESPONSE_BODY" | jq -r --argjson id "$ALICE_POST_ID" \
  '[.[] | select(.id == $id)] | length')"
if [ "$leaked_posts" = "0" ]; then
  pass_test "A's post (#$ALICE_POST_ID) absent from B's list"
else
  fail_test "A's post leaked into B's /posts list (count=$leaked_posts)"
fi

begin_test "user B: GET /series excludes user A's series"
api_call GET /series
assert_status 200
leaked_series="$(echo "$RESPONSE_BODY" | jq -r --argjson id "$ALICE_SERIES_ID" \
  '[.[] | select(.id == $id)] | length')"
if [ "$leaked_series" = "0" ]; then
  pass_test "A's series (#$ALICE_SERIES_ID) absent from B's list"
else
  fail_test "A's series leaked into B's /series list (count=$leaked_series)"
fi

# -----------------------------------------------------------------------
# Sanity — switching back to user A, resources are untouched
# -----------------------------------------------------------------------
AUTH_TOKEN="$TOKEN_A"

begin_test "user A: the post still exists with its original title"
api_call GET "/posts/$ALICE_POST_ID"
assert_status 200
assert_json_eq '.title' "Alice's private post" "title unchanged after B's attacks"

begin_test "user A: the series still exists with its original title"
api_call GET "/series/$ALICE_SERIES_ID"
assert_status 200
assert_json_eq '.title' "Alice's private series" "title unchanged after B's attacks"

# -----------------------------------------------------------------------
# Cleanup — delete everything as the respective owner.
api_call DELETE "/posts/$ALICE_POST_ID"     >/dev/null
api_call DELETE "/series/$ALICE_SERIES_ID"  >/dev/null

print_summary
