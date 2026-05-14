variable "name" {
  type        = string
  description = "Volume name. Must be unique in the Hetzner Cloud project."
}

variable "size_gb" {
  type        = number
  description = "Volume size in GB (10–10240). For Postgres start small (10–50) — resizes are online and trivial."
  default     = 50
}

variable "location" {
  type        = string
  description = "Hetzner location (fsn1, nbg1, hel1). Must match the location of the server the volume attaches to."

  validation {
    condition     = contains(["fsn1", "nbg1"], var.location)
    error_message = "Locations are restricted to DE (fsn1, nbg1) for GDPR/BSI C5 data residency."
  }
}

variable "format" {
  type        = string
  description = "Filesystem to pre-format the volume with. Hetzner runs mkfs at creation."
  default     = "ext4"
}

variable "delete_protection" {
  type        = bool
  description = "Refuse `terraform destroy` until this is flipped to false. Default true for PROD-grade safety."
  default     = true
}

variable "labels" {
  type        = map(string)
  description = "Hetzner labels applied to the volume."
  default     = {}
}
