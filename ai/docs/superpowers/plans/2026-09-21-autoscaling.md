# 오토스케일링(HPA) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ai`·`gateway` 에 CPU 기준 HorizontalPodAutoscaler 를 붙이고, 임베딩은 replicas 1 로 고정한 근거를 코드에 남긴다.

**Architecture:** Helm 차트에 `templates/hpa.yaml` 을 추가하고 `values.yaml`·`values.schema.json`·`values-dev.yaml`·`values-prd.yaml` 에 `autoscaling` 블록을 둔다. HPA 가 켜진 컴포넌트의 Deployment 는 `replicas` 를 렌더하지 않는다 — 둘 다 쓰면 Helm 업그레이드가 HPA 가 정한 수를 되돌린다. 검증은 `helm template` 렌더 결과를 읽는 기존 차트 테스트로 한다(클러스터 불필요).

**Tech Stack:** Helm 3, `autoscaling/v2`, Python `unittest` + PyYAML (기존 `deploy/eks/chart/tests/test_chart.py` 패턴)

**Spec:** `ai/docs/superpowers/specs/2026-09-21-k8s-serving-autoscaling-cache-design.md`

## Global Constraints

- **임베딩에는 `autoscaling` 키를 두지 않는다.** 프로세스당 4.2 GiB·모델 로드 수십 초 — 근거는 `ai/docs/임베딩-사이징-근거.md`.
- `values.schema.json` 은 `additionalProperties: false` 다. 새 키는 스키마에 먼저 넣지 않으면 렌더가 실패한다.
- prd 는 `backend.replicas=1` 을 거부하는 기존 테스트가 있다. HPA 의 `minReplicas` 도 같은 판정을 따른다.
- `deploy/eks/` 는 백엔드 소유(TRIP-885)다. **PR 까지만** — 머지하지 않는다.
- 이 저장소에 `helm` 이 없다면 먼저 설치해야 테스트가 돈다.

---

### Task 1: EKS 차트에 HPA 추가

**Files:**
- Create: `deploy/eks/chart/templates/hpa.yaml`
- Modify: `deploy/eks/chart/values.yaml`, `values.schema.json`, `values-dev.yaml`, `values-prd.yaml`
- Modify: `deploy/eks/chart/templates/ai.yaml`, `templates/backend.yaml`, `templates/gateway.yaml` (replicas 분기)
- Test: `deploy/eks/chart/tests/test_chart.py`

**Interfaces:**
- Produces: values 키 `ai.autoscaling`·`gateway.autoscaling` = `{enabled: bool, minReplicas: int, maxReplicas: int, targetCPUUtilizationPercentage: int}`
- Consumes: 기존 헬퍼 `trippilot.labels`·`trippilot.selector`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```python
    def test_autoscaling_replaces_static_replicas_and_skips_embedding(self):
        documents = render(embedding=True, overrides=[
            "--set", "ai.autoscaling.enabled=true",
            "--set", "ai.autoscaling.minReplicas=1",
            "--set", "ai.autoscaling.maxReplicas=4",
        ])
        scalers = {item["metadata"]["name"]: item
                   for item in documents if item["kind"] == "HorizontalPodAutoscaler"}
        self.assertEqual(set(scalers), {"ai"})
        target = scalers["ai"]["spec"]["scaleTargetRef"]
        self.assertEqual((target["kind"], target["name"]), ("Deployment", "ai"))
        self.assertEqual(scalers["ai"]["spec"]["maxReplicas"], 4)
        deployments = {item["metadata"]["name"]: item
                       for item in documents if item["kind"] == "Deployment"}
        # HPA 가 소유권을 가지면 Deployment 는 replicas 를 싣지 않는다.
        self.assertNotIn("replicas", deployments["ai"]["spec"])
        self.assertEqual(deployments["embedding"]["spec"]["replicas"], 1)

    def test_autoscaling_is_off_by_default(self):
        documents = render()
        self.assertEqual(
            [item for item in documents if item["kind"] == "HorizontalPodAutoscaler"], [])
        deployments = {item["metadata"]["name"]: item
                       for item in documents if item["kind"] == "Deployment"}
        self.assertEqual(deployments["ai"]["spec"]["replicas"], 1)

    def test_embedding_autoscaling_key_is_rejected(self):
        with self.assertRaises(subprocess.CalledProcessError):
            render(embedding=True, overrides=["--set", "embedding.autoscaling.enabled=true"])
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd deploy/eks/chart && python -m unittest tests.test_chart -v`
Expected: FAIL — HPA 문서가 0건이라 `set(scalers)` 가 빈 집합

