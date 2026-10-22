r"""KB-5 관광공사 개요 효과 측정 — '다른 후보'(`/planb/alternatives` 의 ALTERNATIVE_SELECTION)에 장소 설명을 붙였을 때.

실행(ai/ 에서 — 로컬 서빙 임베딩 + OpenAI 호환 키, 실 API 를 부른다):
    TRIPPILOT_EMBEDDING_BASE_URL=http://localhost:8100 OPENAI_API_KEY=… OPENAI_BASE_URL=… \
        uv run python scripts/measure/measure_kb5_overview.py coverage
    … measure_kb5_overview.py ab wiki full [반복=2]          # 위키만 vs 위키+개요
    … measure_kb5_overview.py ab full <변형> [반복=2]          # 개선 변형 비교(아래 `VARIANTS`)

**상황**은 백엔드가 실제로 부르는 꼴이다 — 트리거 `MANUAL` 고정·사용자 말 없음·사유는 FE 키(날씨·피로·휴무·교체), 바꿀
슬롯은 기준점에서 가장 가까운 볼거리. 6개 도시 × 사유 4 = 24상황. 숏리스트는 운영 함수(`rag._shortlist`), 장소 설명은
운영 조회(`fetch_place_knowledge` — 리포의 미리 계산 벡터 + 질의만 서빙 임베딩)다.

**판정**은 다른 모델(기본 gpt-5.6-terra)이 순서를 모른 채 두 추천 목록을 비교한다. 판정자에게는 두 목록에 나온 **모든
장소의 참고 설명을 똑같이** 준다(개요 우선·없으면 위키 도입부) — 설명이 붙은 쪽이 문장만 그럴듯해서 이기는 편향을 막고,
상황에 실제로 맞는 곳을 골랐는지·이유가 사실과 맞는지를 보게 한다. 판정 출력은 평가에만 쓴다(학습 금지, 2026-09-08).

**2026-10-22 실측** (선택 gpt-5.6-sol · 판정 gpt-5.6-terra · 개요 7,642곳 시점):
- 커버리지(숏리스트 중 설명 붙은 곳, 위키만 → 위키+개요): 서울 광화문 10→37/60 · 제주시청 5→36/50 · 전주 4→22/22 ·
  강릉 3→19/40 · 경주 37→40/60(상한) · 부산 해운대 2→5/35. 설명 없는 후보는 Overture 출처(관광공사 id 없음 — 서울 23·부산
  15·제주 14)와 개요를 아직 못 받은 관광공사 장소(부산 14·강릉 18·경주 7)다.
- `ab wiki full 2`: **위키+개요 37 · 위키만 4 · 같음 7 / 48** — 개요가 사실 오류를 막는다(위키만 쪽이 숲길 야외 전시를 "실내"로
  추천, 개요 쪽은 실내 체험관). 평균 설명 수 10.2 → 26.5.
- 문서를 "더 잘 쓰게" 하는 변형은 모두 개선이 아니었다 — 이득은 **설명이 붙는 후보 수**에서만 나온다.
  · `need`(조각 질의를 사유의 필요로, 교체·휴무는 도입부) 21:14·같음 13 / 48 → `need2`(날씨·피로·지연만) 34:31·같음 31 / 96.
    두 쪽 입력이 똑같은 휴무·교체 상황에서도 판정이 12:7 · 4:8 로 흔들려 이 차이는 잡음 범위다.
  · `cite`(프롬프트에 "설명으로 판단하고 이유에 근거를 쓰라" 한 줄, `EVAL_CITE_PROMPTS` 로 고친 프롬프트 디렉토리) **13:29 로
    나빠졌다** — 근거를 쓰라 하자 설명에 없는 말이 섞였다(휴무 1:9).
  · `cap60`(설명 상한 40 → 60, 상한이 걸리는 서울·경주만 `EVAL_CITIES`) 9:19 / 32 — 늘어나는 설명이 평균 6곳뿐이고 이득 없음.
    지연 p50 3.8 → 4.0s · 입력 8.7k → 9.7k 토큰.
"""

from __future__ import annotations

import gzip
import json
import os
import random
import sys
import time
from dataclasses import replace
from datetime import date, datetime, timezone
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import openai  # noqa: E402
import yaml  # noqa: E402

