{
  "start": "-P7D",
  "periodOverride": "inherit",
  "widgets": [
    {
      "type": "alarm", "x": 0, "y": 0, "width": 24, "height": 3,
      "properties": {
        "title": "운영 알람 13개 (→ SNS → Slack)",
        "alarms": ${alarm_arns},
        "sortBy": "stateUpdatedTimestamp",
        "states": []
      }
    },
    {
      "type": "log", "x": 0, "y": 3, "width": 12, "height": 6,
      "properties": {
        "title": "API 응답 시간 p50·p95·p99 (gateway request_time, 4xx 제외)",
        "region": "${region}",
        "view": "timeSeries",
        "query": "SOURCE '${app_log_group}' | filter kubernetes.namespace_name=\"trippilot\" and kubernetes.container_name=\"gateway\" and log like / \\/api/ | parse log /^(?<ip>\\S+) (?<method>\\S+) (?<uri>\\S+) (?<status>\\d{3}) (?<bytes>\\d+) (?<rt>[\\d.]+)/ | filter ispresent(rt) and status not like /^4/ | stats pct(rt,50) as p50, pct(rt,95) as p95, pct(rt,99) as p99 by bin(1h)"
      }
    },
    {
      "type": "log", "x": 12, "y": 3, "width": 12, "height": 6,
      "properties": {
        "title": "API 요청 수 (상태 코드 대역별)",
        "region": "${region}",
        "view": "timeSeries",
        "stacked": true,
        "query": "SOURCE '${app_log_group}' | filter kubernetes.namespace_name=\"trippilot\" and kubernetes.container_name=\"gateway\" and log like / \\/api/ | parse log /^(?<ip>\\S+) (?<method>\\S+) (?<uri>\\S+) (?<status>\\d)\\d\\d / | stats count(*) by status, bin(1h)"
      }
    },
    {
      "type": "metric", "x": 0, "y": 9, "width": 12, "height": 6,
      "properties": {
        "title": "장애 신호 (로그 지표, 5분 합계)",
        "region": "${region}",
        "view": "timeSeries",
        "stat": "Sum",
        "period": 300,
        "metrics": [
          ["${alerts_namespace}", "Gateway5xx", {"label": "gateway 5xx"}],
          ["${alerts_namespace}", "LlmCallFailed", {"label": "LLM 호출 실패"}],
          ["${alerts_namespace}", "PushDispatchFailed", {"label": "푸시 발송 실패"}],
          ["${alerts_namespace}", "OutboxAbandon", {"label": "아웃박스 전달 포기"}],
          ["${alerts_namespace}", "RefreshReuseDetected", {"label": "리프레시 토큰 재사용"}]
        ]
      }
    },
    {
      "type": "metric", "x": 12, "y": 9, "width": 12, "height": 6,
      "properties": {
        "title": "파드 재시작 누적 (최대)",
        "region": "${region}",
        "view": "timeSeries",
        "stat": "Maximum",
        "period": 300,
        "metrics": [
          ["ContainerInsights", "pod_number_of_container_restarts", "ClusterName", "${cluster}", "Namespace", "trippilot", "PodName", "backend"],
          ["...", "ai"],
          ["...", "gateway"],
          ["...", "embedding"]
        ]
      }
    },
    {
      "type": "metric", "x": 0, "y": 15, "width": 12, "height": 6,
      "properties": {
        "title": "파드 CPU 사용률 (%)",
        "region": "${region}",
        "view": "timeSeries",
        "stat": "Average",
        "period": 300,
        "metrics": [
          ["ContainerInsights", "pod_cpu_utilization", "ClusterName", "${cluster}", "Namespace", "trippilot", "PodName", "backend"],
          ["...", "ai"],
          ["...", "gateway"],
          ["...", "embedding"]
        ]
      }
    },
    {
      "type": "metric", "x": 12, "y": 15, "width": 12, "height": 6,
      "properties": {
        "title": "파드 메모리 사용률 (%)",
        "region": "${region}",
        "view": "timeSeries",
        "stat": "Average",
        "period": 300,
        "metrics": [
          ["ContainerInsights", "pod_memory_utilization", "ClusterName", "${cluster}", "Namespace", "trippilot", "PodName", "backend"],
          ["...", "ai"],
          ["...", "gateway"],
          ["...", "embedding"]
        ]
      }
    },
    {
      "type": "metric", "x": 0, "y": 21, "width": 8, "height": 6,
      "properties": {
        "title": "DB CPU (%)",
        "region": "${region}",
        "stat": "Average",
        "period": 300,
        "metrics": [["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", "${db}"]]
      }
    },
    {
      "type": "metric", "x": 8, "y": 21, "width": 8, "height": 6,
      "properties": {
        "title": "DB 연결 수",
        "region": "${region}",
        "stat": "Maximum",
        "period": 300,
        "metrics": [["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", "${db}"]]
      }
    },
    {
      "type": "metric", "x": 16, "y": 21, "width": 8, "height": 6,
      "properties": {
        "title": "DB 여유 저장공간 (bytes)",
        "region": "${region}",
        "stat": "Minimum",
        "period": 300,
        "metrics": [["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", "${db}"]]
      }
    },
    {
      "type": "metric", "x": 0, "y": 27, "width": 12, "height": 5,
      "properties": {
        "title": "노드 수 / NotReady 노드",
        "region": "${region}",
        "stat": "Maximum",
        "period": 300,
        "metrics": [
          ["ContainerInsights", "cluster_node_count", "ClusterName", "${cluster}"],
          ["ContainerInsights", "cluster_failed_node_count", "ClusterName", "${cluster}"]
        ]
      }
    }
  ]
}
