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
resource "aws_chatbot_slack_channel_configuration" "alerts" {
  count    = local.alerts_count
  provider = aws.chatbot

  configuration_name = "${local.name}-alerts"
  iam_role_arn       = data.aws_iam_role.chatbot[0].arn
  slack_team_id      = var.alerts_slack_team_id
  slack_channel_id   = var.alerts_slack_channel_id
  sns_topic_arns     = [aws_sns_topic.alerts[0].arn]
}

# ── 로그에서 세는 것 ──────────────────────────────────────────────────────────────

# 게이트웨이 접근 로그는 `$remote_addr $request_method $uri $status …` 다(차트 gateway-config.yaml). 네 번째 칸이
# 5xx 인 줄만 센다 — 2026-10-14 test-metric-filter 로 확인: 500·502 는 잡고, 백엔드 로그의 503 · 경로에 5 가 든
# 404 · 전송 바이트가 500 인 200 은 안 잡는다. NLB 는 L4 라 HTTP 상태 지표가 없어 로그가 유일한 원천이다.
resource "aws_cloudwatch_log_metric_filter" "gateway_5xx" {
  count = local.alerts_count

  name           = "${local.name}-gateway-5xx"
  log_group_name = aws_cloudwatch_log_group.container_insights["application"].name
  pattern        = "{ ($.kubernetes.container_name = \"gateway\") && ($.log = %^\\S+ \\S+ \\S+ 5\\d\\d %) }"

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
  pattern        = "{ ($.kubernetes.container_name = \"backend\") && ($.log = %REFRESH_REUSE_DETECTED%) }"

  metric_transformation {
    name      = "RefreshReuseDetected"
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

# ── 파드·노드 ────────────────────────────────────────────────────────────────────

# 재시작 지표가 파드 수명의 누적인지 구간별 증가분인지 실데이터로 확인하지 못했다(관측 이틀간 0건). 직전 구간과의
# 차이(DIFF)가 양수일 때만 울리면 어느 쪽이든 "늘었을 때"만 잡는다. 배포로 새 파드가 0 부터 시작해 합이 줄어드는
# 것은 음수라 울리지 않는다.
resource "aws_cloudwatch_metric_alarm" "pod_restarts" {
  for_each = local.alerts_restart_watched

  alarm_name          = "${local.name}-${each.key}-restarts"
  alarm_description   = "${each.key} 컨테이너가 다시 시작했다(OOM·기동 실패·liveness 실패). kubectl describe pod 로 사유를 본다."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
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
      stat        = "Sum"
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
