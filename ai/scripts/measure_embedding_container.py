"""임베딩 백엔드 A/B 를 **컨테이너 안의 서빙 코드로** 잰다 (TRIP-965).

## 왜 또 있나 — `measure_triton_embedding.py` 와 무엇이 다른가

그 스크립트는 **인프로세스**다. `onnxruntime` 세션을 측정 코드가 직접 만들고,
그래프도 측정 중에 `export_onnx.py` 로 내보낸 것을 읽는다. 그래서 다음을 **못 잰다**:

  - 이미지에 **구운** 그래프(`EMBEDDING_BAKE_ONNX`) 로 기동하는가
  - 앱 자신의 세션 옵션(`EMBEDDING_ONNX_THREADS` → `intra_op_num_threads`)
  - 파드의 **CPU 한도** 아래에서의 지연 (러너는 코어가 더 많다)
  - FastAPI·토크나이저·HTTP 왕복까지 포함한 `/embed` 한 번의 값

채택 기준이 "컨테이너 실측 후 기본값 전환"(`서빙-의사결정-기록.md` §3 D-3)이라
그 네 가지가 측정 대상 자체다. 여기서는 **컨테이너를 띄워 `/embed` 를 부른다** —
즉 파드가 실제로 하는 일을 잰다.

같은 규약을 지킨다: 워밍업 2회 → 3회 중앙값, 동등성 게이트는 코사인 ≥ 0.9999 ∧
top-4 순위 전부 일치(`measure_triton_embedding` 에서 상수를 가져온다 — 두 벌이 되면
한쪽만 느슨해진다).

## 쓰는 법

백엔드마다 한 번씩 재서 JSON 으로 떨어뜨리고, 마지막에 비교한다.

    python scripts/measure_embedding_container.py --base-url http://localhost:8100 \\
        --label "sentence-transformers (현행)" --out /tmp/st.json
    python scripts/measure_embedding_container.py --base-url http://localhost:8100 \\
        --label "ONNX Runtime (구운 그래프)" --out /tmp/onnx.json
    python scripts/measure_embedding_container.py --compare /tmp/st.json /tmp/onnx.json

컨테이너를 **순차로** 띄우는 이유: 같은 CPU 한도를 두 백엔드가 각자 다 써야 비교가
된다. 동시에 띄우면 서로 코어를 빼앗아 두 숫자 다 못 쓴다.

동등성 미달이면 종료 코드 1 — 벡터가 다르면 지연 이득은 의미가 없다.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from embedding_ab_gate import COSINE_FLOOR, QUERIES, TOP_K  # noqa: E402

KB_PATH = Path(os.environ.get("KB_PATH") or "data/planb_situation_kb.yaml")
WARMUP_ROUNDS = 2
MEASURE_ROUNDS = 3


def _post(base_url: str, texts: list[str], timeout: float = 300.0) -> dict:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/embed",
        data=json.dumps({"texts": texts}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def _wait_until_loaded(base_url: str, timeout: float) -> dict:
    """`/health` 의 `loaded` 가 참이 될 때까지 기다린다.

    파드가 Ready 인데 모델이 아직 안 올라온 창이 수십 초 있다(의도된 설계).
    그 창에서 재면 모델 로드 시간이 지연에 섞여 비교가 무효가 된다.
    """
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url.rstrip('/')}/health", timeout=10) as r:
                last = json.loads(r.read())
            if last.get("loaded"):
                return last
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(2)
    raise SystemExit(f"모델이 {timeout:.0f}초 안에 로드되지 않았다 — 마지막 /health: {last}")


def measure(base_url: str, label: str, out: Path) -> int:
    kb = yaml.safe_load(KB_PATH.read_text(encoding="utf-8"))
    entries = [(d["doc_id"], d["text"]) for d in kb["documents"]]
    doc_ids = [i for i, _ in entries]
    texts = [t for _, t in entries]

    health = _wait_until_loaded(base_url, timeout=900)
    print(f"[{label}] /health: {health}")

    for _ in range(WARMUP_ROUNDS):
        _post(base_url, texts[:4])

    latencies = []
    docs = None
    for _ in range(MEASURE_ROUNDS):
        start = time.perf_counter()
        payload = _post(base_url, texts)
        latencies.append((time.perf_counter() - start) * 1000)
        docs = payload["vectors"]
    median = statistics.median(latencies)
    queries = _post(base_url, list(QUERIES))

    print(f"[{label}] {len(texts)}건 인코딩 {median:,.0f} ms ({MEASURE_ROUNDS}회 중앙값)"
          f" · dim {payload['dim']} · model {payload['model']}")
    out.write_text(json.dumps({
        "label": label,
        "latency": median,
        "latencies": latencies,
        "dim": payload["dim"],
        "model": payload["model"],
        "backend": health.get("backend"),
        "doc_ids": doc_ids,
        "docs": docs,
        "queries": queries["vectors"],
    }))
    print(f"[{label}] → {out}")
    return 0


def _top_k(docs: np.ndarray, queries: np.ndarray, doc_ids: list[str]) -> list[list[str]]:
    return [[doc_ids[i] for i in np.argsort(-(docs @ queries[q]))[:TOP_K]]
            for q in range(len(queries))]


def compare(base_path: Path, variant_path: Path) -> int:
    base = json.loads(base_path.read_text())
    variant = json.loads(variant_path.read_text())

    # 모델·차원이 다르면 지연 비교 자체가 무의미하다 — 다른 벡터 공간이다.
    if (base["model"], base["dim"]) != (variant["model"], variant["dim"]):
        print(f"→ **비교 불가** — model·dim 이 다르다: "
              f"{base['model']}/{base['dim']} vs {variant['model']}/{variant['dim']}")
        return 1

    bd = np.asarray(base["docs"], dtype=np.float32)
    vd = np.asarray(variant["docs"], dtype=np.float32)
    bq = np.asarray(base["queries"], dtype=np.float32)
    vq = np.asarray(variant["queries"], dtype=np.float32)

    cosine = np.sum(bd * vd, axis=1) / (
        np.linalg.norm(bd, axis=1) * np.linalg.norm(vd, axis=1))
    base_rank = _top_k(bd, bq, base["doc_ids"])
    variant_rank = _top_k(vd, vq, variant["doc_ids"])
    same = sum(a == b for a, b in zip(base_rank, variant_rank))
    positions = sum(1 for a, b in zip(base_rank, variant_rank)
                    for x, y in zip(a, b) if x == y)

    print("\n## 컨테이너 안 실측 — 현행 대비\n")
    print("| 백엔드 | `/health` backend | 지연 | 지연비 | 코사인 최소 | top4 순위 |")
    print("|---|---|---:|---:|---:|---|")
    print(f"| {base['label']} | `{base['backend']}` | {base['latency']:,.0f} ms "
          f"| 1.00× | 1.00000 | 기준 |")
    print(f"| {variant['label']} | `{variant['backend']}` | {variant['latency']:,.0f} ms "
          f"| {variant['latency'] / base['latency']:.2f}× | {cosine.min():.5f} "
          f"| {same}/{len(QUERIES)} 질의 ({positions}/{len(QUERIES) * TOP_K} 위치) |")
    for query, a, b in zip(QUERIES, base_rank, variant_rank):
        if a != b:
            print(f"    순위 차이 — {query}\n      현행: {a}\n      변형: {b}")

    ok_cosine = bool(cosine.min() >= COSINE_FLOOR)
    ok_rank = same == len(QUERIES)
    print(f"\n동등성: 코사인 최소 {cosine.min():.5f} (기준 ≥ {COSINE_FLOOR}) "
          f"{'통과' if ok_cosine else '실패'} · "
          f"top-4 순위 {same}/{len(QUERIES)} {'통과' if ok_rank else '실패'}")
    if not (ok_cosine and ok_rank):
        print("→ **채택 불가** — 벡터가 다르면 지연 이득은 의미가 없다.")
        return 1

    ratio = variant["latency"] / base["latency"]
    print("→ 동등성 전제 충족.")
    if ratio < 1.0:
        print(f"→ 컨테이너 안에서도 변형이 **{(1 - ratio) * 100:.0f}% 빠르다** — "
              "기본값 전환 근거가 된다(TRIP-965).")
    else:
        print(f"→ 컨테이너 안에서는 변형이 **{(ratio - 1) * 100:.0f}% 느리다** — "
              "네이티브 숫자로 전환하면 안 되는 경우다(BR-MLO-18 이 경고한 그 뒤집힘).")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", help="측정할 임베딩 서비스 주소")
    parser.add_argument("--label", default="측정", help="표에 찍을 이름")
    parser.add_argument("--out", type=Path, help="측정 결과 JSON 경로")
    parser.add_argument("--compare", nargs=2, type=Path, metavar=("BASE", "VARIANT"),
                        help="두 측정 JSON 을 비교하고 동등성 게이트를 적용한다")
    args = parser.parse_args(argv)

    if args.compare:
        return compare(*args.compare)
    if not (args.base_url and args.out):
        parser.error("--base-url 과 --out 을 함께 주거나 --compare 를 쓴다")
    return measure(args.base_url, args.label, args.out)


if __name__ == "__main__":
    raise SystemExit(main())
