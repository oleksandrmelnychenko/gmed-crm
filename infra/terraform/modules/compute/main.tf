data "aws_caller_identity" "current" {}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name = "name"
    values = [
      "ubuntu/images/hvm-ssd*/ubuntu-jammy-22.04-${var.cpu_architecture}-server-*",
    ]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  ami_id = var.ami_id != "" ? var.ami_id : data.aws_ami.ubuntu.id

  ssm_parameter_arns = [
    for name in compact(values(var.ssm_parameter_names)) :
    "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${trimprefix(name, "/")}"
  ]

  ssm_kms_key_arns = [
    "arn:aws:kms:${var.region}:${data.aws_caller_identity.current.account_id}:key/*",
  ]
}

resource "aws_iam_role" "instance" {
  name = "${var.name_prefix}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      },
    ]
  })

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-ec2-role"
  })
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "ssm_secrets_read" {
  name = "${var.name_prefix}-ssm-read"
  role = aws_iam_role.instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadRequiredSsmParams"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = local.ssm_parameter_arns
      },
      {
        Sid      = "DecryptSecureStrings"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = local.ssm_kms_key_arns
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.region}.amazonaws.com"
          }
          "ForAnyValue:StringLike" = {
            "kms:EncryptionContext:PARAMETER_ARN" = local.ssm_parameter_arns
          }
        }
      },
    ]
  })
}

resource "aws_iam_instance_profile" "this" {
  name = "${var.name_prefix}-instance-profile"
  role = aws_iam_role.instance.name
}

resource "aws_instance" "app" {
  ami                         = local.ami_id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [var.security_group_id]
  key_name                    = var.key_name
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.this.name

  root_block_device {
    volume_size           = var.root_volume_size_gb
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  user_data = templatefile("${path.module}/templates/bootstrap.sh.tftpl", {
    aws_region         = var.region
    app_repo_url       = var.app_repo_url
    app_branch         = var.app_branch
    backend_port       = var.backend_port
    frontend_port      = var.frontend_port
    database_url_param = var.ssm_parameter_names.database_url
    jwt_secret_param   = var.ssm_parameter_names.jwt_secret
    keys_param         = var.ssm_parameter_names.message_encryption_keys
    active_key_param   = var.ssm_parameter_names.message_encryption_key_active
    audit_salt_param   = var.ssm_parameter_names.audit_ip_salt
    cors_origin_param  = var.ssm_parameter_names.cors_origin
    lead_token_param   = var.ssm_parameter_names.lead_intake_token
  })

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-app"
  })
}

resource "aws_eip" "app" {
  count    = var.associate_eip ? 1 : 0
  domain   = "vpc"
  instance = aws_instance.app.id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-eip"
  })
}

