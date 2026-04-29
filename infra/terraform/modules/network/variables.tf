variable "name_prefix" {
  type        = string
  description = "Name prefix for resources"
}

variable "availability_zone" {
  type        = string
  description = "AZ for the public subnet"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR"
  default     = "10.42.0.0/16"
}

variable "public_subnet_cidr" {
  type        = string
  description = "Public subnet CIDR"
  default     = "10.42.10.0/24"
}

variable "allowed_ssh_cidrs" {
  type        = list(string)
  description = "CIDRs allowed for SSH access"
  default     = []
}

variable "allowed_http_cidrs" {
  type        = list(string)
  description = "CIDRs allowed for HTTP/HTTPS"
  default     = ["0.0.0.0/0"]
}

variable "tags" {
  type        = map(string)
  description = "Tags"
  default     = {}
}