from measure_prompt_ab import _gateway, _run, _timing, _usage  # noqa: E402
from trippilot.agents.adapters.memory_vector_store import InMemoryVectorStore  # noqa: E402
from trippilot.agents.planb import rag  # noqa: E402
from trippilot.agents.planb.kb_retrieval import collection_for  # noqa: E402
from trippilot.agents.planb.place_knowledge import fetch_place_knowledge  # noqa: E402
from trippilot.assembly_engine.travel import haversine_km  # noqa: E402
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TraceId  # noqa: E402
from trippilot.domain.kb import KbKind  # noqa: E402
from trippilot.domain.llm import CandidatePool, LlmFeature  # noqa: E402
from trippilot.domain.poi import DataQuality, Poi, PoiCategory  # noqa: E402
from trippilot.domain.trigger import TriggerKind, TriggerParams  # noqa: E402
from trippilot.poi_curation.pool_builder import restrict_pool_to_target_role  # noqa: E402
from trippilot.llm_gateway.gates.alternative_selection import AlternativeSelectionGate  # noqa: E402
from trippilot.llm_gateway.workers.alternative_selection import (  # noqa: E402
    AlternativeSelectionInput, AlternativeSelectionWorker,
)
from trippilot.poi_curation.chunking import chunk_corpus, load_chunk_vectors, vectors_path  # noqa: E402

MODEL = os.environ.get("EVAL_SELECT_MODEL", "gpt-5.6-sol")  # .env.example ALTERNATIVE_SELECTION
JUDGE = os.environ.get("EVAL_JUDGE_MODEL", "gpt-5.6-terra")
TIMEOUT = float(os.environ.get("EVAL_SELECT_TIMEOUT", "12.5"))  # BE 25s × llm_budget_share 0.5
_NOW = datetime(2026, 10, 22, 5, 0, tzinfo=timezone.utc)

ANCHORS = {  # 관광공사 개요가 모인 대표 관광지 둘레
    "서울 광화문": GeoPoint(37.5759, 126.9768), "부산 해운대": GeoPoint(35.1587, 129.1604),
    "제주시청": GeoPoint(33.4996, 126.5312), "경주 황리단길": GeoPoint(35.8389, 129.2127),
    "전주 한옥마을": GeoPoint(35.8150, 127.1530), "강릉 경포": GeoPoint(37.7960, 128.8960),
}
REASONS = ("weather", "fatigue", "closed", "none")
_SIGHTS = {PoiCategory.SIGHT, PoiCategory.CULTURE, PoiCategory.NATURE}
_CORPORA = {"wiki": ("place_corpus_wiki.jsonl.gz",),
            "full": ("place_corpus_wiki.jsonl.gz", "place_corpus_overview.jsonl.gz")}
# 개선 변형 — 장소 설명을 고르는 질의(KB-5 조각 선택)·프롬프트 디렉토리를 바꾼다. 측정이 끝나면 이긴 것만 코드로 옮긴다.
# `need`: 사용자 말이 없으면(백엔드 경로 전부) 조각을 고르는 질의를 사유의 **필요**로 바꾼다 — "MANUAL 사용자 요청 교체 상황"은
#   장소와 무관한 말이라 조각 선택이 사실상 무작위다(KB-3 측정에서 none 질의 점수 0.51/0.507/0.493). 필요가 없는 사유(교체·휴무)는
#   도입부(#0 — 이곳이 무엇인지)를 붙인다.
# `cite`: 프롬프트가 설명을 판단 근거로 쓰고 이유에 그 근거를 쓰게 한다(지어내기 금지는 그대로).
_NEED = {"weather": "비를 피해 실내에서 보내기 좋은 곳", "fatigue": "많이 걷지 않고 앉아서 쉬어 갈 수 있는 곳",
         "delay": "짧게 들르기 좋은 곳"}


def _need_query(req: rag.PlanBRagRequest) -> str | None:
    if req.user_request.strip():
        return rag._situation_query(req)
    return _NEED.get(req.reason)  # None = 도입부


def _need_only_query(req: rag.PlanBRagRequest) -> str:
    """필요가 있는 사유(날씨·피로·지연)만 질의를 바꾸고, 나머지는 운영 질의 그대로(도입부 고정 없음)."""
    if req.user_request.strip() or req.reason not in _NEED:
        return rag._situation_query(req)
    return _NEED[req.reason]


