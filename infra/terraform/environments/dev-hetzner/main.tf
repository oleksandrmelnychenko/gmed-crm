# Hetzner Cloud — DEV environment.
#
# Scope: one server with a hardened OS, Docker, sops-based secrets,
# Caddy edge proxy, app containers, and DEV observability sidecars.
#
# DEV ≠ "PROD with smaller numbers". DEV exists to validate the same
# mechanisms (TF modules, bootstrap, firewall shape, Hetzner Project
# isolation) before promoting them to PROD. DEV keeps backups off and
# allows local host builds by default; PROD uses signed GHCR images.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
  }
}

# The provider reads HCLOUD_TOKEN from the environment. Do NOT pass the
# token via tfvars — that would leak it into plan output and state.
provider "hcloud" {}

locals {
  name_prefix = "${var.project_name}-${var.environment}"

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

  deploy_app      = var.deploy_app
  app_repo_url    = var.app_repo_url
  app_branch      = var.app_branch
  age_private_key = var.age_private_key

  # Tailscale: DEV authenticates at first boot (key in TF state).
  tailscale_enabled  = var.tailscale_enabled
  tailscale_auth_key = var.tailscale_auth_key
  tailscale_hostname = "gmed-dev"

  # Compose stack: add the DEV-specific override that publishes
  # backend :9091 and stands up the observability sidecars
  # (node_exporter, cAdvisor, postgres_exporter, promtail).
  compose_files = [
    "docker-compose.yml",
    "docker-compose.release.yml",
    "docker-compose.hetzner.yml",
    "docker-compose.dev-hetzner.yml",
  ]
}
