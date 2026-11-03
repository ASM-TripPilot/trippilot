r"""다시 짜기 '문서 몫' 효과 측정 — 구성 후보(규칙 40곳)에 KB-5 문서가 상황에 맞는 곳을 더했을 때.

**2026-11-02 결론: 효과 없음 → 운영에 넣지 않았다.** 사용자 질문("후보를 고르는 단계에서 문서를 쓰되 편향 없이")에 대한
권장안(규칙 후보는 그대로 두고 문서 검색으로 찾은 곳을 따로 +8)을 기본 꺼짐으로 구현해 쟀다. 측정 뒤 운영 코드는 빼고 이 러너만 남긴다
(문서 몫 고르기는 아래 `_runners_up`·`_rank_by_knowledge` 에 운영 함수와 같은 규칙으로 있다).
- `ab` 1회(6도시 × 4상황 = 24, 구성 claude-opus-5-5 · 판정 claude-sonnet-5, 운영 질의): **문서 몫 7 · 기존 5 · 같음 12 / 24**.
  같은 입력끼리도 ≈12:7 로 흔들리는 범위다 — 제주 두 건은 두 목록이 똑같은데 문서 몫 승으로 나왔다.
- 더한 곳을 구성 LLM 이 고른 비율 **8/192(4%)**. 지연 p50 6.5 → 6.9s, 입력 토큰 증가.
- 왜 안 되나: 문서 검색이 상황에 맞는 곳을 못 찾는다. 비 오는 날 질의에 숭례문·용두암·삼청공원(야외), "조용한 북카페"에
  라멘집·갈빗집이 뽑혔다. 질의를 사용자 말·사유의 필요로만 바꿔도(`EVAL_DOC_QUERY=need`) 비슷했다. KURE 유사도가 "실내"
  같은 속성을 장소 설명에서 가르지 못한다 — 후보 선정에는 글 검색보다 장소별 사실 칸(실내외·유모차·반려·여행코스)이 맞다.

**2026-11-03 여행코스 가산(`EVAL_ARM=course`)도 효과 없음 → 넣지 않았다.** 남은 일정과 같은 관광공사 여행코스(#1827)에 든 곳에
규칙 점수 +0.3. 코스 동료가 풀에 있는 4도시 16상황(제주·전주는 남은 일정이 코스에 없어 두 팔이 같다): **코스 5 · 기존 3 · 같음 8 / 16**,
바뀐 후보(평균 2.5곳 — 조계사·국립민속박물관·동궁과 월지·선교장 등) 채택 **3/59(5%)**.
- 두 실험의 공통 결론: 구성 LLM 은 원 일정·PlanB 상위와 이름난 가까운 곳을 고르고, 40곳의 **가장자리 교체는 결과를 거의 안 바꾼다**.
  후보 선정 단계의 손잡이는 지렛대가 작다 — 지렛대는 LLM 이 읽는 것(장소 설명 커버리지, 2026-10-22 위키+개요 37:4)에 있었다.
- 반려동물 칸(`provenance.detail.chkpet*`)은 상세 재조회로 차는 중이라 아직 비어 이번엔 재지 않았다(취향 `pet_friendly` 와 이을 자리).

**2026-11-03 KB-3 상황 대처 원칙을 구성 LLM 에 싣기(`EVAL_ARM=kb3`)도 효과 없음 → 넣지 않았다.** 재계획 세션에서 넘겨받은 보류 항목
(PlanB 가 다시 짜기마다 KB-3 를 찾고도 읽는 LLM 이 없다). 구성 프롬프트에 [상황 대처 원칙] 칸(0.10.0 실험판, 사유가 같은 KB-3 앞 4건)을
더한 팔 대 develop 0.9.0, 두 팔 후보·설명 같음, 24상황: **KB-3 4 · 기존 6 · 같음 14 / 24**, 지연 p50 7.8 → 7.9s. 구성 LLM 은 이미
"비가 오면 실내 위주" 같은 규칙 줄과 사유를 받고 있어 같은 내용의 일반 지침이 판단을 바꾸지 않는다. KB-3 는 대체지 선택(`/alternatives`
선택 LLM 의 situation_context)에서만 쓰인다.

실행(ai/ 에서 — 로컬 서빙 임베딩 + 운영 모델 키, 실 API 를 부른다):
    TRIPPILOT_EMBEDDING_BASE_URL=http://localhost:8100 ANTHROPIC_API_KEY=… \
        uv run python scripts/measure/measure_doc_quota.py [반복=1]
    (모델: `EVAL_COMPOSE_MODEL`(기본 운영 claude-opus-5-5) · 판정 `EVAL_JUDGE_MODEL`(기본 claude-sonnet-5) · 몫 `EVAL_DOC_QUOTA`(8))

**두 팔은 같은 입력에서 후보만 다르다.** 규칙 후보는 운영 함수 그대로다 — 원 일정 + PlanB 규칙 순위 앞 20(`rag._rule_ranking`) +
카테고리마다 규칙 점수 상위(`composition.shortlist`). 문서 몫 팔은 그 뒤에 `_runners_up` + `_rank_by_knowledge` 로
고른 곳을 더한다. 장소 설명은 두 팔 모두 운영 조회(`fetch_place_knowledge`)이고, 벡터는 리포의 미리 계산 벡터다(질의만 서빙 임베딩).

**상황**은 문서 몫이 도는 꼴만이다 — 사유가 있거나(날씨·피로) 사용자 말이 있는 경우. 사유도 말도 없으면 운영이 건너뛴다.

**판정**은 다른 모델이 순서를 모른 채(A/B 위치를 번갈아) 두 방문 목록을 비교한다. 두 목록에 나온 **모든 장소의 참고 설명을
똑같이** 준다 — 설명이 붙은 쪽이 문장만 그럴듯해서 이기는 편향을 막는다. 판정 출력은 평가에만 쓴다(학습 금지, 2026-09-08).
"""

