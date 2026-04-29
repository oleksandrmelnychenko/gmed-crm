variable "project_name" {
  type        = string
  description = "Project identifier"
  default     = "gmed"
}

variable "environment" {
  type        = string
  description = "Environment name"
  default     = "dev"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "eu-central-1"
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
  description = "CIDRs allowed for SSH"
}

variable "allowed_http_cidrs" {
  type        = list(string)
  description = "CIDRs allowed for HTTP/HTTPS"
  default     = ["0.0.0.0/0"]
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
}

variable "ami_id" {
  type        = string
  description = "Optional AMI override"
  default     = ""
}

variable "key_name" {
  type        = string
  description = "Optional EC2 key pair name"
  default     = null
}

variable "associate_eip" {
  type        = bool
  description = "Attach Elastic IP"
  default     = true
}

variable "root_volume_size_gb" {
  type        = number
  description = "Root EBS size"
  default     = 30
}

variable "app_repo_url" {
  type        = string
  description = "Git repository URL used by bootstrap"
  default     = "https://github.com/oleksandrmelnychenko/gmed-crm.git"
}

variable "app_branch" {
  type        = string
  description = "Git branch deployed on instance"
  default     = "main"
}

variable "backend_port" {
  type        = number
  description = "Backend public port"
  default     = 3000
}

variable "frontend_port" {
  type        = number
  description = "Frontend public port"
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
  })
  description = "SSM parameter names with app secrets/config"
}

variable "monthly_budget_usd" {
  type        = number
  description = "Monthly budget cap"
  default     = 60
}

variable "budget_email" {
  type        = string
  description = "Email for budget/alarm notifications"
  default     = ""
}

variable "cpu_alarm_threshold" {
  type        = number
  description = "High CPU threshold percentage"
  default     = 80
}

