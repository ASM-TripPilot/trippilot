# 리마인드 문구 파인튜닝 런북

**오프라인 파이프라인 — CI 밖에서 수동 실행한다.** 설계 정본:
`ai/docs/superpowers/specs/2026-09-08-reminder-copy-local-llm-design.md`

모델 3종의 역할이 다르다:

| 역할 | 모델 | 용도 |
|---|---|---|
| 교사 | Qwen3-235B (OpenRouter, 오픈 웨이트) | 학습 데이터 생성 |
| 학생 | Qwen3-4B-Instruct-2507 | 우리가 학습·서빙하는 최종 모델 |
| 심판 | Claude Sonnet 5 | 완성품 평가 전용 |

**심판 출력은 학습에 절대 들어가지 않는다.** Anthropic·OpenAI 이용약관은 그 출력물로
**어떤 모델이든** 사전 승인 없이 학습하는 것을 금지한다 — 경쟁 여부와 무관하다. 그래서
심판은 5단계(평가)에서만 등장하고, 1~4단계(데이터 생성·학습·변환·서빙) 어디에도
관여하지 않는다. 이 순서를 바꿔 "심판이 학습 데이터도 걸러주면 편하니까" 식으로
개선하지 말 것 — 그 순간 심판 출력이 학습 파이프라인에 흘러든다.

같은 이유로 교사는 **오픈 웨이트만** 쓴다(Qwen3-235B, Apache-2.0). Sonnet·GPT로 교사
역할을 대체하면 학생 모델 전체가 약관 위반 산출물이 된다.

## 0. 준비물

- **OpenRouter** 계정 + 약 $5 크레딧 — 1단계 직전에 준비. (`OPENROUTER_API_KEY`)
- **Anthropic API 키** — 5단계(평가) 직전에 준비. (`ANTHROPIC_API_KEY`)
- **Mac, 통합메모리 48GB, Apple Silicon** — 2단계(학습) 실행 머신.
- **Modal 계정** — 4단계(서빙) 직전에 준비.
- 이 저장소를 클론한 상태에서 `ai/` 아래 명령을 실행한다. `python` 이 아니라
  **`uv run python`** 이다 — 이 리포에는 맨 `python` 커맨드가 없다.

## 1. 데이터 생성 (교사, OpenRouter ~$5)

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
cd ai
uv run python scripts/finetune_reminder/build_dataset.py \
    --scenarios scenarios.json \
    --out dataset.jsonl \
    --per-scenario 3 \
    --temperature 1.0
