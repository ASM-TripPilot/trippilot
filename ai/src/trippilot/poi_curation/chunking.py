"""KB-5 장소 지식 청킹 — 본문 전문(`place_corpus_*.jsonl.gz`)을 문장 단위 조각으로 나눈다.

**왜 청킹하나.** 종전 KB-5 는 위키 **도입부** 한 덩어리를 문서 하나로 넣고, LLM 에는 그 앞
160자만 보였다. 그래서 (1) 본문의 시설·관람·교통 같은 상황 근거는 아예 수집되지 않았고 (2) 검색은
문서 전체로 고르는데 모델은 앞부분만 읽어, 고른 이유와 보이는 글이 달랐다. 조각으로 나누면
**질의에 맞는 조각**을 그대로 보여 줄 수 있다 — 검색 근거 = 모델이 읽는 글.

규칙(전부 결정론 — 같은 원천이면 같은 조각·같은 id):
- 경계는 **문장**이다. 문장 중간을 자르면 조각 하나가 반쪽 사실을 들고 검색된다.
- 조각은 `TARGET_CHARS` 근처까지 문장을 채우고, **같은 절 안에서** 앞 조각의 마지막 문장을
  다음 조각 첫 문장으로 겹친다(`OVERLAP_SENTENCES`) — 경계에 걸친 사실이 양쪽 어디서도 반쪽이 안 되게.
- 조각 앞에 **절 제목**을 붙인다(`"이용 안내: …"`). 짧은 조각은 무엇에 대한 문장인지 잃기 쉽고,
  제목이 그걸 되살린다. 그 문자열이 임베딩 입력이자 모델이 읽는 글이다.
- 한 문서는 `MAX_CHUNKS_PER_DOC` 까지 — 원문 순서(도입부 → 본문)로 앞에서부터. 검색이 조각 id 를
  이 범위로 펼쳐 찾으므로(`chunk_ids`) **두 곳이 같은 상수를 쓴다.**
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence

from trippilot.domain.kb import KbDocument, KbKind
from trippilot.poi_curation.place_docs import MIN_DOC_CHARS

# 조각 길이. 표시 상한(`place_knowledge.MAX_DOC_CHARS`) 안에 조각 하나가 통째로 들어가게
# 잡는다 — 맞은 조각을 다시 자르면 청킹한 의미가 없다. 임베딩 서비스의 최장 문서 문제
# (place_docs.MAX_TEXT_CHARS 주석)도 이 길이면 생기지 않는다.
TARGET_CHARS = 200
MAX_CHARS = 280
OVERLAP_SENTENCES = 1
MAX_CHUNKS_PER_DOC = 40

# 문장 끝: 마침표·물음표·느낌표(+닫는 따옴표·괄호) 뒤 공백. "3.5km" 처럼 공백 없는 점은 안 끊는다.
_SENTENCE_END = re.compile(r"(?<=[.!?。])[\"'”’)\]]*\s+")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_END.split(" ".join(text.split())) if s.strip()]


def _hard_split(sentence: str) -> list[str]:
    """`MAX_CHARS` 를 넘는 한 문장 — 공백에서 자른다(목록·표가 문장 부호 없이 이어진 경우)."""
    out, cur = [], ""
    for word in sentence.split(" "):
        if cur and len(cur) + 1 + len(word) > MAX_CHARS:
            out.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}" if cur else word
    if cur:
        out.append(cur)
    return out


def chunk_section(text: str) -> list[str]:
    """절 본문 → 조각 본문들(제목 없이). 문장 경계로 채우고 마지막 문장을 겹친다."""
    sentences = [p for s in split_sentences(text) for p in (_hard_split(s) if len(s) > MAX_CHARS else [s])]
    chunks: list[str] = []
    cur: list[str] = []
    for s in sentences:
        if cur and len(" ".join([*cur, s])) > TARGET_CHARS:
            chunks.append(" ".join(cur))
            cur = cur[-OVERLAP_SENTENCES:] if OVERLAP_SENTENCES else []
            if len(" ".join([*cur, s])) > MAX_CHARS:
                cur = []  # 겹친 문장 + 새 문장이 상한을 넘으면 겹침을 포기한다
        cur.append(s)
    if cur and (not chunks or " ".join(cur) != chunks[-1]):
        tail = " ".join(cur)
        # 겹침만 남은 꼬리(새 문장 없음)는 앞 조각과 같은 내용이라 버린다
        if not (chunks and len(cur) <= OVERLAP_SENTENCES and chunks[-1].endswith(tail)):
            chunks.append(tail)
    return [c for c in chunks if len(c) >= MIN_DOC_CHARS]


def chunk_id(base_doc_id: str, index: int) -> str:
    return f"{base_doc_id}#{index}"


def chunk_ids(base_doc_id: str) -> tuple[str, ...]:
    """검색이 쓰는 조각 id 범위 — 적재 상한과 같은 상수로 펼친다."""
    return tuple(chunk_id(base_doc_id, i) for i in range(MAX_CHUNKS_PER_DOC))


def chunk_document(row: Mapping) -> tuple[KbDocument, ...]:
    """원천 한 건(`{doc_id, poi_ref, sections:[{heading,text}], ...}`) → 조각 문서들."""
    base = row["doc_id"]
    source = base.split(":", 1)[0]
    meta = {k: row[k] for k in ("title", "url", "license") if row.get(k)}
    docs: list[KbDocument] = []
    for section in row.get("sections") or ():
        heading = (section.get("heading") or "").strip()
        for body in chunk_section(section.get("text") or ""):
            if len(docs) >= MAX_CHUNKS_PER_DOC:
                return tuple(docs)
            docs.append(KbDocument(
                kb=KbKind.POI_DESC,
                doc_id=chunk_id(base, len(docs)),
                text=f"{heading}: {body}" if heading else body,
                poi_ref=row["poi_ref"],
                metadata={**meta, "source": source, "section": heading, "chunk": len(docs)},
            ))
    return tuple(docs)


def chunk_corpus(rows: Iterable[Mapping]) -> tuple[KbDocument, ...]:
    return tuple(d for row in rows for d in chunk_document(row))


def base_ids(docs: Sequence[KbDocument]) -> frozenset[str]:
    """조각들의 원문 id — 적재가 같은 id 로 남은 **청킹 전 통문서** 행을 지울 때 쓴다."""
    return frozenset(d.doc_id.split("#", 1)[0] for d in docs)
