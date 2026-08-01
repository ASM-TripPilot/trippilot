# 2026-07-30 20260730-trip202-stay-search-coords

> 이 파일은 옵시디언 개발로그의 축약본이다(볼트 없는 사람·MCP 실패 시 폴백). 상세는 `TripPilot/개발로그/2026-07-30 20260730-trip202-stay-search-coords.md` 참조.

## 대상

**TRIP-202 [BE] GET /stays/search 좌표 파라미터 + 거리 필터**(US-STAY-01 · BR-U1-11, 상위 TRIP-70 · 유닛 U1). TRIP-183의 '내 주변'을 열기 위한 선행 칸으로, **이 사이클에서 티켓 자체를 새로 세웠다**(TRIP-202 생성). 신규 1파일 + 편집 4파일(프로덕션 약 100줄) + 테스트 3파일 신규·1파일 확장. 커밋 `87a0a88`.

## 특수 조건 — 백엔드 하네스 없음 · JDK 없음

- **`trippilot-dev-cycle`은 frontend 전용**이라 이 사이클은 일반 워크플로우 + 게이트 문서화로 돌았다(루트 CLAUDE.md가 정한 대로). 서브 에이전트 위임 없음.
- **이 개발 머신에 JDK가 없다**(`java -version` 실패 · `JAVA_HOME` unset). `backend/Dockerfile` 머리말이 정한 방식(*"호스트 툴체인과 무관하게 컨테이너 안에서 빌드"*)대로 `eclipse-temurin:25-jdk` 컨테이너에서 Gradle을 돌렸다.

## 게이트·검증

- **게이트①** 자율 승인 — red 포착(`compileTestKotlin FAILED`, 전건 `Unresolved reference 'Nearby'/'covers'/'distanceKm'`).
- **게이트②** 자율 승인 — 모듈 30 tests green → `StaySearchApiIT` green → `./gradlew build` 전체 PASS(ArchUnit·Konsist 포함).
- **5-b 적대적 리뷰 생략**(백엔드에 code-critic 자리 없음). 자기 점검 6항목을 게이트 문서에 남김.
- **6-b 실기 스모크 SKIP** — 백엔드 API 변경이라 시뮬레이터 대상 아님.

## 예상과 달랐던 것

1. **`:app:test` 전건 IT 실패가 코드 문제가 아니었다.** Testcontainers가 컨테이너 안에서 도커에 못 닿아 Spring 컨텍스트가 통째로 죽었다. `-v /var/run/docker.sock`·`--add-host host.docker.internal:host-gateway`·`TESTCONTAINERS_HOST_OVERRIDE`·`TESTCONTAINERS_RYUK_DISABLED` 넷을 붙이니 통과. **이 명령을 TRIP-202 티켓 본문 `정본 경로` 절에 남겼다** — 다음 사람이 같은 곳에서 시간을 버리지 않도록.
2. **테스트 기대값 3건을 고쳤다 — 구현이 아니라 내 산술이 틀렸다.** 제주시청↔중문 거리를 29.6km로 적었는데 실제 30.5008km(손계산 30.51km와 구현 일치). 심판을 낮춘 게 아니라 상수를 바로잡은 것이고, 고친 뒤 경계가 오히려 좁아졌다(31 포함/30 제외). 경위를 원장에 표로 남김.
3. **`AccommodationContentPort`를 안 건드려도 됐다.** 거리 필터를 서비스 층에 두니 스텁 어댑터가 그대로 동작. 포트를 넓히는 것은 실 벤더 단계로 미뤘다.

## 설계 결정

- **좌표는 필터가 아니라 스코프다.** `filterZeroReasons`(완화 제안)에 넣지 않고, filter-zero 원인은 좌표 스코프 **안에서** 센다. 반경 밖 숙소가 가진 편의시설을 근거로 원인을 세면 거짓말이 되고, 반대로 '내 주변'을 고른 사용자에게 "위치를 빼보라"는 제안은 요청 취소다.
- **`Nearby` 값 객체 + `of` 조립 검증.** nullable 3필드로 두면 "lat만 있는 질의"가 타입상 표현 가능해져 쓰는 쪽마다 방어해야 한다. 조립을 한 곳으로 모으면 그 상태가 애초에 안 생긴다.
- **`GET /regions`는 티켓을 세우지 않았다.** 지역 마스터 테이블이 없고(`poi.region`은 표시용 varchar) 콘텐츠가 제주 스텁 5곳이라 지금 만들면 반환값이 `["제주"]` 하나다. 실 벤더 어댑터 교체 칸에 흡수.

## 다음에 이어서 할 일

- 이 칸은 완결. 후속은 **실 벤더 어댑터 교체**(그때 `/regions`와 지역 집계 API를 함께)와, 좌표를 벤더/DB로 넘기는 포트 확장.
