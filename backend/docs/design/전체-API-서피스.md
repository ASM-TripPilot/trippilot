# TripPilot 전체 API 서피스 카탈로그 (밴드 a~j · 개요)

> 기준일 2026-07-06 · 스코프: 밴드 a,b,c,d,e,g,h,i,j (k·l·m 제외)
> 근거: 와이어프레임 전수 전사(화면 액션→엔드포인트) + `domain.md`. 깊이: **개요** — 리소스·메서드·목적. 요청/응답 상세는 유닛별 후속(U1은 openapi.yaml 완료).

## 0. 공통 규약 (U1 재사용)
Base `/api/v1` · `Authorization: Bearer` 무상태 · JSON camelCase · 에러 봉투 `{error:{code,message,traceId,fields?}}` · 일반화 인증 에러(SECURITY-15) · 429+Retry-After · 상관 ID. 소셜 토큰 교환·솔버 검증은 서버 소유.

## 1. 밴드 c — 계정·온보딩
`openapi.yaml` 참조: `/auth/social/{provider}`, `/auth/token/refresh`, `/me/consents`, `/me/location-consent`, `/me/profile`, `/nickname/*`, `/me/preferences`, `/me/deletion`, `/bootstrap`, `/terms`.

## 2. 밴드 a — 앱셸·홈
| Method · Path | 목적 | 화면 |
|---|---|---|
| GET `/bootstrap` | 기동 분기(강제업뎃>재동의>세션) | (U1) |
| GET `/home` | 홈 대시보드 집계 — **부분 응답**(슬롯별 실패 허용): activeTrip·upcomingTrip·trending·memory·preferencePrompt·알림배지 | a01 |
| GET `/config` | AppConfig(minSupportedVersion) | a01 |

## 3. 밴드 b — AI 어시스턴트 (본 설계 범위 외)

## 4. 밴드 d — 장소 탐색·저장
| Method · Path | 목적 | 화면 |
|---|---|---|
| GET `/places/search?q=` | 장소 검색 | d02 |
| GET `/places/{id}` | 장소 상세 | d01 |
| GET `/places/popular?region=` | 인기 장소(trending) | a01·d |
| GET `/saved-places` | 저장 장소 목록(카운트) | d02 |
| POST `/saved-places` / DELETE `/saved-places/{id}` | 저장/해제 | d02 |

## 5. 밴드 e — 숙소 탐색·등록
| Method · Path | 목적 | 화면 |
|---|---|---|
| GET `/stays/search?q=&sort=&filters=` | OTA 통합 검색(정렬·facet 필터, 부분 실패 시 가격 null·filter-zero 원인 facet 반환) | e01·e02 |
| GET `/stays/{id}` | 숙소 상세 | e03 |
| GET `/stays/{id}/ota-options` | 제휴 OTA별 가격·딥링크 | e03 |
| POST `/stays/{id}/outbound` | 아웃바운드 클릭 기록 → 딥링크 반환 | e03 |
| ~~`/wishlist`~~ (후속) | 숙소 위시리스트 보류 — 1차 제외 | e04 후속 |
| GET `/stays/geocode?q=` | 등록용 후보(multi-candidate·conflict) | e05 |
| POST `/saved-stays` | 숙소 등록(3경로: 검색·URL·핀, 좌표 nullable+수동확정) | e05 |
| GET · PATCH · DELETE `/saved-stays/{id}` | 등록 숙소 관리 | e05 |

> 숙소 1차 흐름: 여행 생성 시 **등록 숙소(SavedStay) 불러오기** → 없으면 **검색(e01·e02)→등록(e05)**. 위시리스트는 후속.

## 6. 밴드 g — 여행 생성·거점
| Method · Path | 목적 | 화면 |
|---|---|---|
| POST `/trips` | 여행 생성(국내강제·날짜겹침차단·예산 프리필, **seed POI 배열** 수용) | g01·d02 |
| GET `/trips` / `/trips/{id}` / PATCH / DELETE | 여행 관리(소프트삭제 유예) | g01·h01 |
| POST `/trips/{id}/end` | 여행 수동 종료 → ENDED·TripEnded 발행·회고 트리거 | domain §10.1 |
| GET · POST `/trips/{id}/bases` | 거점 숙소 목록·추가 | g02 |
| POST `/trips/{id}/bases/coverage` | 커버리지 해결(gap=직전/여행지중심, overlap=날짜별 primary) | g02 |
| GET · POST · PATCH · DELETE `/trips/{id}/must-visits` | 필수 방문지(포함/시각고정, 사본복제) | h05~h08 |

