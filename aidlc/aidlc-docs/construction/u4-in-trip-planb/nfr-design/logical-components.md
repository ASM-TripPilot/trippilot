# U4 In-trip & Plan-B — Logical Components

> 입력: `nfr-design-patterns.md`(P-*-U4) + `functional-design/`. U0 `C-1~C-7` · U1 `LC-U1-1~8` 위에 이어짐. 명명 `LC-U4-#`.
> 답변 확정 2026-08-09 — Q1=A(서킷 미도입) · Q2=A′(지오펜스 창 2).

## 1. 컴포넌트 맵

```text
U4 (backend modules — 3개 신규)
  planb-detection/          LC-U4-1 TriggerEvaluator      (판정 파이프라인, P-DET-U4-1·3)
                            LC-U4-2 SuppressionStore      (억제 3축)
  weather-context/          LC-U4-3 WeatherPort + KmaWeatherAdapter + WeatherSnapshotCache
  itinerary-recalculation/  LC-U4-4 ReplanSessionCoordinator (단일성·409·낙관적 잠금)
                            LC-U4-5 ReplanAgentAdapter    (ScheduleAgentPort.replan → ai regenerate)
                            LC-U4-6 VisitCheckService     (→ U5 이관 예정)
                            LC-U4-7 LocationTrailRecorder + LegalLogEmitter
  [횡단]                    U0 자산(로깅·아웃박스·ArchUnit) + StalePartialSweeper 재사용
                            서킷 브레이커 없음 — 타임아웃 + 실패율 지표(P-RES-U4-1)

U4 (frontend — shared 승격)
  shared/location/          LC-U4-8 GeofenceRegistrar     (슬라이딩 창 2, P-MOBILE-U4-1)
  features/execution/model/ LC-U4-9 SignalCollector       (신호만 — 임계 모름, P-DET-U4-1)
```

## 2. 컴포넌트 명세

### LC-U4-1. `TriggerEvaluator` (C9)
| | |
|---|---|
| 책임 | 신호 정규화 → 영향 판정 → 노이즈 폐기 → 억제 조회 → `TriggerEvalResult{should_replan, scope, reason}` 산출. **발화하지 않은 판정도 `plan_b_trigger`에 기록** |
| NFR | P-DET-U4-1(판정 소유) · P-DET-U4-2(무발화 기본값) · P-DET-U4-3(억제 3축) · P-OBS-U4-1 |
| 타입 | **ai `TriggerKind`·`ReplanScope`·`TriggerEvalResult`를 그대로 쓴다**(DEC-U4-4) — 백엔드가 별도 taxonomy를 만들지 않음 |
| 통합 | `WeatherPort`(LC-U4-3) · C7 place-data 영업시간(U1) · `TravelEstimatePort`(U1) · `VisitChecked`(LC-U4-6) |
| 임계 | 강수 60%·이동 지연 15분·체류 초과 = **설정값**(BR-U2-15 승계, 하드코딩 금지). 체류 초과 값은 **O-U4-3 미결** |
| 상태 | 무상태(판정 기록은 DB) |

### LC-U4-2. `SuppressionStore` (C9)
| | |
|---|---|
| 책임 | `plan_b_suppression` 읽기·쓰기. 중복(kind×slotKey) · 일일 상한 · 민감도 3단 |
| NFR | P-DET-U4-3 — **감지 단계에서 집행**(INV-U4-02) |
| 상태 | DB. 민감도는 **계정 단위** — 소유는 U6 설정과 함께 확정(**O-U4-2 미결**) |

### LC-U4-3. `WeatherPort` + `KmaWeatherAdapter` + `WeatherSnapshotCache` (C11)
| | |
|---|---|
| 책임 | 기상청 단기예보 조회(강수확률·특보) 및 스냅숏 캐시 |
| NFR | P-PERF-U4-1(키 = `(격자, 발표시각)`, TTL = 다음 발표까지) · P-RES-U4-2(**만료분으로 발화 금지, 표시엔 "확인 불가"**) · COST-U4-03(활성 여행 당일 격자만) |
| 통합 | 짧은 타임아웃 · **재시도 없음** · **서킷 없음**(P-RES-U4-1) · 실패 시 **행을 만들지 않음**(INV-U4-09) |
| 상태 | `weather_snapshot` 테이블. **Redis 미사용**(tech-stack 델타 4) |
| 선결 | 공공데이터포털 API 키 발급 — 개발 중 처리 |

