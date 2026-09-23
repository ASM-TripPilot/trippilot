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
- 아래 명령들이 만드는 `scenarios*.json`·`dataset.jsonl`·`ft_data/`·`adapters/`·
  `merged/`·`*.jsonl` 은 전부 이 파이프라인의 스크래치 산출물이다. `.gitignore` 에
  없으니 커밋하지 않도록 직접 챙긴다(`git status` 로 확인).

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
    "date": "2026-09-13",
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
- `date`: 표시용 날짜 문자열 (시각 아님 — INV-3). 서빙은 `item.date.isoformat()`
  (예 `"2026-09-13"`)을 그대로 채운다 — 시나리오도 이 ISO 형식으로 써야 학생이
  실제로 받을 입력 분포를 배운다("1월 1일" 같은 한글 표기는 서빙이 절대 보내지 않는다)
- `trip_title`: 여행 제목
- `slot_names`: 그날 방문 장소명, **순서 = 방문 순서**
- `slot_categories`: `slot_names` 와 같은 길이의 카테고리 (선택, 기본값 빈 튜플).
  프롬프트 v0.2.0 은 `[오늘 일정]` 에 "장소 · 카테고리" 형식으로 병기한다
- `other_names`: 같은 여행의 **다른 날** 장소명 — 게이트가 본문에 나오면 드롭한다

동작: 스크립트는 서빙 경로와 **같은 `PromptRegistry` 렌더링**을 거쳐 교사를 호출하고
(프롬프트가 서빙과 어긋나는 채로 학습되는 사고를 막는다), 각 샘플을 **서빙과 동일한
`ReminderCopyGate`** 로 걸러 통과분만 즉시 파일에 이어 쓴다(중간에 죽어도 그때까지
결과는 남는다). 개별 API 호출 실패·JSON 파싱 실패는 그 샘플만 건너뛰고 계속 진행한다.

끝나면 5가지 카운터를 출력한다 — `시도` 는 총 시도 횟수, 나머지 네 버킷(호출실패·
게이트탈락·중복탈락·저장)의 합이 항상 `시도` 와 같다:

```
시도 450 · 호출실패 20 · 게이트탈락 88 · 중복탈락 12 · 저장 330
```

목표는 **저장 2,500~3,000건**. 비율을 볼 때는 **호출실패를 분모에서 뺀다** —
`저장 / (시도 − 호출실패)` 가 60% 아래면 프롬프트(`prompts/reminder_copy.yaml`)를
손본다: 게이트탈락이 크면 규칙 위반(길이·금지 토큰·장소 대조)이 잦다는 뜻이고,
중복탈락이 크면 temperature 를 더 올린다. 호출실패(네트워크 오류·응답 JSON 파싱
실패)는 프롬프트 품질과 무관하다 — 분모에 그대로 두면 API 플레이키니스를 프롬프트
탓으로 오판하게 된다.

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

`mlx-lm` 은 `ai/` 의 uv 프로젝트 의존성이 **아니다** — 학습은 별도 Python 환경(또는
시스템 pip)에서 돈다. 먼저 1단계 산출물(`dataset.jsonl`)을 `train.jsonl`·
`valid.jsonl` 로 9:1 분할한다 — 형식은 이미 MLX 가 먹는 `{"messages": [...]}` 채팅
포맷과 같아서 줄만 쪼개면 된다. **`ai/ft_data/` 를 쓴다 — `ai/data/` 가 아니다**:
그 이름은 이미 의도매칭 질문뱅크용으로 쓰이는 트래킹된 디렉토리라(`ai/data/README.md`),
여기 학습 스크래치를 섞으면 안 된다.

```bash
cd ai
uv run python -c '
import random
from pathlib import Path
lines = Path("dataset.jsonl").read_text().splitlines()
random.Random(42).shuffle(lines)
cut = int(len(lines) * 0.9)
Path("ft_data").mkdir(exist_ok=True)
Path("ft_data/train.jsonl").write_text("\n".join(lines[:cut]) + "\n")
Path("ft_data/valid.jsonl").write_text("\n".join(lines[cut:]) + "\n")
'
```

