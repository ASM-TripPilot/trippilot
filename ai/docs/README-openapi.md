# `openapi.json` — AI 경계 와이어 정본

`ai/docs/openapi.json`은 AI 서비스가 여는 **모든 HTTP 경로의 와이어 계약 정본**이다
(일정 `/ai/v1/itinerary/*` — explanations=TRIP-479 · edit=TRIP-431 ·
여행 중 `/ai/v1/planb/*` — alternatives=TRIP-428 · replan=재계획 연동 A-4 · opportunities=situation-awareness BR-SA-22(기회 카드, LLM 0회) ·
회고 `/ai/v1/reflection/*` — TRIP-429 · 도우미 `/ai/v1/dialogue/{interpret,memory}` — assistant-orchestrator · 그리고 `/`·`/health`)
— PR #76 결정4("openapi 단일 정본 + 양쪽 코드젠")의 AI측 절반.
**열린 경로 목록은 이 파일 자신이다 — 여기에 개수를 다시 적지 않는다**(적으면 경로가 늘 때마다 스테일이 된다).
경로 전수 일치는 `ai/tests/api/test_api_openapi_contract.py`가 강제한다 — 경로 추가·삭제 시 그 목록도 같이 갱신한다.

- **생성 원리**: FastAPI가 `create_app()`(오케스트레이터 미주입 상태)의 `app.openapi()`로
  자동 생성한 스키마를, 정렬·들여쓰기 고정 포맷(`json.dumps(…, indent=2, ensure_ascii=False,
  sort_keys=True)`)으로 저장한 것. 손으로 편집하지 않는다.
- **갱신 방법**: 경계 스키마(`ai/src/trippilot/api/schemas.py` 등)를 바꿨다면 같은 PR에서

  ```bash
  cd ai && uv run python scripts/export_openapi.py
  ```

- **드리프트 게이트**: `ai/tests/api/test_api_openapi_contract.py`가 앱 스키마를 같은 포맷으로
  직렬화해 이 파일과 문자열 비교한다. 어긋나면 CI가 실패한다 — 스키마 변경이 계약 갱신
  없이 조용히 나갈 수 없다.
- **백엔드 사용처**: 백엔드는 이 파일을 기준으로 클라이언트(어댑터 와이어 타입) 검증/코드젠을
  한다. 필드 정본 대조 대상은 `backend/modules/itinerary-generation/.../ScheduleAgentPort.kt`
  + `ScheduleAgentWire.kt`.
- **불변식**: 계약 필드명에 소요시간류(`duration`·`*_minutes`·`stay_min`)가 없어야 한다(INV-3,
  거리만 표시) — 게이트 테스트가 properties 키 기준으로 검사한다.
- **도우미 메모리 경계**(assistant-orchestrator FD DE §3.3·BR-AO-10): `DELETE /ai/v1/dialogue/memory?session_id=|trip_id=|account_ref=`
  (셋 중 정확히 하나, 아니면 422 — 200 `{deleted: n}` 멱등) · `GET /ai/v1/dialogue/memory?account_ref=`(내보내기, 섹션 `assistantMemory`).
  둘 다 **쿼리 전용·본문 없음**이고 `request_meta` 가 없는 첫 경계다. 계정 참조가 쿼리에 실리므로 uvicorn access log 는 꺼 둔다
  (`--no-access-log`, Dockerfile CMD·차트 args — 요청 관측은 `http_request` 가 path 만으로 남긴다).
