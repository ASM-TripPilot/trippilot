"""U2 첫 절편 — OR-Tools day1 벤치마크 (미결 #3 판정, business-rules §6).

게이트: 후보 50에서 day1 배치 ≤ 3,000ms · 5,000 규모에서 회귀 없이 완료.
실행:  uv run python benchmarks/bench_ortools_day1.py

모델 (CP-SAT, day1 단일 일자):
  - 선택 visit[i] + 시작 start[i] + AddCircuit(방문 순서)
  - HC1·HC4: start 범위 = 영업시간 ∩ day window(09:00~21:00)
  - HC2: 연속 방문 간 이동시간(하버사인×1.3 / 20km/h ×1.5 + 버퍼15) 하한
  - HC3: 고정 블록은 visit=1 + start 고정
  - 목적: Σ 선호점수 최대화 (예산 소프트 가중은 후속 절편)
  - 결정론: random_seed 고정 · num_search_workers=1

설계 메모: 후보 > 60이면 점수 상위 60으로 프리필터 후 최적화
(이동 행렬 O(N²) 폭발 방지 — 구성 휴리스틱과 같은 취지의 어셈블리 전처리.
 하루 방문 슬롯은 물리적으로 ~8개라 상위 60이면 해 품질 손실 무시 가능).
"""

from __future__ import annotations

import math
import random
import time

from ortools.sat.python import cp_model

# ── 파라미터 (AI-D07·G106 확정값) ─────────────────────────────
DAY_START, DAY_END = 540, 1260  # 09:00 ~ 21:00 (분)
SPEED_KMPH, SAFETY, DETOUR, BUFFER_MIN = 20.0, 1.5, 1.3, 15  # PUBLIC 기준
TIME_LIMIT_S = 2.8  # 게이트 3.0s 안쪽 (반환 오버헤드 마진)
PREFILTER_TOP_K = 60
SEED = 42
ANCHOR = (37.751, 128.876)  # 강릉 인근 가상 앵커


def haversine_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def travel_min(a, b) -> int:
    dist = haversine_km(a, b) * DETOUR
    return int(round(dist / SPEED_KMPH * 60 * SAFETY)) + BUFFER_MIN


def gen_candidates(n: int, seed: int):
    """합성 후보: 좌표(앵커 ±0.05도)·영업시간·체류·점수 — 시드 고정 결정론."""
    rng = random.Random(seed)
    out = []
    for i in range(n):
        coord = (ANCHOR[0] + rng.uniform(-0.05, 0.05),
                 ANCHOR[1] + rng.uniform(-0.05, 0.05))
        open_m = rng.choice([480, 540, 600, 660])
        close_m = rng.choice([1080, 1140, 1200, 1320])
        out.append({
            "id": f"p{i}", "coord": coord,
            "open": open_m, "close": close_m,
            "dur": rng.randint(40, 90),
            "score": rng.random(),
        })
    return out



def greedy_day1(cands, fixed_idx, t):
    """구성 휴리스틱: 고정 블록 → 점수순 삽입 (RuleFallbackAssembler의 원형).
    반환: {cand_idx: start_min} — CP-SAT 힌트용."""
    plan = {}
    for order, i in enumerate(fixed_idx):
        pin = max(cands[i]["open"], DAY_START) + order * 180
        pin = min(pin, min(cands[i]["close"], DAY_END) - cands[i]["dur"])
        plan[i] = pin
    ranked = sorted(range(len(cands)), key=lambda i: -cands[i]["score"])
    for i in ranked:
        if i in plan:
            continue
        # 현재 plan을 시간순으로 두고 끝에 이어붙이기만 시도 (단순·결정론)
        seq = sorted(plan, key=lambda x: plan[x])
        last = seq[-1] if seq else None
        depart = DAY_START if last is None else plan[last] + cands[last]["dur"]
        travel = t[0][i + 1] if last is None else t[last + 1][i + 1]
        est = max(depart + travel, cands[i]["open"], DAY_START)
        if est <= min(cands[i]["close"], DAY_END) - cands[i]["dur"]:
            plan[i] = est
    return plan


