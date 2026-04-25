#!/usr/bin/env bash
# 01-health — server reachable, protected routes reject anonymous access.
set -u

# Locate + source the common library whether we're run from run.sh or
# standalone (./suites/01-health.sh).
if [ -z "${TEST_PLAN_ROOT:-}" ]; then
  TEST_PLAN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  export TEST_PLAN_ROOT
fi
# shellcheck source=../lib/common.sh
source "$TEST_PLAN_ROOT/lib/common.sh"
require_deps
require_server_up

begin_suite "01-health — reachability + auth gates"

# -----------------------------------------------------------------------
begin_test "GET /series without auth is rejected (401)"
clear_auth
api_call GET /series
assert_status 401

# -----------------------------------------------------------------------
begin_test "GET /posts without auth is rejected (401)"
clear_auth
api_call GET /posts
assert_status 401

# -----------------------------------------------------------------------
begin_test "GET /series with a bogus token is rejected (401)"
AUTH_TOKEN="not.a.real.jwt.token"
api_call GET /series
assert_status 401

# -----------------------------------------------------------------------
begin_test "POST /auth/login with non-existent user is rejected"
clear_auth
api_call POST /auth/login '{"email":"does-not-exist-000@example.com","password":"wrong"}'
# API returns 401 or 400 depending on implementation; accept both.
assert_status_in 400 401

# -----------------------------------------------------------------------
print_summary
