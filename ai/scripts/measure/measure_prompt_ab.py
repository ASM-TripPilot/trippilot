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
- `answer`  DIALOGUE_ANSWER — Facts 9종 × 반복. 게이트 통과율·시각-장소 짝 위반(오케스트레이터 INV-2 검사와
  같은 함수)·지연. 문장은 끝에 전부 찍는다 — 지어낸 사실은 사람이 읽어서 본다.

모델·시한은 운영 배정(.env.example 의 DIALOGUE_* = gpt-5.6-luna, BLM 시한표 분류 4.0s·답변 3.5s)이 기본이다.
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

import openai  # noqa: E402
import yaml  # noqa: E402

from trippilot.domain.common import TraceId  # noqa: E402
from trippilot.domain.intent import Intent  # noqa: E402
from trippilot.domain.llm import LlmFeature, ModelTier  # noqa: E402
from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter  # noqa: E402
from trippilot.llm_gateway.config import C1Config  # noqa: E402
from trippilot.llm_gateway.gates.dialogue_answer import DialogueAnswerGate  # noqa: E402
from trippilot.llm_gateway.gates.intent import IntentGate  # noqa: E402
from trippilot.llm_gateway.gateway import GatewayFacade  # noqa: E402
from trippilot.llm_gateway.prompts import PromptRegistry  # noqa: E402
from trippilot.llm_gateway.workers.dialogue_answer import DialogueAnswerWorker  # noqa: E402
from trippilot.llm_gateway.workers.dialogue_intent import DialogueIntentWorker  # noqa: E402
from trippilot.orchestrator import dialogue_orchestrator as orch  # noqa: E402

MODEL = os.environ.get("EVAL_MODEL", "gpt-5.6-luna")
INTENT_TIMEOUT = float(os.environ.get("EVAL_INTENT_TIMEOUT", "4.0"))
ANSWER_TIMEOUT = float(os.environ.get("EVAL_ANSWER_TIMEOUT", "3.5"))
TRIP = "경주 2박 3일 · 2일차 진행 중"
_AI_ROOT = Path(__file__).resolve().parents[2]


class _NullTrace:
    def emit(self, event) -> None:
        pass


def _gateway(prompts: Path, feature: LlmFeature, gate) -> GatewayFacade:
    # SDK 재시도 0 — 운영 어댑터와 같은 정책이라야 지연이 왜곡되지 않는다(TRIP-381)
    llm = OpenAIAdapter(openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"], max_retries=0), api="responses")
    cfg = C1Config(model_ids={t: MODEL for t in ModelTier}, feature_models={feature: MODEL})
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


RUNNERS = {"intent": run_intent, "answer": run_answer}

if __name__ == "__main__":
    kind, prompts = sys.argv[1], Path(sys.argv[2])
    RUNNERS[kind](prompts, int(sys.argv[3]) if len(sys.argv) > 3 else 1)
