# ai — Bazel(rules_python)이 소유한다.
#
# 세 패키지 중 유일하게 Bazel 네이티브다. 의존성 그래프가 pyproject 하나로
# 끝나고, 재구축할 기존 게이트가 없어서 옮기는 비용이 거의 없었다.

# Bazel 로 테스트 (정본)
ai-test:
    bazel test //ai:pytest

# uv 로 테스트 — Bazel 없이 빠르게 돌려보고 싶을 때. 같은 소스, 다른 러너다.
ai-test-uv:
    cd ai && uv run pytest

# 소스가 임포트 가능한 상태인지만 확인한다 (파이썬은 링크 단계가 없다).
ai-build:
    bazel build //ai:trippilot

# uv.lock 이 바뀌면 Bazel 이 읽는 requirements.txt 를 다시 내보낸다.
# requirements.txt 는 파생물이므로 직접 손대지 말 것.
ai-lock:
    cd ai && uv export --format requirements-txt --no-emit-project --all-groups -o requirements.txt
