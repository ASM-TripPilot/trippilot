output "cluster_name" {
  description = "EKS cluster for the manual application deployment workflow."
  value       = aws_eks_cluster.this.name
}

output "aws_region" {
  description = "AWS region selected for the stack."
  value       = var.aws_region
}

output "ecr_repositories" {
  description = "Container registry URLs keyed by backend, ai and embedding."
  value       = { for name, repository in aws_ecr_repository.app : name => repository.repository_url }
}

output "database_host" {
  description = "Private PostgreSQL endpoint without a port."
  value       = aws_db_instance.postgres.address
}

output "database_port" {
  value = aws_db_instance.postgres.port
}

output "database_name" {
  description = "Backend database. The bootstrap Job creates the separate ai_kb database."
  value       = aws_db_instance.postgres.db_name
}

output "database_master_secret_arn" {
  description = "AWS-managed RDS administrator secret ARN, never the password value."
  value       = aws_db_instance.postgres.master_user_secret[0].secret_arn
}

output "redis_host" {
  description = "Private Redis primary endpoint; clients must enable TLS."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_port" {
  value = aws_elasticache_replication_group.redis.port
}

output "app_secret_arns" {
  description = "Secret container ARNs keyed by backend, ai, database and shared."
  value       = { for name, secret in aws_secretsmanager_secret.app : name => secret.arn }
}

output "vpc_id" {
  value = aws_vpc.this.id
}

output "private_subnet_ids" {
  description = "Private compute subnets selected by the EKS Auto Mode default NodeClass."
  value       = aws_subnet.private[*].id
}
