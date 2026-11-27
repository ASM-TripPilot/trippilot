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
| `export_env.py` | 운영 Deployment 의 secretKeyRef 그대로 시크릿을 `secrets/*.env` 로 | 맥 (운영 클러스터 읽기) |
| `setup.sh` | Docker · 스왑 2G · 매일 DB 덤프 cron | VM 최초 1회 |
| `ship.sh [images [embedding]]` | 설정·시크릿(+운영 ECR 이미지) → VM, 기동 | 맥 |
| `migrate.sh dump\|restore\|assets` | 운영 DB 덤프 → VM 복원·행 수 대조 / 웹·썸네일 버킷 → VM | 맥 |
| `restore_db.sh` | VM 쪽 복원(덮어쓰기 가드 · bootstrap.sql · 썸네일 주소 교체) | VM (migrate.sh 가 부름) |
| `backup.sh` | 두 DB 논리 덤프 7일치 | VM cron |

운영과 다른 점은 셋이다: 재시작 유예가 630s → 90s(롤링 배포가 없다), 리마인드 문구는 `off`(Bedrock 이 대여 계정에 있다 —
알림은 상수 문구로 나간다), 4GB 장비면 embedding 이 빠진다(KB 검색은 규칙 랭킹 강등, 도우미 장기 기억·장소 확인 캐시 꺼짐).

## 리허설 (전환 전날)

```bash
export AWS_PROFILE=myisb_IsbUsersPS-223767249602 AWS_REGION=ap-northeast-2 VM=ubuntu@<고정IP>
ssh -i ~/.ssh/trippilot-prod.pem $VM 'bash -s' < deploy/vm/setup.sh
python3 deploy/vm/export_env.py                 # 키 이름·개수만 찍힌다
bash deploy/vm/ship.sh images embedding         # 4GB 장비면 embedding 빼고, VM .env 의 COMPOSE_FILE 줄도 지운다
bash deploy/vm/migrate.sh dump                  # 운영 RDS 읽기
bash deploy/vm/migrate.sh restore               # "행 수 일치" 두 줄이 나와야 한다
bash deploy/vm/migrate.sh assets
```

Cloudflare 에 `vm-api` · `vm-app` · `img` A 레코드(VM IP, DNS only)를 만들면 caddy 가 인증서를 받는다.
`https://vm-api.trippilot.co.kr/api/v1/terms` 200, 앱 기능은 개발 빌드의 API 주소를 `vm-api` 로 바꿔 실기기로 본다.

## 전환 (서비스 중단 30분~1시간)

1. 점검 공지 → 운영 쓰기 멈춤: `kubectl -n trippilot scale deployment backend ai --replicas=0`
2. `migrate.sh dump` → `FORCE=1 migrate.sh restore`(리허설 데이터를 덮는다) → 행 수 일치 확인 → `migrate.sh assets`
3. VM `.env`: `API_HOSTS=api-dev.trippilot.co.kr, api.trippilot.co.kr` · `WEB_HOST=app.trippilot.co.kr`
4. Cloudflare: `api-dev` · `api` · `app` 를 VM IP 의 A 레코드로(DNS only) → `ssh $VM 'cd trippilot && docker compose up -d caddy'`
5. `curl https://api-dev.trippilot.co.kr/api/v1/terms` 200 · 실기기 로그인·일정 생성·푸시

**되돌리기**(5에서 막히면): Cloudflare 세 레코드를 원래 CNAME(NLB · CloudFront)으로, `kubectl … --replicas=2`.
VM 에 그 사이 들어온 쓰기는 버려진다 — 그래서 되돌리기는 전환 직후에만 판단한다.

## 전환 뒤 남는 것

- **Lightsail 자동 스냅숏**을 콘솔에서 켠다 — `backup.sh` 덤프는 같은 디스크라 디스크째 잃으면 같이 잃는다.
- 새 코드 배포: 지금 `ship.sh images` 는 운영 ECR 에서 가져온다(대여 계정이 살아 있는 동안만). 그 뒤에는 GHCR(`develop`·`sha-*`)
  이미지를 받도록 바꿔야 한다 — 조직이 공개 패키지를 막아 VM 에 `read:packages` 토큰 로그인이 필요하다.
- 웹 배포(`frontend-web-deploy.yml`)는 S3 로 올린다 — 계정이 사라지면 실패한다. VM `web/` 으로 바꿔야 한다.
- 수집 배치(POI·행사)는 운영 DB 적재를 EKS 배포 단계(`deploy/eks/runtime_pois.py`)가 했다 — VM 에는 그 단계가 없다.
