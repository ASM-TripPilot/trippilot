# 리마인드 알림 카피 — 파인튜닝 로컬 LLM 설계 (2026-09-08)

담당 트랙: schedule + US-NOTIF-02 리마인드 카피. **Plan-B 알림·회고 넛지는 별도 트랙 소유 — 이 설계의 범위 밖.**
결정 7건은 2026-09-02~08 사용자 승인으로 확정됨. 백엔드 사실은 origin/develop(worktree wt-verify)과 llm-wiki `MOC - backend notification`(b7334bf 실측) 기준.

## 1. 목적·범위

여행 리마인드 푸시/알림함 문구(TRIP_DAY 당일 아침 · TRIP_PRE D-1)를 하드코딩 상수에서 **일정 내용을 반영한 생성 문구**로 바꾼다. 생성은 **파인튜닝한 로컬 LLM**(자체 서빙)이 맡는다 — 목적은 ① 문구 품질, ② 소마 발표용 "자체 파인튜닝 모델" 실증, ③ 건당 API 비용 0.

- **1단계(이번)**: TRIP_DAY + TRIP_PRE. 발송 시각은 기존 그대로(KST 08:00, O-U6-1 미구현 유지).
- **2단계(후속)**: SLOT_PRE(개별 일정 전) — 백엔드에 예약 생성 자체가 없어(§8) 백엔드 착수 후.
- **비범위**: 회고 넛지·Plan-B 문구, 조용시간/빈도 억제(O-U6-2·4), 사용자별 리마인드 시각(O-U6-1), 푸시 발송 경로 자체.

## 2. 전체 그림

```
[백엔드 notification]                          [AI 서비스]
ItineraryGenerated → 예약 재적재(plan/reload)
   └─ (신규) 백그라운드 문구 채움 잡
        → POST /ai/v1/notification/copies ──→ REMINDER_COPY 워커(로컬 LLM)
        ← copies[{schedule_key,title,body}] ←   게이트 통과분만
        → notification_schedule.title/body 저장
...
@Scheduled 폴링(60s) → 발화: ①토글 판정 → ②알림함 적재 → ③푸시
                              └ title/body 가 채워져 있으면 그걸, 없으면 기존 상수
```

원칙은 백엔드 U6 대원칙(INV-U6-02: 적재는 푸시와 무관)의 연장이다: **예약 적재가 먼저, 문구는 나중에 채우고, 발화 시점에 없으면 상수로 나간다.** AI 가 죽어도 리마인드는 절대 안 죽는다(INV-4).

- 이 경계는 **비동기·느린 경계**다 — 채움 잡은 발화 몇 시간~며칠 전에 돈다. 로컬 LLM 콜드스타트(수십 초)가 무관한 이유.
- 발화 직전 재호출은 하지 않는다. 문구가 낡을 수 있는 창(예약 후 일정 변경)은 **재적재(reload)+재채움**으로 닫는다. 단, 재적재를 깨우는 이벤트가 현재 `ItineraryGenerated`(초기 생성) 하나뿐이고 **Plan-B 재계획의 `recalculation.ItineraryRecalculated` 는 notification 이 구독하지 않는다**(76d7191b 실측 — 재계획 후 옛 예약·옛 문구가 그대로 울리는 기존 갭, INV-U6-08 절반 공백). 이 구독 추가를 §3-3 로 백엔드에 요구한다. 행 단위 편집 이벤트 무효화(null 리셋 → 재채움)는 별도 장치가 필요해지는 2단계 SLOT_PRE 때 함께 판단한다.

## 3. 백엔드 변경 (착수 요청 티켓 TRIP-836 으로 전달 — 이 스펙은 요구 정의까지만)

