# Bazel — 이미지 3종과 ai 패키지를 소유한다.

# 컨테이너 이미지 빌드 + Docker·kind 적재
images:
    ./deploy/bin/images.sh

# 이미지만 만들고 적재는 하지 않는다 (CI·확인용)
images-build:
    bazel build //deploy:images

# Bazel 이 아는 모든 타깃
bazel-targets:
    bazel query //... --output=label_kind

# 의존성 해석 결과 확인 (MODULE.bazel 수정 후)
bazel-deps:
    bazel mod graph

bazel-clean:
    bazel clean

# 베이스 이미지 digest 갱신용 — 출력값을 MODULE.bazel 에 옮겨 적는다.
# 태그만 쓰면 같은 명령이 날마다 다른 이미지를 집으므로 digest 로 고정한다.
images-digest:
    @for i in eclipse-temurin:25-jre nginx:1.29-alpine python:3.11-slim; do \
        printf '%-28s ' "$i"; \
        docker buildx imagetools inspect "$i" --format '{{{{.Manifest.Digest}}}}'; \
        echo; \
    done
