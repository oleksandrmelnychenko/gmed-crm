# Hetzner Cloud — PROD environment.
#
# Mirrors the dev-hetzner composition but with PROD-grade settings:
#
#   - `enable_backups = true` switches on Hetzner-native daily snapshots
#     (~20% surcharge, 7-day retention). This is the only data-protection
#     control in Phase 2; encrypted off-host backups to Object Storage
#     and a Postgres Volume arrive in Phase 3.
#
#   - `deploy_app = false`. The bootstrap script provisions the OS,
#     installs Docker, hardens SSH/sysctl/fail2ban — and stops. It does
#     NOT clone the repo, does NOT write any age key, does NOT deploy
#     the app. The age private key never enters TF state.
#
#     First deploy is manual: SCP the age key to /etc/gmed/age.key, then
#     run /opt/gmed/repo/scripts/deploy-prod.sh once via sudo. The same
#     script handles every subsequent redeploy.
#
#   - The Hetzner Cloud project MUST be distinct from gmed-dev (separate
#     API token, separate billing visibility, separate sops recipient).
#     There is no enforcement in TF for this — it relies on operator
#     discipline: `export HCLOUD_TOKEN=<prod-token>` before any apply
#     here.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
  }
}

provider "hcloud" {}

# Cross-variable safety net: PROD cannot end up with both no public
# SSH allow-list AND Tailscale disabled — the host would have no
# operator path after the first apply.
#
# Lives at module top level (variable-level `validation` blocks cannot
# reference other variables on Terraform 1.6). A terraform_data
# precondition fails the plan, so this cannot slip through CI as a
# warning-only check.
resource "terraform_data" "admin_access_guard" {
  input = {
    admin_ip_allowlist = var.admin_ip_allowlist
    tailscale_enabled  = var.tailscale_enabled
  }

  lifecycle {
    precondition {
      condition     = length(var.admin_ip_allowlist) > 0 || var.tailscale_enabled
      error_message = "PROD must have either a non-empty admin_ip_allowlist or tailscale_enabled = true. Otherwise the manual deploy in scripts/deploy-prod.sh has no SSH path."
    }
  }
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  # The Postgres volume must be in the same Hetzner location as the
  # server. var.datacenter is "fsn1-dc14"; the location prefix is "fsn1".
  location = split("-", var.datacenter)[0]

  labels = {
    project     = var.project_name
    environment = var.environment
    managed-by  = "terraform"
  }
}

module "firewall" {
  source = "../../modules/hcloud-firewall"

  name              = "${local.name_prefix}-app"
  allowed_ssh_cidrs = var.admin_ip_allowlist
  allow_http        = true
  allow_https       = true
  labels            = local.labels
}

# Postgres data on a dedicated Hetzner Volume — independent lifecycle
# from the server. `terraform destroy` of the compute module leaves
# this intact (delete_protection = true in the module default).
#
# Important consequence: Hetzner server-level backups (the `backups`
# toggle on the server) do NOT include attached Volumes. The off-host
# pg_dump pipeline added in the previous phase is the authoritative
# recovery path; without it, the Volume is the single point of failure.
module "postgres_volume" {
  source = "../../modules/hcloud-volume"

  name     = "${local.name_prefix}-postgres"
  size_gb  = var.postgres_volume_size_gb
  location = local.location
  labels   = local.labels
}

module "compute" {
  source = "../../modules/hcloud-compute"

  name_prefix          = local.name_prefix
  server_type          = var.server_type
  image                = var.image
  datacenter           = var.datacenter
  admin_ssh_public_key = var.admin_ssh_public_key
  admin_username       = var.admin_username
  firewall_ids         = [tonumber(module.firewall.firewall_id)]
  enable_backups       = true
  labels               = local.labels

  # Deploy is manual on PROD: the bootstrap stops after Phase-0/1.1
  # hardening. age_private_key is intentionally left empty — it lands
  # on the host out of band, never in TF state.
  deploy_app      = false
  age_private_key = ""

  # Attach the Postgres volume. The bootstrap waits for the device,
  # mounts it at /mnt/postgres (UUID-keyed fstab), and chowns to the
  # postgres uid before any container starts.
  postgres_volume_enabled     = true
  postgres_volume_id          = module.postgres_volume.volume_id
  postgres_volume_device_path = module.postgres_volume.linux_device

  # Install Tailscale but do NOT authenticate at boot — the auth key
  # never enters TF state on PROD. `scripts/deploy-prod.sh` brings the
  # daemon up using the key from the sops-decrypted release.env.
  tailscale_enabled  = var.tailscale_enabled
  tailscale_auth_key = ""
}
