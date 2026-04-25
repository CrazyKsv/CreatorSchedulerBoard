#!/usr/bin/env bash
# 03-posts — CRUD + archive / unarchive + 15-minute platform gap rule.
set -u

if [ -z "${TEST_PLAN_ROOT:-}" ]; then
  TEST_PLAN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  export TEST_PLAN_ROOT
fi
# shellcheck source=../lib/common.sh
source "$TEST_PLAN_ROOT/lib/common.sh"
require_deps
require_server_up

begin_suite "03-posts — CRUD + archive + 15-minute platform gap"

register_and_login "$(unique_email posts)"

# We need enough future space for all the gap checks; pick a base 2 hours out.
BASE_MIN=120
IG_AT="$(future_at "$BASE_MIN")"
IG_AT_PLUS_10="$(future_at "$((BASE_MIN + 10))")"   # same platform, 10 min later
IG_AT_PLUS_20="$(future_at "$((BASE_MIN + 20))")"   # same platform, 20 min later (outside gap)
X_AT_PLUS_10="$(future_at "$((BASE_MIN + 10))")"    # different platform, 10 min later

# -----------------------------------------------------------------------
begin_test "POST /posts creates a scheduled post"
body="$(jq -nc \
  --arg t "Studio opening teaser" \
  --arg p "instagram" \
  --arg at "$IG_AT" \
  '{title:$t, platform:$p, status:"scheduled", scheduled_at:$at}')"
api_call POST /posts "$body"
assert_status 201
assert_json_nonempty '.id' "new post id"
assert_json_eq '.platform' "instagram"
assert_json_eq '.status' "scheduled"
POST_ID="$(json_get .id)"

# -----------------------------------------------------------------------
begin_test "GET /posts includes the new post"
api_call GET /posts
assert_status 200
assert_json_int_gt '[.[] | select(.id == '"$POST_ID"')] | length' 0 "created post present"

# -----------------------------------------------------------------------
begin_test "GET /posts/{id} returns the post"
api_call GET "/posts/$POST_ID"
assert_status 200
assert_json_eq '.id' "$POST_ID"
assert_json_eq '.title' "Studio opening teaser"

# -----------------------------------------------------------------------
begin_test "PATCH /posts/{id} updates the title"
api_call PATCH "/posts/$POST_ID" '{"title":"Studio opening — teaser"}'
assert_status 200
assert_json_eq '.title' "Studio opening — teaser"

# -----------------------------------------------------------------------
begin_test "POST /posts within 15 min on same platform is rejected (409)"
body="$(jq -nc \
  --arg t "Second IG post (should conflict)" \
  --arg p "instagram" \
  --arg at "$IG_AT_PLUS_10" \
  '{title:$t, platform:$p, status:"scheduled", scheduled_at:$at}')"
api_call POST /posts "$body"
assert_status 409
assert_json_contains '.detail.error' "platform_gap_conflict" "error code"

# -----------------------------------------------------------------------
begin_test "POST /posts on a different platform within 15 min is accepted"
body="$(jq -nc \
  --arg t "X post — different channel" \
  --arg p "twitter" \
  --arg at "$X_AT_PLUS_10" \
  '{title:$t, platform:$p, status:"scheduled", scheduled_at:$at}')"
api_call POST /posts "$body"
assert_status 201
X_POST_ID="$(json_get .id)"

# -----------------------------------------------------------------------
begin_test "POST /posts on same platform but ≥15 min later is accepted"
body="$(jq -nc \
  --arg t "Later IG post — outside gap" \
  --arg p "instagram" \
  --arg at "$IG_AT_PLUS_20" \
  '{title:$t, platform:$p, status:"scheduled", scheduled_at:$at}')"
api_call POST /posts "$body"
assert_status 201
LATE_IG_ID="$(json_get .id)"

# -----------------------------------------------------------------------
begin_test "POST /posts/{id}/archive flips status to archived"
api_call POST "/posts/$POST_ID/archive"
assert_status 200
assert_json_eq '.status' "archived"

# -----------------------------------------------------------------------
begin_test "POST /posts/{id}/unarchive restores the prior status"
api_call POST "/posts/$POST_ID/unarchive"
assert_status 200
assert_json_eq '.status' "scheduled"

# -----------------------------------------------------------------------
begin_test "DELETE /posts/{id} removes the post (204)"
api_call DELETE "/posts/$POST_ID"
assert_status 204

# -----------------------------------------------------------------------
begin_test "GET /posts/{id} after delete returns 404"
api_call GET "/posts/$POST_ID"
assert_status 404

# Cleanup the posts we created that didn't get deleted above.
api_call DELETE "/posts/$X_POST_ID"       >/dev/null
api_call DELETE "/posts/$LATE_IG_ID"      >/dev/null

# -----------------------------------------------------------------------
print_summary
