# TripPilot 개발자 진입점.
#
# 세 패키지의 툴체인이 서로 다르다 (Gradle · pnpm · uv/Bazel). 매번 어느
# 디렉토리에서 어떤 명령을 쳐야 하는지 기억하는 대신 여기로 들어온다.
#
# 레시피는 주제별로 나눠 두었다 — 아래 import 파일들을 보라.

set shell := ["bash", "-uc"]

import 'just/backend.just'
import 'just/frontend.just'
import 'just/ai.just'
import 'just/bazel.just'
import 'just/k8s.just'

# 인자 없이 just 를 치면 레시피 목록을 보여준다.
default:
    @just --list --unsorted

# ── 전체 ────────────────────────────────────────────────────────

# 세 패키지 빌드
build: backend-build frontend-build ai-build

# 세 패키지 테스트
test: backend-test frontend-test ai-test

# 클러스터 기동 → 이미지 → 배포까지 한 번에.
#
# backend 만 빌드한다. frontend 이미지는 nginx 정적 파일이고 ai 이미지는
# stdlib 스텁이라 컴파일 단계가 없다 — 여기에 frontend-build(pnpm tsc)를
# 끼우면 pnpm 이 없는 머신에서 클러스터 기동 전체가 막힌다.
up: cluster-up backend-build images deploy

# 클러스터 삭제 (데이터 포함)
down: cluster-down

# 로컬 환경에 필요한 도구가 갖춰졌는지 점검
doctor:
    @echo "── 필수 도구 ──"
    @for c in docker kind kubectl bazel just; do \
        printf '%-10s ' "$c"; \
        command -v "$c" >/dev/null && echo "OK" || echo "없음"; \
    done
    @echo "── 선택 도구 (패키지별) ──"
    @for c in pnpm uv; do \
        printf '%-10s ' "$c"; \
        command -v "$c" >/dev/null && echo "OK" || echo "없음"; \
    done
    @printf '%-10s ' "docker 데몬"; docker info >/dev/null 2>&1 && echo "실행 중" || echo "꺼짐"
    @printf '%-10s ' "JDK 25"; test -d "{{ jdk25 }}" && echo "{{ jdk25 }}" || echo "미탐지 (TRIPPILOT_JDK25 로 지정)"
