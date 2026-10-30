"""인자 추출기 — 반증에서 나온 반례를 테스트로 굳힌 것 (`assistant-dialogue` FD §3).

종류마다 설계안을 세우고 렌즈 셋(오탐·누락·경계)으로 반증했고(2026-09-19), 반증자는 정규식을
실제로 실행해 반례를 찾았다. 그 목록이 아래 세 묶음이다.

**정밀도가 계약이다**(BR-DLG-08b). `_MUST_BE_NONE` 은 144건이고 하나라도 값이 나오면 실패한다 —
선택 인자에서 잘못 뽑으면 처리자가 **사용자가 말하지 않은 조건**으로 일하기 때문이다.
반대로 `_KNOWN_GAPS` 는 "뽑히면 좋지만 못 뽑는" 것을 `None` 으로 고정해 둔 것이다. 재현율을
포기한 자리를 눈에 보이게 남기고, 나중에 되기 시작하면 테스트가 알려준다.
"""

from __future__ import annotations

import pytest

from trippilot.domain.common import BudgetLevel, TransportMode
from trippilot.domain.dialogue import ARGUMENT_TABLE, ArgumentKind, specs_of
from trippilot.domain.edit import EditOp
from trippilot.domain.intent import Intent
from trippilot.orchestrator.arguments import (
    NEEDS_LLM,
    extract_argument,
    extract_arguments,
    extract_enum,
    extract_kind,
)

