# Hetzner Cloud — Monitoring environment.
#
# A dedicated cax21 (~€7/mo with backups off) that runs the
# Prometheus + Loki + Grafana + Alertmanager stack. Lives in the
# SAME Hetzner project as PROD for the early stage; once the
# operator team grows, split into a separate project so a compromised
# PROD API token cannot wipe the observability plane.
#
# Architecture choices:
#
#   - **No public ingress for Grafana / Prometheus / Alertmanager.**
#     The Hetzner firewall closes 80/443. Operator access happens via
#     Tailscale only. This removes the entire public attack surface of
#     a non-hardened Grafana setup.
#
#   - **No Hetzner Volume, no native backups.** All monitoring config
#     is in this repo; Prometheus / Loki retain data the operator can
#     accept losing on a rebuild. Compliance-relevant audit data lives
#     in PROD Postgres (and in the encrypted off-host backup bucket),
#     not here.
#
#   - **deploy_app = false.** Same pattern as PROD: bootstrap stops at
#     hardened OS + Tailscale installed. Operator SCP's the age key,
#     clones the repo, runs `scripts/deploy-monitoring.sh`. The
#     monitoring age key is DIFFERENT from PROD/DEV so a leak of one
#     does not compromise the others.

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

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  labels = {
    project     = var.project_name
    environment = var.environment
    role        = "monitoring"
    managed-by  = "terraform"
  }
}

resource "terraform_data" "admin_access_guard" {
  input = {
    admin_ip_allowlist = var.admin_ip_allowlist
    tailscale_enabled  = var.tailscale_enabled
  }

  lifecycle {
    precondition {
      condition     = length(var.admin_ip_allowlist) > 0 || var.tailscale_enabled
      error_message = "monitoring requires either admin_ip_allowlist or tailscale_enabled = true."
    }
  }
}

module "firewall" {
  source = "../../modules/hcloud-firewall"

  name              = "${local.name_prefix}-app"
  allowed_ssh_cidrs = var.admin_ip_allowlist
  allow_http        = false
  allow_https       = false
  labels            = local.labels
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
  enable_backups       = false
  labels               = local.labels

  deploy_app         = false
  age_private_key    = ""
  tailscale_enabled  = var.tailscale_enabled
  tailscale_auth_key = ""
}
