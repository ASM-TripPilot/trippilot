"""숙소 일반 그림 6장 생성·내보내기 — K6 스타일(정본 문구는 region-covers/_tools/gen_districts.py). 장소 카테고리 생성기(place-categories/_tools/gen_categories.py)와 같은 틀.

사용 (리포 루트에서):
  python3 -I frontend/assets/stay-covers/_tools/gen_stays.py gen      # 없는 PNG 만 생성 (region-covers/_tools/out/K6_stay-general-<n>.png)
  python3 -I frontend/assets/stay-covers/_tools/gen_stays.py export   # PNG → 738px WebP q75 로 stay-covers/stay-<n>.webp 에 쓴다

결과 PNG(1536×1024)는 region-covers/_tools/out/ 에 쌓인다(커밋 안 함). 레포 루트 `.env` 의 Azure 이미지 키를 쓴다 — 동시 3개까지, 한 장 ~45초.
유형(호텔·리조트 등)과 무관한 일반 숙소 그림이다 — 숙소 유형 데이터와 그림의 대응이 어려워 사용자가 유형별 세트를 버리고 일반 세트로 정했다(handoff 참조).
"""
import importlib.util, pathlib, sys
from concurrent.futures import ThreadPoolExecutor

ARGV = list(sys.argv)  # gen_districts 가 import 시 sys.argv 를 읽으므로 덮기 전에 보관한다
HERE = pathlib.Path(__file__).resolve().parent
OUT_ASSETS = HERE.parent  # frontend/assets/stay-covers
spec = importlib.util.spec_from_file_location("gd", OUT_ASSETS.parent / "region-covers" / "_tools" / "gen_districts.py")
gd = importlib.util.module_from_spec(spec); sys.argv = ["x"]; spec.loader.exec_module(gd)
D = gd.D  # "in clear daylight"

GUARD = "no flags, no brand logos, no signage, no readable text"
# 특정 양식(한옥·기와 등)으로 읽히지 않게 한다 — 처음 만든 '기타' 세트가 전부 한옥으로 나와 버려졌다.
NEUTRAL = ("neutral and style-agnostic: modern simple design, no national or regional decor, no hanok, no tiled roofs, no pagodas, "
           "no paper lattice doors, no lanterns, " + GUARD)

# 객실 내부 위주(어느 숙소 유형에나 맞는 장면) + 중립 외관 1장. 풀·고층 타워·기와 등 유형을 암시하는 요소는 뺀다.
SUBJECTS = [
    "A bright simple bedroom with a double bed and white linen, a bedside lamp and a large window with a soft green view, modern simple design, no people, " + NEUTRAL,
    "A twin-bed room with a small round table and two chairs by a window, light curtains, soft daylight, modern simple design, no people, " + NEUTRAL,
    "A cozy room seen from the doorway: a made bed, a small sofa, a rug and a framed picture on the wall, warm lamp light, modern simple design, no people, " + NEUTRAL,
    "A neutral modern low-rise building exterior with balconies and trees along a quiet street, a few figures far away, " + NEUTRAL,
    "A cozy lounge corner with two armchairs, a small table with a lamp and a large window with trees outside, modern simple design, no people close up, " + NEUTRAL,
    "A small room balcony with a little table and two chairs overlooking rooftops and distant trees in soft evening light, no people, " + NEUTRAL,
]

def gen():
    jobs = []
    for n, sub in enumerate(SUBJECTS, start=1):
        fname = f"K6_stay-general-{n}"
        if not (gd.OUT / f"{fname}.png").exists():
            jobs.append(("K6", f"stay-general-{n}", sub + f" {D}", fname))
    print(f"{len(jobs)}장 생성", flush=True)
    with ThreadPoolExecutor(3) as ex:
        for r in ex.map(gd.gen, jobs):
            print(r, flush=True)

def export():
    from PIL import Image
    for n in range(1, len(SUBJECTS) + 1):
        im = Image.open(gd.OUT / f"K6_stay-general-{n}.png").convert("RGB")
        im = im.resize((738, round(im.height * 738 / im.width)), Image.LANCZOS)
        im.save(OUT_ASSETS / f"stay-{n}.webp", "WEBP", quality=75)
    print("내보냄:", len(list(OUT_ASSETS.glob("stay-*.webp"))), "장")

if __name__ == "__main__":
    cmd = ARGV[1] if len(ARGV) > 1 else ""
    if cmd == "gen":
        gen()
    elif cmd == "export":
        export()
    else:
        print(__doc__)
