resource "aws_security_group" "postgres" {
  name        = "${local.name}-postgres"
  description = "PostgreSQL access only from this environment EKS nodes"
  vpc_id      = aws_vpc.this.id
}

resource "aws_vpc_security_group_ingress_rule" "postgres_from_eks" {
  security_group_id            = aws_security_group.postgres.id
  referenced_security_group_id = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "EKS application and bootstrap PostgreSQL clients"
}

resource "aws_db_subnet_group" "postgres" {
  name       = local.name
  subnet_ids = aws_subnet.data[*].id
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${local.name}-postgres16"
  family = "postgres16"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
}

resource "aws_db_instance" "postgres" {
  identifier                  = local.name
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = var.database_instance_class
  allocated_storage           = var.database_allocated_storage
  max_allocated_storage       = var.database_max_allocated_storage
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "trippilot"
  username                    = "trippilot_admin"
  manage_master_user_password = true
  port                        = 5432
  db_subnet_group_name        = aws_db_subnet_group.postgres.name
  parameter_group_name        = aws_db_parameter_group.postgres.name
  vpc_security_group_ids      = [aws_security_group.postgres.id]
  publicly_accessible         = false
  multi_az                    = local.production
  deletion_protection         = var.data_protection_enabled
  # **삭제 허용 스위치가 증거까지 끄면 안 된다.** `deletion_protection` 을 풀 수 있는 유일한
  # 길이 `data_protection_enabled=false` 인데, 그 한 번의 apply 가 최종 스냅숏까지 껐다면
  # 가장 급한 사람이 가장 급할 때 복구 수단을 0 으로 만든다(destroy 는 워크플로에서 금지돼
  # 사람 노트북에서만 돈다 — `infra/tests/test_workflow_contracts.py`). 그래서 이 둘은
  # **변수와 무관하게 항상** 켜 둔다. 변수는 "지울 수 있는가"만 정한다.
  #
  # `final_snapshot_identifier` 가 고정 이름이라 destroy→재생성→destroy 는 두 번째에
  # `DBSnapshotAlreadyExists` 로 **실패한다.** 그건 조용한 유실보다 낫다 — 사람이 옛 스냅숏을
  # 지우거나 이름을 바꾸고 다시 하면 된다.
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-final"
  # 기본값이 true 다 — 인스턴스를 지우면 PITR 자동 백업이 **함께** 사라진다.
  # 최종 스냅숏은 한 시점뿐이라 자동 백업까지 남겨야 복구 창이 생긴다.
  delete_automated_backups        = false
  backup_retention_period         = var.data_protection_enabled ? 14 : 1
  backup_window                   = "17:00-18:00"
  maintenance_window              = "sun:18:00-sun:19:00"
  copy_tags_to_snapshot           = true
  auto_minor_version_upgrade      = true
  allow_major_version_upgrade     = false
  apply_immediately               = false
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Secrets Manager holds the generated administrator password. The deployment
  # bootstrap Job creates application roles, ai_kb and required extensions.
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "TLS Redis access only from this environment EKS nodes"
  vpc_id      = aws_vpc.this.id
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_eks" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  description                  = "EKS application Redis clients over TLS"
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = local.name
  subnet_ids = aws_subnet.data[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = local.name
  description                = "TripPilot ${var.environment} Redis cache"
  engine                     = "redis"
  engine_version             = "7.1"
  parameter_group_name       = "default.redis7"
  node_type                  = var.redis_node_type
  port                       = 6379
  num_cache_clusters         = local.production ? 3 : 1
  automatic_failover_enabled = local.production
  multi_az_enabled           = local.production
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  snapshot_retention_limit   = local.production ? 7 : 1
  snapshot_window            = "16:00-17:00"
  maintenance_window         = "sun:19:00-sun:20:00"
  auto_minor_version_upgrade = true
  apply_immediately          = false

  # Authentication is network-isolated to this cluster; TLS is mandatory.
  # No Redis password is generated or stored in Terraform state.
}
