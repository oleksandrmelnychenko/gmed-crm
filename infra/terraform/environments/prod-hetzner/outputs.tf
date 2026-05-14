output "ipv4" {
  value       = module.compute.ipv4_address
  description = "Stable public IPv4 of the PROD server. Point console.gmed-health.com here."
}

output "ipv6" {
  value       = module.compute.ipv6_address
  description = "Public IPv6 of the PROD server."
}

output "ssh" {
  value       = module.compute.ssh_command
  description = "Paste-ready SSH command."
}
