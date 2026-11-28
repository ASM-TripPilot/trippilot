# 운영 VM 한 대 (AWS 대여 계정 종료 대비)

대여 계정(12/14 만료, 예산은 11/29 소진)의 EKS·RDS·S3 를 **VM 한 대의 docker compose** 로 옮긴다.
앱이 박아 둔 주소(`api-dev.trippilot.co.kr`)는 그대로 두고 DNS 만 VM 으로 돌린다 — 앱 재출시 없음.

```
caddy(:443, Let's Encrypt) ─┬─ API_HOSTS → gateway(nginx, 운영 설정 사본) → backend ─┬─ db (pgvector pg16: trippilot · ai_kb)
                            ├─ WEB_HOST  → web/  (Expo SPA, S3 trippilot-web-prd 사본)  └─ ai ── (embedding, 8GB 장비만)
                            └─ IMG_HOST  → img/  (POI 썸네일, S3 trippilot-img-prd 사본)
```

| 파일 | 하는 일 | 어디서 |
|---|---|---|
| `terraform/` | 개인 AWS 계정의 Lightsail VM · 고정 IP · 방화벽 · 자동 스냅숏 · 월 예산 알림 | 맥 (`trippilot-vm` 프로필) |
| `export_env.py` | 운영 Deployment 의 secretKeyRef 그대로 시크릿을 `secrets/*.env` 로 | 맥 (운영 클러스터 읽기) |
| `setup.sh` | Docker · 스왑 2G · 매일 DB 덤프 cron | VM 최초 1회 |
| `ship.sh [images [embedding]]` | 설정·시크릿(+운영 ECR 이미지) → VM, 기동 | 맥 |
| `migrate.sh dump\|restore\|assets` | 운영 DB 덤프 → VM 복원·행 수 대조 / 웹·썸네일 버킷 → VM | 맥 |
| `restore_db.sh` | VM 쪽 복원(덮어쓰기 가드 · bootstrap.sql · 썸네일 주소 교체) | VM (migrate.sh 가 부름) |
| `backup.sh` | 두 DB 논리 덤프 7일치 | VM cron |
| `docker-compose.embedding.yml` | embedding + 벡터 DB 연결 (8GB 장비) | `.env` 의 `COMPOSE_FILE` |
| `docker-compose.rehearsal.yml` | 리허설 동안 푸시·상황 감시 끄기 | `.env` 의 `COMPOSE_FILE`, 전환 때 뺀다 |

## 운영과 다른 점

- **종료 유예** 630s → 90s — 롤링 배포가 없어 재시작이 곧 중단이다.
- **리마인드 문구** `off` — Bedrock 이 대여 계정에 있다. 알림은 상수 문구로 나간다. `export_env.py` 가 다른 기능에도
  `local*`(Bedrock) 모델이 배정돼 있으면 경고한다.
- **4GB 장비**는 embedding 이 빠진다 — KB 검색은 규칙 랭킹으로 강등, 도우미 기억·장소 확인 캐시는 프로세스 안에만 있어
  재시작하면 사라진다(`AI_WORKERS=1` 로 워커 간 갈림을 막는다). 8GB 면 운영과 같다.
- **감시가 없다** — CloudWatch 알람·Slack·Container Insights·`ai-llm-fallback-watch`·로그 90일이 전부 사라진다.
  로그는 컨테이너당 20MB×5. 아래 "전환 뒤"의 외부 업타임 체크가 최소한이다.
- **CPU 는 2 vCPU 버스트형**이다 — 일정 조립(CP-SAT)·JVM·embedding 이 겹치면 CPU 크레딧이 바닥나 느려질 수 있다.
  Lightsail 콘솔의 CPU 사용률·버스트 용량 경보를 켜 둔다.
- **컨테이너 보안 설정**(non-root 강제·읽기 전용 루트·cap drop)은 운영 파드에만 있었다. 열린 포트는 22·80·443(TCP)·443(UDP), IPv4 만이고 DB 는 밖에 안 열린다.

