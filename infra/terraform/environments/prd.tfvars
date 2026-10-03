environment                    = "prd"
cluster_version                = "1.35"
vpc_cidr                       = "10.50.0.0/16"
availability_zone_count        = 3
single_nat_gateway             = false
# dev 와 같은 순서 — bootstrap 선행 뒤에 켠다(dev.tfvars 주석 참조).
container_logs_enabled         = false
container_logs_retention_days  = 30
database_instance_class        = "db.t4g.medium"
database_allocated_storage     = 100
database_max_allocated_storage = 1000
redis_node_type                = "cache.t4g.small"
