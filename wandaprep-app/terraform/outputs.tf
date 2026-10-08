# Cluster outputs
output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "cluster_name" {
  value = module.eks.cluster_name
}

output "oidc_provider_arn" {
  description = "OIDC provider ARN — used by all IRSA roles"
  value       = module.eks.oidc_provider_arn
}

output "oidc_provider" {
  description = "OIDC provider URL (without https://)"
  value       = module.eks.oidc_provider
}

output "app_bucket_name" {
  value = aws_s3_bucket.app.bucket
}

output "app_irsa_role_arn" {
  description = "App service account role ARN (ECR + CloudWatch)"
  value       = module.app_irsa.iam_role_arn
}

output "ebs_csi_role_arn" {
  description = "EBS CSI driver IRSA role ARN"
  value       = module.ebs_csi_irsa.iam_role_arn
}

output "lb_controller_role_arn" {
  description = "AWS Load Balancer Controller IRSA role ARN"
  value       = module.lb_controller_irsa.iam_role_arn
}

output "kubeconfig_command" {
  value = "aws eks update-kubeconfig --name ${var.cluster_name}-${var.environment} --region ${var.region}"
}

# ECR output
output "ecr_app_url" {
  value = aws_ecr_repository.app.repository_url
}
