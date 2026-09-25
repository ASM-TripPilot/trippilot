"""요금 수집의 **키 퇴출**이 실제로 도는지 — 실 호출 0.

왜 테스트로 확인하나: 1차 수집이 죽은 키 하나에 900콜을 쏟아 실패율 32.4% 로
**실행 전체가 버려졌다.** 퇴출 로직을 넣었지만 "넣었으니 되겠지"는 이 리포에서
이미 두 번 틀렸다(`| tee` 가 종료 코드를 삼켜 가드가 안 닿음 · 제외 규칙이 진짜
입장료를 버림). **실 API 로 100콜 태워 보는 것보다 여기서 무는 게 싸고 영구적이다.**
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import collect_place_fees as C  # noqa: E402


def _doc(n: int) -> dict:
    return {"proposals": [
        {"provenance": {"content_id": str(i), "content_type_id": "12"}}
        for i in range(n)
    ]}


def _run(tmp_path: Path, monkeypatch, *, n: int, max_calls: int,
         dead: set[str], keys=("K0", "K1", "K2")) -> tuple[int, Counter, dict]:
    """(종료코드, 키별 호출수, 산출물). `dead` 에 든 키는 항상 _KeyDead 를 낸다."""
    doc_p, out_p = tmp_path / "doc.json", tmp_path / "out.json"
    doc_p.write_text(json.dumps(_doc(n)), encoding="utf-8")
    used: Counter = Counter()

    def fake_get(endpoint, params, key):
        used[key] += 1
        if key in dead:
            raise C._KeyDead("HTTP 403 — 키 소진/거부")
        return [{"infoname": "입 장 료", "infotext": "무료"}]

    monkeypatch.setattr(C, "_get", fake_get)
    for i, name in enumerate(("TOUR_API_KEY", "TOUR_API_KEY2", "TOUR_API_KEY3")):
        monkeypatch.setenv(name, keys[i])
    monkeypatch.setattr(sys, "argv", [
        "x", "--doc", str(doc_p), "--out", str(out_p), "--max-calls", str(max_calls)])

    code = C.main()
    got = json.loads(out_p.read_text(encoding="utf-8")) if out_p.exists() else {}
    return code, used, got


def test_죽은_키는_첫_호출에_퇴출된다(tmp_path: Path, monkeypatch) -> None:
    """**이것이 1차 실패의 재현이다** — 회전이 죽은 키에 900콜을 보냈다.

    퇴출이 돌면 죽은 키는 딱 1콜만 먹고 나머지는 산 키가 받는다.
    """
    code, used, got = _run(tmp_path, monkeypatch, n=50, max_calls=50, dead={"K0"})

    assert used["K0"] == 1, "죽은 키가 1콜 넘게 먹었다 — 퇴출이 안 돈다"
    assert used["K1"] == 49           # 같은 POI 재시도 + 나머지 전부
    assert code == 0                  # 퇴출은 실패가 아니다 — 게이트에 안 걸린다
    assert len(got["fees"]) == 49     # 퇴출이 예산 1콜을 먹어 49건 (50 − 1)
    # 1차 실패와의 대비: 같은 상황에서 종전 코드는 죽은 키에 900콜을 쏟았다.


def test_가운데_키가_죽어도_뒤_키로_이어간다(tmp_path: Path, monkeypatch) -> None:
    """1차 실측 모양 — 앞 키는 멀쩡, 가운데가 죽음, 뒤는 멀쩡."""
    code, used, _ = _run(tmp_path, monkeypatch, n=30, max_calls=30, dead={"K1"})

    # K0 가 살아 있으므로 K1 에 닿을 일이 없다 — 퇴출 이전에 회전 자체가 없다
    assert used["K0"] == 30 and used["K1"] == 0
    assert code == 0


def test_키가_전부_죽으면_진행분을_남기고_멈춘다(tmp_path: Path, monkeypatch) -> None:
    """계속 돌면 100% 실패로 게이트에 걸려 **그날 수집이 통째로 날아간다.**"""
    code, used, got = _run(tmp_path, monkeypatch, n=100, max_calls=100,
                           dead={"K0", "K1", "K2"})

    assert sum(used.values()) == 3, "전부 죽었는데 계속 때렸다"
    assert code == 0                  # 실패가 아니라 조기 종료다
    assert got["fees"] == {}          # 받은 게 없으니 비어 있고, 파일은 쓴다


def test_이어가기는_기수집분을_건너뛴다(tmp_path: Path, monkeypatch) -> None:
    """여러 날에 나눠 받으므로 이게 깨지면 같은 POI 를 매일 다시 부른다."""
    doc_p, out_p = tmp_path / "doc.json", tmp_path / "out.json"
    doc_p.write_text(json.dumps(_doc(10)), encoding="utf-8")
    out_p.write_text(json.dumps({
        "source": "x", "fetched_at": "2026-09-24", "attempted": 10,
        "fees": {str(i): {"won": 0, "raw": "무료"} for i in range(6)},
    }, ensure_ascii=False), encoding="utf-8")

    used: Counter = Counter()

    def fake_get(endpoint, params, key):
        used[params["contentId"]] += 1
        return [{"infoname": "입 장 료", "infotext": "무료"}]

    monkeypatch.setattr(C, "_get", fake_get)
    monkeypatch.setenv("TOUR_API_KEY", "K0")
    monkeypatch.setattr(sys, "argv", [
        "x", "--doc", str(doc_p), "--out", str(out_p), "--max-calls", "100"])

    assert C.main() == 0
    assert set(used) == {"6", "7", "8", "9"}, "기수집분을 다시 불렀다"
    assert len(json.loads(out_p.read_text(encoding="utf-8"))["fees"]) == 10


def test_실패율이_높으면_산출물을_쓰지_않는다(tmp_path: Path, monkeypatch) -> None:
    """오염된 반쪽 파일이 소비 측으로 넘어가는 것을 막는 게이트."""
    doc_p, out_p = tmp_path / "doc.json", tmp_path / "out.json"
    doc_p.write_text(json.dumps(_doc(20)), encoding="utf-8")

    def fake_get(endpoint, params, key):
        raise RuntimeError("vendor down")   # 키 문제가 아닌 일반 실패

    monkeypatch.setattr(C, "_get", fake_get)
    monkeypatch.setenv("TOUR_API_KEY", "K0")
    monkeypatch.setattr(sys, "argv", [
        "x", "--doc", str(doc_p), "--out", str(out_p), "--max-calls", "20"])

    assert C.main() == 2
    assert not out_p.exists(), "실패율이 임계를 넘었는데 산출물을 썼다"


@pytest.mark.parametrize("code", ["20", "22", "30", "31"])
def test_키_관련_resultCode_도_퇴출_신호다(code: str, monkeypatch) -> None:
    """data.go.kr 은 HTTP 200 에 실패 코드를 실어 보낸다 — 403 만 보면 놓친다."""
    body = {"response": {"header": {"resultCode": code, "resultMsg": "err"}}}

    class _R:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return json.dumps(body).encode()

    monkeypatch.setattr(C.urllib.request, "urlopen", lambda *a, **k: _R())
    with pytest.raises(C._KeyDead):
        C._get("detailInfo2", {"contentId": "1", "contentTypeId": "12"}, "K0")
