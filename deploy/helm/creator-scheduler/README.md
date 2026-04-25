# creator-scheduler Helm chart

Deploy the Creator Scheduler (FastAPI + SQLite + Vite/React SPA) to any
Kubernetes cluster. Tuned for a minikube-first developer experience:
images build locally into minikube's Docker daemon, no registry required.

## Topology

```
                    ┌──────────────────────────────┐
  Browser ──►  nginx ingress @ ${ingress.host}
                    │
                    │   /api/v1*, /docs, /openapi.json  ─► backend Service :8000
                    │                                       │
                    │                                       └─ FastAPI pod
                    │                                            └─ PVC mounted at /app/data
                    │                                                 └─ scheduler.db (SQLite)
                    │
                    │   everything else                  ─► frontend Service :80
                    │                                       │
                    │                                       └─ nginx pod (serving Vite /dist)
                    └──────────────────────────────┘
```

Because frontend and backend share one ingress host, the browser sees
same-origin requests — CORS preflight never runs.

## Quick start (minikube)

```bash
./deploy/scripts/minikube-up.sh
# then, once:
echo "$(minikube ip)  scheduler.local" | sudo tee -a /etc/hosts
open http://scheduler.local
```

Seeded login: **alice@example.com / password123**.

Re-running the script is safe — helm diffs the release, and the generated
`SECRET_KEY` + SQLite PVC are preserved across upgrades.

## Tear down

```bash
./deploy/scripts/minikube-down.sh           # keeps PVC + secret
./deploy/scripts/minikube-down.sh --purge   # also deletes data
./deploy/scripts/minikube-down.sh --stop    # also `minikube stop`
```

## Manual install (any cluster)

If your cluster pulls from a registry instead of using minikube's local
daemon, push the images there first and override the values:

```bash
docker build -t registry.example.com/creator-scheduler-backend:0.1.0 ./backend
docker build -t registry.example.com/creator-scheduler-frontend:0.1.0 \
  --build-arg VITE_API_URL=/api/v1 ./frontend
docker push registry.example.com/creator-scheduler-backend:0.1.0
docker push registry.example.com/creator-scheduler-frontend:0.1.0

helm upgrade --install creator-scheduler ./deploy/helm/creator-scheduler \
  --set backend.image.repository=registry.example.com/creator-scheduler-backend \
  --set frontend.image.repository=registry.example.com/creator-scheduler-frontend \
  --set backend.image.pullPolicy=IfNotPresent \
  --set ingress.host=scheduler.example.com
```

## Values reference

See [`values.yaml`](./values.yaml) — every field is commented. The most
commonly overridden settings:

| Value | Default | Notes |
|---|---|---|
| `ingress.host` | `scheduler.local` | DNS name routed by nginx ingress |
| `backend.persistence.size` | `1Gi` | PVC size for SQLite |
| `backend.persistence.storageClass` | `""` (cluster default) | minikube default is `standard` |
| `backend.secretKey` | `""` (auto-generated) | Pin in CI to make JWTs reproducible |
| `backend.env.corsOrigins` | `""` (= `http://{host}`) | Override if serving API on a different host |

## How the chart stays idempotent

- `templates/secret.yaml` uses `lookup` to reuse the existing Secret's
  `SECRET_KEY` on upgrade. Only the first install generates a random
  value. The Secret carries `helm.sh/resource-policy: keep` so
  `helm uninstall` does not clear it.
- `templates/pvc-backend.yaml` carries the same `keep` annotation, so
  `helm uninstall` does **not** delete your database. Use
  `./deploy/scripts/minikube-down.sh --purge` if that's what you want.
- Deployment pod templates carry `checksum/configmap` and
  `checksum/secret` annotations, so ConfigMap / Secret edits trigger a
  rolling restart automatically on `helm upgrade`.

## Troubleshooting

**`ImagePullBackOff` on minikube.** The script sets
`imagePullPolicy: IfNotPresent` and builds images into minikube's own
Docker daemon. If you ran `docker build` against the *host* daemon, the
minikube node cannot see the image. Re-run with the script, or
`eval $(minikube docker-env)` before building.

**Ingress host refuses to resolve.** You must add `minikube ip` →
`scheduler.local` to `/etc/hosts`. The install-script prints the exact
line.

**Pod stays in `Pending` with "unbound PersistentVolumeClaim".** The
default `storageClass` depends on the cluster. Minikube ships
`standard` (hostpath), which is auto-provisioning. On other clusters,
set `backend.persistence.storageClass` explicitly.

**SECRET_KEY got regenerated.** Check the Secret still exists
(`kubectl get secret -l app.kubernetes.io/instance=<release>`). If you
manually deleted it, the next install will generate a fresh key and
outstanding JWTs will fail verification. Pin `backend.secretKey` in
CI/CD to avoid this entirely.
