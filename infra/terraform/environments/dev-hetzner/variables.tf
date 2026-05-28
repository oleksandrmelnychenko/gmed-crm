variable "project_name" {
  type    = string
  default = "gmed"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "datacenter" {
  type        = string
  description = "Hetzner datacenter. Locked to DE in the compute module precondition."
  default     = "nbg1-dc3"
}

variable "server_type" {
  type        = string
  description = "Hetzner Cloud server type. cpx32 (x86_64) gives comfortable DEV iteration headroom and matches the release workflow architecture."
  default     = "cpx32"
}

variable "image" {
  type    = string
  default = "ubuntu-24.04"
}

variable "admin_username" {
  type    = string
  default = "gmed"
}

variable "admin_ssh_public_key" {
  type        = string
  description = "OpenSSH public key for SSH access. Required."
}

variable "admin_ip_allowlist" {
  type        = list(string)
  description = <<-EOT
    CIDRs allowed to SSH to the DEV box. Use your office/home/VPN IPs.
    Empty list locks SSH down — use that mode once Tailscale is wired in.
  EOT
  default     = []
}

# ----------------------------------------------------------------------------
# Phase 1 — application deploy.
# ----------------------------------------------------------------------------

variable "deploy_app" {
  type        = bool
  description = "Optional legacy bootstrap app deploy. Keep false for the standard infra-only Terraform flow; use scripts/publish-dev-current.ps1 or scripts/deploy-dev.sh for app releases."
  default     = false
}

variable "app_repo_url" {
  type    = string
  default = "https://github.com/oleksandrmelnychenko/gmed-crm.git"
}

variable "app_branch" {
  type    = string
  default = "main"
}

variable "age_private_key" {
  type        = string
  sensitive   = true
  description = <<-EOT
    age private key for decrypting secrets.sops.yaml on the host.
    Generate with `age-keygen -o dev.key`; paste the AGE-SECRET-KEY-1...
    line. Keep the file outside this repo (1Password is fine).
  EOT
  default     = ""
}

# ----------------------------------------------------------------------------
# Tailscale: needed so the monitoring host's Prometheus can scrape DEV
# exporters via the tailnet (gmed-dev:9091/9100/9080/9187) and so
# Promtail on DEV can push logs to gmed-monitoring's Loki.
#
# DEV pattern: auth key lives in TF state. PROD does this out-of-band.
# ----------------------------------------------------------------------------

variable "tailscale_enabled" {
  type        = bool
  description = "Install + authenticate Tailscale in the bootstrap."
  default     = true
}

variable "tailscale_auth_key" {
  type        = string
  sensitive   = true
  description = <<-EOT
    Pre-auth key tagged `tag:gmed-dev`. Reusable + non-ephemeral so
    re-bootstraps keep the same tailnet identity. Generate at
    https://login.tailscale.com/admin/settings/keys.
  EOT
  default     = ""
}