```

옵션 (전부 `build_dataset.py --help` 로 확인 가능):

| 플래그 | 필수 | 기본값 | 의미 |
|---|---|---|---|
| `--scenarios` | O | — | 입력 시나리오 JSON 경로 |
| `--out` | O | — | 출력 JSONL 경로 |
| `--per-scenario` | | 3 | 시나리오당 생성 수 |
| `--temperature` | | 1.0 | 다양성 확보용 — 학생이 배울 분포이므로 높게 |

시나리오는 실제 수집 POI에서 뽑는다(`ai/collected_pois.db` — `scripts/collect_pois.py`
계열로 만든 로컬 산출물, 저장소에 커밋되지 않는다). `scenarios.json` 구조:

```json
[
  {
    "schedule_key": "day_1",
    "kind": "TRIP_DAY",
    "date": "1월 1일",
    "trip_title": "제주 여행",
    "slot_names": ["성산일출봉", "우도"],
    "slot_categories": ["관광지", "섬"],
    "other_names": ["한라산"]
  }
]
```

필드:
- `schedule_key`: 예약 ID (출력에는 안 쓰이지만 시나리오 구분용)
- `kind`: `TRIP_DAY`(당일 아침) 또는 `TRIP_PRE`(D-1)
- `date`: 표시용 날짜 문자열 (시각 아님 — INV-3)
- `trip_title`: 여행 제목
- `slot_names`: 그날 방문 장소명, **순서 = 방문 순서**
- `slot_categories`: `slot_names` 와 같은 길이의 카테고리 (선택, 기본값 빈 튜플).
  프롬프트 v0.2.0 은 `[오늘 일정]` 에 "장소 · 카테고리" 형식으로 병기한다
- `other_names`: 같은 여행의 **다른 날** 장소명 — 게이트가 본문에 나오면 드롭한다

동작: 스크립트는 서빙 경로와 **같은 `PromptRegistry` 렌더링**을 거쳐 교사를 호출하고
(프롬프트가 서빙과 어긋나는 채로 학습되는 사고를 막는다), 각 샘플을 **서빙과 동일한
`ReminderCopyGate`** 로 걸러 통과분만 즉시 파일에 이어 쓴다(중간에 죽어도 그때까지
결과는 남는다). 개별 API 호출 실패·JSON 파싱 실패는 그 샘플만 건너뛰고 계속 진행한다.

끝나면 4가지 카운터를 출력한다:

```
시도 450 · 게이트탈락 88 · 중복탈락 12 · 저장 350
```

목표는 **저장 2,500~3,000건**. `저장 / 시도` 비율이 60% 아래면 프롬프트
(`prompts/reminder_copy.yaml`)를 손본다 — 게이트탈락이 크면 규칙 위반(길이·금지
토큰·장소 대조)이 잦다는 뜻이고, 중복탈락이 크면 temperature 를 더 올린다.

### 게이트가 거부하는 것

필터는 이 규칙을 직접 구현하지 않고 `ReminderCopyGate` 를 그대로 import 한다 —
규칙을 두 벌로 구현하면 학습 분포와 서빙 판정이 조용히 어긋난다.

1. 빈 제목 또는 빈 본문
2. 제목 > 20자, 본문 > 60자
3. 금지 토큰 포함: `분`·`시간`·`시각`·`duration` (INV-3, 소요시간·시각 표시 금지)
4. 장소 대조:
   - 선언한(`places`) 장소가 `slot_names`(allowed) 밖에 있음 (INV-1)
   - 선언한 장소가 본문 텍스트에 실제로 없음 (선언 정직성)
   - `other_names`(forbidden, 다른 날 장소)가 본문에 나옴 — 선언 여부 무관

### 테스트

```bash
cd ai
uv run pytest tests/test_finetune_reminder_filter.py -v
```

필터 테스트는 실제 `ReminderCopyGate` 를 import 해서 동일한 규칙으로 검증한다.

## 2. 학습 (Mac, MLX LoRA)

```bash
pip install mlx-lm
mlx_lm.lora --model Qwen/Qwen3-4B-Instruct-2507 --train \
    --data ./data --batch-size 4 --iters 800 --adapter-path ./adapters
```

`mlx-lm` 은 `ai/` 의 uv 프로젝트 의존성이 **아니다** — 학습은 별도 Python 환경(또는
시스템 pip)에서 돈다. `./data` 디렉토리에 1단계 산출물을 `train.jsonl`·`valid.jsonl`
로 9:1 분할해 넣는다(`dataset.jsonl` 을 그대로 쪼개면 된다 — 형식은 이미 MLX 가 먹는
`{"messages": [...]}` 채팅 포맷과 같다).

## 3. 변환 (vLLM 서빙 형식)

```bash
mlx_lm.fuse --model Qwen/Qwen3-4B-Instruct-2507 \
    --adapter-path ./adapters --save-path ./merged
