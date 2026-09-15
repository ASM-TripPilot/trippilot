"""FakeHttpGetJson — `HttpGetJson`(url, headers, params) 포트 fake (실 호출 0, D37).

`background.naver_search.HttpGetJson` 프로토콜의 3-인자 계약을 그대로 만족한다
(`fake_tourapi_http.FakeTourApiHttp` 는 헤더가 없는 TourAPI 전용 2-인자라 이쪽에
쓸 수 없다). 카카오 로컬처럼 **헤더로 인증하는** 어댑터 테스트용.

- `script`: 호출 순서대로 꺼내 쓰는 응답. 원소가 `BaseException` 이면 **던진다**
  (전송 장애 주입). 소진되면 `default` 를 반복한다.
- `on_call`: 호출 직전에 부르는 훅 — 논리 시계 전진(FakeClock.advance) 주입용.
  실 sleep 없이 "호출이 시간을 먹는다"를 재현한다 (DL-3).
- `calls`: (url, headers, params) 기록. 호출 예산·마감 검증의 근거.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence


class FakeHttpGetJson:
    def __init__(
        self,
        script: Sequence[object] = (),
        *,
        default: object = None,
        on_call: Callable[[], None] | None = None,
    ) -> None:
        self._script = list(script)
        self._default = default
        self._on_call = on_call
        self.calls: list[tuple[str, dict[str, str], dict[str, str]]] = []

    def get_json(
        self, url: str, headers: Mapping[str, str], params: Mapping[str, str]
    ) -> object:
        self.calls.append((url, dict(headers), dict(params)))
        if self._on_call is not None:
            self._on_call()
        i = len(self.calls) - 1
        item = self._script[i] if i < len(self._script) else self._default
        if isinstance(item, BaseException):
            raise item
        return item
