# 리마인드 학생 모델 서빙 원장 (AI-D08)

`scripts/mlops/serving_judge.py` 가 주 1회 채우는 실측 장부다 — 사람이 쓰는 칸은 **게이트 표**뿐이다.
결정의 배경은 `aidlc-docs/inception/design-artifacts/ai-adr.md` AI-D08, 작업 티켓은 TRIP-973.

판정기는 이 파일을 **읽고 쓴다**: 게이트 표에서 조건을 읽고, 주간 기록에 행을 붙인다.
표의 열 이름·순서는 파서가 고정한다 — 바꾸면 판정기가 그 자리에서 실패한다(조용히 오독하지 않는다).

## 게이트 (사람이 채운다)

| 게이트 | 값 | 근거 |
|---|---|---|
| gpu_quota | no | TRIP-961 — GPU NodePool·서비스 쿼터가 오면 yes |
| zero_billing_verified | no | TRIP-968 — EKS GPU 무요청 24h 청구 0 확인 후 yes |
| eks_p95_ms | - | EKS 첫 측정(콜드스타트 포함 p95, `scripts/smoke_reminder_copy.py`) 후 숫자 |
| fill_deadline_ms | 8000 | 백엔드 `ReminderCopyProperties.deadlineMs` 기본값 — 바뀌면 여기도 |

## 규칙 (판정기가 적용한다)

- 게이트 셋 중 하나라도 안 열리면 **HOLD** — 표만 남긴다.
- EKS 권고(`SWITCH_TO_LOCAL`): `EKS $/건 < 0.7 × Bedrock $/건` **그리고** `eks_p95_ms < fill_deadline_ms`.
- Bedrock 복귀(`SWITCH_TO_BEDROCK`): 현재 local 인데 `Bedrock $/건 < 0.7 × EKS $/건`. 0.7 은 히스테리시스 — 왔다갔다 금지.
- 같은 SWITCH 판정이 **2회 연속**이면 `action=open_pr` — `deploy/eks/chart/values.yaml` 의 `reminderLlm.transport` 한 줄 PR(#657 의 스위치). **머지가 승인이다.** 자동 머지는 없다.

## 주간 기록 (판정기가 붙인다)

| 주(끝) | 창(일) | 전송로 | Bedrock 호출/일 | 활성 창/일 | Bedrock p95 ms | Bedrock $/일 | EKS $/일 | Bedrock $/건 | EKS $/건 | 판정 | 조치 | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
