output "instance_id" {
  value = module.compute.instance_id
}

output "public_ip" {
  value = module.compute.public_ip
}

output "public_dns" {
  value = module.compute.public_dns
}

output "frontend_url" {
  value = "http://${module.compute.public_ip}:${var.frontend_port}"
}

output "backend_health_url" {
  value = "http://${module.compute.public_ip}:${var.backend_port}/health"
}

output "alerts_topic_arn" {
  value = module.ops.alerts_topic_arn
}