from __future__ import annotations

import gzip
import json
import os
import statistics
import sys
import time
import zlib
from datetime import date, datetime, timezone
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_kb5_overview import ANCHORS, _CORPORA, _Knowledge, _pois  # noqa: E402
from measure_prompt_ab import _gateway, _run, _usage  # noqa: E402
from trippilot.agents.adapters.memory_vector_store import InMemoryVectorStore  # noqa: E402
from trippilot.agents.planb import composition, rag  # noqa: E402
from trippilot.agents.planb.kb_retrieval import collection_for  # noqa: E402
from trippilot.agents.planb.kb_retrieval import retrieve  # noqa: E402
from trippilot.agents.planb.place_knowledge import CHUNKED_SOURCES, fetch_place_knowledge  # noqa: E402
from trippilot.assembly_engine.scorer import build_rule_score  # noqa: E402
from trippilot.assembly_engine.travel import haversine_km  # noqa: E402
from trippilot.domain.common import BudgetLevel, PoiId, ScheduleId, TraceId  # noqa: E402
from trippilot.domain.dialogue.trigger import TriggerKind, TriggerParams  # noqa: E402
from trippilot.domain.kb import KbKind  # noqa: E402
from trippilot.domain.llm.llm import CandidatePool, LlmFeature  # noqa: E402
from trippilot.domain.poi.poi import PoiCategory  # noqa: E402
from trippilot.llm_gateway.gates.preference.numbered_selection import NumberedSelectionGate  # noqa: E402
from trippilot.llm_gateway.workers.replan.replan_composition import (  # noqa: E402
    ComposeDayInput, ReplanCompositionWorker, ScheduleLine)
from trippilot.poi_curation.chunking import chunk_corpus, chunk_ids  # noqa: E402
from trippilot.poi_curation.place_docs import SOURCES  # noqa: E402

