#!/usr/bin/env bash
# VM 최초 1회(다시 돌려도 된다): Docker · 스왑 2G · 매일 DB 덤프 cron.
#   ssh -i ~/.ssh/trippilot-prod.pem ubuntu@<IP> 'bash -s' < deploy/vm/setup.sh
set -euo pipefail
if ! command -v docker >/dev/null; then
  # Docker 공식 설치 스크립트 — 배포판 docker.io 는 compose 가 낡아 env_file 이스케이프가 다르게 읽힐 수 있다.
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"
# 4GB 장비에 JVM·uvicorn·postgres — 순간 정점에 OOM 킬러가 먼저 오지 않게.
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
mkdir -p ~/trippilot/backups
# 매일 03:30 KST(18:30 UTC). 디스크째 잃는 경우는 Lightsail 자동 스냅숏(terraform/, 19:00 UTC)이 맡는다.
( crontab -l 2>/dev/null | grep -v trippilot/backup.sh; echo "30 18 * * * bash \$HOME/trippilot/backup.sh >> \$HOME/trippilot/backups/backup.log 2>&1" ) | crontab -
docker --version && docker compose version
