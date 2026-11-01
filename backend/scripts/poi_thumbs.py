#!/usr/bin/env python3
"""POI 사진 썸네일 배치 — 원본(TourAPI 940px·100~215KB)을 940px 상한 WebP 로 바꿔 S3 에 올리고, DB 에 반영할 SQL 을 쓴다.

DB 에는 직접 붙지 않는다(운영 DB 는 비공개) — 파일 입력 → S3 업로드 → SQL 파일 출력. DB 쪽은 기존 psql 일회성 Job 으로:
  1) 내보내기:  SELECT image_url FROM poi WHERE image_url IS NOT NULL AND image_thumb_url IS NULL GROUP BY 1;  (한 줄에 URL 하나)
  2) 이 스크립트:  python3 poi_thumbs.py urls.txt --bucket trippilot-img-prd --cdn https://dxxxx.cloudfront.net --sql thumbs.sql
  3) 적용:     thumbs.sql 을 psql Job 으로 실행
키는 폭 + 원본 URL 해시라 다시 돌려도 같은 파일이다 — 이미 올라간 키는 건너뛴다(멱등). 폭을 바꾸면 키가 바뀌어 전부 새로 만든다. 실패한 URL 은 SQL 에 넣지 않는다
(= image_thumb_url 이 NULL 로 남아 서버가 원본을 그대로 준다). 원본이 바뀐 장소는 Poi.refreshed 가 썸네일을 비워 다음 배치가 다시 만든다.
의존: Pillow (S3 는 boto3, --out-dir 로 로컬에 쓰면 불필요).
"""

import argparse
import concurrent.futures as cf
import hashlib
import io
import pathlib
import sys
import urllib.request

# 카드·상세 모두 이 한 장. TRIP-1702: 560 은 카드(≈510px@3x)엔 맞았지만 상세 히어로(1206px@3x)를 2배 넘게 늘려 흐렸다.
# TourAPI 원본이 940px 라 그 이상은 만들 수 없다 — 사실상 "줄이지 않고 WebP 로만" 이다(히어로는 1.28배로 줄어든다).
WIDTH = 940
QUALITY = 72
MAX_BYTES = 8 * 1024 * 1024   # 원본이 이보다 크면 받지 않는다
PREFIX = "poi/"


def thumb_key(url: str) -> str:
    # 폭을 키에 넣는다 — 빼면 폭을 바꿔 다시 돌려도 exists() 가 옛 파일을 보고 건너뛰고, CDN 도 immutable 캐시라 옛 그림을 준다.
    return f"{PREFIX}w{WIDTH}/{hashlib.sha1(url.encode()).hexdigest()[:20]}.webp"


def sql_literal(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def update_sql(url: str, cdn: str) -> str:
    thumb = f"{cdn.rstrip('/')}/{thumb_key(url)}"
    # 원본이 같은 행만 — 그 사이 수집이 사진을 바꿨다면 건드리지 않는다.
    return (f"UPDATE poi SET image_thumb_url = {sql_literal(thumb)} "
            f"WHERE image_url = {sql_literal(url)} AND image_thumb_url IS DISTINCT FROM {sql_literal(thumb)};")


def resize(data: bytes) -> bytes:
    from PIL import Image, ImageOps  # 지연 import — 키·SQL 검사는 Pillow 없이도 돈다
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    if img.width > WIDTH:                                  # 키우지 않는다
        img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "WEBP", quality=QUALITY, method=4)
    return out.getvalue()


def download(url: str) -> bytes:
    if not url.startswith("https://"):
        raise ValueError("https 만 받는다")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "trippilot-thumbs/1"}), timeout=20) as r:
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("원본이 너무 크다")
    return data


def make_store(args):
    if args.out_dir:
        root = pathlib.Path(args.out_dir)

        def exists(key): return (root / key).exists()

        def put(key, body):
            (root / key).parent.mkdir(parents=True, exist_ok=True)
            (root / key).write_bytes(body)
        return exists, put
    import boto3
    from botocore.exceptions import ClientError
    s3 = boto3.client("s3")

    def exists(key):
        try:
            s3.head_object(Bucket=args.bucket, Key=key)
            return True
        except ClientError:
            return False

    def put(key, body):
        s3.put_object(Bucket=args.bucket, Key=key, Body=body, ContentType="image/webp",
                      CacheControl="public, max-age=31536000, immutable")  # 키가 내용 해시 기반이라 영구 캐시
    return exists, put


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("urls", help="원본 URL 목록(한 줄에 하나)")
    ap.add_argument("--bucket"), ap.add_argument("--cdn", required=True, help="CloudFront 주소(https://…)")
    ap.add_argument("--sql", required=True, help="출력 SQL 파일")
    ap.add_argument("--out-dir", help="S3 대신 로컬 폴더에 쓴다(시험용)")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args(argv)
    if not args.out_dir and not args.bucket:
        ap.error("--bucket 또는 --out-dir 가 필요하다")

    urls = sorted({u.strip() for u in pathlib.Path(args.urls).read_text().splitlines() if u.strip()})
    exists, put = make_store(args)

    def one(url):
        try:
            key = thumb_key(url)
            if not exists(key):
                put(key, resize(download(url)))
            return url, None
        except Exception as e:  # 한 장이 죽어도 배치는 계속 — 실패는 아래에서 센다
            return url, f"{type(e).__name__}: {e}"

    ok, failed = [], []
    with cf.ThreadPoolExecutor(args.workers) as ex:
        for url, err in ex.map(one, urls):
            (failed if err else ok).append((url, err))
    pathlib.Path(args.sql).write_text("BEGIN;\n" + "\n".join(update_sql(u, args.cdn) for u, _ in ok) + "\nCOMMIT;\n")
    print(f"총 {len(urls)} · 성공 {len(ok)} · 실패 {len(failed)} → {args.sql}")
    for u, e in failed[:20]:
        print(f"  실패 {u} — {e}", file=sys.stderr)
    return 1 if urls and not ok else 0


if __name__ == "__main__":
    sys.exit(main())
