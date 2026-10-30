"""KB-5 장소 카드 — 우리가 가진 칸만으로 만든 한 줄 설명(2026-10-23 사용자 지시: "지금 있는 POI 전부에 문서를").

위키·관광공사 개요·웹 확인 사실이 없는 장소도 **무엇이 맞는지 아는 것만** 적은 문서를 갖게 한다. 칸 밖의 말은 한 글자도 만들지
않는다 — 모델이 기억으로 쓰면 사실 주장의 10~18%(동네 가게 구체 주장은 절반)가 틀린다(2026-10-23 실측).

싣는 것(공유본에서 온다):
- 관광공사 상세(detailIntro2)의 대표메뉴·취급메뉴·판매품목·주차·포장·반려동물·유모차·아이 시설
  ('0'·'없음' 같은 값은 "없다"가 아니라 "모른다"로 두고 빼고, 전화가 섞인 칸·`<br>` 은 버린다). 이 칸이 하나도 없으면 카드가 없다.
- 그 앞에 동네 — 주소의 시·도 줄임 + 시군구 + 읍·면·동

싣지 않는 것:
- 후보 줄에 이미 있는 칸 — 이름·종류·세분류·태그(`_category_label`)·영업시간·거리. 되풀이하면 토큰만 는다(2026-10-30 KB-5
  담당 세션 조건 · 리뷰 실측: 카드 글자의 42% 가 후보 줄 머리와 겹쳤다).
- 이름에서 읽은 요리 종류 — 낱말 사전 대조가 '우즈베이커리'를 인도 음식으로 읽는 꼴이 1,010곳(리뷰). 이름은 후보 줄에 있다.
- 인허가 연도 — 관리번호의 연도와 인허가일자 연도가 98~99% 만 맞고, 주인·상호가 바뀌어도 번호가 이어진다(치킨집에 1995년).
- 가까운 볼거리 이름 — 후보 밖 장소 이름이 이유 문장으로 새어 닫힌 집합 이름 검사(INV-1)를 연다.
- 시각·소요·가격·전화 — 출구 게이트가 이유를 통째로 비운다(INV-2·INV-3·연락처). 빌드가 소개 게이트(`clean_intro`)를 한 번 더 건다.
"""

from __future__ import annotations

import html
import re
from collections.abc import Mapping

_SIDO = {"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
         "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원", "충청북도": "충북",
         "충청남도": "충남", "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남", "전남광주통합특별시": "전남광주",
         "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주"}
_GU = re.compile(r"^[가-힣]+(?:시|군|구)$")
_UNIT = re.compile(r"^[가-힣][가-힣0-9]*(?:읍|면|동|가|리)$")  # '101동'·'A동' 은 건물 동 번호다
_PAREN = re.compile(r"\(([^(),]+?)(?:,[^)]*)?\)")
_TAG = re.compile(r"<[^>]+>")
_PHONEISH = re.compile(r"\d{2,4}\s?[-)]\s?\d{3,4}\s?-\s?\d{4}|☎|전화|문의")
_TIMEISH = re.compile(r"\d{1,2}\s?:\s?\d{2}|\d+\s?시간|\d+\s?분|\d+\s?시(?![간대])")  # 시각·소요 — 칸에 섞여 들어온다(INV-2·3)
_PRICEISH = re.compile(r"\d[\d,]*\s?원|\d{3,}")  # '8,000원' 과 단위 없는 '아메리카노 4500'
_FLAG_EMPTY = frozenset({"", "0", "-", "없음", "없습니다", "해당없음", "미정", "문의", "불가능여부확인", "확인필요"})
INTRO_FIELDS = (("firstmenu", "대표메뉴"), ("treatmenu", "메뉴"), ("saleitem", "판매"))
CARD_MAX_CHARS = 220


def _clean(raw: object) -> str:
    text = html.unescape(_TAG.sub(" ", re.sub(r"<br\s*/?>", ", ", str(raw or ""), flags=re.I)))
    return " ".join(text.split()).strip(" ,/·")


def _unit(word: str) -> bool:
    return bool(_UNIT.match(word)) and not word.endswith("상가")


def area(address: str, region: str) -> str:
    """'서울특별시 송파구 백제고분로 265, 1층 (삼전동)' → '서울 송파구 삼전동'. 모르는 칸은 뺀다.

    시군구는 주소에서 먼저 읽는다(공유본 region 칸이 주소와 다른 곳이 있다). 세종은 시군구가 없다 — 주소 둘째 낱말은 길 이름이다."""
    words = address.split()
    sido = _SIDO.get(words[0], "") if words else ""
    rest = words[1:] if sido else words
    gu = [w for w in rest[:2] if _GU.match(w)]
    if not gu and _GU.match(region or "") and sido != "세종":
        gu = [region]
    paren = next((m.group(1).strip() for m in _PAREN.finditer(address) if _unit(m.group(1).strip())), "")
    unit = paren or next((w for w in rest[len(gu):len(gu) + 3] if _unit(w)), "")
    return " ".join(x for x in (sido, *gu, unit) if x)


def intro_facts(detail: Mapping[str, object]) -> list[str]:
    out = []
    for field, label in INTRO_FIELDS:
        value = _clean(detail.get(field))
        if value and value not in _FLAG_EMPTY and not _PHONEISH.search(value) and not _TIMEISH.search(value) \
                and not _PRICEISH.search(value):
            items = list(dict.fromkeys(i.strip() for i in re.split(r"\s*[/,·]\s*", value) if i.strip()))[:3]
            out.append(f"{label} {'·'.join(items)}")
    parking = next((_clean(detail.get(k)) for k in ("parkingfood", "parking", "parkingculture", "parkingshopping",
                                                     "parkingleports") if _clean(detail.get(k))), "")
    if parking.startswith("가능") or parking in ("주차가능", "있음"):
        out.append("주차 가능")
    elif parking.startswith("불가"):
        out.append("주차 불가")
    if _clean(detail.get("packing")).startswith("가능"):  # '포장 불가능' 에도 '가능' 이 들어 있다
        out.append("포장 가능")
    if _clean(detail.get("chkpet")).startswith("가능"):
        out.append("반려동물 동반 가능")
    baby = _clean(detail.get("chkbabycarriage"))
    if baby.startswith(("가능", "대여")):
        out.append(f"유모차 {'대여' if baby.startswith('대여') else '가능'}")
    if _clean(detail.get("kidsfacility")) == "1":
        out.append("아이 놀이시설 있음")
    return out


def card_text(proposal: Mapping) -> str:
    """공유본 항목 하나 → 카드 한 줄(≤ CARD_MAX_CHARS). 상세 사실이 없으면 빈 문자열 — 동네만으로는 문서라 할 것이 없다."""
    prov = proposal.get("provenance") or {}
    facts = intro_facts(prov.get("detail") or {})
    if not facts:
        return ""
    where = area(str(prov.get("address") or ""), str(proposal.get("region") or ""))
    parts = [where, *facts] if where else facts
    text = ". ".join(parts) + "."
    while len(text) > CARD_MAX_CHARS and len(parts) > 1:
        parts.pop()  # 뒤쪽 덧붙임부터 덜어 낸다
        text = ". ".join(parts) + "."
    return text[:CARD_MAX_CHARS]
