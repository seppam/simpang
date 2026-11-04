# Deploying simpang

simpang is a Node 24 service: it runs the TypeScript source directly (`node src/server.ts`), with no build step.
The container image and the Helm chart live here.

## 1. Build the image

```sh
docker build -t simpang:dev .
docker run --rm -d -p 3000:3000 --name simpang-local simpang:dev
curl -s localhost:3000/health        # {"status":"ok"}
docker stop simpang-local
```

`/health` needs no database. The `/v1` routes need one.

## 2. Local kind cluster quickstart

Requires Docker, `kind`, `kubectl` and `helm`.

```sh
kind create cluster --name simpang
kind load docker-image simpang:dev --name simpang

# Installs simpang plus a throwaway in-cluster PostgreSQL (pgvector/pgvector:pg17).
# The migration Job runs automatically as a Helm hook.
helm install dev deploy/helm/simpang -f deploy/helm/simpang/values-kind.yaml
kubectl rollout status deploy/dev-simpang

# Forward a local port to the service.
kubectl port-forward svc/dev-simpang 8080:80
```

In a second terminal:

```sh
# Create an API key for a tenant. The key is printed once; only its hash is stored.
kubectl exec deploy/dev-simpang -- node src/db/create-key-cli.ts my-tenant

# Call the API with the key.
curl -s localhost:8080/health
curl -s localhost:8080/v1/... -H "Authorization: Bearer <your-key>"
```

Clean up:

```sh
helm uninstall dev
kubectl delete secret dev-simpang-secret --ignore-not-found
kubectl delete svc dev-simpang-postgres statefulset dev-simpang-postgres --ignore-not-found
kubectl delete pvc data-dev-simpang-postgres-0 --ignore-not-found
kind delete cluster --name simpang
```

`helm uninstall` does not remove the hook resources (the Secret, and the dev PostgreSQL if enabled), so delete them as shown above.

To run without a database, skip `-f values-kind.yaml`. The release then has no DATABASE_URL and the migration Job fails.
The chart NOTES print a warning about this.

## 3. Production notes

- **Use a managed PostgreSQL** (with pgvector available for RAG). Do not use `postgres.enabled` in production. It is a single replica with no backups, HA or TLS.
- **Keep secrets out of values files.** Create a Kubernetes Secret yourself (for example with External Secrets, Sealed Secrets or your cloud's secret manager) and point the chart at it:

  ```sh
  kubectl create secret generic simpang-prod \
    --from-literal=DATABASE_URL='postgres://user:password@host:5432/simpang?sslmode=require' \
    --from-literal=GROQ_API_KEY='...'

  helm upgrade --install prod deploy/helm/simpang \
    --set existingSecret=simpang-prod \
    --set image.repository=registry.example.com/simpang \
    --set image.tag=0.1.0
  ```

  The Secret must hold `DATABASE_URL`. The provider keys (`GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`, `ANTHROPIC_API_KEY`) are optional.
  With `existingSecret` set, the chart creates no Secret of its own.
- **Image registry.** Push the image to your registry and set `image.repository` and `image.tag`. `image.tag` defaults to the chart `appVersion` (0.1.0). Set `imagePullSecrets` if the registry is private. Use an immutable tag (a version or a git SHA), not `latest`.
- **Ingress and scaling.** Turn on `ingress.enabled` (with `ingress.className` and `ingress.tls`) and `autoscaling.enabled` as needed. Both are off by default.
- **Rollouts.** The migration Job runs before every install and upgrade. Keep migrations backward compatible so that old pods keep working during a rolling update.
- **Security context.** Pods run as uid 1000 with a read-only root filesystem (writable `/tmp` only), all capabilities dropped and no privilege escalation.
