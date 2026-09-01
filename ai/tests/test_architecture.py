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


def test_ortools_only_imported_in_solver_engine() -> None:
    """U2 DoD: ortools 의존은 solver_engine(C2) 계층에만 (다른 계층 유입 자동 차단)."""
    offenders = []
    for py in _SRC.rglob("*.py"):
        if "solver_engine" in py.parts:
            continue
        if "ortools" in _external_imports(py):
            offenders.append(str(py.relative_to(_SRC)))
    assert not offenders, f"solver_engine 밖에서 ortools import: {offenders}"


def test_poi_curation_imports_only_stdlib_and_internal() -> None:
    """U3 DoD: poi_curation(구 M7) 계층 순수성 (외부 패키지 0)."""
    _assert_pure("poi_curation")


def test_llm_gateway_imports_only_stdlib_and_internal() -> None:
    """U4 DoD: llm_gateway(C1) 순수성 — 예외 2곳뿐: prompts.py의 yaml(프롬프트 정본 포맷),
    adapters/의 벤더 SDK(anthropic·openai — SDK는 어댑터 한정, BR-U4-10)."""
    offenders: dict[str, set[str]] = {}
    for py in (_SRC / "llm_gateway").rglob("*.py"):
        bad = _external_imports(py)
        if py.name == "prompts.py":
            bad -= {"yaml"}
        if "adapters" in py.parts:
            bad -= {"anthropic", "openai"}
        if bad:
            offenders[str(py.relative_to(_SRC))] = bad
    assert not offenders, f"llm_gateway에 외부 패키지 import 위반: {offenders}"


def test_anthropic_only_imported_in_llm_gateway_adapters() -> None:
    """BR-U4-10: anthropic SDK 의존은 llm_gateway/adapters/ 한정 — 벤더 교체 시 이 경계만 갈아끼운다."""
    offenders = []
    for py in _SRC.rglob("*.py"):
        if "adapters" in py.parts:
            continue
        if "anthropic" in _external_imports(py):
            offenders.append(str(py.relative_to(_SRC)))
    assert not offenders, f"adapters 밖에서 anthropic import: {offenders}"


def test_openai_only_imported_in_llm_gateway_adapters() -> None:
    """TRIP-340: openai SDK 의존도 llm_gateway/adapters/ 한정 — anthropic 규칙(BR-U4-10)과 동형.
    개발·검증용 어댑터라도 SDK가 경계 밖으로 새면 벤더 교체 비용이 어댑터 1개를 넘는다."""
    offenders = []
    for py in _SRC.rglob("*.py"):
        if "adapters" in py.parts:
            continue
        if "openai" in _external_imports(py):
            offenders.append(str(py.relative_to(_SRC)))
    assert not offenders, f"adapters 밖에서 openai import: {offenders}"


def test_yaml_only_imported_in_llm_gateway_prompts() -> None:
    """yaml 파서 의존은 PromptRegistry(llm_gateway/prompts.py) 한정 — ortools→solver_engine과 같은 격리 패턴."""
    offenders = []
    for py in _SRC.rglob("*.py"):
        if py.parent.name == "llm_gateway" and py.name == "prompts.py":
            continue
        if "yaml" in _external_imports(py):
            offenders.append(str(py.relative_to(_SRC)))
    assert not offenders, f"llm_gateway/prompts.py 밖에서 yaml import: {offenders}"


