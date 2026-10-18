"""프롬프트 판본 A/B — 같은 입력을 두 `prompts/` 디렉토리로 실 LLM 에 돌려 정확도·게이트 통과·지연을 잰다.

CI 밖 수동 실행 전용(실 API 를 부른다). few-shot·판단 순서(CoT) 같은 프롬프트 튜닝은 숫자 없이
넣으면 "좋아 보이는" 판본이 시한을 넘기거나 게이트 드롭을 늘려도 모른다 — 폴백이라 200 으로 숨는다.
주석에 수치만 적는 대신 재현 스크립트를 남긴다(`measure_kb_topk.py` 와 같은 취지).

실행 (ai/ 에서, 기준 판본은 develop 스냅샷을 풀어 둔 디렉토리):
    git archive origin/develop ai/prompts | tar -x -C /tmp/base
    uv run --env-file ../.env python scripts/measure/measure_prompt_ab.py intent /tmp/base/ai/prompts 2
    uv run --env-file ../.env python scripts/measure/measure_prompt_ab.py intent prompts 2

종류:
- `intent`  DIALOGUE_INTENT — `data/intent_eval_set.yaml`(사람 검수 87문장) + 지시어 사례 6건. OUT_OF_SCOPE 의
  정답은 거절({"intent": null})이다. 평가셋 문장을 프롬프트 예시로 옮기면 이 숫자가 무의미해진다(leak).
- `directive`  REPLAN_DIRECTIVE_TRANSLATION(sol) — 라벨은 `measure_directive_match.POSITIVES/NEGATIVES` + 부정·혼합
  6건. 완전 일치(겹쳐 고른 지시도 오답)와 허용(정답 포함·금지 지시 없음)을 같이 낸다. 시한 3.75s(DEV 실측 시한).
- `answer`  DIALOGUE_ANSWER — Facts 9종 × 반복. 게이트 통과율·시각-장소 짝 위반(오케스트레이터 INV-2 검사와
  같은 함수)·지연. 문장은 끝에 전부 찍는다 — 지어낸 사실은 사람이 읽어서 본다.
- `scoring` PREFERENCE_SCORING — `data/collected_pois.json` 해운대구 실데이터 53곳 × 페르소나 3종. 세 번째 인자는
  반복이 아니라 **청크 구성 수**다: 구성마다 poiId(uuid5)의 소금만 바꿔 워커의 `plan_chunks`(poi_id 정렬 균등 분할)가
  다른 묶음을 만들게 한다. 청크는 서로를 못 보고 따로 채점되므로, 같은 장소가 묶음에 따라 점수가 흔들리는지(POI별
  표준편차 평균·구성 간 스피어만)와 페르소나마다 미리 정한 명백한 상·하위 쌍의 순서 정합을 잰다. 프롬프트에 예시를
  넣는 판본을 잴 때는 해운대구 밖 POI 로 쓴다(겹치면 측정이 오염된다). 모델 기본 gpt-5.6-sol(운영 배정)·시한 14s
  (ScheduleAgent c1_max_ms). 같은 구성을 되풀이한 값(EVAL_SCORE_SAME_SPLIT=1, 샘플링 노이즈 바닥)과 견줘야 묶음 효과가
  보인다 — 2026-10-18 실측은 preference_scoring.yaml 머리 주석.
      uv run --env-file ../.env python scripts/measure/measure_prompt_ab.py scoring /tmp/base/ai/prompts 3

모델·시한은 운영 배정(.env.example 의 DIALOGUE_* = gpt-5.6-luna, BLM 시한표 분류 4.0s·답변 3.5s)이 기본이다.
sol 배정 기능은 `EVAL_MODEL=gpt-5.6-sol` 로 돌린다.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

import itertools  # noqa: E402
import uuid  # noqa: E402
from collections import defaultdict  # noqa: E402
from dataclasses import replace  # noqa: E402

import openai  # noqa: E402
import yaml  # noqa: E402

from trippilot.domain.common import BudgetLevel, PoiId, TraceId  # noqa: E402
from trippilot.domain.intent import Intent  # noqa: E402
from trippilot.domain.llm import CandidatePool, LlmFeature, ModelTier  # noqa: E402
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag  # noqa: E402
from trippilot.domain.poi import Poi  # noqa: E402
from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter  # noqa: E402
from trippilot.llm_gateway.config import C1Config  # noqa: E402
from trippilot.llm_gateway.gates.dialogue_answer import DialogueAnswerGate  # noqa: E402
from trippilot.llm_gateway.gates.intent import IntentGate  # noqa: E402
from trippilot.llm_gateway.gates.scoring import ClosedSetGate  # noqa: E402
from trippilot.llm_gateway.gateway import GatewayFacade  # noqa: E402
from trippilot.llm_gateway.prompts import PromptRegistry  # noqa: E402
from trippilot.llm_gateway.workers.dialogue_answer import DialogueAnswerWorker  # noqa: E402
from trippilot.llm_gateway.workers.dialogue_intent import DialogueIntentWorker  # noqa: E402
from trippilot.llm_gateway.workers.preference import (  # noqa: E402
    adaptive_chunk_size, build_prompt_vars, plan_chunks, score_chunk_cap,
)
from trippilot.orchestrator import dialogue_orchestrator as orch  # noqa: E402

MODEL = os.environ.get("EVAL_MODEL", "gpt-5.6-luna")
INTENT_TIMEOUT = float(os.environ.get("EVAL_INTENT_TIMEOUT", "4.0"))
ANSWER_TIMEOUT = float(os.environ.get("EVAL_ANSWER_TIMEOUT", "3.5"))
TRIP = "경주 2박 3일 · 2일차 진행 중"
_AI_ROOT = Path(__file__).resolve().parents[2]


class _NullTrace:
    def emit(self, event) -> None:
        pass


def _gateway(prompts: Path, feature: LlmFeature, gate, model: str = MODEL) -> GatewayFacade:
    # SDK 재시도 0 — 운영 어댑터와 같은 정책이라야 지연이 왜곡되지 않는다(TRIP-381)
    llm = OpenAIAdapter(openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"], max_retries=0), api="responses")
    cfg = C1Config(model_ids={t: model for t in ModelTier}, feature_models={feature: model})
    return GatewayFacade(llm, PromptRegistry(prompts), gate, cfg, _NullTrace())


def _run(fn, cases):
    with ThreadPoolExecutor(8) as ex:
        return list(ex.map(fn, enumerate(cases)))


def _timing(rows) -> dict:
    walls = sorted(r["wall"] for r in rows)
    outs = [r["out"] for r in rows if r["out"]]
    inps = [r["inp"] for r in rows if r["inp"]]
    return dict(p50_ms=walls[len(walls) // 2], p90_ms=walls[int(len(walls) * 0.9)], max_ms=walls[-1],
                timeouts=sum(1 for r in rows if r["err"] and "timeout" in r["err"]),
                out_tok_mean=round(statistics.mean(outs), 1) if outs else None,
                # 사고 토큰 포함 — 상한(C1Config.max_tokens_for)에 닿으면 잘려 폴백이다
                out_tok_p95=sorted(outs)[int(len(outs) * 0.95)] if outs else None,
                out_tok_max=max(outs) if outs else None,
                in_tok_mean=round(statistics.mean(inps), 1) if inps else None)


def _usage(result) -> dict:
    rec = result.call_record
    return dict(out=getattr(rec, "output_tokens", None), inp=getattr(rec, "input_tokens", None))


# ───────── intent ─────────

def _turn(role: str, text: str) -> SimpleNamespace:
    return SimpleNamespace(role=role, text=text)


# 평가셋에 없는 축 — 최근 대화로 지시어("박물관은"·"두 번째") 풀기. 프롬프트 예시와 다른 문장이다.
_HISTORY = [
    _turn("USER", "내일 일정 알려줘"),
    _turn("ASSISTANT", "내일은 10:00 동궁과월지, 13:00 황리단길 점심, 15:30 국립경주박물관 순서예요."),
]
CONTEXT_CASES = [
    ("GET_POI_INFO", "박물관은 입장료 있어?"),
    ("GET_DISTANCE", "두 번째랑 세 번째 사이 멀어?"),
    ("EDIT_SCHEDULE", "그럼 박물관은 빼고 그 시간에 쉴래"),
    ("SUGGEST_ALTERNATIVE", "점심 먹는 데 말고 다른 식당 없을까"),
    ("GET_WEATHER", "그날 비 오는 거 아니지?"),
    ("REPLAN", "내일 허리가 안 좋아서 덜 걷게 다시 짜줘"),
]


def run_intent(prompts: Path, repeat: int) -> None:
    worker = DialogueIntentWorker(_gateway(prompts, LlmFeature.DIALOGUE_INTENT, IntentGate()))
    data = yaml.safe_load((_AI_ROOT / "data/intent_eval_set.yaml").read_text(encoding="utf-8"))
    cases = [(c["intent"], u, [], "eval") for c in data["cases"] for u in c["utterances"]]
    cases += [(label, u, _HISTORY, "context") for label, u in CONTEXT_CASES]

    def one(item):
        i, (label, utt, history, kind) = item
        t0 = time.monotonic()
        r = worker.classify(utt, history, [], TRIP, TraceId(f"ab-{i}"), datetime.now(timezone.utc),
                            timeout_sec=INTENT_TIMEOUT)
        wall = int((time.monotonic() - t0) * 1000)
        got = None if (r.is_fallback or r.value is None) else r.value.intent.value
        ok = got in (None, "OUT_OF_SCOPE") if label == "OUT_OF_SCOPE" else got == label
        slots = dict(r.value.slots) if got else {}
        return dict(label=label, utt=utt, kind=kind, got=got, ok=ok, slots=slots, err=r.error, wall=wall, **_usage(r))

    rows = _run(one, cases * repeat)

    def acc(kind):
        sel = [r for r in rows if r["kind"] == kind]
        return round(sum(r["ok"] for r in sel) / len(sel), 4)

    print(json.dumps(dict(prompts=str(prompts), model=MODEL, n=len(rows), eval_acc=acc("eval"),
                          context_acc=acc("context"), **_timing(rows)), ensure_ascii=False))
    for r in rows:
        if not r["ok"]:
            print(f"  ✗ {r['label']:<20} got={r['got']!s:<20} {r['utt']}  ({r['err'] or ''})")
    for r in rows[: len(cases)]:
        if r["kind"] == "context":
            print(f"  · {r['utt']} → {r['got']} {r['slots']}")


# ───────── answer ─────────

def _place(name: str, category: str, **kw) -> dict:
    return {"name": name, "category": category, "hours_label": kw.get("hours"), "fee": kw.get("fee"),
            "distance_range": kw.get("dist"), "reason": kw.get("reason")}


def _facts(intent: str, *, status: str = "OK", rows=(), places=(), notes=(), **detail) -> dict:
    # Facts.to_prompt_dict 모양 — dialogue_handlers.Facts
    return {"intent": intent, "status": status, "needs_trip": False, "rows": [dict(label=a, value=b) for a, b in rows],
            "places": list(places), "notes": list(notes), **detail}


_DAY = [{"name": "동궁과월지", "start_at": "10:00", "category": "명소"},
        {"name": "교리김밥", "start_at": "12:30", "category": "맛집"},
        {"name": "국립경주박물관", "start_at": "14:00", "category": "박물관"},
        {"name": "황리단길", "start_at": "16:30", "category": "쇼핑"}]
_SCHEDULE = dict(rows=[("10월 19일", "4곳")], scope="ALL", days=[{"date": "2026-10-19", "slots": _DAY}])
ANSWER_CASES = [
    ("SHOW_SCHEDULE", "오늘 일정 순서대로 알려줘", _facts("SHOW_SCHEDULE", **_SCHEDULE)),
    ("SHOW_SCHEDULE", "오후엔 뭐 있어?", _facts("SHOW_SCHEDULE", **_SCHEDULE)),
    ("GET_NEXT_SLOT", "다음 어디 가?", _facts(
        "GET_NEXT_SLOT", rows=[("계획 시각", "14:00")], places=[_place("국립경주박물관", "박물관")],
        next={"date": "2026-10-19", "name": "국립경주박물관", "start_at": "14:00", "category": "박물관"})),
    ("GET_POI_INFO", "거기 월요일에 열어?", _facts(
        "GET_POI_INFO", rows=[("분류", "박물관"), ("영업시간", "10:00~18:00 · 1월 1일 휴무"), ("입장료", "무료")],
        places=[_place("국립경주박물관", "박물관", hours="10:00~18:00 · 1월 1일 휴무", fee=0)])),
    ("GET_POI_INFO", "그 카페 몇 시까지 해?", _facts(
        "GET_POI_INFO", rows=[("분류", "카페"), ("영업시간", "미확인"), ("입장료", "미확인")],
        places=[_place("카페 오늘", "카페")])),
    ("GET_WEATHER", "내일 비 와?", _facts("GET_WEATHER", status="UNAVAILABLE", notes=["날씨 미확인"])),
    ("GET_WEATHER", "오후에 비 온대?", _facts(
        "GET_WEATHER", rows=[("하늘", "흐림"), ("강수확률", "60%"), ("기온", "14~19℃")])),
    ("GET_DISTANCE", "여기서 박물관까지 멀어?", _facts(
        "GET_DISTANCE", rows=[("직전 구간", "1~2km")],
        places=[_place("교리김밥", "맛집"), _place("국립경주박물관", "박물관", dist="1~2km")])),
    ("SUGGEST_ALTERNATIVE", "박물관 말고 다른 데 없어?", _facts(
        "SUGGEST_ALTERNATIVE", target="국립경주박물관",
        places=[_place("경주 대릉원", "명소", reason="신라 왕릉이 모인 넓은 고분 공원", dist="1km 이내"),
                _place("첨성대", "명소", reason="신라 시대 천문대 유적", dist="1km 이내")])),
]


def run_answer(prompts: Path, repeat: int) -> None:
    worker = DialogueAnswerWorker(_gateway(prompts, LlmFeature.DIALOGUE_ANSWER, DialogueAnswerGate()))

    def one(item):
        i, (intent, utt, facts) = item
        t0 = time.monotonic()
        r = worker.compose(Intent(intent), facts, utt, [], [], TRIP, TraceId(f"ab-{i}"), datetime.now(timezone.utc),
                           timeout_sec=ANSWER_TIMEOUT)
        wall = int((time.monotonic() - t0) * 1000)
        text = None if (r.is_fallback or r.value is None) else f"{r.value.text} {r.value.footnote or ''}".strip()
        bad_pair = bool(text) and orch._misplaced_time(text, orch._slot_times(facts))
        return dict(intent=intent, utt=utt, text=text, bad_pair=bad_pair, err=r.error, wall=wall, **_usage(r))

    rows = _run(one, ANSWER_CASES * repeat)
    print(json.dumps(dict(prompts=str(prompts), model=MODEL, n=len(rows),
                          gate_pass=round(sum(1 for r in rows if r["text"]) / len(rows), 4),
                          pair_violation=sum(r["bad_pair"] for r in rows), **_timing(rows)), ensure_ascii=False))
    for r in rows:
        mark = "✗" if not r["text"] or r["bad_pair"] else " "
        print(f" {mark} [{r['intent']}] {r['utt']} → {r['text'] or r['err']}")


# ───────── directive ─────────

# (발화, 정답, 고르면 안 되는 지시) — 평가 문장은 프롬프트 예시와 겹치지 않는다
DIRECTIVE_EXTRA = [
    ("쇼핑은 이제 됐고 바다 보러 가자", {"NATURE_FOCUS"}, {"SHOPPING_FOCUS"}),
    ("야경은 별로야, 일찍 들어갈래", {"SHORTER_DAY"}, {"NIGHT_VIEW"}),
    ("박물관 같은 실내는 지겨워, 바깥으로", {"OUTDOOR"}, {"INDOOR", "CULTURE_FOCUS"}),
    ("배는 안 고파, 커피나 한잔", {"ADD_CAFE"}, {"ADD_FOOD"}),
    ("오늘 너무 많이 걸었어", {"LESS_MOVE"}, set()),
    ("체험은 됐고 그냥 쉬고 싶어", {"RELAX"}, {"ACTIVITY_FOCUS"}),
]


def run_directive(prompts: Path, repeat: int) -> None:
    import measure_directive_match as mdm  # 같은 디렉토리 — 라벨 한 벌을 두 측정이 같이 쓴다

    from trippilot.agents.planb.directives import load_directive_file
    from trippilot.llm_gateway.gates.replan_directive_translation import ReplanDirectiveTranslationGate
    from trippilot.llm_gateway.workers.replan_directive_translation import (
        DirectiveTranslationInput, ReplanDirectiveTranslationWorker, options_from)

    options = options_from(load_directive_file(_AI_ROOT / "data/replan_directives.yaml", yaml.safe_load))
    worker = ReplanDirectiveTranslationWorker(
        _gateway(prompts, LlmFeature.REPLAN_DIRECTIVE_TRANSLATION, ReplanDirectiveTranslationGate()))
    cases = ([(t, w, set()) for t, w in mdm.POSITIVES] + [(t, set(), None) for t in mdm.NEGATIVES]
             + DIRECTIVE_EXTRA)

    def one(item):
        i, (utt, want, forbid) = item
        t0 = time.monotonic()
        r = worker.translate(DirectiveTranslationInput(utt, options), TraceId(f"ab-{i}"),
                             datetime.now(timezone.utc), timeout_sec=3.75)
        wall = int((time.monotonic() - t0) * 1000)
        got = set() if (r.is_fallback or r.value is None) else set(r.value.keys)
        infra = bool(r.error) and "timeout" in r.error
        lenient = (not got if forbid is None else want <= got and not got & forbid) and not infra
        return dict(utt=utt, want=want, got=got, exact=got == want and not infra, lenient=lenient,
                    err=r.error, wall=wall, **_usage(r))

    rows = _run(one, cases * repeat)
    print(json.dumps(dict(prompts=str(prompts), model=MODEL, n=len(rows),
                          exact=round(sum(r["exact"] for r in rows) / len(rows), 4),
                          lenient=round(sum(r["lenient"] for r in rows) / len(rows), 4), **_timing(rows)),
                     ensure_ascii=False))
    for r in rows:
        if not r["exact"]:
            print(f"  {'~' if r['lenient'] else '✗'} {r['utt']}  want={sorted(r['want'])} got={sorted(r['got'])}"
                  f" {r['err'] or ''}")


# ───────── scoring ─────────

SCORE_MODEL = os.environ.get("EVAL_SCORE_MODEL", "gpt-5.6-sol")
SCORE_TIMEOUT = float(os.environ.get("EVAL_SCORE_TIMEOUT", "14.0"))
_SCORE_REGION = "해운대구"
_SCORE_NAMES = (
    "해운대 동백섬", "장산 (부산 국가지질공원)", "해운대 그린레일웨이 (미포~송정 구간)", "미포항", "해운대 수목원",
    "장산산림욕장", "해운대해수욕장",
    "달맞이동산", "동백공원", "부산광안대교", "씨라이프부산아쿠아리움", "해운대리버크루즈", "해운대온천센터", "옥천사",
    "해리단길",
    "문탠로드", "센텀시티 아이스링크", "송정서핑학교", "멜트", "오버플로우", "펫낫", "해운대블루라인파크 청사포정거장",
    "청사포 기찻길", "더베이101", "부산엑스더스카이",
    "부산시립미술관", "조현화랑", "이우환 공간", "누리마루 APEC하우스", "책방봄봄", "해운대문화회관", "갤러리이알디 부산",
    "반송187", "수월경화", "스노잉클라우드", "아델라7", "엣지993", "원시학", "프루터리포레스트",
    "거대갈비", "구로마쯔", "류센소 본점", "라꽁띠", "송정물총칼국수", "양산국밥", "싱싱뽈락회 해운대본점", "솔내음한정식",
    "문토스트", "부우사안",
    "신세계백화점 센텀시티점", "해운대 로데오거리", "좌동재래시장", "그라핀",
)
_PERSONAS = {
    "자연·조용·부모님": PersonaSummary(
        taste_tags=(TasteTag.NATURE, TasteTag.REST), companion=CompanionType.PARENTS, budget=BudgetLevel.MID,
        activities=("자연", "역사문화"), cuisines=("한식",)),
    "카페·전시·커플": PersonaSummary(
        taste_tags=(TasteTag.CITY,), companion=CompanionType.COUPLE, budget=BudgetLevel.MID,
        activities=("카페", "전시"), cuisines=("양식",)),
    "맛집·야경·친구": PersonaSummary(
        taste_tags=(TasteTag.FOOD, TasteTag.ACTIVITY), companion=CompanionType.FRIENDS, budget=BudgetLevel.MID,
        activities=("맛집투어", "야경"), cuisines=("한식", "일식")),
}
# 사람이 봐도 명백한 상위·하위 — 상위 4곳 × 하위 4곳 = 16쌍이 전부 상위 > 하위여야 한다(동점은 0.5).
_ANCHORS = {
    "자연·조용·부모님": (("해운대 동백섬", "해운대 수목원", "해운대 그린레일웨이 (미포~송정 구간)", "장산산림욕장"),
                       ("멜트", "오버플로우", "펫낫", "송정서핑학교")),
    "카페·전시·커플": (("엣지993", "스노잉클라우드", "이우환 공간", "부산시립미술관"),
                     ("장산 (부산 국가지질공원)", "좌동재래시장", "양산국밥", "옥천사")),
    "맛집·야경·친구": (("더베이101", "부산엑스더스카이", "거대갈비", "류센소 본점"),
                     ("조현화랑", "책방봄봄", "갤러리이알디 부산", "옥천사")),
}


def _score_pois() -> list[Poi]:
    data = json.loads((_AI_ROOT / "data/collected_pois.json").read_text(encoding="utf-8"))
    found: dict[str, Poi] = {}
    for prop in data["proposals"]:
        name = prop["poi"]["name"]
        if prop.get("region") == _SCORE_REGION and name in _SCORE_NAMES and name not in found:
            found[name] = Poi.from_dict(prop["poi"])
    missing = set(_SCORE_NAMES) - found.keys()
    assert not missing, f"collected_pois.json 에 없음: {missing}"
    return [found[n] for n in _SCORE_NAMES]


def _salted_pool(pois: list[Poi], salt: int) -> tuple[CandidatePool, dict[str, str]]:
    # 운영 poiId 는 백엔드 uuid — 출력 토큰(건당 ~34)이 같으려면 모양도 같아야 한다. 소금이 정렬 순서를 바꿔
    # plan_chunks 가 다른 묶음을 만든다.
    ided = [replace(p, poi_id=PoiId(str(uuid.uuid5(uuid.NAMESPACE_URL, f"{salt}:{p.name}")))) for p in pois]
    pool = CandidatePool(poi_ids=frozenset(p.poi_id for p in ided), pois=tuple(ided),
                         generated_at=datetime.now(timezone.utc))
    return pool, {str(p.poi_id): p.name for p in ided}


def _spearman(a: list[float], b: list[float]) -> float | None:
    def ranks(xs):
        order = sorted(range(len(xs)), key=lambda i: xs[i])
        r = [0.0] * len(xs)
        i = 0
        while i < len(order):  # 동점은 평균 순위
            j = i
            while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2
            i = j + 1
        return r
    try:
        return statistics.correlation(ranks(a), ranks(b))
    except statistics.StatisticsError:  # 한쪽이 전부 같은 값
        return None


def _avg(xs) -> float | None:
    xs = list(xs)
    return round(statistics.mean(xs), 4) if xs else None


def run_scoring(prompts: Path, compositions: int) -> None:
    assert compositions >= 2, "청크 구성이 2가지 이상이라야 흔들림을 잰다"
    gw = _gateway(prompts, LlmFeature.PREFERENCE_SCORING, ClosedSetGate(), model=SCORE_MODEL)
    cfg = gw.config
    # 워커와 같은 분할 — 단계 예산 → 청크 크기(adaptive_chunk_size) → poi_id 정렬 균등 분할(plan_chunks)
    size = adaptive_chunk_size(SCORE_TIMEOUT * 1000.0, cfg)
    pois = _score_pois()
    cases = []
    for comp in range(compositions):
        # EVAL_SCORE_SAME_SPLIT=1 — 같은 구성을 되풀이한다(샘플링 노이즈 바닥). 이 값보다 큰 흔들림만 묶음 탓이다.
        pool, back = _salted_pool(pois, 0 if os.environ.get("EVAL_SCORE_SAME_SPLIT") else comp)
        for chunk in plan_chunks(pool, size, cfg.score_max_parallel, chunk_max=score_chunk_cap(cfg)):
            cases += [(key, comp, chunk, back) for key in _PERSONAS]

    def one(item):
        i, (key, comp, chunk, back) = item
        t0 = time.monotonic()
        r = gw.call(LlmFeature.PREFERENCE_SCORING, build_prompt_vars(chunk, _PERSONAS[key]), chunk,
                    TraceId(f"ab-{i}"), datetime.now(timezone.utc), timeout_sec=SCORE_TIMEOUT)
        wall = int((time.monotonic() - t0) * 1000)
        scores = {} if r.is_fallback else {back[str(sp.poi_id)]: sp.score for sp in r.value or ()}
        return dict(key=key, comp=comp, n=len(chunk.pois), scores=scores, err=r.error, wall=wall, **_usage(r))

    rows = _run(one, cases)
    table: dict[tuple[str, int], dict[str, float]] = defaultdict(dict)
    for r in rows:
        table[(r["key"], r["comp"])].update(r["scores"])

    stds, rhos, pairs, lines = [], [], [], []
    for key in _PERSONAS:
        comps = [table[(key, c)] for c in range(compositions)]
        spread = {n: statistics.pstdev(v) for n in _SCORE_NAMES
                  if len(v := [c[n] for c in comps if n in c]) > 1}
        rho = [x for a, b in itertools.combinations(comps, 2)
               if (common := sorted(a.keys() & b.keys()))
               and (x := _spearman([a[n] for n in common], [b[n] for n in common])) is not None]
        top, bottom = _ANCHORS[key]
        pair = [1.0 if c[t] > c[b] else 0.5 if c[t] == c[b] else 0.0
                for c in comps for t in top for b in bottom if t in c and b in c]
        stds += spread.values()
        rhos += rho
        pairs += pair
        worst = sorted(spread, key=spread.get, reverse=True)[:4]
        lines.append(f"  [{key}] std={_avg(spread.values())} rho={_avg(rho)} pair={_avg(pair)} 흔들림 상위: "
                     + ", ".join(f"{n}={[c.get(n) for c in comps]}" for n in worst))

    print(json.dumps(dict(
        prompts=str(prompts), model=SCORE_MODEL, calls=len(rows), chunk_size=size,
        std_mean=_avg(stds), spearman_mean=_avg(rhos), pair_acc=_avg(pairs),
        gate_pass=round(sum(1 for r in rows if r["scores"]) / len(rows), 4),
        complete=round(sum(1 for r in rows if len(r["scores"]) == r["n"]) / len(rows), 4),
        over_budget=sum(1 for r in rows if r["wall"] > SCORE_TIMEOUT * 1000), **_timing(rows)), ensure_ascii=False))
    print("\n".join(lines))
    for r in rows:
        if r["err"]:
            print(f"  ✗ [{r['key']}] 구성{r['comp']} {r['n']}건 → {r['err']}")
    # 원자료 — 지표를 다시 셀 때 실 호출을 되풀이하지 않도록
    print("RAW " + json.dumps({f"{k}|{c}": v for (k, c), v in table.items()}, ensure_ascii=False))


RUNNERS = {"intent": run_intent, "answer": run_answer, "directive": run_directive, "scoring": run_scoring}

if __name__ == "__main__":
    kind, prompts = sys.argv[1], Path(sys.argv[2])
    RUNNERS[kind](prompts, int(sys.argv[3]) if len(sys.argv) > 3 else 1)
