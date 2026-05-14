# Monitoring on Hetzner Cloud

A dedicated `cax21` running the observability stack:

- **Prometheus** — metrics scrape + storage
- **Loki** — log aggregation
- **Grafana** — visualization + ad-hoc query (Tailscale-only)
- **Alertmanager** — email delivery for fired alerts
- **node_exporter** — self-monitoring host metrics

No public ingress: the Hetzner firewall closes 80/443. Grafana
listens on the tailnet IP only. PROD scrape happens over the
tailnet too.

This commit (Phase 3e1) stands the stack up scraping only itself.
PROD-side exporters (node_exporter, cAdvisor, postgres_exporter,
promtail) arrive in Phase 3e2 — until then the stack validates only
its own health, Tailscale connectivity, and email delivery.

## Cost

| Resource     | Monthly (EUR) |
| ------------ | ------------- |
| cax21 server | 6.49          |
| Primary IPv4 | 0.50          |
| **Total**    | **~7**        |

No Hetzner backups (config in repo, data recreatable). No Volume
(Prometheus / Loki retention fits comfortably in the 40 GB root disk
for a single-tenant CRM).

## Prerequisites

Same as PROD plus a **distinct** age keypair for the monitoring
secrets.

## One-time setup

### 1. Generate the monitoring age key

```bash
age-keygen -o ~/.config/sops/age/gmed-monitoring.key
# Public key → infra/terraform/.sops.yaml (new rule for monitoring-hetzner)
# Private key → 1Password Business vault, separate item from PROD
```

Add the rule:

```yaml
# infra/terraform/.sops.yaml
creation_rules:
  - path_regex: environments/monitoring-hetzner/.*\.sops\.yaml$
    age: age1monitoringpublickeyhere
```

### 2. Encrypt secrets

```bash
cd infra/terraform/environments/monitoring-hetzner
cp secrets.sops.yaml.example secrets.sops.yaml
$EDITOR secrets.sops.yaml
# Generate randoms with openssl rand -base64 ...
sops -e -i secrets.sops.yaml
```

### 3. Tailscale auth key

In the Tailscale admin console:

- Create tag `tag:gmed-monitoring`.
- ACL: allow `tag:gmed-monitoring` outbound to `tag:gmed-prod` on the
  ports of the exporters that PROD will run (Phase 3e2 will add
  node_exporter:9100, postgres_exporter:9187, cAdvisor:9080,
  Caddy:443). Allow your operator group to reach
  `tag:gmed-monitoring:3000` (Grafana) and `:9090` (Prometheus).
- Generate an auth key with reusable + non-ephemeral + pre-approved +
  tag `tag:gmed-monitoring`. Paste into `TAILSCALE_AUTH_KEY` in
  `secrets.sops.yaml`.

### 4. Apply infrastructure

```bash
export HCLOUD_TOKEN="..."   # same project as PROD for early stage
terraform init
terraform plan
terraform apply
```

### 5. Provision the age key and clone the repo

```bash
# From your laptop
scp ~/.config/sops/age/gmed-monitoring.key gmed@<ipv4>:/tmp/k

# On the server
ssh gmed@<ipv4>
sudo install -o root -g root -m 600 /tmp/k /etc/gmed/age.key
shred -u /tmp/k

sudo install -d -o root -g root -m 755 /opt/gmed
sudo git clone --depth 50 \
  https://github.com/oleksandrmelnychenko/gmed-crm.git \
  /opt/gmed/repo
```

### 6. First deploy

```bash
sudo /opt/gmed/repo/scripts/deploy-monitoring.sh
```

The script:

1. `git fetch + reset --hard origin/main`
2. Decrypts `secrets.sops.yaml` → `/opt/gmed/monitoring.env` (atomic
   write, mode 600).
3. Validates required keys are present.
4. Brings up Tailscale via the sops-decrypted key.
5. `docker compose up -d` for the monitoring stack from
   [`monitoring/docker-compose.yml`](../../../../monitoring/docker-compose.yml).
6. Installs a cron entry that pings Healthchecks.io every 5 min so
   monitoring failures themselves are alertable.

### 7. Verify

```bash
# Tailscale IP of monitoring host
ssh gmed@<ipv4> sudo tailscale ip -4

# From your laptop (also on tailnet)
curl http://100.x.y.z:9090/-/healthy   # Prometheus
curl http://100.x.y.z:3100/ready       # Loki
curl http://100.x.y.z:3000/api/health  # Grafana

# Then open Grafana in a browser:
open http://100.x.y.z:3000
# Log in as `admin` / GRAFANA_ADMIN_PASSWORD from sops.
```

