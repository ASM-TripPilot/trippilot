"""Overture 비식당 후보 중 **여행자가 갈 만한 곳만** LLM 으로 가려낸다.

## 왜 LLM 인가 — 규칙이 끝까지 못 간다

Overture 는 비식당을 `landmark_and_historical_building` 한 칸에 몰아넣어 보내므로, 우리
매핑은 그 칸을 SIGHT 로 받는다. 그 칸에 **아파트 단지가 섞여 있다.** 규칙으로 깎아 온 길이
이미 세 번 있었고 매번 한계를 만났다:

  · `_APARTMENT` 브랜드+접미어 (#1221·#1253) — `래미안 장전`·`롯데캐슬레전드` 처럼
    브랜드 뒤가 임의 고유명사면 접미어 목록으로 못 닫는다
  · 브랜드 **부분일치** — 기각. `자이` 가 `디자이너리 카페`·`오반자이 시젠`·
    `다이브자이언트제주센터` 에 걸려 공유본 23곳이 죽는다 (2026-10-14 실측)
  · `_NON_TRAVEL` 관리주체·공공안전 — 채택했지만 걸리는 건 조직명이 붙은 것뿐이다

남은 것은 이름만으로 **사람도 못 가르는** 모양이다 — `센텀마리나파크`·`위파크제주`·
`해운대 센텀시티 월드마크` 가 공원인지 주거단지인지는 이름이 말해 주지 않는다. 여기가
LLM 이 규칙보다 나은 자리다(`classify_localdata_etc.py` 와 같은 판단).

## 산출은 판정 파일이다

`data/overture_nonfood_verdicts.json` — 그 자체로는 아무 데도 안 들어간다. 문서를 짓는
쪽이 이 파일을 읽어 accept 된 것만 싣는다. 재수집 때 LLM 을 다시 태우지 않으려고 굳힌다.

    cd ai
    # 기본 모델이 claude-* 라 **provider 를 함께 넘긴다** — 안 넘기면 `_build_adapter` 가
    # LLM_PROVIDER 기본값(openai→Azure)으로 가고 Azure 에 그 배포가 없어 404 다(실제로 겪었다).
    LLM_PROVIDER=anthropic uv run --env-file ../../.env \
        python scripts/classify/classify_overture_nonfood.py <후보.json>
    … --dry-run   # 대상만 세고 LLM 을 안 부른다
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI))
sys.path.insert(0, str(_AI / "src"))
sys.path.insert(0, str(_AI / "scripts" / "smoke"))  # smoke_llm

from trippilot.domain.prompt import PromptRef  # noqa: E402
from trippilot.ports.llm_port import LlmRequest  # noqa: E402

_OUT = _AI / "data" / "overture_nonfood_verdicts.json"
# 프롬프트 판본. **올리면 기존 판정을 다시 묻는다** — 기준이 바뀌었으니 캐시는 무효다.
# v2(2026-10-14): "분류가 맞는가"를 기준 ②로 추가. v1 은 "가 볼 곳인가"만 물었다.
PROMPT_VERSION = "2"

# 프롬프트 — 기각 쪽으로 기운다. 넣어서 틀리면 사용자 일정에 아파트가 들어가고, 빼서
# 틀리면 후보가 한 곳 준다. `classify_localdata_etc.py` 와 같은 비대칭이다.
_PROMPT = """\
너는 여행 앱의 장소 데이터를 심사하는 사람이다. 아래는 지도 데이터에서 긁어온
한국의 장소들이다. 원본이 분류를 뭉뚱그려 보내서, **주거단지·사무실·관리조직이
관광지로 섞여 들어온다.** 상호와 주소만 보고 각 장소를 판정하라.

각 줄에는 우리가 붙인 분류(`cat`)가 함께 온다. **두 가지를 같이 본다.**

**기준 ① — "여행자가 일정에 넣고 찾아갈 만한 장소인가?"**

accept: 관광지·명소·사찰·공원·산·전망대·해변·박물관·미술관·갤러리·체험시설·
        수목원·시장·백화점처럼 **외부인이 찾아가는 곳**.
        규모가 작아도(동네 갤러리·공방 체험장) 손님을 받으면 accept.

**기준 ② — "우리가 붙인 분류(`cat`)가 그 장소에 맞는가?"**