COMPOSE_MODEL = os.environ.get("EVAL_COMPOSE_MODEL", "claude-opus-5-5")
JUDGE = os.environ.get("EVAL_JUDGE_MODEL", "claude-sonnet-5")
QUOTA = int(os.environ.get("EVAL_DOC_QUOTA", "8"))
TIMEOUT = float(os.environ.get("EVAL_COMPOSE_TIMEOUT", "18.0"))
# 문서 몫 질의 — `situation`(운영 `_situation_query`: "트리거 사유 상황 + 말") · `need`(말이 있으면 말만, 없으면 사유의 필요)
QUERY = os.environ.get("EVAL_DOC_QUERY", "situation")
# 비교할 팔 — `quota`(문서 몫 +8, 기본) · `course`(남은 일정과 같은 관광공사 여행코스에 든 곳에 규칙 점수 +`COURSE_STEP`,
# `data/tour_courses.jsonl.gz` #1827). 코스 팔은 두 팔 후보가 같은 상황(코스 동료가 이미 다 후보거나 없는 곳)을 판정하지 않는다.
ARM = os.environ.get("EVAL_ARM", "quota")
# `kb3` 팔: 두 팔 후보·설명이 같고, 한쪽만 KB-3 상황 대처 원칙을 싣는다(구성 프롬프트 0.10.0). 기준 팔은 `EVAL_BASE_PROMPTS`
# (develop 의 0.9.0 프롬프트 디렉토리 — `git archive origin/develop ai/prompts`)로 렌더한다. 상황 문서는 운영 검색 대신 사유가 같은
# KB-3 문서 앞 4건(선택 러너 `measure_prompt_ab.SELECT_CASES` 와 같은 근사).
BASE_PROMPTS = Path(os.environ["EVAL_BASE_PROMPTS"]) if os.environ.get("EVAL_BASE_PROMPTS") else _AI / "prompts"
COURSE_STEP = float(os.environ.get("EVAL_COURSE_STEP", "0.3"))  # 지시 한 단(`scorer.DIRECTIVE_STEP`)과 같은 크기
_NEED = {"weather": "비를 피해 실내에서 보내기 좋은 곳", "fatigue": "많이 걷지 않고 앉아서 쉬어 갈 수 있는 곳"}
_DAY = date(2026, 11, 4)  # 수요일
_NOW = datetime(2026, 11, 4, 4, 0, tzinfo=timezone.utc)  # 13:00 KST
_RADIUS_KM = 7.0  # 대중교통 다일 반경

# (사유, 사용자 말, 판정자에게 줄 상황 문장)
SITUATIONS = (
    ("weather", "", "비가 와서 남은 하루를 다시 짠다"),
    ("fatigue", "", "피곤해서 덜 걷고 쉬엄쉬엄 남은 하루를 다시 짠다"),
    ("none", "조용한 북카페에서 쉬고 싶어", "조용한 북카페에서 쉬고 싶다며 남은 하루를 다시 짠다"),
    ("none", "아이랑 같이 갈 만한 곳으로 바꿔줘", "아이와 함께 갈 만한 곳으로 남은 하루를 다시 짠다"),
)


def _runners_up(pool: CandidatePool, chosen, day: date, score, n: int = 200) -> tuple:
    """규칙 후보와 같은 자격(숙소·그날 휴무 제외)을 지났지만 안 뽑힌 곳 — 규칙 점수 순 앞 `n`곳."""
    rest = [p for p in pool.pois if p.poi_id not in chosen and p.category is not PoiCategory.STAY
            and composition.hours_label(p, day) is not None]
    return tuple(sorted(rest, key=lambda p: (-score(p), str(p.poi_id)))[:n])


def _rank_by_knowledge(pois, query: str, embedding, store, k: int) -> tuple[str, ...]:
    """`pois` 중 질의에 가장 맞는 KB-5 문서를 가진 곳 `k`개(조인 키, 점수 순) — `fetch_place_knowledge` 와 같은 id 전개."""
    refs = {p.source_ref for p in pois if p.source_ref}
    ids = frozenset(i for src in SOURCES for r in refs
                    for i in ((f"{src}:{r}", *chunk_ids(f"{src}:{r}")) if src in CHUNKED_SOURCES else (f"{src}:{r}",)))
    hits = retrieve(KbKind.POI_DESC, query, embedding, store, top_k=len(ids), item_ids=ids)
    return tuple(dict.fromkeys(h.poi_ref for h in hits if h.poi_ref and h.text))[:k]


