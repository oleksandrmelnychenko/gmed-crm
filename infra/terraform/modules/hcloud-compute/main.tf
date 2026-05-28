terraform {
  required_providers {
    # Without this block Terraform infers `hashicorp/hcloud` from the
    # resource name prefix, which does not exist on the registry and
    # makes `terraform init` fail with a "Failed to query available
    # provider packages" error.
    hcloud = {
      source = "hetznercloud/hcloud"
    }
  }
}

# A single Hetzner Cloud server with a stable Primary IPv4 and an
# admin SSH key registered in the project.
#
# Design choices:
#
# - The Primary IPv4 is created separately from the server, with
#   `auto_delete = false`. The IP survives a server destroy/recreate
#   (e.g. switching image, resizing), so external DNS does not need
#   to chase a moving target.
#
# - The bootstrap script (cloud-init `user_data`) is intentionally
#   thin by default: it provisions the OS, installs Docker, creates a
#   non-root admin user, and hardens SSH/fail2ban/sysctl. Optional
#   `deploy_app=true` exists for disposable DEV hosts, but the standard
#   operating model keeps app releases in scripts/CI, separate from
#   Terraform.
#
# - `lifecycle.ignore_changes = [user_data]` prevents a server from
#   being recreated when the bootstrap template changes. user_data
#   is consumed once at first boot; rewriting it never re-runs on a
#   live host. Forcing a recreate would silently destroy state. To
#   re-run bootstrap intentionally, taint the resource.
#
# - The precondition pins the datacenter to a German Hetzner site.
#   Health-data residency (GDPR Art. 32 plus the German BSI C5
#   `RZ-04` control on geographic processing scope) is a hard
#   requirement, not a recommendation.

locals {
  # Hetzner is deprecating the datacenter argument on server / primary_ip
  # resources. Keep the caller-facing datacenter variable for the DE-site
  # guard, but place resources by location to avoid the deprecated API path.
  location = split("-", var.datacenter)[0]
}

resource "hcloud_ssh_key" "this" {
  name       = "${var.name_prefix}-admin"
  public_key = var.admin_ssh_public_key
  labels     = var.labels
}

resource "hcloud_primary_ip" "ipv4" {
  name        = "${var.name_prefix}-ipv4"
  type        = "ipv4"
  location    = local.location
  auto_delete = false
  labels      = var.labels
}

resource "hcloud_server" "this" {
  name         = var.name_prefix
  server_type  = var.server_type
  image        = var.image
  location     = local.location
  ssh_keys     = [hcloud_ssh_key.this.id]
  firewall_ids = var.firewall_ids
  backups      = var.enable_backups
  labels       = var.labels

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.ipv4.id
    ipv6_enabled = true
  }

  user_data = templatefile("${path.module}/templates/bootstrap.sh.tftpl", {
    admin_username              = var.admin_username
    deploy_app                  = var.deploy_app
    app_repo_url                = var.app_repo_url
    app_branch                  = var.app_branch
    age_private_key             = var.age_private_key
    secrets_sops_path           = var.secrets_sops_path
    compose_files               = var.compose_files
    postgres_volume_device_path = var.postgres_volume_device_path
    postgres_volume_mount_path  = var.postgres_volume_mount_path
    tailscale_enabled           = var.tailscale_enabled
    tailscale_auth_key          = var.tailscale_auth_key
    tailscale_hostname          = var.tailscale_hostname
  })

  lifecycle {
    ignore_changes = [user_data]

    precondition {
      condition     = can(regex("^(fsn1|nbg1)-dc[0-9]+$", var.datacenter))
      error_message = "Datacenter must be a DE site (fsn1-dcXX or nbg1-dcXX) for GDPR/BSI C5 data residency."
    }

    precondition {
      condition     = !var.deploy_app || length(var.age_private_key) > 0
      error_message = "deploy_app=true requires age_private_key to decrypt the sops secrets bundle on the host."
    }

    precondition {
      condition     = !var.postgres_volume_enabled || (var.postgres_volume_id != null && length(var.postgres_volume_device_path) > 0)
      error_message = "When postgres_volume_enabled=true, postgres_volume_id and postgres_volume_device_path must also be provided."
    }
  }
}

# Attach the postgres data volume when configured. `automount = false`
# leaves mounting to the bootstrap script — Hetzner's auto-fstab can
# race with cloud-init and end up double-mounting or fighting our own
# UUID entry.
resource "hcloud_volume_attachment" "postgres" {
  count = var.postgres_volume_enabled ? 1 : 0

  volume_id = var.postgres_volume_id
  server_id = hcloud_server.this.id
  automount = false
}
