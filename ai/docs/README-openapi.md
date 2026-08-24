# `openapi.json` — AI 경계 와이어 정본

`ai/docs/openapi.json`은 AI 서비스 경계 6종
(`/ai/v1/itinerary/{generate,validate,repair,alternatives,explanations,edit}` —
alternatives=TRIP-428 · explanations=TRIP-479 · edit=TRIP-431) + `/health`의
**와이어 계약 정본**이다 — PR #76 결정4("openapi 단일 정본 + 양쪽 코드젠")의 AI측 절반.
경로 전수 일치는 `ai/tests/test_api_openapi_contract.py`가 강제한다 — 경로 추가·삭제 시 그 목록도 같이 갱신한다.

- **생성 원리**: FastAPI가 `create_app()`(오케스트레이터 미주입 상태)의 `app.openapi()`로
  자동 생성한 스키마를, 정렬·들여쓰기 고정 포맷(`json.dumps(…, indent=2, ensure_ascii=False,
  sort_keys=True)`)으로 저장한 것. 손으로 편집하지 않는다.
- **갱신 방법**: 경계 스키마(`ai/src/trippilot/api/schemas.py` 등)를 바꿨다면 같은 PR에서

  ```bash
  cd ai && uv run python scripts/export_openapi.py
  ```

- **드리프트 게이트**: `ai/tests/test_api_openapi_contract.py`가 앱 스키마를 같은 포맷으로
  직렬화해 이 파일과 문자열 비교한다. 어긋나면 CI가 실패한다 — 스키마 변경이 계약 갱신
  없이 조용히 나갈 수 없다.
- **백엔드 사용처**: 백엔드는 이 파일을 기준으로 클라이언트(어댑터 와이어 타입) 검증/코드젠을
  한다. 필드 정본 대조 대상은 `backend/modules/itinerary-generation/.../ScheduleAgentPort.kt`
  + `ScheduleAgentWire.kt`.
- **불변식**: 계약 필드명에 소요시간류(`duration`·`*_minutes`·`stay_min`)가 없어야 한다(INV-3,
  거리만 표시) — 게이트 테스트가 properties 키 기준으로 검사한다.