```bash
pip install mlx-lm
mlx_lm.lora --model Qwen/Qwen3-4B-Instruct-2507 --train \
    --data ./ft_data --batch-size 4 --iters 800 --adapter-path ./adapters
```

**확인**: `./adapters/` 에 `adapter_config.json` 과 `.safetensors` 어댑터 파일이
생겼는지 본다(`ls ./adapters`). 둘 다 없으면 학습이 끝까지 못 간 것이다 — iters 를
줄여 짧게 재시도하거나 로그를 본다. (이 명령 자체는 Apple Silicon Mac 이 있어야
돌아간다 — 이 런북 작성 시점에 실행 검증하지 못했다.)

## 3. 변환 (vLLM 서빙 형식)

```bash
mlx_lm.fuse --model Qwen/Qwen3-4B-Instruct-2507 \
    --adapter-path ./adapters --save-path ./merged
```

**확인**: `./merged/` 에 가중치(`*.safetensors`) 와 토크나이저·설정 파일
(`config.json`·`tokenizer.json`·`tokenizer_config.json` 등)이 **함께** 있어야
vLLM 이 로드할 수 있다(`ls ./merged`). 가중치만 있고 설정 파일이 없거나 그
반대면 `fuse` 가 중간에 실패한 것이다 — 다음 절로 넘어가지 말 것.

MLX LoRA 산출물(어댑터)은 그대로 vLLM 에 안 올라간다 — `fuse` 로 베이스 모델에 합쳐
위 형식으로 떨군다. **여기서 막히면** 같은 `dataset.jsonl` 로 Colab
(표준 PEFT + `transformers`)에서 다시 학습한다 — 데이터가 자산이고 학습 실행은
소모품이다. Mac 학습 결과를 버려도 되는 이유는 이것 하나다. (이 명령도 §2 와 같은
이유로 이 런북 작성 시점에 실행 검증하지 못했다.)

## 4. 서빙 (AWS Bedrock Custom Model Import)

**팀 결정 2026-09-24: AWS 로 간다.** 앞서 AWS 를 기각했던 근거 두 개(신규 계정 GPU
쿼터 0 · EC2 GPU 상시 과금)는 **Bedrock Custom Model Import 에는 해당하지 않는다** —
서버리스라 GPU 를 우리가 안 잡고 무요청 시 0원이다.

현 EKS 클러스터로는 **못 올린다**(확인 2026-09-24): 차트 전체에 GPU 노드가 없고
(`nvidia`/`gpu` 언급 0건), 임베딩은 CPU 서비스다. 4B 모델을 2 vCPU 로 돌리면 문구
1건에 30초 이상 걸려 **항목당 상한 ~10초**(`C1Config.timeout_sec`, env 로 못 바꿈)를
매번 넘긴다.

**리전 제약**: Custom Model Import 는 `us-east-1`·`us-east-2`·`us-west-2`·`eu-central-1`
에만 있다. **서울(ap-northeast-2)에 없다.** 이 경계는 발송 몇 시간~며칠 전에 도는
배치라(§2) 교차 리전 지연은 무관하다.

`merged/`(§3 산출물)가 이미 Bedrock 이 요구하는 형식이다 — safetensors + `config.json`
+ `tokenizer.json` + `tokenizer_config.json`. LoRA 어댑터는 **병합된 상태여야** 하는데
§3 의 `fuse` 가 그 일을 한다.

> Modal 경로(`scripts/finetune_reminder/modal_app.py`)는 지우지 않고 남겨 둔다 —
> GPU 호스트에 직접 띄울 때와, Bedrock 리전을 못 쓰는 상황의 대안이다.

