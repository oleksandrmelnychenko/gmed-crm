output "firewall_id" {
  value       = hcloud_firewall.this.id
  description = "Firewall ID. Pass to `hcloud_server.firewall_ids` as a numeric ID — callers should wrap with tonumber() at the boundary."
}
