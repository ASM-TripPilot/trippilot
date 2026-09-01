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

**임베딩**: `EMBEDDING_MODEL` 을 주면 로컬 실모델(기본 KURE-v1, 1024차원 한국어),
없으면 결정론 해시로 돈다. 해시에는 의미 유사도가 없어 R 단계에서 검증되는 것이
**배선**(collection 배정·kb 재태깅·부분 실패 격리)뿐이므로, 검색 품질까지 보려면
모델을 켜라. 멘토 게이트웨이에는 임베딩 배포가 없다(404 DeploymentNotFound,
2026-08-21 실측) — 그래서 원격이 아니라 로컬 모델이다. 스토어는 어느 쪽이든 실물
pgvector 라 어댑터 왕복은 진짜로 밟는다.

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
    EMBEDDING_MODEL          로컬 임베딩 모델명. 값 없으면 해시. "1" 이면 기본 KURE-v1.
                             켜려면 `uv pip install sentence-transformers` (의존성에 없음)
    TRIPPILOT_LLM_FEATURE_MODELS  기능별 모델 오버라이드 — 운영과 같은 값을 읽는다.
                             예: ALTERNATIVE_SELECTION=gpt-5.6-sol (PlanB 만 상위 모델)
    LLM env                  smoke_llm.py 와 동일. 미설정이면 시나리오 ②만 생략(성공 유지).