원천 데이터가 분류를 틀리게 보내는 일이 있다. 분류가 **명백히 틀리면 reject** 하라 —
엉뚱한 분류로 들어가면 일정의 잘못된 자리에 놓인다. 분류의 뜻은 이렇다:

    NATURE    자연 — 산·오름·숲·해변·공원·폭포·습지
    SIGHT     명소 — 사찰·유적·전망대·마을·랜드마크
    CULTURE   문화시설 — 박물관·미술관·갤러리·전시관·공연장
    ACTIVITY  체험·레포츠 — 다이빙·클라이밍·체험장·테마파크
    SHOPPING  쇼핑 — 시장·백화점·공방 판매점·면세점
    NIGHT_VIEW 야경 — 야경을 보는 전망 지점

실측 오류 예 — 전부 기준 ②로 reject 해야 한다:

    VR 오락실이 NATURE 로 왔다 (원천이 `park` 로 분류)
    건물 5층 해수온천이 NATURE 로 왔다
    골프장이 NATURE 로 왔다 (이용객만 들어간다 — 기준 ①로도 reject)
    문구점이 SIGHT 로 왔다

**애매하면 reject** 가 정답이다. 분류를 고쳐 주려 하지 말고 기각하라 — 우리가 다시 본다.

reject: 아래 중 하나라도 해당하면 기각한다.
  - **아파트·주거단지·오피스텔·주상복합·타운하우스·빌라·개인주택**
      ※ 이것이 이 작업의 주된 목적이다. `○○파크`·`○○시티`·`○○포레`·`○○마린`·
        `○○월드마크` 처럼 이름만 보면 공원·시설 같지만 실제로는 아파트 브랜드인
        것이 많다. 주소가 동·번지로만 끝나고 상호가 단지명처럼 보이면 의심하라.
  - 관리사무소·입주자대표회의·관리단·자치관리위원회
  - 회사·사무실·공장·창고·법인 본사, 소방서·경찰서·주민센터 등 관공서
  - 종교단체의 사무소·연수원·문화회관 (**사찰·성당·교회 건물 자체는 accept**)
  - 도로·교차로·버스정류장·주차장·지하상가 통로 같은 통과 지점
  - 전국 체인 소매점의 한 지점(편의점·화장품·문구 체인 등)
  - 상호만으로는 무엇인지 판단이 서지 않는 것 (**애매하면 반드시 reject**)

**중요**: 확신이 서는 것만 accept 하라. 애매하면 reject 가 정답이다.
모르는 상호를 관광지일 것이라고 추측하지 마라.

각 줄에 대해 아래 형식의 JSON 객체 하나씩, 입력과 같은 순서로, 한 줄에 하나씩 출력하라.
설명·머리말·코드블록 표시를 붙이지 마라.

{{"ref": "<입력의 ref 그대로>", "verdict": "accept"|"reject", "guess": "<추정 정체 2~8자>", "why": "<15자 이내 사유>"}}

