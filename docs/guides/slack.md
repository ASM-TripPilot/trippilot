# 슬랙 사용법

도구 **사용법** 문서입니다. Jira·GitHub 알림을 슬랙에서 받고 다루는 법.

## 채널 구성

| 채널 | 용도 |
|---|---|
| `#trippilot-dev` | 코드·PR·CI·리뷰 알림 |
| `#trippilot-pm` | 지라 이슈·기획 |
| `#trippilot-alerts` | CI 실패·배포 등 즉시 확인 필요 |

## GitHub for Slack

앱 설치 후 채널에서:

```
/github subscribe ASM-TripPilot/trippilot
/github subscribe ASM-TripPilot/trippilot reviews comments
```

- 기본 알림: PR 열림/머지·리뷰·이슈·push. 필요한 것만 켜고 끕니다.

## Jira Cloud for Slack

```
/jira create        # 슬랙에서 이슈 생성
/jira TRIP-123       # 이슈 미리보기
```

- 채널에 `TRIP-123`을 언급하면 이슈 카드가 펼쳐지고, 카드에서 **상태 변경·담당자 지정**을 인라인으로 할 수 있습니다.
- 프로젝트 `TRIP`을 `#trippilot-pm`에 구독하면 이슈 변경이 흘러옵니다.

## 알림 라우팅

| 이벤트 | 채널 |
|---|---|
| PR·리뷰·머지 | `#trippilot-dev` |
| 지라 이슈 변경 | `#trippilot-pm` |
| CI 실패·배포 | `#trippilot-alerts` |

지라 쪽 사용법은 [jira.md](jira.md).
