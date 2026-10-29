# 운영 알람 → SNS → Slack (인프라 결정 Q3=A, `shared-infrastructure.md` §12 · U0 OBS-02).
#
# Slack 채널이 정해진 환경에서만 만든다 — 받을 사람이 없는 알람은 요금만 낸다. 로그·파드 지표는
# Container Insights 애드온이 내므로 `container_logs_enabled` 도 켜져 있어야 한다(변수 검증이 강제한다).
#
# 문턱은 출시 직후의 어림값이다. 시끄럽거나 조용하면 여기 숫자만 돌린다.

locals {
  alerts_enabled = var.alerts_slack_channel_id != ""
  alerts_count   = local.alerts_enabled ? 1 : 0
  # 지표 필터가 만드는 지표 — 환경마다 이름공간을 갈라 prd 를 켤 때 섞이지 않게 한다.
  alerts_namespace = "TripPilot/${var.environment}"
  # Container Insights 가 파드 지표에 다는 PodName 은 워크로드 이름이다(해시 없음).
  alerts_restart_watched = local.alerts_enabled ? toset(["backend", "ai", "gateway"]) : toset([])
}

resource "aws_sns_topic" "alerts" {
  count = local.alerts_count

  # 암호화하지 않는다 — AWS 관리형 SNS 키로 잠그면 CloudWatch 알람이 발행하지 못한다(키 정책을 못 고친다).
  # 실리는 것은 알람 이름·지표 값뿐이다.
  name = "${local.name}-alerts"
}

data "aws_iam_role" "chatbot" {
  count = local.alerts_count

  name = "${local.name}-chatbot"
}

# Chatbot API 는 서울에 없고, 이 조직의 SCP 는 그중 일부 리전만 연다(2026-10-14 실측: us-east-2·us-west-2·eu-west-1
# 허용, ap-southeast-1 거부). 채널 설정만 그 리전에 두고 토픽은 서울에 둔다 — 설정은 리전을 가리지 않고 구독한다.
# 리소스 단위 `region`(공급자 6.x) — 별칭 공급자를 따로 두면 알람이 꺼진 환경에서도 그 리전에 STS 를 부른다.
resource "aws_chatbot_slack_channel_configuration" "alerts" {
  count  = local.alerts_count
  region = "us-east-2"

  configuration_name = "${local.name}-alerts"
  iam_role_arn       = data.aws_iam_role.chatbot[0].arn
  slack_team_id      = var.alerts_slack_team_id
  slack_channel_id   = var.alerts_slack_channel_id
  sns_topic_arns     = [aws_sns_topic.alerts[0].arn]
  # 채널이 맡는 역할의 상한. 비우면 Chatbot 은 AdministratorAccess 를 상한으로 둔다 — 역할이 나중에 넓어져도
  # Slack 에서 할 수 있는 것은 CloudWatch 읽기를 넘지 않게 묶는다.
  guardrail_policy_arns = ["arn:aws:iam::aws:policy/CloudWatchReadOnlyAccess"]
}

# ── 로그에서 세는 것 ──────────────────────────────────────────────────────────────

# 게이트웨이 접근 로그는 `$remote_addr $request_method $uri $status $body_bytes_sent $request_time` 다(차트
# gateway-config.yaml). **끝에서 세 번째 칸**이 5xx 인 줄만 센다 — `$uri` 는 디코딩된 경로라 `%20` 이 공백이 되어 앞에서
# 세면 칸이 밀린다(밖에서 `/a%20500%20x` 로 200 을 5xx 로 세게 만들 수 있다). 2026-10-14 test-metric-filter 로 확인:
# 500·502·공백 든 경로의 503 은 잡고, 백엔드 로그의 503 · 경로에 5 가 든 404 · 바이트가 500 인 200 · 위 위장 줄은 안 잡는다.
# NLB 는 L4 라 HTTP 상태 지표가 없어 로그가 유일한 원천이다.
# **운영 네임스페이스만 센다** — 같은 클러스터의 개발 서버(trippilot-dev, 2026-10-15 분리)도 같은 로그 그룹에 쓴다.
# 안 가르면 개발 배포 중 502 나 개발 쪽 토큰 재사용 시험이 운영 Slack 알람으로 울린다(#1159 검수). 재시작 알람은 이미 Namespace 로 가른다.
resource "aws_cloudwatch_log_metric_filter" "gateway_5xx" {
  count = local.alerts_count

  name           = "${local.name}-gateway-5xx"
  log_group_name = aws_cloudwatch_log_group.container_insights["application"].name
  pattern        = "{ ($.kubernetes.namespace_name = \"trippilot\") && ($.kubernetes.container_name = \"gateway\") && ($.log = %\\s5\\d\\d\\s\\d+\\s[0-9.]+$%) }"

  metric_transformation {
    name      = "Gateway5xx"
    namespace = local.alerts_namespace
    value     = "1"
  }
}

