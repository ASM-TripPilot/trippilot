# MLOps 서빙·운영 — 비즈니스 로직 모델 (FD)

> **v0.1 초안 (2026-09-26)** · 엔티티는 `domain-entities.md`, 규칙은 `business-rules.md`.
> 설계 축: **"켜는 것이 아니라 증명하는 것이 기본"** — 이 유닛의 신규 경로는 전부 기본
> 꺼짐이고, 켜는 조건이 규칙으로 박혀 있다.

---

## 1. 모듈 배치

```
ai/
  embedding/                      M-1 임베딩 서비스 (단일 파일 서비스, TRIP-517)
    app.py                        /embed 계약 표면 — EMBEDDING_BACKEND 로 내부만 분기
    export_onnx.py                ONNX 내보내기 + 풀링 모드 검사
    model_repo/kure_encoder/      Triton 모델 레포지토리 (config.pbtxt — dynamic batching)
  src/trippilot/
    llm_gateway/adapters/
      caching_embedding.py        텍스트 정확일치 LRU — EmbeddingPort 래퍼
      http_embedding.py           /embed 호출 + 모델·차원 대조 거부 (기존)
      bedrock_adapter.py          M-2 Bedrock CMI (기존 · PR #696)
      openai_adapter.py           M-2 vLLM·MLX 공용 (기존 · base_url 만 교체)
    agents/planb/
      directive_feedback.py       지시 번역 되먹임 — KB-4 별칭 적재 (미배선)
  scripts/
    measure_triton_embedding.py   M-1 A/B 하네스 (동등성 + 지연)
    measure_embedding_precision.py  측정 규약의 정본 (TRIP-518)
    smoke_reminder_copy.py        M-2 실호출 스모크 + assert_served_model
  main.py::_local_route           M-2 전송로 선택 (TRIPPILOT_REMINDER_TRANSPORT > ARN)
deploy/eks/chart/templates/
  hpa.yaml                        ai·gateway HPA (기본 꺼짐)
  reminder-llm.yaml               M-2 인클러스터 Triton + KEDA 0↔1 (기본 꺼짐)
  embedding.yaml                  M-1 파드 (기존 · replicas 1 고정)
.github/workflows/
  ai-embedding-backend-bench.yml  amd64 A/B — 라벨 또는 수동 실행
```

의존 방향은 기존 그대로다. 임베딩 서비스는 `ai/` 패키지를 import 하지 않는 **독립 프로세스**
이고, 앱은 HTTP 로만 닿는다 — 그래서 엔진을 바꿔도 앱 코드가 안 바뀐다.

---

## 2. 흐름 1 — 요청 경로의 임베딩 (M-1)

```
워커/RAG
  └ EmbeddingPort.embed(text)
      └ CachingEmbedding            ① 텍스트 정확일치 LRU(2048) — 히트면 여기서 끝
          └ HttpEmbeddingAdapter    ② POST /embed  (응답의 model·dim 대조, 다르면 거부)
              └ embedding 서비스    ③ EMBEDDING_BACKEND 분기
                   ├ sentence-transformers (기본, 프로세스 안)
                   ├ onnx   → ONNX Runtime, **프로세스 안** (TRIP-965, 꺼짐)
                   └ triton → ONNX Runtime, 별도 컨테이너 (측정용, 꺼짐)
```

**①이 있는 이유**: 요청 1건이 임베딩을 **직렬 3회** 부르는데(SCHEDULE·SITUATION·PERSONA)
상황 KB·페르소나 KB 질의는 `TriggerKind` 4 × `_REASON_KO` 7 = **28가지 닫힌 집합**이다.
같은 문자열이 프로세스 수명 내내 반복된다. 열린 질의는 자유 입력과 일정 KB 뿐이다.

**②가 있는 이유**: 서비스가 분리돼 있어 호출측이 "적재와 같은 모델인가"를 알 방법이 응답의
`model` 필드뿐이다. 싣기만 하면 무용이고 **읽고 거부해야** 규칙이 강제된다.

**③이 분기인 이유**: 엔진을 바꾸는 실험을 계약 밖에서 한다. 표면(`/embed`·`model`·`dim`)이
고정이라 앱은 어느 쪽인지 모른다.

---

## 3. 흐름 2 — 리마인드 문구 채움 (M-2)

```
백엔드 (예약 적재 후 비동기)
  └ POST /ai/v1/notification/copies
      └ REMINDER_COPY 워커 ─ GatewayFacade.call
          └ RoutingLlm  "local*" 접두어 → 로컬 라우트
              ├ BedrockAdapter        ARN 있으면 ← **지금 실서비스**
              └ OpenAIAdapter         base_url (vLLM·MLX·인클러스터 Triton)
          └ ReminderCopyGate          그날 슬롯 이름 교차 · 시간 토큰 드롭
      ← copies[] (게이트 통과분만)
백엔드: 행에 저장 → 발화 시 title/body 있으면 사용, 없으면 상수
```

이 경계는 **비동기·느린 경계**다. 콜드스타트 수 분이 허용되는 근거가 여기 있고, 동시에
**전량 실패해도 리마인드는 안 죽는다**(백엔드 상수 폴백, INV-4).

---