# 뽑혀야 하고 실제로 뽑히는 것
_MUST_EXTRACT = [
    ("DATE", '내일 경주 날씨 어때?', '내일'),
    ("DATE", '모레 강릉 춥대?', '모레'),
    ("DATE", '어제 다녀온 곳들로 회고 써줘', '어제'),
    ("DATE", '내일모레 강릉 가는데 일정 짜줘', '내일모레'),
    ("DATE", '낼 아침 일정 알려줘', '낼'),
    ("DATE", '오늘 저녁 뭐 먹지', '오늘'),
    ("DATE", '이번 주 토요일 비 예보 있어?', '이번 주 토요일'),
    ("DATE", '이번주토요일에 비 와?', '이번주토요일'),
    ("DATE", '다음 주 화요일에 뭐 하기로 했더라', '다음 주 화요일'),
    ("DATE", '담주 금욜 일정 보여줘', '담주 금욜'),
    ("DATE", '국립중앙박물관 월요일에 쉬어?', '월요일'),
    ("DATE", '9월 20일에 출발하는 일정 짜줘', '9월 20일'),
    ("DATE", '2026년 9월 20일 날씨 알려줘', '2026년 9월 20일'),
    ("DATE", '9/20 비 온대?', '9/20'),
    ("DATE", '다음 달 3일에 가려고', '다음 달 3일'),
    ("DATE", '모레 계획 좀 보여줄래', '모레'),
    ("DATE_RANGE", '여수 3박 4일 일정 짜줘', '3박 4일'),
    ("DATE_RANGE", '부산 2박3일로 계획 좀 세워줘', '2박3일'),
    ("DATE_RANGE", '전주 당일치기 코스 추천해줄 수 있어?', '당일치기'),
    ("DATE_RANGE", '20일부터 23일까지 제주 일정 만들어줘', '20일부터 23일까지'),
    ("DATE_RANGE", '9월 20일부터 9월 23일까지 여행 계획 짜줘', '9월 20일부터 9월 23일까지'),
    ("DATE_RANGE", '10/3~10/5 일정 부탁해', '10/3~10/5'),
    ("DATE_RANGE", '낼부터 모레까지 서울 일정 만들어줘', '낼부터 모레까지'),
    ("DATE_RANGE", '금요일부터 일요일까지 부산 일정 짜줘', '금요일부터 일요일까지'),
    ("DATE_RANGE", '경주 나흘 정도 돌 계획 세워줘', '나흘 정도'),
    ("DATE_RANGE", '부산 가서 이틀 자고 오는데 어디어디 돌면 좋을지 짜줘', '이틀'),
    ("DATE_RANGE", '강릉 쪽으로 하룻밤 자는 여행 가려는데 어떻게 돌면 좋을까', '하룻밤'),
    ("DATE_RANGE", '부모님 모시고 경주 3일 가는데 무리 없게 계획 세워줘', '3일'),
    ("DATE_RANGE", '여수까지 2박3일 다녀올 코스 짜줘', '2박3일'),
    ("DATE_RANGE", '삼일 동안 다닐 코스 만들어줘', '삼일'),
    ("DATE_RANGE", '무박 2일로 다녀올 만한 곳 짜줘', '무박 2일'),
    ("DATE_RANGE", '2주 동안 천천히 도는 계획 부탁해', '2주 동안'),
    ("DATE_RANGE", '열흘간 제주 일정 짜줘', '열흘간'),
    ("DATE_RANGE", '2026-09-20부터 2026-09-23까지 일정 만들어줘', '2026-09-20부터 2026-09-23까지'),
    ("ORDINAL", '3일 차 계획에 커피 마실 곳 하나 넣어주세요.', '3일 차'),
    ("ORDINAL", '둘째 날 오후에 서점 들르는 거 넣어줘', '둘째 날'),
    ("ORDINAL", '3일째 동선에 잠깐 들를 카페를 한 군데 포함시켜 줘.', '3일째'),
    ("ORDINAL", '셋째 날 일정 확인 좀', '셋째 날'),
    ("ORDINAL", '마지막 날 순서를 거꾸로 바꿔줄래', '마지막 날'),
    ("ORDINAL", '2일차에 뭐 있었지', '2일차'),
    ("ORDINAL", '여행 사흘째 되는 날 일정 보여줘', '사흘째'),
    ("ORDINAL", '세번째 코스 빼줘', '세번째 코스'),
    ("ORDINAL", '제3일차 일정 알려줘', '제3일차'),
    ("ORDINAL", '마지막 코스 빼줘', '마지막 코스'),
    ("ORDINAL", '둘째날으로 옮겨줘', '둘째날'),
    ("ORDINAL", '삼일째 저녁에 뭐 하지', '삼일째'),
    ("ORDINAL", '막날 공항 몇 시야', '막날'),
    ("ORDINAL", '10일차 일정 보여줘', '10일차'),
    ("ORDINAL", '첫째 날 일정', '첫째 날'),
    ("ORDINAL", '열두 번째 장소', '열두 번째 장소'),
    ("COUNT", '이 두 곳 순서 바꿔줄래?', '두 곳'),
    ("COUNT", '우리 이번에 총 몇 군데 갔어?', '몇 군데'),
    ("COUNT", '서너 군데 추천해줘', '서너 군데'),
    ("COUNT", '한 30곳 정도 뽑아줘', '30곳'),
    ("COUNT", '스무 곳 넘게 다녔어', '스무 곳'),
]

