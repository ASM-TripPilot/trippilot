#!/usr/bin/env python3
"""AI 이미지 빌드 직전, 동봉 행사 저장소를 collect-state 정본으로 갈아 끼운다.

운영 AI 는 이미지 안 `data/collected_events.json` 을 읽는다(chart ai.yaml `EVENTS_STORE`). 매일 행사 수집
(`ai-event-collect`)은 collect-state 브랜치에만 쌓으므로, 동봉본은 누가 손으로 떠오기 전까지 멈춰 있었다
(8-22 사본 76건 중 유효 6건인 채 10-18 까지). 정본·갱신 절차는 `ai/data/README.md` §collected_events.json.

리포 동봉본에만 있는 행사(PR 로 손으로 넣은 것)는 아직 만료 전이면 남긴다 — 만료 기준은 배치와 같다
(`JsonEventStore.EXPIRE_GRACE_DAYS`: 종료 + 7일). 정본을 못 읽으면 동봉본을 그대로 두고 경고만 낸다.

    python3 deploy/eks/refresh_events.py <collect-state 사본> ai/data/collected_events.json
"""
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import sys

EXPIRE_GRACE_DAYS = 7  # ai/src/trippilot/background/event_store.py 와 같은 값
KST = timezone(timedelta(hours=9))


def merge(state, bundled, today):
    """정본 행사 전부 + 동봉본에만 있는 미만료 행사. 같은 event_id 는 정본이 이긴다."""
    events = list(state["events"])
    seen = {e["event_id"] for e in events}
    cutoff = (today - timedelta(days=EXPIRE_GRACE_DAYS)).isoformat()
    kept = [e for e in bundled.get("events", [])
            if e.get("event_id") not in seen and str(e.get("end", ""))[:10] >= cutoff]
    return dict(state, events=events + kept), len(kept)


def _valid(doc):
    return isinstance(doc, dict) and isinstance(doc.get("events"), list) and doc["events"] \
        and all(isinstance(e, dict) and "event_id" in e for e in doc["events"])


def main(argv, today=None):
    state_path, bundled_path = map(Path, argv)
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"::warning::collect-state 행사 저장소를 못 읽었다({error}) — 동봉본을 그대로 굽는다")
        return 0
    if not _valid(state):
        print("::warning::collect-state 행사 저장소가 비었거나 형식이 다르다 — 동봉본을 그대로 굽는다")
        return 0
    bundled = json.loads(bundled_path.read_text(encoding="utf-8")) if bundled_path.is_file() else {}
    merged, kept = merge(state, bundled, today or datetime.now(KST).date())
    bundled_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"행사 저장소 갱신 — collect-state {len(state['events'])}건 + 동봉본에만 있던 미만료 {kept}건 "
          f"= {len(merged['events'])}건")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
