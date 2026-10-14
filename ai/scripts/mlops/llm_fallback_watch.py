"""dev LLM 대체 결과 감시 — AI 파드 로그를 세어 경보 여부를 판정한다.

키가 막히면(크레딧 소진·워크스페이스 한도) 게이트웨이는 벤더 예외를 전부 폴백 신호로
접고(`gateway._invoke`, INV-4) 모든 기능이 규칙·템플릿으로 내려간다. 화면은 멀쩡해
보여서 사람이 모른다. 이 스크립트가 그 공백을 메운다 — `ai-llm-fallback-watch.yml`.

stdin: `kubectl logs` 출력(`trippilot.wiring` 의 `trace_event` 줄). 세는 단위는
게이트웨이 호출 1건 = 성공(`LlmCallRecord` success=True) 또는 최종 대체
(게이트웨이 `FallbackEvent`) 하나. 타임아웃 뒤 재시도 모델로 넘어가는 이벤트
(from_mode='llm:<모델>')는 대체가 아니라 세지 않는다.

경보(exit 1): 크레딧·한도 거절이 한 건이라도 있거나, 호출 MIN_CALLS 건 이상에서
대체 비율이 THRESHOLD 이상. 출력은 마크다운(워크플로 요약에 그대로 붙는다).
"""

from __future__ import annotations

import re
import sys
from collections import Counter

MIN_CALLS = 5
THRESHOLD = 0.5
_QUOTA = re.compile(r"credit balance|usage limit|spend limit|billing|quota", re.I)
_FROM_MODE = re.compile(r"from_mode='([^']*)'")


def judge(lines) -> tuple[bool, str]:
    ok = 0
    fallbacks: Counter[str] = Counter()
    quota: list[str] = []
    for line in lines:
        if "trace_event LlmCallRecord(" in line and "component='c1.gateway'" in line:
            if "success=True" in line:
                ok += 1
        elif "trace_event FallbackEvent(" in line and "component='c1.gateway', stage='llm'" in line:
            m = _FROM_MODE.search(line)
            mode = m.group(1) if m else "?"
            if mode.startswith("llm:"):
                continue
            fallbacks[mode] += 1
            reason = line.split("reason=", 1)[-1].strip()
            if _QUOTA.search(reason):
                quota.append(reason[:300])
    failed = sum(fallbacks.values())
    total = ok + failed
    ratio = failed / total if total else 0.0
    alarm = bool(quota) or (total >= MIN_CALLS and ratio >= THRESHOLD)
    out = [
        f"## dev LLM 대체 감시 — {'🚨 경보' if alarm else '정상'}",
        "",
        f"호출 {total}건 · 성공 {ok} · 대체 {failed} ({ratio:.0%}) · 과금 거절 {len(quota)}",
        f"(경보: 과금 거절 1건 이상, 또는 호출 {MIN_CALLS}건 이상에서 대체 {THRESHOLD:.0%} 이상)",
    ]
    if fallbacks:
        out += ["", "| 대체된 기능(from_mode) | 건수 |", "|---|---|"]
        out += [f"| {mode} | {n} |" for mode, n in fallbacks.most_common()]
    if quota:
        out += ["", "과금 거절 사유(첫 건):", "", "```", quota[0], "```"]
    return alarm, "\n".join(out)


if __name__ == "__main__":
    alarm, report = judge(sys.stdin)
    print(report)
    sys.exit(1 if alarm else 0)
