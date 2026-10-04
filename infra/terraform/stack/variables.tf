variable "environment" {
  description = "Deployment environment; use a separate backend and GitHub Environment for each."
  type        = string

  validation {
    condition     = contains(["dev", "prd"], var.environment)
    error_message = "environment must be dev or prd."
  }
}

variable "aws_account_id" {
  description = "Expected AWS account ID. The provider rejects credentials for a different account."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must contain exactly 12 digits."
  }
}

variable "aws_region" {
  description = "AWS region hosting this environment."
  type        = string
  default     = "ap-northeast-2"

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be an AWS region name."
  }
}

variable "deployment_role_arn" {
  description = "GitHub Actions OIDC IAM role granted explicit EKS administrator access."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:iam::${var.aws_account_id}:role/[A-Za-z0-9+=,.@_/-]+$", var.deployment_role_arn))
    error_message = "deployment_role_arn must be an IAM role in aws_account_id."
  }
}

variable "cluster_version" {
  description = "EKS Kubernetes version; verify regional availability before upgrades."
  type        = string
  default     = "1.35"

  validation {
    condition     = can(regex("^1\\.[0-9]{2}$", var.cluster_version))
    error_message = "cluster_version must be a Kubernetes minor version such as 1.35."
  }
}

variable "eks_public_access_cidrs" {
  description = "CIDRs allowed to reach the IAM-authenticated EKS API. GitHub-hosted runners need public access; restrict when using runners with fixed egress IPs."
  type        = list(string)
  default     = ["0.0.0.0/0"]

  validation {
    condition     = length(var.eks_public_access_cidrs) > 0 && alltrue([for cidr in var.eks_public_access_cidrs : can(cidrnetmask(cidr))])
    error_message = "eks_public_access_cidrs must contain valid IPv4 CIDRs."
  }
}

variable "container_logs_enabled" {
  description = "Install the amazon-cloudwatch-observability add-on so pod stdout is readable without cluster access. Off by default: it bills per ingested GB and per Container Insights observation."
  type        = bool
  default     = false
}

variable "container_logs_retention_days" {
  description = "Expiry for the Container Insights log groups. CloudWatch keeps log data forever unless a retention is set, so this is always set explicitly."
  type        = number
  default     = 7

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90], var.container_logs_retention_days)
    error_message = "container_logs_retention_days must be one of the CloudWatch values 1, 3, 5, 7, 14, 30, 60 or 90; longer storage is a cost decision, not a default."
  }
}

variable "vpc_cidr" {
  description = "Environment-specific IPv4 /16; public, private compute and isolated data subnets are derived from this range."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr)) && endswith(var.vpc_cidr, "/16")
    error_message = "vpc_cidr must be a valid IPv4 /16 CIDR."
  }
}

variable "availability_zone_count" {
  description = "Two AZs for DEV or three for PRD."
  type        = number
  default     = 2

  validation {
    condition     = contains([2, 3], var.availability_zone_count) && (var.environment != "prd" || var.availability_zone_count == 3)
    error_message = "Use two or three AZs; PRD requires three."
  }
}

variable "single_nat_gateway" {
  description = "Share one NAT in DEV; PRD requires one per AZ."
  type        = bool
  default     = true

  validation {
    condition     = var.environment != "prd" || !var.single_nat_gateway
    error_message = "PRD requires a separate NAT gateway in each AZ."
  }
}

variable "database_instance_class" {
  description = "RDS PostgreSQL instance class."
  type        = string
  default     = "db.t4g.small"

  validation {
    condition     = can(regex("^db\\.[a-z0-9]+\\.[a-z0-9]+$", var.database_instance_class))
    error_message = "database_instance_class must be a valid RDS instance class name."
  }
}

variable "database_allocated_storage" {
  description = "Initial encrypted gp3 PostgreSQL storage in GiB."
  type        = number
  default     = 20

  validation {
    condition     = var.database_allocated_storage >= 20 && floor(var.database_allocated_storage) == var.database_allocated_storage
    error_message = "database_allocated_storage must be an integer of at least 20 GiB."
  }
}

variable "database_max_allocated_storage" {
  description = "Upper bound for RDS automatic storage scaling in GiB."
  type        = number
  default     = 200

  validation {
    condition     = var.database_max_allocated_storage >= var.database_allocated_storage && floor(var.database_max_allocated_storage) == var.database_max_allocated_storage
    error_message = "database_max_allocated_storage must be an integer at least as large as allocated storage."
  }
}

variable "redis_node_type" {
  description = "ElastiCache Redis-compatible node class."
  type        = string
  default     = "cache.t4g.micro"

  validation {
    condition     = can(regex("^cache\\.[a-z0-9]+\\.[a-z0-9]+$", var.redis_node_type))
    error_message = "redis_node_type must be a valid ElastiCache node class name."
  }
}

variable "data_protection_enabled" {
  description = <<-EOT
    삭제 보호 · 최종 스냅숏 · 백업 보존을 켠다. **환경과 분리된 축이다.**

    종전에는 이 셋이 `local.production`(= environment == "prd") 하나에 묶여 있었다. 그래서 dev
    스택은 `deletion_protection=false · skip_final_snapshot=true · backup_retention=1일` 로 돌았고,
    그것은 "꼬이면 날려도 되는 환경"의 올바른 설정이다. 문제는 **스토어 출시를 dev 스택으로
    받기로 한 순간**(2026-10-04 결정) 그 전제가 깨진다는 것이다 — 실사용자 데이터가 들어오는데
    삭제 보호가 없고 지워도 최종 스냅숏이 안 남는다.

    `multi_az` 는 **여기 포함하지 않는다** — 그쪽은 가용성·비용 축이고, 끄고 가도 데이터 유실은
    아니다(AZ 장애 시 복구 시간만 길어진다). Redis 스냅숏(`snapshot_retention_limit`)도 제외다 —
    Redis 는 캐시이고 영속 사실은 PostgreSQL 에 있다.

    기본값이 `true` 인 이유: 잊었을 때 보호가 켜지는 쪽으로 틀려야 한다.
  EOT
  type        = bool
  default     = true
}
