"""BackendPersonaStore — 페르소나 재조회의 실 어댑터 (TRIP-434).

`StaticPersonaStore`(배선 안의 고정 요약)를 대체한다. 백엔드 `GET
/internal/users/{accountId}/persona` 를 **매 요청 조회**한다 — 캐시를 두지 않는 것은
성능을 포기한 것이 아니라 BR-U4-07 이 "프롬프트 입력은 요청자 권한 하에 재조회한
값만"을 요구하기 때문이다. 봉투로 받은 값이나 캐시된 값은 그 요건을 못 채운다.

## 어휘 변환이 여기 있는 이유

백엔드는 자기 어휘(`휴양`·`부모님`·`럭셔리`)를 그대로 낸다 — 접기 판단을 우리가
소유하기 위해서다(`PersonaInternalController` 주석: 우리가 AI enum 으로 바꿔 내면
접기 규칙을 백엔드가 떠안고 AI enum 이 바뀔 때마다 따라 고쳐야 한다). 그래서 이
어댑터가 `domain.persona` 의 변환표를 쓴다.

## 실패는 숨기지 않는다

조회가 깨지면 **예외로 올린다**(`PersonaFetchError`). 빈 페르소나로 위장하면
"취향 없는 사람"으로 일정이 나가고 아무도 못 알아챈다 — 그 강등 여부는
`PersonaProvider` 가 `COLD_START`/`UNAVAILABLE` 로 판정할 몫이다(INV-4).
"""

from __future__ import annotations

from collections.abc import Mapping

from trippilot.domain.common import BUDGET_TOKENS, BudgetLevel
from trippilot.domain.context import ResourceRef
from trippilot.domain.persona import PersonaSummary, companion_from, taste_tags_from
from trippilot.ports.http_json_port import HttpJson

_PATH = "/internal/users/{account_id}/persona"
_TOKEN_HEADER = "X-Service-Token"


class PersonaFetchError(RuntimeError):
    """페르소나 조회 실패 — 빈 요약으로 위장하지 않는다(INV-4).

    `status` 는 백엔드 HTTP 상태(연결 실패·계약 위반이면 None). `BackendPoiDbError`
    와 같은 이유로 나눠 든다 — 4xx(우리가 잘못 보냄)와 5xx(상대 장애)를 뭉치면
    호출측이 멀쩡한 자기 요청에 상대 장애 폴백을 태운다.
    """

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class BackendPersonaStore:
    """ContextStore — persona ref 를 백엔드에서 재조회한다 (StaticPersonaStore 동형)."""

    def __init__(self, http: HttpJson, base_url: str, service_token: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._headers = {_TOKEN_HEADER: service_token}

    def get(self, ref: ResourceRef) -> PersonaSummary:
        url = self._base + _PATH.format(account_id=ref.ref_id)
        try:
            body = self._http.request_json("GET", url, headers=self._headers)
        except Exception as e:  # 전송 계층 실패 — 상태코드를 모른다
            raise PersonaFetchError(f"페르소나 조회 실패: {ref.ref_id}") from e
        if not isinstance(body, Mapping):
            raise PersonaFetchError(f"페르소나 응답이 객체가 아님: {type(body).__name__}")
        return _to_summary(body)


def _to_summary(body: Mapping) -> PersonaSummary:
    """응답 → 요약. **미설정 축은 미설정으로 남긴다** — 중립값을 지어내지 않는다.

    예산만 예외다: `BudgetLevel` 에 '미설정'이 없고 미인식을 MID 로 보는 것이
    경계 전체의 기존 규칙이라(소프트 제약 — 배제 아님) 그대로 따른다.
    """
    tier = body.get("budget_tier")
    return PersonaSummary(
        taste_tags=taste_tags_from(body.get("styles") or ()),
        companion=companion_from(body.get("companion_types") or ()),
        budget=(BUDGET_TOKENS.get(str(tier).strip().upper(), BudgetLevel.MID)
                if tier else BudgetLevel.MID),
    )
