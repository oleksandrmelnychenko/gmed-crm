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

# Stateful firewall applied to a Hetzner Cloud server role.
#
# Inbound default: deny-all. Each opened port is explicit. SSH is gated on
# a CIDR allow-list; pass an empty list to lock SSH down completely (e.g.
# when access is intermediated by Tailscale).
#
# The firewall is created independently from the server. The server
# module attaches it via `firewall_ids`, which means destroying a server
# does not destroy this firewall (and vice versa). Rules can be tightened
# without ever rebooting the host.

resource "hcloud_firewall" "this" {
  name   = var.name
  labels = var.labels

  dynamic "rule" {
    for_each = length(var.allowed_ssh_cidrs) == 0 ? [] : [1]
    content {
      description = "SSH"
      direction   = "in"
      protocol    = "tcp"
      port        = "22"
      source_ips  = var.allowed_ssh_cidrs
    }
  }

  dynamic "rule" {
    for_each = var.allow_http ? [1] : []
    content {
      description = "HTTP (ACME HTTP-01 + redirect to HTTPS)"
      direction   = "in"
      protocol    = "tcp"
      port        = "80"
      source_ips  = ["0.0.0.0/0", "::/0"]
    }
  }

  dynamic "rule" {
    for_each = var.allow_https ? [1] : []
    content {
      description = "HTTPS"
      direction   = "in"
      protocol    = "tcp"
      port        = "443"
      source_ips  = ["0.0.0.0/0", "::/0"]
    }
  }

  # ICMP is closed by default. Open only if you need ping-based health
  # checks from outside the project.
  dynamic "rule" {
    for_each = var.allow_icmp ? [1] : []
    content {
      description = "ICMP echo"
      direction   = "in"
      protocol    = "icmp"
      source_ips  = ["0.0.0.0/0", "::/0"]
    }
  }

  # Arbitrary extra rules (e.g. Postgres on a private subnet, monitoring
  # exporters from a fixed scrape source).
  dynamic "rule" {
    for_each = var.extra_inbound_rules
    content {
      description = rule.value.description
      direction   = "in"
      protocol    = rule.value.protocol
      port        = lookup(rule.value, "port", null)
      source_ips  = rule.value.source_ips
    }
  }
}