1. `notification_schedule` 에 **nullable `title`/`body` 컬럼 추가** (Flyway 신규 V — 번호는 백엔드가 채번, V2.31~40 재배정 선례처럼 머리말에 근거 기재).
2. **채움 서비스**: 예약 생성/재적재 후 비동기로 AI `POST /ai/v1/notification/copies` 호출 → 성공분만 저장. 실패·부분 실패는 로그만 남기고 끝(행은 null 유지). 재시도는 다음 재적재 기회에 자연 위임 — 별도 재시도 큐를 만들지 않는다.
3. **재계획 구독 추가**: notification 이 `recalculation.ItineraryRecalculated` 를 구독해 `ItineraryGenerated` 와 동일하게 예약 재적재 → 문구 재채움. 문구 이전에 예약 재적재 자체가 안 도는 기존 갭(INV-U6-08 의 "U4 재계획" 절반 공백)을 같이 메우는 항목이다.
4. **발화 분기**: `NotificationFiringService` 가 행의 title/body 가 있으면 사용, null 이면 기존 `NotificationSchedule.title()/body()` 상수. 분기 한 줄이 폴백의 전부다.
5. **얇은 AI wire**: `ReflectionAgentWire` 선례 그대로 — notification 모듈용 wire 1개 + `CALLED_PATHS` 에 신규 경로 등록 + `AI_SCHEDULE_MODE=fake` 시 결정론 fake.
6. 확인 요청: 알림함 진행 브랜치(`feature/TRIP-576-notification-inbox`)와의 겹침, 소프트 삭제된 여행의 예약 잔존 함정(문구 채움 잡이 삭제된 여행을 되살려 보이게 하면 안 됨 — 채움 전 trip 생존 확인 1회).

## 4. AI 신규 경계 — `POST /ai/v1/notification/copies`

새 `LlmFeature.REMINDER_COPY` (회고 넛지와 **개별** — 파인튜닝 모델 배정을 feature 단위로 가르기 위함).