- [ ] **Step 3: 최소 구현**

`templates/hpa.yaml`:

```yaml
{{- range list "ai" "gateway" }}
{{- $component := . }}
{{- $config := index $.Values $component "autoscaling" }}
{{- if and $config $config.enabled }}
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ $component }}
  labels:
    {{- include "trippilot.labels" $ | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ $component }}
  minReplicas: {{ $config.minReplicas }}
  maxReplicas: {{ $config.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ $config.targetCPUUtilizationPercentage }}
{{- end }}
{{- end }}
```

`values.yaml` — `ai`·`gateway` 블록에만 추가하고, 임베딩에는 넣지 않는다:

```yaml
ai:
  autoscaling:
    # 임베딩에는 같은 키를 두지 않는다 — 파드가 5 GiB 를 요청하고 모델 로드가
    # 수십 초라(startupProbe 최대 15분) 부하를 보고 늘리면 이미 늦다. 워커를
    # 늘리는 쪽도 막혀 있다(프로세스당 4.2 GiB). 근거: ai/docs/임베딩-사이징-근거.md
    enabled: false
    minReplicas: 1
    maxReplicas: 4
    targetCPUUtilizationPercentage: 70
```

각 Deployment 템플릿의 `replicas` 줄을 분기로 바꾼다:

```yaml
  {{- if not (and .Values.ai.autoscaling .Values.ai.autoscaling.enabled) }}
  replicas: {{ .Values.ai.replicas }}
  {{- end }}
```

`values.schema.json` 의 `ai`·`gateway` `properties` 에 추가:

```json
"autoscaling": {
  "type": "object",
  "additionalProperties": false,
  "required": ["enabled", "minReplicas", "maxReplicas", "targetCPUUtilizationPercentage"],
  "properties": {
    "enabled": {"type": "boolean"},
    "minReplicas": {"type": "integer", "minimum": 1, "maximum": 20},
    "maxReplicas": {"type": "integer", "minimum": 1, "maximum": 20},
    "targetCPUUtilizationPercentage": {"type": "integer", "minimum": 10, "maximum": 100}
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd deploy/eks/chart && python -m unittest tests.test_chart -v`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: 커밋**

```bash
git add deploy/eks/chart
git commit -m "feat(deploy): ai·gateway HPA — 임베딩은 replicas 1 고정"
```

---

### Task 2: 로컬 kind 에 metrics-server 와 HPA

**선행 조건:** `kind` 설치와 클러스터 기동이 필요하다. 도구가 없으면 Task 1 만 하고 여기서 멈춘다 — 매니페스트만 만들고 동작 검증을 건너뛰면 "됐다고 적힌 안 되는 것"이 된다.

**Files:**
- Create: `deploy/k8s/ai/hpa.yaml`
- Modify: `deploy/bin/cluster-up.sh` (metrics-server 설치), `deploy/bin/deploy.sh` (매니페스트 적용 목록)

- [ ] **Step 1: metrics-server 설치를 클러스터 기동에 넣는다**

kind 는 kubelet 인증서가 자기서명이라 `--kubelet-insecure-tls` 가 필요하다.

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl -n kube-system patch deployment metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

- [ ] **Step 2: `deploy/k8s/ai/hpa.yaml` 을 만든다 (Task 1 템플릿과 같은 값)**

- [ ] **Step 3: 부하를 주고 파드 수와 p95 를 잰다**

Run: `kubectl -n trippilot get hpa ai -w`
Expected: 부하 중 `REPLICAS` 가 1 에서 증가, 부하 종료 후 축소

- [ ] **Step 4: 측정값을 스펙 §4 표에 적는다**

- [ ] **Step 5: 커밋**

---

## 이 계획에 없는 것 (별도 계획으로 분리)

| 주제 | 이유 |
|---|---|
| 세만틱 캐시 T1·T2 | AI 코드 변경이라 파일·테스트가 전혀 다르다 |
| Triton 임베딩 A/B | 측정 하네스가 본체라 별도 계획 |
| Triton GPU 매니페스트 | 기준선 부재 — 스펙 §3-2 단서 |
