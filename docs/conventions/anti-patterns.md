# 안티패턴 로그 (실패·실수를 통한 학습)

> **목적**: 개발 중 테스트 실패·구현 실패·설계 오류가 나올 때마다 **근본 원인**을 파악해 "이렇게 하면 안 된다"를 한 줄로 누적한다. 동일한 시행착오를 반복하지 않기 위함.
>
> **기록 규칙**
> - 한 항목 = **규칙(하지 말 것 → 대신 할 것)** + 왜 + 근거(티켓/PR).
> - 실패가 실제로 발생했을 때만(가설 금지). 재현·검증된 것만.
> - 최신 항목을 각 영역 맨 위에 추가. 영역이 없으면 새로 만든다.
> - AI 에이전트(Claude Code)는 작업 착수 전 이 문서를 읽고, 새 실패가 나오면 여기에 한 줄 추가를 제안한다.

---

## DB · 스키마 · 마이그레이션

- **부모가 "삭제 후 재삽입"으로 교체되는 테이블에 `ON DELETE CASCADE` 자식을 매달지 말 것 → 수명 주기의 진짜 주인(상위 엔티티)에 매단다.** 일정은 편집·되돌리기마다 `replaceForTrip`(DELETE→INSERT)로 통째 교체되므로, `itinerary_id` FK CASCADE 로 매단 편집 이력이 **편집 한 번에 전부 지워졌다.** 게다가 재생성은 새 `itinerary_id` 를 발급해 이력이 과거와 끊긴다. FK 를 걸기 전에 "부모 행이 UPDATE 되는가, 교체되는가"를 먼저 확인할 것. E2E 가 아니면 안 드러난다(단위 테스트의 인메모리 Fake 엔 cascade 가 없다). (TRIP-310, PR #131 — 정본 §2.1 도 함께 정정)
- **컬럼을 다른 테이블로 옮기면 길이 검증도 함께 옮길 것.** 편집 사유를 `change_log_entry.reason varchar(500)` 에서 `itinerary_revision.summary varchar(200)` 으로 옮기며 요청측 `@Size(max=500)` 을 그대로 둬, 201~500자 입력이 `22001` → **편집까지 롤백되고 500**. 컬럼 상한과 요청 상한은 같은 커밋에서 함께 움직여야 한다. (TRIP-310, PR #131)
- **JPA에서 같은 트랜잭션 내 "삭제 후 재삽입"(자식 컬렉션 교체)을 파생 `deleteByX`로 하지 말 것 → bulk `@Modifying @Query` delete.** 파생 `deleteByX`는 `em.remove`로 큐잉되고, Hibernate는 flush에서 **INSERT를 DELETE보다 먼저** 실행해 같은 키 재삽입 시 unique 제약 위반(`ux_trip_destination_seq` 등). bulk delete는 즉시 실행돼 옛 행이 먼저 사라진다. (TRIP-177, PR #35)
- **다중 경로로 cascade되는 FK에 `ON DELETE RESTRICT`/`NO ACTION`을 쓰지 말 것 → `DEFERRABLE INITIALLY DEFERRED`.** `account → saved_stay` 와 `account → trip → base_assignment → saved_stay` 처럼 다이아몬드로 cascade되면, 즉시 검사되는 RESTRICT/NO ACTION이 cascade 도중 참조를 발견해 **계정 하드삭제(퍼지)를 깨뜨린다.** DEFERRABLE는 커밋 시점에 검사해 참조가 이미 사라져 통과하되, 직접 삭제 가드는 유지된다. (TRIP-174, PR #29 · 로컬 PostgreSQL 재현·검증)
- **jsonb 컬럼을 수동 `ObjectMapper`로 직렬화하지 말 것 → 도메인 타입에 `@JdbcTypeCode(SqlTypes.JSON)`.** 수동 직렬화는 이중 인코딩(JSON 안에 escape된 JSON 문자열)을 만든다. `Map<String,String>`·`List<...>` 같은 도메인 타입에 직접 매핑하면 Hibernate가 처리. (TRIP-155)
- **불변식을 앱에서만 지키지 말고 DB CHECK로도 강제할 것.** 예: `coord_confirmed=true`인데 좌표 null, lat/lng 한쪽만 있는 상태가 DB에서 허용됐음 → `CHECK ((lat IS NULL)=(lng IS NULL) AND (NOT coord_confirmed OR lat IS NOT NULL))`. (TRIP-174 검수)
- **마이그레이션은 반드시 실제 PostgreSQL에 V1→최신 전체 체인으로 적용해 검증할 것.** 파일 단독 문법 검사로는 FK cascade·권한·제약 상호작용 버그를 못 잡는다. Testcontainers 통합테스트(`SchemaMigrationIT`)나 로컬 docker DB로 실 적용. (TRIP-174)

## 설계 · 문서

- **"큰그림" 문서(전체-최소-스키마.dbml 등)를 마이그레이션 정본으로 쓰지 말 것 → 유닛별 설계문서(`U1-DB스키마-설계.md` 류)가 정본, 큰그림은 사후 동기화.** 큰그림은 의도적으로 최소 컬럼이라 CHECK·enum·인덱스가 없고, 구현 refinement(PK명·운영컬럼)를 못 따라가 드리프트한다. 유닛 문서 → 구현 → 큰그림 동기화 순. (2026-07-24 스키마 동기화, PR #26/#28)
- **유닛 번호를 문서마다 다르게 쓰지 말 것 → 충돌하면 이름으로 표기.** 백엔드 로드맵·inception·AI 트랙이 U1을 서로 다른 것으로 불러 혼란. 번호가 겹치면 "기반/숙소·여행" 같은 이름 사용.

## 외부 경계 · 어댑터

- **외부(AI·벤더) 문자열을 검증 없이 저장하지 말 것 → 저장 상한에 맞춰 자른다(거부 아님).** LLM 설명·거리 문구는 길이 보장이 없어 컬럼을 넘기면 `22001` 로 **정상 생성된 일정이 통째로 롤백되고 500** 이 나간다. 사용자가 고칠 수 있는 값이 아니므로 400 으로 되돌리는 것도 답이 아니다 — 잘라서 진행하고 잘림을 말줄임표로 드러낸다. 자를 때는 **서로게이트 페어를 끊지 말 것**(고아 서로게이트가 남아 UTF-8 인코딩에서 문자가 깨진다 — 이모지가 섞이면 실제로 발생). (TRIP-306·308, PR #129)
- **형태가 미확정인 응답 필드를 데이터 클래스로 고정하지 말 것 → 원시 노드로 받아 방어적으로 읽는다.** 부가 메타 하나(`candidates_summary`)를 타입으로 고정했더니 **명시적 `null`·문자열 등 예상 밖 형태 하나에 역직렬화가 통째로 깨져**, 정상 200 응답이 버려지고 MINIMAL 폴백으로 강등됐다. "없으면 없는 것"과 "못 읽으면 전체 실패"는 다르다. 또 **없는 값을 기본값으로 채우지 말 것** — `poolSize` 를 `0` 으로 채우면 "후보 0건"이라는 AI 판정을 백엔드가 지어내는 셈이다. (TRIP-306, PR #129)
- **키 규약이 미합의인 맵을 조용히 매칭하지 말 것 → "받았는데 하나도 안 붙었다"를 로그로 드러낸다.** `explanations` 키 규약이 어긋나면 근거가 전부 null 이 되는데, 그 상태가 "AI 가 근거를 안 줬다"와 구분되지 않는다. (TRIP-306, PR #129)
- **계약 문서만 보고 경계 어댑터를 구현하지 말 것 → 상대 팀 구현 코드를 직접 열어 확인할 것.** 계약 문서는 합의 시점 스냅숏이라 상대 구현이 앞서가면 조용히 어긋난다. AI `solve_mode` 는 실제로 4값(`OR_TOOLS/LLM/RULE_FALLBACK/MINIMAL`)인데 계약·백엔드는 3값(`FULL_AI/DETERMINISTIC/MINIMAL`), `freshness` 도 필드 구성이 완전히 달랐다. 도메인 DTO 를 그대로 직렬화한 어댑터는 **실 연동 첫 호출부터 역직렬화 실패 → 매 요청 폴백**이 됐을 것이고, 로그엔 "AI 호출 실패"만 남아 네트워크 문제로 오인된다. → **어댑터 전용 wire DTO** 로 상대 스키마를 받고 도메인으로 매핑(차이를 어댑터가 흡수). (TRIP-229, PR #119 닫고 #121로 재작업)
- **미지 enum·필드를 조용히 기본값으로 흡수하지 말 것 → 실패로 승격.** 모르는 `solve_mode` 를 기본값으로 넘기면 계약 드리프트가 정상 동작으로 위장된다. INV-4(침묵 실패 금지)는 폴백뿐 아니라 **스키마 해석**에도 적용. (TRIP-229)
- **미배선 경계 메서드가 "빈 결과"를 반환하게 두지 말 것 → 명시적 실패.** `validate` 가 빈 위반 목록을 반환하면 "문제 없음"이라는 **거짓 음성**이 사용자 확정까지 흘러간다. 아직 못 붙였으면 실패시켜 드러내는 편이 안전. (TRIP-229)
- **`@ConditionalOnProperty` 를 빈 하나에만 걸지 말 것 → 설정 클래스 전체에.** 어댑터만 조건부로 두면 비활성 모드에서도 `@Configuration` 의 다른 빈들이 생성돼 부작용이 상시 발생한다. "기능이 꺼져 있으니 무해하다"는 가정 자체가 검증 대상. (TRIP-229, PR #119)
- **공유 `RestClient.Builder` 빈을 변형(mutate)하지 말 것 → 어댑터마다 전용 빌더 생성.** `DefaultRestClientBuilder` 는 copy-on-write 가 아니라 in-place 변경이고, 여러 모듈이 같은 이름·타입 빈을 `@ConditionalOnMissingBean` 으로 공유한다. baseUrl·requestFactory·컨버터를 붙이면 **다른 모듈의 HTTP 클라이언트가 오염**된다(소셜 로그인 장애 위험). (TRIP-229, PR #119)
- **경계 전용 `HttpMessageConverter` 를 `@Bean` 으로 노출하지 말 것 → 설정 안에서 인스턴스로 만들어 해당 클라이언트에만 부착.** SB4 는 컨텍스트의 **모든** 컨버터 빈을 MVC 목록에도 주입하므로, AI 경계용 snake_case 컨버터가 **공개 API 응답을 snake_case 로** 바꿀 수 있다. (TRIP-229, PR #119)
- **SB4 의 기본 Jackson 은 3(`tools.jackson`)** — 경계 매퍼도 Jackson 3로 만들 것. Jackson 2(`com.fasterxml`) 컨버터를 붙이면 실제 통신에서 역직렬화가 깨진다. 또 빈 `JsonMapper` 는 Kotlin 모듈을 자동 등록하지 않아 데이터클래스 역직렬화가 실패하므로 `tools.jackson.module:jackson-module-kotlin` 을 명시 등록. (TRIP-229)

## 아키텍처 · 구현

- **애그리거트/엔티티에 필드를 추가하면 재구성 지점을 전부 세고, 전이 진입점(`reconstitute` 류)에는 기본값을 두지 말 것.** 같은 유실이 네 번 반복됐다 — `endsNextDay`(확정 시 소실 → 자정 일정 확정 400) · `distanceRange`(확정 시 소실) · `placementReason`·`candidatesSummary`(편집 한 번에 영구 소실). 기본값이 있으면 호출자가 그냥 빠뜨리고 **컴파일러가 아무 말도 안 한다**. 기본값을 없애야 비로소 누락 지점이 컴파일 에러로 드러난다(실제로 그렇게 4곳이 잡혔다). 세어야 할 곳: repo read/write · `create` · `reconstitute` · 상태 전이 메서드 전부 · 편집 reshape · 확정 동결 재조립 · 2차 생성. (TRIP-279 PR #120 · TRIP-306·308 PR #129)
- **파괴적 쓰기(복원·전체 교체)의 입력은 관용적으로 파싱하지 말 것 → 전부-아니면-전무.** 조회 표시라면 못 읽는 조각을 버리고 보여주는 게 낫지만, **그 값이 현재 상태를 지우고 덮어쓰는 입력**이면 부분 파싱은 조용한 데이터 손실이다(슬롯 하나가 빠진 채 200 이 나간다). 못 읽으면 복원을 거부해 드러낼 것. 같은 관용 파싱이라도 **읽기 경로와 쓰기 경로의 판단이 다르다**. (TRIP-310, PR #131)
- **중간 상태를 되돌리기 지점·이력으로 남기지 말 것 → 생성이 끝난 상태에서 남긴다.** 2단계 생성의 1차(day1만) 상태로 리비전을 남겼더니, **5일 일정에서 그 지점을 복원하면 2~5일차가 통째로 사라졌다.** "사용자가 실제로 본 완결 상태"만 복원 지점이 될 수 있다. (TRIP-310, PR #131)
- **`AsyncConfigurer.getAsyncExecutor()` 안에서 실행기를 직접 만들지 말 것 → `@Bean` 으로 등록.** 빈이 아니면 스프링이 소유하지 않아 `destroy()` 가 불리지 않고, `setWaitForTasksToCompleteOnShutdown`·`setAwaitTerminationSeconds` 가 **전부 죽은 코드**가 된다. 스레드가 남은 채 DataSource 가 먼저 닫혀 진행 중 작업이 실패한다. 아울러 기본 `CallerRunsPolicy` 는 **종료 중이면 작업을 조용히 버리므로**(INV-4 위반) 그 경우를 로그로 드러낼 것. (TRIP-267, PR #127)
- **읽고-쓰는 사이에 다른 쓰기가 끼어들 수 있는 백그라운드 작업은 조건부 쓰기로 할 것.** 가드는 `SELECT` 로 판정하는데 실제 쓰기가 `DELETE ... WHERE trip_id` 면, 그 사이 재생성이 커밋한 **새 일정까지 지운다**. 삭제 키를 id·상태로 못박고 영향 행 수가 0이면 아무것도 쓰지 않는다. (TRIP-267, PR #127)
- **기존 인스턴스에서 파생시키는 frozen dataclass를 필드 나열로 재구성하지 말 것 → `dataclasses.replace(원본, 바꿀_필드=…)`.** 나열식은 나중에 **추가된 필드를 조용히 떨어뜨린다** — 생성자 호출이 그대로 성공하고(기본값이 채워짐) 모든 필드가 유효한 값이라 **타입 체크·기존 테스트로 검출되지 않으며**, 재구성이 있는 **한 경로에서만** 기능이 소실된다. `c2/facade.py`의 `regenerate()`가 `ItineraryProblem`을 나열로 재구성해, 뒤늦게 추가된 `excluded_poi_ids`(TRIP-293)를 빠뜨려 regenerate 경로에서만 기배정 POI 제외가 사라졌다. `replace`는 나열하지 않은 필드를 전부 그대로 옮기므로 필드가 추가돼도 파생이 자동으로 따라온다. (TRIP-292 재현·수정 · TRIP-314에서 `c2/ortools_solver.py::_greedy_hint` 동일 전환)
- **`ApplicationRunner`/`@PostConstruct`로 기동 시 DB write를 하지 말 것.** 모든 `@SpringBootTest` 전체-컨텍스트 테스트가 그 write에 의존하게 돼, 스키마·컨테이너 설정이 다른 최소 테스트까지 컨텍스트 로드 실패로 깨진다. 시드는 `@Profile` 가드·테스트 픽스처·명시적 호출·`@Scheduled`로. (TRIP-175, PR #30 CI — DatabaseConnectivityIT)
- **스텁/인메모리 어댑터에 캐시(Redis)·서킷브레이커(Resilience4j)를 붙이지 말 것 → 실 외부 어댑터 단계로 이연.** 스텁은 외부 지연·실패가 없어 캐싱·보호할 대상이 없다. 포트 경계만 잡아두고 실 벤더 붙일 때 감싼다("측정된 필요까지 이연" 원칙). (TRIP-175)
- **포트 인터페이스에 메서드를 추가하면 모든 Fake/TestDouble 구현도 즉시 갱신할 것.** 안 하면 컴파일은 통과해도 다른 모듈 테스트의 fake가 깨진다. (TRIP-158 — RefreshTestDoubles)
- **새 기능 모듈은 아키텍처 게이트에 등록할 것.** `ArchitectureRulesTest`의 R1 슬라이스·R5 패키지 목록에 모듈 패키지를 추가하지 않으면 경계 위반이 감지되지 않는다(vacuous pass). **재발**: `change-log` 모듈 신설 때 또 빠뜨려, "모듈을 분리해 경계를 지켰다"는 PR 설명과 달리 `itinerary-generation → changelog.application` 직접 참조가 빌드를 그냥 통과했다. 모듈 추가 커밋에 게이트 등록을 **같이** 넣을 것. (TRIP-175 · 재발 TRIP-275 PR #128)
- **여러 write를 하는 애플리케이션 서비스(특히 크로스모듈 퍼사드 write + 로컬 save)는 `@Transactional`로 묶을 것.** 없으면 각 repo 어댑터 호출이 독립 트랜잭션이라, 앞 write(예: `PoiSnapshotFacade.freeze`가 스냅숏 커밋)가 커밋된 뒤 뒤 단계(도메인 검증 throw·유니크 위반)가 실패하면 **고아 행**이 남는다. 순서 재배치("중복 먼저")로는 검증 throw·레이스를 못 막는다 — 원자성은 트랜잭션이 담당. (PR #50 — MustVisitService orphan poi_snapshot)
- **check-then-insert 유니크 경합은 어댑터 `saveAndFlush` + 서비스 `catch DataIntegrityViolationException → 409`로 처리할 것.** 선검사(`existsBy…`)만 두면 레이스가 빠져나가 unmapped 500이 된다. `save`(플러시 지연)로는 위반이 커밋 시점에 터져 서비스 try 밖에서 새므로 반드시 `saveAndFlush`. (PR #50 — SavedPlace/MustVisit; 관례: auth `AccountDeletionService`·profile `NicknameService`)
- **산출 구조체의 필드를 `()`·기본값으로 채워 넘기지 말 것 → 원천(해·문제)에서 읽어 채우고 경계 왕복 회귀 테스트를 둘 것.** 경계 사영이 그 필드에서 사실을 읽으면(AI `routes.to_payload`가 `DaySolution.fixed_blocks`로 `is_fixed` 판정) 기본값이 그대로 응답이 된다 — 타입도 테스트도 통과하는 침묵 소실. 실제로 세 솔버(OR-Tools·규칙·LLM)가 전부 `fixed_blocks=()`로 보내 응답 `is_fixed`가 상시 false였고, 백엔드 왕복 후 HC3 검증 집합이 비어 repair가 사용자 고정 시각을 침묵 이동할 수 있었다. (TRIP-343)

## Kotlin · 언어

- **Kotlin 주석(특히 KDoc `/** */`) 안에 `/api/v1/**` 같은 `/*` 시퀀스를 넣지 말 것.** Kotlin은 블록주석이 **중첩**돼서, 경로 글로브의 `/`+`*`가 중첩주석을 열고 KDoc의 `*/`가 그 중첩분만 닫아 **파일 전체가 미완결 주석**이 된다("Unclosed comment" + 뒤이어 import·참조 전부 unresolved 연쇄). 주석에선 글로브를 "(base 하위)"처럼 풀어쓰거나 백틱/코드블록으로. (PR #44 OpenApiContractIT)
- **Spring MVC의 `RequestMappingHandlerMapping` 은 `..mvc.method.annotation` 패키지다**(`..mvc.method` 아님). 또 컨텍스트에 매핑 빈이 여럿이라 주입 시 `@Qualifier("requestMappingHandlerMapping")`로 MVC 것을 지정(actuator 매핑과 구분). (PR #44)

## 테스트

- **경계 규모를 최소 케이스로만 테스트하지 말 것.** 되돌리기 테스트를 전부 **하루 여행**으로 짜서, 다일 여행에서만 도는 2단계 생성 경로(그리고 "복원하면 2~5일차가 사라지는" 결함)를 전부 놓쳤다. 분기가 규모에 따라 갈리면(1일 vs N일, 1건 vs 다건) **양쪽 다** 테스트할 것. (TRIP-310, PR #131)
- **필드를 관통시키는 변경은 "쓰는 경로"까지 테스트할 것 → 조회만 검증하면 놓친다.** `ends_next_day` 관통 테스트가 저장→GET 만 확인하고 **확정(confirm)** 을 호출하지 않아, 동결 재조립에서 플래그가 빠져 **자정 일정 확정이 항상 400** 인 버그를 CI 가 초록으로 통과시켰다. 두 PR(플래그 도입·동결 재조립)이 각각 머지되며 생긴 상호작용이라 단일 PR 리뷰로도 안 잡혔다. (TRIP-279, PR #120)
- **버그 수정 후 수정을 되돌려 테스트가 실제로 실패하는지 확인할 것(역검증).** 회귀 테스트가 버그를 잡지 못하는데 통과만 하는 경우를 걸러낸다. (TRIP-279, PR #120)
- **새 상태값·enum 을 추가하면 기본값이 아닌 값으로 DB 왕복을 한 번은 검증할 것.** 기본값(`COMPLETE`)만 단언하면 CHECK 값 집합·컬럼 길이·엔티티 매핑 중 무엇도 실증되지 않아, 실제로 다른 값을 INSERT 하는 순간 제약 위반이 난다. (TRIP-267, PR #118)

- **목(MSW 등) 핸들러를 서버의 성공 응답만으로 채우지 말 것 → 그 엔드포인트가 실제로 내는 에러 응답부터 맞춘다.** 목이 성공만 흉내내면 실패 분기가 **도달 불가인 채로 전 테스트 초록**이 되고, 도달 불가라는 사실 자체를 목이 가린다. 소셜 로그인 `new-user` 목이 200+`isNewUser:true`를 돌려줬으나 실서버는 신규 가입 첫 요청에 400(`fields[].field=ageConfirmation`)이라, 프론트의 `needs-age` 전이가 실서버에서 **영구 도달 불가**(=신규 가입 0건)인데 3개 테스트 파일이 계속 초록이었다. 구현을 고쳐도 목을 안 고치면 테스트가 옛 모양을 계속 지킨다. (TRIP-248 · 2026-08-02 코드 실측)
- **같은 패키지의 서로 다른 테스트 파일에 동일 이름의 private 최상위 테스트 더블(`FakeBases` 등)을 두지 말 것 → 파일마다 고유 이름(`StubBases`).** 한 모듈의 두 테스트가 같은 패키지에서 각각 `private class FakeBases`를 선언하자 "Redeclaration" 컴파일 에러 발생. 새 포트 메서드 추가로 여러 테스트의 Fake를 갱신할 때 특히 부딪힌다. (TRIP-178 검수 수정)
- **크로스모듈 포트/인터페이스 시그니처를 바꾸면 증분 `:app:test`가 아니라 `clean build`로 검증할 것.** 다른 모듈(예: :modules:auth의 `SocialAuthPort`)에 메서드를 추가하면 그걸 익명 구현한 :app 테스트의 Fake들이 깨지는데, Kotlin **증분 컴파일이 전이적으로 영향받는 테스트 파일을 재컴파일하지 않아** 로컬 `:app:test`는 통과하고 CI의 `./gradlew build`(clean)만 `:app:compileTestKotlin FAILED`로 터진다. (PR #38 — SocialAuthPort 4개 Fake 중 3개 누락)
- **통합테스트(IT)가 있는 변경은 모듈 단위·일부 IT만 돌리고 푸시하지 말 것 → `:app:test` 전체를 돌린다.** 기동 부작용은 안 돌린 다른 IT에서만 터져 CI에서 처음 드러난다(로컬 초록·CI 빨강). (TRIP-175, PR #30)
- **백틱 테스트 함수명에 `<` `>` `.` `;` `[` `/` 등 JVM 식별자 금지문자를 넣지 말 것.** 예: `` `체크아웃 <= 체크인은 400` `` → 컴파일 에러 "Name contains illegal characters: <". 부등호는 "이하/초과" 같은 말로. (TRIP-176)
- **fresh 계산값과 DB 왕복값의 타임스탬프를 정확 비교하지 말 것.** 방금 만든 `Instant`는 나노초, Postgres `timestamptz` 왕복은 마이크로초 → 로컬 통과·CI 실패로 flaky. 멱등성은 진행 clock(tick +1s) 단위테스트로 검증, E2E는 존재/비교만. (TRIP-159 — BootstrapOnboardingApiIT)
- **PBT/제약 검증 시 조합 케이스를 빠뜨리지 말 것.** 예: filter-zero 원인 계산이 개별 필터만 보고 조합(각 필터는 개별 매칭이나 AND로 0건) 케이스를 놓쳤다 → 활성 필터 전부를 완화 후보로. (TRIP-175 검수)
- **domain 패키지 경로(`/domain/`)에 프레임워크(Jackson·Spring·JPA)를 import하는 테스트를 두지 말 것 → `/contract/`·`/adapter/` 등 domain 밖 패키지에.** Konsist R2가 `files.filter { "/domain/" in path }`로 **테스트 소스까지 경로 기준으로 스캔**해서, domain 패키지에 둔 직렬화·계약 테스트가 jackson을 import하면 R2(domain 순수성)가 실패한다. (BE-1 TRIP-228 ScheduleAgent 계약 테스트 — snake_case 왕복 테스트를 `..domain..`→`..contract..`로 이동)
- **DTO 왕복(round-trip) equality 테스트는 픽스처를 한 번만 생성해 비교할 것.** 픽스처 팩토리가 `UUID.randomUUID()` 등 비결정 값을 담으면 `readValue(write(a)) shouldBe factory()`가 매번 다른 인스턴스와 비교돼 깨진다 — `val a = factory()` 한 번 잡고 그 `a`와 비교. (TRIP-228)

## Git · 프로세스

- **스택형 브랜치를 squash 머지 후 rebase하지 말 것.** squash가 patch-id를 바꿔 add/add 충돌 발생 → `git rebase --onto origin/develop <oldBaseTip> <branch>`로 중복 커밋을 건너뛴다. (TRIP-152/153)
- **작업 착수 시 가장 먼저 `git checkout -b feature/...` 로 브랜치를 만들 것.** 안 만들고 코딩하면 커밋이 develop에 직접 쌓인다(push는 보호로 막히지만 로컬 develop이 오염 → 커밋을 브랜치로 옮기고 `git branch -f develop origin/develop` 으로 되돌려야 함). (TRIP-177)
- **develop에 직접 푸시하지 말 것 → 항상 feature 브랜치 + PR.** develop은 PR로만 받는다.
- **외부 검증기가 실패했을 때 "위반 없음"으로 접지 말 것 → 판정 보류를 타입으로 구분할 것.** 재검증 호출을 `runCatching { }.getOrDefault(emptyList())` 로 접으면 AI 장애가 곧 **"검증했더니 깨끗하다"는 거짓 표시**가 되어 화면의 위반 배지가 조용히 꺼진다(사용자는 문제를 못 본 채 확정한다). 실패는 `Judged`/`Withheld` 로 나눠, 보류면 **직전 표시를 그대로 잇는다**. 아울러 이런 비차단 검증은 **호출 자체를 감싸지 않으면 사용자 API 가 그대로 500** 이 된다 — `EditItineraryService`·`ItineraryRevisionService` 가 무보호였다(AI팀 감사 지적, TRIP-309 후속).
- **미개통·장애인 외부 경계를 그냥 예외로 흘리지 말 것 → 도메인 예외로 표면화할 것.** 포트 구현이 던지는 예외가 `DomainException` 계열이 아니면 전역 핸들러의 `Exception` 갈래에 걸려 **500 `INTERNAL`** 이 나간다 — "우리가 터졌다"는 거짓 신호이고, openapi 가 그 오퍼레이션에 약속한 적도 없는 상태다. `UpstreamUnavailable(source, fallbackApplied)` 로 바꿔 **503** 으로 낸다. 지어낼 수 없는 결과(closed-set 후보 등)는 `fallbackApplied=false` — 빈 목록으로 접으면 "주변에 없음"이라는 정상 결과와 구분되지 않는다. (`SlotCandidateService`, TRIP-311 후속 검수)
- **설정 스위치를 넣었으면 "값이 붙는가"와 "구현이 바뀌는가"를 **따로** 검증할 것.** 프로퍼티 바인딩이 맞아도 조건부 빈이 안 걸리면 여전히 기존 구현이 주입되고, 앱은 **기본값으로 멀쩡히 기동**한다. 그러면 통합테스트에서 상대 서비스를 띄워놓고 한 번도 호출하지 않은 채 "전부 정상"으로 보인다 — 가장 나쁜 실패 모드다. 환경변수 이름 바인딩 테스트 + 주입된 구현 타입 테스트를 둘 다 둔다. (TRIP-229 compose 스위치)
- **조건부 설정 안에서만 등록되는 빈을, 조건 없는 컴포넌트가 생성자로 주입받지 말 것.** `@ConfigurationProperties` 클래스는 보통 `@EnableConfigurationProperties` 를 단 **설정 클래스와 수명을 같이 한다** — 그 설정이 `@ConditionalOnProperty` 라면 조건이 꺼진 평상시에는 빈이 없다. 조건 없는 `@Component` 가 그걸 받으면 **평상시 기동이 통째로 실패**한다(`NoSuchBeanDefinitionException`). 설정값만 필요하면 `@Value` 로 프로퍼티에서 직접 읽는다. 아울러 **두 모드 각각의 컨텍스트 부팅 테스트**를 둔다 — 한쪽만 있으면 반대쪽 기동 실패를 못 잡는다. (TRIP-229 모드 안내 컴포넌트, 자체 검수에서 만들었다가 잡음)
- **"상대 스키마 검증을 통과한다"를 "상대가 수용한다"로 읽지 말 것.** 경계 계약 테스트가 상대의 요청 스키마(Pydantic 등)만 통과시키면, **한 겹 안쪽의 스키마→도메인 변환**에서 나는 거부를 못 본다. 실제로 골든 픽스처의 ANYTIME 고정 블록(`date`/`start`=null)은 AI 의 `api/schemas.py` 는 통과하지만 `api/wiring.py` 변환에서 422 로 거부돼 **요청 전체가 폴백**된다 — 그런데 픽스처가 그 모양을 "정상"으로 굳혀 놓아 아무도 실패를 보지 못했다. 계약 테스트는 **필드 이름 드리프트**를 잡는 것이지 수용 보증이 아니다. 알려진 간극은 "뒤집을 시점"을 이름에 적은 테스트로 못 박는다. (TRIP-229 · 경계 계약 확정 M1)
- **한 트랜잭션에서 "기존 행 닫고 새 행 열기"를 할 때 UPDATE 를 `save` 로만 하지 말 것 → `saveAndFlush`.** JPA 는 UPDATE 를 커밋 시점까지 미루므로 **INSERT 가 먼저 나간다** — 그 순간 "열린 행"이 둘이 되어 부분 유니크 인덱스에 걸리고 사용자에게 500 이 나간다. 단위 테스트(in-memory 저장소)는 순서를 재현하지 않아 못 잡는다. **실 DB API IT 가 있어야 드러난다**. (`ReplanSessionPersistence`, TRIP-273 · INV-U4-06)
- **작업 착수 전 `aidlc/aidlc-docs/construction/<unit>/` 을 반드시 확인할 것.** inception(요구·스토리)과 패키지 정본(`backend/docs/design/`)만 읽고 시작하면, **유닛별 상세 설계(엔티티·상태 어휘·불변식 INV-U4-*)를 통째로 놓친다.** 실제로 U4 착수 시 이를 지나쳐 모듈 분할·상태 어휘·중복 진입 처리·억제 기록 방식 등 7군데가 정본과 어긋난 PR 2건을 만들었고 전부 재작업했다. 요약 문서(`전체-최소-스키마-설명.md`)와 construction 정본이 다르면 **construction 이 최신**인지 날짜로 확인한다.
- **모르는 값을 0·기본값으로 채워 집계하지 말 것 → 집계 자체를 null 로 둘 것.** 거리를 모르는 슬롯을 0으로 보고 합치면 "총 이동 거리가 줄었다"는 **거짓 요약**이 나오고, 사용자는 그 근거로 확정한다. 0은 "붙어 있다"는 사실이고 null은 "모른다"라 섞을 수 없다. 같은 이유로 외부 조회 실패를 "강수확률 0%"로 저장하면 그 값이 캐시에 남아 **없는 사실을 알리는 근거**가 된다(INV-U4-09). (`ReplanDiff`·`WeatherContextService`, TRIP-274·273)
- **스택 PR 을 `--delete-branch` 로 머지하기 전에, 그 브랜치를 base 로 삼은 PR 을 먼저 `develop` 으로 retarget 할 것.** base 브랜치가 사라지면 GitHub 이 그 PR 을 **자동으로 닫고, 재오픈도 막는다**("Cannot change the base branch of a closed pull request"). 리뷰 코멘트·CI 이력이 붙은 PR 을 통째로 잃고 새로 열어야 한다. 실제로 5단 스택에서 첫 머지에 2번 PR 이 닫혀 새 번호로 다시 열었다. 남은 PR 을 미리 retarget 해 두면 그 뒤로는 자동 닫힘이 없다. (덧: 스택은 squash 머지와 함께 쓰면 뒤 PR 이 연쇄 충돌하므로, 가능하면 develop 기준 독립 PR 로 자르는 편이 낫다.)
- **인터페이스를 스텁으로 대신하는 소비 측 테스트만 두지 말 것 → 실물 구현에도 전용 테스트를 둘 것.** 스텁은 계약을 *가정*하고 실물은 계약을 *구현*하는데, 테스트가 전부 소비 측에 있으면 **그 가정만 검증된다** — 실물이 계약을 어겨도 아무것도 깨지지 않는다. 특히 **계약 주석에만 적힌 규칙**이 위험하다: `PoiSurfaceFacade` 의 "상태 무관으로 돌려준다"(후보풀의 ACTIVE-only 와 반대)는 `findByIds`→`findActiveByIds` 한 글자로 무너지는데, 확정 일정의 폐업 장소가 화면에서 조용히 사라질 뿐 테스트는 전부 통과했다. 점검법: `api` 인터페이스를 전수로 뽑아 **실물 구현 클래스명이 테스트에 등장하는지** 훑는다(실 IT 에서 실물이 도는 경우는 그것으로 충분). (TRIP-273 후속 전수 점검 — `ItineraryFacade`·`PoiSurfaceFacade` 2건 발견)
- **"진행 중" 상태 리소스를 만들면 그 상태가 **닫히는 경로를 전수로 세어** 각각 테스트할 것.** 성공 경로 하나만 닫아 두면 나머지 경로에서 세션이 열린 채 남고, 화면은 **끝난 적 없는 생성을 영원히 기다린다**(진행률 스피너·[취소] 버튼이 계속 떠 있다). 일정 생성 세션(h09)에서 실제로 닫히는 경로는 다섯이었다 — ①정상 완료 ②2차 없는 하루 여행 ③2차 반영 실패 ④**1차 저장 실패(사용자는 500 을 받는데 화면은 "생성 중")** ⑤프로세스 중단(스위퍼가 일정만 정리하고 세션은 방치). ④⑤는 자체 검수에서야 드러났다. 점검법: 상태를 여는 호출을 잡고 **그 뒤로 갈라지는 모든 반환·예외 경로**를 따라가며 닫는 호출이 있는지 센다. 배치 정리(sweeper)가 있다면 **정리 대상이 둘(일정·세션)인지** 확인한다 — 한쪽만 내리면 두 표면이 서로 다른 말을 한다. (TRIP-312, PR #190)
- **정본에 필드가 있다고 그대로 만들지 말 것 → 읽는 곳이 없으면 만들지 않고 이탈 사유를 남긴다.** U3 정본 §2.2 의 `partial`(day1 중간 결과 jsonb)을 그대로 컬럼·도메인 필드로 만들었는데, day1 은 이미 일정 행에 `PARTIAL` 상태로 저장돼 있고 화면도 일정 조회로 읽어서 **아무도 쓰지 않는 항상-null 컬럼**이 됐다. 사본을 두면 두 벌이 갈라졌을 때 **어느 쪽이 사실인지 판단할 근거가 없다**. 정본은 "무엇이 필요한가"를 정하지 "어디에 저장하는가"까지 정하지 않는다 — 읽는 곳을 못 찾으면 만들지 말고, 마이그레이션·도메인 주석에 **이탈 사유를 적어** 다음 사이클이 "빠뜨렸다"고 오해하지 않게 한다. (TRIP-312, PR #190)
- **PATCH 요청 DTO 의 `null` 을 "지움"으로 읽지 말 것 → "변경 없음"으로 읽을 것.** 코틀린 data class 의 nullable 기본값은 **보내지 않은 필드와 명시적 null 을 구분하지 못한다.** 그래서 "도착 시각만 고치겠다"는 요청이 **완료 기록을 함께 지운다** — `visit_check` 에서는 그 순간 재계획 잠금(INV-U4-04)이 조용히 풀린다. 지우는 경로가 실제로 필요하면 별도 오퍼레이션으로 두고, 보정 API 는 현재값을 기준으로 덮어쓴다. (`VisitCheck.adjustTimes`, TRIP-118 자체 검수)
