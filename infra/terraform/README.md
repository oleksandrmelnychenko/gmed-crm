# Terraform Infrastructure

Terraform in this repo owns infrastructure, not routine application
releases.

## Current Environments

- `environments/dev-hetzner` - DEV Hetzner Cloud server, firewall,
  optional Tailscale, and optional first-boot app bootstrap.
- `environments/prod-hetzner` - PROD Hetzner Cloud server, firewall,
  dedicated Postgres Volume, backups enabled, and no app deploy from
  Terraform.
- `environments/monitoring-hetzner` - monitoring host infrastructure.
- `environments/dev` - legacy AWS baseline kept only for historical
  reference. Do not use it for new GMED deployments.

## Operating Model

Use Terraform for:

- servers, primary IPs, firewalls, volumes;
- base OS bootstrap, Docker, hardening, Tailscale package install;
- infrastructure outputs such as public IPs for DNS.

Use deploy scripts / CI for:

- pulling or uploading application code;
- building or pulling Docker images;
- decrypting runtime secrets on the host;
- running `docker compose up`;
- smoke testing `/health`.

This separation is intentional. A normal app publish must not require
`terraform apply`, and a Terraform plan must not be used as the release
vehicle for code changes.

## DEV Publish

For the current DEV host, publish the checked-out commit from a local
workstation:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\publish-dev-current.ps1
```

The script creates a `git archive` of `HEAD`, uploads it to the DEV
host, runs `scripts/deploy-dev-current.sh` remotely, and checks
`https://console-dev.gmed-health.com/health`.

For a Terraform-managed `/opt/gmed/repo` DEV host, SSH to the host and
run:

```bash
sudo /opt/gmed/repo/scripts/deploy-dev.sh
```

## PROD Publish

PROD uses digest-pinned GHCR release images built by
`.github/workflows/release.yml`. Terraform creates the host and volume
only. Application deployment is:

1. Build/sign images through the release workflow.
2. Put `GMED_BACKEND_IMAGE` and `GMED_FRONTEND_IMAGE` digest refs into
   the PROD SOPS bundle.
3. Re-run:

```bash
ssh gmed@console.gmed-health.com sudo /opt/gmed/repo/scripts/deploy-prod.sh
```

`deploy-prod.sh` verifies cosign signatures before Compose reconciles
the stack. It never builds images locally.
