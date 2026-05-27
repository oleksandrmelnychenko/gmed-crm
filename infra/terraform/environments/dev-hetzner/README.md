# DEV on Hetzner Cloud

Provisions and deploys the DEV environment on Hetzner Cloud (Nuremberg).

- **Host:** `console-dev.gmed-health.com` → single Hetzner server.
- **Phase 0:** OS hardening, Docker, non-root user, fail2ban, sysctl.
- **Phase 1:** sops-encrypted secrets, app deploy, Caddy + Let's Encrypt.
- **Phase 3e5 (current):** Tailscale + observability sidecars
  (node_exporter, cAdvisor, postgres_exporter, promtail). The
  monitoring host scrapes DEV at `gmed-dev:9091/9100/9080/9187`
  via tailnet; Promtail ships container + syslog to Loki on
  `gmed-monitoring`. Streams land with `host=gmed-dev` /
  `env=dev` labels so dashboards partition cleanly from PROD.

## Prerequisites

| Tool                                                           | Why                   |
| -------------------------------------------------------------- | --------------------- |
| Hetzner Cloud account + project `gmed-dev`                     | host                  |
| Hetzner API token (R/W)                                        | for `terraform apply` |
| Terraform `>= 1.6`                                             | provisioning          |
| [age](https://github.com/FiloSottile/age) (`brew install age`) | encryption keys       |
| [sops](https://github.com/getsops/sops) (`brew install sops`)  | secrets management    |
| OpenSSH ed25519 key                                            | server access         |

## One-time setup

### 1. Generate the DEV age key

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/gmed-dev.key
# Prints "Public key: age1xxxxx...". Save BOTH halves:
#   - private key (file content)            -> 1Password "gmed dev age key"
#   - public key  (the age1... line)        -> infra/terraform/.sops.yaml
```

Edit [`infra/terraform/.sops.yaml`](../../.sops.yaml) and replace the
DEV placeholder with your new `age1...` public key.

### 2. Encrypt the secrets bundle

```bash
cd infra/terraform/environments/dev-hetzner
cp secrets.sops.yaml.example secrets.sops.yaml
$EDITOR secrets.sops.yaml          # fill in real values

# Generate the random parts:
openssl rand -base64 48              # -> GMED_JWT_SECRET
openssl rand -base64 32              # -> v1 key for GMED_MESSAGE_ENCRYPTION_KEYS
openssl rand -base64 32              # -> GMED_AUDIT_IP_SALT
openssl rand -base64 32              # -> GMED_LEAD_INTAKE_TOKEN

# Encrypt in place. After this, opening the file shows ciphertext.
sops -e -i secrets.sops.yaml

# Re-edit later with: `sops secrets.sops.yaml` (transparently decrypts).
```

The encrypted `secrets.sops.yaml` is safe to commit to the repo — it can
only be decrypted with the matching age private key.

### 3. Fill terraform.tfvars

```bash
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars
```

- `admin_ssh_public_key` — your ed25519 public key.
- `admin_ip_allowlist` — your home/office IPs (`["1.2.3.4/32"]`).
- `age_private_key` — paste the single-line `AGE-SECRET-KEY-1...` from
  `~/.config/sops/age/gmed-dev.key` (sensitive; never commit).

### 4. Point DNS

Add an `A` record for `console-dev.gmed-health.com` to the Primary IPv4
that Terraform will print after the first `apply`. Caddy will retry the
ACME HTTP-01 challenge until DNS resolves correctly, so the order is
flexible — just don't expect HTTPS to work before DNS does.

The compute module sets `lifecycle.ignore_changes = [user_data]` to
prevent every bootstrap edit from forcing a server recreate. As a
consequence, changing `deploy_app` (or any other tfvars value that
feeds into `user_data`) after the first apply has **no effect** on a
running host. To re-run the bootstrap on the same VM:

```bash
terraform taint module.compute.hcloud_server.this
terraform apply
```

This destroys and recreates the server (Primary IPv4 survives,
`auto_delete = false`).

### 5. Apply

```bash
export HCLOUD_TOKEN="..."   # from Hetzner Console → Security → API tokens

terraform init
terraform plan
terraform apply
```

Cloud-init logs land on the host at `/var/log/cloud-init-output.log`.
Tail it (`ssh gmed@<ip> sudo tail -f /var/log/cloud-init-output.log`)
if `apply` looks done but `curl https://console-dev.gmed-health.com`
still hangs — the bootstrap may still be installing Docker / building
images.

First boot typically takes 5–10 minutes (Docker pull + Rust build of the
backend image on the host). Subsequent applies that don't change
`user_data` reuse the booted instance.

## Verify

```bash
# Server reachable?
ssh gmed@<ip>
sudo cat /etc/gmed/bootstrap.phase1     # ISO timestamp of completion

# Containers up?
docker compose -f /opt/gmed/repo/docker-compose.yml \
               -f /opt/gmed/repo/docker-compose.release.yml \
               -f /opt/gmed/repo/docker-compose.hetzner.yml ps

# HTTPS working?
curl -v https://console-dev.gmed-health.com/health
```

## Cost

| Resource     | Monthly (EUR) |
| ------------ | ------------- |
| cpx32 server | current Hetzner price |
| Primary IPv4 | 0.50          |
| **Total**    | check current Hetzner pricing |

Hetzner-native backups are off in DEV. Flip `enable_backups` in
`modules/hcloud-compute` for an extra ~20% if needed.

## Operations

### Rotate the JWT or message-encryption key

**Step 1.** Edit and re-encrypt the secret:

```bash
sops secrets.sops.yaml      # add a v2 entry; flip ACTIVE to v2
```

**Step 2.** SSH to the host and re-run the deploy:

```bash
ssh gmed@<ip>
cd /opt/gmed/repo
sudo bash /opt/gmed/repo/scripts/deploy-dev.sh
```

**Step 3.** After the new key is active, run the in-app rewrap sweep
(`/admin/security/key-rotation` route in
[`crates/server/src/routes/key_rotation.rs`](../../../../crates/server/src/routes/key_rotation.rs))
to migrate stored ciphertexts.

### Deploy the same release image as PROD

By default `scripts/deploy-dev.sh` builds images on the DEV host from
the checked-out branch. To smoke-test the exact GHCR release that will
go to PROD, set both optional image pins in the DEV SOPS bundle:

```bash
GMED_BACKEND_IMAGE=ghcr.io/oleksandrmelnychenko/gmed-crm-server@sha256:...
GMED_FRONTEND_IMAGE=ghcr.io/oleksandrmelnychenko/gmed-crm-frontend@sha256:...
```

Then re-run:

```bash
ssh gmed@console-dev.gmed-health.com sudo /opt/gmed/repo/scripts/deploy-dev.sh
```

Leave both values empty to return DEV to local host builds.

### Reset cloud-init

`lifecycle.ignore_changes = [user_data]` means bootstrap is **not**
re-run on a `user_data` change. To force a re-bootstrap on the same VM:

```bash
terraform taint module.compute.hcloud_server.this
terraform apply
```

This destroys and recreates the server (the Primary IPv4 survives).

## DEV ↔ PROD differences

| Aspect            | DEV (this)                  | PROD (Phase 2+)                   |
| ----------------- | --------------------------- | --------------------------------- |
| Hostname          | console-dev.gmed-health.com | console.gmed-health.com           |
| Servers           | 1× app                      | app + db + monitoring             |
| Private network   | none                        | `hcloud_network`, app↔db only     |
| SSH               | admin IP allow-list         | closed; via Tailscale             |
| Hetzner backups   | off                         | on                                |
| Postgres location | docker volume on root disk  | dedicated server + Hetzner Volume |
| Image build       | on host by default; optional GHCR pins | prebuilt GHCR, cosign-verified    |
| age key delivery  | via TF (`age_private_key`)  | out-of-band SSH post-boot         |
| Object Lock       | off                         | on, for audit-log bucket          |
| Real PII allowed? | never                       | yes                               |

## Tearing down

```bash
terraform destroy
```

The Primary IPv4 has `auto_delete = false`; destroy detaches but does
not free the IP. Hetzner keeps billing for it (~€0.50/mo) until released
manually in the Console. This is intentional — `terraform apply` will
reattach the same IP next time.
