terraform {
  required_providers {
    hcloud = {
      source = "hetznercloud/hcloud"
    }
  }
}

# A standalone Hetzner Cloud Volume.
#
# Created without `server_id` so the volume lifecycle is decoupled from
# any server: a `terraform destroy` of the server (or a `taint` for
# rebuild) leaves the volume intact. Attachment is done separately —
# typically by the compute module — via `hcloud_volume_attachment`.
#
# `delete_protection = true` is the default. With patient PII at stake,
# making `terraform destroy` of the volume require an explicit flag flip
# is cheap insurance against a fat-finger.
#
# `format = "ext4"` makes Hetzner pre-format the new volume so the
# bootstrap script can skip mkfs. The format runs once at creation; it
# is NOT replayed on reattach.
#
# The volume must live in the same Hetzner location as the server it
# will attach to (fsn1, nbg1, ...). The caller derives this from the
# server's datacenter (e.g. `split("-", "fsn1-dc14")[0]`).

resource "hcloud_volume" "this" {
  name              = var.name
  size              = var.size_gb
  location          = var.location
  format            = var.format
  delete_protection = var.delete_protection
  labels            = var.labels

  lifecycle {
    precondition {
      condition     = var.size_gb >= 10 && var.size_gb <= 10240
      error_message = "Hetzner Volume size must be between 10 and 10240 GB."
    }

    precondition {
      condition     = contains(["ext4", "xfs"], var.format)
      error_message = "Volume format must be ext4 or xfs (Hetzner-supported values)."
    }
  }
}