VARIANTS: dict[str, dict] = {
    "need2": {"corpora": "full", "query": _need_only_query},
    # `cap60`: 장소 설명 상한(`place_knowledge.MAX_DOCS` 40)을 숏리스트 크기(60)로 — 서울·경주는 상한에 걸려 20곳이 설명 없이 간다
    "cap60": {"corpora": "full", "max_docs": 60},
    "wiki": {"corpora": "wiki"}, "full": {"corpora": "full"},
    "need": {"corpora": "full", "query": _need_query},
    "cite": {"corpora": "full", "prompts": os.environ.get("EVAL_CITE_PROMPTS", "prompts")},
    "need_cite": {"corpora": "full", "query": _need_query, "prompts": os.environ.get("EVAL_CITE_PROMPTS", "prompts")},
}


def _pois() -> list[Poi]:
    doc = json.loads((_AI / "data/collected_pois.json").read_text(encoding="utf-8"))
    out, seen = [], set()
    for pr in doc["proposals"]:
        p = Poi.from_dict(pr["poi"])
        if str(p.poi_id) in seen or p.quality is DataQuality.MINIMAL or p.category is PoiCategory.STAY:
            continue
        seen.add(str(p.poi_id))
        # 공유본 `poi.source_ref` 는 비어 있다 — 운영 풀은 백엔드가 관광공사 contentid 를 `sourceRef` 로 준다(KB-5 조인 키)
        ref = (pr.get("provenance") or {}).get("content_id") if pr.get("source") == "TOURAPI" else None
        out.append(replace(p, tags=tuple(pr.get("tags") or ()), source_ref=p.source_ref or ref))
    return out


def _cases(pois: list[Poi]) -> list[dict]:
    cases = []
    for city, anchor in ANCHORS.items():
        near = [p for p in pois if haversine_km(anchor, p.coord) <= 10.0]  # 대중교통 반경(BE 는 transport_mode null)
        target = min((p for p in near if p.category in _SIGHTS), key=lambda p: haversine_km(anchor, p.coord))
        full = CandidatePool(poi_ids=frozenset(p.poi_id for p in near), pois=tuple(near),
                             generated_at=_NOW, anchor=anchor, radius_km=10.0)
        # 운영 배선과 같다(`wiring.alternatives`) — 대상 칸의 역할로 좁히고(명소 칸이면 같은 분류 먼저), 대상은 제외로만 뺀다
        pool, _ = restrict_pool_to_target_role(full, str(target.poi_id), frozenset({target.poi_id}))
        for reason in REASONS:
            cases.append(dict(name=f"{city}/{reason}", city=city, anchor=anchor, reason=reason, target=target,
                              pool=pool))
    return cases


def _request(case: dict) -> rag.PlanBRagRequest:
    return rag.PlanBRagRequest(
        trigger=TriggerParams(kind=TriggerKind.MANUAL, schedule_id=ScheduleId("m"), affected_date=date(2026, 10, 22),
                              payload={}),
        reason=case["reason"], pool=case["pool"], trace_id=TraceId("m"), now=_NOW,
        excluded_poi_ids=frozenset({case["target"].poi_id}), deadline_ms=25_000)