```

MLX LoRA 산출물(어댑터)은 그대로 vLLM 에 안 올라간다 — `fuse` 로 베이스 모델에 합쳐
HF safetensors 형식으로 떨군다. **여기서 막히면** 같은 `dataset.jsonl` 로 Colab
(표준 PEFT + `transformers`)에서 다시 학습한다 — 데이터가 자산이고 학습 실행은
소모품이다. Mac 학습 결과를 버려도 되는 이유는 이것 하나다.

## 4. 서빙 (Modal 서버리스)

**AWS 가 아니라 Modal** — 개인 계정 서버리스로 띄운다. AWS 는 검토 후 기각했다: 새
계정 GPU 쿼터가 0 이라 확보에 며칠이 걸리고, EC2 GPU 인스턴스를 켜 두면 그 자체로
과금되며, AI 서비스는 이미 외부 LLM 을 HTTPS 로 부르고 있어 같은 리전 배치가 오늘
당장 얻는 이득이 없다. 실운영 전환·팀 상시 운영 시점에는 재검토 대상이다(서빙 주소가
env 변수 하나라 전환 비용은 실질적으로 0).

```bash
vllm serve ./merged --served-model-name local-reminder-qwen3-4b-v1
```

**모델명은 반드시 `local-reminder-qwen3-4b-v1`** — 접두어 `local` 로 시작하는 문자열이
아니면 이 앱은 로컬 라우트를 켜지 않고(`ai/main.py` `_local_route`), 접두어가 맞아도
문자열 전체가 요청의 `model=` 필드로 **그대로** 서버에 나가므로 vLLM 의
`--served-model-name` 과 정확히 일치해야 한다. 이름이 다르면 서버가 모델을 못
찾았다며 요청을 거부한다.

배포 후 (docker-compose 로 `ai` 컨테이너를 띄운다면) 저장소 루트 `.env` 에:

```bash
AI_LOCAL_LLM_BASE_URL=https://<modal-앱>.modal.run/v1
AI_LLM_FEATURE_MODELS=REMINDER_COPY=local-reminder-qwen3-4b-v1
```

이 두 `AI_*` 변수는 `docker-compose.yml` 이 각각 `TRIPPILOT_LOCAL_LLM_BASE_URL` ·
`TRIPPILOT_LLM_FEATURE_MODELS` 로 컨테이너에 넘긴다 — 앱 코드 자신은 `AI_*` 를 모르고
`TRIPPILOT_*` 만 읽는다. docker-compose 없이 `ai/` 를 직접 띄운다면 `TRIPPILOT_*` 쪽을
바로 export 한다. **배정은 됐는데 주소가 비어 있으면 기동이 실패한다** — 조용히
Anthropic/OpenAI 기본 벤더로 새는 것을 막으려는 의도된 fail-fast 다
(`main.py::_local_route`).

배포 직후, 프롬프트·게이트까지 실제로 통과하는지 실스택 스모크로 확인한다:

```bash
export TRIPPILOT_LOCAL_LLM_BASE_URL=https://<modal-앱>.modal.run/v1
export TRIPPILOT_LOCAL_LLM_MODEL=local-reminder-qwen3-4b-v1
cd ai
uv run python scripts/smoke_reminder_copy.py
```

`[smoke] PASS title=... body=...` 가 나오면 통과. `TRIPPILOT_LOCAL_LLM_BASE_URL`·
`TRIPPILOT_LOCAL_LLM_MODEL` 중 하나라도 비어 있으면 스크립트가 그 자리에서 실패
메시지를 내고 종료한다(exit 2) — Modal 서버가 살아 있어야 여기서 통과한다.

Mac 에서 개발 중 검증하고 싶으면 같은 모델을 로컬 OpenAI 호환 서버(MLX 서버 또는
llama.cpp)로 띄우고 같은 env 로 `smoke_reminder_copy.py` 를 돌리면 된다 — Modal 이
아직 없어도 이 단계는 검증 가능하다.

콜드스타트(수십 초)는 무관하다 — 문구 채움은 알림 발화 몇 시간~며칠 전에 도는
비동기 작업이라 지연이 사용자에게 보이지 않는다.

## 5. 평가 (심판 Sonnet, 완성품 평가 전용)

`evaluate.py` 는 **학습에 되먹임 없는** 블라인드 비교 채점기다 — 학생·교사·기존
하드코딩 상수 세 후보를 순서를 섞어 심판에게 보여주고 어느 것이 가장 나은지 A/B/C
로만 답하게 한다(이유 없이). 위치를 고정하면 심판이 특정 자리를 편애하는 위치
편향이 실제로 있어서, 시드 있는 RNG 로 매번 섞는다(`--seed` 로 재현 가능).

입력은 세 개의 JSONL — 학생·교사·기존 상수. **같은 홀드아웃 시나리오 집합을, 같은
순서로** 한 줄씩 담아야 한다(줄 번호로 짝지어 비교한다). 한 줄 스키마:

```json
{"body": "성산일출봉에서 하루를 시작해요", "slot_names": ["성산일출봉", "우도"]}
```

`slot_names` 는 결과표에 안 쓰이고 심판 프롬프트에 "일정: 성산일출봉 / 우도" 로만
표시된다 — 없어도 채점은 되지만 사람이 결과를 눈검수할 때 어느 일정인지 알 수 없다.
길이가 안 맞거나(세 파일 줄 수가 다르거나) `body` 필드가 없는 줄이 있으면
`evaluate.py` 가 API 호출 전에 바로 종료한다(exit 2, 메시지에 무엇이 몇 줄인지
나온다).

### 5.1 평가 입력 파일 만들기 (student/teacher/baseline.jsonl)

아래는 전부 `ai/` 안에서 실행한다. 1단계 학습 데이터에 쓰지 않은 홀드아웃
`scenarios_eval.json` 을 하나 골라 둔다(20~30건 — 아래 사람 눈검수 표본과 같은
크기면 된다, 형식은 1단계 `scenarios.json` 과 동일). 세 파일 모두 이 시나리오
순서를 그대로 따른다.

**baseline.jsonl** — 지금 발화 중인 하드코딩 상수를 그대로 채운다(개인화 없음, 그게
비교의 요점이다). 정본:
`backend/modules/notification/src/main/kotlin/com/trippilot/notification/domain/NotificationSchedule.kt`
의 `title()`/`body()`.

```bash
cd ai
uv run python -c '
import json
from pathlib import Path
scenarios = json.loads(Path("scenarios_eval.json").read_text())
BASELINE = {
    "TRIP_DAY": "오늘 어디를 가는지 확인해 보세요.",
    "TRIP_PRE": "출발 전에 일정을 한 번 확인해 보세요.",
}
with open("baseline.jsonl", "w") as out:
    for s in scenarios:
        out.write(json.dumps(
            {"body": BASELINE[s["kind"]], "slot_names": s["slot_names"]}, ensure_ascii=False
        ) + "\n")
