variable "project_name" {
  type    = string
  default = "gmed"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "datacenter" {
  type        = string
  description = "Hetzner datacenter. Locked to DE in the compute module precondition."
  default     = "nbg1-dc3"
}

variable "server_type" {
  type        = string
  description = <<-EOT
    Hetzner Cloud server type. cpx42 (x86_64) is the PROD default so
    one release image architecture can run on both DEV and PROD. It is
    comfortable for the app + Postgres + Caddy + frontend co-tenant
    while keeping the GitHub release workflow on standard amd64 runners.
  EOT
  default     = "cpx42"
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

variable "postgres_volume_size_gb" {
  type        = number
  description = <<-EOT
    Hetzner Volume size in GB for Postgres data. Start small (10–50);
    Hetzner Volumes resize online so over-provisioning is unnecessary.
    Pricing: ~€0.0476/GB/mo (50 GB ≈ €2.40/mo).
  EOT
  default     = 50
}

variable "admin_ip_allowlist" {
  type        = list(string)
  description = <<-EOT
    CIDRs allowed to SSH to PROD on the PUBLIC firewall (Hetzner
    edge). For the steady state with Tailscale enabled, this should be
    `[]` — admin access then traverses the tailnet only and TCP/22 is
    closed to the internet. On the first bootstrap (before Tailscale
    is authenticated) the list must be non-empty so the operator can
    SSH in to run `scripts/deploy-prod.sh`. See README "Tailscale
    bootstrap" for the two-step apply.
  EOT
  default     = []
}

variable "tailscale_enabled" {
  type        = bool
  description = <<-EOT
    Install Tailscale in the bootstrap. PROD authenticates the daemon
    via `scripts/deploy-prod.sh` (auth key from sops), never via TF
    state.
  EOT
  default     = true
}