def _request(reason: str, said: str, pool: CandidatePool) -> rag.PlanBRagRequest:
    kind = TriggerKind.WEATHER if reason == "weather" else TriggerKind.MANUAL
    return rag.PlanBRagRequest(
        trigger=TriggerParams(kind=kind, schedule_id=ScheduleId("m"), affected_date=_DAY, payload={}),
        reason=reason, pool=pool, trace_id=TraceId("m"), now=_NOW, user_request=said, deadline_ms=25_000)


def _store(kn: _Knowledge, refs: set[str]) -> InMemoryVectorStore:
    store, coll = InMemoryVectorStore(), collection_for(KbKind.POI_DESC, kn.emb.model_id)
    for name in _CORPORA["full"]:
        for d in chunk_corpus(kn.rows[name][r] for r in refs if r in kn.rows[name]):
            store.upsert(coll, d.doc_id, kn.vectors[name].vector(d.doc_id), d.payload())
    return store


def _course_mates() -> dict[str, set[str]]:
    """content_id → 같은 코스에 든 다른 content_id 들."""
    rows = [json.loads(line) for line in gzip.open(_AI / "data/tour_courses.jsonl.gz", "rt", encoding="utf-8") if line.strip()]
    mates: dict[str, set[str]] = {}
    for r in rows:
        ids = {m["content_id"] for m in r["members"]}
        for i in ids:
            mates.setdefault(i, set()).update(ids - {i})
    return mates


def _cases(kn: _Knowledge) -> list[dict]:
    pois = [p for p in _pois() if p.category is not PoiCategory.STAY]
    mates = _course_mates() if ARM == "course" else {}
    seed = zlib.crc32(b"doc-quota")
    out = []
    for city, anchor in ANCHORS.items():
        near = [p for p in pois if haversine_km(anchor, p.coord) <= _RADIUS_KM]
        pool = CandidatePool(poi_ids=frozenset(p.poi_id for p in near), pois=tuple(near), generated_at=_NOW,
                             anchor=anchor, radius_km=_RADIUS_KM)
        by_dist = sorted(near, key=lambda p: haversine_km(anchor, p.coord))
        slots = [p for p in by_dist if p.category in (PoiCategory.SIGHT, PoiCategory.CULTURE)][:2] + \
                [p for p in by_dist if p.category is PoiCategory.FOOD][:1]

        def score(p, anchor=anchor):
            return build_rule_score(p, BudgetLevel.MID, anchor, seed)

        for reason, said, text in SITUATIONS:
            req = _request(reason, said, pool)
            avail = tuple(p.poi_id for p in near if p.poi_id not in {s.poi_id for s in slots})
            ranked, _ = rag._rule_ranking((), pool, avail, reason, said)
            keep = [s.poi_id for s in slots] + [PoiId(r) for r in ranked[:rag.MAX_RANKED]]
            short = composition.shortlist(pool, keep=keep, excluded=(), day=_DAY, score=score)
            tier = _runners_up(pool, short.poi_ids, _DAY, score)
            query = rag._situation_query(req)
            pick_query = (said or _NEED.get(reason, query)) if QUERY == "need" else query
            store = _store(kn, {p.source_ref for p in (*short.pois, *tier) if p.source_ref})
            if ARM == "kb3":
                other, extra = short.pois, ()
            elif ARM == "course":
                near_slots = set().union(*(mates.get(s.source_ref or "", set()) for s in slots))

                def course_score(p, score=score, near_slots=near_slots):
                    return score(p) + (COURSE_STEP if p.source_ref in near_slots else 0.0)

                other = composition.shortlist(pool, keep=keep, excluded=(), day=_DAY, score=course_score).pois
                store = _store(kn, {p.source_ref for p in (*short.pois, *other) if p.source_ref})
                extra = tuple(p for p in other if p.poi_id not in short.poi_ids)
            else:
                refs = _rank_by_knowledge(tier, pick_query, kn.emb, store, QUOTA)
                by_ref = {p.source_ref: p for p in tier}
                extra = tuple(by_ref[r] for r in refs if r in by_ref)
                other = (*short.pois, *extra)
            arms = {}
            for arm, pois_ in (("base", short.pois), ("quota", other)):
                cand = CandidatePool(poi_ids=frozenset(p.poi_id for p in pois_), pois=tuple(pois_),
                                     generated_at=_NOW, anchor=anchor, radius_km=_RADIUS_KM)
                knowledge, _ = fetch_place_knowledge(cand.pois, query, kn.emb, store, fallback={})
                arms[arm] = (cand, knowledge)
            out.append(dict(name=f"{city}/{reason}{'·말' if said else ''}", city=city, anchor=anchor, reason=reason,
                            said=said, text=text, slots=slots, extra=extra, arms=arms))
    return out