class _Knowledge:
    """출처별 미리 계산 벡터 + 코퍼스 행 — 조회는 운영 `fetch_place_knowledge` 를 그대로 탄다."""

    def __init__(self) -> None:
        from trippilot.llm_gateway.adapters.http_embedding_assembly import http_embedding
        from trippilot.poi_curation.adapters.backend_poi_db import UrllibJsonClient

        self.emb = http_embedding(SystemExit, lambda t: UrllibJsonClient(timeout_sec=t), timeout_sec=60.0)
        self.rows: dict[str, dict[str, dict]] = {}
        self.vectors = {}
        for name in {n for c in _CORPORA.values() for n in c}:
            path = _AI / "data" / name
            self.rows[name] = {r["poi_ref"]: r for r in map(json.loads, gzip.open(path, "rt", encoding="utf-8"))}
            self.vectors[name] = load_chunk_vectors(vectors_path(path))

    def fetch(self, pois, query: str | None, corpora: str, max_docs: int | None = None) -> dict:
        """`query=None` 이면 도입부(#0)만 둔다 — 장소마다 '이곳이 무엇인지'가 붙는다."""
        refs = {p.source_ref for p in pois if p.source_ref}
        store, coll = InMemoryVectorStore(), collection_for(KbKind.POI_DESC, self.emb.model_id)
        for name in _CORPORA[corpora]:
            docs = chunk_corpus(self.rows[name][r] for r in refs if r in self.rows[name])
            for d in docs:
                if query is None and not d.doc_id.endswith("#0"):
                    continue
                store.upsert(coll, d.doc_id, self.vectors[name].vector(d.doc_id), d.payload())
        import trippilot.agents.planb.place_knowledge as pk

        saved = pk.MAX_DOCS
        pk.MAX_DOCS = max_docs or saved  # 조회는 실행 전에 차례로 하므로 바꿔 끼워도 안전하다
        try:
            knowledge, _ = fetch_place_knowledge(pois, query or "장소 소개", self.emb, store)
        finally:
            pk.MAX_DOCS = saved
        return dict(knowledge)

    def reference(self, poi: Poi) -> str:
        """판정자용 참고 설명 — 두 조건에 똑같이(개요 우선, 없으면 위키 도입부)."""
        for name in ("place_corpus_overview.jsonl.gz", "place_corpus_wiki.jsonl.gz"):
            row = self.rows[name].get(poi.source_ref or "")
            if row and row.get("sections"):
                return " ".join(row["sections"][0]["text"].split())[:400]
        return "설명 없음"


def _situation_text(case: dict) -> str:
    what = {"weather": "비가 와서", "fatigue": "피곤해서", "closed": "그곳이 문을 닫아서", "none": "다른 곳에 가 보고 싶어서"}
    return f"{case['city']} 여행 중, 일정의 '{case['target'].name}' 대신 {what[case['reason']]} 다른 곳을 찾는다"


def _select(worker, case: dict, knowledge: dict, kb3: list[dict], i: int):
    reason = case["reason"]
    situation = [d["text"] for d in kb3 if reason in d["metadata"].get("reasons", ())][:4]
    inp = AlternativeSelectionInput(
        trigger_kind="MANUAL", reason=reason,
        schedule_context=f"[현재 일정]\n1. {case['target'].name}",
        situation_context="\n".join(f"- {t}" for t in situation),
        persona_context="(정보 없음)", max_alternatives=3,
        excluded_poi_ids=frozenset({case["target"].poi_id}), place_knowledge=knowledge)
    shortlist = case["shortlist"]
    return worker.select(shortlist, inp, TraceId(f"kb5-{i}"), datetime.now(timezone.utc), timeout_sec=TIMEOUT)


def _judge(client, case: dict, a: list[tuple[Poi, str]], b: list[tuple[Poi, str]], kn: _Knowledge) -> dict:
    places = {p.poi_id: p for p, _ in (*a, *b)}
    refs = "\n".join(f"- {p.name} ({p.category.value}): {kn.reference(p)}" for p in places.values())

    def show(items):
        return "\n".join(f"{i}. {p.name} ({p.category.value}) — 이유: {r or '(없음)'}" for i, (p, r) in enumerate(items, 1)) \
            or "(추천 없음)"

    prompt = (
        f"상황: {_situation_text(case)}.\n\n"
        f"[추천 A]\n{show(a)}\n\n[추천 B]\n{show(b)}\n\n"
        f"[참고: 장소 설명 — 두 추천 모두에 같은 자료]\n{refs}\n\n"
        "여행자에게 어느 추천이 더 나은지 고르세요. 기준: ① 이 상황에 실제로 맞는 곳을 골랐는가(참고 설명으로 판단) "
        "② 이유가 참고 설명과 맞고 그 장소만의 특징을 짚는가 ③ 사실과 다른 말이 없는가. 길이·문체는 보지 마세요.\n"
        '답은 JSON 한 줄: {"winner": "A" 또는 "B" 또는 "같음", "why": "한 문장"}'
    )
    out = client.chat.completions.create(model=JUDGE, messages=[{"role": "user", "content": prompt}])
    text = (out.choices[0].message.content or "").strip()
    try:
        got = json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError:
        got = {"winner": "같음", "why": f"판정 파싱 실패: {text[:80]}"}
    return got


