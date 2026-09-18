---
name: backend-verify-gates
description: "TripPilot 백엔드(Kotlin·Spring·Gradle) 검증 절차 — 빌드 명령·역검증(가드 제거)·실 DB IT·실 AI 왕복. 백엔드 코드를 고치고 '검증해', '테스트 돌려', '빌드 해봐', '커밋/PR 하자', '이거 맞나 확인해' 라고 하는 모든 시점에 반드시 사용하라. 버그를 고쳤거나 가드·검증·불변식을 추가한 직후에도 사용하라 — 그 테스트가 정말 그것을 지키는지 확인하는 절차가 여기 있다. 통과했다고 보고하기 전에도 사용하라: 이 프로젝트에서 '통과'가 거짓이었던 경로가 여럿 있다."
---

# 백엔드 검증 게이트

**이 스킬의 목적은 "초록"을 믿을 수 있게 만드는 것이다.** 이 리포에서 초록이 거짓이었던 경로가 실제로 여럿 있었다 —
빌드 캐시가 결과를 복원해 테스트가 아예 안 돌았고, 회귀 테스트가 버그를 못 잡는데 통과만 했고,
단위 테스트가 전부 통과하는데 통합 지점에서 깨졌다. 아래 절차는 각각 그 경험에서 나왔다.

## 게이트 순서

**모든 `./gradlew` 명령은 `backend/` 에서 실행한다.** 루트에서 돌리면 래퍼가 없다.

작업 규모와 무관하게 **아래 순서**로 올라간다. 위 단계가 빨간데 아래로 가지 않는다 — 아래에서 나는 실패는
원인이 섞여 진단이 몇 배로 비싸진다.

| 단계 | 명령 | 언제 |
|---|---|---|
| 1. 모듈 컴파일 | `./gradlew :modules:<m>:compileKotlin` | 타입이 맞는지 빠르게 |
| 2. 모듈 테스트 | `./gradlew :modules:<m>:test` | 도메인·애플리케이션 로직 |
| 3. 역검증 | 아래 절차 | **가드·검증·불변식을 추가했다면 필수** |
| 4. 실 DB IT | `./gradlew :app:test --tests "*<X>IT*"` | 스키마·제약·동시성을 건드렸다면 |
| 4b. 구조·계약 | `./gradlew :app:test --tests "*ArchitectureRulesTest*" --tests "*KonsistRulesTest*" --tests "*OpenApiContractIT*"` | 모듈 경계(R1)·엔드포인트를 건드렸다면. 전체 빌드에 포함되지만 빨리 보고 싶을 때 |
| 5. 전체 빌드 | `./gradlew build --no-build-cache --rerun-tasks` | **커밋·PR 전 항상** |
| 6. 실 AI 왕복 | 아래 절차 | AI 경계(`ScheduleAgentPort`·어댑터·와이어 DTO)를 건드렸다면 |

## 전체 빌드는 반드시 캐시를 끈다

```bash
./gradlew build --no-build-cache --rerun-tasks
```

`./gradlew build` 만 쓰지 마라. **Gradle 이 빌드 캐시에서 결과를 복원해 테스트를 한 줄도 실행하지 않고
"BUILD SUCCESSFUL"을 낸다.** 실측으로 clean 직후 build 가 1초 만에 끝난 적이 있다 — 그때 보고한 "전체 통과"는
아무것도 검증하지 않은 값이었다.

통과를 보고할 때는 **테스트 수를 함께 센다**. 수가 갑자기 줄었으면 무언가가 실행되지 않은 것이다.

`backend/` 에서 실행한다. 아래는 깊이를 고정하지 않고 훑으므로 루트에서 돌려도 같은 값이 나온다 —
글롭 깊이를 박으면 모듈 결과를 빠뜨린 채 **작은 숫자를 태연히 내놓는다**(실측으로 걸렸다):

```bash
python3 - <<'EOF'
import re
from pathlib import Path
tot = fail = files = 0
for f in Path(".").rglob("build/test-results/test/*.xml"):
    m = re.search(r'tests="(\d+)".*?failures="(\d+)".*?errors="(\d+)"', f.read_text()[:2000])
    if m:
        files += 1; tot += int(m.group(1)); fail += int(m.group(2)) + int(m.group(3))
print(f"suites={files} tests={tot} failures={fail}")
EOF
```

**결과 파일은 지우기 전까지 남는다** — 방금 돌린 빌드의 값인지 확인하려면 `--rerun-tasks` 로 돌린 직후에 센다.

