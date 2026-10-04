#!/usr/bin/env python3
"""수집 POI 적재 — 수집 산출 문서를 백엔드 수신 API 에 **그대로** 태운다.

    POST {base-url}/internal/pois/proposals     헤더: X-Service-Token

수집 산출물의 모양이 곧 수신 DTO 계약이라 **변환 단계가 없다**. 생산은
`ai/src/trippilot/poi_curation/sourcing/pipeline.py` 의 `to_output_document`,
소비는 `backend/modules/place-data/.../PoiProposalDtos.kt` 이고 칸 이름이 서로 같다.
그래서 이 스크립트가 하는 일은 사실 **쪼개서 보내고 응답을 합산하는 것**뿐이다 —
여기에 필드를 손보는 코드가 생기면 그건 계약이 깨졌다는 신호이니 고칠 곳은 양쪽 끝이다.

사용법:
    export SERVICE_AUTH_TOKEN=...            # k8s secret trippilot-shared
    python3 backend/scripts/ingest_pois.py ai/data/collected_pois.json
    python3 backend/scripts/ingest_pois.py --dry-run ai/data/collected_pois.json
    python3 backend/scripts/ingest_pois.py --close-missing ai/data/collected_localdata.json
    python3 backend/scripts/ingest_pois.py --self-check

배포 환경은 게이트웨이가 `/internal` 을 외부에 404 로 막으므로 외부 URL 로는 닿지 않는다.
`kubectl port-forward svc/backend 8080:8080 -n trippilot` 를 띄우고 기본값(localhost:8080)으로 쓴다.
절차·함정은 `docs/guides/poi-수집본-적재.md`.

**재실행이 안전하다.** 멱등 키가 `provenance.content_id` 라서 같은 문서를 몇 번 넣어도
행이 늘지 않는다(신규 대신 갱신으로 집계된다). 그래서 중간에 실패하면 되돌릴 것 없이
같은 명령을 다시 돌리면 된다 — 이 스크립트에 재시도·이어가기 장치를 두지 않은 이유다.

**upsert 는 원본에서 빠진 장소를 닫지 못한다**(TRIP-1227). `--close-missing` 을 주면 문서마다 청크 수신이
**전부** 성공한 뒤 그 문서의 `provenance.content_id` 전부를 `POST /internal/pois/close-missing` 으로 보내, 그
출처의 ACTIVE 중 목록에 없는 것을 CLOSED 로 내린다. 문서 한 장을 **그 출처의 전부**로 읽으므로 전부가 아닌
문서(회차 artifact 한 장 등)로 쓰면 나머지가 닫힌다 — 서버는 목록에 있는 것이 절반 미만이면 409 로 거부하고,
의도한 대량 정리만 `--allow-mass-close` 로 통과한다. 기본은 끈 상태다(로컬 compose 자동 적재도 upsert 만 한다).
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

INGEST_PATH = "/internal/pois/proposals"
CLOSE_PATH = "/internal/pois/close-missing"
TOKEN_HEADER = "X-Service-Token"
TOKEN_ENV = "SERVICE_AUTH_TOKEN"

# 한 요청에 담는 제안 수. 수신은 문서 한 건 = 트랜잭션 한 개라서, 2만 건을 한 번에 보내면
# 24MB 요청 하나가 원격 DB 상대로 한 트랜잭션을 길게 붙잡는다. 쪼개도 결과는 같다 —
# 멱등 키가 제안마다 따로이고, 문서 내 중복 제거도 청크 안에서만 의미가 있기 때문이다.
DEFAULT_CHUNK = 500


def load_document(path):
    """문서를 읽고 **최소한만** 본다 — 모르는 칸은 수신 쪽이 무시하므로 여기서 거절하지 않는다."""
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(doc, dict):
        raise ValueError(f"{path}: 최상위가 객체가 아니다")
    source = doc.get("source")
    if not isinstance(source, str) or not source.strip():
        # 수신은 알 수 없는 출처를 400 으로 막는다. 여기서 먼저 끊으면 24MB 를 헛되이 보내지 않는다.
        raise ValueError(f"{path}: source 가 없다 — 수집 산출 문서가 맞는지 확인")
    proposals = doc.get("proposals")
    if not isinstance(proposals, list):
        raise ValueError(f"{path}: proposals 배열이 없다")
    return doc, source, proposals


def present_refs(proposals):
    """`--close-missing` 이 보낼 목록 — 각 제안의 `provenance.content_id` 를 **문서 값 그대로**.

    다듬거나 문자열로 바꾸지 않는다. 수신(`/proposals`)이 이 값을 읽는 규칙(백엔드 JSON 매퍼)과 같은 규칙으로
    `/close-missing` 이 읽어야, 방금 넣은 행이 "목록에 없음"으로 닫히지 않는다.
    """
    refs = []
    for item in proposals:
        provenance = item.get("provenance") if isinstance(item, dict) else None
        ref = provenance.get("content_id") if isinstance(provenance, dict) else None
        if ref is not None:
            refs.append(ref)
    return refs


def repeated_sources(documents):
    """두 문서 이상에 나온 출처. `--close-missing` 은 문서 한 장을 그 출처의 전부로 읽어서,
    같은 출처 문서가 둘이면 둘째 문서가 첫째 문서에만 있던 행을 닫는다."""
    counts = Counter(source for _path, _doc, source, _proposals in documents)
    return sorted(source for source, n in counts.items() if n > 1)


def chunked(items, size):
    """size<=0 이면 통째로 한 덩이. 빈 목록은 덩이도 없다(빈 요청을 보내지 않는다)."""
    if size <= 0:
        return [items] if items else []
    return [items[i:i + size] for i in range(0, len(items), size)]


def merge(totals, response):
    """응답 합산. `dropped` 는 사유별 지도라서 더하기가 아니라 **사유마다** 합친다."""
    for key in ("received", "registered", "updated", "regionUnresolved"):
        totals[key] += int(response.get(key, 0))
    totals["dropped"].update({k: int(v) for k, v in (response.get("dropped") or {}).items()})
    return totals


def empty_totals():
    return {"received": 0, "registered": 0, "updated": 0, "regionUnresolved": 0, "dropped": Counter()}


def post_json(base_url, path, token, payload, timeout):
    request = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", TOKEN_HEADER: token},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def post_chunk(base_url, token, doc, chunk, timeout):
    """원문 문서에서 proposals 만 바꿔 보낸다 — 우리가 안 쓰는 칸도 그대로 넘긴다."""
    return post_json(base_url, INGEST_PATH, token, dict(doc, proposals=chunk), timeout)


def report(totals):
    print(
        "합계 — 접수={received} 신규={registered} 갱신={updated} 지역코드미상={regionUnresolved}".format(**totals)
    )
    if totals["dropped"]:
        print("탈락(사유별):")
        for reason, count in sorted(totals["dropped"].items(), key=lambda kv: -kv[1]):
            print(f"  {reason}: {count}")
    else:
        print("탈락 없음")
    if totals["regionUnresolved"]:
        print(
            "::주의:: 지역코드미상이 0이 아니다 — 주소 형태가 바뀐 것이다(TRIP-359). "
            "커버리지 집계에서 조용히 빠지므로 수집 쪽 문서를 확인할 것.",
            file=sys.stderr,
        )


def main(argv=None):
    parser = argparse.ArgumentParser(description="수집 POI 문서를 백엔드 수신 API 에 적재한다")
    parser.add_argument("paths", nargs="*", help="수집 산출 문서 경로(여러 개 가능 — 준 순서대로 보낸다)")
    parser.add_argument("--base-url", default="http://localhost:8080", help="기본 http://localhost:8080 (port-forward)")
    parser.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK, help=f"요청당 제안 수, 0=쪼개지 않음 (기본 {DEFAULT_CHUNK})")
    parser.add_argument("--timeout", type=int, default=300, help="요청 타임아웃 초 (기본 300)")
    parser.add_argument("--dry-run", action="store_true", help="보내지 않고 대상·건수만 출력")
    parser.add_argument("--close-missing", action="store_true",
                        help="문서마다 적재가 전부 성공하면 그 출처의 ACTIVE 중 문서에 없는 것을 CLOSED 로 (문서가 그 출처의 전부일 때만)")
    parser.add_argument("--allow-mass-close", action="store_true",
                        help="--close-missing 의 비율 가드(목록에 있는 것이 ACTIVE 의 절반 미만이면 거부)를 넘는다 — 의도한 대량 정리만")
    parser.add_argument("--self-check", action="store_true", help="문서 파싱·쪼개기·합산·미포함 정리 자체 점검")
    args = parser.parse_args(argv)

    if args.self_check:
        self_check()
        print("self-check 통과")
        return 0
    if not args.paths:
        parser.error("문서 경로가 없다 (--self-check 로 자체 점검만 할 수 있다)")
    if args.allow_mass_close and not args.close_missing:
        parser.error("--allow-mass-close 는 --close-missing 과 함께만 뜻이 있다")

    token = os.environ.get(TOKEN_ENV, "").strip()
    # 토큰이 없으면 **보내기 전에** 끊는다. 헤더 없이 보내면 /internal 은 401 로 닫히지만,
    # "왜 0건이지"를 응답 본문 없이 되짚게 되므로 여기서 이유를 말하고 멈추는 쪽이 낫다.
    if not token and not args.dry_run:
        print(f"{TOKEN_ENV} 가 비어 있다 — 무인증으로 보내지 않는다. k8s secret trippilot-shared 에서 꺼내 export 할 것.",
              file=sys.stderr)
        return 1

    documents = []
    for path in args.paths:
        try:
            documents.append((path, *load_document(path)))
        except (OSError, ValueError, json.JSONDecodeError) as e:
            print(f"문서를 읽지 못했다: {e}", file=sys.stderr)
            return 1

    if args.close_missing and repeated_sources(documents):
        print(f"--close-missing 은 출처마다 문서 한 장만 받는다(겹친 출처: {', '.join(repeated_sources(documents))}) — "
              "문서 한 장을 그 출처의 전부로 읽으므로 둘째 문서가 첫째 문서의 행을 닫는다. 합본 한 장으로 줄 것.",
              file=sys.stderr)
        return 1

    if args.dry_run:
        print(f"대상: {args.base_url}{INGEST_PATH} (토큰 {'설정됨' if token else '미설정'})")
        for path, _doc, source, proposals in documents:
            batches = len(chunked(proposals, args.chunk_size))
            print(f"  {path}: source={source} 제안={len(proposals)}건 → 요청 {batches}회")
            if args.close_missing:
                print(f"    → 이어서 {CLOSE_PATH}: 목록 {len(present_refs(proposals))}건 — {source} ACTIVE 중 "
                      f"목록에 없는 것을 CLOSED 로{' (비율 가드 넘음)' if args.allow_mass_close else ''}")
        print(f"합계 제안 {sum(len(p) for *_, p in documents)}건 — 드라이런이라 보내지 않았다")
        return 0

    totals = empty_totals()
    for path, doc, source, proposals in documents:
        batches = chunked(proposals, args.chunk_size)
        print(f"{path}: source={source} 제안={len(proposals)}건 → 요청 {len(batches)}회")
        for i, chunk in enumerate(batches, 1):
            try:
                response = post_chunk(args.base_url, token, doc, chunk, args.timeout)
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:500]
                print(f"  [{i}/{len(batches)}] HTTP {e.code} — 중단한다. 응답: {detail}", file=sys.stderr)
                report(totals)
                print("멱등이므로 원인을 고친 뒤 같은 명령을 다시 돌리면 된다(되돌릴 것 없음).", file=sys.stderr)
                return 2
            except urllib.error.URLError as e:
                print(f"  [{i}/{len(batches)}] 연결 실패 — port-forward 가 떠 있는지 확인. {e.reason}", file=sys.stderr)
                report(totals)
                return 2
            merge(totals, response)
            print("  [{}/{}] 접수={received} 신규={registered} 갱신={updated}".format(
                i, len(batches), **{k: response.get(k, 0) for k in ("received", "registered", "updated")}))
        if not args.close_missing:
            continue
        # 여기 닿았다는 것은 이 문서의 청크가 **전부** 성공했다는 뜻이다 — 일부만 들어간 상태에서 대조하면
        # 안 들어간 행이 "문서에 없음"으로 닫힌다.
        payload = {"source": source, "present_source_refs": present_refs(proposals),
                   "allow_mass_close": args.allow_mass_close}
        try:
            result = post_json(args.base_url, CLOSE_PATH, token, payload, args.timeout)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:500]
            print(f"  미포함 정리 HTTP {e.code} — 중단한다. 응답: {detail}", file=sys.stderr)
            if e.code == 409:
                print("  비율 가드 거부 — 이 문서의 적재(upsert)는 반영됐고 닫힌 행은 없다. 문서가 그 출처의 전부인지 "
                      "확인하고, 의도한 대량 정리일 때만 --allow-mass-close.", file=sys.stderr)
            report(totals)
            return 2
        except urllib.error.URLError as e:
            print(f"  미포함 정리 연결 실패 — port-forward 가 떠 있는지 확인. {e.reason}", file=sys.stderr)
            report(totals)
            return 2
        print("  미포함 정리 — {source} ACTIVE {activeBefore} 중 목록에 있음 {present} · CLOSED {closed}".format(
            **{k: result.get(k) for k in ("source", "activeBefore", "present", "closed")}))
    report(totals)
    return 0


def self_check():
    """프레임워크 없이 — 파싱 거절·쪼개기·합산이 깨지면 여기서 실패한다."""
    import tempfile

    def write(obj):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        json.dump(obj, f, ensure_ascii=False)
        f.close()
        return f.name

    item = {"poi": {"name": "가마오름", "category": "NATURE", "coord": {"lat": 33.3, "lng": 126.2}},
            "provenance": {"content_id": "1884191"}}
    doc, source, proposals = load_document(write({"schema_version": 1, "source": "TOURAPI", "proposals": [item]}))
    assert source == "TOURAPI", source
    assert proposals == [item]
    assert doc["schema_version"] == 1

    # 알 수 없는 최상위 칸은 그대로 통과해야 한다 — 상대 문서가 조금 바뀌어도 적재가 막히지 않게.
    _, _, proposals = load_document(write({"source": "TOURAPI", "proposals": [], "stats": {"x": 1}}))
    assert proposals == []

    for bad in ([], {"proposals": []}, {"source": " ", "proposals": []}, {"source": "TOURAPI"},
                {"source": "TOURAPI", "proposals": {}}):
        try:
            load_document(write(bad))
        except ValueError:
            pass
        else:
            raise AssertionError(f"거절해야 하는 문서를 통과시켰다: {bad}")

    items = list(range(7))
    assert chunked(items, 3) == [[0, 1, 2], [3, 4, 5], [6]]
    assert chunked(items, 7) == [items]
    assert chunked(items, 0) == [items]
    assert chunked([], 3) == []
    assert chunked([], 0) == []
    assert sum(len(c) for c in chunked(items, 2)) == len(items)

    totals = empty_totals()
    merge(totals, {"received": 3, "registered": 2, "updated": 0, "regionUnresolved": 1,
                   "dropped": {"no_coord": 1}})
    merge(totals, {"received": 2, "registered": 0, "updated": 2, "regionUnresolved": 0,
                   "dropped": {"no_coord": 2, "unknown_category": 5}})
    assert totals["received"] == 5, totals
    assert totals["registered"] == 2 and totals["updated"] == 2, totals
    assert totals["regionUnresolved"] == 1, totals
    assert dict(totals["dropped"]) == {"no_coord": 3, "unknown_category": 5}, totals

    # 칸이 빠진 응답도 합산이 터지지 않아야 한다(수신이 필드를 늘리거나 줄일 수 있다).
    merge(totals, {})
    assert totals["received"] == 5, totals

    # 닫기 목록은 문서 값 그대로 — 식별자 없는 제안만 빠지고, 숫자도 문자열로 바꾸지 않는다(수신 매퍼가 같은 규칙으로 읽는다).
    assert present_refs([item, {"provenance": {}}, {"poi": {}}, {"provenance": {"content_id": 7}}]) == ["1884191", 7]
    docs = [("a", {}, "TOURAPI", []), ("b", {}, "LOCALDATA", []), ("c", {}, "TOURAPI", [])]
    assert repeated_sources(docs) == ["TOURAPI"] and repeated_sources(docs[:2]) == []

    self_check_close_missing(write, item)


def self_check_close_missing(write, item):
    """`--close-missing` 을 가짜 수신 서버에 실제로 태운다 — 호출 순서·본문·**종료 코드가 닿는지**까지.

    가드는 만들어 두는 것으로 끝나지 않는다. 거부가 0 으로 끝나거나 실패한 적재 뒤에 닫기가 나가면
    "실패하면 멈춘다"고 믿은 채 출처가 통째로 닫힌다(docs/conventions/anti-patterns.md — 가드가 닿는지 확인할 것).
    """
    import contextlib
    import io
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    calls, status = [], {}

    class FakeBackend(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append((self.path, body))
            if self.path == INGEST_PATH:
                n = len(body["proposals"])
                reply = {"received": n, "registered": n, "updated": 0, "regionUnresolved": 0, "dropped": {}}
            else:
                reply = {"source": body["source"], "activeBefore": 3, "present": 2, "closed": 1}
            data = json.dumps(reply).encode("utf-8")
            self.send_response(status.get(self.path, 200))
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):   # 요청마다 stderr 에 찍지 않는다
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeBackend)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    def run(*argv, ingest=200, close=200):
        calls.clear()
        status.clear()
        status.update({INGEST_PATH: ingest, CLOSE_PATH: close})
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = main([*argv, "--base-url", base_url])
        return code, [path for path, _ in calls]

    items = [dict(item, provenance={"content_id": f"R{i}"}) for i in range(3)]
    doc = write({"source": "LOCALDATA", "proposals": items})
    saved_token = os.environ.get(TOKEN_ENV)
    os.environ[TOKEN_ENV] = "self-check"
    try:
        # 기본은 upsert 만 — 닫기를 부르지 않는다(로컬 compose 자동 적재가 이 경로다).
        code, paths = run(doc, "--chunk-size", "2")
        assert code == 0 and paths == [INGEST_PATH, INGEST_PATH], (code, paths)

        # 청크가 전부 성공한 **뒤** 한 번, 문서의 식별자 전부를 보낸다.
        code, paths = run(doc, "--chunk-size", "2", "--close-missing")
        assert code == 0 and paths == [INGEST_PATH, INGEST_PATH, CLOSE_PATH], (code, paths)
        assert calls[-1][1] == {"source": "LOCALDATA", "present_source_refs": ["R0", "R1", "R2"],
                                "allow_mass_close": False}, calls[-1]

        code, _ = run(doc, "--close-missing", "--allow-mass-close")
        assert code == 0 and calls[-1][1]["allow_mass_close"] is True, (code, calls[-1])

        # 거부(409)는 0 이 아닌 종료 — 적재는 반영됐어도 정리가 안 된 것을 성공으로 끝내지 않는다.
        code, paths = run(doc, "--close-missing", close=409)
        assert code != 0 and paths == [INGEST_PATH, CLOSE_PATH], (code, paths)

        # 청크 하나라도 실패하면 닫기를 부르지 않는다 — 일부만 들어간 상태에서 대조하면 안 들어간 행이 닫힌다.
        code, paths = run(doc, "--chunk-size", "2", "--close-missing", ingest=500)
        assert code != 0 and CLOSE_PATH not in paths, (code, paths)

        code, paths = run(doc, "--close-missing", "--dry-run")
        assert code == 0 and paths == [], (code, paths)

        # 같은 출처 문서가 둘이면 보내기 전에 거부한다.
        code, paths = run(doc, write({"source": "LOCALDATA", "proposals": items[:1]}), "--close-missing")
        assert code != 0 and paths == [], (code, paths)
    finally:
        server.shutdown()
        server.server_close()
        if saved_token is None:
            os.environ.pop(TOKEN_ENV, None)
        else:
            os.environ[TOKEN_ENV] = saved_token


if __name__ == "__main__":
    sys.exit(main())
