"""경계가 계약에 있는데 **실 배선에 핸들러가 없으면** 부르는 순간 503 이다.

`routes.py` 는 핸들러를 `getattr(orchestrator, "<name>", None)` 으로 찾고 없으면
`orchestrator_not_wired()` 를 올린다. 그 설계 자체는 옳다 — 빈 산출물로 위장하지
않고 명시 실패한다(INV-4). **문제는 그 상태가 CI 를 통과한다는 것이다.**

실측(2026-09-24): `/ai/v1/itinerary/replan` 이 실 배선에서 100% 503 인데
`tests/test_api_replan.py` 8건이 전부 초록이었다 — 8건 모두 `create_app()` +
`get_orchestrator` 오버라이드 **스텁**을 쓰고, 그 파일에 `build_dev_app` 참조가
0건이다. 계약(`docs/openapi.json`)에는 경로가 출하돼 있어 계약 게이트도 통과한다.
즉 **경로는 광고되고 핸들러는 없는데 아무 게이트도 안 걸렸다.**

이 파일은 그 간극을 **선언으로** 바꾼다. 미배선은 있어도 되지만 `_KNOWN_UNWIRED` 에
사유와 함께 적혀 있어야 한다 — 그러면 (a) 새 경계를 배선 없이 추가하면 빨개지고
(b) 배선이 끝나면 목록에서 지우게 되고 (c) 목록 자체가 "지금 부르면 503 인 것"의
정본이 된다.
"""

from __future__ import annotations

import ast
import pathlib

from trippilot.api.wiring import build_dev_app

# 부르면 503 인 경계 — **사유와 함께 적는다.** 배선되면 지운다.
_KNOWN_UNWIRED: dict[str, str] = {
    "replan": (
        "계약만 출하됨 (커밋 524bf03f, A-4 절반). 하루 전체 재계획은 선호 점수 단계가 "
        "필요한데 그것은 ScheduleAgent 소유이고, 배선 층에서 복제하면 REPLAN 정보 "
        "요구표 작업이 곧 지운다는 판단으로 미뤘다. 백엔드는 이 503 을 "
        "`ORCHESTRATOR_NOT_WIRED` 로 알아보고 `legacyReplanViaGenerate` 로 내려가므로 "
        "사용자에게 빈 화면이 아니라 **재계획 의도 5종이 버려진 일정**이 간다."
    ),
}


def _handler_names() -> tuple[str, ...]:
    """`routes.py` 가 실제로 찾는 핸들러 이름 — 소스를 AST 로 읽는다.

    목록을 따로 손으로 두면 라우트와 갈라진다(이 리포에서 배정표를 손으로 둔 탓에
    읽기/쓰기가 다른 이름을 쓴 사고가 있었다). 라우트가 정본이다.
    """
    src = pathlib.Path(__file__).resolve().parents[1] / "src/trippilot/api/routes.py"
    found: list[str] = []
    for node in ast.walk(ast.parse(src.read_text(encoding="utf-8"))):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "getattr" and len(node.args) >= 2
                and isinstance(node.args[0], ast.Name) and node.args[0].id == "orchestrator"
                and isinstance(node.args[1], ast.Constant)):
            found.append(str(node.args[1].value))
    return tuple(sorted(set(found)))


def test_라우트가_찾는_핸들러를_실제로_뽑아낸다() -> None:
    """추출이 0건이면 아래 게이트가 **아무것도 안 검사한다** — 먼저 그걸 막는다.

    `getattr` 스타일이 바뀌면 조용히 빈 목록이 되고, 그러면 게이트가 항상 초록이다.
    """
    names = _handler_names()
    assert len(names) >= 6, f"핸들러 추출 실패 — {names}. routes.py 의 조회 방식이 바뀌었나"
    assert "replan" in names  # 알려진 대표 사례가 잡히는지


def test_미배선_경계는_목록에_적혀_있어야_한다() -> None:
    """새 경계를 배선 없이 추가하면 여기서 걸린다 — 출하 후 503 을 발견하지 않게."""
    orchestrator = build_dev_app().state.orchestrator
    missing = {n for n in _handler_names() if not hasattr(orchestrator, n)}

    undeclared = missing - set(_KNOWN_UNWIRED)
    assert not undeclared, (
        f"실 배선에 핸들러가 없는데 `_KNOWN_UNWIRED` 에 없다: {sorted(undeclared)}\n"
        "이 경계는 부르는 순간 503 이다. 배선하거나, 미배선 사유를 목록에 적어라."
    )


def test_배선된_경계를_미배선_목록에_남겨두지_않는다() -> None:
    """배선이 끝났는데 목록에 남으면 그 목록이 거짓이 되고, 거짓 목록은 안 읽힌다."""
    orchestrator = build_dev_app().state.orchestrator
    stale = {n for n in _KNOWN_UNWIRED if hasattr(orchestrator, n)}

    assert not stale, f"이미 배선됐다 — `_KNOWN_UNWIRED` 에서 지워라: {sorted(stale)}"


def test_미배선_사유가_비어_있지_않다() -> None:
    """사유 없는 목록은 "언젠가 하자"가 되고 아무도 안 지운다."""
    for name, reason in _KNOWN_UNWIRED.items():
        assert len(reason) >= 40, f"{name}: 사유가 너무 짧다 — 왜 미뤘는지 적어라"