# **뽑히면 안 되는 것** — 정밀도 계약. 설계자가 든 거부 예시 + 반증에서 나온 오탐·경계 반례
_MUST_BE_NONE = [
    ("DATE", '3박 4일 동안 뭐 했는지 한 장으로 요약해줘'),
    ("DATE", '2박3일 코스로 부탁해'),
    ("DATE", '부모님 모시고 경주 3일 가는데 무리 없게 계획 세워줘'),
    ("DATE", '부산 가서 이틀 자고 오는데 어디어디 돌면 좋을지 짜줘'),
    ("DATE", '10일간 여행할 거야'),
    ("DATE", '전주 당일치기 코스 추천해줄 수 있어?'),
    ("DATE", '둘째 날 오후에 서점 들르는 거 넣어줘'),
    ("DATE", '셋째 날 일정 확인 좀'),
    ("DATE", '3일차 일정 알려줘'),
    ("DATE", '마지막 날 순서를 거꾸로 바꿔줄래'),
    ("DATE", '저녁 식사 시간을 7시로 미뤄줘'),
    ("DATE", '성산일출봉 몇 시까지 열어?'),
    ("DATE", '여수까지 얼마나 걸려?'),
    ("DATE", '해운대에서 광안리까지 몇 킬로야?'),
    ("DATE", '이 카페 대신 아까 본 빵집으로 바꿔 넣어줘'),
    ("DATE", '돈은 내가 낼게'),
    ("DATE", '그제서야 알았어'),
    ("DATE", '지하철이 멈췄대, 지금부터 일정 다시 잡아줄래'),
    ("DATE", '주차비 1일에 만원이래'),
    ("DATE", '여행 기간은 2일에서 3일 정도로 봐줘'),
    ("DATE", '연차가 3일까지밖에 안 나와서 일정 줄여줘'),
    ("DATE", '그제야 예약이 취소된 걸 알았어'),
    ("DATE", '숙소비는 카드로 낼 계획이야'),
    ("DATE", '비 오는 3일 내내 실내 코스로 바꿔줘'),
    ("DATE", '3박  4일에 맞춰서 짜줘'),
    ("DATE", '매주 화요일에 쉬는 카페 말고 다른 데 알려줘'),
    ("DATE", '3일에 한 번은 쉬는 일정으로 짜줘'),
    ("DATE", '나 그제야 예약한 거 확인했어'),
    ("DATE", '숙소비는 내가 낼 계획이야'),
    ("DATE", '우리 아기 100일에 제주 갈 수 있을까?'),
    ("DATE", '평점 4.5/5 이상인 숙소만 보여줘'),
    ("DATE", '다담주 금욜에 시간 돼?'),
    ("DATE", '다다음 달 3일에 제주 가려고'),
    ("DATE", '9월 1, 2일에 서울 가는데 코스 짜줘'),
    ("DATE", '9월 20일부터 22일까지 일정 짜줘'),
    ("DATE_RANGE", "9월 20일에 출발해 (DATE — 하루 지정. 월 후방탐색이 '20일' 절취를 막는다)"),
    ("DATE_RANGE", "2일차 점심 바꿔줘 (ORDINAL — 'N일차'는 며칠째 날이지 기간이 아니다)"),
    ("DATE_RANGE", "2일 차 점심 바꿔줘 (ORDINAL — 띄어쓴 변이도 같이 막아야 한다. 초안이 여기서 '2일'을 뱉었다)"),
    ("DATE_RANGE", '이틀째 아침 일정 알려줘 (ORDINAL — 고유어 기간 명사 + 째)'),
    ("DATE_RANGE", '둘째 날 일정 보여줘 (ORDINAL)'),
    ("DATE_RANGE", '세 번째 장소 알려줘 (ORDINAL)'),
    ("DATE_RANGE", '두 곳만 넣어줘 (COUNT)'),
    ("DATE_RANGE", '3개만 추천해줘 (COUNT — 단위가 개라 기간 단위 목록에 없다)'),
    ("DATE_RANGE", '3일 전에 갔던 데 다시 보여줘 (상대 시점 — 기간이 아니다)'),
    ("DATE_RANGE", '다음 주에 제주 갈 건데 코스 짜줘 (DATE 성격의 출발 시점 — 기간 길이 정보가 없다. 일부러 안 뽑는다)'),
    ("DATE_RANGE", '며칠 갈지 아직 모르겠어 (미지정 — 값이 없으므로 None, missing 으로 되묻기)'),
    ("DATE_RANGE", "하루 마무리로 오늘을 되돌아보는 글 부탁해 (회고 관용구의 '하루' — 기간 아님)"),
    ("DATE_RANGE", '아침부터 저녁까지 빡빡하게 짜줘 (시간대 범위 — 날짜 범위 아님)'),
    ("DATE_RANGE", "지금부터 일정 다시 잡아줄래 (시점 — '부터'만 있고 날짜 토큰이 없다)"),
    ("DATE_RANGE", "경복궁에서 창덕궁까지 얼마나 걸려? (장소 범위 — '에서~까지'가 날짜가 아니다)"),
    ("DATE_RANGE", '한 시간 넘게 지체됐어, 남은 오후 일정 다시 맞춰줘 (시간 단위)'),
    ("DATE_RANGE", '삼일절에 문 여는 곳 알려줘 (고유명사 — 한자어 수사에 기간 표지를 요구해서 걸러진다)'),
    ("DATE_RANGE", "5만원짜리 코스로 짜줘 (금액 — '짜리'가 있어도 앞이 기간 단위가 아니다)"),
    ("DATE_RANGE", '3번 슬롯 지워줘 (SLOT_REF)'),
    ("DATE_RANGE", '이 박물관 대신 갈 만한 곳 있으면 하나만'),
    ("DATE_RANGE", '1달러가 몇 원이지'),
    ("DATE_RANGE", '요즘 기온이 35도에 육박한다는데 실내 위주로 짜줘'),
    ("DATE_RANGE", '결혼 2주년 기념으로 제주 일정 짜줘'),
    ("DATE_RANGE", '정선 5일장 서는 날 맞춰서 일정 짜줘'),
    ("DATE_RANGE", '정월대보름에 부산 갈 건데 코스 짜줘'),
    ("DATE_RANGE", '하루 동안의 여행 이야기를 일기처럼 정리해 주세요'),
    ("DATE_RANGE", '오늘 하루 여행했던 내용을 돌아보는 글로 정리해 주세요'),
    ("DATE_RANGE", '출발까지 3일 남았는데 일정 미리 짜줘'),
    ("DATE_RANGE", '20일에 출발하는데 코스 짜줘'),
    ("DATE_RANGE", '삼 박자 고루 갖춘 곳으로 추천해줘'),
    ("DATE_RANGE", '20~23일 제주 일정 짜줘'),
    ("DATE_RANGE", '경주 사나흘 정도 돌 코스 짜줘'),
    ("DATE_RANGE", '10/3~5 일정 짜줘'),
    ("DATE_RANGE", '9월 20~23일 제주 일정 짜줘'),
    ("DATE_RANGE", '9월 20일 토요일부터 22일 월요일까지 제주 일정 짜줘'),
    ("DATE_RANGE", '20일 오후부터 23일 오전까지 일정 짜줘'),
    ("DATE_RANGE", '원래 2박 3일이었는데 3박 4일로 늘려서 다시 짜줘'),
    ("ORDINAL", '3박 4일 동안 뭐 했는지 한 장으로 요약해줘'),
    ("ORDINAL", '부산 가서 이틀 자고 오는데 어디어디 돌면 좋을지 짜줘'),
    ("ORDINAL", '카페 한 군데만 넣어줘'),
    ("ORDINAL", '우리 이번에 총 몇 군데 갔어?'),
    ("ORDINAL", '저녁 식사 시간을 7시로 미뤄줘'),
    ("ORDINAL", '내일 경주 날씨 어때?'),
    ("ORDINAL", '다음 달 초에 속초 가는데 코스 좀 짜 줄래'),
    ("ORDINAL", '내일 차 막히려나'),
    ("ORDINAL", '3일 차이가 나는데'),
    ("ORDINAL", '3일치 도시락 싸'),
    ("ORDINAL", '둘째 주 수요일에 쉬어?'),
    ("ORDINAL", '막차 시간 언제야'),
    ("ORDINAL", '첫차 타고 갈까'),
    ("ORDINAL", '지하철 1번 출구에서 만나'),
    ("ORDINAL", '두 번 갔던 데야'),
    ("ORDINAL", '몇 번째로 가는 거야?'),
    ("ORDINAL", '회사일 차원에서'),
    ("ORDINAL", '마지막으로 하나만 물어볼게'),
    ("ORDINAL", '이튿날 뭐 하지'),
    ("ORDINAL", '둘째는 어디 갈까'),
    ("ORDINAL", '다음 달 두 번째 주말에 부산 가려고 하는데 코스 좀 짜줘'),
    ("ORDINAL", '제주도는 세 번째라 유명한 데 말고 로컬 위주로 짜줘'),
    ("ORDINAL", '숙소 앞 공사가 3일째라 너무 시끄러운데 다른 데 없어?'),
    ("ORDINAL", '몸살이 사흘째라 오늘 일정 좀 줄여줘'),
    ("ORDINAL", '두 번째 아이 데리고 가는 거라 유모차 들어가는 데로 짜줘'),
    ("ORDINAL", '다음 달 첫날 출발하는 걸로 짜줘'),
    ("ORDINAL", '부산에서 두 번째로 큰 시장 일정에 넣어줘'),
    ("ORDINAL", '지하철 나와서 두 번째 출구에서 만나기로 했어'),
    ("ORDINAL", '마지막 일정 변경이 언제였는지 알려줘'),
    ("ORDINAL", '2박 3일 차로 다녀올 만한 코스 짜줘'),
    ("ORDINAL", '제주 3일 차량 렌트해서 도는 코스로 짜줘'),
    ("ORDINAL", '여행 마지막 날짜가 언제였지'),
    ("ORDINAL", '첫 날짜를 하루만 미룰 수 있을까'),
    ("ORDINAL", '끝에서 두 번째 장소 빼줘 / 뒤에서 두 번째 코스 바꿔줘'),
    ("ORDINAL", '3일차 말고 4일차에 넣어줘'),
    ("ORDINAL", '2~3일차 일정 한번에 보여줘'),
    ("ORDINAL", '마지막 날짜 언제로 잡았지'),
    ("COUNT", '3박 4일 일정 짜줘'),
    ("COUNT", '부산 가서 이틀 자고 오는데 어디 돌면 좋을지 짜줘'),
    ("COUNT", '전주 당일치기 코스 추천해줄 수 있어?'),
    ("COUNT", '한 시간 넘게 지체됐어, 남은 오후 일정 다시 맞춰줘'),
    ("COUNT", '식사 시간을 한 시로 옮겨줘'),
    ("COUNT", '다섯 시에 만나자'),
    ("COUNT", '3개월 뒤에 갈 거야'),
    ("COUNT", '셋째 날 일정 보여줘'),
    ("COUNT", '첫 번째 장소랑 두 번째 장소 얼마나 떨어져 있어?'),
    ("COUNT", '다음 장소까지 몇 km 남았나요?'),
    ("COUNT", '지금 거기 기온 몇 도야?'),
    ("COUNT", '내일 강수 가능성 몇 퍼센트야?'),
    ("COUNT", '1달러가 몇 원이지'),
    ("COUNT", '갈 만한 곳 추천해줘'),
    ("COUNT", '비슷한 곳으로 다른 후보 좀 찾아주세요'),
    ("COUNT", '이번 여정에서 방문한 곳들을 한눈에 요약해줘'),
    ("COUNT", '이따 가기로 한 곳이 어디더라?'),
    ("COUNT", '여유롭게 둘러볼 대안 좀 찾아줘'),
    ("COUNT", '여기 처음인데 하나도 모르겠어'),
    ("COUNT", '가고 싶던 곳 하나도 못 갔네'),
    ("COUNT", '결국 한 곳도 못 갔어'),
    ("COUNT", '내일 아침 일찍 문 열 곳 추천해줘'),
    ("COUNT", '예약 한 곳이 어디였지?'),
    ("COUNT", '볼 만 한 곳 알려줘'),
    ("COUNT", '별점 4개 이상인 곳만 보여줘'),
    ("COUNT", '한 명당 얼마야?'),
    ("COUNT", '부탁 하나만 들어줄래?'),
    ("COUNT", '여러 가지로 고마웠어'),
    ("COUNT", '짐 캐리어 두 개 맡길 데 있어?'),
    ("COUNT", '비가 계속 오는데 하나도 못 돌았어'),
    ("COUNT", '이번엔 한 곳도 제대로 못 봤네'),
    ("COUNT", '한 두 곳만 빼줘'),
    ("COUNT", '4명이서 가는데 카페는 2곳만 넣어줘'),
    ("COUNT", '일정에서 한 두 곳만 빼줄래?'),
    ("COUNT", '이번에 열 몇 군데는 간 것 같은데'),
]