## 4. 전환 절차 — Bedrock(다리) → EKS GPU(목표)

사용자 결정(2026-09-26, 이 세션): **EKS GPU 가 목표, Bedrock 은 쿼터가 올 때까지의 다리.**

> ⚠️ **같은 날 반대 방향의 기록이 하나 더 있다 — 확인 전까지 이 절을 근거로 삼지 마라.**
> 서빙 트랙 세션이 PR [#750](https://github.com/ASM-TripPilot/trippilot/pull/750)(ADR AI-D08,
> 열림)에 **"실서비스 = Bedrock, EKS GPU 는 측정 실험이고 더 싸면 전환"** 으로 적었다.
> 두 기록은 **목표와 실험의 이름표가 반대**다. 사용자 확인을 요청해 둔 상태이고, 그 답에
> 따라 이 절의 한 줄만 바뀐다.
>
> **아래 절차와 코드는 어느 쪽이든 그대로다** — 전송로를 값으로 고르는 구조라, 어느 쪽을
> "목표"로 부르든 조작은 같고 되돌리기도 같다. 이름표가 정해지기 전에도 실험은 돌릴 수 있다.

전환은 파드를 띄우는 일이 아니다. **전송로를 고르는 일**이다 — 우선순위 규칙상 ARN 이 살아
있으면 파드를 켜도 트래픽이 안 간다. `reminderLlm.transport`(→ `TRIPPILOT_REMINDER_TRANSPORT`)
가 그 선택이고, **ARN 을 지우지 않는다** — 되돌리기가 값 하나여야 실험이 성립한다.

```
① GPU 서비스 쿼터 신청            ← 리드타임 수일, 가장 먼저 (TRIP-961)
② GPU NodePool · device plugin · KEDA 설치   ← 백엔드 (infra/terraform)
③ 모델 가중치 PVC 적재
④ reminderLlm.enabled=true · transport=bedrock  ← 파드는 뜨고 트래픽은 그대로(섀도)
⑤ smoke_reminder_copy.py 로 인클러스터 경로 단독 검증 (base_url 직접 지정)
⑥ transport=local  ← 트래픽 이동. **ARN 은 그대로 둔다**
⑦ 비용 비교 — EKS 가 "1건 1.4초 · CMU 1 · 5분 창 과금"보다 싼지
⑧ 싸면 유지. 아니면 transport=bedrock 으로 **값 하나** 되돌림
```

**되돌리기는 값 하나다.** 그래서 ⑥을 되돌릴 수 없는 결정으로
다루지 않는다.

---

## 5. 흐름 3 — 오토스케일링

| 대상 | 정책 | 근거 |
|---|---|---|
| `ai`·`gateway` | HPA, CPU 기준 · 기본 꺼짐 | 상태 없는 CPU 바운드, 기동 빠름 |
| `embedding` | **HPA 를 두지 않는다** | 파드 5Gi · 모델 로드 수십 초 · 프로세스당 4.2 GiB |
| `reminder-llm` | KEDA 0↔1 | 비동기 배치라 0 으로 내려가도 됨 |

**HPA 가 기본 꺼짐인 것은 보수가 아니라 선행 조건 부재다.** `metrics-server` 가 클러스터에
없어서, 켜면 목표치가 `<unknown>` 인 채 **replica 소유권만 가져간다**(Deployment 가
`replicas` 를 렌더하지 않으므로 아무도 수를 정하지 않는 상태가 된다).

---

## 6. 측정 하네스 배치

| 하네스 | 무엇을 가르나 | 어디서 도나 |
|---|---|---|
| `measure_embedding_precision.py` | 측정 규약의 정본(4스레드·워밍업 2회·중앙값 3회) | 수동 |
| `measure_triton_embedding.py` | M-1 엔진 A/B — 동등성 먼저, 지연 나중 | 수동 / CI 워크플로 |
| `ai-embedding-backend-bench.yml` | 위를 **amd64** 에서 | PR 라벨 `bench-embedding` |
| `smoke_reminder_copy.py` | M-2 실호출 + **누가 답했는지 단언** | 수동 |

`ORT_DIRECT=1` 은 Triton 서버 없이 ONNX Runtime 을 직접 부른다. 러너 디스크에 20.7GB
이미지가 안 들어가서인데, 서버 오버헤드가 queue 1.8ms 수준이라 판정은 같다. **토크나이즈·
풀링·정규화는 서빙 코드(`_embed_triton`)를 그대로 탄다** — 두 벌로 구현하면 조용히 갈라지고
차원이 1024 그대로라 아무 검사도 못 잡는다.

---

## 7. 이 유닛이 하지 않는 것

- 외부 LLM(Anthropic·OpenAI) 호출 경로 — LLMOps 정본 소관, 변경 없음
- 프롬프트 레지스트리·평가셋·비용 집계 — 상위 정본 §1 그대로
- 학습 파이프라인 자체 — `scripts/finetune_reminder/` 와 런북이 정본, 이 유닛은 **서빙
  이후**만 다룬다
- 벡터 DB 인덱스 — 1MB 미만이라 정확검색이 더 빠르다
- 생성 문구의 세만틱 캐시 — 게이트가 요청별 장소 집합으로 막아 절감이 아니라 드롭이 된다
