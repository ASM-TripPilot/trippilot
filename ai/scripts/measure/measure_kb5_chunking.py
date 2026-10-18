r"""KB-5 청킹 효과 측정 — "도입부 앞 160자"(종전) vs "질의에 맞은 조각"(청킹).

실행(로컬 임베딩 서비스 + OpenAI 키):
    TRIPPILOT_EMBEDDING_BASE_URL=http://localhost:8100 OPENAI_API_KEY=... \
        uv run python scripts/measure/measure_kb5_chunking.py [표본 장소 수=120] [판정 모델=gpt-5.6-luna]

**무엇을 재나.** Plan-B 가 실제로 쓰는 상황 질의(`rag._situation_query` 와 같은 꼴) 마다, 같은 장소에 대해
두 방식이 후보 줄에 붙일 글을 만들고 **LLM 판정자가 순서를 모른 채** "이 상황에서 이 장소를 넣을지
판단하는 데 어느 쪽이 더 도움이 되나"를 고른다(A·B·같음). 판정자는 평가에만 쓴다 — 그 출력으로 어떤
모델도 학습하지 않는다(팀 결정 2026-09-08).

보조 지표: 청킹 쪽이 **도입부가 아닌 조각**을 고른 비율(= 종전 방식이면 볼 수 없던 근거를 보여 준 비율).
"""

from __future__ import annotations

import gzip
import json
import os
import pathlib
import random
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "src"))

from trippilot.poi_curation.chunking import chunk_document  # noqa: E402

_ROOT = pathlib.Path(__file__).resolve().parents[2]
_CORPUS = _ROOT / "data" / "place_corpus_wiki.jsonl.gz"
_BASELINE_CHARS = 160  # 종전 place_knowledge.MAX_DOC_CHARS

# (트리거, 사유 한국어, 사용자 말) — rag._situation_query 와 같은 꼴: "{kind} {reason} 상황 {말}"
_QUERIES = (
    ("WEATHER", "날씨 악화", ""),
    ("WEATHER", "날씨 악화", "비 와서 실내로"),
    ("CLOSURE", "휴무·폐점", ""),
    ("DELAY", "지연", "시간이 별로 없어"),
    ("MANUAL", "피로", "다리 아파서 덜 걷는 곳"),
    ("MANUAL", "사용자 요청 교체", "아이랑 같이 갈 만한 곳"),
)


def _embedder():
    from trippilot.llm_gateway.adapters.http_embedding_assembly import http_embedding
    from trippilot.poi_curation.adapters.backend_poi_db import UrllibJsonClient

    return http_embedding(SystemExit, lambda t: UrllibJsonClient(timeout_sec=t), timeout_sec=180.0)


def _cos(a, b) -> float:
    return sum(x * y for x, y in zip(a, b))  # 서비스가 정규화 벡터를 준다


def _judge(client, model: str, situation: str, name: str, a: str, b: str) -> str:
    prompt = (
        f"여행 중 일정을 다시 짜는 상황입니다: \"{situation}\".\n"
        f"후보 장소 '{name}' 에 대해 아래 두 설명이 있습니다. 이 상황에서 이 장소를 일정에 넣을지 말지 "
        "판단하는 데 **더 도움이 되는** 설명을 고르세요. 둘이 비슷하면 '같음'.\n\n"
        f"A: {a}\n\nB: {b}\n\n답은 A, B, 같음 중 하나만 쓰세요."
    )
    out = client.chat.completions.create(model=model, messages=[{"role": "user", "content": prompt}])
    text = (out.choices[0].message.content or "").strip()
    return "A" if text.startswith("A") else "B" if text.startswith("B") else "="


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 120
    model = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("JUDGE_MODEL", "gpt-5.6-luna")
    rows = [json.loads(line) for line in gzip.open(_CORPUS, "rt", encoding="utf-8") if line.strip()]
    # 비교가 의미 있는 것만: 조각이 둘 이상(골라야 할 게 있는 문서)
    rows = [r for r in rows if len(chunk_document(r)) >= 2]
    random.Random(20261018).shuffle(rows)
    rows = rows[:n]
    emb = _embedder()

    import openai

    client = openai.OpenAI()
    chunks = {r["doc_id"]: chunk_document(r) for r in rows}
    vecs = {}
    all_docs = [d for ds in chunks.values() for d in ds]
    for i in range(0, len(all_docs), 32):
        batch = all_docs[i:i + 32]
        for d, v in zip(batch, emb.embed_batch([d.text for d in batch])):
            vecs[d.doc_id] = v

    wins = {"chunk": 0, "baseline": 0, "tie": 0}
    deeper = 0
    total = 0
    rng = random.Random(7)
    for kind, reason, said in _QUERIES:
        q = f"{kind} {reason} 상황{(' ' + said) if said else ''}"
        qv = emb.embed_batch([q])[0]
        for r in rows:
            docs = chunks[r["doc_id"]]
            best = max(docs, key=lambda d: (_cos(qv, vecs[d.doc_id]), -d.metadata["chunk"]))
            intro = next((s["text"] for s in r["sections"] if s["heading"] == "개요"), r["sections"][0]["text"])
            baseline = intro[:_BASELINE_CHARS]
            deeper += best.metadata["chunk"] != 0
            swap = rng.random() < 0.5
            a, b = (best.text, baseline) if not swap else (baseline, best.text)
            v = _judge(client, model, f"{reason}{(' — ' + said) if said else ''}", r["title"], a, b)
            winner = "tie" if v == "=" else ("chunk" if (v == "A") != swap else "baseline")
            wins[winner] += 1
            total += 1
        print(f"  {q:40s} 누적 청킹 {wins['chunk']} · 종전 {wins['baseline']} · 같음 {wins['tie']}")
    print(f"\n장소 {len(rows)} × 질의 {len(_QUERIES)} = {total}판 (판정 {model})")
    for k, v in wins.items():
        print(f"  {k:8s} {v:4d}  {v / total:.1%}")
    print(f"  도입부가 아닌 조각을 보여 준 비율: {deeper / total:.1%}")


if __name__ == "__main__":
    main()
