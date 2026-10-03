environment                    = "dev"
cluster_version                = "1.35"
vpc_cidr                       = "10.40.0.0/16"
availability_zone_count        = 2
single_nat_gateway             = true
# 켜기 전에 **반드시 bootstrap 을 먼저 돌린다** — stack 이 trippilot-<env>-cloudwatch-pod 역할을
# data 로 읽기만 해서, 역할이 없으면 plan 이 깨진다(2026-10-03 실측: 그 역할은 아직 없다).
# 순서: bootstrap 정책 재등록 → AWS bootstrap 실행 → 여기를 true 로 → deploy.
# false 로 두는 이유는 머지만으로 다음 배포가 깨지지 않게 하기 위해서다.
container_logs_enabled         = false
container_logs_retention_days  = 7
database_instance_class        = "db.t4g.small"
database_allocated_storage     = 20
database_max_allocated_storage = 100
redis_node_type                = "cache.t4g.micro"
