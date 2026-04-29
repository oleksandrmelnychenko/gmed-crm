variable "name_prefix" {
  type        = string
  description = "Name prefix"
}

variable "environment" {
  type        = string
  description = "Environment name"
}

variable "instance_id" {
  type        = string
  description = "EC2 instance id for alarms"
}

variable "monthly_budget_usd" {
  type        = number
  description = "Monthly AWS budget in USD"
  default     = 60
}

variable "alert_email" {
  type        = string
  description = "Email for SNS subscription"
  default     = ""
}

variable "cpu_alarm_threshold" {
  type        = number
  description = "High CPU threshold percentage"
  default     = 80
}

variable "tags" {
  type        = map(string)
  description = "Tags"
  default     = {}
}

