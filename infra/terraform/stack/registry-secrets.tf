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

  name        = "trippilot/${var.environment}/${each.key}"
  description = each.value
  # **RDS 스냅숏이 못 덮는 유실 축이다.** 이 그릇에 `SOCIAL_TOKEN_ENCRYPTION_KEY` 가 들어간다
  # (`ProviderTokenCipher` — provider 토큰을 DB 에 평문으로 남기지 않기 위한 AES 키).
  # 7일이 지나 영구 삭제되면 **최종 스냅숏을 복원해도** `provider_revocation_token` 을 복호할 수
  # 없고, 전 계정의 소셜 revoke 가 영구히 불가능해진다. 그래서 데이터 보호 축에 함께 건다.
  recovery_window_in_days = var.data_protection_enabled ? 30 : 7
}
