output "instance_id" {
  value = aws_instance.app.id
}

output "public_ip" {
  value = var.associate_eip ? aws_eip.app[0].public_ip : aws_instance.app.public_ip
}

output "public_dns" {
  value = aws_instance.app.public_dns
}