def solve_day1(cands, fixed_idx: list[int], seed: int):
    """CP-SAT day1 배치. 반환: (선택 수, 목적값, CP-SAT status)."""
    # 프리필터 — 고정 블록은 무조건 포함
    if len(cands) > PREFILTER_TOP_K:
        fixed_set = set(fixed_idx)
        ranked = sorted(range(len(cands)), key=lambda i: -cands[i]["score"])
        keep = list(fixed_set) + [i for i in ranked if i not in fixed_set]
        keep = keep[:PREFILTER_TOP_K]
        idx_map = {old: new for new, old in enumerate(keep)}
        cands = [cands[i] for i in keep]
        fixed_idx = [idx_map[i] for i in fixed_idx]

    k = len(cands)
    coords = [ANCHOR] + [c["coord"] for c in cands]  # 0 = 앵커(숙소)
    t = [[travel_min(coords[i], coords[j]) if i != j else 0
          for j in range(k + 1)] for i in range(k + 1)]

    m = cp_model.CpModel()
    visit = [m.NewBoolVar(f"v{i}") for i in range(k)]
    start = []
    for i, c in enumerate(cands):
        lo = max(c["open"], DAY_START)
        hi = min(c["close"], DAY_END) - c["dur"]  # HC1 ∩ HC4
        if lo > hi:
            m.Add(visit[i] == 0)
            lo, hi = DAY_START, DAY_START
        start.append(m.NewIntVar(lo, hi, f"s{i}"))

    for order, i in enumerate(fixed_idx):  # HC3: 고정 블록 — 방문 강제 + 시각 고정
        m.Add(visit[i] == 1)
        pin = max(cands[i]["open"], DAY_START) + order * 180  # 서로 3시간 간격 (겹침 방지)
        pin = min(pin, min(cands[i]["close"], DAY_END) - cands[i]["dur"])
        m.Add(start[i] == pin)

    arcs = []
    for i in range(k):  # 미방문 = 자기 루프
        arcs.append((i + 1, i + 1, visit[i].Not()))
    for i in range(k + 1):
        for j in range(k + 1):
            if i == j:
                continue
            lit = m.NewBoolVar(f"a{i}_{j}")
            arcs.append((i, j, lit))
            if i == 0 and j >= 1:      # 앵커 출발
                m.Add(start[j - 1] >= DAY_START + t[0][j]).OnlyEnforceIf(lit)
            elif i >= 1 and j >= 1:    # HC2: 연속 방문
                m.Add(start[j - 1] >= start[i - 1] + cands[i - 1]["dur"]
                      + t[i][j]).OnlyEnforceIf(lit)
    m.AddCircuit(arcs)

    m.Maximize(sum(int(c["score"] * 1000) * visit[i] for i, c in enumerate(cands)))

    # 그리디 초기해를 힌트로 — 단일 워커에서도 즉시 가능해 확보 (결정론 유지)
    hint = greedy_day1(cands, fixed_idx, t)
    for i in range(k):
        m.AddHint(visit[i], 1 if i in hint else 0)
        if i in hint:
            m.AddHint(start[i], hint[i])

    cp_solver = cp_model.CpSolver()
    cp_solver.parameters.max_time_in_seconds = TIME_LIMIT_S
    cp_solver.parameters.random_seed = seed
    cp_solver.parameters.num_search_workers = 1  # 결정론 (FD §4) — 힌트로 초기해 보장
    status = cp_solver.Solve(m)
    picked = [i for i in range(k) if cp_solver.Value(visit[i])] \
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else []
    return picked, cp_solver.ObjectiveValue() if picked else 0, cp_solver.StatusName(status)


def bench(n: int, fixed: int, seed: int = SEED):
    cands = gen_candidates(n, seed)
    fixed_idx = list(range(fixed))  # 앞쪽 fixed개를 고정 블록으로
    t0 = time.perf_counter()
    picked, obj, status = solve_day1(cands, fixed_idx, seed)
    ms = (time.perf_counter() - t0) * 1000
    return ms, len(picked), obj, status, picked


if __name__ == "__main__":
    print(f"{'후보':>6} {'고정':>4} {'시간(ms)':>10} {'배치':>4} {'목적값':>8} {'상태':>10} {'게이트':>6}")
    print("-" * 60)
    for n, fixed, gate_ms in [(50, 0, 3000), (50, 2, 3000),
                              (500, 0, None), (5000, 0, None), (5000, 3, None)]:
        ms, cnt, obj, status, _ = bench(n, fixed)
        gate = ("✅PASS" if ms <= gate_ms else "❌FAIL") if gate_ms else "—"
        print(f"{n:>6} {fixed:>4} {ms:>10.0f} {cnt:>4} {obj:>8.0f} {status:>10} {gate:>6}")

    # 결정론 확인: 동일 시드 2회 → 동일 선택
    _, _, _, _, p1 = bench(50, 2)
    _, _, _, _, p2 = bench(50, 2)
    print("-" * 60)
    print(f"결정론(동일 시드 2회 동일 선택): {'✅' if p1 == p2 else '❌'} ({len(p1)}개)")
