locals {
  app_secret_descriptions = {
    backend  = "Backend JWT signing and external API credentials"
    ai       = "AI provider and travel data API credentials"
    database = "Runtime PostgreSQL application and migration role passwords"
    shared   = "Shared backend/AI service authentication token"
  }
}

resource "aws_ecr_repository" "app" {
  for_each = toset(["backend", "ai", "embedding"])

  name                 = "${local.name}/${each.value}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Remove untagged build layers after 14 days; retain versioned releases"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 14
      }
      action = { type = "expire" }
    }]
  })
}

# Only containers are managed here. Populate JSON values in Secrets Manager;
# never pass credentials as tfvars, outputs, or aws_secretsmanager_secret_version.
resource "aws_secretsmanager_secret" "app" {
  for_each = local.app_secret_descriptions

  name                    = "trippilot/${var.environment}/${each.key}"
  description             = each.value
  recovery_window_in_days = local.production ? 30 : 7
}
