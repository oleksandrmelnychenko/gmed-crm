output "server_id" {
  value       = hcloud_server.this.id
  description = "Hetzner Cloud server ID."
}

output "ipv4_address" {
  value       = hcloud_primary_ip.ipv4.ip_address
  description = "Stable public IPv4. Survives server destroy/recreate."
}

output "ipv6_address" {
  value       = hcloud_server.this.ipv6_address
  description = "Public IPv6 (Hetzner /64)."
}

output "ssh_command" {
  value       = "ssh ${var.admin_username}@${hcloud_primary_ip.ipv4.ip_address}"
  description = "Convenience: paste-ready SSH command using the admin user."
}