## 7. 밴드 h — AI 일정 생성
| Method · Path | 목적 | 화면 |
|---|---|---|
| POST `/trips/{id}/itinerary/generate` | 생성 시작(mode·프로파일) → GenerationSession | h04·h09 |
| GET `/generation-sessions/{id}` | 진행 상태·부분결과(preprocess→candidates→hours→route) | h09·h10 |
| GET `/itineraries/{id}` | 일정 조회(추천안·완성) | h11·h17 |
| GET `/itineraries/{id}/slots/{slotId}/candidates?radius=` | 슬롯 후보(반경별) | h12·h14·h15·h18 |
| POST `/itineraries/{id}/slots` | 슬롯 직접 추가 | h19·h20·h23 |
| DELETE `/itineraries/{id}/slots/{slotId}` | 슬롯 삭제(자유 편집·LOCK 제외) | h24 |
| PATCH `/itineraries/{id}/slots/{slotId}` | 교체·고정(locked)·시각/체류 | h11·h12·h18 |
| POST `/itineraries/{id}/confirm` | 확정 → PlanSnapshot 동결 | h11·h16·h17 |
| POST `/itineraries/{id}/unlock` | 확정 해제(여행 전) | (D20) |
| GET `/itineraries/{id}/plan` | 확정 일정(PlanSnapshot) 조회 | h34 |
| GET `/itineraries/{id}?view=` | 완성 뷰 토글(timetable/map/card/mapB) | h25·h26·h29·h32·h33 |
| POST `/trips/{id}/stay-recommendations` | 숙소 미등록 시 동선 기준 거점 추천(나중 등록 온램프) | h25·h27 |
| POST `/itineraries/{id}/rebase` | 선택 거점 반영 → 동선 재정리(before/after 델타) | h27·h28 |
| POST `/itineraries/{id}/regenerate` | 후보 0건 시 조건 완화 재생성 + 저비용 fallback | h35 |

숙소(체크인) 슬롯 항상 locked — 이동/삭제/시각변경 서버 검증 거부.

## 8. 밴드 i — 여행 중 실행·Plan-B
| Method · Path | 목적 | 화면 |
|---|---|---|
| GET `/trips/{id}/execution` | 실행 상태(current/next, rest) | i01·i05 |
| GET `/trips/{id}/itinerary/current?day=` | 활성 시간표 | i01 |
| GET `/trips/{id}/route?type=planned\|actual` | 계획/실제(GPS) 동선 | i02·i03 |
| GET `/trips/{id}/triggers` | 감지된 변화(4카테고리·상태) | i08·i09 |
| POST `/trips/{id}/triggers/{triggerId}/dismiss` | 트리거 닫기 | i08 |
| POST `/trips/{id}/replan-sessions` | 재계획 시작(reason·mode) → ReplanSession | i10·i11 |
| GET `/trips/{id}/replan-sessions/{sessionId}` | 진행+대안(alternatives, empty 사유) | i12·i13·i16 |
| POST `/trips/{id}/replan-sessions/{sessionId}/commit` / `/undo` / `/cancel` | 반영/되돌리기/취소 | i18·i19 |
| POST `/trips/{id}/rest` | 휴식 모드 전환(resumeAt) | i17 |
| PATCH `/trips/{id}/execution` | 휴식 재개·일정 계속·스누즈(30분 후) | i17 |
| PATCH `/itineraries/{id}/slots` (manual reorder/time) | 직접 수정(이동시간 실패 시 수동 시각) | i15·i22 |

> **경로 중첩(2026-08-11 정정)**: 트리거·재계획 세션은 id 가 전역 유일하지만 **여행 아래로 중첩**한다.
> 그래야 소유 검증이 한 곳에서 끝나고, id 만 알면 남의 여행 리소스를 건드리는 구멍이 생기지 않는다.
> 구현(TRIP-273)이 이 표기를 따른다.

## 9. 밴드 j — 기록·회고
| Method · Path | 목적 | 화면 |
|---|---|---|
| GET `/trips/{id}/days/{day}/visits` | Day 방문 기록 | j01 |
| POST `/trips/{id}/visits` | 방문 체크/즉석 방문(checkinType auto/manual) | j01·i04 |
| PATCH `/visits/{id}` | 방문 상태·메모 | j01 |
| POST `/visits/{id}/photos` | 사진 첨부(업로드 상태머신) | j01 |
| POST `/visits/{id}/resolve-conflict` | 오프라인 동기화 충돌 해소(버전 택1) | j01 |
| GET `/trips/{id}/comparison?view=` | 계획 vs 실제 vs 변경 | j02 |
| GET · PATCH `/reflections/{tripId}/{day}` | 오늘의 회고(자동+수동, 3단 fallback) | j03 |
| GET `/trips/{id}/summary` | 여행 요약 | j04 |
| GET `/users/{id}/style-analysis` | 스타일 분석(임계 10 visit 게이팅) | j05 |
| POST `/trips/{id}/share-card` | 공유 카드(aspectRatio·caption·includePhotos) | j06 |
| GET `/trips?status=past` / `?month=` | 캘린더·지난 여행 | j07 |

## 10. MVP/후속 · 크로스유닛 계약
- **후속**: b(어시스턴트) 전체(정본 후속). 그 외 a·d·e·g·h·i·j = MVP.
- **크로스유닛 핵심 계약**: BootstrapInfo(M1→U2), 등록숙소=일정 출발점(M4→M6/M8), 날짜별 기준거점(M6→M8), PlanSnapshot 동결(M8), TriggerEvent→ReplanSession→current 반영(M9/M10→M8), VisitChecked(M18→M12), TripEnded→회고(M6→M13).
- **h24~h35 보강 완료**: 완성 뷰 토글·확정 일정(PlanSnapshot 조회)·숙소 나중 등록 온램프·동선 재정리·후보0건 조건완화 재생성 반영. 지도 실패는 카드 폴백(클라).
