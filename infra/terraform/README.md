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

For the current DEV host, publish the local working tree directly from a
workstation:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\publish-dev-current.ps1
```

The script snapshots tracked and new non-ignored files without touching the
real Git index, uploads the archive and the current remote runner, builds with
the DEV host's Docker cache, keeps a rollback copy, and checks
`https://console-dev.gmed-health.com/health`. It intentionally does not run CI
or require a commit. Use `-CommittedOnly` when the remote build must contain
exactly `HEAD`, or `-DryRun` to validate snapshot creation without SSH.

For a Terraform-managed `/opt/gmed/repo` DEV host, SSH to the host and
run:

```bash
sudo /opt/gmed/repo/scripts/deploy-dev.sh
```

Every successful CI run on `main` also starts `.github/workflows/dev.yml`.
It publishes signed `:dev` and `:dev-sha-<commit>` images and prints the
three digest-pinned `GMED_*_IMAGE` values in the run summary.

## PROD Publish

PROD uses digest-pinned GHCR release images built by
`.github/workflows/release.yml`. Terraform creates the host and volume
only. Application deployment is:

1. Push a `v*` tag or explicitly dispatch the Release Build workflow.
2. Put `GMED_BACKEND_IMAGE`, `GMED_FRONTEND_IMAGE`, and
   `GMED_PARSER_IMAGE` digest refs into the PROD SOPS bundle.
3. Re-run:

```bash
ssh gmed@console.gmed-health.com sudo /opt/gmed/repo/scripts/deploy-prod.sh
```

`deploy-prod.sh` verifies cosign signatures before Compose reconciles
the stack. It never builds images locally.