# 뽑히면 좋지만 지금은 못 뽑는 것 — 정밀도를 위해 포기한 재현율
_KNOWN_GAPS = [
    ("DATE", '글피까지 일정 보여줘', '글피'),
    ("DATE", '9월20일 부터 일정 짜줘', '9월20일'),
    ("DATE", '20일에 부산 갈 건데 코스 짜줘', '20일'),
    ("DATE", '오는 20일 일정 좀 보여줄래', '오는 20일'),
    ("DATE_RANGE", '이번 주말에 강릉 갈 건데 코스 짜줘', '이번 주말'),
    ("DATE_RANGE", '일주일 동안 국내로 도는 일정 짜줘', '일주일'),
    ("DATE_RANGE", '하루 동안 돌 수 있는 코스 알려줘', '하루'),
    ("DATE_RANGE", '일박이일로 다녀올 코스 만들어줘', '일박이일'),
    ("DATE_RANGE", '한 달 살기 일정 짜줘', '한 달'),
    ("DATE_RANGE", '담주 주말에 갈 만한 코스 짜줘', '담주 주말'),
    ("ORDINAL", '첫날 마지막 코스를 둘째 날 아침으로 옮겨줘', '첫날'),
    ("ORDINAL", '첫 번째 장소랑 두 번째 장소 얼마나 떨어져 있어?', '첫 번째'),
    ("ORDINAL", '2일 차와 3일 차 일정을 서로 맞바꿔 주세요', '2일 차'),
    ("ORDINAL", '둘째 날이랑 셋째 날 통째로 바꿔줘', '둘째 날'),
    ("COUNT", '카페 한 곳 더 추가해줘', '한 곳'),
    ("COUNT", '셋째 날 일정에 카페 한 군데 추가해줘', '한 군데'),
    ("COUNT", '맛집 다섯 곳만 골라줘', '다섯 곳'),
    ("COUNT", '일정에 3개만 넣어줘', '3개'),
    ("COUNT", '이번에 다녀온 장소가 총 몇 곳인지 알려줘', '몇 곳'),
    ("COUNT", '한두 곳만 빼줘', '한두 곳'),
    ("COUNT", '카페 한곳만 넣어줘', '한곳'),
    ("COUNT", '2~3곳 정도면 좋겠어', '2~3곳'),
    ("COUNT", '여긴 공사 중이래, 대신 갈 곳 하나 골라줘', '하나'),
    ("COUNT", '다음 코스 하나만 말해줘', '하나'),
    ("COUNT", '4명이서 가는데 일정 짜줘', '4명'),
    ("COUNT", '열다섯 곳이나 들렀네', '열다섯 곳'),
    ("COUNT", '일정에 식당 두세 개 넣어줘', '두세 개'),
]


