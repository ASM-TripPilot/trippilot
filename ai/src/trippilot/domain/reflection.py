"""회고 연출 템플릿 도메인 타입 (U6 Reflect FD domain-entities §1~§3 — Phase 1).

계약 정본: reflection-template-design.md(#334) — "LLM은 장면 구성만, 결합은 서비스".
`ReflectionTemplate.to_dict()`가 곧 경계 응답 본문 (계약 §3 JSON과 키 단위 일치).

4대 불변식의 사영 (FD business-rules §1):
- INV-1 정신: visit_ref ⊆ 방문 기록 · source_event 실재 · 자리표시자 어휘 closed-set —
  판정은 게이트(gates/reflection_template.py) 몫, 타입은 대조 집합과 자리만 제공한다.
- INV-2 비적용의 구조화 + INV-3: ReflectionTemplate에 시각·순서·duration 필드 자체가 없다.
- 숫자 통계(방문 N·이동 km·사진 N)는 요청에 없다 — 캡션 속 숫자는 PLACEHOLDER_VOCAB
  자리표시자로만 실리고, 실측값 바인딩은 렌더 시 서버가 한다 (숫자 환각 구조 차단, 계약 §2).

Phase 2(VisionInput·PhotoRef 등, FD §4)는 이 파일 범위 밖 — ReflectionRequest 후미
기본값 필드로 후속 추가한다 (기존 호출 무영향 조건, FD business-logic §6.1).
규칙은 U1과 동일: frozen+slots · tz-aware · from_dict(to_dict(x)) == x (RFL-P6).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum

from typing import NewType

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.serialization import from_iso, to_iso

# ── 열거형 (FD domain-entities §1) ──────────────────────────


class ReflectionKind(Enum):
    """계약 §3.1 봉투 `kind`."""

    DAILY = "DAILY"
    TRIP_SUMMARY = "TRIP_SUMMARY"


class ReflectionFormat(Enum):
    """1차 산출은 CARD_NEWS만 — REELS·VIDEO는 합성 파이프라인이 생기면 확장 (계약 §1)."""

    CARD_NEWS = "CARD_NEWS"


class SceneLayout(Enum):
    """닫힌 enum (계약 §3.2) — 밖 layout은 스키마 불성립. 픽셀 배치는 FE 렌더러 소유."""

    PHOTO_FULL = "PHOTO_FULL"
    PHOTO_CAPTION = "PHOTO_CAPTION"
    STATS = "STATS"
    MAP = "MAP"
    EVENT = "EVENT"


class SourceEventKind(Enum):
    """EVENT 장면은 입력 이벤트에 실재할 때만 유효 (계약 §3.2)."""

    PLAN_B = "PLAN_B"
    SKIPPED = "SKIPPED"


class ViolationGrade(Enum):
    """계약 §4.1 등급 — 하드는 교체 대상, 소프트는 랭킹 감점만."""

    HARD = "HARD"
    SOFT = "SOFT"


class ViolationCode(Enum):
    """위반 코드도 closed-set — 게이트가 이 코드만 산출 (FD domain-entities §1)."""

    # HARD
    TIME_EXPR = "TIME_EXPR"  # 캡션·부제·해시태그 내 시간 표현 (INV-3)
    PLACEHOLDER_OUT = "PLACEHOLDER_OUT"  # 어휘 밖·poi 인덱스 범위 밖 자리표시자
    VISIT_REF_OUT = "VISIT_REF_OUT"  # 방문 기록 밖 참조 (INV-1 사영)
    EVENT_NOT_FOUND = "EVENT_NOT_FOUND"  # source_event 미실재
    # SOFT
    HASHTAG_OUT = "HASHTAG_OUT"  # 허용 집합 밖 (지역·방문지·브랜드 파생 아님, TRIP-558)
    CAPTION_LEN = "CAPTION_LEN"
    SCENE_COUNT = "SCENE_COUNT"
    DUP_VISIT_REF = "DUP_VISIT_REF"


# FD 표의 코드→등급 대응 — 어긋난 TemplateViolation은 존재 불가 (post-init 강제).
_GRADE_BY_CODE: dict[ViolationCode, ViolationGrade] = {
    ViolationCode.TIME_EXPR: ViolationGrade.HARD,
    ViolationCode.PLACEHOLDER_OUT: ViolationGrade.HARD,
    ViolationCode.VISIT_REF_OUT: ViolationGrade.HARD,
    ViolationCode.EVENT_NOT_FOUND: ViolationGrade.HARD,
    # 소프트 — 하드로 두면 '#제주여행' 같은 정당한 합성어까지 지운다 (TRIP-558).
    # 랭킹 감점만: 더 나은 후보가 있으면 그쪽이 뽑히고, 없으면 그대로 나간다.
    ViolationCode.HASHTAG_OUT: ViolationGrade.SOFT,
    ViolationCode.CAPTION_LEN: ViolationGrade.SOFT,
    ViolationCode.SCENE_COUNT: ViolationGrade.SOFT,
    ViolationCode.DUP_VISIT_REF: ViolationGrade.SOFT,
}

# ── 자리표시자 어휘 (FD domain-entities §3 — closed-set) ─────
# 어휘 밖 참조·poi 인덱스 범위 밖 = 하드 위반(PLACEHOLDER_OUT). 어휘 확장 = 계약 개정.
PLACEHOLDER_VOCAB: frozenset[str] = frozenset(
    {"visit_count", "distance_km", "photo_count", "region", "start_date", "end_date"}
)
# 인덱스형 자리표시자 {poi:i.name} — i는 요청 visits의 0-기반 인덱스 (범위 판정은 게이트).
POI_PLACEHOLDER_PATTERN = r"poi:(\d+)\.name"


# ── 입력 — 경계 요청 (FD domain-entities §2) ────────────────


@dataclass(frozen=True, slots=True)
class VisitRef:
    """방문 기록 참조의 최소 단위 (계약 §3.2 photo_slot.visit_ref)."""

    date: date
    poi_id: PoiId

    def to_dict(self) -> dict:
        return {"date": self.date.isoformat(), "poi_id": str(self.poi_id)}

    @classmethod
    def from_dict(cls, d: dict) -> "VisitRef":
        return cls(date=date.fromisoformat(d["date"]), poi_id=PoiId(d["poi_id"]))


@dataclass(frozen=True, slots=True)
class VisitRecord:
    """방문 기록 1건 — **시각·체류분 필드 없음** (INV-3 유출 원천 차단, G181 동형).

    order_in_day는 실측 방문 순서 (백엔드 조립값 — AI는 순서를 만들지 않는다).
    """

    ref: VisitRef
    poi_name: str
    category: str
    order_in_day: int
    photo_count: int

    def __post_init__(self) -> None:
        if self.order_in_day < 1:
            raise ValueError("order_in_day ≥ 1")
        if self.photo_count < 0:
            raise ValueError("photo_count ≥ 0")

    def to_dict(self) -> dict:
        return {
            "ref": self.ref.to_dict(),
            "poi_name": self.poi_name,
            "category": self.category,
            "order_in_day": self.order_in_day,
            "photo_count": self.photo_count,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "VisitRecord":
        return cls(
            ref=VisitRef.from_dict(d["ref"]),
            poi_name=d["poi_name"],
            category=d["category"],
            order_in_day=d["order_in_day"],
            photo_count=d["photo_count"],
        )


@dataclass(frozen=True, slots=True)
class TripEventRecord:
    """source_event 실재 검증의 대조 집합 (계약 §3.2 EVENT 장면)."""

    kind: SourceEventKind
    date: date
    detail: str

    def to_dict(self) -> dict:
        return {
            "kind": self.kind.value,
            "date": self.date.isoformat(),
            "detail": self.detail,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TripEventRecord":
        return cls(
            kind=SourceEventKind(d["kind"]),
            date=date.fromisoformat(d["date"]),
            detail=d["detail"],
        )


@dataclass(frozen=True, slots=True)
class ReflectionRequest:
    """경계 요청 — 방문·이벤트·페르소나는 백엔드가 조립해 전달 (계약 §5, AI stateless).

    사진 바이너리 절대 미포함 (BR-U6R-08) — Phase 1은 VisitRecord.photo_count 수량 메타뿐.
    """

    kind: ReflectionKind
    region: str
    start_date: date
    end_date: date
    visits: tuple[VisitRecord, ...]
    events: tuple[TripEventRecord, ...]
    persona_summary: str
    weather_summary: str

    def __post_init__(self) -> None:
        if not self.visits:
            # 방문 0건은 생성 진입 불가 — 트리거 단(백엔드)과 이중 방어 (BR-U6R-15)
            raise ValueError("visits ≥ 1 — 방문 0건은 생성 진입 불가 (BR-U6R-15)")
        if self.end_date < self.start_date:
            raise ValueError(f"기간 역전: {self.start_date} > {self.end_date}")

    def to_dict(self) -> dict:
        return {
            "kind": self.kind.value,
            "region": self.region,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "visits": [v.to_dict() for v in self.visits],
            "events": [e.to_dict() for e in self.events],
            "persona_summary": self.persona_summary,
            "weather_summary": self.weather_summary,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ReflectionRequest":
        return cls(
            kind=ReflectionKind(d["kind"]),
            region=d["region"],
            start_date=date.fromisoformat(d["start_date"]),
            end_date=date.fromisoformat(d["end_date"]),
            visits=tuple(VisitRecord.from_dict(v) for v in d["visits"]),
            events=tuple(TripEventRecord.from_dict(e) for e in d["events"]),
            persona_summary=d["persona_summary"],
            weather_summary=d["weather_summary"],
        )


# ── 산출 — 연출 템플릿 (FD domain-entities §3 = 계약 §3의 타입화) ──


@dataclass(frozen=True, slots=True)
class PhotoSlot:
    """자리와 참조뿐 — 실제 사진 결합은 서비스 렌더 시 (계약 §2, LLM은 이미지를 보지 않는다)."""

    visit_ref: VisitRef

    def to_dict(self) -> dict:
        return {"visit_ref": self.visit_ref.to_dict()}

    @classmethod
    def from_dict(cls, d: dict) -> "PhotoSlot":
        return cls(visit_ref=VisitRef.from_dict(d["visit_ref"]))


@dataclass(frozen=True, slots=True)
class Scene:
    """장면 1건. photo_slot·source_event 요구는 layout이 결정한다 (계약 §3.2)."""

    layout: SceneLayout
    photo_slot: PhotoSlot | None
    caption: str
    source_event: SourceEventKind | None = None

    def __post_init__(self) -> None:
        if (
            self.layout in (SceneLayout.PHOTO_FULL, SceneLayout.PHOTO_CAPTION)
            and self.photo_slot is None
        ):
            raise ValueError(f"{self.layout.value} 장면은 photo_slot 필수")
        if self.layout is SceneLayout.EVENT and self.source_event is None:
            raise ValueError("EVENT 장면은 source_event 필수")

    def to_dict(self) -> dict:
        d: dict = {"layout": self.layout.value}
        if self.photo_slot is not None:
            d["photo_slot"] = self.photo_slot.to_dict()
        d["caption"] = self.caption
        if self.source_event is not None:
            d["source_event"] = self.source_event.value
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Scene":
        photo_slot = d.get("photo_slot")
        source_event = d.get("source_event")
        return cls(
            layout=SceneLayout(d["layout"]),
            photo_slot=PhotoSlot.from_dict(photo_slot) if photo_slot else None,
            caption=d["caption"],
            source_event=SourceEventKind(source_event) if source_event else None,
        )


@dataclass(frozen=True, slots=True)
class Cover:
    """표지. subtitle 기본형은 자리표시자 `{region} · {start_date}~{end_date}` (FD §3)."""

    title: str
    subtitle: str
    photo_slot: PhotoSlot | None = None

    def to_dict(self) -> dict:
        d: dict = {"title": self.title, "subtitle": self.subtitle}
        if self.photo_slot is not None:
            d["photo_slot"] = self.photo_slot.to_dict()
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Cover":
        photo_slot = d.get("photo_slot")
        return cls(
            title=d["title"],
            subtitle=d["subtitle"],
            photo_slot=PhotoSlot.from_dict(photo_slot) if photo_slot else None,
        )


@dataclass(frozen=True, slots=True)
class ReflectionTemplate:
    """계약 §3.1 봉투 + §3.2 본문. 시각·순서·duration 필드 자체가 없다 (INV-2 비적용 구조화 + INV-3).

    to_dict()가 곧 경계 응답 본문 — 키는 계약 §3 JSON과 일치.
    template_id 생성 규칙은 FD 미결 #3 (요청 멱등키 파생안 — 경계 계약 협의).
    """

    template_id: str
    kind: ReflectionKind
    format: ReflectionFormat
    generated_at: datetime  # tz-aware
    is_fallback: bool
    cover: Cover
    scenes: tuple[Scene, ...]
    hashtags: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.generated_at.tzinfo is None:
            raise ValueError("generated_at는 tz-aware여야 함")

    def to_dict(self) -> dict:
        return {
            "template_id": self.template_id,
            "kind": self.kind.value,
            "format": self.format.value,
            "generated_at": to_iso(self.generated_at),
            "is_fallback": self.is_fallback,
            "cover": self.cover.to_dict(),
            "scenes": [s.to_dict() for s in self.scenes],
            "hashtags": list(self.hashtags),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ReflectionTemplate":
        return cls(
            template_id=d["template_id"],
            kind=ReflectionKind(d["kind"]),
            format=ReflectionFormat(d["format"]),
            generated_at=from_iso(d["generated_at"]),
            is_fallback=d["is_fallback"],
            cover=Cover.from_dict(d["cover"]),
            scenes=tuple(Scene.from_dict(s) for s in d["scenes"]),
            hashtags=tuple(d["hashtags"]),
        )


@dataclass(frozen=True, slots=True)
class TemplateViolation:
    """게이트 산출물 1건 — 빈 튜플 = 위반 0 (조기 종료 조건, 계약 §4)."""

    grade: ViolationGrade
    code: ViolationCode
    scene_index: int | None
    detail: str

    def __post_init__(self) -> None:
        if _GRADE_BY_CODE[self.code] is not self.grade:
            raise ValueError(
                f"코드-등급 불일치: {self.code.value}는 {_GRADE_BY_CODE[self.code].value}"
            )

    def to_dict(self) -> dict:
        return {
            "grade": self.grade.value,
            "code": self.code.value,
            "scene_index": self.scene_index,
            "detail": self.detail,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TemplateViolation":
        return cls(
            grade=ViolationGrade(d["grade"]),
            code=ViolationCode(d["code"]),
            scene_index=d["scene_index"],
            detail=d["detail"],
        )


@dataclass(frozen=True, slots=True)
class TemplateCandidate:
    """랭킹 입력 1건 — **하드 위반이 있어도 후보는 유지** (계약 §4 "드롭이 아니라 최선 채택").

    attempt는 생성 차수(1~3). 게이트는 차수를 모르므로 기본 1로 승격하고,
    N회 루프 소유자(agents/reflect composer, 후속)가 dataclasses.replace로 부여한다.
    """

    template: ReflectionTemplate
    violations: tuple[TemplateViolation, ...]
    attempt: int = 1

    def __post_init__(self) -> None:
        if not 1 <= self.attempt <= 3:
            raise ValueError(f"attempt는 1~3: {self.attempt}")

    def to_dict(self) -> dict:
        return {
            "template": self.template.to_dict(),
            "violations": [v.to_dict() for v in self.violations],
            "attempt": self.attempt,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TemplateCandidate":
        return cls(
            template=ReflectionTemplate.from_dict(d["template"]),
            violations=tuple(TemplateViolation.from_dict(v) for v in d["violations"]),
            attempt=d["attempt"],
        )


# ── Phase 2 — 멀티모달 입력 (FD domain-entities §4) ─────────
# **산출 타입은 하나도 늘지 않는다** — 달라지는 것은 장면 채움의 입력뿐이라
# Phase 1/2가 같은 출력 계약을 공유한다(FE 재협상 없는 드롭인 + INV-4 강등 계단의 전제).

PhotoId = NewType("PhotoId", str)


@dataclass(frozen=True, slots=True)
class PhotoRef:
    """사진 1장의 메타 + 접근 참조. 바이트는 여기 담지 않는다 —
    실제 이미지는 호출 직전에 LlmImagePart로 싣는다(포트 경계에서만 바이트 취급)."""

    photo_id: PhotoId
    visit_ref: VisitRef | None = None   # 어느 방문의 사진인지 (모르면 None)
    taken_at: datetime | None = None    # tz-aware
    gps: GeoPoint | None = None

    def __post_init__(self) -> None:
        if not str(self.photo_id).strip():
            raise ValueError("photo_id 비어 있음")
        if self.taken_at is not None and self.taken_at.tzinfo is None:
            raise ValueError("taken_at은 tz-aware여야 함")

    def to_dict(self) -> dict:
        return {
            "photo_id": str(self.photo_id),
            "visit_ref": self.visit_ref.to_dict() if self.visit_ref else None,
            "taken_at": to_iso(self.taken_at) if self.taken_at else None,
            "gps": self.gps.to_dict() if self.gps else None,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PhotoRef":
        ref, taken, gps = d.get("visit_ref"), d.get("taken_at"), d.get("gps")
        return cls(
            photo_id=PhotoId(d["photo_id"]),
            visit_ref=VisitRef.from_dict(ref) if ref else None,
            taken_at=from_iso(taken) if taken else None,
            gps=GeoPoint.from_dict(gps) if gps else None,
        )


@dataclass(frozen=True, slots=True)
class PhotoConsent:
    """사진의 외부 LLM 전송 동의 증빙. **AI는 동의를 판정하지 않는다** —
    백엔드 append-only 법무 로그(consent-log, DB 권한 수준 DELETE 불가)의
    레코드 참조를 받아 트레이스에 연결할 뿐이다."""

    granted: bool
    consent_ref: str
    granted_at: datetime

    def __post_init__(self) -> None:
        if self.granted_at.tzinfo is None:
            raise ValueError("granted_at은 tz-aware여야 함")

    def to_dict(self) -> dict:
        return {
            "granted": self.granted,
            "consent_ref": self.consent_ref,
            "granted_at": to_iso(self.granted_at),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PhotoConsent":
        return cls(
            granted=d["granted"],
            consent_ref=d["consent_ref"],
            granted_at=from_iso(d["granted_at"]),
        )


@dataclass(frozen=True, slots=True)
class VisionInput:
    """사진을 LLM에 보내기 위한 입력 묶음.

    **동의 게이트를 타입으로 강제한다** — 미동의(또는 증빙 참조 없음) 상태의
    VisionInput은 인스턴스로 존재할 수 없다. 덕분에 "동의 없이는 이미지가
    요청에 실리지 않는다"가 코드 경로가 아니라 타입 수준에서 성립한다
    (U1 '검증 위치' 규칙 동형 — VIS-P1의 전제).
    """

    photos: tuple[PhotoRef, ...]
    consent: PhotoConsent

    def __post_init__(self) -> None:
        if not self.consent.granted:
            raise ValueError("미동의 — 사진을 외부 LLM에 보낼 수 없다 (BR-U6R-09)")
        if not self.consent.consent_ref.strip():
            raise ValueError("consent_ref 없음 — 동의 증빙 참조가 필요하다")
        if not self.photos:
            raise ValueError("photos ≥ 1")

    def to_dict(self) -> dict:
        return {
            "photos": [p.to_dict() for p in self.photos],
            "consent": self.consent.to_dict(),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "VisionInput":
        return cls(
            photos=tuple(PhotoRef.from_dict(p) for p in d["photos"]),
            consent=PhotoConsent.from_dict(d["consent"]),
        )
