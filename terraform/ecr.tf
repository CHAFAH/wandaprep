# ECR repository for wandaprep-app
resource "aws_ecr_repository" "app" {
  name                 = "wandaprep-app"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name        = "wandaprep-app"
    Environment = var.environment
  }
}