@pytest.mark.parametrize("kind, text, expected", _MUST_EXTRACT)
def test_extracts_the_expected_span(kind: str, text: str, expected: str) -> None:
    assert extract_kind(text, ArgumentKind[kind]) == expected


@pytest.mark.parametrize("kind, text", _MUST_BE_NONE)
def test_never_extracts_from_these(kind: str, text: str) -> None:
    """**정밀도 계약** — 값이 나오면 처리자가 사용자가 말하지 않은 조건으로 일한다."""
    assert extract_kind(text, ArgumentKind[kind]) is None


@pytest.mark.parametrize("kind, text, would_be", _KNOWN_GAPS)
def test_known_recall_gaps_return_none_not_a_guess(kind: str, text: str, would_be: str) -> None:
    """포기한 재현율을 눈에 보이게 남긴다 — 되기 시작하면 이 테스트가 알려준다."""
    assert extract_kind(text, ArgumentKind[kind]) is None


def test_ambiguous_double_occurrence_yields_none() -> None:
    """같은 종류가 한 문장에 둘이면 어느 쪽이 인자인지 발화만으로는 모른다."""
    assert extract_kind("2일 차와 3일 차 일정을 서로 맞바꿔 주세요", ArgumentKind.ORDINAL) is None
    assert extract_kind("9월 20일이랑 10월 3일 중에 언제가 나아", ArgumentKind.DATE) is None