에이전트 없이 **경계→워커 직행**이다. 설계 근거는 u6-reflect FD §2.1(PR #484): "후보 선택·다단 구성·예산 계단·하드 교체를 하나도 안 쓰는 판단 없는 단발 변환(프롬프트 1회+게이트+정적 폴백)은 경계→워커 직행" — 적용 선례로 이 트랙이 명시돼 있다. 직행 경로의 방어 폴백 이벤트는 `component="api.wiring"`(발행 주체 기준, 넛지와 동일).

**요청** (여행 1건의 예약 여러 행을 배치 1회로):

```json
{
  "trip": {"trip_id": "...", "title": "...", "start_date": "...", "end_date": "..."},
  "items": [
    {"schedule_key": "...", "kind": "TRIP_DAY", "date": "2026-09-10",
     "slots": [{"name": "성산일출봉", "category": "관광지"}, ...]}
  ],
  "request_meta": {"request_id": "...", "requested_at": "...", "deadline_ms": 8000}
}
```

예산·추적 식별자는 **기존 `request_meta` 규약을 그대로 쓴다**(계획 단계 정정 2026-09-12 —
새 `budget_ms`·`trace_id` 필드를 만들지 않는다). `deadline_ms` 미지정 = 시간 제약 없음
(TRIP-473 팀 결정)이고, 그때는 게이트웨이 기본 타임아웃이 안전망으로 남는다.

**응답**: `{"copies": [{"schedule_key", "title", "body"}], "fallback_mode": null|"backend_constant", "degraded": bool}` — 게이트 탈락·LLM 실패 항목은 copies 에서 빠지고, 빠진 게 있으면 `degraded=true`. 백엔드는 받은 것만 저장한다.

- **타임아웃 관통**: 워커 마감은 `request_meta.deadline_ms` 에서 유도(TRIP-522 PlanB 선례). 남은 예산을 남은 항목 수로 나눠 항목마다 배분하고, 최소 호출 시간도 못 주면 부르지 않고 드롭으로 보고한다(확정 타임아웃을 지불하지 않는다). 게이트웨이 기본 2.5s 에 얹혀 가는 실수(넛지 워커 전례) 금지 — 계약 테스트로 고정.
- **게이트(결정론, 항목별)**: 넛지 게이트 상속 — title ≤20자·body ≤60자 1문장, '분/시간/시각/duration' 토큰 포함 시 드롭(INV-3) — **+ 신규: body 가 언급하는 장소명 ⊆ 그날 slots 의 name 집합**(closed-set, INV-1 정신. 부분 문자열 아닌 형태소 수준 포함 판정은 과설계 — 요청 slots name 의 부분열 매칭으로 시작).
- **폴백 라벨**: 이 feature 의 폴백은 AI 안이 아니라 백엔드 상수다. `fallback_modes` 관측(#426)에 `backend_constant` 로 잡혀 소마 신뢰도 지표(생성 문구 적중률)가 된다.
- **4곳 동시 갱신**: `api/routes.py` · `scripts/export_openapi.py` 재생성(`docs/openapi.json` 손편집 금지) · 계약 테스트 전수(정확일치) 목록 · `claude.md`/`claude.ko.md` 경계 목록 + 백엔드 `CALLED_PATHS`.

## 5. 로컬 LLM 라우팅·인프라 (ai-99 합의 규약)

- **어댑터 신규 0**: 로컬 서버는 OpenAI 호환 API. `main.py` 에 두 번째 `OpenAIAdapter`(base_url=`TRIPPILOT_LOCAL_LLM_BASE_URL`, `api=chat`, 더미 키) 생성, `RoutingLlm` 라우트에 `"local"` 접두어 등록.
- 모델 문자열 `local-reminder-qwen3-4b-v1` 을 `TRIPPILOT_LLM_FEATURE_MODELS` 로 `REMINDER_COPY` 에만 배정. **접두어 문자열이 그대로 `model=` 로 서버에 나가므로 vLLM `--served-model-name local-reminder-qwen3-4b-v1` 일치 필수.**
- provider 열거(`openai|anthropic|mixed`)는 **건드리지 않는다**(계획 단계 정정 2026-09-12): local 은 provider 가 아니라 **라우트 한 겹**이다 — 선택된 provider 위에 `RoutingLlm(default=llm, routes={"local": ...})` 를 씌운다. mixed 면 라우터가 중첩되지만 접두어가 겹치지 않아 순서 의존이 없고, 기존 분기 3종을 손대지 않는 가장 작은 변경이다.
- 실스택 스모크는 `scripts/smoke_reminder_copy.py` 신규(수동·cron 전용). `smoke_llm.py` 는 INTENT 전용 하드코딩이라 건드리지 않는다.
- **compose**: 서비스명 `ai-llm`, env 2겹 — `.env` 별칭 `AI_LOCAL_LLM_BASE_URL` → compose `TRIPPILOT_LOCAL_LLM_BASE_URL: ${AI_LOCAL_LLM_BASE_URL:-}` → 앱은 `TRIPPILOT_*` 만. **compose 통로 누락 = 조용한 기본값 사고 — 양쪽 다 정의.** `depends_on` 금지.
- **미설정 2분법**: REMINDER_COPY 를 local 로 배정했는데 base_url 미설정이면 **기동 실패**(설정 버그). 런타임 연결 실패는 **명시 강등**(첫 검출 ERROR + 카운트, 응답은 copies 축소 + degraded).
- **서빙 = Modal 서버리스 GPU, 개인 계정**(Starter 무료 크레딧 $30/월, T4 ≈ 월 50 GPU시간). 콜드스타트는 §2 근거로 무관. 키·엔드포인트는 키·시크릿 세션(볼트) 흐름.
  - 팀 AWS 를 쓰지 않는 이유(2026-09-12 재검토 후 확정): ① EC2 GPU 는 끄는 걸 잊으면 팀 예산이 계속 나간다(서울 리전 24/7 월 40~50만 원대) — 서버리스는 무요청 시 0원이라 그 사고가 구조적으로 없다 ② 신규 계정 GPU 쿼터가 0 이라 증설 신청(수일)이 구현 막바지를 막는다 ③ AI 서비스는 이미 외부 LLM API 를 HTTPS 로 부르므로 같은 클라우드 이점(VPC·IAM 일원화)이 지금은 값을 못 한다.
  - **AWS 이전 트리거**: 실운영 배포 / 팀원이 직접 운영해야 할 때 / 상시 GPU 가 더 싼 호출량. 서빙 주소가 env 하나라 이전 비용은 사실상 0.
- **Mac 개발**: 같은 모델을 로컬 OpenAI 호환 서버(MLX 서버 또는 llama.cpp)로 띄워 같은 env 로 테스트.
- **CI 실호출 0 유지**: ai-ci 에서 local provider 도 fake — 계약·게이트 테스트는 LLM 무관, 스모크는 cron/수동 워크플로에서만.

## 6. 파인튜닝 파이프라인 (리포 `ai/scripts/finetune_reminder/` — CI 밖, 수동 실행)

```
① 재료 생성: 실 DB(collected POIs)에서 여행 시나리오 샘플링 → 프롬프트 조립
② 교사 생성: Qwen3-235B(Apache-2.0, OpenRouter 경유 호출)로 카피 후보 대량 생성
   — temperature 높여 다양성 확보(학생이 배울 분포). Sonnet·GPT 출력물은 절대 미유입(약관).
③ 결정론 필터: §4 게이트와 동일 규칙(길이·시간토큰·장소⊆슬롯)으로 탈락 제거
   — 심판 LLM 을 데이터 선별에 쓰지 않는다(약관 리스크 0 유지).
④ JSONL(chat 형식) → MLX LoRA 학습 (사용자 Mac, 48GB)
⑤ 변환: mlx_lm fuse → HF safetensors → vLLM 서빙 가능 형식. 절차는 스크립트+README 로 고정.
   막히면 같은 JSONL 로 Colab 무료 T4(표준 PEFT 경로) 재학습 — 데이터가 자산, 실행은 소모품.
⑥ 평가(심판 Sonnet, **완성품 평가 전용**): 학생 vs 교사 vs 기존 상수 블라인드 비교 채점
   + 사람 표본 20~30건 병행. 결과는 발표 자료 수치로만 — 학습 루프에 점수 유입 0.
```

약관 근거(원문 확인): Anthropic Usage Policy·OpenAI Services Agreement 모두 출력물의 **모든 모델** 학습 사용을 사전 승인 없이 금지. 교사·학생·심판이 이 제약을 만족하는 조합이 위 3종이다(학생 Qwen3-4B-Instruct-2507 / 교사 Qwen3-235B / 심판 Sonnet-평가만).

## 7. 테스트

- **계약 테스트**: 신규 경계 스키마 정확일치 + 전수 목록 갱신. budget_ms 관통(짧은 예산 → 워커 마감 단축) 검증 1건.
- **게이트 PBT(hypothesis)**: 길이·시간토큰·장소 closed-set 3성질 — 임의 슬롯 조합·임의 LLM 출력 문자열에 대해 게이트 통과분은 규칙 전부 만족.
- **라우팅 테스트**: REMINDER_COPY→local 배정 시 요청이 두 번째 어댑터로 가는지, base_url 미설정 시 기동 실패하는지(`test_wiring_env` 선례).
- 학습 파이프라인 스크립트는 필터 함수만 단위 테스트(게이트와 같은 코드를 import — 규칙 이중 구현 금지).

## 8. 2단계 예고 (이 스펙의 산출물 아님 — 백엔드 티켓에 동봉)

SLOT_PRE: 백엔드 예약 생성(현재 `plan()` 이 TRIP_PRE·TRIP_DAY 만 생성, `slot_key` 항상 null) + BR-U6-05 재료 조립 + **리드타임 제안 채택**(AI 가 `lead_min`+이유 태그 제안 → 백엔드 채택, 사용자 설정은 하한, 결정론 규칙 — 발송 시각은 비표시 값이므로 INV-2 무관) + LATE_GRACE(10분) 재검토. AI 쪽은 §4 요청 items 에 `kind:"SLOT_PRE"`+`slot` 확장만 필요하도록 스키마를 열어 둔다(1단계 스키마에 slot 단위 필드를 미리 넣지는 않는다 — YAGNI).

## 9. 불변식 매핑


|       | 적용                                                       |
| ----- | -------------------------------------------------------- |
| INV-1 | 카피가 언급하는 장소 ⊆ 그날 슬롯(게이트 강제). 새 POI 를 만들어내지 못함            |
| INV-2 | 해당 없음 — 카피는 시각·순서를 주장하지 않음(시간 토큰 자체가 게이트에서 드롭)           |
| INV-3 | '분/시간/시각/duration' 토큰 드롭 게이트 상속                          |
| INV-4 | 폴백 = 백엔드 상수, 발화는 AI 생사와 무관. 강등은 ERROR 로그+카운트로 가시화(침묵 금지) |


