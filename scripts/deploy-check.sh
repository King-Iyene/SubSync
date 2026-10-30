#!/usr/bin/env bash
# After a push: wait for the Vercel build of HEAD, then probe the live site. Exit 1 on any problem.
set -u
SHA=$(git rev-parse HEAD)
BASE=${1:-https://subsync.kdsquares.com}
state=pending
for i in $(seq 1 60); do
  state=$(gh api "repos/King-Iyene/SubSync/commits/$SHA/status" --jq .state 2>/dev/null || echo pending)
  [ "$state" != "pending" ] && break
  sleep 10
done
echo "build ${SHA:0:7}: $state"
[ "$state" = "success" ] || { echo "BUILD DID NOT SUCCEED"; exit 1; }
bad=0
probe() { # path expected [method]
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -X "${3:-GET}" "$BASE$1")
  if [ "$code" = "$2" ]; then echo "ok   $1 -> $code"; else echo "FAIL $1 -> $code (wanted $2)"; bad=1; fi
}
probe / 200
probe /app 200
probe /privacy 200
probe /terms 200
probe /support 200
probe /installed 200
probe /api/oauth/install 307
probe /api/mcp 405
probe /api/webhooks/ghl 401 POST
probe /api/cron/sync 401
probe /api/app/overview 401
exit $bad
