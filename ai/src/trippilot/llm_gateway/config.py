"""C1Config — 게이트웨이 설정 컨테이너 (U4 FD business-logic-model §1).

model_id는 항상 설정값 주입 (BR-U4-08) — 코드에 모델 문자열 하드코딩 금지.
timeout 기본 10s (안전망 — 예산 있는 호출은 관통).
temperature 는 **설정 자체가 없다** — 두 벤더 모두 파라미터를 거부한다(adapters 참조).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from trippilot.domain.llm import LlmFeature, ModelTier


def default_tier_map() -> Mapping[LlmFeature, ModelTier]:
    """FD domain-entities §1의 기능→티어 기본 매핑 (경량 6·상위 6).

    OFFLINE 티어는 배치·회귀 전용 — 기능 매핑에 등장하지 않는다.
    """
    return MappingProxyType(
        {
            LlmFeature.PREFERENCE_SCORING: ModelTier.LIGHT,
            LlmFeature.INTENT: ModelTier.LIGHT,
            LlmFeature.PARAPHRASE: ModelTier.LIGHT,
            LlmFeature.REASON_INTERPRETATION: ModelTier.LIGHT,
            # INTENT·PARAPHRASE와 동급 과업 — LIGHT 확정 여부는 K-2 실모델 검증 대기
            # (agent-foundation FD 미결 #4)
            LlmFeature.EDIT_TRANSLATION: ModelTier.LIGHT,
            # 자유 발화 → 닫힌 키 번역. EDIT_TRANSLATION 과 동급 과업이고, 1차
            # 임베딩 매칭이 걸러낸 나머지만 오므로 호출 빈도도 낮다.
            LlmFeature.REPLAN_DIRECTIVE_TRANSLATION: ModelTier.LIGHT,
            # 자유입력 → 장소명·시각·날씨 주장 추출. 번역과 같은 급의 짧은 구조화 과업.
            LlmFeature.REPLAN_REQUEST_EXTRACTION: ModelTier.LIGHT,
            # 푸시 문구 1문장 — 저비용 모델로 충분 (TRIP-347)
            LlmFeature.REFLECTION_NUDGE: ModelTier.LIGHT,
            # 공유 카드 캡션 1문단 + 해시태그 — 후보 선택도 다단 구성도 없는 단발 변환이고
            # 재료(방문 상호명·기간·지역)가 이미 확정 문자열로 들어온다. REFLECTION_NUDGE와
            # 같은 급의 짧은 카피 1회라 LIGHT (TRIP-429 후속 — j06).
            LlmFeature.SHARE_CARD_COPY: ModelTier.LIGHT,
            # 뱅크 증강 — 짧은 문장 변형 N개. PARAPHRASE 와 같은 급의 과업이고 오프라인
            # 배치라 지연도 무관하다. 품질이 모자라면 feature_models 로 올린다(TRIP-513).
            LlmFeature.BANK_AUGMENT: ModelTier.LIGHT,
            # 알림 문구 2줄 — 넛지와 동급 과업이라 LIGHT. 실제로는 feature_models
            # 오버라이드로 로컬 파인튜닝 모델이 배정된다(티어 해석보다 우선).
            LlmFeature.REMINDER_COPY: ModelTier.LIGHT,
            # 도우미 턴 3종 — 분류(INTENT 와 동급)·답변 2~4문장·요약 ≤20줄. 전부 백엔드 해석 시한 9s
            # 안의 짧은 과업이라 LIGHT (assistant-orchestrator FD domain-entities §2.10).
            LlmFeature.DIALOGUE_INTENT: ModelTier.LIGHT,
            LlmFeature.DIALOGUE_ANSWER: ModelTier.LIGHT,
            LlmFeature.DIALOGUE_MEMORY: ModelTier.LIGHT,
            # 범위 밖 질문의 도구 계획 — 분류와 같은 급(닫힌 이름 고르기 + 짧은 인자), 같은 9s 안이라 LIGHT (BR-AO-28)
            LlmFeature.DIALOGUE_PLAN: ModelTier.LIGHT,
            # 장소 탐색 NL2SQL — 짧은 SELECT 한 문장, 같은 9s 안의 팬아웃 작업이라 LIGHT
            LlmFeature.DIALOGUE_SQL: ModelTier.LIGHT,
            LlmFeature.EXPLANATION: ModelTier.HEAVY,
            # 차선책 근거 문장 — 설명(EXPLANATION)과 같은 급의 취향 그라운딩 문장 (TRIP-887)
            LlmFeature.ALTERNATIVE_EXPLANATION: ModelTier.HEAVY,
            LlmFeature.ALTERNATIVE_SELECTION: ModelTier.HEAVY,
            # 남은 하루를 고르는 판단 — 대체지 선택과 같은 급의 상위 과업
            LlmFeature.REPLAN_COMPOSITION: ModelTier.HEAVY,
            # 장면 시퀀스 연출 생성 — 회고 본문 생성의 정본(구 REFLECTION 흡수), 백그라운드 N회 생성 전제
            # (TRIP-429, BR-U6R-13: 티어·모델 실체는 항상 설정값)
            LlmFeature.REFLECTION_TEMPLATE: ModelTier.HEAVY,
            # 사진 대표 선별 — 이미지 판독이 필요한 상위 과업이라 HEAVY (TRIP-595).
            # **티어는 vision 가용성을 보장하지 않는다**: 이미지 수용 여부는 어댑터와
            # 모델이 정한다 — anthropic·openai(responses 표면) 어댑터 모두 이미지 변환
            # 구현(2026-09-01, 팀 결정: vision 기능은 Claude 배정). chat.completions
            # 경로만 미지원. vision 모델 지정은 `feature_models` 오버라이드(TRIP-513)
            # 몫이고, 미지원 조합이면 LlmUnsupportedError → 폴백으로 강등된다.
            # 프로바이더·모델 선정은 TRIP-515 런북 소관 (BR-U6R-13: 실체는 설정값).
            LlmFeature.PHOTO_HIGHLIGHT: ModelTier.HEAVY,
            # vision 장면·캡션 생성 — 텍스트 템플릿과 같은 출력 계약, 모델만 분리(미결 #6)
            LlmFeature.REFLECTION_TEMPLATE_VISION: ModelTier.HEAVY,
            LlmFeature.PLACE_EXTRACTION: ModelTier.HEAVY,
            # 자유 텍스트 구조화 추출 — PLACE_EXTRACTION과 동급 과업 (TRIP-421)
            LlmFeature.EVENT_EXTRACTION: ModelTier.HEAVY,
        }
    )


def default_fallback_modes() -> Mapping[LlmFeature, tuple[str, str]]:
    """기능 → (from_mode, to_mode) — FallbackEvent가 싣는 **실제** 폴백 (TRIP-260 #4).

    c1은 신호만 내고 실행은 호출측이지만(BR-U4-09), 이벤트가 싣는 모드는 그 호출측이
    실제로 하는 일이어야 한다. 전부 `llm_score → rule_score`로 하드코딩돼 있던 동안
    4개 중 3개의 증빙이 거짓이었다 — INV-4가 요구하는 증빙 자체가 틀린 값을 실으면
    침묵 실패보다 나쁘다(잘못된 곳을 보게 만든다).

    값은 전부 **호출측 코드에서 확인한** 문자열이다 — 항목별 주석이 그 근거다.
    """
    return MappingProxyType(
        {
            # agents/schedule/agent.py `ScheduleAgent._score` — 폴백이면
            # `_rule_scores()` 실행 + ScoringMode.RULE. 같은 두 문자열을 그쪽
            # `_degrade(..., "llm_score", "rule_score", ...)`도 쓴다.
            LlmFeature.PREFERENCE_SCORING: ("llm_score", "rule_score"),
            # ScheduleAgent `_explain` — 대체 설명이 없다. 빈 설명으로 일정만 나간다.
            # 그쪽 `_degrade(..., "llm_explain", "(none)", ...)`의 문자열 그대로.
            LlmFeature.EXPLANATION: ("llm_explain", "(none)"),
            # ScheduleAgent `_explain_alternatives` · api/wiring.py `explanations` — 실패하면
            # 차선책의 템플릿 rationale("같은 카페 후보", TRIP-871)이 그대로 남는다.
            LlmFeature.ALTERNATIVE_EXPLANATION: (
                "llm_explain_alternatives", "template_rationale"),
            # agents/planb/rag.py `_select`→`_rationale` — used_llm=False면 규칙 랭킹
            # ("llm_select_alternatives" / "rule_ranking"도 그 함수의 문자열 그대로).
            LlmFeature.ALTERNATIVE_SELECTION: ("llm_select_alternatives", "rule_ranking"),
            # api/wiring.py `_compose_day` — 실패면 고른 목록 없이 종전 재계획
            # (PlanB 랭킹 가산 + 점수 + 어셈블리 선택)으로 진행한다.
            LlmFeature.REPLAN_COMPOSITION: ("llm_compose_day", "scored_assembly"),
            # api/wiring.py `_verified_request` — 실패면 추출 없이 진행(칩·지시·구성은 원문을 그대로 읽는다)
            LlmFeature.REPLAN_REQUEST_EXTRACTION: ("llm_request_extract", "no_extraction"),
            # agents/reflect/composer.py `finalize` — 전 시도 실패면 고정 폴백 템플릿
            # (그쪽이 직접 내는 FallbackEvent와 같은 모드 쌍).
            LlmFeature.REFLECTION_TEMPLATE: ("llm_template", "fixed_template"),
            # api/wiring.py `reflection_nudge` — 결정론 기본 문구(FALLBACK_NUDGE_MESSAGE).
            # 그쪽 방어 분기의 FallbackEvent와 같은 모드 쌍.
            LlmFeature.REFLECTION_NUDGE: ("llm_nudge", "fixed_message"),
            # api/wiring.py `reflection_share_card` — 결정론 정적 조립
            # (workers.share_card_copy.fallback_share_card_copy: `{지역} 여행의 기록` ·
            # `#{지역}여행`). 워커 직행 패턴이라 발행 주체는 경계다 (FD §2.1).
            LlmFeature.SHARE_CARD_COPY: ("llm_share_card", "static_copy"),
            # api/wiring.py `reminder_copy` — 문구를 못 만들면 그 항목을 응답에서 빼고,
            # 백엔드가 기존 하드코딩 상수(NotificationSchedule.title()/body())로 보낸다.
            # to_mode 가 "backend_constant" 인 이유: 폴백 실행 주체가 백엔드다.
            LlmFeature.REMINDER_COPY: ("llm_reminder_copy", "backend_constant"),
            # orchestrator/intent_router.py `_classify` → `_fallback()` —
            # Intent.OUT_OF_SCOPE + MatchRoute.FALLBACK로 수렴한다.
            LlmFeature.INTENT: ("llm_intent", "out_of_scope"),
            # orchestrator/dialogue_orchestrator.py(assistant-orchestrator tasks T013, 같은 PR) —
            # 분류 실패(null·게이트 드롭·시한)는 IntentRouter 와 같이 OUT_OF_SCOPE 로 수렴한다
            # (문장 없음 — 백엔드 SCOPE 카드). from_mode 는 INTENT 와 갈라 섀도·서비스를 구분한다.
            LlmFeature.DIALOGUE_INTENT: ("llm_dialogue_intent", "out_of_scope"),
            # 같은 곳 — 답변 문장을 못 만들면(게이트 드롭·시한 부족) 의도별 결정론 템플릿
            # (workers/dialogue_answer.fallback_answer_text, T003) 문장으로 보낸다.
            LlmFeature.DIALOGUE_ANSWER: ("llm_dialogue_answer", "template_text"),
            # 같은 곳 — 요약 실패면 최근 턴을 줄로 잘라 붙이는 결정론 압축
            # (orchestrator/dialogue_memory.compress_fallback, T007)으로 전진하고 다음 턴에 다시 시도한다.
            LlmFeature.DIALOGUE_MEMORY: ("llm_dialogue_memory", "deterministic_compress"),
            # 같은 곳 2‴ — 계획 실패(시한·벤더·깨진 출력·전량 드롭)면 계획 없이 종전 범위 밖(BE SCOPE 카드)으로 수렴한다.
            # 도구 없음·거절(calls=[]·refused)은 성공·0건이라 이 짝이 나가지 않는다(의도된 결정론, BR-AO-28).
            LlmFeature.DIALOGUE_PLAN: ("llm_dialogue_plan", "out_of_scope"),
            # 같은 곳 — SQL 을 못 만들면(시한·깨진 출력·허용 목록 탈락) 종전 반경 탐색(지역 중심 표 + 결정론 정렬)으로 내려간다.
            # "장소 조회로 답할 말이 아님"(sql=null)은 성공·0건이라 이 짝이 나가지 않는다.
            LlmFeature.DIALOGUE_SQL: ("llm_dialogue_sql", "explore_radius"),
            # intent_router `_vote` — 유사질문이 없으면 투표를 접고 3차(LLM 직접
            # 분류)로 **승급**한다. 규칙으로 내려가는 강등이 아니다.
            LlmFeature.PARAPHRASE: ("llm_paraphrase", "llm_direct"),
            # 오프라인 배치 — 실패하면 그 seed 의 변형을 못 만들 뿐, 런타임 경로가 아니라
            # 강등할 대상이 없다. 스크립트가 사유를 제안 파일의 rejected 에 남긴다
            # (scripts/intent/augment_bank.py).
            LlmFeature.BANK_AUGMENT: ("llm_augment", "(none)"),
            # api/wiring.py `edit` — 자연어 번역 실패는 TRANSLATION_FAILED 정직 보고.
            # 편집은 적용되지 않고, 구조화 진입은 무영향이다.
            LlmFeature.EDIT_TRANSLATION: ("llm_edit_translation", "translation_failed"),
            # 실패해도 재계획은 돈다 — 칩 선택분과 사유가 그대로 살아 있고, 자유 입력
            # 해석만 빠진다. 그래서 to_mode 가 "실패"가 아니라 "칩만"이다.
            LlmFeature.REPLAN_DIRECTIVE_TRANSLATION: (
                "llm_directive_translation", "chips_only"),
            # scripts/collect/collect_events.py `collect_region` — 추출 0건으로 그 회차를
            # 넘긴다(대체 추출 경로 없음).
            LlmFeature.EVENT_EXTRACTION: ("llm_extract", "(none)"),
            # agents/reflect/highlight_rule.py — 방문당 1장·시간 분산 결정론 선별.
            # ReflectAgent 의 vision 단계가 실행한다.
            LlmFeature.PHOTO_HIGHLIGHT: ("llm_highlight", "rule_highlight"),
            # agents/reflect/agent.py ReflectAgent._compose_vision — vision 시도 실패 시 같은
            # 3회 예산 안에서 텍스트 템플릿으로 강등(#9 확정: 예산 공유, 최악 3회).
            LlmFeature.REFLECTION_TEMPLATE_VISION: ("vision_template", "text_template"),
            # PLACE_EXTRACTION은 프로덕션 호출측이 아직 없다(워커·테스트뿐) —
            # 워커 docstring("게이트 전 원시까지")과 EVENT_EXTRACTION 선례에서
            # 유추한 값이다. 호출측이 생기면 그때 실측으로 확정한다.
            LlmFeature.PLACE_EXTRACTION: ("llm_extract", "(none)"),
            # 유령 feature (TRIP-530) — 프롬프트·게이트·워커가 전부 없어 이 값이
            # 발행될 경로 자체가 없다. 지어내지 않고 unknown으로 둔다.
            LlmFeature.REASON_INTERPRETATION: ("llm_reason_interpretation", "unknown"),
        }
    )


def default_feature_max_tokens() -> Mapping[LlmFeature, int]:
    """기능별 출력 상한 — 여기 없는 기능은 공용 `C1Config.max_tokens`(1024).

    근거 문장 두 기능은 **확정 일정 전 슬롯을 한 번에** 받아 항목마다 한국어를 쓴다.
    실측(라이브 로그, claude-sonnet-5·gpt-5.6-terra): EXPLANATION 이 매번
    output_tokens=1024 에서 잘려 `parse_error: JSON 아님: Unterminated string` → 근거 0건.
    ALTERNATIVE_EXPLANATION 은 슬롯당 차선책 ≤2건 × 1~2문장이라 같은 모양이다.
    GPT-5 계열은 reasoning 토큰도 이 상한에서 빠진다.

    REFLECTION_TEMPLATE 은 실측 출력이 950~1016 토큰이라 1024 에 붙어 있다 — 3방문
    짧은 입력도 잘림 1회가 재시도를 부르고, 재시도가 요청 예산을 넘겨 504 가 났다.

    SHARE_CARD_COPY 는 claude-fable-5-1(사고 항상 켜짐, 사고 토큰도 이 상한 안)에서 출력이
    1000~1024 토큰 — 1024 에서 잘려 정적 문구로 강등됐다(2026-10-11 실측).
    """
    return MappingProxyType(
        {
            LlmFeature.EXPLANATION: 4096,
            LlmFeature.ALTERNATIVE_EXPLANATION: 4096,
            LlmFeature.REFLECTION_TEMPLATE: 2048,
            LlmFeature.SHARE_CARD_COPY: 2048,
            # 고른 곳 ≤ 8건 × 이유 1문장 + fable 사고 토큰 — 대체지 선택(≤ 3건)의 두 배 남짓
            LlmFeature.REPLAN_COMPOSITION: 2048,
            # 청크 ≤ 25건 × 건당 ~34 토큰 ≈ 850 + fable 사고 토큰(effort 미지정 = high). 1024 에서는
            # DEV 실측(2026-10-13) 45회 중 3회가 정확히 1024 에서 잘려 `parse_error: Unterminated string`
            # → 청크째 규칙 점수로 내려갔다(성공분도 최대 1019 — 상한에 붙어 있었다). 청크 크기는 그대로다 —
            # `score_chunk_cap` 이 사고 몫(`SCORE_THINKING_RESERVE_TOKENS`)을 빼고 역산한다.
            LlmFeature.PREFERENCE_SCORING: 2048,
            # 도우미 턴(assistant-orchestrator tasks T001) — 분류는 JSON 한 줄, 답변은 ≤400자, 요약은
            # ≤20줄×120자. effort low 와 짝. 사고 토큰도 이 상한 안이다(위 SHARE_CARD_COPY 실측). 분류 1024: 초판 256 은
            # DEV 실측(2026-10-18 배포 smoke, gpt-5.6-luna)에서 출력 239/256(사고 포함, 입력 2,004)으로 상한에 붙었다 — 로컬
            # 평균은 39 였다. 잘리면 `truncated:` → 범위 밖 카드(BE 거절 스트릭)라 답변 512 보다 넉넉히 둔다. 과금은 실 출력만이다.
            # 요약 2048: 20줄×120자 한국어 ≈ 1,000~1,500 토큰 + JSON — 1024 면 꽉 찬 요약이 잘려 압축 폴백으로
            # 떨어진다. 상한은 잘림 방지용이고 과금은 실 출력만이다(FD BR 미결 #11 → 해소).
            LlmFeature.DIALOGUE_INTENT: 1024,
            LlmFeature.DIALOGUE_ANSWER: 512,
            LlmFeature.DIALOGUE_MEMORY: 2048,
            # 계획 — 분류와 같은 근거(JSON 한 줄 + 사고 토큰, 분류 실측 출력 239/256 사고 포함). 잘리면 계획 없이 범위 밖이다
            LlmFeature.DIALOGUE_PLAN: 1024,
            # SELECT 한 문장(≤800자) JSON — 사고를 끄므로(none) 출력 자체만 든다
            LlmFeature.DIALOGUE_SQL: 512,
        }
    )


def default_feature_effort() -> Mapping[LlmFeature, str]:
    """기능별 사고 깊이(Claude `output_config.effort`·GPT `reasoning.effort`) — 여기 없는 기능은 안 싣는다(모델 기본값).

    claude-fable-5-1 은 사고를 끌 수 없고(항상 켜짐) 기본 effort 가 high 다. 사고 토큰은
    출력 상한 안에서 쓰이므로, 시한이 짧은 기능은 낮춰야 예산 안에 든다. 실측
    (2026-10-11, 실 경계 하네스):
      - REFLECTION_TEMPLATE — high: 시도당 ~25s·출력 2048 에서 잘림 → 백엔드 시한 15s 초과로
        고정 템플릿 강등. low: ~10s·출력 ~900, 3/3 성공.
      - REMINDER_COPY — high: 항목당 ~8s(배치 시한 8s 에 1건도 빠듯). low: ~1.9s.
      - ALTERNATIVE_SELECTION — replan(시한 25s)에서 1차 몫이 ~4s 로 내려와 high(3.5~7s)가
        타임아웃 → 규칙 랭킹. low: ~3.5s, 게이트 드롭 0. 단 low 에서도 사유 `none` 이면 사고가
        켜져 7~9s 였다(2026-10-14) — 프롬프트 0.5.0 의 "바로 고르세요" 줄이 끈다(3.8~5.2s).
    low 를 전 기능에 쓰지 않는 이유: EDIT_TRANSLATION·SHARE_CARD_COPY 가 low 에서 게이트
    위반(대체 장소를 영향 슬롯에 넣음·근거 없는 해시태그)으로 전량 드롭됐다 — high 에선 통과.
    시한 없는 경계(`/explanations` 등)는 high 그대로 둔다.

    GPT(responses 표면)에도 `reasoning.effort` 로 같은 값이 실린다 — gpt-5.6-sol·terra·luna 는
    low 를 받는다(2026-10-14 실호출).
    **effort 를 거부하는 모델(haiku-4-5 등)을 여기 있는 기능에 배정하면 400 → 폴백이다.**
    모델을 바꾸면 이 표부터 본다(temperature #472 와 같은 함정).
    """
    return MappingProxyType(
        {
            LlmFeature.REFLECTION_TEMPLATE: "low",
            LlmFeature.REMINDER_COPY: "low",
            LlmFeature.ALTERNATIVE_SELECTION: "low",
            # 같은 재계획 시한(25s) 안에서 PlanB 다음에 돈다 — 대체지 선택과 같은 이유
            LlmFeature.REPLAN_COMPOSITION: "low",
            # 같은 재계획 시한 안에서 PlanB·구성보다 먼저 돈다 — 짧은 구조화라 사고가 필요 없다
            LlmFeature.REPLAN_REQUEST_EXTRACTION: "low",
            # 자유 발화 → 지시 키(닫힌 목록). 미지정(기본 추론)이라 DEV 에서 시한 3.75s 를 2/2 넘겼다
            # (2026-10-14) — 같은 원문을 읽는 추출은 low 로 2/2 성공했다. 출력은 사전 키만 통과(게이트).
            LlmFeature.REPLAN_DIRECTIVE_TRANSLATION: "low",
            # 도우미 턴 — 백엔드 해석 시한 9s 안에서 분류 ≤4.0s·답변 ≤3.5s·요약 ≤2.0s(2026-10-18 실측 개정)라 사고를 낮춘다
            # (assistant-orchestrator FD domain-entities §2.10 · BLM 시한표)
            LlmFeature.DIALOGUE_INTENT: "low",
            LlmFeature.DIALOGUE_ANSWER: "low",
            LlmFeature.DIALOGUE_MEMORY: "low",
            # 계획(2‴) — 같은 9s 안에서 분류 뒤 ≤3.5s(잔여×0.45). 사고를 끈다(none): 고르는 것은 닫힌 도구 이름·짧은 인자라
            # 사고가 품질을 올리지 않았다 — 2026-10-20 luna·평가셋 38×2·동시 2: low p50 1.61s·p90 2.39s·출력 60 토큰 → none
            # 1.36s·2.28s·32 토큰, 도구 일치 90.0 → 95.0%(틀린 2건은 시한 초과)·도구 없음·주입 100%. luna 는 minimal 을 400 으로
            # 거부하고 none 을 받는다 — 다른 모델을 배정하면 이 값부터 확인 (BR-AO-28)
            LlmFeature.DIALOGUE_PLAN: "none",
            # 팬아웃 안(≤3s)의 짧은 변환이라 사고를 끈다 — luna 는 minimal 을 400 으로 거부하고 none 을 받는다(DIALOGUE_PLAN 실측)
            LlmFeature.DIALOGUE_SQL: "none",
        }
    )


# 매핑에 없는 feature의 안전 기본 — KeyError로 죽지 않되 **그 사실이 이벤트에
# 드러난다**. 조용히 그럴듯한 값을 찍으면 #4를 다시 만드는 셈이다.
# enum이 늘면 테스트(전 feature 스윕)가 먼저 깨진다.
UNMAPPED_FALLBACK_MODES = ("llm", "unmapped_feature")


@dataclass(frozen=True)
class C1Config:
    model_ids: Mapping[ModelTier, str]  # 주입 필수 — 하드코딩 금지 (BR-U4-08)
    tier_map: Mapping[LlmFeature, ModelTier] = field(default_factory=default_tier_map)
    # 기능별 모델 오버라이드 (TRIP-513 — GPT·Claude 혼용). 있으면 tier 해석보다
    # 우선한다. 벤더 선택은 모델명이 결정 — RoutingLlm이 접두어로 어댑터를 고른다.
    feature_models: Mapping[LlmFeature, str] = field(default_factory=dict)
    # 기능별 **타임아웃 재시도 모델** (TRIP-522 2단 폴백). 1차 모델이 타임아웃하면
    # 규칙 폴백으로 내려가기 전에 이 모델로 한 번 더 부른다 — 호출측이
    # `call(retry_timeout_sec=...)` 로 예산을 줄 때만. 매핑에 없는 feature 는 종전
    # 그대로 1회 시도다.
    #
    # 타임아웃에만 쓴다. `unsupported` 는 재시도해도 같고(TRIP-595), 벤더 오류는
    # 사유가 갈려 여기서 덮으면 안 보인다. 실측(2026-09-08, 실 PlanB 프롬프트 5회):
    # sol 중앙값 5.0s · terra 5.2s · opus 7.6s(편차 1.2s) — **1차보다 빠른 모델은 없다.**
    #
    # 그래서 이 값은 두 축 중 하나를 고르는 문제다 — **여유**(빠른 모델로 예산 확보)
    # 대 **벤더 독립**(1차 벤더가 통째로 느려진 경우를 피함). 2026-09-12 팀 결정은
    # 여유 쪽(`gpt-5.6-terra`, `.env.example`): 재시도 몫 8.75초 대비 여유가 1초(opus)
    # 에서 3.5초(terra)로 늘어난다. 벤더 상관 가설은 재현하지 못했으므로 운영
    # 트레이스의 2차 성공률로 판정한다 — 낮으면 그게 증거이고 `.env` 한 줄로 되돌린다.
    retry_models: Mapping[LlmFeature, str] = field(default_factory=dict)
    # 기능별 폴백 모드 (TRIP-260 #4) — FallbackEvent의 from_mode/to_mode.
    # 실체는 호출측이 하는 일이라 feature마다 다르다 (default_fallback_modes 주석).
    fallback_modes: Mapping[LlmFeature, tuple[str, str]] = field(
        default_factory=default_fallback_modes
    )
    # **안전망**이지 설계값이 아니다 — 예산이 있는 호출은 전부
    # `GatewayFacade.call(timeout_sec=...)` 로 관통한다(TRIP-376 선례). 이 값이 실제로
    # 쓰이는 프로덕션 경로는 REFLECTION_NUDGE(오버라이드 없음)와, deadline 을 안 실은
    # ALTERNATIVE_SELECTION 뿐이다 — 둘 다 사용자 대기 화면이 아니다.
    #
    # 2.5 → 10.0 (2026-09-01). BR-U4-04·NFR-1.2 는 2.5 를 "요청 예산 5초의 절반"으로
    # 정당화했는데, 그 5초는 generate day1 예산이고 **정작 이 기본값을 쓰는 feature 는
    # 그 예산과 무관**하다. 그 사이 상위 티어 모델이 붙으면서(gpt-5.6-sol 실측 5.1s)
    # 2.5 는 "폴백을 강제하는 값"이 됐다 — PlanB 가 컨테이너에서 100% 타임아웃했다.
    # 요청 단위 상한은 `TimeoutBackstopMiddleware`(deadline+margin → 504)가 따로 쥔다.
    timeout_sec: float = 10.0
    # 출력 상한 — 공용 값 + 기능별 지정(`max_tokens_for`). 지정 없는 기능은 공용 값.
    max_tokens: int = 1024
    feature_max_tokens: Mapping[LlmFeature, int] = field(
        default_factory=default_feature_max_tokens
    )
    # 사고 깊이 — 기능별 지정만, 공용 값 없음(`effort_for`, 미지정 = 모델 기본값).
    feature_effort: Mapping[LlmFeature, str] = field(default_factory=default_feature_effort)
    # PREFERENCE_SCORING 병렬 청킹 (TRIP-378) — 청크 크기는 고정 상수가 아니라
    # 단계 예산에서 유도한다 (TRIP-380 적응형 공식, workers/preference.py
    # adaptive_chunk_size). 종전 score_chunk_size=20 상수는 공식이 대체 — 예산
    # 14s·기본 파라미터에서 공식이 정확히 20을 재현한다(현행 동등).
    #
    # 선형 지연 모델 (TRIP-373 실측): 청크 소요 ≈ base + per_item × 청크크기.
    # 바닥 ~3s(7건 3.2s), 건당 ~0.2s (193건 단일 호출 44.5s).
    score_base_ms: int = 3_000
    score_per_item_ms: int = 200
    # 안전율 — 실측 변동이 3~4배(TRIP-373)이고 청크 편차 4.8~19.5s(TRIP-380
    # 계측)라, 기대 소요가 예산의 절반에 오도록 목표 시간을 예산/2로 잡는다.
    score_safety: float = 2.0
    # 청크 크기 클램프 — 너무 작으면 호출 바닥(base)만 반복 지불, 너무 크면
    # 슬로 테일 한 방이 단계 전체를 삼킨다.
    score_chunk_min: int = 5
    score_chunk_max: int = 40
    # 병렬수 N = ⌈풀 ÷ c*⌉의 상한 — 실전 풀 193건에서 N=10 (동시 호출 폭주 방지).
    score_max_parallel: int = 10

    def __post_init__(self) -> None:
        if self.score_base_ms < 0:
            raise ValueError("score_base_ms는 음수 불가")
        if self.score_per_item_ms <= 0:
            raise ValueError("score_per_item_ms는 양수여야 함")
        if self.score_safety < 1.0:
            raise ValueError("score_safety는 1.0 이상이어야 함 (목표 ≤ 예산)")
        if self.score_chunk_min <= 0:
            raise ValueError("score_chunk_min은 양수여야 함")
        if self.score_chunk_max < self.score_chunk_min:
            raise ValueError("score_chunk_max ≥ score_chunk_min이어야 함")
        if self.score_max_parallel <= 0:
            raise ValueError("score_max_parallel은 양수여야 함")

    def max_tokens_for(self, feature: LlmFeature) -> int:
        return self.feature_max_tokens.get(feature, self.max_tokens)

    def effort_for(self, feature: LlmFeature) -> str | None:
        return self.feature_effort.get(feature)
