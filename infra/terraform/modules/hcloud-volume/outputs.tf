output "volume_id" {
  value       = hcloud_volume.this.id
  description = "Volume ID (numeric). Pass to hcloud_volume_attachment.volume_id."
}

output "linux_device" {
  # Hetzner exposes the volume at a stable by-id path. This survives
  # reboots and re-attaches; using /dev/sdb directly is unsafe (kernel
  # may reorder devices).
  value       = hcloud_volume.this.linux_device
  description = "Stable Linux device path of the volume (/dev/disk/by-id/scsi-0HC_Volume_<id>)."
}

output "size_gb" {
  value       = hcloud_volume.this.size
  description = "Volume size, as accepted by Hetzner (read back from the API)."
}