### LC-U4-4. `ReplanSessionCoordinator` (C10)
| | |
|---|---|
| 책임 | `replan_session` 수명 관리 — 생성·단일성 보장·상태 전이(`COLLECTING`→`SOLVING`→`DRAFT`→`APPLIED`/`CANCELED`/`NO_SOLUTION`/`FAILED`)·확정 |
| NFR | P-CON-U4-1(열린 세션 1개 · 중복 409 · 확정 시 **낙관적 잠금**) · COST-U4-01 |
| 불변식 집행 | INV-U4-05(확정 전 원 일정 무변경) · INV-U4-06(열린 세션 1개) · BR-U4-32(부분 반영 금지) |
| 정리 | 만료 세션 정리는 **기존 `StalePartialSweeper` 패턴 재사용**(DATA-U4-05) — 신규 스케줄링 인프라 0 |
| 산출 | 확정 시 `change_log_entry` append(DEC-U4-11) + `ItineraryRecalculated` 이벤트 |

### LC-U4-5. `ReplanAgentAdapter` (C10)
| | |
|---|---|
| 책임 | `ScheduleAgentPort.replan(ReplanInput)` 구현 — camelCase↔snake_case 매핑과 **locked 슬롯 산출**을 소유 |
| 매핑 | `lockedSlotKeys` → ai `regenerate(problem, locked_slots)` · `scope` → `problem.days`+locked 범위 · `excludedPoiIds` → `ItineraryProblem.excluded_poi_ids` · `reasons`/`directives`/`freeText` → 선호 가중치 |
| NFR | 짧은 타임아웃 · 재시도 없음 · 실패 시 `ScheduleAgentCallFailed` → **수동 편집 전환**(BR-U4-43, INV-4) |
| PBT | **PBT-U4-1의 실제 검증 지점** — 완료·시각 고정·앵커가 빠짐없이 `lockedSlotKeys`에 들어가는가 |
| 갭 | ai HTTP 표면 부재(**G-U4-3**) — 어댑터 구현 전 선행 티켓 필요 |

### LC-U4-6. `VisitCheckService` (C10 → U5 이관 예정)
| | |
|---|---|
| 책임 | 도착·완료 체크 기록, 실제 체류 산출, `VisitChecked` 발행 |
| NFR | PERF-U4-05(낙관적 갱신) · OFFLINE-U4-02(오프라인 큐 — **기기 시각으로 확정해 큐에 실음**) |
| 경계 | **사진·메모 없음**(DEC-U4-10). `actual` 계층 소유는 U5 C12로 이관 예정(**G-U4-5**) |

### LC-U4-7. `LocationTrailRecorder` + `LegalLogEmitter` (C10 → U5 이관 예정)
| | |
|---|---|
| 책임 | 실제 경로 점열 적재(샘플링·정확도 필터) + `location_legal_log` 구간 이벤트 발행 |
| NFR | P-DATA-U4-1(구간 집계·좌표 본문 밖) · P-DATA-U4-2(**기존 L3 동의 재사용**) · DATA-U4-01·02(50m 샘플링·90일 보존, **근거 없는 초기값**) |
| 불변식 집행 | INV-U4-07(동의 없으면 행 없음) · INV-U4-08(걸음 수 없음) · LEGAL-U4-05(재계획용 일회성 위치 미적재) |
| 기존 자산 | `location_consent_state`(3층) · `location_legal_log`(append-only, `V1.7`로 UPDATE/DELETE 회수) — **신설 0** |

