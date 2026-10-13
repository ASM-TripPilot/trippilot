"""임베딩 백엔드 A/B 의 **동등성 게이트 상수 한 벌** (BR-MLO-05).

측정 하네스가 둘이다 — 인프로세스(`measure_triton_embedding.py`)와 컨테이너
(`measure_embedding_container.py`). 둘이 같은 기준으로 판정해야 하므로 상수를
여기 한 곳에 둔다. **복사하면 한쪽만 느슨해진다.**

무거운 것을 임포트하지 않는다. 컨테이너 쪽 하네스는 HTTP 클라이언트일 뿐인데,
상수를 인프로세스 하네스에서 가져오면 `torch`·`sentence-transformers` 가 따라
들어온다(프로젝트 의존성도 아니다).
"""

from __future__ import annotations

# PlanB 상황 KB 검색이 실제로 쓰는 질의 묶음. 순위 비교의 표본이고, 늘리거나 줄이면
# 과거 측정과 비교가 끊긴다.
QUERIES = (
    "WEATHER 날씨 악화 상황",
    "CLOSURE 휴무·폐점 상황",
    "DELAY 지연 상황",
    "MANUAL 예약 취소 상황",
    "MANUAL 피로 상황",
    "MANUAL 사용자 요청 교체 상황",
)

TOP_K = 4  # kb_retrieval.DEFAULT_TOP_K

# 채택 전제. 벡터가 다르면 지연 이득은 의미가 없다 — 차원이 같아 어떤 검사도
# 조용한 어긋남을 못 잡기 때문이다(mean 풀링으로 잘못 넣으면 코사인 0.71).
COSINE_FLOOR = 0.9999
