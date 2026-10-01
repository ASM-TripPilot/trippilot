"""입장료 파생 지식 — `source_ref` → 성인 1인 입장료.

**백엔드 정본이 아니다.** POI 정본은 C7 단일 소유이고(PR #76), 백엔드 read 경계
(`PoiReadResponse`)에는 가격 필드가 없다. 대신 백엔드가 `sourceRef` 주석에 설계해 둔
조인 키 패턴을 쓴다 — "상대가 자기 파생 지식을 자기 스토어에 들고 런타임 후보에
붙일 때 이 값으로 맞춘다". KB-5 장소 설명(`agents/planb/place_knowledge.py`)이 이미
같은 길을 쓴다.

**세 값을 가른다.** 합치면 파서를 고칠 근거가 사라진다:

    won=0      측정된 무료
    won=<int>  성인 1인 입장료
    won=None   **불명** — 값은 있는데 못 읽었다("공연 별로 상이함")
    키 부재     요금 필드 자체가 없었다

뒤 둘은 점수상 같게(중립) 다루지만 **세는 것은 따로 센다** — "봤는데 못 읽었다"와
"볼 것이 없었다"는 다른 사건이고, 전자는 파서 결함의 신호다(실측: `일반 9,000원` 의
'반'이 수강료 필터에 걸려 진짜 입장료가 무료로 밀렸다).

`raw` 를 같이 보관한다 — 파서를 고칠 때 재수집 없이 재파싱하기 위해서다.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

_logger = logging.getLogger("trippilot.place_fees")

_DEFAULT_PATH = Path(__file__).resolve().parents[3] / "data" / "place_fees.json"


@dataclass(frozen=True, slots=True)
class FeeTable:
    """`source_ref` → 원화 입장료. 없는 키는 `None`(모름)."""

    won: Mapping[str, int | None]
    fetched_at: str = ""
    malformed: int = 0
    """형식 위반으로 버린 행 수. **0 이 아니면 산출기 쪽 결함 신호다** —
    조용히 적게 적재되는 것과 구별하려고 센다."""
    attempted: int = 0
    """산출기가 조회를 시도한 POI 수. 0 이면 그 필드가 없는 옛 파일이다.

    **커버리지를 파일 자체에서 계산하려고 둔다.** 이게 없으면 "반쪽 파일이 왔는지"를
    읽는 쪽이 판단할 근거가 없고, 그렇다고 "예상보다 적으면 경고" 같은 임계를 두면
    근거 없는 상수가 하나 는다. 모수를 같이 실어 보내면 임계 없이 드러난다."""

    def coverage(self) -> float | None:
        """값을 확보한 비율. 모수를 모르면 `None` — 0.0 과 다르다."""
        return len(self.won) / self.attempted if self.attempted else None

    def of(self, source_ref: str | None) -> int | None:
        """성인 1인 입장료. **모르면 `None`** — 0원(무료)과 다르다."""
        if not source_ref:
            return None
        return self.won.get(source_ref)

    def counts(self) -> dict[str, int]:
        """관측 가능성 — 무료·유료·불명을 따로 센다 (침묵 금지)."""
        free = sum(1 for v in self.won.values() if v == 0)
        paid = sum(1 for v in self.won.values() if v is not None and v > 0)
        return {"free": free, "paid": paid, "unparsed": len(self.won) - free - paid}


EMPTY = FeeTable(won={})
"""파일 미배치 상태. **전부 `None` 이라 점수가 오늘과 동일하다** — 켜지기 전에도
동작이 안 바뀌는 것이 이 기구의 안전 조건이다."""


def load_fee_table(path: Path | None = None) -> FeeTable:
    """파일 → 표. **없거나 깨져도 예외를 안 올린다** — 요금은 부가 정보다 (INV-4).

    다만 침묵하지 않는다: 사유를 로그로 남기고 빈 표로 강등한다. 빈 표는 전 POI 가
    '모름'이라 종전과 같은 점수가 나온다.
    """
    target = path if path is not None else _DEFAULT_PATH
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
        fees = raw["fees"]
        if not isinstance(fees, Mapping):
            raise TypeError(f"fees 가 객체가 아님: {type(fees).__name__}")
    except FileNotFoundError:
        _logger.info("place_fees 미배치 (%s) — 예산 점수는 전부 중립", target.name)
        return EMPTY
    except Exception as e:  # 형식 위반·타입 이상 — 데이터 버그지만 일정을 죽이진 않는다
        _logger.warning("place_fees 로드 실패 %s: %s — 전부 중립으로 진행",
                        type(e).__name__, e)
        return EMPTY
    # **행 단위로 견딘다.** 한 행이 이상하다고 전량을 버리면 5천 건대에서
    # 산출기의 사소한 버그 하나가 기능을 통째로 끈다 — 그것도 조용히(빈 표는
    # 전부 '모름'이라 점수가 정상처럼 보인다). 버린 수는 세서 드러낸다.
    won: dict[str, int | None] = {}
    malformed = 0
    for ref, entry in fees.items():
        try:
            value = entry["won"]
            won[str(ref)] = None if value is None else int(value)
        except (TypeError, ValueError, KeyError, IndexError):
            malformed += 1
    try:
        attempted = int(raw.get("attempted") or 0)
    except (TypeError, ValueError):
        attempted = 0
    table = FeeTable(won=won, fetched_at=str(raw.get("fetched_at") or ""),
                     malformed=malformed, attempted=attempted)
    if malformed:
        _logger.warning("place_fees 형식 위반 %s행 버림 — 산출기 확인 필요", malformed)
    cov = table.coverage()
    _logger.info("place_fees %s건 적재 (%s) · 커버리지 %s",
                 len(won), table.counts(),
                 f"{cov:.1%} (모수 {table.attempted:,})" if cov is not None else "모수 미상")
    return table
