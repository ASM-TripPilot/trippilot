"""도우미 입구 인젝션 그림자 — 정규식을 통과한 말을 임베딩 서비스 `/classify/injection` 으로 **뒤에서** 보내 판정값만 로그한다.

응답 경로를 막지 않는다: 작업 스레드 1개 + 대기 상한(넘치면 버리고 그 사실만 한 줄). 404(그 서비스에 분류기를 안 켰다)를 한 번
보면 스스로 끈다 — 분류기를 안 켠 운영에서 매 턴 헛걸음하지 않게. 로그에 발화는 없다(SEC-U8-06) — trace_id·점수·임계·판정·지연뿐.
울린 비율이 곧 오탐률의 상한이다(실제 인젝션은 드물다). 근거·측정: ai/docs/security/injection-classifier-shadow.md
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger(__name__)

THRESHOLD = 0.5  # 2026-10-30 측정 임계 — 정상 142건 오탐 0
_MAX_PENDING = 8  # 이만큼 밀리면 버린다(그림자라 잃어도 된다 — 응답 경로·스레드를 늘리지 않는 쪽이 중요)


class HttpInjectionShadow:
    def __init__(self, base_url: str, *, timeout_sec: float = 3.0, threshold: float = THRESHOLD,
                 post: Callable[[dict], dict] | None = None) -> None:
        if not base_url:
            raise ValueError("base_url 필수")
        self._url = base_url.rstrip("/") + "/classify/injection"
        self._timeout = timeout_sec
        self._threshold = threshold
        self._post = post or self._http_post
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="injection-shadow")
        self._slots = threading.BoundedSemaphore(_MAX_PENDING)
        self._off = False

    def submit(self, text: str, trace_id: str) -> None:
        """던지지 않고 기다리지 않는다."""
        if self._off:
            return
        if not self._slots.acquire(blocking=False):
            self._log(trace_id, {"skipped": "busy"})
            return
        try:
            self._pool.submit(self._run, text, trace_id)
        except RuntimeError:  # 종료 중인 풀
            self._slots.release()

    def close(self) -> None:
        """밀린 일을 다 끝낸다 — 테스트·종료용."""
        self._pool.shutdown(wait=True)

    def _run(self, text: str, trace_id: str) -> None:
        started = time.monotonic()
        try:
            body = self._post({"texts": [text]})
            score = float(body["scores"][0])
            record = {"score": round(score, 3), "flagged": score >= self._threshold, "threshold": self._threshold,
                      "model": body.get("model")}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                self._off = True
                log.info("도우미 인젝션 그림자 off — 임베딩 서비스에 분류기 없음(404, INJECTION_GUARD_DIR 미설정)")
                return
            record = {"error": f"http_{e.code}"}
        except Exception as e:  # noqa: BLE001 — 그림자: 어떤 실패도 상태값이다
            record = {"error": type(e).__name__}
        finally:
            self._slots.release()
        self._log(trace_id, {**record, "ms": int((time.monotonic() - started) * 1000)})

    def _log(self, trace_id: str, record: dict) -> None:
        log.info("dialogue_injection_shadow %s", json.dumps(
            {"event": "dialogue_injection_shadow", "trace_id": trace_id, **record}, ensure_ascii=False))

    def _http_post(self, payload: dict) -> dict:
        request = urllib.request.Request(
            self._url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=self._timeout) as response:  # noqa: S310 — 내부 서비스 주소(env)
            return json.loads(response.read())
