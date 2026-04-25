#!/usr/bin/env bash
# 06-e2e-scenario — full creator workflow end-to-end.
#
# Simulates Mira, a creator:
#   1. Registers + logs in.
#   2. Drafts two standalone posts on different platforms (within minutes of each
#      other — the 15-min rule permits this because platforms differ).
#   3. Schedules a 4-stage Instagram launch series (Spring Drop).
#   4. Clones the launch to Twitter via source_series_id.
#   5. Verifies both series share a family_id (the UI groups them into one card).
#   6. Archives the Twitter clone; verifies its stage posts cascade to archived.
#   7. Unarchives — restores status.
#   8. Deletes the Twitter clone (no published posts → allowed).
#   9. Confirms the Instagram source is untouched.
#
# This suite is the best single artefact to run against a deployment — it
# exercises every major code path the frontend depends on, in sequence.

set -u

if [ -z "${TEST_PLAN_ROOT:-}" ]; then
  TEST_PLAN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  export TEST_PLAN_ROOT
fi
# shellcheck source=../lib/common.sh
source "$TEST_PLAN_ROOT/lib/common.sh"
require_deps
require_server_up

begin_suite "06-e2e-scenario — full creator workflow"

# -----------------------------------------------------------------------
begin_test "Mira registers + logs in"
EMAIL="$(unique_email mira)"
register_and_login "$EMAIL" "Password123!" "Mira K."
pass_test "logged in as $EMAIL"

# -----------------------------------------------------------------------
begin_test "Mira drafts an IG post + an X post within 10 min of each other"
IG_AT="$(future_at 90)"
X_AT="$(future_at 100)"  # 10 min after IG — different platform, so OK

body="$(jq -nc --arg t "Studio BTS" --arg p "instagram" --arg at "$IG_AT" \
  '{title:$t, platform:$p, status:"scheduled", scheduled_at:$at}')"
api_call POST /posts "$body"
assert_status 201
IG_POST_ID="$(json_get .id)"

body="$(jq -nc --arg t "Quick pricing note" --arg p "twitter" --arg at "$X_AT" \
  '{title:$t, platform:$p, status:"scheduled", scheduled_at:$at}')"
api_call POST /posts "$body"
assert_status 201
X_POST_ID="$(json_get .id)"

# -----------------------------------------------------------------------
begin_test "Mira builds a 4-stage Instagram Spring Drop series"
S1="$(future_at 1440)"   # ~1 day out
S2="$(future_at 2880)"   # +1 day
S3="$(future_at 4320)"   # +1 day
S4="$(future_at 5760)"   # +1 day

stages_ig="$(jq -nc \
  --arg s1 "$S1" --arg s2 "$S2" --arg s3 "$S3" --arg s4 "$S4" \
  '[
    {stage:"Teaser",       platform:"instagram", title:"Something is coming",     body:null, scheduled_at:$s1},
    {stage:"Announcement", platform:"instagram", title:"Spring Drop is live",     body:null, scheduled_at:$s2},
    {stage:"Follow-up",    platform:"instagram", title:"What people said",        body:null, scheduled_at:$s3},
    {stage:"Reminder",     platform:"instagram", title:"Last call — 48 hours",    body:null, scheduled_at:$s4}
  ]')"

body="$(jq -nc --arg t "Spring Drop" \
  --arg d "IG launch: teaser → announcement → follow-up → reminder" \
  --argjson s "$stages_ig" \
  '{title:$t, description:$d, stages:$s}')"
api_call POST /series "$body"
assert_status 201
SRC_ID="$(json_get .id)"
assert_json_array_length '.posts' 4 "4 stage posts created"
assert_json_eq_int '.family_id' "$SRC_ID" "source is its own family anchor"

# -----------------------------------------------------------------------
begin_test "Mira clones Spring Drop to Twitter"
# Use times that are at least 15 min away from any Twitter post already in
# the system (we created one X post at ~100 min out). Schedule the clone's
# first stage well into the future.
T1="$(future_at 10080)"   # ~7 days out
T2="$(future_at 11520)"
T3="$(future_at 12960)"
T4="$(future_at 14400)"

stages_x="$(jq -nc \
  --arg s1 "$T1" --arg s2 "$T2" --arg s3 "$T3" --arg s4 "$T4" \
  '[
    {stage:"Teaser",       platform:"twitter", title:"Thread incoming",        body:null, scheduled_at:$s1},
    {stage:"Announcement", platform:"twitter", title:"Spring Drop live — link", body:null, scheduled_at:$s2},
    {stage:"Follow-up",    platform:"twitter", title:"Sold out of [item]",      body:null, scheduled_at:$s3},
    {stage:"Reminder",     platform:"twitter", title:"Restock on Friday",       body:null, scheduled_at:$s4}
  ]')"

body="$(jq -nc \
  --arg t "Spring Drop (X)" \
  --arg d "X launch arc — mirrors the IG timeline on a separate channel" \
  --argjson sid "$SRC_ID" \
  --argjson s "$stages_x" \
  '{title:$t, description:$d, stages:$s, source_series_id:$sid}')"
api_call POST /series "$body"
assert_status 201
CLONE_ID="$(json_get .id)"
assert_json_eq_int '.family_id' "$SRC_ID" "clone joins source's family"

# -----------------------------------------------------------------------
begin_test "Listing series shows both members sharing family_id"
api_call GET /series
assert_status 200
family_members="$(
  echo "$RESPONSE_BODY" \
    | jq --argjson anchor "$SRC_ID" '[.[] | select(.family_id == $anchor)] | length'
)"
if [ "$family_members" = "2" ]; then
  pass_test "found 2 members with family_id=$SRC_ID"
else
  fail_test "expected exactly 2 family members, got $family_members"
fi

# -----------------------------------------------------------------------
begin_test "Archiving the X clone cascades to its 4 stage posts"
api_call POST "/series/$CLONE_ID/archive"
assert_status 200
assert_json_eq '.status' "archived"
non_archived_children="$(echo "$RESPONSE_BODY" | jq -r '[.posts[] | select(.status != "archived")] | length')"
if [ "$non_archived_children" = "0" ]; then
  pass_test "every child post is archived alongside the series"
else
  fail_test "$non_archived_children child posts stayed un-archived"
fi

# -----------------------------------------------------------------------
begin_test "Unarchiving the X clone restores it + children"
api_call POST "/series/$CLONE_ID/unarchive"
assert_status 200
assert_json_eq '.status' "active"
restored="$(echo "$RESPONSE_BODY" | jq -r '[.posts[] | select(.status == "scheduled")] | length')"
if [ "$restored" = "4" ]; then
  pass_test "all 4 child posts back to 'scheduled'"
else
  fail_test "expected 4 scheduled children, got $restored"
fi

# -----------------------------------------------------------------------
begin_test "Deleting the X clone is allowed (no published posts)"
api_call DELETE "/series/$CLONE_ID"
assert_status 204
api_call GET "/series/$CLONE_ID"
assert_status 404

# -----------------------------------------------------------------------
begin_test "The IG source is untouched by the X clone's deletion"
api_call GET "/series/$SRC_ID"
assert_status 200
assert_json_eq_int '.id' "$SRC_ID"
assert_json_eq '.platform' "instagram"
assert_json_array_length '.posts' 4 "source still has its 4 stages"

# -----------------------------------------------------------------------
# Teardown — clean up everything we created so repeat runs stay fast.
api_call DELETE "/series/$SRC_ID"    >/dev/null
api_call DELETE "/posts/$IG_POST_ID" >/dev/null
api_call DELETE "/posts/$X_POST_ID"  >/dev/null

print_summary
