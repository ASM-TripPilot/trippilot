#!/usr/bin/env bash
# 맥에서 돌리는 이전 도구. 운영(EKS·RDS·S3)을 읽어 VM 으로 옮긴다.
#   AWS_PROFILE=myisb_IsbUsersPS-223767249602 VM=ubuntu@<IP> bash deploy/vm/migrate.sh dump|restore|assets
#
#   dump     운영 RDS 의 trippilot · ai_kb 를 덤프하고 테이블별 행 수를 센다 → deploy/vm/backups/migrate/
#            (클러스터 안 임시 파드 — RDS 는 VPC 밖에서 안 열린다. 마스터 비밀번호는 stdin 으로만 넘긴다.)
#   restore  그 덤프를 VM 에 올려 restore_db.sh 로 복원하고, 운영과 행 수를 대조한다
#   assets   웹(trippilot-web-prd)·썸네일(trippilot-img-prd) 버킷을 VM 의 web/ · img/ 로
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
OUT=$DIR/backups/migrate
export AWS_REGION=${AWS_REGION:-ap-northeast-2}
KEY=${KEY:-$HOME/.ssh/trippilot-prod.pem}
ssh_vm() { ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "${VM:?VM=ubuntu@<고정IP>}" "$@"; }
umask 077                       # 덤프·행 수 파일은 운영 DB 전체 사본이다
mkdir -p "$OUT"

