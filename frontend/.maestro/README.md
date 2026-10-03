# Maestro 실기 E2E (TRIP-1168)

시뮬레이터의 dev build 를 실제로 띄우고 눌러 보는 회귀 묶음이다. jest 가 원리상 못 보는 것(라우트 번들·
시트/다이얼로그 실제 열림·재기동 뒤 저장 유지·Hermes 서식)을 본다. **로컬 전용**이다 — 소셜 로그인
세션이 시뮬레이터 키체인에만 있고 실 백엔드가 필요해서 CI 에 넣지 않는다.

## 준비

- Maestro CLI: `brew install mobile-dev-inc/tap/maestro` (**`brew install maestro` 는 다른 앱이다**)
- Java 17+: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21` (brew openjdk 는 keg-only 라 PATH 에 안 잡힌다)
- 시뮬레이터에 `com.trippilot.travel` dev build 가 깔려 있고 **로그인된 상태**
- 이 워크트리에서 Metro: `LANG=en_US.UTF-8 pnpm start --clear` (8081 을 다른 워크트리가 물고 있으면 먼저 비운다)
- 같은 시뮬레이터에 agent-device 세션을 동시에 붙이지 않는다

## 실행 — 플로우는 하나씩

```sh
MAESTRO_DEVICE=<UDID> OUT=<결과 폴더> .maestro/run-each.sh            # flows/M-*.yaml 전부, 하나씩(하위 폴더 제외)
MAESTRO_DEVICE=<UDID> .maestro/run-each.sh flows/M-02-stay-heart-persist.yaml
MAESTRO_DEVICE=<UDID> .maestro/run-each.sh flows/known-bug/M-08-route-only-styles.yaml   # 하위 폴더는 인자로만
```

**`maestro test .maestro/` 처럼 폴더째 돌리지 않는다** — iOS 26.5 에서 두 번째 플로우부터 드라이버가
죽는다(Maestro 이슈 #3318). `run-each.sh` 가 파일마다 따로 띄우고 `summary.tsv` 에 결과·소요를 남긴다.

## 지켜야 할 것

- `launchApp` 에 `clearState`·`clearKeychain` 을 쓰지 않는다 — 로그인 세션이 지워지면 사람이 다시 로그인해야 한다.
- 데이터는 기존 것만 쓰고 만든 것은 플로우 안에서 되돌린다(하트 저장 → 해제). 새 여행 생성·삭제 확정·
  계정 삭제 확정·로그아웃은 누르지 않는다.
- `flows/known-bug/` 는 **기존 제품 버그로 지금 실패하는** 플로우다(스택 이전 develop f9458992 에서도 같은 단계에서 실패 —
  TRIP-1168 베이스라인 비교). 기본 실행에서 빠져 있고, 버그를 고치면 `flows/` 로 올린다. 실패 지점은 각 파일 머리 주석에 있다.
- `flows/opt-in/` 은 지울 수 없는 데이터를 남긴다(M-11: 기존 여행에 AI 일정 생성). 기본 실행에서 빠져 있고,
  돌리면 M-01 의 "일정 없음" 기대값이 깨진다.
- 환경 id(여행·장소·숙소 키)는 각 플로우 `env:` 에 있다. 계정·데이터가 바뀌면 거기만 고친다.

## 선택자 규약

- `id:`(RN `testID`) 우선. 화면 글자(`text:`)는 사용자에게 보이는 계약(not-found 문구·금액 서식)에만 쓴다.
- Maestro 의 `text`·`id` 는 **정규식 완전 일치**다. 접근성 요소로 뭉친 행(예: 요약 행 "예산, 12만원, …")은 `.*…*` 로 감싼다.
- 카드처럼 접근성 요소 하나로 묶인 안쪽 버튼(예: d04 카드의 ♥)은 계층에 따로 안 나와 좌표로 누른다.
  다이얼로그가 떠 있으면 가려진 요소도 계층에서 빠진다 — "뒤 터치" 확인은 좌표 탭이다.
- dev build 의 LogBox 경고 배너가 탭바를 덮는다 — `_common/launch.yaml` 이 배너의 X 자리를 눌러 닫는다.
- 한글 `inputText` 는 이 환경(Maestro 2.11 · iOS 26.5)에서 실측으로 동작한다.

## 구성

| 파일 | 보는 것 |
|---|---|
| `flows/_common/` | 공통 준비(`launch`)·LogBox 닫기·레드박스/not-found 부재·라우트 1개 진입 하위 플로우 |
| `M-00` | 부팅 → 탭 5개가 제 화면을 그림 |
| `M-01` | 루트 `app/` 라우트 전수 딥링크 진입 + 보호 라우트 차단 + not-found 대조군 |
| `M-02` | 숙소 하트 저장이 재기동 뒤에도 유지(서버 왕복) → 원복 |
| `M-03` | jest 0-렌더 화면(스타일 분석·알림 설정·여행 취향)과 홈·매거진 이미지 |
| `M-04` | 다이얼로그 딤이 뒤 요소 탭을 막음(여행 삭제·계정 삭제, 취소만) |
| `M-05` | 바텀시트 실제 열림·닫힘(닫기 버튼·쓸어내림) |
| `M-06` | 위저드 → 꼭 갈 곳 → 탐색 ♥ → 위저드 복귀 → 원복 |
| `M-07` | Hermes 금액 서식(칩 콤마·요약 만원) |
| `M-09` | `_dev/preview` 키와 `app/_dev/assets` 사진 |
| `M-10` | 탭바가 탭 화면 목록 끝을 가리지 않음 |
| `known-bug/M-04d` | 다이얼로그 딤이 탭바 탭도 막음 — 실패: 탭바가 씬 바깥 층이라 딤이 못 덮는다 |
| `known-bug/M-08` | 라우트 파일 전용 스타일(not-found) + [홈으로] — 실패: [홈으로]·`/` 무반응 |
| `opt-in/M-11` | 완전 AI 초안 카드 + INV-3(기존 여행에 일정을 남긴다) |

픽셀로만 판정되는 것(M-03·M-08·M-09·M-10 의 사진·색·여백)은 `takeScreenshot` 결과를 기준 브랜치 결과와 비교한다.
