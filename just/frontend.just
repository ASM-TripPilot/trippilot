# frontend — pnpm 이 소유한다 (Expo prebuild · Metro · Jest).
#
# 클러스터에 올라가는 것은 nginx 정적 이미지다. React Native 앱 자체는
# 시뮬레이터/실기에서 도는 것이라 컨테이너로 만들 대상이 아니다.

# 검증 게이트 (frontend/.claude 의 verify-gates 와 같은 순서)
frontend-build:
    cd frontend && pnpm tsc

frontend-test:
    cd frontend && pnpm test

frontend-lint:
    cd frontend && pnpm lint

frontend-install:
    cd frontend && pnpm install --frozen-lockfile

# Expo Web 산출물로 컨테이너 정적 파일을 교체한다.
# 지금 frontend/web 은 통합 테스트용 스텁(index.html)이며, 이 레시피를 돌리면
# 실제 웹 번들로 바뀐다. 산출물이 커서 커밋 전에 내용을 확인할 것.
frontend-web-export:
    cd frontend && pnpm expo export --platform web --output-dir web

# 시뮬레이터/실기 (컨테이너와 무관 — 호스트에서 돈다)
frontend-start:
    cd frontend && pnpm start
