# Terraform for AWS (Low-Cost Baseline)

This folder contains a pragmatic Terraform baseline for running this project on AWS with a cost-first setup:

- single EC2 instance (default `t4g.micro`)
- Docker Compose runtime on the host
- one public subnet (no NAT Gateway)
- security group with explicit SSH allowlist
- budget alarms and basic instance CloudWatch alarms
- secrets loaded from SSM Parameter Store at boot

This is intended for `dev`/early `stage`. For production, extend with private subnets, ALB + ACM, managed DB, and stronger HA.

## Structure

- `environments/dev` - ready-to-use environment wiring
- `modules/network` - VPC, subnet, route table, security group
- `modules/compute` - EC2, IAM role/profile, bootstrap user-data, optional EIP
- `modules/ops` - budget and alarms

## Prerequisites

- Terraform `>= 1.6`
- AWS credentials configured locally (profile or env vars)
- Existing SSM SecureString parameters for app secrets

## Quick start

1. Copy:
   - `infra/terraform/environments/dev/terraform.tfvars.example`
   - to `infra/terraform/environments/dev/terraform.tfvars`
2. Fill:
   - `allowed_ssh_cidrs`
   - `budget_email`
   - `ssm_parameter_names` to match your account paths
3. Run:

```bash
cd infra/terraform/environments/dev
terraform init
terraform plan
terraform apply
```

After apply, Terraform outputs the public URL/IP.

## Secret contract (SSM)

Bootstrap script expects these parameter names:

- `DATABASE_URL`
- `JWT_SECRET`
- `MESSAGE_ENCRYPTION_KEYS`
- `MESSAGE_ENCRYPTION_KEY_ACTIVE`
- `AUDIT_IP_SALT`
- `CORS_ORIGIN`

The instance role is granted read access to these parameters.

## Notes

- The bootstrap process clones/pulls the repo and runs:
  - `docker compose -f docker-compose.yml -f docker-compose.release.yml up -d --build`
- This keeps infra simple and cheap, but image builds happen on EC2.
- For the next phase, switch to prebuilt images (ECR/GHCR) to reduce deploy time and variability.