## 역검증 — 그 테스트가 정말 그것을 지키는가

버그를 고치거나 가드를 넣었으면, **그 가드를 도로 빼서 테스트가 실제로 깨지는지 확인한다.**
회귀 테스트가 버그를 잡지 못하는데 통과만 하는 경우를 이 절차만이 걸러낸다.

**프로토콜**

1. 가드를 **하나만** 무력화한다(조건을 `false` 로, 호출 한 줄 삭제 등)
2. 관련 테스트를 돌린다
3. **그 가드를 위해 쓴 테스트만** 실패해야 한다
4. 원복하고 다음 가드로 넘어간다

한꺼번에 여러 개를 빼지 마라 — 무엇이 무엇을 지키는지 못 본다.

```bash
cp $F /tmp/f.bak
python3 -c "s=open('$F').read(); s=s.replace('if (조건) {','if (false) {'); open('$F','w').write(s)"
./gradlew :modules:<m>:test --console=plain 2>&1 | grep -E "> .*FAILED$"
cp /tmp/f.bak $F
```

**변이가 컴파일을 깨면 그 역검증은 무효다.** 다른 코드가 그 필드를 참조해 컴파일이 실패하면 "테스트가 깼다"가
아니라 "실험을 못 했다"이다. 그럴 때는 컴파일되는 변이를 찾아라 — 이름을 바꾸는 대신 **조건을 뒤집거나
호출을 지운다**.

**바깥 세계가 바뀌는 결함은 우리 코드가 아니라 계약·입력 쪽을 흔들어 재현한다.** AI 계약 드리프트는
`ai/docs/openapi.json` 을 임시로 고쳐 확인하고, 반드시 md5 로 원복을 확인한다.

## 실 DB IT가 필요한 판정

인메모리 Fake 로는 **원리적으로** 안 보이는 것들이 있다. 아래를 건드렸다면 Testcontainers IT 를 반드시 추가한다.

- **부분 유니크 인덱스** — 도메인 `isOpen`/`isRunning` · 영속 상수 · DB 인덱스가 **같은 집합**인가.
  하나만 어긋나면 앱이 "없다"고 보고 INSERT 해 사용자에게 500 이 나간다
- **쓰기 순서** — 한 트랜잭션에서 "기존 행 닫고 새 행 열기"는 JPA 가 UPDATE 를 커밋까지 미뤄 INSERT 가 먼저 나간다.
  `saveAndFlush` 가 필요한 자리인지는 실 DB 에서만 드러난다
- **복합 PK 덮어쓰기** — Fake 는 Map 이라 언제나 덮어쓴다. 하루 1행 보장은 DB 가 한다
- **CHECK 어휘** — enum 은 대문자, DB CHECK 는 소문자인 경우가 있다. 변환이 어긋나면 저장 자체가 실패한다
- **동시성** — 단일 스레드 테스트는 경합을 재현하지 못한다. 읽고-검사-쓰기 사이에 다른 트랜잭션이 끼어드는
  경로는 실 DB E2E 가 있어야 잡힌다

## 실 AI 왕복 — 계약 게이트는 수용 보증이 아니다

`AiBoundaryOpenApiTest` 는 **필드 이름**을 지킨다. `minItems` 같은 **제약**이나 업무 규칙 위반은 못 본다.
실제로 이름이 전부 맞는 상태에서 실호출이 422·409 를 연달아 낸 적이 있다.

AI 경계를 건드렸으면 실물에 한 번 태운다:

```bash
docker compose --profile full up -d ai      # healthy 확인
LIVE_AI=1 ./gradlew :app:test --tests "*LiveAiRoundTripIT*"
docker compose stop ai                       # 볼륨·데이터는 지우지 않는다
```

평소에는 꺼져 있다 — CI 게이트 정책이 "외부 API 호출 0회"라 상시 켜면 그 정책이 깨진다.

## 시각·타임존에 의존하는 결함

**하루 중 언제 도느냐에 따라 갈리는 실패가 이 리포에서 두 번 나왔다.** 로컬은 통과하고 CI 만 빨간 형태로
나타나므로 "flaky 네" 하고 재실행하면 영영 못 찾는다.

- 산출물이 시각에서 파생되면(예: "지금부터 N시간씩") **그 날 안에 들어가는지** 검사한다.
  자정을 넘기면 `endAt < startAt` 이 되어 도메인 검증에 걸리고 사용자에게 500 이 된다
