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

- **JPA에서 같은 트랜잭션 내 "삭제 후 재삽입"(자식 컬렉션 교체)을 파생 `deleteByX`로 하지 말 것 → bulk `@Modifying @Query` delete.** 파생 `deleteByX`는 `em.remove`로 큐잉되고, Hibernate는 flush에서 **INSERT를 DELETE보다 먼저** 실행해 같은 키 재삽입 시 unique 제약 위반(`ux_trip_destination_seq` 등). bulk delete는 즉시 실행돼 옛 행이 먼저 사라진다. (TRIP-177, PR #35)
- **다중 경로로 cascade되는 FK에 `ON DELETE RESTRICT`/`NO ACTION`을 쓰지 말 것 → `DEFERRABLE INITIALLY DEFERRED`.** `account → saved_stay` 와 `account → trip → base_assignment → saved_stay` 처럼 다이아몬드로 cascade되면, 즉시 검사되는 RESTRICT/NO ACTION이 cascade 도중 참조를 발견해 **계정 하드삭제(퍼지)를 깨뜨린다.** DEFERRABLE는 커밋 시점에 검사해 참조가 이미 사라져 통과하되, 직접 삭제 가드는 유지된다. (TRIP-174, PR #29 · 로컬 PostgreSQL 재현·검증)
- **jsonb 컬럼을 수동 `ObjectMapper`로 직렬화하지 말 것 → 도메인 타입에 `@JdbcTypeCode(SqlTypes.JSON)`.** 수동 직렬화는 이중 인코딩(JSON 안에 escape된 JSON 문자열)을 만든다. `Map<String,String>`·`List<...>` 같은 도메인 타입에 직접 매핑하면 Hibernate가 처리. (TRIP-155)
- **불변식을 앱에서만 지키지 말고 DB CHECK로도 강제할 것.** 예: `coord_confirmed=true`인데 좌표 null, lat/lng 한쪽만 있는 상태가 DB에서 허용됐음 → `CHECK ((lat IS NULL)=(lng IS NULL) AND (NOT coord_confirmed OR lat IS NOT NULL))`. (TRIP-174 검수)
- **마이그레이션은 반드시 실제 PostgreSQL에 V1→최신 전체 체인으로 적용해 검증할 것.** 파일 단독 문법 검사로는 FK cascade·권한·제약 상호작용 버그를 못 잡는다. Testcontainers 통합테스트(`SchemaMigrationIT`)나 로컬 docker DB로 실 적용. (TRIP-174)

## 설계 · 문서

- **"큰그림" 문서(전체-최소-스키마.dbml 등)를 마이그레이션 정본으로 쓰지 말 것 → 유닛별 설계문서(`U1-DB스키마-설계.md` 류)가 정본, 큰그림은 사후 동기화.** 큰그림은 의도적으로 최소 컬럼이라 CHECK·enum·인덱스가 없고, 구현 refinement(PK명·운영컬럼)를 못 따라가 드리프트한다. 유닛 문서 → 구현 → 큰그림 동기화 순. (2026-07-24 스키마 동기화, PR #26/#28)
- **유닛 번호를 문서마다 다르게 쓰지 말 것 → 충돌하면 이름으로 표기.** 백엔드 로드맵·inception·AI 트랙이 U1을 서로 다른 것으로 불러 혼란. 번호가 겹치면 "기반/숙소·여행" 같은 이름 사용.

## 아키텍처 · 구현

- **`ApplicationRunner`/`@PostConstruct`로 기동 시 DB write를 하지 말 것.** 모든 `@SpringBootTest` 전체-컨텍스트 테스트가 그 write에 의존하게 돼, 스키마·컨테이너 설정이 다른 최소 테스트까지 컨텍스트 로드 실패로 깨진다. 시드는 `@Profile` 가드·테스트 픽스처·명시적 호출·`@Scheduled`로. (TRIP-175, PR #30 CI — DatabaseConnectivityIT)
- **스텁/인메모리 어댑터에 캐시(Redis)·서킷브레이커(Resilience4j)를 붙이지 말 것 → 실 외부 어댑터 단계로 이연.** 스텁은 외부 지연·실패가 없어 캐싱·보호할 대상이 없다. 포트 경계만 잡아두고 실 벤더 붙일 때 감싼다("측정된 필요까지 이연" 원칙). (TRIP-175)
- **포트 인터페이스에 메서드를 추가하면 모든 Fake/TestDouble 구현도 즉시 갱신할 것.** 안 하면 컴파일은 통과해도 다른 모듈 테스트의 fake가 깨진다. (TRIP-158 — RefreshTestDoubles)
- **새 기능 모듈은 아키텍처 게이트에 등록할 것.** `ArchitectureRulesTest`의 R1 슬라이스·R5 패키지 목록에 모듈 패키지를 추가하지 않으면 경계 위반이 감지되지 않는다(vacuous pass). (TRIP-175)
- **여러 write를 하는 애플리케이션 서비스(특히 크로스모듈 퍼사드 write + 로컬 save)는 `@Transactional`로 묶을 것.** 없으면 각 repo 어댑터 호출이 독립 트랜잭션이라, 앞 write(예: `PoiSnapshotFacade.freeze`가 스냅숏 커밋)가 커밋된 뒤 뒤 단계(도메인 검증 throw·유니크 위반)가 실패하면 **고아 행**이 남는다. 순서 재배치("중복 먼저")로는 검증 throw·레이스를 못 막는다 — 원자성은 트랜잭션이 담당. (PR #50 — MustVisitService orphan poi_snapshot)
- **check-then-insert 유니크 경합은 어댑터 `saveAndFlush` + 서비스 `catch DataIntegrityViolationException → 409`로 처리할 것.** 선검사(`existsBy…`)만 두면 레이스가 빠져나가 unmapped 500이 된다. `save`(플러시 지연)로는 위반이 커밋 시점에 터져 서비스 try 밖에서 새므로 반드시 `saveAndFlush`. (PR #50 — SavedPlace/MustVisit; 관례: auth `AccountDeletionService`·profile `NicknameService`)

## Kotlin · 언어

- **Kotlin 주석(특히 KDoc `/** */`) 안에 `/api/v1/**` 같은 `/*` 시퀀스를 넣지 말 것.** Kotlin은 블록주석이 **중첩**돼서, 경로 글로브의 `/`+`*`가 중첩주석을 열고 KDoc의 `*/`가 그 중첩분만 닫아 **파일 전체가 미완결 주석**이 된다("Unclosed comment" + 뒤이어 import·참조 전부 unresolved 연쇄). 주석에선 글로브를 "(base 하위)"처럼 풀어쓰거나 백틱/코드블록으로. (PR #44 OpenApiContractIT)
- **Spring MVC의 `RequestMappingHandlerMapping` 은 `..mvc.method.annotation` 패키지다**(`..mvc.method` 아님). 또 컨텍스트에 매핑 빈이 여럿이라 주입 시 `@Qualifier("requestMappingHandlerMapping")`로 MVC 것을 지정(actuator 매핑과 구분). (PR #44)

## 테스트

- **같은 패키지의 서로 다른 테스트 파일에 동일 이름의 private 최상위 테스트 더블(`FakeBases` 등)을 두지 말 것 → 파일마다 고유 이름(`StubBases`).** 한 모듈의 두 테스트가 같은 패키지에서 각각 `private class FakeBases`를 선언하자 "Redeclaration" 컴파일 에러 발생. 새 포트 메서드 추가로 여러 테스트의 Fake를 갱신할 때 특히 부딪힌다. (TRIP-178 검수 수정)
- **크로스모듈 포트/인터페이스 시그니처를 바꾸면 증분 `:app:test`가 아니라 `clean build`로 검증할 것.** 다른 모듈(예: :modules:auth의 `SocialAuthPort`)에 메서드를 추가하면 그걸 익명 구현한 :app 테스트의 Fake들이 깨지는데, Kotlin **증분 컴파일이 전이적으로 영향받는 테스트 파일을 재컴파일하지 않아** 로컬 `:app:test`는 통과하고 CI의 `./gradlew build`(clean)만 `:app:compileTestKotlin FAILED`로 터진다. (PR #38 — SocialAuthPort 4개 Fake 중 3개 누락)
- **통합테스트(IT)가 있는 변경은 모듈 단위·일부 IT만 돌리고 푸시하지 말 것 → `:app:test` 전체를 돌린다.** 기동 부작용은 안 돌린 다른 IT에서만 터져 CI에서 처음 드러난다(로컬 초록·CI 빨강). (TRIP-175, PR #30)
- **백틱 테스트 함수명에 `<` `>` `.` `;` `[` `/` 등 JVM 식별자 금지문자를 넣지 말 것.** 예: `` `체크아웃 <= 체크인은 400` `` → 컴파일 에러 "Name contains illegal characters: <". 부등호는 "이하/초과" 같은 말로. (TRIP-176)
- **fresh 계산값과 DB 왕복값의 타임스탬프를 정확 비교하지 말 것.** 방금 만든 `Instant`는 나노초, Postgres `timestamptz` 왕복은 마이크로초 → 로컬 통과·CI 실패로 flaky. 멱등성은 진행 clock(tick +1s) 단위테스트로 검증, E2E는 존재/비교만. (TRIP-159 — BootstrapOnboardingApiIT)
- **PBT/제약 검증 시 조합 케이스를 빠뜨리지 말 것.** 예: filter-zero 원인 계산이 개별 필터만 보고 조합(각 필터는 개별 매칭이나 AND로 0건) 케이스를 놓쳤다 → 활성 필터 전부를 완화 후보로. (TRIP-175 검수)

## Git · 프로세스

- **스택형 브랜치를 squash 머지 후 rebase하지 말 것.** squash가 patch-id를 바꿔 add/add 충돌 발생 → `git rebase --onto origin/develop <oldBaseTip> <branch>`로 중복 커밋을 건너뛴다. (TRIP-152/153)
- **작업 착수 시 가장 먼저 `git checkout -b feature/...` 로 브랜치를 만들 것.** 안 만들고 코딩하면 커밋이 develop에 직접 쌓인다(push는 보호로 막히지만 로컬 develop이 오염 → 커밋을 브랜치로 옮기고 `git branch -f develop origin/develop` 으로 되돌려야 함). (TRIP-177)
- **develop에 직접 푸시하지 말 것 → 항상 feature 브랜치 + PR.** develop은 PR로만 받는다.
