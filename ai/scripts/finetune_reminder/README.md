# 리마인드 문구 학습 데이터 생성

**오프라인 파이프라인** — CI 밖에서 수동 실행한다.

## 개요

여행 일정 알림 문구를 생성하는 경량 파인튜닝 모델을 학습하기 위해 데이터를 생성한다:

1. 시나리오(일정 정보) → 교사 모델(Qwen3-235B, 오픈 웨이트)에 질의
2. 교사의 출력 → **서빙 게이트와 동일한 규칙**으로 필터링
3. 통과분만 JSONL 형식으로 저장

## 핵심 설계

### 라이선싱

- **교사는 오픈 웨이트만** (Qwen3-235B, Apache-2.0)
- Anthropic·OpenAI 이용약관은 그 출력물로 어떤 모델이든 학습하는 것을 금지
- 판정 LLM은 완성품 평가 용도로만 사용 — **데이터 선별에는 개입하지 않음**

### 필터 = 서빙 게이트

필터는 `ReminderCopyGate` 를 **그대로 import** 한다. 규칙을 두 벌로 구현하면:
- 학습 데이터: 필터 규칙을 따름
- 런타임: 게이트 규칙을 따름
- → 학습 분포와 서빙 판정이 어긋나 통과율이 조용히 떨어짐

## 사용법

### 설정

환경 변수 설정:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
```

### 시나리오 JSON

`scenarios.json` 구조:

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
- `schedule_key`: 예약 ID
- `kind`: `TRIP_DAY` 또는 `TRIP_PRE`
- `date`: 표시용 날짜 문자열
- `trip_title`: 여행 제목
- `slot_names`: 그날 방문 장소명 (순서 = 방문 순서)
- `slot_categories`: `slot_names` 와 같은 길이의 카테고리 (선택, 기본값 빈 튜플)
- `other_names`: 같은 여행의 다른 날 장소명 (게이트가 거부함)

### 실행

```bash
python scripts/finetune_reminder/build_dataset.py \
  --scenarios scenarios.json \
  --out dataset.jsonl \
  --per-scenario 3 \
  --temperature 1.0
```

옵션:
- `--scenarios`: 입력 시나리오 JSON 경로 (필수)
- `--out`: 출력 JSONL 경로 (필수)
- `--per-scenario`: 시나리오당 생성 수 (기본값 3)
- `--temperature`: 다양성 조절 (기본값 1.0, 높을수록 다양함)

### 출력

JSONL 파일 — 각 줄이 하나의 학습 샘플:

```json
{"messages": [
  {"role": "user", "content": "[프롬프트 전체 텍스트]"},
  {"role": "assistant", "content": "{\"title\": \"...\", \"body\": \"...\", \"places\": [...]}"}
]}
```

마지막에 통계 출력:

```
원본 150 → 통과 125 · 탈락 25 · 중복제거 후 110
```

## 게이트 검증 규칙

필터가 거부하는 샘플:

1. **제목·본문 길이**: 제목 > 20자 또는 본문 > 60자
2. **금지 토큰**: "분", "시간", "시각", "duration" 포함 (INV-3)
3. **장소 대조**:
   - 선언한 장소가 allowed 집합에 없음 (INV-1)
   - 선언한 장소가 본문에 없음 (선언 정직성)
   - forbidden 장소가 본문에 있음 (다른 날 일정 언급)
4. **빈 제목 또는 본문**

## 테스트

```bash
cd ai
uv run pytest tests/test_finetune_reminder_filter.py -v
```

필터 테스트는 실제 `ReminderCopyGate` 를 import 해서 동일한 규칙으로 검증한다.