'
```

**teacher.jsonl** — `scenarios_eval.json` 을 1단계와 같은 방식으로 `--per-scenario 1`
돌려 얻은 `dataset.jsonl` 은 학습용 채팅 포맷(`{"messages": [...]}`)이라 그대로는 못
쓴다 — 평평한 형식으로 한 번 더 접는다:

```bash
cd ai
uv run python scripts/finetune_reminder/build_dataset.py \
    --scenarios scenarios_eval.json --out teacher_raw.jsonl --per-scenario 1

uv run python -c '
import json
from pathlib import Path
scenarios = json.loads(Path("scenarios_eval.json").read_text())
lines = Path("teacher_raw.jsonl").read_text().splitlines()
assert len(lines) == len(scenarios), (
    f"{len(lines)} != {len(scenarios)} — 시나리오가 하나 이상 게이트탈락/API실패로 "
    "스킵됐다. scenarios_eval.json 에서 그 시나리오를 빼고 baseline·student 쪽도 "
    "같이 맞춰야 순서가 어긋나지 않는다"
)
with open("teacher.jsonl", "w") as out:
    for scenario, line in zip(scenarios, lines):
        rec = json.loads(line)
        body = json.loads(rec["messages"][1]["content"])["body"]
        out.write(json.dumps(
            {"body": body, "slot_names": scenario["slot_names"]}, ensure_ascii=False
        ) + "\n")
