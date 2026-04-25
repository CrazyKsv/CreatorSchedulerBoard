#!/usr/bin/env bash
# 02-auth — register / login / duplicate / wrong-password / 401.
set -u

if [ -z "${TEST_PLAN_ROOT:-}" ]; then
  TEST_PLAN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  export TEST_PLAN_ROOT
fi
# shellcheck source=../lib/common.sh
source "$TEST_PLAN_ROOT/lib/common.sh"
require_deps
require_server_up

begin_suite "02-auth — register / login / 401"

EMAIL="$(unique_email auth)"
PW="Password123!"
NAME="Auth Tester"

# -----------------------------------------------------------------------
begin_test "POST /auth/register creates a new user"
clear_auth
api_call POST /auth/register "$(jq -nc \
  --arg e "$EMAIL" --arg p "$PW" --arg n "$NAME" \
  '{email:$e,password:$p,full_name:$n}')"
# Implementation may return 200 or 201.
assert_status_in 200 201
assert_json_nonempty '.id' "new user id"
assert_json_eq '.email' "$EMAIL" "echoed email"

# -----------------------------------------------------------------------
begin_test "POST /auth/register with the same email is rejected"
api_call POST /auth/register "$(jq -nc \
  --arg e "$EMAIL" --arg p "$PW" --arg n "$NAME" \
  '{email:$e,password:$p,full_name:$n}')"
# Duplicate typically → 400 Bad Request ("email already registered") or 409.
assert_status_in 400 409

# -----------------------------------------------------------------------
begin_test "POST /auth/login with correct password returns an access_token"
api_call POST /auth/login "$(jq -nc --arg e "$EMAIL" --arg p "$PW" '{email:$e,password:$p}')"
assert_status 200
assert_json_nonempty '.access_token' "access_token"
assert_json_eq '.token_type' "bearer" "token_type"

AUTH_TOKEN="$(json_get .access_token)"

# -----------------------------------------------------------------------
begin_test "GET /posts with the fresh token works (200)"
api_call GET /posts
assert_status 200

# -----------------------------------------------------------------------
begin_test "POST /auth/login with wrong password is rejected (401)"
clear_auth
api_call POST /auth/login "$(jq -nc --arg e "$EMAIL" '{email:$e,password:"not-the-password"}')"
assert_status 401

# -----------------------------------------------------------------------
begin_test "GET /posts without a token is rejected (401)"
clear_auth
api_call GET /posts
assert_status 401

# -----------------------------------------------------------------------
print_summary
