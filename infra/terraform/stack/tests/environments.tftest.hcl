mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ap-northeast-2a", "ap-northeast-2b", "ap-northeast-2c"]
    }
  }

  mock_data "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/trippilot-test"
    }
  }
}

variables {
  aws_account_id      = "123456789012"
  deployment_role_arn = "arn:aws:iam::123456789012:role/trippilot-github-dev"
}

run "dev_is_private_and_cost_conscious" {
  command = plan

  override_data {
    target = data.aws_iam_role.cluster
    values = { arn = "arn:aws:iam::123456789012:role/trippilot-dev-cluster" }
  }

  override_data {
    target = data.aws_iam_role.node
    values = { arn = "arn:aws:iam::123456789012:role/trippilot-dev-node" }
  }

  variables {
    environment                = "dev"
    availability_zone_count    = 2
    single_nat_gateway         = true
    vpc_cidr                   = "10.40.0.0/16"
    database_instance_class    = "db.t4g.small"
    database_allocated_storage = 20
    redis_node_type            = "cache.t4g.micro"
  }

  assert {
    condition     = length(aws_subnet.private) == 2 && length(aws_subnet.data) == 2 && length(aws_nat_gateway.this) == 1
    error_message = "DEV must have private compute/data in two AZs with one NAT gateway."
  }

  assert {
    condition     = alltrue([for subnet in aws_subnet.private : !subnet.map_public_ip_on_launch]) && alltrue([for subnet in aws_subnet.data : !subnet.map_public_ip_on_launch])
    error_message = "Compute and data subnets must never assign public IPs."
  }

  assert {
    condition     = !aws_db_instance.postgres.publicly_accessible && aws_db_instance.postgres.storage_encrypted && aws_db_instance.postgres.manage_master_user_password
    error_message = "PostgreSQL must be private, encrypted and use an AWS-managed master secret."
  }

  assert {
    condition     = aws_elasticache_replication_group.redis.transit_encryption_enabled && aws_elasticache_replication_group.redis.at_rest_encryption_enabled && aws_elasticache_replication_group.redis.transit_encryption_mode == "required"
    error_message = "Cache traffic and stored data must always be encrypted."
  }

  assert {
    condition     = alltrue([for repository in aws_ecr_repository.app : repository.image_tag_mutability == "IMMUTABLE" && !repository.force_delete]) && length(aws_ecr_repository.app) == 3
    error_message = "Backend, AI and embedding repositories must prevent image tag replacement and forced deletion."
  }

  assert {
    condition     = aws_eks_cluster.this.compute_config[0].enabled && aws_eks_cluster.this.storage_config[0].block_storage[0].enabled && aws_eks_cluster.this.kubernetes_network_config[0].elastic_load_balancing[0].enabled && !aws_eks_cluster.this.bootstrap_self_managed_addons
    error_message = "Auto Mode requires compute, block storage and load balancing together, without unmanaged add-ons."
  }

  assert {
    condition     = aws_eks_cluster.this.access_config[0].authentication_mode == "API" && !aws_eks_cluster.this.access_config[0].bootstrap_cluster_creator_admin_permissions && aws_eks_cluster.this.vpc_config[0].endpoint_private_access
    error_message = "EKS must use explicit IAM access entries and the private API endpoint."
  }

  assert {
    condition     = data.aws_iam_role.cluster.name == "trippilot-dev-cluster" && data.aws_iam_role.node.name == "trippilot-dev-node" && aws_eks_cluster.this.role_arn == data.aws_iam_role.cluster.arn && aws_eks_cluster.this.compute_config[0].node_role_arn == data.aws_iam_role.node.arn && aws_eks_pod_identity_association.ai.role_arn == data.aws_iam_role.ai_pod.arn && aws_eks_pod_identity_association.ai.service_account == "ai"
    error_message = "EKS must read the separate fixed bootstrap-owned DEV cluster/node roles."
  }

  assert {
    condition     = length(aws_secretsmanager_secret.app) == 4 && aws_db_parameter_group.postgres.parameter == toset([{ name = "rds.force_ssl", value = "1", apply_method = "pending-reboot" }])
    error_message = "Create four secret containers and require PostgreSQL TLS."
  }
}

run "prd_has_high_availability_and_data_protection" {
  command = plan

  override_data {
    target = data.aws_iam_role.cluster
    values = { arn = "arn:aws:iam::123456789012:role/trippilot-prd-cluster" }
  }

  override_data {
    target = data.aws_iam_role.node
    values = { arn = "arn:aws:iam::123456789012:role/trippilot-prd-node" }
  }

  variables {
    environment                = "prd"
    deployment_role_arn        = "arn:aws:iam::123456789012:role/trippilot-github-prd"
    availability_zone_count    = 3
    single_nat_gateway         = false
    vpc_cidr                   = "10.50.0.0/16"
    database_instance_class    = "db.t4g.medium"
    database_allocated_storage = 100
    redis_node_type            = "cache.t4g.small"
  }

  assert {
    condition     = length(aws_subnet.private) == 3 && length(aws_nat_gateway.this) == 3
    error_message = "PRD must keep NAT egress independent across three AZs."
  }

  assert {
    condition     = aws_db_instance.postgres.multi_az && aws_db_instance.postgres.deletion_protection && !aws_db_instance.postgres.skip_final_snapshot && aws_db_instance.postgres.backup_retention_period >= 7
    error_message = "PRD database requires Multi-AZ, deletion protection, final snapshots and retained backups."
  }

  assert {
    condition     = aws_elasticache_replication_group.redis.automatic_failover_enabled && aws_elasticache_replication_group.redis.multi_az_enabled && aws_elasticache_replication_group.redis.num_cache_clusters == 3 && aws_elasticache_replication_group.redis.snapshot_retention_limit >= 7
    error_message = "PRD cache requires three replicas/primary nodes, Multi-AZ failover and backups."
  }

  assert {
    condition     = aws_eks_cluster.this.deletion_protection && aws_cloudwatch_log_group.eks.retention_in_days >= 30
    error_message = "PRD EKS requires deletion protection and retained audit logs."
  }

  assert {
    condition     = aws_eks_cluster.this.name == "trippilot-prd" && alltrue([for repository in aws_ecr_repository.app : startswith(repository.name, "trippilot-prd/")]) && alltrue([for secret in aws_secretsmanager_secret.app : startswith(secret.name, "trippilot/prd/")])
    error_message = "PRD resource and secret names must be isolated from DEV."
  }

  assert {
    condition     = data.aws_iam_role.cluster.name == "trippilot-prd-cluster" && data.aws_iam_role.node.name == "trippilot-prd-node" && aws_eks_cluster.this.role_arn == data.aws_iam_role.cluster.arn && aws_eks_cluster.this.compute_config[0].node_role_arn == data.aws_iam_role.node.arn
    error_message = "PRD must use its own bootstrap-owned cluster/node roles."
  }
}

run "reject_unknown_environment" {
  command = plan

  variables {
    environment = "production"
  }

  expect_failures = [var.environment]
}

run "reject_wrong_account_role" {
  command = plan

  variables {
    environment         = "dev"
    deployment_role_arn = "arn:aws:iam::999999999999:role/other-account"
  }

  expect_failures = [var.deployment_role_arn]
}
