terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.38"
    }
  }

  # GitHub Actions supplies a separate bucket and key for each environment.
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      Project     = "trippilot"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Chatbot(Slack 채널 설정) 전용. 서울에는 Chatbot API 가 없다 — alerts.tf 참조.
provider "aws" {
  alias               = "chatbot"
  region              = "us-east-2"
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      Project     = "trippilot"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
