"""CachingEmbedding — 같은 텍스트를 두 번 임베딩하지 않는 EmbeddingPort 래퍼.

## 왜 있나

요청 경로는 임베딩을 **직렬 3회** 부른다(SCHEDULE·SITUATION·PERSONA). 그중 상황
KB·페르소나 KB 질의는 `TriggerKind` 4종 × `_REASON_KO` 7종 = **28가지 닫힌 집합**이라
같은 문자열이 프로세스 수명 내내 반복된다([[임베딩-사이징-근거]] §설계 근거). 열린
질의는 자유 입력(`match_free_text`)과 일정 KB 뿐이다. 즉 호출의 상당수가 **이미 답을
아는 질문**이고, 그때마다 HTTP 왕복과 CPU encode 를 다시 치른다.

## 키는 정확일치다 — 유사도 캐시가 아니다

세만틱 캐시를 여기 넣으면 안 된다. 적재된 벡터 공간과 다른 값을 돌려주는 순간
검색이 조용히 엉터리가 되는데, 차원이 같으면 어떤 검사도 이걸 못 잡는다(BR-AF-09 도
길이만 본다). 유사도 재사용이 값을 하는 자리는 **출력이 닫힌 키인 경로**(자유 입력 →
지시 키)이지 벡터 자체가 아니다.

## 한도

자유 입력은 무한하므로 LRU 로 자른다. 기본 2048 개 × 1024 차원 float ≈ 16 MB 수준이라
임베딩 서비스 상주(4.2 GiB)에 비하면 무시할 수 있다. Redis 를 두지 않는 이유는
파드가 1개이기 때문이다 — 늘릴 근거가 생기면 그때 공유 저장소를 판단한다.

실패는 캐시하지 않는다. 일시 장애를 굳히면 프로세스를 재시작해야 풀린다.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Sequence

_DEFAULT_MAXSIZE = 2048


class CachingEmbedding:
    """EmbeddingPort 를 감싸 텍스트→벡터를 LRU 로 기억한다.

    `dim`·`model_id` 는 안쪽 값을 그대로 노출한다 — `model_id` 는 collection 이름에
    들어가므로(TRIP-519) 래퍼가 가리면 적재와 질의가 다른 collection 을 본다.
    """

    def __init__(self, inner, maxsize: int = _DEFAULT_MAXSIZE) -> None:
        if maxsize < 1:
            raise ValueError("maxsize 는 1 이상 — 0 이면 캐시가 아니라 버그다")
        self._inner = inner
        self._maxsize = maxsize
        self._entries: OrderedDict[str, tuple[float, ...]] = OrderedDict()

    @property
    def inner(self):
        """감싼 EmbeddingPort — 배선 테스트가 provider 분기를 계속 단언하기 위한 창."""
        return self._inner

    @property
    def dim(self) -> int:
        return self._inner.dim

    @property
    def model_id(self) -> str:
        return self._inner.model_id

    def embed(self, text: str) -> tuple[float, ...]:
        hit = self._get(text)
        if hit is not None:
            return hit
        vector = self._inner.embed(text)
        self._put(text, vector)
        return vector

    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        missing = [text for text in dict.fromkeys(texts) if self._get(text) is None]
        if missing:
            for text, vector in zip(missing, self._inner.embed_batch(missing)):
                self._put(text, vector)
        return tuple(self._get(text) for text in texts)  # type: ignore[misc]

    def _get(self, text: str) -> tuple[float, ...] | None:
        vector = self._entries.get(text)
        if vector is not None:
            self._entries.move_to_end(text)
        return vector

    def _put(self, text: str, vector: tuple[float, ...]) -> None:
        self._entries[text] = vector
        self._entries.move_to_end(text)
        while len(self._entries) > self._maxsize:
            self._entries.popitem(last=False)
