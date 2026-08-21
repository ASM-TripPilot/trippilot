"""PlanBAgent RAG 리허설 — 실 pgvector × 실 LLM 으로 Retrieve→Augment→Generate 관통.

수집 POI(실데이터)로 closed-set 후보 풀을 만들고, 강수 트리거 하나를 PlanB 파이프라인
(`agents/planb/rag.py`)에 통과시킨다. 정상 경로 1종 + 폴백 경로 4종을 한 번에 밟아
**LLM 이 죽어도 사용자에게 뭔가는 나간다**(INV-4)는 계약을 실물로 확인한다.

**pytest 대상이 아니다** — CI 실 호출 0건(D37)은 그대로다. 실 LLM·실 DB 호출은 사람이
손으로 실행할 때만. 순수 로직은 tests/test_planb_rag.py·test_llm_gateway_alternative_selection.py
가 fake 로만 검증한다.

시나리오 5종:
    ① 게이트웨이 미주입   → 규칙 랭킹 (fallback 1)
    ② 실 LLM 선택        → LLM 경로 (fallback 0) · LLM_PROVIDER 없으면 생략
    ③ 풀 밖 id 응답      → 게이트 전량 드롭 → 규칙 랭킹 (INV-1)
    ④ LLM 장애           → 규칙 랭킹 + 사유 기록 (INV-4)
    ⑤ 후보 전량 제외     → 대안 0 + empty_reason (침묵 실패 금지)
모든 시나리오에서 산출 POI ⊂ 후보 풀(INV-1), 산출물에 시각·소요시간 필드 부재(INV-2·3)를
검사한다.

**임베딩은 결정론 해시**다 — 멘토 게이트웨이에 임베딩 배포가 없다(404 DeploymentNotFound,
2026-08-21 실측). 의미 유사도가 없으므로 R 단계에서 검증되는 것은 **배선**(collection
배정·kb 재태깅·부분 실패 격리)이지 검색 품질이 아니다. 실임베딩이 붙으면 이 클래스만
교체한다. 스토어는 실물 pgvector 이므로 어댑터 왕복은 진짜로 밟는다.

사용법:
    cd ai
    docker compose --profile full up -d ai-vectordb      # 리포 루트에서
    set -a; source ../.env; set +a                       # LLM 키 (선택)
    TRIPPILOT_VECTOR_DB_URL=postgresql://ai_kb:ai_kb@localhost:5433/ai_kb \
        uv run python scripts/smoke_planb.py

환경변수:
    TRIPPILOT_VECTOR_DB_URL  필수 — pgvector DSN (smoke_vector.py 와 같은 값)
    COLLECTED_POIS           수집 제안 JSON (collect_pois.py 산출물). 있으면 우선.
    COLLECTED_POIS_DB        수집 sqlite (기본 "collected_pois.db"). JSON 없을 때 사용.
    SMOKE_REGION             기본 "제주시" — 후보 풀을 뽑을 시군구
    LLM env                  smoke_llm.py 와 동일. 미설정이면 시나리오 ②만 생략(성공 유지).

종료 코드: 0 = 5종(또는 ② 생략 시 4종) 통과 / 1 = 계약 위반·실행 실패 / 2 = 사전조건 미충족
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # smoke_llm·smoke_itinerary 재사용

from smoke_itinerary import load_proposals  # noqa: E402
from smoke_llm import _build_adapter  # noqa: E402
from trippilot.agents.adapters.pgvector_store import PgVectorStore  # noqa: E402
from trippilot.agents.planb.kb_retrieval import KB_COLLECTIONS, index_documents  # noqa: E402
from trippilot.agents.planb.rag import (  # noqa: E402
    PlanBRagConfig,
    PlanBRagPipeline,
    PlanBRagRequest,
)
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TraceId  # noqa: E402
from trippilot.domain.kb import KbDocument, KbKind  # noqa: E402
from trippilot.domain.llm import CandidatePool, ModelTier  # noqa: E402
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource  # noqa: E402
from trippilot.domain.trigger import TriggerKind, TriggerParams  # noqa: E402
from trippilot.llm_gateway.config import C1Config  # noqa: E402
from trippilot.llm_gateway.gates.alternative_selection import (  # noqa: E402
    AlternativeSelectionGate,
)
from trippilot.llm_gateway.gateway import GatewayFacade  # noqa: E402
from trippilot.llm_gateway.prompts import PromptRegistry  # noqa: E402
from trippilot.ports.llm_port import LlmResponse  # noqa: E402
from trippilot.api.wiring import LoggingTrace  # noqa: E402

DIM = 1024  # kb_vectors DDL 고정 (docker/vector-init/01-kb-vectors.sql)
NOW = datetime.now(timezone.utc)
TID = TraceId("smoke-planb")
POOL_SIZE = 8
INDOOR = ("CULTURE", "CAFE", "FOOD")
DOC_PREFIX = "smoke-planb"  # 실 collection 을 쓰므로 접두로 격리하고 끝에 지운다
PROMPTS = Path(__file__).resolve().parent.parent / "prompts"


class HashEmbedding:
    """결정론 해시 임베딩 — 같은 텍스트 → 같은 벡터. **의미 유사도 없음**(위 docstring)."""

    dim = DIM

    def embed(self, text: str) -> tuple[float, ...]:
        rng = random.Random(int.from_bytes(hashlib.sha256(text.encode()).digest(), "big"))
        raw = [rng.gauss(0.0, 1.0) for _ in range(self.dim)]
        norm = math.sqrt(sum(x * x for x in raw)) or 1.0
        return tuple(x / norm for x in raw)

    def embed_batch(self, texts) -> tuple[tuple[float, ...], ...]:
        return tuple(self.embed(t) for t in texts)


class CannedLlm:
    """정해진 raw_text 만 돌려주는 스텁 — ③ 풀 밖 id 주입용."""

    def __init__(self, raw: str) -> None:
        self._raw = raw

    def invoke(self, request) -> LlmResponse:
        return LlmResponse(
            raw_text=self._raw, input_tokens=len(request.prompt), output_tokens=len(self._raw),
            latency_ms=0, model_id=request.model_id,
        )


class FailingLlm:
    """④ 장애 주입 — 실모델을 일부러 죽일 수는 없으므로 여기서만 스텁."""

    def invoke(self, request) -> LlmResponse:
        raise RuntimeError("LLM unavailable (smoke stub)")


# ── 입력 조립 ────────────────────────────────────────────────────────────


def load_entries() -> tuple[tuple[Poi, str | None], ...]:
    """수집 POI 로드 — JSON(수집 artifact) 우선, 없으면 로컬 sqlite."""
    js = os.environ.get("COLLECTED_POIS")
    if js:
        return load_proposals(json.loads(Path(js).read_text(encoding="utf-8")))
    db = os.environ.get("COLLECTED_POIS_DB") or "collected_pois.db"
    if not Path(db).exists():
        raise SystemExit(
            f"수집 POI 없음 — COLLECTED_POIS(json) 또는 COLLECTED_POIS_DB(기본 {db}) 필요"
        )
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "select provisional_id, name, category, lat, lng, quality, region from proposal"
    ).fetchall()
    return tuple(
        (
            Poi(
                poi_id=PoiId(r["provisional_id"]), name=r["name"],
                category=PoiCategory(r["category"]), coord=GeoPoint(r["lat"], r["lng"]),
                open_hours=(), avg_cost=None, rating=None,
                quality=DataQuality(r["quality"]), source=PoiSource.SEED, confidence=None,
            ),
            r["region"],
        )
        for r in rows
    )


def build_pool(entries, region: str) -> CandidatePool:
    """시군구 하나에서 실내 5 + 야외 3 — 폴백이 트리거를 보는지 눈에 보이게 섞는다."""
    here = [p for p, r in entries if r == region]
    indoor = [p for p in here if p.category.value in INDOOR][:5]
    outdoor = [p for p in here if p.category.value not in INDOOR][: POOL_SIZE - len(indoor)]
    pois = tuple(indoor + outdoor)
    if len(pois) < 3:
        raise SystemExit(f"{region} POI 부족({len(pois)}곳) — SMOKE_REGION 을 바꿔라")
    return CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=NOW
    )


def kb_documents(pool: CandidatePool) -> list[KbDocument]:
    """KB 3종. KB-2 는 풀 안 2곳을 '저장 장소'로 참조 — 규칙 랭킹의 1순위 신호."""
    saved = [p for p in pool.pois if p.category.value in INDOOR][:2]
    docs = [
        KbDocument(KbKind.SCHEDULE, f"{DOC_PREFIX}-sched-1",
                   "오후 야외 산책 슬롯 (고정 아님, 대체 가능)", None, {}),
        KbDocument(KbKind.SITUATION, f"{DOC_PREFIX}-situ-1",
                   "오후 강수확률 80%, 강풍주의보 — 실외 활동 부적합", None, {}),
    ]
    docs += [
        KbDocument(KbKind.PERSONA, f"{DOC_PREFIX}-pref-{i}",
                   f"저장한 장소 — {p.name}", str(p.poi_id), {"kind": "saved"})
        for i, p in enumerate(saved)
    ]
    # 풀 밖을 가리키는 저장 장소 — KB 히트가 후보 자격을 만들지 않음을 확인한다 (INV-1)
    docs.append(
        KbDocument(KbKind.PERSONA, f"{DOC_PREFIX}-pref-out", "저장한 장소 — 풀 밖 POI",
                   "tourapi-000000", {"kind": "saved"})
    )
    return docs


# ── 실행 ────────────────────────────────────────────────────────────────


def pipeline(store, llm, model_id: str | None) -> PlanBRagPipeline:
    mid = model_id or "unused"
    gateway = None if llm is None else GatewayFacade(
        llm, PromptRegistry(PROMPTS), AlternativeSelectionGate(),
        C1Config(
            model_ids={ModelTier.LIGHT: mid, ModelTier.HEAVY: mid},
            # 리허설은 운영 2.5s 예산이 아니라 스모크 관례(관대한 타임아웃)를 따른다
            timeout_sec=float(os.environ.get("SMOKE_TIMEOUT_SEC", "30")),
            max_tokens=int(os.environ.get("SMOKE_MAX_TOKENS", "2048")),
            temperature=float(os.environ.get("SMOKE_TEMPERATURE", "1.0")),
        ),
        LoggingTrace(),
    )
    return PlanBRagPipeline(
        HashEmbedding(), store, alternative_gateway=gateway,
        config=PlanBRagConfig(max_alternatives=3),
    )


def run(title, store, pool, llm=None, model_id=None, excluded=frozenset()) -> dict:
    result = pipeline(store, llm, model_id).run(
        PlanBRagRequest(
            trigger=TriggerParams(TriggerKind.WEATHER, ScheduleId("smoke-planb-1"),
                                  date.today(), {"pop": 80}),
            reason="weather", pool=pool, trace_id=TID, now=NOW, excluded_poi_ids=excluded,
        )
    )
    names = {str(p.poi_id): f"{p.name}[{p.category.value}]" for p in pool.pois}
    print(f"\n── {title}")
    print(f"   retrieved={result.retrieved} fallback_level={result.fallback_level}")
    print(f"   notes={list(result.notes)} empty_reason={result.empty_reason}")
    for alt in result.alternatives:
        print(f"   [{alt.label}] {names.get(str(alt.poi_ids[0]), '?')} — {alt.rationale}")
    for alt in result.alternatives:  # INV-1
        for pid in alt.poi_ids:
            if not pool.contains(pid) or pid in excluded:
                raise SystemExit(f"INV-1 위반: 풀 밖 POI 산출 {pid}")
    if result.alternatives:  # INV-2·INV-3 — 필드 자리 자체가 없다
        leaked = set(result.alternatives[0].to_dict()) & {
            "start", "end", "time", "order", "duration", "duration_min", "travel_min"
        }
        if leaked:
            raise SystemExit(f"INV-2/3 위반: 시각·소요시간 필드 노출 {leaked}")
    return result.to_dict()


def main() -> int:
    dsn = os.environ.get("TRIPPILOT_VECTOR_DB_URL")
    if not dsn:
        print("TRIPPILOT_VECTOR_DB_URL 미설정 — 스모크 불가 (사용법: 스크립트 docstring)",
              file=sys.stderr)
        return 2
    import psycopg

    region = os.environ.get("SMOKE_REGION") or "제주시"
    pool = build_pool(load_entries(), region)
    print(f"후보 풀 {len(pool.pois)}곳 ({region}, 실 수집 데이터):")
    for p in pool.pois:
        print(f"  - {p.poi_id} {p.name} [{p.category.value}]")

    store = PgVectorStore(lambda: psycopg.connect(dsn))
    docs = kb_documents(pool)
    embedding = HashEmbedding()
    try:
        print(f"KB 적재 {index_documents(docs, embedding, store)}건 (실 pgvector)")

        r1 = run("① 게이트웨이 미주입 → 규칙 랭킹", store, pool)
        assert r1["fallback_level"] == 1, r1
        assert "alternative_gateway_absent" in r1["notes"], r1
        # KB-2 저장 장소 2곳이 규칙 랭킹 상위를 차지한다. 둘 사이의 순서는 고정하지
        # 않는다 — 해시 임베딩엔 의미 순위가 없어 검색 순서가 임의(결정론이되 임의)다.
        saved_ids = {
            str(p.poi_id) for p in [p for p in pool.pois if p.category.value in INDOOR][:2]
        }
        assert {a["poi_ids"][0] for a in r1["alternatives"][:2]} == saved_ids, (
            "KB-2 저장 장소가 규칙 랭킹 상위 2순위여야 한다"
        )

        if os.environ.get("LLM_PROVIDER"):
            adapter, model_id = _build_adapter()
            r2 = run(f"② 실 LLM 선택 (model={model_id})", store, pool, adapter, model_id)
            assert r2["fallback_level"] == 0, f"실모델인데 폴백: {r2['notes']}"
            assert all(a["rationale"].strip() for a in r2["alternatives"]), r2
        else:
            print("\n── ② 실 LLM 선택 — LLM_PROVIDER 미설정, 생략 (성공 유지)")

        ghost = json.dumps({"selections": [{"poiId": "tourapi-000000", "reason": "환각"}]})
        r3 = run("③ 풀 밖 id 응답 → 게이트 드롭 → 규칙 랭킹", store, pool, CannedLlm(ghost))
        assert r3["fallback_level"] == 1, r3
        assert any("alternative_fallback" in n for n in r3["notes"]), r3

        r4 = run("④ LLM 장애 → 규칙 랭킹", store, pool, FailingLlm())
        assert r4["fallback_level"] == 1, r4
        assert any("alternative_fallback" in n for n in r4["notes"]), r4

        r5 = run("⑤ 후보 전량 제외 → 대안 0 + 사유", store, pool,
                 excluded=frozenset(p.poi_id for p in pool.pois))
        assert r5["alternatives"] == [] and r5["empty_reason"] == "no_candidates", r5
    finally:  # 실 collection(persona 등)에 스모크 문서를 남기지 않는다
        for doc in docs:
            store.delete(KB_COLLECTIONS[doc.kb], doc.doc_id)

    print("\n✅ PlanB 리허설 통과 — INV-1·INV-2·INV-3·INV-4 위반 없음")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
