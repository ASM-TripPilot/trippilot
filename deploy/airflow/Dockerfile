# 실 수집 DAG 용 Airflow 이미지 — 공식 3.3.2 + git·gh·uv (TRIP-1725 2단계).
# 태스크가 실행마다 develop 을 복제하고(git) 공유본 PR 을 열고(gh) 수집기 의존성을 깐다(uv sync --locked).
# 빌드·푸시는 airflow-deploy.yml(build_image=true). 태그는 values.yaml 의 images.airflow.tag 와 같게.
FROM apache/airflow:3.3.2-python3.12

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl gnupg \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && apt-get purge -y gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /uvx /usr/local/bin/

USER airflow
