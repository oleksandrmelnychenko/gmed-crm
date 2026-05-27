variable "name_prefix" {
  type        = string
  description = "Name prefix for resources"
}

variable "region" {
  type        = string
  description = "AWS region"
}

variable "subnet_id" {
  type        = string
  description = "Subnet ID for the instance"
}

variable "security_group_id" {
  type        = string
  description = "Security group ID"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type"
  default     = "t4g.micro"
}

variable "cpu_architecture" {
  type        = string
  description = "AMI architecture selector (arm64 or amd64)"
  default     = "arm64"

  validation {
    condition     = contains(["arm64", "amd64"], var.cpu_architecture)
    error_message = "cpu_architecture must be arm64 or amd64."
  }
}

variable "ami_id" {
  type        = string
  description = "Optional AMI override. Leave empty to auto-select Ubuntu."
  default     = ""
}

variable "key_name" {
  type        = string
  description = "Optional EC2 key pair name for SSH access"
  default     = null
}

variable "associate_eip" {
  type        = bool
  description = "Attach an Elastic IP to the instance"
  default     = true
}

variable "root_volume_size_gb" {
  type        = number
  description = "Root volume size (GB)"
  default     = 30
}

variable "app_repo_url" {
  type        = string
  description = "Git URL for app source"
}

variable "app_branch" {
  type        = string
  description = "Git branch to deploy"
  default     = "main"
}

variable "backend_port" {
  type        = number
  description = "Backend host port"
  default     = 3000
}

variable "frontend_port" {
  type        = number
  description = "Frontend host port"
  default     = 8080
}

variable "ssm_parameter_names" {
  type = object({
    database_url                  = string
    jwt_secret                    = string
    message_encryption_keys       = string
    message_encryption_key_active = string
    audit_ip_salt                 = string
    cors_origin                   = string
    lead_intake_token             = optional(string, "")
  })
  description = "SSM parameter names used by bootstrap"
}

variable "tags" {
  type        = map(string)
  description = "Tags"
  default     = {}
}

