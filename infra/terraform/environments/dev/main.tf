terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  frontend_cidrs = (
    var.allowed_frontend_cidrs == null
    ? var.allowed_http_cidrs
    : var.allowed_frontend_cidrs
  )

  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

module "network" {
  source = "../../modules/network"

  name_prefix        = local.name_prefix
  availability_zone  = data.aws_availability_zones.available.names[0]
  vpc_cidr           = var.vpc_cidr
  public_subnet_cidr = var.public_subnet_cidr
  allowed_ssh_cidrs  = var.allowed_ssh_cidrs
  allowed_http_cidrs = var.allowed_http_cidrs
  tags               = local.tags
}

module "compute" {
  source = "../../modules/compute"

  name_prefix         = local.name_prefix
  region              = var.aws_region
  subnet_id           = module.network.public_subnet_id
  security_group_id   = module.network.security_group_id
  instance_type       = var.instance_type
  cpu_architecture    = var.cpu_architecture
  ami_id              = var.ami_id
  key_name            = var.key_name
  associate_eip       = var.associate_eip
  root_volume_size_gb = var.root_volume_size_gb
  app_repo_url        = var.app_repo_url
  app_branch          = var.app_branch
  backend_port        = var.backend_port
  frontend_port       = var.frontend_port
  ssm_parameter_names = var.ssm_parameter_names
  tags                = local.tags
}

resource "aws_security_group_rule" "frontend_ingress" {
  type              = "ingress"
  from_port         = var.frontend_port
  to_port           = var.frontend_port
  protocol          = "tcp"
  cidr_blocks       = local.frontend_cidrs
  security_group_id = module.network.security_group_id
  description       = "Frontend app"
}

resource "aws_security_group_rule" "backend_ingress" {
  count = length(var.allowed_backend_cidrs) == 0 ? 0 : 1

  type              = "ingress"
  from_port         = var.backend_port
  to_port           = var.backend_port
  protocol          = "tcp"
  cidr_blocks       = var.allowed_backend_cidrs
  security_group_id = module.network.security_group_id
  description       = "Backend API"
}

module "ops" {
  source = "../../modules/ops"

  name_prefix         = local.name_prefix
  environment         = var.environment
  instance_id         = module.compute.instance_id
  monthly_budget_usd  = var.monthly_budget_usd
  alert_email         = var.budget_email
  cpu_alarm_threshold = var.cpu_alarm_threshold
  tags                = local.tags
}