dump() {
  local pod=trippilot-vm-dump host arn pw
  # 옛 덤프가 남아 있으면 이번 덤프가 실패해도 restore 가 그걸로 VM 을 덮는다(리허설 데이터로 전환).
  rm -f "$OUT"/*.dump "$OUT"/*.tmp "$OUT"/counts.*
  read -r host arn < <(aws rds describe-db-instances --db-instance-identifier trippilot-dev \
    --query 'DBInstances[0].[Endpoint.Address,MasterUserSecret.SecretArn]' --output text)
  pw=$(aws secretsmanager get-secret-value --secret-id "$arn" --query SecretString --output text \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])')
  # 네임스페이스가 PSA restricted 라 runtime_db.py 의 bootstrap 파드와 같은 보안 설정을 준다.
  kubectl apply -f - <<JSON
{"apiVersion": "v1", "kind": "Pod",
 "metadata": {"name": "$pod", "namespace": "trippilot", "labels": {"app.kubernetes.io/name": "$pod"},
              "annotations": {"karpenter.sh/do-not-disrupt": "true"}},
 "spec": {"restartPolicy": "Never", "automountServiceAccountToken": false, "activeDeadlineSeconds": 3600,
   "nodeSelector": {"kubernetes.io/arch": "amd64"},
   "securityContext": {"runAsNonRoot": true, "runAsUser": 10001, "runAsGroup": 10001, "seccompProfile": {"type": "RuntimeDefault"}},
   "containers": [{"name": "pg", "image": "postgres:16-alpine", "command": ["sleep", "3600"],
     "env": [{"name": "PGHOST", "value": "$host"}, {"name": "PGUSER", "value": "trippilot_admin"},
             {"name": "PGSSLMODE", "value": "require"}, {"name": "HOME", "value": "/tmp"}],
     "securityContext": {"allowPrivilegeEscalation": false, "readOnlyRootFilesystem": true, "capabilities": {"drop": ["ALL"]}},
     "resources": {"requests": {"cpu": "100m", "memory": "256Mi"}, "limits": {"cpu": "1", "memory": "512Mi"}},
     "volumeMounts": [{"name": "tmp", "mountPath": "/tmp"}]}],
   "volumes": [{"name": "tmp", "emptyDir": {}}]}}
JSON
  # shellcheck disable=SC2064  # pod 이름은 지금 펼친다(함수 지역 변수)
  trap "kubectl -n trippilot delete pod $pod --ignore-not-found --wait=false >/dev/null" EXIT
  kubectl -n trippilot wait --for=condition=Ready "pod/$pod" --timeout=180s
  kubectl -n trippilot cp "$DIR/counts.sql" "$pod:/tmp/counts.sql"
  inpod() { kubectl -n trippilot exec -i "$pod" -- sh -c "read -r PGPASSWORD; export PGPASSWORD; $1" <<<"$pw"; }
  for db in trippilot ai_kb; do
    # `a && b` 안의 실패는 set -e 를 안 건드린다 — 실패를 따로 받는다.
    inpod "exec pg_dump -Fc -d $db" > "$OUT/$db.dump.tmp" || { echo "$db 덤프 실패" >&2; exit 1; }
    mv "$OUT/$db.dump.tmp" "$OUT/$db.dump"
  done
  inpod "psql -d trippilot -At -v schema=app -f /tmp/counts.sql" > "$OUT/counts.trippilot.prd"
  inpod "psql -d ai_kb -At -v schema=public -f /tmp/counts.sql" > "$OUT/counts.ai_kb.prd"
  ls -lh "$OUT"/*.dump
  echo "운영 계정 $(awk '$1=="account"{print $2}' "$OUT/counts.trippilot.prd") · POI $(awk '$1=="poi"{print $2}' "$OUT/counts.trippilot.prd")"
}

restore() {
  ssh_vm 'mkdir -p trippilot/backups/migrate && chmod 700 trippilot/backups/migrate'
  COPYFILE_DISABLE=1 tar --no-xattrs -C "$OUT" -cf - trippilot.dump ai_kb.dump -C "$DIR" counts.sql -C "$DIR/../eks" bootstrap.sql \
    | ssh_vm 'tar -C trippilot/backups/migrate -xf -'
  ssh_vm "FORCE=${FORCE:-} bash trippilot/restore_db.sh"
  local bad=0
  for db in trippilot ai_kb; do
    ssh_vm "cat trippilot/backups/migrate/counts.$db.vm" > "$OUT/counts.$db.vm"
    if diff "$OUT/counts.$db.prd" "$OUT/counts.$db.vm" >/dev/null; then
      echo "$db: 테이블 $(wc -l < "$OUT/counts.$db.prd" | tr -d ' ')개 행 수 일치"
    else
      echo "$db: 행 수가 다르다 (운영 < > VM)"; diff "$OUT/counts.$db.prd" "$OUT/counts.$db.vm" || true; bad=1
    fi
  done
  [ "$bad" = 0 ] || { echo "행 수 불일치 — 전환이면 DNS 를 바꾸지 말고 원인을 본다" >&2; exit 1; }
}

assets() {
  aws s3 sync s3://trippilot-web-prd "$DIR/web" --delete --only-show-errors
  aws s3 sync s3://trippilot-img-prd "$DIR/img" --delete --only-show-errors
  echo "web $(find "$DIR/web" -type f | wc -l | tr -d ' ')개 · img $(find "$DIR/img" -type f | wc -l | tr -d ' ')개 → VM"
  # 새 폴더에 풀고 바꿔 끼운다 — 버킷에서 지운 파일이 VM 에 남지 않게.
  COPYFILE_DISABLE=1 tar --no-xattrs -C "$DIR" -cf - web img | ssh_vm 'cd trippilot && rm -rf .incoming && mkdir .incoming && tar -C .incoming -xf - \
    && rm -rf web img && mv .incoming/web .incoming/img . && rmdir .incoming \
    && { [ -z "$(docker compose ps -q caddy 2>/dev/null)" ] || docker compose restart caddy; }'
  # 바꿔 끼운 폴더는 새 inode 라 떠 있던 caddy 의 bind mount 가 옛 폴더를 본다 — 그래서 재시작.
}

case "${1:-}" in
  dump|restore|assets) "$1" ;;
  *) echo "사용: migrate.sh dump | restore | assets" >&2; exit 2 ;;
esac
