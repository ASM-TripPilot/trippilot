environment             = "dev"
cluster_version         = "1.35"
vpc_cidr                = "10.40.0.0/16"
availability_zone_count = 2
single_nat_gateway      = true
# dev 는 출시를 받은 운영 스택이다 — 파드가 재시작하면 로그가 사라지는 상태로 둘 수 없다(2026-10-13 켬).
# 이 값은 stack 이 trippilot-<env>-cloudwatch-pod 역할을 data 로 **읽기만** 한다는 전제 위에 선다:
# 역할이 없으면 plan 이 깨진다. dev 의 역할은 2026-10-13 bootstrap 으로 만들었다.
# **새 환경에서 켤 때의 순서**: bootstrap 정책 재등록 → AWS bootstrap 실행 → 여기를 true 로 → deploy.
# 보존 90일은 인프라 결정 Q3=A(`shared-infrastructure.md` §12, 2026-10-12)다 — 수집·보관량만큼 과금된다.
container_logs_enabled         = true
container_logs_retention_days  = 90
database_instance_class        = "db.t4g.small"
database_allocated_storage     = 20
database_max_allocated_storage = 100
redis_node_type                = "cache.t4g.micro"
# 운영 알람 → Slack(인프라 결정 Q3=A). 워크스페이스는 2026-10-14 AWS Chatbot 에 연결했다. ID 는 비밀이 아니다.
alerts_slack_team_id    = "T0BG08ENPDW"
alerts_slack_channel_id = "C0C8W4UN7HR"
