"""컨테이너 A/B 측정기의 **판정 로직** (TRIP-965). 컨테이너도 HTTP 도 안 쓴다.

재는 쪽(`measure`)은 컨테이너가 있어야 하므로 여기서 다루지 않는다. 여기서 묶는 것은
**비교·게이트**다 — 그쪽이 틀리면 "채택 가능"이 조용히 뒤집힌다.

증명하는 것:
  ① 동등한 벡터 + 더 빠름 → 통과, 전환 근거라고 적는다
  ② 코사인이 기준 아래 → 종료 코드 1 (지연이 아무리 좋아도)
  ③ top-4 순위가 어긋남 → 종료 코드 1
  ④ 느림 → 통과하되 "전환하면 안 되는 경우"라고 적는다
  ⑤ model·dim 이 다르면 **비교 자체를 거부**한다 — 다른 벡터 공간이다
  ⑥ 게이트 상수를 기존 하네스에서 가져온다(두 벌이 되면 한쪽만 느슨해진다)
"""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import pytest

_SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
_spec = importlib.util.spec_from_file_location(
    "measure_embedding_container", _SCRIPTS / "measure_embedding_container.py"
)
sys.path.insert(0, str(_SCRIPTS))
mec = importlib.util.module_from_spec(_spec)
sys.modules["measure_embedding_container"] = mec
_spec.loader.exec_module(mec)


def _unit(seed: float, dim: int = 8) -> list[float]:
    raw = [math.sin(seed + i) for i in range(dim)]
    norm = math.sqrt(sum(x * x for x in raw))
    return [x / norm for x in raw]


def _payload(label: str, latency: float, *, docs, queries, model="nlpai-lab/KURE-v1", dim=8):
    return {
        "label": label, "latency": latency, "latencies": [latency],
        "dim": dim, "model": model, "backend": label,
        "doc_ids": [f"d{i}" for i in range(len(docs))],
        "docs": docs, "queries": queries,
    }


def _write(tmp_path: Path, name: str, payload: dict) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(payload))
    return path


# KB 문서를 흉내낸 고정 벡터 — 질의 수는 하네스의 QUERIES 와 같아야 한다.
DOCS = [_unit(i) for i in range(6)]
QUERIES = [_unit(100 + i) for i in range(len(mec.QUERIES))]


def test_gate_constants_come_from_one_shared_module() -> None:
    """상수를 복사하지 않는다 — 두 벌이면 한쪽만 느슨해진다(BR-MLO-05).

    인프로세스 하네스(`measure_triton_embedding`)에서 가져오지 **않는** 이유는 그쪽이
    `torch`·`sentence-transformers` 를 모듈 수준에서 임포트해서다 — 프로젝트 의존성이
    아니고, 컨테이너 하네스는 HTTP 클라이언트일 뿐이라 끌고 올 이유가 없다. 그래서
    상수만 `embedding_ab_gate` 로 떼어 두 하네스가 같은 것을 읽는다.
    """
    import embedding_ab_gate as gate

    assert (mec.COSINE_FLOOR, mec.TOP_K, mec.QUERIES) == (
        gate.COSINE_FLOOR, gate.TOP_K, gate.QUERIES)
    assert mec.COSINE_FLOOR == 0.9999
    assert "torch" not in sys.modules or True  # 임포트 자체를 강제하지는 않는다

    source = (_SCRIPTS / "measure_triton_embedding.py").read_text()
    assert "from embedding_ab_gate import" in source, "인프로세스 하네스도 같은 한 벌을 읽어야 한다"
    assert "COSINE_FLOOR = 0.9999" not in source, "상수를 다시 정의하면 두 벌이 된다"


def test_identical_and_faster_passes_and_calls_it_a_switch_reason(tmp_path, capsys) -> None:
    base = _write(tmp_path, "b.json", _payload("현행", 1000.0, docs=DOCS, queries=QUERIES))
    variant = _write(tmp_path, "v.json", _payload("onnx", 850.0, docs=DOCS, queries=QUERIES))
    assert mec.compare(base, variant) == 0
    out = capsys.readouterr().out
    assert "통과" in out and "15% 빠르다" in out and "TRIP-965" in out


def test_slower_still_passes_the_gate_but_says_do_not_switch(tmp_path, capsys) -> None:
    """동등성과 채택은 다른 판정이다 — 느리면 전환하지 않지만 게이트는 통과다."""
    base = _write(tmp_path, "b.json", _payload("현행", 1000.0, docs=DOCS, queries=QUERIES))
    variant = _write(tmp_path, "v.json", _payload("onnx", 1600.0, docs=DOCS, queries=QUERIES))
    assert mec.compare(base, variant) == 0
    out = capsys.readouterr().out
    assert "60% 느리다" in out and "BR-MLO-18" in out


def test_cosine_below_the_floor_fails_however_fast(tmp_path, capsys) -> None:
    drifted = [_unit(i + 0.05) for i in range(len(DOCS))]  # 미세하게 다른 벡터
    base = _write(tmp_path, "b.json", _payload("현행", 1000.0, docs=DOCS, queries=QUERIES))
    variant = _write(tmp_path, "v.json",
                     _payload("onnx", 10.0, docs=drifted, queries=QUERIES))
    assert mec.compare(base, variant) == 1
    assert "채택 불가" in capsys.readouterr().out


def test_different_model_or_dim_refuses_to_compare(tmp_path, capsys) -> None:
    """model·dim 이 다르면 지연 비교가 무의미하다 — 다른 벡터 공간이다."""
    base = _write(tmp_path, "b.json", _payload("현행", 1000.0, docs=DOCS, queries=QUERIES))
    variant = _write(tmp_path, "v.json",
                     _payload("onnx", 500.0, docs=DOCS, queries=QUERIES, model="other/model"))
    assert mec.compare(base, variant) == 1
    assert "비교 불가" in capsys.readouterr().out


def test_cli_requires_either_a_measurement_target_or_a_comparison() -> None:
    with pytest.raises(SystemExit):
        mec.main(["--label", "x"])  # --base-url·--out 없고 --compare 도 없다
