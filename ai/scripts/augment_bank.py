"""질문뱅크 증강 — seed 문장에서 변형을 만들어 기계 필터를 통과한 것만 제안한다 (§3.2 ② Augment).
CI 밖 수동 실행 전용.

**왜 필요한가**: 1차 미달의 원인은 뱅크의 자리표시자가 아니라 **표현 다양성 부족**이다
(TRIP-840 실측 — "성산일출봉 몇 시까지 열어?" 가 뱅크 "{장소} 영업시간 알려줘" 와 0.577).
의도당 9~12문장으로는 사용자가 쓰는 말을 못 덮는다. 설계 §3.2 는 seed 당 변형 5~10개,
목표 500~1,000문장을 규정하는데 한 번도 수행된 적이 없다.

**사람 검수는 예외만**: 설계 §3.2 는 "생성 후 사람 검수 필수" 라고 적었지만, 그대로 하면
수백 줄을 전수로 봐야 해 실행이 안 된다(209줄도 힘들었다). 그래서 **기계가 확실한 것은 자동
채택하고 애매한 것만 사람에게 올린다** — 팀 결정 2026-09-14. 자동 채택 기준은 아래 네 관문을
전부 통과하고 margin 이 충분한 것뿐이고, 하나라도 걸리면 사람이 본다.

관문 (순서대로, 먼저 걸리면 그 사유로 기각):
  ① 형태     — 게이트(ParaphraseGate)가 거부한 것, 빈 문자열, 원문과 동일, 자리표시자 소실
  ② 자기중복 — 같은 의도 안에서 기존·신규와 ≥ dup 이면 버린다 (뱅크만 불리고 이득 없음)
  ③ 타 의도  — 다른 의도 문장과 ≥ 0.90 이면 편입 거부 (§3.3 위생 규칙)
  ④ 평가셋   — 평가 발화(자리표시자를 채운 변형 포함)와 ≥ 0.90 이면 leak (§6)
  ⑤ margin   — (같은 의도 최근접 − 다른 의도 최근접) ≥ auto 면 자동 채택, 아니면 사람 검수 대기

산출은 **제안 파일**이다(`data/intent_bank_augment_<날짜>.yaml`). 뱅크에 바로 쓰지 않는다 —
검수 대기분을 사람이 본 뒤 `--apply` 로 합친다.

실행:
    cd ai
    LLM_PROVIDER=mixed uv run --env-file ../.env python scripts/augment_bank.py --per-seed 3
    # 특정 의도만 / 자동 채택 문턱 조정
    ... python scripts/augment_bank.py --intents GET_POI_INFO,GET_DISTANCE --auto-margin 0.06

환경변수: LLM_PROVIDER 등 smoke_llm.py 와 동일. 임베딩은 local KURE(scripts/local_embedding.py).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

import yaml

_AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_AI_ROOT))
sys.path.insert(0, str(_AI_ROOT / "scripts"))

from local_embedding import build_local_embedding  # noqa: E402
from smoke_llm import _build_adapter  # noqa: E402
from tests.fakes.in_memory_trace import InMemoryTrace  # noqa: E402
from trippilot.domain.common import TraceId  # noqa: E402
from trippilot.domain.intent import Intent  # noqa: E402
from trippilot.domain.llm import LlmFeature, ModelTier  # noqa: E402
from trippilot.llm_gateway.config import C1Config  # noqa: E402
from trippilot.llm_gateway.feature_model_env import ENV_VAR, feature_models_from_env  # noqa: E402
from trippilot.llm_gateway.gates.paraphrase import ParaphraseGate  # noqa: E402
from trippilot.llm_gateway.gateway import GatewayFacade  # noqa: E402
from trippilot.llm_gateway.prompts import PromptRegistry  # noqa: E402

_BANK = _AI_ROOT / "data" / "intent_question_bank.yaml"
_EVAL = _AI_ROOT / "data" / "intent_eval_set.yaml"
_PROMPTS = _AI_ROOT / "prompts"
_PLACEHOLDER = ("{장소}", "{지역}", "{날짜}", "{기간}")
# 평가셋 leak 검사용 — trace_intents 와 같은 대표값(평가셋·뱅크 토큰과 겹치지 않게 고른 것)
_FILLS = {"{장소}": "경복궁", "{지역}": "여수", "{날짜}": "글피", "{기간}": "4박 5일"}

# 의도 뜻 — 프롬프트에 실어 "같은 요청"의 기준을 준다. 정본: orchestrator-delegation-design §5
# 라우팅 표 + domain/intent.py. 검수 페이지에 쓴 설명과 같은 문장이다.
_DESC = {
    "GENERATE_SCHEDULE": "여행 일정을 새로 만들어 달라는 요청",
    "REGENERATE": "이미 있는 일정을 통째로 버리고 새로 만들어 달라는 요청",
    "REPLAN": "여행 중 사고(비·휴무·지연 등)로 남은 일정을 다시 짜 달라는 요청",
    "SUGGEST_ALTERNATIVE": "장소 한 곳을 대신할 다른 곳을 추천해 달라는 요청 (일정 구조는 그대로)",
    "GENERATE_REFLECTION": "하루치 회고·일기를 써 달라는 요청",
    "TRIP_SUMMARY": "여행 전체를 요약·정리해 달라는 요청",
    "STYLE_ANALYSIS": "사용자의 여행 취향·성향을 분석해 달라는 요청",
    "EDIT_SCHEDULE": "일정의 특정 항목을 추가·삭제·이동·교체해 달라는 요청",
    "GET_NEXT_SLOT": "다음에 갈 한 곳이 어디인지 묻는 질문",
    "SHOW_SCHEDULE": "이미 있는 일정을 보여 달라는 요청",
    "GET_WEATHER": "날씨를 묻는 질문",
    "GET_DISTANCE": "두 지점 사이 거리를 묻는 질문 (소요시간이 아니라 거리)",
    "GET_POI_INFO": "장소 정보(영업시간·입장료·휴무·주차 등)를 묻는 질문",
}


def _cos(a, b) -> float:
    d = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return d / (na * nb) if na and nb else 0.0


def _fill(text: str) -> str:
    for k, v in _FILLS.items():
        text = text.replace(k, v)
    return text


def _build_gateway():
    provider = os.environ.get("LLM_PROVIDER", "openai")
    llm, model_id = _build_adapter(provider)
    raw = os.environ.get(ENV_VAR) or os.environ.get("AI_LLM_FEATURE_MODELS")
    feature_models = dict(feature_models_from_env(raw)) if raw else {}
    if provider != "mixed":  # 도달 못 하는 배정은 빼야 벤더 404 가 측정을 오염시키지 않는다
        def ok(m: str) -> bool:
            claude = m.lower().startswith("claude")
            return claude if provider == "anthropic" else not claude
        feature_models = {f: m for f, m in feature_models.items() if ok(m)}
    cfg = C1Config(
        model_ids={ModelTier.LIGHT: model_id, ModelTier.HEAVY: model_id},
        feature_models=feature_models,
        timeout_sec=float(os.environ.get("AUGMENT_TIMEOUT_SEC") or 60),
    )
    used = feature_models.get(LlmFeature.BANK_AUGMENT, model_id)
    return GatewayFacade(llm, PromptRegistry(_PROMPTS), ParaphraseGate(), cfg,
                         InMemoryTrace()), used


def _rivals_for(intent: str, entries, vecs, emb, k: int = 3) -> list[str]:
    """프롬프트에 실을 '가까운 다른 의도' 문장 — 생성 단계에서 경계를 피하게 한다."""
    mine = [v for (it, _), v in zip(entries, vecs) if it == intent]
    if not mine:
        return []
    scored = []
    for (it, q), v in zip(entries, vecs):
        if it == intent:
            continue
        scored.append((max(_cos(v, m) for m in mine), it, q))
    scored.sort(reverse=True)
    return [f"    - [{it}] {q}" for _, it, q in scored[:k]]


def _apply(proposal: Path, also_pending: set[str]) -> int:
    """제안 파일의 자동채택분(+승인된 검수대기분)을 뱅크의 `augmented:` 목록에 합친다.

    yaml 로 통째로 다시 쓰지 않는다 — 뱅크 파일의 머리 주석·의도별 근거 주석이 전부 날아간다.
    그래서 텍스트로 열어 각 의도 블록 끝에 줄을 끼워 넣는다.
    """
    doc = yaml.safe_load(proposal.read_text(encoding="utf-8"))
    add: dict[str, list[str]] = {}
    for intent, items in (doc.get("accepted") or {}).items():
        add.setdefault(intent, []).extend(x["question"] for x in items)
    for intent, items in (doc.get("pending") or {}).items():
        picked = [x["question"] for x in items if x["question"] in also_pending]
        if picked:
            add.setdefault(intent, []).extend(picked)
    if not add:
        raise SystemExit("합칠 문장이 없다")

    lines = _BANK.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    cur: str | None = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("- intent:"):
            cur = stripped.split(":", 1)[1].strip()
        # 의도 블록의 끝 = 다음 `- intent:` 직전의 마지막 비어있지 않은 줄 뒤
        nxt = next((l for l in lines[i + 1:] if l.strip()), None)
        ends_block = cur in add and (nxt is None or nxt.strip().startswith("- intent:"))
        out.append(line)
        if ends_block and stripped:
            out.append("    # ↓ §3.2 ② 증강분 — LLM 생성 후 기계 관문 통과분 (scripts/augment_bank.py).")
            out.append(f"    #   제안 파일: {proposal.name}")
            out.append("    augmented:")
            out.extend(f'      - "{q}"' for q in add[cur])
            cur = None
    _BANK.write_text("\n".join(out) + "\n", encoding="utf-8")
    total = sum(len(v) for v in add.values())
    print(f"뱅크에 {total}문장 추가 — 의도별 " +
          " · ".join(f"{k} {len(v)}" for k, v in sorted(add.items())))
    return total


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    p.add_argument("--apply", type=Path, metavar="제안파일",
                   help="생성하지 않고, 이미 만든 제안 파일의 자동채택분을 뱅크에 합친다")
    p.add_argument("--approve", default="",
                   help="--apply 와 함께: 검수대기분 중 승인할 문장을 || 로 구분해 나열")
    p.add_argument("--per-seed", type=int, default=3, help="seed 문장당 생성 개수")
    p.add_argument("--intents", help="쉼표로 구분한 의도 목록 (기본: 전부)")
    p.add_argument("--auto-margin", type=float, default=0.05,
                   help="이 값 이상이면 자동 채택, 미만이면 사람 검수 대기")
    p.add_argument("--dup", type=float, default=0.95, help="같은 의도 안 중복 판정 임계")
    p.add_argument("--cross", type=float, default=0.90, help="타 의도 근접 거부 임계 (§3.3)")
    p.add_argument("--leak", type=float, default=0.90, help="평가셋 leak 거부 임계 (§6)")
    p.add_argument("--out", type=Path, help="제안 파일 경로 (기본: data/intent_bank_augment_<날짜>.yaml)")
    args = p.parse_args()
    if args.apply:
        approved = {s for s in (x.strip() for x in args.approve.split("||")) if s}
        _apply(args.apply, approved)
        return 0

    bank = yaml.safe_load(_BANK.read_text(encoding="utf-8"))
    ev = yaml.safe_load(_EVAL.read_text(encoding="utf-8"))
    entries = [(g["intent"], q) for g in bank["intents"] for q in g["questions"]]
    targets = set(args.intents.split(",")) if args.intents else {g["intent"] for g in bank["intents"]}
    unknown = targets - {g["intent"] for g in bank["intents"]}
    if unknown:
        raise SystemExit(f"모르는 의도: {sorted(unknown)}")

    emb = build_local_embedding()
    vecs = emb.embed_batch([q for _, q in entries])
    eval_texts = [u for c in ev["cases"] for u in c["utterances"]]
    eval_vecs = emb.embed_batch(eval_texts)
    # 자리표시자를 채운 뱅크 변형도 leak 비교 대상 — 실명 발화와 원문은 0.2~0.35 낮게 나온다
    filled = [(q, _fill(q)) for _, q in entries if any(ph in q for ph in _PLACEHOLDER)]

    gateway, model = _build_gateway()
    print(f"뱅크 {len(entries)}문장 v{bank['version']} · 의도 {len(targets)}종 · "
          f"seed 당 {args.per_seed} · 모델 {model} · 자동채택 margin ≥ {args.auto_margin}")

    accepted: dict[str, list[dict]] = {}
    pending: dict[str, list[dict]] = {}
    rejected: list[tuple[str, str, str]] = []
    # 살아 있는 문장 벡터 — 채택될 때마다 늘려 신규끼리의 중복도 잡는다
    live = [(it, q, v) for (it, q), v in zip(entries, vecs)]

    for gi, group in enumerate(bank["intents"]):
        intent = group["intent"]
        if intent not in targets:
            continue
        rivals = _rivals_for(intent, entries, vecs, emb)
        for seed in list(group["questions"]):
            result = gateway.call(
                LlmFeature.BANK_AUGMENT,
                {"utterance": seed, "count": str(args.per_seed), "intent": intent,
                 "intent_desc": _DESC.get(intent, intent),
                 "rivals": "\n".join(rivals) or "    (없음)"},
                None, TraceId(f"augment-{gi}"), datetime.now(UTC),
            )
            if result.is_fallback:
                rejected.append((intent, seed, f"생성 실패: {result.error}"))
                continue
            for cand in result.value or ():
                cand = str(cand).strip()
                reason = None
                if not cand or cand == seed:
                    reason = "빈 문자열 또는 원문과 동일"
                elif any(ph in seed and ph not in cand for ph in _PLACEHOLDER):
                    reason = "자리표시자 소실"
                if reason:
                    rejected.append((intent, cand, reason))
                    continue
                v = emb.embed(cand)
                same = [(_cos(v, lv), lq) for lit, lq, lv in live if lit == intent]
                other = [(_cos(v, lv), lit, lq) for lit, lq, lv in live if lit != intent]
                best_same = max(same, default=(0.0, "-"))
                best_other = max(other, default=(0.0, "-", "-"))
                leak = max(
                    [(_cos(v, e), t) for e, t in zip(eval_vecs, eval_texts)]
                    + [(_cos(v, emb.embed(f)), f"{orig} (채운 변형)") for orig, f in filled],
                    default=(0.0, "-"),
                )
                if best_same[0] >= args.dup:
                    rejected.append((intent, cand, f"같은 의도 중복 {best_same[0]:.3f} “{best_same[1]}”"))
                    continue
                if best_other[0] >= args.cross:
                    rejected.append((intent, cand,
                                     f"타 의도 근접 {best_other[0]:.3f} [{best_other[1]}] “{best_other[2]}”"))
                    continue
                if leak[0] >= args.leak:
                    rejected.append((intent, cand, f"평가셋 leak {leak[0]:.3f} “{leak[1]}”"))
                    continue
                item = {
                    "question": cand, "seed": seed,
                    "margin": round(best_same[0] - best_other[0], 3),
                    "same": round(best_same[0], 3), "same_q": best_same[1],
                    "other": round(best_other[0], 3), "other_intent": best_other[1],
                    "other_q": best_other[2], "leak": round(leak[0], 3),
                }
                bucket = accepted if item["margin"] >= args.auto_margin else pending
                bucket.setdefault(intent, []).append(item)
                live.append((intent, cand, v))
        n_a, n_p = len(accepted.get(intent, [])), len(pending.get(intent, []))
        print(f"  {intent:22} 자동 {n_a:3} · 검수대기 {n_p:3}")

    out = args.out or _AI_ROOT / "data" / f"intent_bank_augment_{datetime.now(UTC):%Y%m%d}.yaml"
    doc = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source_bank_version": bank["version"],
        "model": model,
        "gates": {"dup": args.dup, "cross": args.cross, "leak": args.leak,
                  "auto_margin": args.auto_margin, "per_seed": args.per_seed},
        "accepted": accepted, "pending": pending,
        "rejected": [{"intent": i, "question": q, "reason": r} for i, q, r in rejected],
    }
    out.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
    total_a = sum(len(v) for v in accepted.values())
    total_p = sum(len(v) for v in pending.values())
    print(f"\n자동 채택 {total_a} · 검수 대기 {total_p} · 기각 {len(rejected)}  →  {out}")
    if rejected:
        by_reason: dict[str, int] = {}
        for _, _, r in rejected:
            by_reason[r.split(" ")[0] + " " + r.split(" ")[1] if " " in r else r] = \
                by_reason.get(r.split(" ")[0] + " " + r.split(" ")[1] if " " in r else r, 0) + 1
        print("기각 사유: " + " · ".join(f"{k} {v}" for k, v in sorted(by_reason.items())))
    print(json.dumps({"accepted": total_a, "pending": total_p, "rejected": len(rejected)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
