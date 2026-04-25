#!/usr/bin/env bash
# 04-series — 4-stage create / mixed-platform rejection / archive cascade.
set -u

if [ -z "${TEST_PLAN_ROOT:-}" ]; then
  TEST_PLAN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  export TEST_PLAN_ROOT
fi
# shellcheck source=../lib/common.sh
source "$TEST_PLAN_ROOT/lib/common.sh"
require_deps
require_server_up

begin_suite "04-series — create / validate / archive cascade"

register_and_login "$(unique_email series)"

# Build 4 stages on Instagram, spaced a few hours apart so the 15-min gap is
# satisfied and the stage ordering is strictly monotonic.
S1="$(future_at 180)"
S2="$(future_at 360)"
S3="$(future_at 540)"
S4="$(future_at 720)"

STAGES_OK="$(jq -nc \
  --arg s1 "$S1" --arg s2 "$S2" --arg s3 "$S3" --arg s4 "$S4" \
  '[
    {stage:"Teaser",       platform:"instagram", title:"IG teaser",       body:null, scheduled_at:$s1},
    {stage:"Announcement", platform:"instagram", title:"IG announce",     body:null, scheduled_at:$s2},
    {stage:"Follow-up",    platform:"instagram", title:"IG follow-up",    body:null, scheduled_at:$s3},
    {stage:"Reminder",     platform:"instagram", title:"IG reminder",     body:null, scheduled_at:$s4}
  ]')"

# -----------------------------------------------------------------------
begin_test "POST /series — 4-stage happy path creates series + 4 posts"
body="$(jq -nc \
  --arg t "Studio Launch" \
  --argjson stages "$STAGES_OK" \
  '{title:$t, description:"Studio grand opening", stages:$stages}')"
api_call POST /series "$body"
assert_status 201
assert_json_eq '.title' "Studio Launch"
assert_json_eq '.platform' "instagram" "derived single-platform column"
assert_json_array_length '.posts' 4 "stage post count"
# The source series should be its own family anchor.
SERIES_ID="$(json_get .id)"
FAMILY_ID="$(json_get .family_id)"
if [ "$SERIES_ID" = "$FAMILY_ID" ]; then
  pass_test "family_id == id ($FAMILY_ID)"
else
  fail_test "family_id $FAMILY_ID does not match series id $SERIES_ID"
fi

# -----------------------------------------------------------------------
begin_test "GET /series/{id} returns the series with its posts"
api_call GET "/series/$SERIES_ID"
assert_status 200
assert_json_eq_int '.id' "$SERIES_ID"
assert_json_array_length '.posts' 4

# -----------------------------------------------------------------------
begin_test "GET /series lists the new series"
api_call GET /series
assert_status 200
assert_json_int_gt '[.[] | select(.id == '"$SERIES_ID"')] | length' 0 "created series present"

# -----------------------------------------------------------------------
begin_test "POST /series with <4 stages is rejected (422)"
THREE_STAGES="$(echo "$STAGES_OK" | jq -c '.[:3]')"
body="$(jq -nc --arg t "Too short" --argjson s "$THREE_STAGES" '{title:$t, stages:$s}')"
api_call POST /series "$body"
assert_status 422

# -----------------------------------------------------------------------
begin_test "POST /series with mixed platforms is rejected (422 mixed_platform_series)"
MIXED="$(echo "$STAGES_OK" | jq -c '[.[0] + {platform:"instagram"},
                                      .[1] + {platform:"twitter"},
                                      .[2] + {platform:"instagram"},
                                      .[3] + {platform:"twitter"}]')"
body="$(jq -nc --arg t "Mixed" --argjson s "$MIXED" '{title:$t, stages:$s}')"
api_call POST /series "$body"
assert_status 422
# Pydantic ValidationError surfaces the message; ensure it mentions our guard.
assert_json_contains '.detail' "platform" "validation mentions platform"

# -----------------------------------------------------------------------
begin_test "POST /series with wrong stage label at position 0 is rejected (422 invalid_stage_order)"
# Keep the time + object in position 0, but mislabel it so the backend's
# position-vs-label check catches it (Step 2 in create_series). This is
# distinct from sequential_integrity_violation (which checks times).
MISLABELED="$(echo "$STAGES_OK" | jq -c '[
  (.[0] | .stage = "Announcement"),
  .[1], .[2], .[3]
]')"
body="$(jq -nc --arg t "Mislabeled" --argjson s "$MISLABELED" '{title:$t, stages:$s}')"
api_call POST /series "$body"
assert_status 422
assert_json_contains '.detail.error' "invalid_stage_order" "error code"

# -----------------------------------------------------------------------
begin_test "POST /series/{id}/archive cascades to child posts"
api_call POST "/series/$SERIES_ID/archive"
assert_status 200
assert_json_eq '.status' "archived"
archived_posts="$(echo "$RESPONSE_BODY" | jq -r '[.posts[] | select(.status != "archived")] | length')"
if [ "$archived_posts" = "0" ]; then
  pass_test "every child post is archived"
else
  fail_test "$archived_posts child posts were NOT archived"
fi

# -----------------------------------------------------------------------
begin_test "POST /series/{id}/unarchive restores series + child posts"
api_call POST "/series/$SERIES_ID/unarchive"
assert_status 200
assert_json_eq '.status' "active"
restored_scheduled="$(echo "$RESPONSE_BODY" | jq -r '[.posts[] | select(.status == "scheduled")] | length')"
if [ "$restored_scheduled" = "4" ]; then
  pass_test "all 4 child posts restored to 'scheduled'"
else
  fail_test "expected 4 scheduled posts after unarchive, got $restored_scheduled"
fi

# -----------------------------------------------------------------------
begin_test "DELETE /series/{id} succeeds when nothing is published (204)"
api_call DELETE "/series/$SERIES_ID"
assert_status 204

# -----------------------------------------------------------------------
begin_test "GET /series/{id} after delete returns 404"
api_call GET "/series/$SERIES_ID"
assert_status 404

# -----------------------------------------------------------------------
print_summary