### 8. Close public SSH

Once Tailscale works:

```hcl
# terraform.tfvars
admin_ip_allowlist = []
```

```bash
terraform apply
```

## What's monitored

**Monitoring host (Phase 3e1):** Prom / Loki / Grafana / Alertmanager
internal metrics, plus node_exporter for host CPU / memory / disk.

**PROD (Phase 3e2 + 3e3):** node_exporter, cAdvisor, postgres_exporter,
Promtail, and the Rust backend's own `/metrics` endpoint (axum-prometheus
on :9091). Prometheus scrapes via tailnet at
`gmed-prod:9091/9100/9080/9187`; Promtail pushes container + syslog to
Loki with `host=gmed-prod` / `env=prod` labels.

**DEV (Phase 3e5):** identical exporter set as PROD plus the same
backend `/metrics`, all on the same tailnet. Scrape targets land with
`host=gmed-dev` / `env=dev` labels. DEV is intentionally NOT in the
alert routing (synthetic data, sandbox); it powers Grafana dashboards
and provides regression cover before promotion to PROD.

Querying dual-env in Grafana / LogQL:

- `{env="prod"}` to focus on production.
- `{host=~"gmed-(prod|dev)"}` to compare DEV vs PROD trends side-by-side.

## Alert rules

Self-monitor (Phase 3e1):

1. **MonitoringDiskFull** — `node_filesystem_avail_bytes` ratio < 10%.
2. **MonitoringCPUSustained** — > 80% for 10m.
3. **MonitoringDown** — `up{job="prometheus"} == 0` for 5m (verifies
   delivery loop end-to-end).

PROD metrics (Phase 3e2 + 3e3, [prod.yml](../../../../monitoring/prometheus/rules/prod.yml)):

- **ProdHostDown** — scrape target missing 3m.
- **ProdHostDiskFull / DiskCritical** — < 10% / < 5% free.
- **ProdHostCPUSustained** — > 85% for 15m.
- **ProdHostMemorySaturated** — `MemAvailable / MemTotal` < 10% for 5m.
- **ProdPostgresDown** — postgres_exporter unreachable 2m.
- **ProdPostgresConnectionsSaturated** — > 80% of `max_connections` for 5m.
- **ProdPostgresLongTransaction** — active tx > 5m.
- **ProdAppDown** — backend `/metrics` scrape failing 2m.
- **ProdApp5xxRate** — `axum_http_requests_total{status=~"5.."}` > 0.2/s for 5m.
- **ProdAppLatencyP95High** — p95 request duration > 1.5s for 10m.
- **ProdAppAuthFailureBurst** — 401/403/429 on `/auth/*` > 0.5/s for 5m.
- **ProdContainerRestartLoop** — > 3 restarts in 15m.
- **ProdContainerHighMemory** — > 90% of cgroup limit for 10m.

PROD logs (Phase 3e2, [gmed-prod.yml](../../../../monitoring/loki/rules/fake/gmed-prod.yml)):

- **Caddy5xxBurst** — > 30 5xx/min for 5m.
- **CaddyRateLimitBurst** — > 60 429/min for 5m.
- **BackendPanicLogged** — Rust panic line in backend stdout.
- **SshFail2banBurst** — > 3 SSH bans in 10m.

## DEV ↔ PROD ↔ MONITORING differences (short)

| Aspect            | DEV                         | PROD                              | MONITORING                          |
| ----------------- | --------------------------- | --------------------------------- | ----------------------------------- |
| Server size       | cax31                       | cax31                             | cax21                               |
| Hetzner backups   | off                         | on                                | off                                 |
| Postgres Volume   | n/a (no DB on host)         | yes                               | n/a                                 |
| Public 80/443     | open (Caddy LE)             | open (Caddy LE)                   | **closed**                          |
| Steady-state SSH  | admin allow-list            | Tailscale only                    | Tailscale only                      |
| Secrets store     | sops, key in TF state       | sops, key out-of-band             | sops, key out-of-band               |
| Image source      | build on host               | GHCR signed/scanned               | upstream Prometheus/Grafana/Loki    |

## Tearing down

```bash
terraform destroy
```

The Primary IPv4 has `auto_delete = false` and survives until released
manually in the Console (~€0.50/mo).
