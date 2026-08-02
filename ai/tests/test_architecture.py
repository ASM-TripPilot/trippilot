"""U1 — 의존성 순수성 자동 검사 (business-rules.md §2.6).

규칙: domain·ports는 표준 라이브러리 + 내부 패키지(trippilot)만 import 가능.
외부 패키지 import는 위반 — 이 테스트가 매 실행마다 자동으로 막는다.
(설계의 import-linter 의도를 stdlib AST 검사로 구현: 추가 의존성 없이, 어떤
 미래의 외부 import도 자동 탐지. 팀이 import-linter 도구를 선호하면 교체 가능.)
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent.parent / "src" / "trippilot"
_STDLIB = sys.stdlib_module_names  # Python 3.10+
_ALLOWED_ROOTS = {"trippilot", "__future__"}


def _top_level(module: str) -> str:
    return module.split(".", 1)[0]


def _external_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    external: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                external.add(_top_level(alias.name))
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:  # 절대 import만
                external.add(_top_level(node.module))
    return {m for m in external if m not in _STDLIB and m not in _ALLOWED_ROOTS}


def _assert_pure(subdir: str) -> None:
    offenders: dict[str, set[str]] = {}
    for py in (_SRC / subdir).rglob("*.py"):
        bad = _external_imports(py)
        if bad:
            offenders[str(py.relative_to(_SRC))] = bad
    assert not offenders, f"{subdir}에 외부 패키지 import 위반: {offenders}"


def test_domain_imports_only_stdlib_and_internal() -> None:
    _assert_pure("domain")


def test_ports_imports_only_stdlib_and_internal() -> None:
    _assert_pure("ports")


def test_domain_does_not_import_ports() -> None:
    """레이어링: domain은 최하단 — ports를 import하면 안 된다."""
    offenders: dict[str, set[str]] = {}
    for py in (_SRC / "domain").rglob("*.py"):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        bad = {
            node.module
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            and node.module
            and node.module.startswith("trippilot.ports")
        }
        if bad:
            offenders[str(py.relative_to(_SRC))] = bad
    assert not offenders, f"domain이 ports를 import함(레이어 위반): {offenders}"