def test_kinds_without_rules_always_return_none() -> None:
    """규칙으로 못 뽑는 종류는 3차가 뽑는다 — 억지 정규식은 오탐을 만들어 더 나쁘다."""
    for kind in NEEDS_LLM:
        assert extract_kind("내일 경복궁 말고 다른 데 알려줘", kind) is None


# ── ENUM — 원문 조각이 아니라 정규 값을 돌려준다 ────────────────────────


def test_enum_maps_surface_form_to_the_canonical_value() -> None:
    ops = tuple(m.value for m in EditOp)
    assert extract_enum("셋째 날에 카페 한 곳 추가해줘", ops) == EditOp.ADD_SLOT.value
    assert extract_enum("이 장소 일정에서 삭제해줘", ops) == EditOp.REMOVE_SLOT.value
    assert extract_enum("점심을 1시로 늦춰줘", ops) == EditOp.MOVE_SLOT.value


def test_enum_returns_none_when_two_different_values_match() -> None:
    """"순서를 바꿔줘" 는 REORDER_DAY('순서')와 REPLACE_SLOT('바꿔')에 함께 걸린다.

    이럴 때 하나를 고르면 **반드시 틀린다** — 워커가 현재 일정을 보고 정하게 둔다.
    """
    ops = tuple(m.value for m in EditOp)
    assert extract_enum("둘째 날 순서를 바꿔줘", ops) is None