def _kb3(reason: str) -> tuple[str, ...]:
    import yaml

    docs = yaml.safe_load((_AI / "data/planb_situation_kb.yaml").read_text(encoding="utf-8"))["documents"]
    return tuple(d["text"] for d in docs if reason in (d.get("metadata") or {}).get("reasons", ()))[:4]


def _input(case: dict, cand: CandidatePool, knowledge, situation: tuple[str, ...] = ()) -> ComposeDayInput:
    anchor = case["anchor"]
    extra = {"situation": situation} if situation else {}
    return ComposeDayInput(**extra,
        date=composition.date_label(_NOW.astimezone()), window="13:00~21:00", weather="정보 없음",
        reasons=tuple(composition.REASON_LABELS.get(r, r) for r in (case["reason"],) if r != "none"),
        directives=(), user_request=case["said"],
        schedule=tuple(ScheduleLine(time=t, category=p.category.value, name=p.name, status="남은 일정")
                       for t, p in zip(("13:30~14:30", "15:00~16:00", "18:00~19:00"), case["slots"])),
        planb_picks=(), persona="(정보 없음)", max_visits=5,
        change_rule=composition.change_rule((case["reason"],), day_directives=False, add_one=False,
                                            free_text=bool(case["said"])),
        distance_km={p.poi_id: haversine_km(anchor, p.coord) for p in cand.pois},
        hours={p.poi_id: composition.hours_label(p, _DAY.weekday()) or "" for p in cand.pois},
        place_knowledge=knowledge,
    )


def _judge(client, case: dict, a, b, kn: _Knowledge) -> str:
    places = {p.poi_id: p for p, _ in (*a, *b)}
    refs = "\n".join(f"- {p.name} ({p.category.value}): {kn.reference(p)}" for p in places.values())

    def show(items):
        return "\n".join(f"{i}. {p.name} ({p.category.value}) — 이유: {r or '(없음)'}"
                         for i, (p, r) in enumerate(items, 1)) or "(방문 없음)"

    prompt = (
        f"상황: {case['city']} 여행 중, {case['text']}. 원래 남은 일정: "
        f"{', '.join(p.name for p in case['slots'])}.\n\n"
        f"[다시 짠 방문 목록 A]\n{show(a)}\n\n[다시 짠 방문 목록 B]\n{show(b)}\n\n"
        f"[참고: 장소 설명 — 두 목록 모두에 같은 자료]\n{refs}\n\n"
        "여행자에게 어느 목록이 더 나은지 고르세요. 기준: ① 이 상황에 실제로 맞는 곳들인가(참고 설명으로 판단) "
        "② 이유가 참고 설명과 맞고 그 장소만의 특징을 짚는가 ③ 사실과 다른 말이 없는가. 길이·문체는 보지 마세요.\n"
        '답은 JSON 한 줄: {"winner": "A" 또는 "B" 또는 "같음", "why": "한 문장"}'
    )
    out = client.messages.create(model=JUDGE, max_tokens=400, messages=[{"role": "user", "content": prompt}])
    text = "".join(x.text for x in out.content if getattr(x, "type", None) == "text").strip()
    try:
        return json.loads(text[text.index("{"): text.rindex("}") + 1]).get("winner", "같음")
    except ValueError:
        return "같음"


