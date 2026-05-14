# PROD on Hetzner Cloud

Single-server PROD. The architecture intentionally mirrors DEV; what
makes this PROD are the **operational controls** layered on top:
distinct Hetzner project, native daily backups, no PII in DEV, manual
deploy (no secrets in TF state).

- **Host:** `console.gmed-health.com` → single Hetzner server.
- **Backups:** Hetzner native daily snapshots (7-day retention).
- **Deploy:** manual via `scripts/deploy-prod.sh` after first apply.
- **Phase 3 (started):** encrypted off-host backups to Hetzner Object
  Storage (this commit). Next: Postgres on Hetzner Volume,
  monitoring server, Tailscale, GHCR images.

## Prerequisites

| Tool                                                          | Why                          |
| ------------------------------------------------------------- | ---------------------------- |
| Hetzner Cloud account + a **separate** project `gmed-prod`    | host (isolated from DEV)     |
| Hetzner API token (R/W) scoped to `gmed-prod`                 | for `terraform apply`        |
| Terraform `>= 1.6`                                            | provisioning                 |
| [age](https://github.com/FiloSottile/age)                     | encryption keys              |
| [sops](https://github.com/getsops/sops)                       | secrets management           |
| OpenSSH ed25519 key, hardware-backed (YubiKey)                | server access                |
| Domain `console.gmed-health.com` with DNS you can edit        | TLS via Let's Encrypt        |

## One-time setup

### 1. Generate the PROD age key

PROD uses a **different** age key from DEV. A leaked DEV key must
never be able to decrypt PROD secrets.

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/gmed-prod.key
# Public key (age1...) → infra/terraform/.sops.yaml, PROD section
# Private key (AGE-SECRET-KEY-1...) → 1Password Business vault
```

Edit [`infra/terraform/.sops.yaml`](../../.sops.yaml) and replace the
PROD placeholder with the new `age1...` line.

### 2. Encrypt the secrets bundle

```bash
cd infra/terraform/environments/prod-hetzner
cp secrets.sops.yaml.example secrets.sops.yaml
$EDITOR secrets.sops.yaml

# Generate every random value freshly — never reuse DEV values.
openssl rand -base64 32   # → POSTGRES_PASSWORD
openssl rand -base64 48   # → GMED_JWT_SECRET
openssl rand -base64 32   # → GMED_MESSAGE_ENCRYPTION_KEYS (v1 entry)
openssl rand -base64 32   # → GMED_AUDIT_IP_SALT

sops -e -i secrets.sops.yaml
```

Make sure `POSTGRES_USER`/`POSTGRES_PASSWORD` and the credentials
inside `GMED_DATABASE_URL` match — they are stored separately in the
sops bundle and not cross-referenced at runtime.

### 3. Fill terraform.tfvars

```bash
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars
```

There is no `age_private_key` here on purpose.

### 4. Apply infrastructure

```bash
export HCLOUD_TOKEN="<prod-project-token>"   # NOT the dev token

terraform init
terraform plan
terraform apply
```

After apply Terraform prints the public IPv4. **No app is running
yet.** The bootstrap stopped at the hardened-OS stage.

### 5. Point DNS

Add an `A` record for `console.gmed-health.com` to the printed IPv4.
Wait for DNS propagation (a minute or two) before the next step —
Caddy will retry ACME regardless, but it makes the smoke test
cleaner.

### 6. Install the age key out of band

The key never enters TF state. Provision it from your workstation:

```bash
# From your laptop
scp ~/.config/sops/age/gmed-prod.key gmed@console.gmed-health.com:/tmp/age.key

# On the server
ssh gmed@console.gmed-health.com
sudo install -o root -g root -m 600 /tmp/age.key /etc/gmed/age.key
shred -u /tmp/age.key
```

### 7. Clone the repo on the host

```bash
# Still on the server
sudo install -d -o root -g root -m 755 /opt/gmed
sudo git clone --depth 50 \
  https://github.com/oleksandrmelnychenko/gmed-crm.git \
  /opt/gmed/repo
```

### 8. First deploy

```bash
sudo /opt/gmed/repo/scripts/deploy-prod.sh
```

The script:

1. `git fetch + reset --hard origin/main`
2. Decrypts `secrets.sops.yaml` to `/opt/gmed/release.env` (atomic
   write).
3. Validates all required keys exist.
4. Installs / refreshes `rclone` + `age`, the backup cron entry
   (`/etc/cron.d/gmed-backup`, daily 02:30 UTC), and the external
   Healthchecks.io `/health` ping cron if `HEALTHCHECKS_PING_URL` is
   set.
5. `docker compose up -d` with digest-pinned GHCR images.
6. Creates / rotates the read-only `postgres_exporter` role via
   `scripts/ensure-prod-metrics-user.sh`.
7. Prunes dangling images older than 24h.

It is idempotent — re-running on a healthy host is a `git pull` plus
a compose reconciliation.

### 9. Healthchecks ping cron

Create a Healthchecks.io check for the public app health probe and put
its ping URL in `HEALTHCHECKS_PING_URL` in the PROD SOPS bundle.
`scripts/deploy-prod.sh` installs `/etc/cron.d/gmed-app-healthcheck`
automatically and removes it again if the variable is absent.

### 10. One-time: encrypted off-host backups

The backup pipeline streams `pg_dump → age-encrypt → upload` to Hetzner
Object Storage every night. The age **private** key is never on the
server — it only exists on your laptop / 1Password, so a server
compromise cannot read the archive.

**a. Create the bucket.** Hetzner Console → Object Storage → Create
Bucket. Pick the same region as the server (`fsn1`). After creation,
go into the bucket settings and enable **Versioning** (so a malicious
delete creates a delete marker instead of removing history). Object
Lock GA status varies — enable it if your region supports it, defer to
Phase 4 otherwise.

**b. Generate Object Storage credentials.** Hetzner Console → Security
→ Object Storage credentials → Generate access key/secret. Name it
`gmed-prod-backup` so you remember its scope. Copy the keys into
`BACKUP_S3_ACCESS_KEY` and `BACKUP_S3_SECRET_KEY` in
`secrets.sops.yaml`.

**c. Generate the backup age keypair(s).** Always generate at least
two — one master, one recovery. Losing the only key destroys the
archive.

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/gmed-backup-master.key
age-keygen -o ~/.config/sops/age/gmed-backup-recovery.key
```

Store the **private** files separately:

- master   → 1Password Business vault
- recovery → physically separate location (paper print, separate
  hardware key, safe deposit box)

Copy the **public** `age1...` line of each into the
`BACKUP_AGE_RECIPIENTS` block of `secrets.sops.yaml` (one per line).

**d. Encrypt and redeploy.** Re-encrypt the bundle, commit, push, and
re-run the deploy script on the host. The deploy installs the cron
entry and the next run at 02:30 UTC produces the first backup.

```bash
sops -e -i secrets.sops.yaml
git commit -am "prod: enable off-host backups"
git push
ssh gmed@console.gmed-health.com sudo /opt/gmed/repo/scripts/deploy-prod.sh
```

**e. Smoke-test the cron immediately.** Don't wait until tomorrow
night to discover a typo.

```bash
ssh gmed@console.gmed-health.com
sudo /opt/gmed/repo/scripts/backup-postgres.sh
# Expect: "[...] backup OK: postgres/gmed-prod-<stamp>.pgdump.age"

# Verify the upload landed:
sudo rclone lsf gmedbackup:gmed-prod-backups/postgres/
```

**f. Configure Healthchecks.io alerting.** Create a new check named
`gmed-prod backup`, schedule "daily", grace period 4 hours. Paste the
ping URL as `BACKUP_HEALTHCHECKS_PING_URL` in `secrets.sops.yaml` and
re-encrypt + redeploy. A missed nightly backup will email you within
~7 hours.

## Verify

```bash
# Bootstrap got to Phase 1.1 (no Phase-1 deploy on PROD)?
ssh gmed@<ip> sudo cat /etc/gmed/bootstrap.phase0

# Deploy script ran?
ssh gmed@<ip> sudo cat /etc/gmed/deploy.last

# Containers up?
ssh gmed@<ip> docker compose -f /opt/gmed/repo/docker-compose.yml \
  -f /opt/gmed/repo/docker-compose.release.yml \
  -f /opt/gmed/repo/docker-compose.hetzner.yml \
  -f /opt/gmed/repo/docker-compose.prod-hetzner.yml ps

# HTTPS working?
curl -v https://console.gmed-health.com/health
```

## Cost

| Resource                    | Monthly (EUR) |
| --------------------------- | ------------- |
| cax31 server                | 12.49         |
| Hetzner backups (20% of $$) | 2.50          |
| Primary IPv4                | 0.50          |
| Postgres Volume (50 GB)     | 2.40          |
| Object Storage (1 TB tier)  | 5.99          |
| **Total**                   | **~23.90**    |

Cross-environment cost (DEV + PROD + Monitoring) ~€44/mo of the €70
envelope. Headroom ~€26 for traffic spikes, larger Volume, second
Object Storage region, or a future PROD upsize to cax41.

## Operations

### Redeploy after a code or secret change

**Step 1.** (If secrets changed) re-encrypt locally:

```bash
cd infra/terraform/environments/prod-hetzner
sops secrets.sops.yaml     # edit; saves re-encrypted
git commit -am "rotate prod jwt"
git push
```

**Step 2.** SSH to the host and run the deploy script:

```bash
ssh gmed@console.gmed-health.com
sudo /opt/gmed/repo/scripts/deploy-prod.sh
```

**Step 3.** If `GMED_MESSAGE_ENCRYPTION_KEYS` was rotated, run the
in-app rewrap sweep through `/admin/security/key-rotation` (see
[`crates/server/src/routes/key_rotation.rs`](../../../../crates/server/src/routes/key_rotation.rs)).

### Restore from Hetzner native backup

1. Hetzner Console → server → Backups → pick the snapshot.
2. "Restore" creates a new server from the snapshot (does NOT replace
   the running one). Use this server to extract `pg_dump` data, then
   stop the running PROD, swap IPs, point DNS.
3. The Primary IPv4 is detached from the destroyed server but kept by
   `auto_delete = false`; reattach it to the new server.

### Postgres data on Hetzner Volume

Postgres data lives on a dedicated Hetzner Volume (`gmed-prod-postgres`),
not on the server's root disk. The Volume is created by the
`hcloud-volume` module, attached by the `hcloud-compute` module
(`hcloud_volume_attachment`), and mounted by cloud-init at
`/mnt/postgres` before any container starts. The compose override
[`docker-compose.prod-hetzner.yml`](../../../../docker-compose.prod-hetzner.yml)
bind-mounts that path into the postgres container.

Important consequences:

- **Server-level Hetzner backups (the `backups` toggle on the server)
  do NOT include attached Volumes.** The nightly `pg_dump` to Object
  Storage is therefore the authoritative recovery path for PostgreSQL
  data; do not rely on `Hetzner Console → Backups` for the DB.
- The Volume has `delete_protection = true` by default. To destroy it,
  flip the flag in `modules/hcloud-volume/variables.tf` (or pass
  override), `terraform apply`, then destroy.
- Online resize is trivial — edit `terraform.tfvars`
  (`postgres_volume_size_gb = 100`), `terraform apply`, then on the host
  run `sudo resize2fs /mnt/postgres`.
- The Hetzner-pre-formatted ext4 filesystem is created once at volume
  creation. Re-bootstraps NEVER run `mkfs` — that would wipe the
  database. The bootstrap reads the UUID with `blkid` and adds a
  `/etc/fstab` entry; remounts are idempotent.

#### Adding a Volume to an existing PROD without losing data

If you already have a PROD server with Postgres on the docker named
volume (`pgdata`), do this once:

1. `pg_dump` to Object Storage via `scripts/backup-postgres.sh`.
2. `terraform apply` creates the Volume + attachment. Mount appears at
   `/mnt/postgres` (empty). The running postgres container is not
   affected yet because the compose override is what redirects the bind.
3. SSH, stop compose:
   `sudo docker compose ... down` (keeps named volume).
4. Pull the latest repo (now containing `docker-compose.prod-hetzner.yml`
   with the bind to `/mnt/postgres`) and re-run `deploy-prod.sh`.
   Postgres starts on the empty Volume, runs `initdb`.
5. Restore: `sudo /opt/gmed/repo/scripts/restore-postgres.sh <key>
   --yes-destroy-current-db`.
6. Verify, then optionally delete the unused named volume:
   `sudo docker volume rm gmed-crm_pgdata`.

### Restore from off-host backup (Object Storage)

This path survives compromise of the Hetzner project (snapshots wiped,
API token leaked). The backup age private key is required and lives
**off** the server.

**Step 1.** Find the backup to restore:

```bash
sudo /opt/gmed/repo/scripts/restore-postgres.sh --list
```

**Step 2.** SCP the backup age private key to the host (master or
recovery, whichever is reachable):

```bash
scp ~/.config/sops/age/gmed-backup-master.key gmed@console.gmed-health.com:/tmp/k
ssh gmed@console.gmed-health.com
sudo install -o root -g root -m 600 /tmp/k /etc/gmed/backup-age.key
shred -u /tmp/k
```

**Step 3.** Dry-run (decrypts to /var/tmp, does NOT touch the DB):

```bash
sudo /opt/gmed/repo/scripts/restore-postgres.sh \
  postgres/gmed-prod-2026-05-13T023000Z.pgdump.age
```

**Step 4.** When ready, re-run with the explicit destructive flag:

```bash
sudo /opt/gmed/repo/scripts/restore-postgres.sh \
  postgres/gmed-prod-2026-05-13T023000Z.pgdump.age --yes-destroy-current-db
```

**Step 5.** Shred the key — it should not live on a running server:

```bash
sudo shred -u /etc/gmed/backup-age.key
```

### Release flow (GHCR + cosign)

PROD never runs `docker build`. The
[`release` workflow](../../../../.github/workflows/release.yml) builds
`ghcr.io/<repo>-server` and `ghcr.io/<repo>-frontend` images natively
on `ubuntu-24.04-arm`, pushes them to the GitHub Container Registry,
and signs each digest with [cosign keyless](https://docs.sigstore.dev/cosign/signing/overview/)
(no signing key to manage; the signature carries the GitHub OIDC
certificate identity).

`scripts/deploy-prod.sh` cosign-verifies the certificate identity
against THIS repository's `.github/workflows/release.yml@refs/...`
before invoking compose. An attacker who pushes a malicious image —
even into the same `ghcr.io/<repo>-server` namespace — cannot produce
that certificate identity without compromising both Sigstore Fulcio
AND GitHub's OIDC issuer.

The release workflow runs a **Trivy scan** between push and sign.
Images with HIGH or CRITICAL fixable CVEs are NEVER signed; they
remain in GHCR but unsigned, and `cosign verify` on the host refuses
them. SARIF findings are uploaded to the repo Security tab even on
failure so the blocking CVEs are browsable. `ignore-unfixed: true`
keeps the gate actionable — un-patched advisories are tracked via
Dependabot / `cargo deny` instead of blocking every release.

#### Promoting a release

**Step 1.** Push to `main` (or push a `v*` tag for a tagged release).
The workflow runs `Build and push` + `Sign image (keyless)` for both
images and prints the digests in the run summary:

```text
## server
Digest: `sha256:abc123...`
Pin in PROD release.env:
  GMED_BACKEND_IMAGE=ghcr.io/oleksandrmelnychenko/gmed-crm-server@sha256:abc123...

## frontend
Digest: `sha256:def456...`
Pin in PROD release.env:
  GMED_FRONTEND_IMAGE=ghcr.io/oleksandrmelnychenko/gmed-crm-frontend@sha256:def456...
```

**Step 2.** Update `secrets.sops.yaml`:

```bash
cd infra/terraform/environments/prod-hetzner
sops secrets.sops.yaml
# Paste the digest-pinned refs into GMED_BACKEND_IMAGE and
# GMED_FRONTEND_IMAGE.

git commit -am "prod: pin release sha-abc123"
git push
```

**Step 3.** SSH to the host (via tailnet) and run the deploy script.
It pulls + verifies + reconciles compose:

```bash
ssh gmed@console.gmed-health.com sudo /opt/gmed/repo/scripts/deploy-prod.sh
```

The script will:

1. Pull the repo with the updated pin.
2. Decrypt secrets, validate required keys.
3. Install `cosign` (idempotent, pinned version `v2.4.1`).
4. `cosign verify` both digests against the repo's release workflow
   identity. **Refuses to proceed if verification fails or if a pin
   is not digest-form (`@sha256:...`).**
5. `docker compose ... up -d` (no `--build`, no local image building).
6. Prune dangling images older than 24h.

#### Rollback

A rollback is identical to a forward roll: pick an older digest from
the GHA history, paste it into sops, redeploy. Old digests stay
addressable in GHCR until they are explicitly deleted (set a
retention policy in the GHCR package settings if image storage
becomes a concern).

#### What if cosign verify fails?

The script exits before compose. Investigate:

- Wrong workflow identity? Confirm the image really came from THIS
  repo's `.github/workflows/release.yml` (not a fork, not a different
  workflow file).
- Signature missing? Check the workflow run — did the `Sign image`
  step succeed? A missing signature is a build-pipeline incident,
  not a deploy-time fix.
- Rekor unavailable? Cosign keyless checks the Sigstore transparency
  log; if Rekor is down, set `COSIGN_EXPERIMENTAL=1` and use
  `--insecure-ignore-tlog` only as break-glass while Sigstore
  recovers — and re-verify normally after.

### Tailscale bootstrap (closing public SSH)

After the first successful deploy, switch admin access from the
public allow-list to the Tailscale overlay. The chicken-and-egg is:
the operator needs SSH to run `scripts/deploy-prod.sh`, but the
deploy script is the thing that brings Tailscale up.

**One-time setup (Tailscale admin console).** Sign up for Tailscale
(free Personal plan is enough for a small ops team), then:

**a.** Create a tag, e.g. `tag:gmed-prod`, owned by your account in the
ACL.

**b.** Tighten the ACL so only your account (or an `admins` group) can
connect to `tag:gmed-prod` on port 22:

```jsonc
{
  "tagOwners": {
    "tag:gmed-prod": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src":    ["autogroup:admin"],
      "dst":    ["tag:gmed-prod:22"]
    }
  ]
}
```

**c.** Generate an auth key (Settings → Keys → Generate auth key) with
Reusable ✔︎, Pre-approved ✔︎, Ephemeral ✘, Tags `tag:gmed-prod`.

**d.** Paste the `tskey-auth-...` value into `secrets.sops.yaml` →
`TAILSCALE_AUTH_KEY`. Re-encrypt: `sops -e -i secrets.sops.yaml`.

**Two-step apply.**

**Step 1.** First apply with the public allow-list set (your IP):

```hcl
# terraform.tfvars
admin_ip_allowlist = ["203.0.113.10/32"]
tailscale_enabled  = true
```

```bash
terraform apply
# SSH in via public 22, follow the rest of the deploy runbook
# (steps 6–9 above), then run scripts/deploy-prod.sh. The script
# `tailscale up`s the daemon using the key from sops.

ssh gmed@console.gmed-health.com sudo tailscale ip -4
# → 100.x.y.z
```

**Step 2.** Verify Tailscale connectivity from your laptop (also on
the tailnet) — then close public 22:

```bash
# Make sure Tailscale SSH works first
ssh gmed@100.x.y.z

# Then close public 22
$EDITOR terraform.tfvars   # admin_ip_allowlist = []
terraform apply
```

The `terraform_data.admin_access_guard` precondition guarantees you
don't accidentally end up with both an empty list and Tailscale
disabled; Terraform fails the plan instead of emitting a warning.

**Break-glass.** If Tailscale and the public allow-list both fail
(coordination outage, lost ACL, key revoked), the Hetzner Console
VNC remains. Reboot from the Console, log in as root, fix Tailscale,
then SSH resumes.

### Phase 3e2 metrics-user setup

`scripts/deploy-prod.sh` now runs
`scripts/ensure-prod-metrics-user.sh` automatically after compose is up.
That helper creates or rotates the dedicated `postgres_exporter` role
with `pg_monitor` (read-only access to catalog + stats). Rotation is
therefore just: edit `POSTGRES_METRICS_PASSWORD` in SOPS, re-encrypt,
commit, deploy.

Manual fallback:

```bash
ssh gmed@console.gmed-health.com
sudo /opt/gmed/repo/scripts/ensure-prod-metrics-user.sh
```

## What this environment intentionally does NOT have yet

- **Object Lock on the backup bucket.** Versioning is on; full
  immutability is gated on Hetzner Object Storage Object-Lock GA
  status in the region.
<!-- Phase 3e3 delivered: backend exposes /metrics on :9091 via
     axum-prometheus (default metrics: request count, duration
     histogram, in-flight gauge). Prometheus scrapes via tailnet at
     `gmed-prod:9091`. Hetzner firewall keeps the port closed to the
     public internet. -->

<!-- Phase 3e4 delivered: business metrics foundation.
     `crates/server/src/business_metrics.rs` centralises metric names
     + descriptions. The auth domain is fully instrumented; pattern
     is documented below for extension to other domains. -->

### Adding a new business metric

Step-by-step (the auth domain in `routes/auth.rs` is the live example):

1. **Declare the name + description** in
   [`crates/server/src/business_metrics.rs`](../../../../crates/server/src/business_metrics.rs):

   ```rust
   pub const PATIENT_CREATED_TOTAL: &str = "gmed_patient_created_total";

   // Inside describe_all():
   describe_counter!(
       PATIENT_CREATED_TOTAL,
       Unit::Count,
       "Patients created, labelled by the role that initiated the action."
   );
   ```

2. **Emit at the call site** in the relevant handler:

   ```rust
   use crate::business_metrics::PATIENT_CREATED_TOTAL;

   metrics::counter!(
       PATIENT_CREATED_TOTAL,
       "role" => role_as_str,
   )
   .increment(1);
   ```

3. **Add an alert rule** in
   [`monitoring/prometheus/rules/prod.yml`](../../../../monitoring/prometheus/rules/prod.yml)
   if there is a threshold worth paging on.

**Cardinality budget:** every distinct label combination is a
separate time series. Bounded enums (outcome / reason / role) are
fine. NEVER label with user-controlled input (email, IP, free text);
that explodes Prometheus's internal index. High-cardinality forensic
data belongs in the audit log, not in a metric.

The currently-emitted business metrics:

| Name | Labels | Why |
| ---- | ------ | --- |
| `gmed_login_attempts_total` | `outcome` (success / failure / blocked / mfa_pending), `reason` (ok / unknown_email / wrong_password / account_inactive / account_locked / auto_locked / ip_whitelist / mfa_required) | Source of truth for the `ProdLoginFailureBurst` and `ProdLoginSuccessFlatline` alerts. Counts auth attempts at every reject point in `routes/auth.rs`. |

- **docker-socket-proxy in front of Promtail.** Promtail currently
  mounts `/var/run/docker.sock:ro` directly. A hardened setup
  inserts `tecnativa/docker-socket-proxy` and restricts the API
  surface to `/containers` and `/events`.

The remaining priorities, in order:

1. App `/metrics` endpoint (Rust instrumentation — first-class
   request latency / error / business metrics).
2. Object Lock on backups bucket (ransomware resistance).
3. docker-socket-proxy hardening.

## Tearing down

```bash
terraform destroy
```

The Primary IPv4 survives (`auto_delete = false`) and continues to
bill ~€0.50/mo until released manually in the Hetzner Console. The
Hetzner server backups are deleted with the server — extract anything
you need before destroying.