'
```

**student.jsonl** — 배포된(또는 로컬 서빙 중인) 학생 모델에 같은 시나리오를 그대로
태운다. `smoke_reminder_copy.py` 와 같은 호출 패턴이라 1회성 스크립트로 붙여 쓴다
(저장할 필요 없음 — `/tmp` 등에 두고 한 번 돌리고 버린다):

```bash
cd ai
export TRIPPILOT_LOCAL_LLM_BASE_URL=https://<modal-앱>.modal.run/v1
export TRIPPILOT_LOCAL_LLM_MODEL=local-reminder-qwen3-4b-v1
cat > /tmp/gen_student.py <<'PY'
import json, os, sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path("src").resolve()))
import openai

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter
from trippilot.llm_gateway.gates.reminder_copy import ReminderCopyContext, ReminderCopyGate
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.reminder_copy import ReminderCopyItem, build_reminder_copy_vars
from trippilot.ports.llm_port import LlmRequest

base_url = os.environ["TRIPPILOT_LOCAL_LLM_BASE_URL"]
model_id = os.environ["TRIPPILOT_LOCAL_LLM_MODEL"]
adapter = OpenAIAdapter(
    openai.OpenAI(api_key="local", base_url=base_url, max_retries=0), api="chat"
)
registry = PromptRegistry(Path("prompts"))
gate = ReminderCopyGate()
scenarios = json.loads(Path(sys.argv[1]).read_text())

with open(sys.argv[2], "w") as out:
    for s in scenarios:
        item = ReminderCopyItem(
            schedule_key=s["schedule_key"], kind=s["kind"], date_label=s["date"],
            slot_names=tuple(s["slot_names"]),
            slot_categories=tuple(s.get("slot_categories", ())),
        )
        prompt, ref = registry.render(
            LlmFeature.REMINDER_COPY, build_reminder_copy_vars(item, s.get("trip_title", ""))
        )
        resp = adapter.invoke(LlmRequest(
            model_id=model_id, prompt=prompt, prompt_ref=ref,
            max_tokens=300, temperature=0.0, timeout_sec=60.0,
        ))
        outcome = gate.apply(
            resp.raw_text,
            ReminderCopyContext(
                allowed=tuple(s["slot_names"]), forbidden=tuple(s.get("other_names", ()))
            ),
            feature=LlmFeature.REMINDER_COPY, trace_id=TraceId("eval-student"),
            now=datetime.now(UTC),
        )
        if outcome.value is None:
            print(f"skip {s['schedule_key']}: {outcome.error}", file=sys.stderr)
            continue
        out.write(json.dumps(
            {"body": outcome.value.body, "slot_names": list(s["slot_names"])}, ensure_ascii=False
        ) + "\n")
PY
uv run python /tmp/gen_student.py scenarios_eval.json student.jsonl
```

이 스크립트도 게이트를 통과 못 하면 그 시나리오를 건너뛴다 — teacher.jsonl 과 마찬가지로
줄 수가 `scenarios_eval.json` 보다 적어지면 세 파일 모두 같은 시나리오 집합으로
다시 맞춘다.

### 5.2 평가 실행

```bash
cd ai
export ANTHROPIC_API_KEY=sk-ant-...
uv run python scripts/finetune_reminder/evaluate.py \
    --student student.jsonl --teacher teacher.jsonl --baseline baseline.jsonl
```

### 결과 읽기

```
표본 25건 · 유효 판정 24건
  student   11건 (45.8%)
  teacher    9건 (37.5%)
  baseline   4건 (16.7%)
```

블라인드 비교 채점에 **사람 표본 20~30건 눈검수를 병행한다** — 심판 한 글자 답변은
이유가 없어 착시(예: 짧은 문장을 무조건 선호)를 못 걸러낸다. 결과 수치는 발표
자료용이며, **학습 데이터 선별에도 재학습 루프에도 되먹이지 않는다.**
