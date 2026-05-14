output "ipv4" {
  value       = module.compute.ipv4_address
  description = "Public IPv4 of the monitoring server. Used only for the one-time SSH during Tailscale bootstrap; steady-state access is via tailnet."
}

output "ipv6" {
  value = module.compute.ipv6_address
}

output "ssh" {
  value = module.compute.ssh_command
}