입력:
{rows}
"""


def _rows(doc: dict) -> list[dict]:
    """제안 문서 → LLM 에 보낼 줄.

    ref 는 Overture 원본 id — 제안 문서에서는 `content_id`(백엔드 유니크 키
    `(source, content_id)` 의 그 칸), 중간 수집 파일에서는 `overture_id` 다. 둘 다 받는다.
    """
    out = []
    for p in doc.get("proposals") or []:
        prov = p.get("provenance") or {}
        ref = prov.get("content_id") or prov.get("overture_id")
        if not ref:
            continue
        out.append({"ref": ref, "name": p["poi"]["name"],
                    "cat": p["poi"]["category"], "addr": prov.get("address") or ""})
    return out


def _ask(llm, model: str, batch: list[dict], timeout: float) -> dict[str, dict]:
    """한 배치 판정. 깨진 줄은 **조용히 버리지 않고** 비워 둔다 — 미판정은 미채택이다."""
    rows = "\n".join(json.dumps(r, ensure_ascii=False) for r in batch)
    res = llm.invoke(LlmRequest(
        model_id=model,
        prompt=_PROMPT.format(rows=rows),
        prompt_ref=PromptRef(prompt_id="scripts/classify_overture_nonfood.py",
                             version=PROMPT_VERSION, feature="OVERTURE_NONFOOD_TRIAGE"),
        max_tokens=180 * len(batch) + 500,
        timeout_sec=timeout,
    ))
    out: dict[str, dict] = {}
    for line in res.raw_text.splitlines():
        line = line.strip().strip("`")
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        ref, verdict = obj.get("ref"), obj.get("verdict")
        if isinstance(ref, str) and verdict in ("accept", "reject"):
            out[ref] = {"verdict": verdict,
                        "guess": str(obj.get("guess") or "")[:16],
                        "why": str(obj.get("why") or "")[:30]}
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Overture 비식당 후보 — LLM 판정")
    ap.add_argument("doc", type=Path, help="제안 문서 JSON (proposals[].provenance.overture_id)")
    ap.add_argument("--out", type=Path, default=_OUT)
    ap.add_argument("--batch", type=int, default=40)
    ap.add_argument("--model", default=os.environ.get("NONFOOD_TRIAGE_MODEL", "claude-sonnet-5"))
    ap.add_argument("--timeout", type=float, default=120.0)
    ap.add_argument("--dry-run", action="store_true", help="대상만 세고 LLM 을 안 부른다")
    args = ap.parse_args()

    if not args.doc.is_file():
        print(f"[비식당] 문서를 찾지 못했습니다: {args.doc}", file=sys.stderr)
        return 2
    targets = _rows(json.loads(args.doc.read_text(encoding="utf-8")))
    if not targets:
        print("[비식당] 대상 0곳", file=sys.stderr)
        return 0
    if args.dry_run:
        for r in targets[:30]:
            print(f"    {r['cat']:10} {r['name'][:30]:32} {r['addr'][:40]}")
        print(f"[비식당] --dry-run · 대상 {len(targets):,}곳 (LLM 미호출)", file=sys.stderr)
        return 0

    from smoke_llm import _build_adapter

    llm, default_model = _build_adapter()
    model = args.model or default_model

    # **이어가기** — 이미 판정된 것은 다시 묻지 않는다(크레딧이 중간에 떨어진 적이 있다).
    verdicts: dict[str, dict] = {}
    if args.out.exists():
        verdicts = dict(json.loads(args.out.read_text(encoding="utf-8")).get("verdicts") or {})
        stale = sum(1 for v in verdicts.values() if v.get("prompt") != PROMPT_VERSION)
        print(f"[비식당] 기존 판정 {len(verdicts):,}건 이어받음"
              + (f" (판본 {PROMPT_VERSION} 아님 {stale:,}건 — 다시 묻는다)" if stale else ""),
              file=sys.stderr)
    # **판본이 다르면 다시 묻는다** — 기준이 바뀐 판정을 캐시로 쓰면 조용히 옛 기준이 남는다
    todo = [r for r in targets
            if (verdicts.get(r["ref"]) or {}).get("prompt") != PROMPT_VERSION]
    print(f"[비식당] 판정 시작 — 남은 {len(todo):,}곳 / 배치 {args.batch} / 모델 {model}",
          file=sys.stderr)

    for i in range(0, len(todo), args.batch):
        batch = todo[i:i + args.batch]
        try:
            got = _ask(llm, model, batch, args.timeout)
        except Exception as e:                        # noqa: BLE001
            print(f"[비식당] 배치 {i // args.batch + 1} 실패: {e}", file=sys.stderr)
            continue
        missing = [r["ref"] for r in batch if r["ref"] not in got]
        if missing:
            print(f"[비식당] 배치 {i // args.batch + 1} 미판정 {len(missing)}곳", file=sys.stderr)
        for ref, v in got.items():
            verdicts[ref] = {**v, "model": model, "prompt": PROMPT_VERSION}
        args.out.write_text(json.dumps(
            {"generated_at": datetime.now(UTC).isoformat(), "verdicts": verdicts},
            ensure_ascii=False, indent=2), encoding="utf-8")
        acc = sum(1 for v in verdicts.values() if v["verdict"] == "accept")
        print(f"[비식당] {min(i + args.batch, len(todo)):,}/{len(todo):,} · "
              f"누적 accept {acc:,}", file=sys.stderr)

    cur = {r["ref"] for r in targets}
    mine = {k: v for k, v in verdicts.items() if k in cur}
    acc = [k for k, v in mine.items() if v["verdict"] == "accept"]
    print(f"\n[비식당] 대상 {len(cur):,} · 판정 {len(mine):,} · accept {len(acc):,} "
          f"· reject {len(mine) - len(acc):,} · 미판정 {len(cur) - len(mine):,}", file=sys.stderr)
    print(f"[비식당] 대상밖 옛판정 {len(verdicts) - len(mine):,}건은 파일에 남긴다", file=sys.stderr)
    print("[비식당] 기각 사유:", dict(Counter(
        v["guess"] for v in mine.values() if v["verdict"] == "reject").most_common(12)),
        file=sys.stderr)
    print(f"[비식당] → {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
