#!/usr/bin/env bash
# POI 썸네일용 S3 + CloudFront(OAC) 를 만든다. 다시 돌려도 이미 있는 것은 건너뛴다.
#   사용:  AWS_PROFILE=myisb_IsbUsersPS-223767249602 bash deploy/img-cdn/create.sh
# Terraform 밖 CLI 수동 생성이다(웹 호스팅 app.trippilot.co.kr 과 같은 방식) — 코드화는 발표 뒤 TRIP 으로.
# 끝에 찍히는 CloudFront 주소를 poi_thumbs.py 의 --cdn 과 운영 배치에 쓴다. 커스텀 도메인은 두지 않는다(주소만 바꾸면 되는 구조).
set -euo pipefail

BUCKET=${BUCKET:-trippilot-img-prd}
REGION=${REGION:-ap-northeast-2}
COMMENT="trippilot-poi-thumbs"                  # 이 값으로 배포를 찾는다 — 바꾸면 중복 생성된다
CACHING_OPTIMIZED=658327ea-f89d-4fab-a63d-7e88639e58f6   # AWS 관리형 캐시 정책(값은 AWS 문서의 고정 ID)
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

echo "== 1. 버킷 $BUCKET ($ACCOUNT / $REGION)"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then echo "   있음 — 건너뜀"; else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "== 2. Origin Access Control"
OAC=$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='$COMMENT'].Id | [0]" --output text)
if [ "$OAC" = "None" ] || [ -z "$OAC" ]; then
  OAC=$(aws cloudfront create-origin-access-control --origin-access-control-config \
    "Name=$COMMENT,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
    --query OriginAccessControl.Id --output text)
fi
echo "   OAC $OAC"

echo "== 3. CloudFront 배포"
DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='$COMMENT'].Id | [0]" --output text)
if [ "$DIST" = "None" ] || [ -z "$DIST" ]; then
  CFG=$(mktemp)
  cat > "$CFG" <<JSON
{
  "CallerReference": "$COMMENT-$(date +%s)",
  "Comment": "$COMMENT",
  "Enabled": true,
  "PriceClass": "PriceClass_200",
  "HttpVersion": "http2and3",
  "Origins": {"Quantity": 1, "Items": [{
    "Id": "s3-$BUCKET",
    "DomainName": "$BUCKET.s3.$REGION.amazonaws.com",
    "OriginAccessControlId": "$OAC",
    "S3OriginConfig": {"OriginAccessIdentity": ""}
  }]},
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-$BUCKET",
    "ViewerProtocolPolicy": "redirect-to-https",
    "Compress": false,
    "AllowedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"], "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}},
    "CachePolicyId": "$CACHING_OPTIMIZED"
  }
}
JSON
  DIST=$(aws cloudfront create-distribution --distribution-config "file://$CFG" --query Distribution.Id --output text)
  rm -f "$CFG"
fi
DOMAIN=$(aws cloudfront get-distribution --id "$DIST" --query Distribution.DomainName --output text)
echo "   배포 $DIST  $DOMAIN"

echo "== 4. 버킷 정책 — 이 배포만 읽는다"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"AllowCloudFrontRead\", \"Effect\": \"Allow\",
    \"Principal\": {\"Service\": \"cloudfront.amazonaws.com\"},
    \"Action\": \"s3:GetObject\", \"Resource\": \"arn:aws:s3:::$BUCKET/*\",
    \"Condition\": {\"StringEquals\": {\"AWS:SourceArn\": \"arn:aws:cloudfront::$ACCOUNT:distribution/$DIST\"}}
  }]
}"

echo
echo "완료. 배포 전파에 몇 분 걸린다(Status=Deployed 까지). --cdn https://$DOMAIN"
