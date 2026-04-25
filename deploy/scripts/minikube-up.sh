#!/usr/bin/env bash
# minikube-up.sh — one-shot bootstrap for the Creator Scheduler on minikube.
#
# What it does (idempotent; safe to re-run):
#   1. Starts minikube if it isn't already running.
#   2. Enables the `ingress` addon (nginx ingress controller).
#   3. Points the current shell's docker CLI at minikube's Docker daemon
#      and builds the backend + frontend images directly inside it —
#      no registry push needed.
#   4. `helm upgrade --install`s the chart.
#   5. Prints the /etc/hosts line to add for the ingress host.
#
# Env overrides:
#   HOST       ingress host (default: scheduler.local)
#   TAG        image tag (default: 0.1.0)
#   RELEASE    helm release name (default: creator-scheduler)
#   NAMESPACE  k8s namespace (default: default)

set -euo pipefail

HOST="${HOST:-scheduler.local}"
TAG="${TAG:-0.1.0}"
RELEASE="${RELEASE:-creator-scheduler}"
NAMESPACE="${NAMESPACE:-default}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART_DIR="$REPO_ROOT/deploy/helm/creator-scheduler"

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' not found in PATH" >&2; exit 1; }
}
require minikube
require kubectl
require helm
require docker

echo "==> Ensuring minikube is running"
if ! minikube status >/dev/null 2>&1; then
  minikube start --driver=docker
else
  echo "    minikube already running"
fi

echo "==> Ensuring ingress addon is enabled"
minikube addons enable ingress >/dev/null

echo "==> Building backend image  creator-scheduler-backend:$TAG (host docker)"
docker build -t "creator-scheduler-backend:$TAG" "$REPO_ROOT/backend"

echo "==> Building frontend image creator-scheduler-frontend:$TAG (VITE_API_URL=/api/v1)"
docker build -t "creator-scheduler-frontend:$TAG" \
  --build-arg VITE_API_URL=/api/v1 \
  "$REPO_ROOT/frontend"

# We build on the host Docker daemon (instead of `eval $(minikube
# docker-env)`) to avoid client/server Docker API version mismatches,
# then side-load the images into minikube's container runtime.
echo "==> Loading images into minikube"
minikube image load "creator-scheduler-backend:$TAG"
minikube image load "creator-scheduler-frontend:$TAG"

echo "==> helm upgrade --install $RELEASE"
helm upgrade --install "$RELEASE" "$CHART_DIR" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --set "ingress.host=$HOST" \
  --set "backend.image.tag=$TAG" \
  --set "frontend.image.tag=$TAG" \
  --wait --timeout 5m

IP="$(minikube ip)"
cat <<EOF

==> Deployed.

    Release:   $RELEASE
    Namespace: $NAMESPACE
    Host:      $HOST
    IP:        $IP

Add this line to /etc/hosts (if not already present):

    $IP  $HOST

Then open:
    http://$HOST/
    http://$HOST/docs        (FastAPI Swagger)

Seeded login:
    alice@example.com  /  password123

EOF