def run_coverage() -> None:
    kn, pois = _Knowledge(), _pois()
    for case in _cases(pois):
        if case["reason"] not in ("weather", "none"):
            continue
        shortlist = rag._shortlist(_request(case), ())
        q = rag._situation_query(_request(case))
        w, f = (kn.fetch(shortlist.pois, q, c) for c in ("wiki", "full"))
        print(f"{case['name']:<16} 풀 {len(case['pool'].pois):>5} · 숏리스트 {len(shortlist.pois)} · "
              f"설명 붙음 위키 {len(w):>2} → 위키+개요 {len(f):>2}")


def run_ab(left: str, right: str, repeat: int) -> None:
    kn, pois = _Knowledge(), _pois()
    kb3 = yaml.safe_load((_AI / "data/planb_situation_kb.yaml").read_text(encoding="utf-8"))["documents"]
    prompts = {name: _AI / VARIANTS[name].get("prompts", "prompts") for name in (left, right)}
    workers = {name: AlternativeSelectionWorker(_gateway(prompts[name], LlmFeature.ALTERNATIVE_SELECTION,
                                                         AlternativeSelectionGate(), MODEL)) for name in (left, right)}
    cities = set(filter(None, os.environ.get("EVAL_CITIES", "").split(",")))
    cases = [c for c in _cases(pois) if not cities or c["city"] in cities]
    for case in cases:
        case["shortlist"] = rag._shortlist(_request(case), ())
        case["knowledge"] = {}
        for name in (left, right):
            v = VARIANTS[name]
            query = v.get("query", rag._situation_query)(_request(case))
            case["knowledge"][name] = kn.fetch(case["shortlist"].pois, query, v["corpora"], v.get("max_docs"))

    def one(item):
        i, (case, rep) = item
        res = {}
        for name in (left, right):
            t0 = time.monotonic()
            r = _select(workers[name], case, case["knowledge"][name], kb3, i)
            wall = int((time.monotonic() - t0) * 1000)
            index = {p.poi_id: p for p in case["shortlist"].pois}
            picks = [] if r.is_fallback else [(index[v.poi_id], v.reason) for v in r.value if v.poi_id in index][:3]
            res[name] = dict(picks=picks, err=r.error, wall=wall, **_usage(r))
        flip = random.Random(f"{case['name']}-{rep}").random() < 0.5
        a, b = (right, left) if flip else (left, right)
        verdict = _judge(judge_client, case, res[a]["picks"], res[b]["picks"], kn)
        w = verdict.get("winner", "같음")
        winner = a if w == "A" else b if w == "B" else "="
        return dict(name=case["name"], winner=winner, why=verdict.get("why", ""), res=res,
                    docs={n: len(case["knowledge"][n]) for n in (left, right)})

    judge_client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"], max_retries=1)
    rows = _run(one, [(c, k) for k in range(repeat) for c in cases])
    n = len(rows)
    tally = {left: sum(r["winner"] == left for r in rows), right: sum(r["winner"] == right for r in rows),
             "=": sum(r["winner"] == "=" for r in rows)}
    print(json.dumps(dict(model=MODEL, judge=JUDGE, n=n, win={k: f"{v}/{n}" for k, v in tally.items()},
                          docs_mean={x: round(sum(r["docs"][x] for r in rows) / n, 1) for x in (left, right)},
                          errors={x: sum(1 for r in rows if r["res"][x]["err"]) for x in (left, right)},
                          p50_ms={x: sorted(r["res"][x]["wall"] for r in rows)[n // 2] for x in (left, right)},
                          p90_ms={x: sorted(r["res"][x]["wall"] for r in rows)[int(n * 0.9)] for x in (left, right)},
                          in_tok={x: round(sum(r["res"][x]["inp"] or 0 for r in rows) / n) for x in (left, right)}),
                     ensure_ascii=False))
    for r in sorted(rows, key=lambda r: r["name"]):
        mark = {left: "<", right: ">", "=": "="}[r["winner"]]
        print(f" {mark} {r['name']:<16} docs {r['docs'][left]}/{r['docs'][right]} — {r['why']}")
        for x in (left, right):
            print(f"     {x}: " + " / ".join(f"{p.name}: {why}" for p, why in r["res"][x]["picks"]))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "coverage"
    if mode == "coverage":
        run_coverage()
    else:
        run_ab(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 2)