## 리허설 (전환 전날)

```bash
export AWS_PROFILE=myisb_IsbUsersPS-223767249602 AWS_REGION=ap-northeast-2 VM=ubuntu@<고정IP>
```

1. VM 만들기 — 개인 계정 IAM 키로 `aws configure --profile trippilot-vm`(위 export 와 상관없이 terraform 은 이 프로필을 쓴다).
   키가 없으면 `ssh-keygen -t rsa -b 4096 -m PEM -N "" -f ~/.ssh/trippilot-prod.pem` 먼저.
   `cd deploy/vm/terraform && terraform init && terraform apply -var budget_email=<메일>` → 출력된 `static_ip` 가 `<고정IP>`.
   방화벽(22·80·443/TCP·443/UDP)도 여기서 열린다.
2. `ssh -i ~/.ssh/trippilot-prod.pem $VM 'bash -s' < deploy/vm/setup.sh`
3. `python3 deploy/vm/export_env.py` — 키 이름·개수만 찍힌다. 경고가 나오면 읽는다.
4. `bash deploy/vm/ship.sh images` (8GB 면 `images embedding`). 처음이면 `ACME_EMAIL` 이 비어 멈춘다 →
   VM `~/trippilot/.env` 편집: `ACME_EMAIL`, 8GB 면 `COMPOSE_FILE` 에 embedding 파일을 넣고 `AI_WORKERS=2` → `ship.sh` 다시.
5. `bash deploy/vm/migrate.sh dump` → `bash deploy/vm/migrate.sh restore` — "행 수 일치" 두 줄. 다르면 멈춘다(exit 1).
6. `bash deploy/vm/migrate.sh assets`
7. Cloudflare 에 `vm-api` · `vm-app` · `img` **A 레코드**(VM IPv4, DNS only)를 만든다. AAAA 는 만들지 않는다 — IPv6 로 오면
   docker-proxy 를 거쳐 모두 한 IP 로 보여 속도 제한(10r/s)을 같이 쓴다.
8. `https://vm-api.trippilot.co.kr/api/v1/terms` 200, 앱 기능은 개발 빌드의 API 주소를 `vm-api` 로 바꿔 실기기로 본다.
9. **끝나면 바로** `ssh $VM 'cd trippilot && docker compose stop backend ai'` — 리허설 파일이 푸시·상황 감시는 막지만
   여행 요약 같은 LLM 배치는 끄는 스위치가 없다. 운영 사본으로 운영과 동시에 돌면 비용이 두 번 든다.

## 전환 (서비스 중단 30분~1시간)

1. 점검 공지 → 운영 쓰기 멈춤. 파드는 종료 유예(630s) 동안 계속 쓰므로 **없어질 때까지 기다린다**:
   ```bash
   kubectl -n trippilot scale deployment backend ai --replicas=0
   kubectl -n trippilot wait --for=delete pod -l app.kubernetes.io/component=backend --timeout=700s || true
   kubectl -n trippilot wait --for=delete pod -l app.kubernetes.io/component=ai --timeout=700s || true
   kubectl -n trippilot get pods -l 'app.kubernetes.io/component in (backend,ai)'   # "No resources found" 여야 한다
   ```
2. 리허설 뒤 운영 이미지가 바뀌었을 수 있다 → `bash deploy/vm/ship.sh images [embedding]`
3. `bash deploy/vm/migrate.sh dump` → `FORCE=1 bash deploy/vm/migrate.sh restore`(리허설 데이터를 덮는다) → 행 수 일치 → `migrate.sh assets`
4. VM `.env`: `COMPOSE_FILE` 에서 `docker-compose.rehearsal.yml` 을 빼고, `API_HOSTS=api-dev.trippilot.co.kr, api.trippilot.co.kr` ·
   `WEB_HOST=app.trippilot.co.kr` → `bash deploy/vm/ship.sh`(설정 반영 + gateway·caddy 재시작)