# OBS-02 첫 범위(건당) — 소진된 리프레시 토큰의 재제시는 탈취 신호다. 백엔드의 전역 예외 처리기가
# `도메인 예외: REFRESH_REUSE_DETECTED - …` 를 WARN 으로 남긴다(GlobalExceptionHandler). 그 코드만 센다.
resource "aws_cloudwatch_log_metric_filter" "refresh_reuse" {
  count = local.alerts_count

  name           = "${local.name}-refresh-reuse"
  log_group_name = aws_cloudwatch_log_group.container_insights["application"].name
  pattern        = "{ ($.kubernetes.namespace_name = \"trippilot\") && ($.kubernetes.container_name = \"backend\") && ($.log = %REFRESH_REUSE_DETECTED%) }"

  metric_transformation {
    name      = "RefreshReuseDetected"
    namespace = local.alerts_namespace
    value     = "1"
  }
}

# LLM 호출 실패 — "조용한 실패"를 잡는다. LLM 이 죽어도 게이트웨이는 규칙 폴백(INV-4)으로 200 을 주고 파드도 멀쩡해서
# 5xx·재시작 알람이 하나도 안 울린다(2026-10-28 운영: Azure 키 401 로 24h 호출 383건 성공 0, 알람 0). AI 가 호출마다
# 남기는 `llm_cost {"…", "model_id": "…", "success": false, …}` 줄에서 센다.
# **클라우드 모델만 센다(모델명이 c·g 로 시작 = claude·gpt, 괄호·| 는 이 필터가 못 받는다)** — 알림 문구용 자체 모델(local-*)은 Bedrock 콜드스타트로 62% 가 정상적으로 실패한다
# (ModelNotReady·연결 끊김 → 백엔드 고정 문구로 대체). 섞으면 평시에도 울린다. 운영 네임스페이스·ai 컨테이너만.
resource "aws_cloudwatch_log_metric_filter" "llm_call_failed" {
  count = local.alerts_count

  name           = "${local.name}-llm-call-failed"
  log_group_name = aws_cloudwatch_log_group.container_insights["application"].name
  pattern        = "{ ($.kubernetes.namespace_name = \"trippilot\") && ($.kubernetes.container_name = \"ai\") && ($.log = %model_id\\W+[cg]\\S+\\W+success\\W+false%) }"

  metric_transformation {
    name      = "LlmCallFailed"
    namespace = local.alerts_namespace
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "gateway_5xx" {
  count = local.alerts_count

  alarm_name          = "${local.name}-gateway-5xx"
  alarm_description   = "게이트웨이가 5분 동안 5xx 를 10건 이상 냈다. 백엔드·AI 로그부터 본다."
  namespace           = local.alerts_namespace
  metric_name         = aws_cloudwatch_log_metric_filter.gateway_5xx[0].metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "refresh_reuse" {
  count = local.alerts_count

  alarm_name          = "${local.name}-refresh-reuse"
  alarm_description   = "리프레시 토큰 재사용이 감지됐다(OBS-02). 해당 체인은 이미 폐기됐다 — 같은 계정에서 반복되면 탈취를 의심한다."
  namespace           = local.alerts_namespace
  metric_name         = aws_cloudwatch_log_metric_filter.refresh_reuse[0].metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
}

# 문턱 5건/30분. 2026-10-28 장애 24h 로그 실측: 실패한 요청 70건·실패 호출 383건, **요청 1건당 실패 호출은 중앙값 2건**(최대 20).
# 일정 생성은 취향 점수를 청크 병렬로 불러 한 건이 터지면 중앙값 10건이 실패한다 — 5건이면 일정 1건으로 바로 울린다.
# 도우미(분류·SQL·답변)만 죽으면 요청당 2건뿐이라 10건 문턱은 요청 5건쯤 터져야 울려 사용자가 적을 때 놓쳤다(TRIP-1632).
# 평소 실패 기준선(Opus 시한 타임아웃·분류 불가)은 아직 모른다 — 시끄러우면 숫자를 올리거나, 호출 수 지표를 더해 실패 비율(50% 이상 + 최소 N건)로 바꾼다.
resource "aws_cloudwatch_metric_alarm" "llm_call_failed" {
  count = local.alerts_count

  alarm_name          = "${local.name}-llm-call-failed"
  alarm_description   = "LLM(claude·gpt) 호출이 30분 동안 5건 이상 실패했다. 서비스는 규칙 폴백으로 돌지만 AI 품질이 빠진다 — ai 로그의 FallbackEvent reason(401 키·400 파라미터·429 한도·크레딧)부터 본다."
  namespace           = local.alerts_namespace
  metric_name         = aws_cloudwatch_log_metric_filter.llm_call_failed[0].metric_transformation[0].name
  statistic           = "Sum"
  period              = 1800
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 5
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}

# ── 파드·노드 ────────────────────────────────────────────────────────────────────

# 재시작 지표가 파드 수명의 누적인지 구간별 증가분인지 실데이터로 확인하지 못했다(관측 이틀간 0건). 직전 구간과의
# 차이(DIFF)가 양수일 때만 울리면 어느 쪽이든 "늘었을 때"만 잡는다. 배포로 새 파드가 0 부터 시작하는 것은 음수라
# 울리지 않는다. **Sum 을 쓰지 않는다** — 1분 표본을 5분 동안 더하면 표본 수(4~6)가 흔들려 재시작 없이도 DIFF 가 뛴다.
# ponytail: Maximum 이라 같은 워크로드의 다른 파드가 이미 더 많이 재시작했으면 덜 재시작한 파드의 증가를 놓친다 —
# 놓쳐도 그 파드가 계속 죽으면 곧 최댓값을 넘는다. 파드별로 봐야 하면 FullPodName 차원으로 간다(파드마다 이름이 바뀐다).
# DIFF 는 직전 점이 있어야 값이 나온다 — 두 구간을 보고 그중 하나가 넘으면 울린다.
resource "aws_cloudwatch_metric_alarm" "pod_restarts" {
  for_each = local.alerts_restart_watched

  alarm_name          = "${local.name}-${each.key}-restarts"
  alarm_description   = "${each.key} 컨테이너가 다시 시작했다(OOM·기동 실패·liveness 실패). kubectl describe pod 로 사유를 본다."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 2
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]

  metric_query {
    id          = "increase"
    expression  = "DIFF(restarts)"
    return_data = true
  }

  metric_query {
    id = "restarts"
    metric {
      namespace   = "ContainerInsights"
      metric_name = "pod_number_of_container_restarts"
      period      = 300
      stat        = "Maximum"
      dimensions = {
        ClusterName = aws_eks_cluster.this.name
        Namespace   = "trippilot"
        PodName     = each.key
      }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "failed_nodes" {
  count = local.alerts_count

  alarm_name          = "${local.name}-failed-nodes"
  alarm_description   = "NotReady 노드가 10분째 있다. Auto Mode 가 갈아끼우지 못하고 있다."
  namespace           = "ContainerInsights"
  metric_name         = "cluster_failed_node_count"
  dimensions          = { ClusterName = aws_eks_cluster.this.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}

# ── 데이터베이스 ─────────────────────────────────────────────────────────────────

locals {
  # name → (지표, 통계, 비교, 문턱, 평가 구간 수, 설명)
  alerts_database = local.alerts_enabled ? {
    cpu = {
      metric = "CPUUtilization", stat = "Average", op = "GreaterThanThreshold", threshold = 80, periods = 3
      what   = "DB CPU 가 15분째 80% 를 넘는다."
    }
    # 저장공간 자동 확장(max_allocated_storage)은 여유 10% 근처에서 돈다. 그보다 아래로 내려가면 확장이 상한에 닿은 것이다.
    storage = {
      metric = "FreeStorageSpace", stat = "Minimum", op = "LessThanThreshold", threshold = 1073741824, periods = 1
      what   = "DB 여유 저장공간이 1GiB 아래다. 자동 확장 상한(max_allocated_storage)을 본다."
    }
    # db.t4g.small(2GiB)의 기본 max_connections 는 약 190 이다(메모리 기반 공식). 80% 근처에서 알린다.
    connections = {
      metric = "DatabaseConnections", stat = "Maximum", op = "GreaterThanThreshold", threshold = 150, periods = 2
      what   = "DB 연결이 10분째 150 을 넘는다. 연결 풀 누수나 파드 급증을 본다."
    }
  } : {}
}

resource "aws_cloudwatch_metric_alarm" "database" {
  for_each = local.alerts_database

  alarm_name          = "${local.name}-db-${each.key}"
  alarm_description   = each.value.what
  namespace           = "AWS/RDS"
  metric_name         = each.value.metric
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.identifier }
  statistic           = each.value.stat
  period              = 300
  evaluation_periods  = each.value.periods
  comparison_operator = each.value.op
  threshold           = each.value.threshold
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}
