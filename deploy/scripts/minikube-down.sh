#!/usr/bin/env bash
# minikube-down.sh — tear down the Creator Scheduler helm release.
#
# By default this performs `helm uninstall` but keeps:
#   - the SQLite PVC (annotated helm.sh/resource-policy: keep)
#   - the JWT SECRET_KEY secret (ditto)
#
# Pass --purge to wipe those too.
# Pass --stop to also run `minikube stop` at the end.

set -euo pipefail

RELEASE="${RELEASE:-creator-scheduler}"
NAMESPACE="${NAMESPACE:-default}"
PURGE=0
STOP=0

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    --stop)  STOP=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

echo "==> helm uninstall $RELEASE -n $NAMESPACE"
helm uninstall "$RELEASE" -n "$NAMESPACE" || echo "    (already absent)"

if [ "$PURGE" = "1" ]; then
  echo "==> Purging retained PVC + Secret (--purge)"
  kubectl -n "$NAMESPACE" delete pvc \
    -l "app.kubernetes.io/instance=$RELEASE" --ignore-not-found
  kubectl -n "$NAMESPACE" delete secret \
    -l "app.kubernetes.io/instance=$RELEASE" --ignore-not-found
fi

if [ "$STOP" = "1" ]; then
  echo "==> minikube stop"
  minikube stop
fi

echo "Done."
