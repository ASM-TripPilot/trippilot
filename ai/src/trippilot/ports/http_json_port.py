"""HTTP JSON 콘센트 — 백엔드 `/internal/**` 어댑터들이 공유하는 전송 프로토콜.

`poi_curation/adapters/backend_poi_db.py` 가 먼저 갖고 있던 것을 여기로 올렸다.
두 번째 소비자(`llm_gateway/adapters/backend_persona.py`)가 생겼는데 **llm_gateway 는
poi_curation 을 import 할 수 없어서**(아키텍처 규칙 — `test_llm_gateway_does_not_
import_assembly_engine_or_poi_curation`) 그대로 두면 같은 Protocol 이 둘이 된다.

구현체(`UrllibJsonClient`)는 옮기지 않았다 — 포트는 인터페이스 자리고, 실 클라이언트
조립은 배선(composition root) 몫이다. 어댑터 둘이 **같은 인스턴스 하나**를 주입받으면
연결·타임아웃 설정이 한 곳에서만 정해진다.
"""

from __future__ import annotations

from typing import Mapping, Protocol


class HttpJson(Protocol):
    """어댑터가 쓰는 HTTP 콘센트 — 테스트는 fake, 실행 조립은 UrllibJsonClient."""

    def request_json(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None = None,
        body: object | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> object: ...
