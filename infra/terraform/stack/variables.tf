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
