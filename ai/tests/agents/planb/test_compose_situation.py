"""다시 짜기 구성 프롬프트에 KB-3 상황 대처 원칙을 싣는다 (2026-11-04 — 측정 46 : 20, p=0.002).

증명하는 것 (실 LLM 0):
  ① 이번 사유와 같은 문서를 파일 순서로 앞 4건 고른다 — 사유 여럿이면 사유 순서대로, 중복 없이
  ② 사유가 없거나 "none" 뿐이면 "none" 문서를 쓴다
  ③ 문서가 없으면 칸이 "(없음)"이다 — 프롬프트는 깨지지 않는다
  ④ 배선: /planb/replan 의 구성 프롬프트 [상황 대처 원칙] 칸에 그 문서가 실린다
  ⑤ 운영 KB-3 파일이 진입점 로더로 읽힌다(사유 표지 포함)
"""

from __future__ import annotations

import pathlib

import yaml
from fastapi.testclient import TestClient

from tests.agents.planb.test_replan_composition import (
    _DIRECTIVES,
    _FOOD,
    _body,
    _ScriptedLlm,
)
from trippilot.agents.planb import composition
from trippilot.agents.planb.kb_retrieval import load_kb_file
from trippilot.api.wiring import build_dev_app

_DOCS = (
    ("비 오면 실내 문화시설 먼저.", ("weather",)),
    ("피곤하면 가까운 곳 위주.", ("fatigue",)),
    ("우천엔 카페에서 오래 머문다.", ("weather",)),
    ("비·피로가 겹치면 한 건물 안에서.", ("weather", "fatigue")),
    ("직접 바꿀 땐 성격을 잇는 곳.", ("none",)),
    ("폭염엔 그늘 없는 곳을 뺀다.", ("weather",)),
    ("우천 야외 활동은 제외.", ("weather",)),
)


def test_사유와_같은_문서를_파일_순서로_앞_4건() -> None:
    assert composition.situation_lines(_DOCS, ("weather",)) == (
        "비 오면 실내 문화시설 먼저.", "우천엔 카페에서 오래 머문다.", "비·피로가 겹치면 한 건물 안에서.", "폭염엔 그늘 없는 곳을 뺀다.")


def test_사유가_여럿이면_사유_순서대로_중복_없이() -> None:
    assert composition.situation_lines(_DOCS, ("fatigue", "weather"), k=3) == (
        "피곤하면 가까운 곳 위주.", "비·피로가 겹치면 한 건물 안에서.", "비 오면 실내 문화시설 먼저.")


def test_사유가_없거나_none_뿐이면_none_문서() -> None:
    assert composition.situation_lines(_DOCS, ()) == ("직접 바꿀 땐 성격을 잇는 곳.",)
    assert composition.situation_lines(_DOCS, ("none",)) == ("직접 바꿀 땐 성격을 잇는 곳.",)
    assert composition.situation_lines((), ("weather",)) == ()


def _compose_prompt(**over) -> str:
    llm = _ScriptedLlm([_FOOD])
    app = build_dev_app(llm=llm, model_id="m", directives=_DIRECTIVES, situation_docs=_DOCS)
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.post("/ai/v1/planb/replan", json=_body(**over))
    assert r.status_code == 200, r.text
    return llm.compose_prompt()


def _section(prompt: str) -> str:
    return prompt.split("[상황 대처 원칙]")[1].split("[사용자가 고른 요청]")[0]


def test_구성_프롬프트_상황_대처_원칙_칸에_사유의_문서가_실린다() -> None:
    sec = _section(_compose_prompt(reasons=["weather"]))
    assert "- 비 오면 실내 문화시설 먼저." in sec and "- 우천엔 카페에서 오래 머문다." in sec
    assert "피곤하면" not in sec and "직접 바꿀" not in sec


def test_문서가_없으면_칸은_없음이다() -> None:
    llm = _ScriptedLlm([_FOOD])
    app = build_dev_app(llm=llm, model_id="m", directives=_DIRECTIVES)
    with TestClient(app, raise_server_exceptions=False) as c:
        assert c.post("/ai/v1/planb/replan", json=_body(reasons=["weather"])).status_code == 200
    assert _section(llm.compose_prompt()).strip().startswith("(이런 상황에서")
    assert "(없음)" in _section(llm.compose_prompt())


def test_운영_KB3_파일이_사유_표지와_함께_읽힌다() -> None:
    path = pathlib.Path(__file__).resolve().parents[3] / "data" / "planb_situation_kb.yaml"
    docs = tuple((d.text, tuple(d.metadata.get("reasons") or ())) for d in load_kb_file(path, yaml.safe_load))
    assert len(composition.situation_lines(docs, ("weather",))) == composition.SITUATION_LINES
    assert composition.situation_lines(docs, ("none",))  # 수동 교체 원칙이 있다
