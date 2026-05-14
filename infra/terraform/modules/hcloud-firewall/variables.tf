variable "name" {
  type        = string
  description = "Firewall name. Must be unique within the Hetzner Cloud project."
}

variable "allowed_ssh_cidrs" {
  type        = list(string)
  description = <<-EOT
    CIDRs allowed to reach TCP/22. Empty list disables SSH entirely.
    Prefer an empty list in production and route SSH through Tailscale or
    a dedicated bastion; for development a tight admin allow-list is OK.
  EOT
  default     = []
}

variable "allow_http" {
  type        = bool
  description = "Open TCP/80 to the internet. Required for ACME HTTP-01 challenges and the HTTP->HTTPS redirect served by the edge proxy."
  default     = false
}

variable "allow_https" {
  type        = bool
  description = "Open TCP/443 to the internet."
  default     = false
}

variable "allow_icmp" {
  type        = bool
  description = "Open ICMP echo. Off by default; enable only for external uptime probes that need ping."
  default     = false
}

variable "extra_inbound_rules" {
  type = list(object({
    description = string
    protocol    = string
    port        = optional(string)
    source_ips  = list(string)
  }))
  description = <<-EOT
    Additional ingress rules. Use for things like Postgres on a private
    Hetzner Network, or a Prometheus scrape source. The `port` field is
    omitted for ICMP rules.
  EOT
  default     = []
}

variable "labels" {
  type        = map(string)
  description = "Hetzner labels applied to the firewall (project, environment, role)."
  default     = {}
}
