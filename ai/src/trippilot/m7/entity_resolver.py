"""EntityResolver — 결정론 fuzzy match (AI-D04, ai-data-design §8).

"성심땅" → "성심당": 한글은 오타가 자모 단위로 나므로 음절을 자모로 분해해
Levenshtein을 계산한다. LLM 관여 0 — 완전 결정론 (RES-P1).
조용히 고치지 않는다: AUTO/CONFIRM/UNRESOLVED 3단 판정 (임계는 remote config).
"""

from __future__ import annotations

import unicodedata
from typing import Sequence

from trippilot.domain.m7 import EntityMatch, MatchDecision
from trippilot.domain.poi import Poi
from trippilot.m7.config import M7Config

_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
_JONG = ("", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ",
         "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ",
         "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ")


def _normalize(s: str) -> str:
    return "".join(unicodedata.normalize("NFC", s).casefold().split())


def _to_jamo(s: str) -> str:
    out: list[str] = []
    for ch in s:
        code = ord(ch)
        if 0xAC00 <= code <= 0xD7A3:  # 한글 음절 → 자모 분해
            idx = code - 0xAC00
            out.append(_CHO[idx // 588])
            out.append(_JUNG[(idx % 588) // 28])
            jong = _JONG[idx % 28]
            if jong:
                out.append(jong)
        else:
            out.append(ch)
    return "".join(out)


def _levenshtein(a: str, b: str) -> int:
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1,
                           prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def similarity(a: str, b: str) -> float:
    """자모 기반 유사도 0~1. 결정론."""
    ja, jb = _to_jamo(_normalize(a)), _to_jamo(_normalize(b))
    if not ja and not jb:
        return 1.0
    longest = max(len(ja), len(jb))
    return 1.0 - _levenshtein(ja, jb) / longest


def fuzzy_match(name: str, pois: Sequence[Poi], config: M7Config) -> EntityMatch:
    best_poi: Poi | None = None
    best_conf = 0.0
    # 결정론 순회: poi_id 오름차순 — 동률 시 앞선 id 유지
    for poi in sorted(pois, key=lambda p: str(p.poi_id)):
        conf = similarity(name, poi.name)
        if conf > best_conf:
            best_poi, best_conf = poi, conf

    if best_poi is None or best_conf < config.match_confirm:
        return EntityMatch(poi_id=None, matched_name=None,
                           confidence=best_conf, decision=MatchDecision.UNRESOLVED)
    decision = (MatchDecision.AUTO if best_conf >= config.match_auto
                else MatchDecision.CONFIRM)
    return EntityMatch(poi_id=best_poi.poi_id, matched_name=best_poi.name,
                       confidence=best_conf, decision=decision)