def main(repeat: int) -> None:
    import anthropic

    kn = _Knowledge()
    cases = _cases(kn)
    worker = ReplanCompositionWorker(_gateway(_AI / "prompts", LlmFeature.REPLAN_COMPOSITION, NumberedSelectionGate(),
                                              COMPOSE_MODEL))
    base_worker = ReplanCompositionWorker(_gateway(BASE_PROMPTS, LlmFeature.REPLAN_COMPOSITION, NumberedSelectionGate(),
                                                   COMPOSE_MODEL)) if ARM == "kb3" else worker
    judge = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    def one(item):
        i, case = item
        if not case["extra"] and ARM != "kb3":
            return dict(name=case["name"], winner="입력 같음", extra=0, adopted=0)
        picks, rows = {}, {}
        for arm, (cand, knowledge) in case["arms"].items():
            t0 = time.monotonic()
            w, situation = (worker, _kb3(case["reason"])) if (ARM == "kb3" and arm == "quota") else \
                (base_worker if ARM == "kb3" else worker, ())
            r = w.compose(cand, _input(case, cand, knowledge, situation), TraceId(f"dq-{i}-{arm}"),
                          datetime.now(timezone.utc), timeout_sec=TIMEOUT)
            idx = {p.poi_id: p for p in cand.pois}
            picks[arm] = [] if (r.is_fallback or r.value is None) else [(idx[v.poi_id], v.reason) for v in r.value]
            rows[arm] = dict(wall=int((time.monotonic() - t0) * 1000), err=r.error, **_usage(r))
        flip = i % 2 == 1  # A/B 자리를 번갈아 — 위치 편향을 상쇄한다
        a, b = (picks["quota"], picks["base"]) if flip else (picks["base"], picks["quota"])
        got = _judge(judge, case, a, b, kn)
        winner = {"A": "quota" if flip else "base", "B": "base" if flip else "quota"}.get(got, "같음")
        extra_ids = {p.poi_id for p in case["extra"]}
        return dict(name=case["name"], winner=winner, extra=len(case["extra"]),
                    adopted=sum(1 for p, _ in picks["quota"] if p.poi_id in extra_ids),
                    picks={k: [p.name for p, _ in v] for k, v in picks.items()}, **{f"{k}_{m}": v[m] for k, v in rows.items()
                                                                                for m in ("wall", "inp", "err")})

    rows = _run(one, cases * repeat)
    judged = [r for r in rows if r["winner"] != "입력 같음"]
    tally = {w: sum(r["winner"] == w for r in judged) for w in ("quota", "base", "같음")}

    def p50(key):
        vals = [r[key] for r in judged if r.get(key)]
        return int(statistics.median(vals)) if vals else None

    print(json.dumps(dict(model=COMPOSE_MODEL, judge=JUDGE, quota=QUOTA, n=len(rows), judged=len(judged),
                          win={k: f"{v}/{len(judged)}" for k, v in tally.items()},
                          extra_mean=round(statistics.mean(r["extra"] for r in rows), 2) if rows else 0,
                          adopted=f"{sum(r['adopted'] for r in judged)}/{sum(r['extra'] for r in judged)}",
                          wall_p50={"base": p50("base_wall"), "quota": p50("quota_wall")},
                          in_p50={"base": p50("base_inp"), "quota": p50("quota_inp")},
                          errors={a: sum(1 for r in judged if r.get(f"{a}_err")) for a in ("base", "quota")}),
                     ensure_ascii=False))
    for r in sorted(rows, key=lambda r: r["name"]):
        print(f"  {r['winner']:<6} {r['name']:<16} 몫 {r['extra']} 채택 {r['adopted']}  {r.get('picks', '')}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