```bash
# 1) 모델을 S3 로 (Bedrock 이 지원하는 리전의 버킷이어야 한다)
aws s3 sync ./merged s3://<버킷>/reminder-copy-v1/ --region us-east-1

# 2) 임포트 작업 — 10~30분 걸린다
aws bedrock create-model-import-job \
  --job-name reminder-copy-v1 \
  --imported-model-name reminder-copy-qwen3-4b-v1 \
  --role-arn arn:aws:iam::<계정>:role/<BedrockImportRole> \
  --model-data-source s3DataSource={s3Uri=s3://<버킷>/reminder-copy-v1/} \
  --region us-east-1

# 3) 끝났는지 확인 → 나온 ARN 이 다음 절의 값이다
aws bedrock list-imported-models --region us-east-1
```

IAM 역할은 그 S3 경로 읽기 권한 + Bedrock 신뢰관계가 필요하다(AWS 문서의
`custom-model-import-code-samples` 참고). 호출 측 자격에는 `bedrock:InvokeModel` 이
그 모델 ARN 범위로 있어야 한다.

임포트가 끝나면 `arn:aws:bedrock:us-east-1:<계정>:imported-model/<id>` 형태의 ARN 이
나온다 — 이것이 `AI_BEDROCK_MODEL_ARN` 값이다.

**GPU 가 있는 호스트에서 직접 띄우려면** 같은 모델을 vLLM 으로 그대로 올리면 된다
(Modal 앱이 컨테이너 안에서 실행하는 것과 같은 명령이다):

```bash
vllm serve ./merged --served-model-name local-reminder-qwen3-4b-v1
```

**모델명은 반드시 `local-reminder-qwen3-4b-v1`** — 접두어 `local` 로 시작하는 문자열이
아니면 이 앱은 로컬 라우트를 켜지 않고(`ai/main.py` `_local_route`), 접두어가 맞아도
문자열 전체가 요청의 `model=` 필드로 **그대로** 서버에 나가므로 vLLM 의
`--served-model-name` 과 정확히 일치해야 한다. 이름이 다르면 서버가 모델을 못
찾았다며 요청을 거부한다.

임포트 후 (docker-compose 로 `ai` 컨테이너를 띄운다면) 저장소 루트 `.env` 에서
`AI_BEDROCK_MODEL_ARN` 을 채우고, **`AI_LLM_FEATURE_MODELS` 는 새 줄로 추가하지
말고 기존 값 끝에 콤마로 이어 붙인다.** 그 키는 이미 PARAPHRASE·EXPLANATION·
REFLECTION_TEMPLATE 등 살아 있는 배정을 한 줄에 콤마로 이어 붙인 **단일 값**이고
(`.env.example` 참고, `ai-llm-smoke` 워크플로가 이 줄을 그대로 읽는 정본이다) —
`.env`/compose 파싱은 같은 키가 두 줄이면 **마지막 줄이 이긴다.** 둘째
`AI_LLM_FEATURE_MODELS=` 줄을 추가하면 첫 줄의 배정 전부가 조용히 사라지고
PARAPHRASE·EXPLANATION 등 이미 돌던 기능이 전부 기본 모델로 폴백한다 — 리마인드
문구 하나 붙이려다 다른 기능들을 깨는 사고다.

```
# 변경 전 (실제 .env 에 이미 배정이 있는 경우의 예)
AI_BEDROCK_MODEL_ARN=
AI_LLM_FEATURE_MODELS=PARAPHRASE=claude-haiku-4-5,ALTERNATIVE_SELECTION=gpt-5.6-sol,EXPLANATION=claude-sonnet-5

# 변경 후 — 같은 줄 끝에 이어 붙인다
AI_BEDROCK_MODEL_ARN=arn:aws:bedrock:us-east-1:<계정>:imported-model/<id>
AI_BEDROCK_REGION=us-east-1
AI_LLM_FEATURE_MODELS=PARAPHRASE=claude-haiku-4-5,ALTERNATIVE_SELECTION=gpt-5.6-sol,EXPLANATION=claude-sonnet-5,REMINDER_COPY=local-reminder-qwen3-4b-v1
```

