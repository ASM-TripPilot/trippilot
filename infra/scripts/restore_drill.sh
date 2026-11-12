#!/bin/bash
# 운영 DB 복구 훈련 — 최신 복원 시점(PITR)으로 임시 인스턴스를 띄워 RTO 를 재고, 끝나면 지운다.
# 운영 인스턴스는 건드리지 않는다. 임시 인스턴스는 운영과 같은 서브넷·보안 그룹·파라미터 그룹, 공개 접근 없음.
# 비용: db.t4g.micro 몇십 분(수백 원). 운영 데이터 사본이라 끝나면 최종 스냅숏 없이 바로 지운다.
#
#   AWS_PROFILE=myisb_IsbUsersPS-223767249602 bash infra/scripts/restore_drill.sh
set -euo pipefail
export AWS_REGION=ap-northeast-2
SRC=trippilot-dev
DRILL=trippilot-restore-drill-$(date +%m%d%H%M)

read -r SG SUBNET PG LATEST < <(aws rds describe-db-instances --db-instance-identifier "$SRC" \
  --query 'DBInstances[0].[VpcSecurityGroups[0].VpcSecurityGroupId,DBSubnetGroup.DBSubnetGroupName,DBParameterGroups[0].DBParameterGroupName,LatestRestorableTime]' --output text)
echo "원본 $SRC · 최신 복원 가능 시점 $LATEST"

T0=$(date +%s)
aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier "$SRC" \
  --target-db-instance-identifier "$DRILL" --use-latest-restorable-time \
  --db-instance-class db.t4g.micro --db-subnet-group-name "$SUBNET" --vpc-security-group-ids "$SG" \
  --db-parameter-group-name "$PG" --no-publicly-accessible --no-multi-az --no-deletion-protection \
  --tags Key=purpose,Value=restore-drill >/dev/null
echo "복원 시작 $(date '+%F %T') → $DRILL"

trap 'echo "지우는 중: $DRILL"; aws rds delete-db-instance --db-instance-identifier "$DRILL" --skip-final-snapshot --delete-automated-backups >/dev/null && echo "삭제 요청 완료"' EXIT
aws rds wait db-instance-available --db-instance-identifier "$DRILL"
T1=$(date +%s)

RESTORED=$(aws rds describe-db-instances --db-instance-identifier "$DRILL" --query 'DBInstances[0].[DBInstanceStatus,Endpoint.Address]' --output text)
echo "사용 가능: $RESTORED"
echo "==> 복원 소요(RTO 중 DB 부분): $(( (T1 - T0) / 60 ))분 $(( (T1 - T0) % 60 ))초"
echo "==> 데이터 손실 범위(RPO): 최신 복원 가능 시점 기준 — 자동 백업의 트랜잭션 로그는 약 5분 간격으로 올라간다"
