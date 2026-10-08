# Terraform - All Infrastructure

## What's Deployed
- **VPC**: `landmark-vpc-<env>` with public/private subnets across multiple AZs
- **EKS**: `landmark-cluster-<env>` in private subnets with managed node group (ASG)
- **RDS**: `landmark-db-<env>` PostgreSQL in private subnets
- **ECR**: `employee-backend` and `employee-frontend` repositories
- **S3**: `landmark-app-bucket-<env>` for application use
- **IAM**: IRSA roles for LB controller and S3 access
- **CloudWatch**: All EKS control plane logs

## Structure
```
terraform/
├── provider.tf       # AWS provider + S3 backend
├── variables.tf      # All input variables
├── main.tf           # VPC module, EKS module, S3, IRSA
├── rds.tf            # RDS PostgreSQL, subnet group, security group
├── ecr.tf            # ECR repositories for Docker images
├── outputs.tf        # All outputs (cluster, RDS, ECR)
├── README.md
└── env/
    ├── dev/terraform.tfvars
    ├── stg/terraform.tfvars
    └── prod/terraform.tfvars
```

## Deployment

```bash
terraform init
terraform plan -var-file=env/dev/terraform.tfvars
terraform apply -var-file=env/dev/terraform.tfvars
```

## Destroy
```bash
terraform destroy -var-file=env/dev/terraform.tfvars
```
