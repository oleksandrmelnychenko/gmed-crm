variable "project_name" {
  type    = string
  default = "gmed"
}

variable "environment" {
  type    = string
  default = "monitoring"
}

variable "datacenter" {
  type        = string
  description = "Hetzner datacenter. DE-locked in the compute module precondition."
  default     = "fsn1-dc14"
}

variable "server_type" {
  type        = string
  description = "cax21 (4 vCPU / 8 GB ARM, ~€6.49/mo) is the monitoring default — Loki + Prometheus both like extra RAM for indexing and query caching, and 8 GB leaves room for a few Grafana dashboards open at once."
  default     = "cax21"
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
  description = "OpenSSH public key for SSH access."
}

variable "admin_ip_allowlist" {
  type        = list(string)
  description = <<-EOT
    Same pattern as PROD: non-empty for the initial bootstrap so the
    operator can SSH in to authenticate Tailscale via
    `scripts/deploy-monitoring.sh`. After Tailscale is up, flip to `[]`
    and re-apply to close TCP/22.
  EOT
  default     = []
}

variable "tailscale_enabled" {
  type        = bool
  description = "Install Tailscale in the bootstrap. The deploy script authenticates it from sops."
  default     = true
}