5. Cloudflare: `api-dev` · `api` · `app` 를 VM IPv4 의 A 레코드로(DNS only). caddy 가 인증서를 받는다 — 안 받으면
   `ssh $VM 'cd trippilot && docker compose restart caddy'`
6. `curl https://api-dev.trippilot.co.kr/api/v1/terms` 200 · 실기기 로그인·일정 생성·푸시

**되돌리기**(6에서 막히면) — 순서가 중요하다. VM 을 먼저 멈춰야 푸시가 두 번 안 간다:
1. `ssh $VM 'cd trippilot && docker compose stop backend ai'`
2. `kubectl -n trippilot scale deployment backend ai --replicas=2` → Ready 를 기다린다
3. Cloudflare 세 레코드를 원래 CNAME(`api-dev`·`api` → 운영 NLB, `app` → `d19rbqomsljzat.cloudfront.net`)으로

VM 에 그 사이 들어온 쓰기는 버려진다 — 그래서 되돌리기는 전환 직후에만 판단한다.
전환 뒤 누가 `aws-deploy`(target=prod)를 돌리면 EKS backend 가 다시 떠서 VM 과 함께 푸시를 보낸다 — 전환 뒤에는 돌리지 않는다.

## 전환 뒤

- `ship.sh` 는 매번 gateway·caddy 를 재시작한다(설정 파일 반영) — 진행 중인 요청(일정 생성 최대 60s)이 끊긴다. 운영 중에는 한가한 시간에.
- **외부 업타임 체크**(UptimeRobot 등 무료)로 `https://api-dev.trippilot.co.kr/healthz` 를 본다 — VM 이 죽어도 알릴 것이 이것뿐이다.
- **Lightsail 자동 스냅숏**은 terraform 이 켠다(매일 19:00 UTC, 7일치) — `backup.sh` 덤프는 같은 디스크라 디스크째 잃으면 같이 잃는다.
  콘솔에서 시각을 바꾸면 다음 apply 가 되돌린다.
- **8GB 로 올리기** — `bundle_id` 만 바꿔 apply 하면 교체(디스크·스냅숏 삭제)라 `prevent_destroy` 가 막는다. 대신:
  콘솔에서 수동 스냅숏 → 그 스냅숏으로 `large_3_0` 새 인스턴스(같은 AZ, 키 페어 `trippilot-vm`, IPv4 전용) →
  고정 IP 를 새 인스턴스로 옮김 →
  `terraform state rm aws_lightsail_instance.vm aws_lightsail_static_ip_attachment.vm aws_lightsail_instance_public_ports.vm` →
  main.tf 의 `name`·`bundle_id` 를 새 것으로 → `terraform import aws_lightsail_instance.vm <새 이름>` →
  `terraform plan` 에 **교체(-/+)가 없는지** 본 뒤 apply(고정 IP 연결·방화벽·자동 스냅숏을 다시 맞춘다) → 옛 인스턴스는 콘솔에서 지운다.
- **덤프 사본 지우기** — `deploy/vm/backups/migrate/`(맥)와 VM `~/trippilot/backups/migrate/` 는 운영 DB 전체 사본이다.
  AWS 정리(RDS 스냅숏·자동 백업 삭제)와 같은 날 지운다.
- 새 코드 배포: 지금 `ship.sh images` 는 운영 ECR 에서 가져온다(대여 계정이 살아 있는 동안만). 그 뒤에는 GHCR(`develop`·`sha-*`)
  이미지를 받도록 바꿔야 한다 — 조직이 공개 패키지를 막아 VM 에 `read:packages` 토큰 로그인이 필요하다.
- 웹 배포(`frontend-web-deploy.yml`)는 S3 로 올린다 — 계정이 사라지면 실패한다. VM `web/` 으로 바꿔야 한다.
- 수집 배치(POI·행사)는 운영 DB 적재를 EKS 배포 단계(`deploy/eks/runtime_pois.py`)가 했다 — VM 에는 그 단계가 없다.