- 서버가 **여행지 기준(KST)** 으로 묶는 데이터를 조회할 때 테스트가 `LocalDate.now()`(러너 기본 = UTC)를 쓰면
  하루가 어긋난다. 서버가 쓰는 존을 그대로 써서 묻는다
- 재현 테스트는 **문제가 되는 시각을 고정**하고, "항상 0건"으로 통과하지 않도록 정상 시각 대조군을 함께 둔다
- CI 환경을 흉내 내 확인할 수 있다: `TZ=UTC ./gradlew :app:test --tests "*X*"`

## 조용히 틀리는 경로 — 초록인데 잘못된 결과

**예외도 로그도 없이 잘못된 값을 내는 경로가 있다.** 테스트는 초록이고 CI 도 초록이라 게이트로는 안 잡힌다.
구현 직후 아래 두 형태를 눈으로 훑어라.

**대체 폴백** — 원하는 것을 못 찾았을 때 "아무거나" 집는 코드.

```kotlin
val day = output.days.firstOrNull { it.date == targetDate } ?: output.days.firstOrNull()  // ✗
```

상대가 다른 날짜를 돌려주면 그것을 오늘 것으로 삼아, 확정 순간 오늘 일정이 엉뚱한 날의 계획으로 덮인다.
**못 찾으면 없는 것이다** — 대체하지 말고 null·실패로 올린다.

**아무 일도 안 하고 성공을 보고하는 경로** — 매칭이 없으면 그냥 통과하는 코드.

```kotlin
val replaced = days.map { if (it.date != target) it else 교체(it) }   // 매칭 0건이면 무변경
저장(replaced); 리비전기록("반영됨")                                   // ✗ 사용자는 반영됐다고 믿는다
```

바꿀 대상이 없으면 **그것이 오류다**. 통과시키면 이력만 쌓이고 실제 상태는 그대로다.

점검법: `?:` 뒤에 오는 기본값, `firstOrNull()`, `map{}` 안의 조건부 교체, `takeIf` 뒤의 무시.
각각에 대해 **"여기서 안 맞으면 사용자에게 무엇으로 보이나"** 를 한 번 묻는다.

## CI 가 빨간데 로컬이 초록일 때

**먼저 원인이 우리 코드인지 인프라인지 가른다.** 이 리포에서 실제로 있었던 인프라 실패들이다 —
GitHub Actions 지출 한도(잡이 시작조차 안 됨), Maven Central 403, TourAPI 타임아웃.

```bash
gh run view <id> --log-failed | grep -E "FAILED|error:|Caused"
gh api repos/ASM-TripPilot/trippilot/check-runs/<jobId>/annotations --jq '.[0].message'
```

annotation 에 결제·러너 메시지가 있으면 코드 문제가 아니다. 코드 문제라면 **환경 차이**(TZ·시각·병렬성)를
먼저 의심하고, 로컬에서 그 조건을 재현해 고친다.

## 커밋·PR 전 확인

- `./gradlew build --no-build-cache --rerun-tasks` 통과 + 테스트 수 확인
- 새 가드·검증마다 역검증 완료
- 실패한 것을 실패했다고 적었는가 — 건너뛴 검증이 있으면 PR 본문에 명시한다
- 새로 겪은 실패는 `docs/conventions/anti-patterns.md` 에 한 줄 추가했는가(가설 아니라 **재현·검증된 것만**)

## 이 리포에 **없는** 것 — 있다고 가정하지 마라

- **detekt · ktlint · spotless 가 없다**(실측 0건). 코드에 `@Suppress("LongParameterList")` 같은 detekt 규칙명이
  9곳 있는데 **아무것도 억제하지 않는다** — 있다고 착각한 흔적이다. 새로 쓰지 마라.
- 스타일 검사는 컴파일러 경고와 리뷰가 전부다. 구조 규칙만 ArchUnit·Konsist 로 강제된다.
- 도입 여부는 별개 안건이다. 이 스킬은 **지금 있는 것**만 다룬다.

## 관련 문서

- `docs/conventions/anti-patterns.md` — 누적된 실패 규칙. **착수 전 관련 절을 읽고**, 새 실패는 한 줄 추가
- `docs/conventions/workflow-8steps.md` — 8단계와 규모별 보정
- `backend/CLAUDE.md` — 코딩 규율(검증가능 목표로 변환)