`AI_LLM_FEATURE_MODELS` 자체가 아직 없는 빈 개발 `.env` 라면(다른 기능 배정이
하나도 없는 경우만) 새로 한 줄 추가해도 된다:
`AI_LLM_FEATURE_MODELS=REMINDER_COPY=local-reminder-qwen3-4b-v1`.

이 `AI_*` 변수들은 `docker-compose.yml` 이 `TRIPPILOT_*` 로 컨테이너에 넘긴다
(`AI_BEDROCK_MODEL_ARN` → `TRIPPILOT_BEDROCK_MODEL_ARN`,
`AI_LLM_FEATURE_MODELS` → `TRIPPILOT_LLM_FEATURE_MODELS`) — 앱 코드 자신은 `AI_*` 를 모르고
`TRIPPILOT_*` 만 읽는다. docker-compose 없이 `ai/` 를 직접 띄운다면 `TRIPPILOT_*` 쪽을
바로 export 한다(이때도 같은 규칙 — 기존 `TRIPPILOT_LLM_FEATURE_MODELS` 값이 있으면
새 값을 이어 붙인다). **배정은 됐는데 ARN·주소가 둘 다 비어 있으면 기동이 실패한다** — 조용히
Anthropic/OpenAI 기본 벤더로 새는 것을 막으려는 의도된 fail-fast 다
(`main.py::_local_route`).

**`AI_LLM_PROVIDER` 도 반드시 설정한다** — 위 두 변수만 채우고 이 값을
비워 두면 `main.py::build_app_from_env` 가 `_feature_models_from_env()`/
`_local_route()` 를 부르기 **전에** 기존 fake 조립을 그대로 반환한다. 즉 방금 설명한
fail-fast 자체가 발동하지 않고, 로컬 라우트가 붙었는지 아닌지 아무 신호도 없이
조용히 안 붙는다. `AI_LLM_PROVIDER` 를 `openai`·`anthropic`·`mixed` 중 하나로 채워야
이 절의 나머지가 의미를 가진다.

### ⚠️ 배포 직후 제일 먼저 — 파인튜닝이 실제로 붙었는지 대조한다

**베이스 모델이 서빙돼도 그럴듯한 답이 나와서 겉으로는 정상으로 보인다.** 실제로
로컬 검증 때 mlx 서버가 어댑터를 조용히 무시해 **하루치 측정이 통째로 무효**가 됐다
(2026-09-19, `docs/conventions/anti-patterns.md` 등록). 스모크는 이걸 못 잡는다 —
문구가 나오기만 하면 통과하기 때문이다.

판정은 문체로 한다. 학습된 모델은 **한 문장**으로 짧게 쓰고 `places` 에 슬롯명을
**괄호까지 그대로** 싣는다. 베이스는 두 문장으로 장황하고 괄호를 뗀다:

| | 예시 |
|---|---|
| 학습됨 | `"원통사에서 시작해 도봉산양고기와 원당샘공원을 둘러보세요."` · `places: ["원통사(서울)", ...]` |
| 베이스 ⚠ | `"원통사에서 명소를 즐기고, 도봉산양고기 맛집에서 특별한 음식을 먹어보세요. 원당샘공원에서 자연을 감상해보세요."` · `places: ["원통사", ...]` |

오른쪽이 나오면 **배포를 되돌리고 볼륨의 모델부터 다시 본다** — `merged/` 가 아니라
베이스가 올라갔거나, `MODEL_DIR` 이 빈 디렉토리를 가리킨 것이다.

배포 직후, 프롬프트·게이트까지 실제로 통과하는지 실스택 스모크로 확인한다.
**단, 아래 스모크가 통과해도 배포된 앱 자체가 로컬 라우트로 붙었다는 증명은
아니다** — `smoke_reminder_copy.py` 는 앱을 거치지 않고 자체 `OpenAIAdapter` 를
직접 만들어 호출한다(위 `AI_LLM_PROVIDER` 미설정 실수를 이 스모크는 잡아내지
못한다). 앱 자체의 라우팅은 `AI_LLM_PROVIDER` 설정을 직접 확인하거나 실제 앱
경로(`/ai/v1/notification/copies`)로 별도 확인한다.