def test_enum_returns_none_for_vocabulary_that_is_not_a_type_yet() -> None:
    """`choices` 가 비면 코드에 enum 이 없다는 뜻이라 뽑을 근거가 없다 (PlanB reason)."""
    assert extract_enum("비 와서 다시 짜줘", ()) is None


def test_enum_reads_other_real_vocabularies() -> None:
    assert extract_enum("가성비 좋게 짜줘", tuple(m.value for m in BudgetLevel)) == BudgetLevel.LOW.value
    assert extract_enum("대중교통으로 다닐 거야", tuple(m.value for m in TransportMode)) == TransportMode.PUBLIC.value


# ── 표와의 결합 ─────────────────────────────────────────────────────────


def test_union_kinds_are_tried_in_table_order() -> None:
    """`day` 는 DATE → ORDINAL 순이다. 순서가 곧 우선순위다."""
    day = next(s for s in specs_of(Intent.EDIT_SCHEDULE) if s.name == "day")
    assert day.kinds == (ArgumentKind.DATE, ArgumentKind.ORDINAL)
    assert extract_argument("9월 20일 일정에 카페 넣어줘", day) == "9월 20일"
    assert extract_argument("둘째 날 일정에 카페 넣어줘", day) == "둘째 날"


def test_extract_arguments_skips_plural_arguments() -> None:
    """`multiple` 인자는 값 하나로 표현되지 않는다 — 반쪽만 넘기면 복수 사유가 잘린다."""
    filled = extract_arguments("비 와서 남은 일정 다시 짜줘", specs_of(Intent.REPLAN))
    assert "reason" not in filled  # REPLAN.reason 은 multiple 이다


def test_extract_arguments_never_raises_on_any_table_entry() -> None:
    """추출 실패가 라우팅을 죽이지 않는다 — 의도는 이미 정해졌고 인자만 빈다."""
    for intent, specs in ARGUMENT_TABLE.items():
        out = extract_arguments("아무 말이나 해 본다 ☃", specs)
        assert isinstance(out, dict), intent.value
        assert set(out) <= {s.name for s in specs}
