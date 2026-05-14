variable "name_prefix" {
  type        = string
  description = "Naming prefix applied to every resource (e.g. \"gmed-dev\")."
}

variable "server_type" {
  type        = string
  description = "Hetzner Cloud server type. Defaults to cax21 (ARM, 4 vCPU, 8 GB, ~€6.49/mo) — a reasonable single-server baseline."
  default     = "cax21"
}

variable "image" {
  type        = string
  description = "Hetzner image identifier. ubuntu-24.04 is LTS and matches the unattended-upgrades configuration in the bootstrap script."
  default     = "ubuntu-24.04"
}

variable "datacenter" {
  type        = string
  description = "Hetzner datacenter (fsn1-dcXX or nbg1-dcXX). Locked to DE in a precondition; do not loosen without a compliance review."
}

variable "admin_ssh_public_key" {
  type        = string
  description = "OpenSSH public key authorized for the admin user. Prefer ed25519 backed by a hardware key (YubiKey, Secretive)."
}

variable "admin_username" {
  type        = string
  description = "Non-root admin user created by cloud-init. SSH-key-only, with NOPASSWD sudo scoped to docker subcommands."
  default     = "gmed"
}

variable "firewall_ids" {
  type        = list(number)
  description = "Firewall IDs to attach. Wrap module output with tonumber() at the call site."
  default     = []
}

variable "enable_backups" {
  type        = bool
  description = "Enable Hetzner-native daily snapshots (~20% surcharge, 7-day retention). Off for DEV (synthetic data); on for PROD."
  default     = false
}

variable "labels" {
  type        = map(string)
  description = "Hetzner labels applied to all created resources."
  default     = {}
}

# ----------------------------------------------------------------------------
# Phase 1 — application deploy.
#
# When `deploy_app` is true the bootstrap script clones the repo, decrypts
# the sops-encrypted secrets bundle to /opt/gmed/release.env, and runs
# `docker compose up -d --build` with the Hetzner override. Setting it to
# false keeps Phase-0 behaviour (server up, hardened OS, no app).
# ----------------------------------------------------------------------------

variable "deploy_app" {
  type        = bool
  description = "Toggle Phase-1 app deploy in the bootstrap script."
  default     = false
}

variable "app_repo_url" {
  type        = string
  description = "Public Git URL of the application repository (cloned by bootstrap)."
  default     = "https://github.com/oleksandrmelnychenko/gmed-crm.git"
}

variable "app_branch" {
  type        = string
  description = "Branch to deploy."
  default     = "main"
}

variable "age_private_key" {
  type        = string
  sensitive   = true
  description = <<-EOT
    age private key used to decrypt the sops-encrypted secrets bundle on
    the host. The key lands in /etc/gmed/age.key (chmod 600, root-owned)
    via cloud-init.

    Trade-off: this value lives in TF state. For DEV (gitignored local
    state, synthetic data) the convenience wins; PROD will provision the
    key out of band after first boot instead.
  EOT
  default     = ""
}

variable "secrets_sops_path" {
  type        = string
  description = "Path inside the cloned repo to the sops-encrypted secrets bundle."
  default     = "infra/terraform/environments/dev-hetzner/secrets.sops.yaml"
}

variable "compose_files" {
  type        = list(string)
  description = "docker compose -f file list, evaluated in order. Hetzner override goes last."
  default = [
    "docker-compose.yml",
    "docker-compose.release.yml",
    "docker-compose.hetzner.yml",
  ]
}

# ----------------------------------------------------------------------------
# Optional: attach a Hetzner Volume and mount it before the app deploys.
#
# When `postgres_volume_enabled` is true, the compute module:
#   1. Creates `hcloud_volume_attachment` linking volume to server.
#   2. Passes the device path + mount path to the bootstrap template.
#   3. Bootstrap waits for the device, mounts it at the configured path,
#      adds a UUID-keyed entry to /etc/fstab, and chowns to uid 70:70
#      (the postgres uid in the alpine image).
#
# The mount happens BEFORE the deploy_app gate, so the data directory
# is ready even on PROD (where deploy is manual).
# ----------------------------------------------------------------------------

variable "postgres_volume_enabled" {
  type        = bool
  description = "Create the hcloud_volume_attachment for the Postgres data volume. Kept separate from postgres_volume_id so Terraform can know resource count during plan."
  default     = false
}

variable "postgres_volume_id" {
  type        = number
  description = "Hetzner Volume ID to attach and mount for the postgres container when postgres_volume_enabled is true."
  default     = null
}

variable "postgres_volume_device_path" {
  type        = string
  description = "Stable Linux device path of the attached volume (typically /dev/disk/by-id/scsi-0HC_Volume_<id>). Required when postgres_volume_id is set."
  default     = ""
}

variable "postgres_volume_mount_path" {
  type        = string
  description = "Mount point for the postgres data volume. Bind-mounted into the postgres container by docker-compose.prod-hetzner.yml."
  default     = "/mnt/postgres"
}

# ----------------------------------------------------------------------------
# Tailscale: admin overlay network.
#
# When `tailscale_enabled` is true the bootstrap installs the tailscale
# package. Authentication is decoupled:
#
#   - If `tailscale_auth_key` is also non-empty, the bootstrap brings
#     the daemon up at first boot (`tailscale up --authkey=...`). This
#     mode is appropriate for DEV, where we already accept the
#     trade-off of secrets in TF state.
#
#   - If `tailscale_auth_key` is empty, the bootstrap stops at "package
#     installed, daemon running idle". The operator (or the manual
#     PROD deploy script) brings the daemon up with a key sourced from
#     sops/`release.env`. The key never enters TF state.
#
# Hetzner firewall: opening UDP/41641 is OPTIONAL. Tailscale always
# works through outbound HTTPS (DERP relays) if direct UDP traversal
# fails; the only consequence of a closed UDP/41641 is slightly higher
# latency on first-hop peers. We leave it closed by default for a
# minimal attack surface.
# ----------------------------------------------------------------------------

variable "tailscale_enabled" {
  type        = bool
  description = "Install the tailscale package in the bootstrap. False keeps the host unaware of Tailscale entirely."
  default     = false
}

variable "tailscale_auth_key" {
  type        = string
  sensitive   = true
  description = <<-EOT
    Pre-authorized key from https://login.tailscale.com/admin/settings/keys.
    Reusable + non-ephemeral + tagged is recommended (the tag governs the
    ACL). Leave empty on PROD — the manual deploy script reads the key
    from the sops-decrypted release.env at deploy time so it never
    enters TF state.
  EOT
  default     = ""
}

variable "tailscale_hostname" {
  type        = string
  description = "Hostname the server registers in the tailnet. Empty -> Tailscale uses the OS hostname."
  default     = ""
}