```bash
# 스모크는 OpenAI 호환 경로 전용이다 — Bedrock 은 앱 경계로 확인한다(아래).
export TRIPPILOT_LOCAL_LLM_BASE_URL=<OpenAI 호환 서버 주소>/v1
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

```bash
cd ai
export OPENROUTER_API_KEY=sk-or-v1-...            # 교사
export TRIPPILOT_LOCAL_LLM_BASE_URL=<서빙 주소>    # 학생 (§4 에서 띄운 것)
export TRIPPILOT_LOCAL_LLM_MODEL=local-reminder-qwen3-4b-v1

uv run python scripts/finetune_reminder/make_scenarios.py \
    --out scenarios_eval.json --trips 40 --seed 7        # 학습과 다른 시드로
uv run python scripts/finetune_reminder/make_eval_inputs.py \
    --scenarios scenarios_eval.json --out-dir eval/
```

세 파일이 **행 단위로 정렬돼서** 나온다 — `evaluate.py` 는 n번째 줄을 같은
시나리오의 세 후보로 보고 채점하므로, 한 줄이라도 어긋나면 심판이 엉뚱한 짝을
비교하고 **그 결과는 틀렸다는 티도 안 난다**(숫자는 나오는데 의미가 없다).
스크립트는 교사·학생이 **둘 다 성공하고 둘 다 게이트를 통과한** 시나리오만
내보내 그 정렬을 코드로 보장한다. 스킵 건수는 실행 끝에 찍힌다.

`baseline` 은 지금 발화 중인 하드코딩 상수다(개인화 없음 — 그게 비교의 요점이다).
학생 출력은 서빙과 같은 게이트를 통과한 것만 올라간다. 즉 **사용자가 실제로 받을
문구끼리** 비교한다.

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

---

## 언제 데이터를 다시 뽑아야 하나

학생 모델은 **프롬프트 입력 형식을 통째로 외운다.** 학습에서 못 본 모양이 서빙에
들어오면 조용히 퇴화한다 — 예외도 실패 로그도 없고, 문구가 어색해지거나 게이트에
걸려 기본 문구로 떨어질 뿐이라 원인 추적이 어렵다.

**재생성 신호는 하나뿐이다: 프롬프트에 실리는 문자열의 모양이 바뀌는 것.**

다시 뽑아야 하는 경우:

| 변화 | 왜 |
|---|---|
| 카테고리 체계 변경(값 추가·세분류·이름 변경) | 슬롯 줄의 `이름 · 카테고리` 어휘가 달라진다 |
| 슬롯 속성이 프롬프트에 추가됨(실내/실외·예약 여부 등) | 줄 구조 자체가 달라진다 |
| POI 이름 표기 규칙 변경(괄호 부기 유지/제거 등) | 게이트가 이름을 문자열로 대조하고 학습도 그 표기를 배운다 |
| 프롬프트 템플릿 자체 수정(`prompts/reminder_copy.yaml`) | 말할 것도 없다 — `version` 을 올리고 다시 뽑는다 |

**신호가 아닌 것**: POI 건수 증가, 실재 검증으로 일부 제외·강등, 좌표·영업시간처럼
프롬프트에 안 실리는 필드 변경. 데이터가 쌓이고 정확해지는 것 자체는 재생성 사유가
아니다.

비용은 1회 $0.3·2시간 수준이다(2026-09-16 실측: 874 시나리오 × 3회). **모르고
지나가는 쪽이 훨씬 비싸므로 의심스러우면 다시 뽑는다.**

2026-09-16 기준으로 관련 세션(스케줄 에이전트·PlanB·봉투 수렴·운영/데이터)에
"위 변화가 생기면 알려달라"고 요청해 두었다.
