# CloudWatch Log Group for the application
resource "aws_cloudwatch_log_group" "app" {
  name              = "/wandaprep-app"
  retention_in_days = 14

  tags = {
    Name        = "wandaprep-app-logs"
    Environment = var.environment
  }

  lifecycle {
    ignore_changes = [name]
  }
}