def _internal_imports(path: Path) -> set[str]:
    """trippilot.* 내부 import 전체 (Import·ImportFrom 절대 import 모두)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                modules.add(node.module)
    return {m for m in modules if m.startswith("trippilot")}


_AGENT_LAYER_PREFIXES = (
    "trippilot.agents",
    "trippilot.orchestrator",
    "trippilot.providers",
    "trippilot.background",
)


def test_lower_layers_do_not_import_agent_layer() -> None:
    """L-1 (BR-AF-10): 하위 계층은 상위(agents·orchestrator·providers·background)를 모른다."""
    offenders: dict[str, set[str]] = {}
    for subdir in ("domain", "ports", "llm_gateway", "solver_engine", "poi_curation"):
        for py in (_SRC / subdir).rglob("*.py"):
            bad = {
                m
                for m in _internal_imports(py)
                if m.startswith(_AGENT_LAYER_PREFIXES)
            }
            if bad:
                offenders[str(py.relative_to(_SRC))] = bad
    assert not offenders, f"하위 계층이 agent 계층을 import함(L-1 위반): {offenders}"


def test_agents_do_not_cross_import() -> None:
    """L-2 (BR-AF-10): agents 형제 상호 import 금지 — 공용은 agents/base 또는 domain으로.
    Agent 간 직접 호출 금지, Orchestrator 경유만."""
    agents_dir = _SRC / "agents"
    siblings = {p.name for p in agents_dir.iterdir() if p.is_dir()}
    offenders: dict[str, set[str]] = {}
    for py in agents_dir.rglob("*.py"):
        own = py.relative_to(agents_dir).parts[0]  # 최상위 파일이면 파일명
        bad = set()
        for m in _internal_imports(py):
            parts = m.split(".")
            if parts[:2] == ["trippilot", "agents"] and len(parts) >= 3:
                target = parts[2]
                if target in siblings and target != own:
                    bad.add(m)
        if bad:
            offenders[str(py.relative_to(_SRC))] = bad
    assert not offenders, f"agents 형제 상호 import(L-2 위반): {offenders}"


def test_agents_do_not_import_llm_port() -> None:
    """L-3 (BR-AF-10): agents의 LlmPort 직접 import 금지 — LLM은 C1 게이트웨이 경유만
    (4겹 장치 우회 차단)."""
    offenders: dict[str, set[str]] = {}
    for py in (_SRC / "agents").rglob("*.py"):
        bad = {
            m
            for m in _internal_imports(py)
            if m.startswith("trippilot.ports.llm_port")
        }
        if bad:
            offenders[str(py.relative_to(_SRC))] = bad
    assert not offenders, f"agents가 LlmPort를 직접 import함(L-3 위반): {offenders}"


def test_llm_gateway_does_not_import_solver_engine_or_poi_curation() -> None:
    """BR-U4-09: llm_gateway(C1)는 판단 재료 제공자 — 규칙 점수 폴백 실행은 호출측 몫이라
    solver_engine(C2)·poi_curation(구 M7) 참조 금지."""
    offenders: dict[str, set[str]] = {}
    for py in (_SRC / "llm_gateway").rglob("*.py"):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        bad = {
            node.module
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            and node.module
            and node.module.startswith(("trippilot.solver_engine", "trippilot.poi_curation"))
        }
        if bad:
            offenders[str(py.relative_to(_SRC))] = bad
    assert not offenders, f"llm_gateway가 solver_engine/poi_curation을 import함(경계 위반): {offenders}"


def test_langchain_only_imported_in_agents_adapters() -> None:
    """LangChain 부분 도입(TRIP-522) 격리 — `agents/adapters/` 한정.

    정본이 정한 적용 범위가 "PlanBAgent RAG 검색·벡터·임베딩까지"다(README §LangChain
    적용 범위). Orchestrator·Solver·워커·게이트로 새면 그 선이 무너지고, 네 불변식을
    강제하는 자리(closed_set_filter·게이트·규칙 폴백)가 프레임워크 안으로 숨는다.
    numpy 도 같이 묶는다 — MMR 계산 말고는 쓸 데가 없다.
    """
    offenders = []
    for py in _SRC.rglob("*.py"):
        if "adapters" in py.parts:
            continue
        external = _external_imports(py)
        if {"langchain_core", "langchain", "numpy"} & external:
            offenders.append(str(py.relative_to(_SRC)))
    assert not offenders, f"adapters 밖에서 langchain/numpy import: {offenders}"


def test_langchain_is_not_a_runtime_dependency() -> None:
    """PlanB 기본 경로는 langchain 없이 돌아야 한다 (TRIP-522).

    `search_type` 기본값이 "similarity" 이고 mmr 경로만 lazy import 한다. 이게 깨지면
    langchain 미설치 환경(운영 이미지·다른 패키지 CI)에서 PlanB 가 통째로 죽는다 —
    그래서 런타임 의존성 목록에 들어갔는지를 못 박는다.
    """
    import tomllib

    pyproject = tomllib.loads((_SRC.parent.parent / "pyproject.toml").read_text(encoding="utf-8"))
    runtime = " ".join(pyproject["project"]["dependencies"])
    assert "langchain" not in runtime, f"langchain 이 런타임 의존성에 들어갔다: {runtime}"

    # 검색기 미주입이 기본 — 주입해야만 langchain 경로가 열린다.
    import inspect

    from trippilot.agents.planb.rag import PlanBRagPipeline

    assert inspect.signature(PlanBRagPipeline.__init__).parameters["retriever"].default is None