종료 코드: 0 = 5종(또는 ② 생략 시 4종) 통과 / 1 = 계약 위반·실행 실패 / 2 = 사전조건 미충족
"""

from __future__ import annotations

import hashlib
import json
import logging
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
    SavedPlace,
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
from trippilot.llm_gateway.feature_model_env import (  # noqa: E402
    ENV_VAR as FEATURE_MODELS_ENV,
    feature_models_from_env,
)
from trippilot.llm_gateway.gateway import GatewayFacade  # noqa: E402
from trippilot.llm_gateway.prompts import PromptRegistry  # noqa: E402
from trippilot.ports.llm_port import LlmResponse  # noqa: E402
from trippilot.solver_engine.config import RAIN_OUTDOOR  # noqa: E402
from trippilot.api.wiring import LoggingTrace  # noqa: E402

DIM = 1024  # kb_vectors DDL 고정 (docker/vector-init/01-kb-vectors.sql)
NOW = datetime.now(timezone.utc)
TID = TraceId("smoke-planb")
POOL_SIZE = 8
# saved_places 가 고르는 '실내 하위 2곳' 이 풀 상위 2곳과 겹치지 않으려면 실내 ≥ 4 여야 한다
# (n=3 이면 1곳 겹치고, n=2 면 완전히 같다). 겹치면 시나리오 ① 단언이 KB 검색 없이도
# 통과한다 — 조용히 옛 결함으로 돌아가는 경로라 풀 생성 시점에 끊는다.
MIN_INDOOR = 4
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


def build_embedding():
    """EMBEDDING_MODEL 있으면 로컬 실모델, 없으면 해시. 모델 로드는 여기(조립 진입점)만."""
    name = os.environ.get("EMBEDDING_MODEL")
    if not name:
        return HashEmbedding()
    try:
        from sentence_transformers import SentenceTransformer
    except ModuleNotFoundError as e:  # 의존성에 없다(의도) — 되살리는 명령을 바로 준다
        raise SystemExit(
            "sentence-transformers 미설치 — `uv pip install sentence-transformers`.\n"
            "  프로젝트 의존성이 아니라서 `uv sync` 하면 다시 지워진다 (boto3 선례).\n"
            "  EMBEDDING_MODEL 을 비우면 해시 임베딩으로 계속 돌아간다."
        ) from e

    from trippilot.llm_gateway.adapters.sentence_transformer_embedding import (
        DEFAULT_MODEL,
        SentenceTransformerEmbeddingAdapter,
    )

    model_name = DEFAULT_MODEL if name == "1" else name
    print(f"임베딩 모델 로드: {model_name} (최초 실행은 내려받느라 오래 걸린다)")
    return SentenceTransformerEmbeddingAdapter(SentenceTransformer(model_name))


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
    # 품질 필터 — 실 풀 빌더(poi_curation/pool_builder.py)와 같은 규칙. domain/poi.py 정본:
    # "MINIMAL 은 후보 풀에서 제외 (M7 필터)". 안 거르면 실서비스에 못 들어올 POI 로 리허설을 돈다.
    here = [p for p, r in entries if r == region and p.quality is not DataQuality.MINIMAL]
    indoor = [p for p in here if p.category.value in INDOOR][:5]
    outdoor = [p for p in here if p.category.value not in INDOOR][: POOL_SIZE - len(indoor)]
    pois = tuple(indoor + outdoor)
    if len(pois) < 3:
        raise SystemExit(f"{region} POI 부족({len(pois)}곳) — SMOKE_REGION 을 바꿔라")
    if len(indoor) < MIN_INDOOR:
        raise SystemExit(
            f"{region} 실내 POI {len(indoor)}곳 — 리허설이 성립하지 않는다(≥{MIN_INDOOR} 필요). "
            "저장 장소(실내 하위 2곳)가 풀 상위와 겹쳐 시나리오 ① 단언이 공허해진다. "
            "SMOKE_REGION 을 실내 POI 가 더 많은 곳으로."
        )
    return CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=NOW
    )


def saved_places(pool: CandidatePool) -> list:
    """KB-2 가 '저장 장소'로 가리킬 POI — **풀 하위**에서 뽑는다.

    풀 상위에서 뽑으면 안 된다. 규칙 랭킹은 KB-2 히트가 0건이어도 풀 순서로 떨어지므로,
    저장 장소가 곧 풀 상위면 "KB-2 가 순위를 바꿨다"와 "그냥 풀 순서대로 나왔다"가
    구별되지 않는다 — 시나리오 ①의 단언이 KB-2 검색을 아예 안 해도 통과하게 된다.
    """
    indoor = [p for p in pool.pois if p.category.value in INDOOR]
    return indoor[-2:]


def kb_documents(pool: CandidatePool) -> list[KbDocument]:
    """KB 3종 중 **벡터에 넣는 것만** — 일정(KB-1)·상황(KB-3).

    KB-2(저장 장소)는 더 이상 여기서 지어내지 않는다 (TRIP-512). 프로덕션에서 저장 장소는
    백엔드가 **요청 봉투**(`AlternativesRequest.saved_places`)로 실어 보내므로, 리허설도
    같은 경로를 타야 한다 — 픽스처로 벡터를 채우면 프로덕션의 "데이터 0건"을 초록으로
    가린다(anti-patterns 테스트 절).
    """
    return [
        KbDocument(KbKind.SCHEDULE, f"{DOC_PREFIX}-sched-1",
                   "오후 야외 산책 슬롯 (고정 아님, 대체 가능)", None, {}),
        KbDocument(KbKind.SITUATION, f"{DOC_PREFIX}-situ-1",
                   "오후 강수확률 80%, 강풍주의보 — 실외 활동 부적합", None, {}),
    ]


def saved_envelope(pool: CandidatePool) -> tuple[SavedPlace, ...]:
    """백엔드가 보낼 저장 장소 봉투를 흉내 낸다 (TRIP-512).

    풀 **하위** 실내 2곳을 고른다 — 상위에서 뽑으면 규칙 랭킹이 저장 장소를 안 봐도 같은
    순서가 나와 단언이 공허해진다(그 커플링으로 한 번 데인 자리다).
    """
    return tuple(
        SavedPlace(poi_id=str(p.poi_id), name=p.name) for p in saved_places(pool)
    )


# ── 실행 ────────────────────────────────────────────────────────────────


def pipeline(store, embedding, llm, model_id: str | None) -> PlanBRagPipeline:
    mid = model_id or "unused"
    gateway = None if llm is None else GatewayFacade(
        llm, PromptRegistry(PROMPTS), AlternativeSelectionGate(),
        C1Config(
            model_ids={ModelTier.LIGHT: mid, ModelTier.HEAVY: mid},
            # 운영과 같은 기능별 오버라이드를 읽는다 — 리허설이 자기만의 모델을 태우면
            # "운영은 sol, 리허설은 terra" 가 조용히 생긴다 (TRIPPILOT_LLM_FEATURE_MODELS).
            feature_models=feature_models_from_env(),
            # **운영 기본을 그대로 쓴다.** 종전엔 30s 로 덮어썼는데, 그래서 운영에서
            # 100% 타임아웃하던 gpt-5.6-sol(5.1s)이 리허설에선 늘 통과했다 —
            # 리허설 통과가 컨테이너 동작의 증거가 아니게 만든 원인이다.
            # ALTERNATIVE_SELECTION 은 아래 SMOKE_DEADLINE_MS 에서 유도한 마감이
            # 이 기본값을 덮으므로(운영과 같은 경로), 이 값은 다른 feature 용이다.
            timeout_sec=float(os.environ.get("SMOKE_TIMEOUT_SEC", "2.5")),
            max_tokens=int(os.environ.get("SMOKE_MAX_TOKENS", "2048")),
            temperature=float(os.environ.get("SMOKE_TEMPERATURE", "1.0")),
        ),
        LoggingTrace(),
    )
    return PlanBRagPipeline(
        embedding, store, alternative_gateway=gateway,
        config=PlanBRagConfig(max_alternatives=3),
    )


def assert_no_outdoor_on_top(result: dict, pool: CandidatePool, title: str) -> None:
    """폴백(reason=weather)이 야외를 상위에 올리지 않는다 — TRIP-532 의 실데이터 확인.

    실내 후보가 max_alternatives 이상이면 상위 전부가 비야외여야 한다. 이 검사는 픽스처
    저장 장소에 기대지 않는다 — 규칙 랭킹의 카테고리 강등 자체를 본다.
    """
    cat = {str(p.poi_id): p.category for p in pool.pois}
    indoor_count = sum(1 for p in pool.pois if p.category not in RAIN_OUTDOOR)
    top = [cat[a["poi_ids"][0]] for a in result["alternatives"]]
    if indoor_count >= len(top):
        leaked = [c.value for c in top if c in RAIN_OUTDOOR]
        assert not leaked, f"{title}: 비 사유 폴백이 야외를 상위에 올렸다 {leaked}"
    if any(p.category in RAIN_OUTDOOR for p in pool.pois):
        assert any("후순위" in n for n in result["notes"]), (
            f"{title}: 야외가 풀에 있는데 강등 기록이 없다 {result['notes']}"
        )


def run(title, store, embedding, pool, llm=None, model_id=None, excluded=frozenset(),
        saved=()) -> dict:
    result = pipeline(store, embedding, llm, model_id).run(
        PlanBRagRequest(
            trigger=TriggerParams(TriggerKind.WEATHER, ScheduleId("smoke-planb-1"),
                                  date.today(), {"pop": 80}),
            reason="weather", pool=pool, trace_id=TID, now=NOW, excluded_poi_ids=excluded,
            saved_places=saved,
            # 운영과 같은 예산 관통 — 백엔드가 request_meta.deadline_ms 로 보내는 값을
            # 그대로 흉내낸다. 이게 없으면 게이트웨이 기본(2.5s)이 걸려, 상위 티어
            # 모델을 쓰는 리허설이 운영과 다른 결과를 낸다.
            deadline_ms=int(os.environ.get("SMOKE_DEADLINE_MS", "20000")),
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
    # LoggingTrace 가 GateDropEvent·FallbackEvent·LlmCallRecord 를 logger.info 로 낸다.
    # basicConfig 가 없으면 한 줄도 안 찍혀서, INV-1 드롭이 실제로 일어났는지를
    # 사람이 눈으로 확인할 방법이 없다.
    logging.basicConfig(level=logging.INFO, format="   %(message)s")

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

    llm_ran = False
    store = PgVectorStore(lambda: psycopg.connect(dsn))
    docs = kb_documents(pool)
    embedding = build_embedding()
    try:
        print(f"KB 적재 {index_documents(docs, embedding, store)}건 (실 pgvector — KB-1·KB-3)")
        saved = saved_envelope(pool)
        print(f"저장 장소 봉투 {len(saved)}건 (TRIP-512 — 백엔드가 보낼 형태): "
              + ", ".join(s.name for s in saved))

        r1 = run("① 게이트웨이 미주입 → 규칙 랭킹", store, embedding, pool, saved=saved)
        assert r1["fallback_level"] == 1, r1
        assert any("alternative_gateway_absent" in n for n in r1["notes"]), r1
        assert_no_outdoor_on_top(r1, pool, "①")
        # **R 단계가 실제로 돌았는지 먼저 건다.** 아래 KB-2 단언은 pgvector 가 통째로
        # 죽어 히트 0건이어도 통과한다 — 풀 순서(indoor 우선)와 저장 장소가 같아서
        # _rule_ranking 이 히트 없이도 같은 상위 2개를 내기 때문이다. 검색 실패를
        # 구분하는 건 retrieved 건수와 retrieve_*_error 노트뿐이다.
        assert all(n.count("retrieve_") == 0 for n in r1["notes"]), (
            f"KB 검색이 실패했다 — 실 pgvector 관통이 아니다: {r1['notes']}"
        )
        # PERSONA(KB-2)는 제외한다 — 저장 장소는 벡터가 아니라 봉투로 온다 (TRIP-512).
        # 벡터 KB-2 는 메모·리뷰 데이터가 생길 때를 위해 경로만 남겨 둔 상태라 0건이 정상이다.
        assert all(r1["retrieved"].get(kb, 0) > 0 for kb in ("SCHEDULE", "SITUATION")), (
            f"KB-1·KB-3 중 히트 0건인 것이 있다 — collection 배정·적재를 확인하라: {r1['retrieved']}"
        )
        assert {a["poi_ids"][0] for a in r1["alternatives"][:len(saved)]} == {
            sp.poi_id for sp in saved
        }, f"봉투 저장 장소가 상위를 차지하지 않았다 (TRIP-512): {r1['alternatives']}"
        # KB-2 저장 장소 2곳이 규칙 랭킹 상위를 차지한다. 둘 사이의 순서는 고정하지
        # 않는다 — 해시 임베딩엔 의미 순위가 없어 검색 순서가 임의(결정론이되 임의)다.
        saved_ids = {str(p.poi_id) for p in saved_places(pool)}
        assert {a["poi_ids"][0] for a in r1["alternatives"][:2]} == saved_ids, (
            "KB-2 저장 장소가 규칙 랭킹 상위 2순위여야 한다"
        )

        if os.environ.get("LLM_PROVIDER"):
            llm_ran = True
            adapter, model_id = _build_adapter()
            from trippilot.domain.llm import LlmFeature

            effective = feature_models_from_env().get(
                LlmFeature.ALTERNATIVE_SELECTION, model_id)
            r2 = run(f"② 실 LLM 선택 (model={effective})", store, embedding, pool, adapter, model_id)
            assert r2["fallback_level"] == 0, f"실모델인데 폴백: {r2['notes']}"
            assert all(a["rationale"].strip() for a in r2["alternatives"]), r2
        else:
            print("\n── ② 실 LLM 선택 — LLM_PROVIDER 미설정, 생략 (성공 유지)")

        ghost = json.dumps({"selections": [{"poiId": "tourapi-000000", "reason": "환각"}]})
        r3 = run("③ 풀 밖 id 응답 → 게이트 드롭 → 규칙 랭킹", store, embedding, pool, CannedLlm(ghost),
                 saved=saved)
        assert r3["fallback_level"] == 1, r3
        # 사유까지 특정한다. "alternative_fallback" 만 보면 parse_error·timeout·llm_error
        # 까지 삼켜 ④와 단언이 문자 그대로 같아진다 — 게이트 스키마가 드리프트해
        # INV-1 출구 게이트가 무력화돼도 이 시나리오가 초록이 된다.
        assert any("gate_dropped_all" in n for n in r3["notes"]), (
            f"게이트가 풀 밖 id 를 드롭한 것이 아니다(다른 사유로 폴백): {r3['notes']}"
        )
        assert_no_outdoor_on_top(r3, pool, "③")

        r4 = run("④ LLM 장애 → 규칙 랭킹", store, embedding, pool, FailingLlm(), saved=saved)
        assert r4["fallback_level"] == 1, r4
        assert any("llm_error" in n for n in r4["notes"]), (
            f"LLM 장애가 아닌 다른 사유로 폴백했다: {r4['notes']}"
        )
        assert_no_outdoor_on_top(r4, pool, "④")

        r5 = run("⑤ 후보 전량 제외 → 대안 0 + 사유", store, embedding, pool,
                 excluded=frozenset(p.poi_id for p in pool.pois))
        assert r5["alternatives"] == [] and r5["empty_reason"] == "no_candidates", r5
    finally:  # 실 collection(persona 등)에 스모크 문서를 남기지 않는다
        for doc in docs:
            store.delete(KB_COLLECTIONS[doc.kb], doc.doc_id)

    # ②를 건너뛰면 **실 LLM 산출물에 INV-1 을 건 시나리오가 0개**다(나머지는 전부
    # 규칙 랭킹 산출이라 정의상 풀 안). 배너가 그 사실을 감추지 않게 한다.
    ran = "5종" if llm_ran else "4종(② 생략 — LLM_PROVIDER 미설정)"
    scope = "INV-1·INV-2·INV-3·INV-4" if llm_ran else "INV-3·INV-4 (실 LLM 산출 INV-1 미검증)"
    print(f"\n✅ PlanB 리허설 통과 — {ran} · {scope} 위반 없음")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