### LC-U4-8. `GeofenceRegistrar` (frontend `shared/location`)
| | |
|---|---|
| 책임 | 다음 예정지 **2곳** 슬라이딩 창 등록·해제. 방문 완료·시각 경과 때 맨 앞 해제 + 다음 1곳 추가 |
| NFR | P-MOBILE-U4-1 · MOBILE-U4-04·07(wake에서 평가 1회 + 필요 시 로컬 알림만) |
| 중복 처리 | 인접 리전 중첩 시 **같은 wake 안에서 중복 요청 금지**, 서버는 `(tripId, slotKey)` 기준 선착 하나만 도착 확정 |
| 강등 | 권한 없음·등록 실패·정확도 미달 → 포그라운드 감지 → 수동 체크인. **기능 차단 없음** |
| 의존 | `expo-task-manager`(신규) + `expo-location` plugin 확장 — **EAS 재빌드 선행**(tech-stack 델타 1) |
| 소유 | `shared/location`이 **위치 권한·수집 단일 소유**다. `features/execution`·`features/planb`가 각자 위치 코드를 만들지 않는다 |

### LC-U4-9. `SignalCollector` (frontend `features/execution/model`)
| | |
|---|---|
| 책임 | 평가 요청 발화점 4개(화면 진입 · 포그라운드 복귀 · 슬롯 경계 통과 · 방문 체크 직후)에서 신호를 모아 서버에 보냄 |
| NFR | P-DET-U4-1(**임계를 모른다**) · PERF-U4-01(주기 폴링 없음) · P-PERF-U4-2(자연 상한) |
| 금지 | 자체 판정으로 배너를 띄우지 않는다. 구조 가드 `liveTimeStructure.test.ts`가 시각 산술 0건을 잠근다 |

---

## 3. 기존 자산 수용 (신설하지 않는 것)

| 자산 | 위치 | U4의 사용 |
|---|---|---|
| `change_log_entry` + `ChangeLogFacade` | `modules/change-log` · V2.11 | 확정 시 append. **`PLAN_B` 출처값·`reason` 칸이 이미 있다** |
| `@EnableScheduling` + `StalePartialSweeper` | `app/config/AsyncConfig.kt` | 세션·트리거 정리에 **패턴 재사용** |
| `location_consent_state`(3층) · `location_legal_log` | V1.3 · V1.7 | 동의 축·법정 로그 **그대로** |
| actuator `health,info,metrics` + OTLP | `application.yml` | 지표 이름만 추가 |
| C7 place-data(영업시간·POI 정본) | `modules/place-data` (U1) | 조회만 — U4가 외부 POI API를 직접 부르지 않음 |
| `TravelEstimatePort` | U1 | 거리 추정 승계 |
| `proposeSlotCandidates` | U3 신설 계약 | `i14` 슬롯 후보 교체에 **그대로 재사용**(신규 경계 0) |
| `KakaoMapView` | `shared/map` | 점선 레이어만 확장(tech-stack 델타 3) |

## 4. 마이그레이션 (V2.14~ 대역)

`plan_b_trigger` · `plan_b_suppression` · `visit_check` · `replan_session` · `actual_route_point` · `weather_snapshot` — 6종. 상세 필드는 `functional-design/domain-entities.md`가 정본이다.

> **앱 롤 권한**: `location_legal_log`(V1.7)와 `change_log_entry`(V2.11)의 append-only 회수는 **이미 적용돼 있다.** U4 신규 6종 중 append-only가 필요한 것은 없다 — `plan_b_trigger`·`actual_route_point`는 **여행 단위 파기 대상**이라 DELETE 권한이 있어야 한다(LEGAL-U4-04 `PURGE`).

## 5. 미결 (설계 단계에서 닫지 않은 것)

| ID | 내용 | 담당 |
|---|---|---|
| ~~O-U4-1~~ | **종결(2026-08-09)** — 지오펜스 창 = 다음 2곳(Q2=A′) | LC-U4-8 |
| O-U4-2 | 민감도 설정의 소유(계정 vs 여행) | U6 설정 설계 |
| O-U4-3 | 체류 초과 임계값 | 개발 중 실측 |
| O-U4-4 | 재계획 응답 예산 | 개발 중 실측 |
| O-U4-5 | 방향 지시어 7종의 ai 해석 규약 | G-U4-3 HTTP 표면 티켓과 함께 |
