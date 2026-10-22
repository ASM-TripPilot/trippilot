"""장소 카테고리 10종 × 가로 3변형 생성·내보내기 — K6 스타일(정본 문구는 region-covers/_tools/gen_districts.py).

사용 (리포 루트에서):
  python3 -I frontend/assets/place-categories/_tools/gen_categories.py gen [slug,slug,...]   # 없는 PNG 만 생성
  python3 -I frontend/assets/place-categories/_tools/gen_categories.py export                # PNG → 738px WebP q75 로 place-categories/ 에 쓴다

결과 PNG(1536×1024)는 region-covers/_tools/out/ 에 쌓인다(커밋 안 함). 레포 루트 `.env` 의 Azure 이미지 키를 쓴다 — 동시 3개까지.
"""
import importlib.util, pathlib, sys
from concurrent.futures import ThreadPoolExecutor

ARGV = list(sys.argv)  # gen_districts 가 import 시 sys.argv 를 읽으므로 덮기 전에 보관한다
HERE = pathlib.Path(__file__).resolve().parent
OUT_ASSETS = HERE.parent  # frontend/assets/place-categories
spec = importlib.util.spec_from_file_location("gd", OUT_ASSETS.parent / "region-covers" / "_tools" / "gen_districts.py")
gd = importlib.util.module_from_spec(spec); sys.argv = ["x"]; spec.loader.exec_module(gd)
D = gd.D  # "in clear daylight"

# 맛집은 특정 요리·문화권으로 읽히지 않게 한다(한식·양식·일식·중식 어디도 아님).
NEUTRAL = ("neutral and cuisine-agnostic: modern casual restaurant design, no national or regional decor, no lanterns, no noren curtains, "
           "no hanok or tiled roofs, no pagodas, no flags, no signage, no text, no brand logos")

# slug(AI 경계 코드 소문자) → 변형 3개. "[N] " 접두는 풍경이 주인공인 자연형 문구.
SUBJECTS = {
    "sight": ["A famous-sight scene: a traditional tiled-roof pavilion on a stone terrace with a wide view over rooftops and a distant river, a few visitors taking photos far away, no named landmark",
              "A historic stone fortress wall with a tiled gate house and a stone-paved path winding along it, a few visitors far away, no named landmark",
              "A scenic lookout deck with a wooden railing over a wide valley and a river, small flags fluttering, a few visitors far away"],
    "food": ["A cozy casual restaurant interior: warm wooden tables set with plates and glasses, pendant lamps, a brick wall with potted plants, large windows with soft daylight, a few diners far away, " + NEUTRAL,
             "A casual restaurant storefront with an outdoor terrace: a plain wooden facade with large windows and a canvas awning, small round tables and chairs with potted plants, a clean paved street, a few diners far away, " + NEUTRAL,
             "A restaurant table seen from slightly above by a window: shared plates of assorted dishes such as a fresh salad, roasted chicken, grilled vegetables, a basket of bread and a bowl of soup, glasses of water, simple cutlery and napkins, warm soft light, no people, " + NEUTRAL],
    "cafe": ["A bright cozy cafe interior at a window seat: a latte with leaf art and a slice of dessert on a wooden table, a small plant, soft daylight streaming in, a blurred street outside, no text, no people close up",
             "A cafe pastry counter with a glass display of cakes and bread, a blurred espresso machine behind, warm light, no text, no people close up",
             "A rooftop cafe terrace with small round tables, parasols and potted plants and a soft city view, a few customers far away"],
    "night_view": ["A city night view at twilight: a skyline and a long bridge glowing with warm lights reflected on calm dark water, deep indigo sky with a few stars and golden lights, no named landmark, no text",
                   "A hilltop observation deck at night overlooking a sea of glowing city lights, a few people far away, deep indigo sky, no named landmark, no text",
                   "A river park at night with a lit bridge, glowing lanterns along the path and golden reflections on dark water, no text"],
    "nature": ["[N] A serene nature scene: a forest trail with a small wooden bridge over a clear stream, tall green trees and soft light through the leaves, gentle mountains in light mist beyond, no people",
               "[N] A calm lake with a wooden pier, reflections of mountains and autumn trees on the still water, no people",
               "[N] A green valley with a small waterfall and stone steps through ferns and tall trees, soft light, no people"],
    "shopping": ["A lively shopping street: boutique shop windows with colorful clothes and bags, a market lane with hanging goods, shopping bags in the hands of a few shoppers far away, shopfront signs without readable text",
                 "A department store atrium with display windows of mannequins in colorful clothes, shopping bags and escalators, a few shoppers far away, signs without readable text",
                 "A traditional market aisle with colorful fabrics, souvenirs and handicrafts on display under cloth awnings, a few shoppers far away, no readable text"],
    "culture": ["A bright museum gallery hall: framed ink paintings on the walls, a ceramic vase on a pedestal, a sculpture, soft skylight, a few visitors very small in the distance",
                "A small traditional performance stage in a hanok courtyard with a gayageum on a mat, paper lanterns and tiled roofs, no performers in front, no text",
                "A calligraphy exhibition desk with brushes, an ink stone and long hanging scrolls of Korean calligraphy, soft light, no readable text"],
    "activity": ["[N] An outdoor activity scene: colorful kayaks and a surfboard on a sandy beach beside clear blue sea, a cyclist on a coastal path, a few small figures far away",
                 "[N] A hiking trail along a mountain ridge with a backpack and trekking poles resting on a rock, wide mountain view, no people close up",
                 "[N] A cycling path through a green riverside park with bicycles parked beside the path, a river and a bridge beyond, a few small cyclists far away"],
    "art": ["An art studio with an easel holding a colorful painting in progress, paint tubes and brushes in jars, canvases leaning on the wall, sunlight from a large window, no people",
            "A contemporary art museum atrium with a large colorful abstract installation and a minimalist white staircase, visitors very small in the distance",
            "A narrow alley lined with colorful mural paintings on the walls, bold shapes and flowers, a bicycle parked, no readable text"],
    "bar": ["A cozy Korean pub in the evening: small tables with plates of snacks and glasses of beer, warm string lights, wooden stools, no labels, no text, no people close up",
            "A craft beer bar counter with a row of taps and glasses of beer, a shelf of bottles without labels blurred behind, warm wood, evening light, no text",
            "A rooftop bar at twilight with cocktails on a small table and string lights over a city skyline, deep blue sky, no named landmark, no text"],
}

def _suffix(desc):  # 밤·황혼·저녁 장면엔 '맑은 낮' 접미를 붙이지 않는다
    return "" if any(w in desc.lower() for w in ("night", "twilight", "evening")) else f" {D}"

def gen(only=None):
    jobs = []
    for slug, subs in SUBJECTS.items():
        if only and slug not in only:
            continue
        for n, sub in enumerate(subs, start=1):
            fname = f"K6_catv-{slug}-{n}"
            if not (gd.OUT / f"{fname}.png").exists():
                jobs.append(("K6", f"{slug}-{n}", sub + _suffix(sub), fname))
    print(f"{len(jobs)}장 생성", flush=True)
    with ThreadPoolExecutor(3) as ex:
        for r in ex.map(gd.gen, jobs):
            print(r, flush=True)

def export():
    from PIL import Image
    for slug, subs in SUBJECTS.items():
        for n in range(1, len(subs) + 1):
            src = gd.OUT / f"K6_catv-{slug}-{n}.png"
            im = Image.open(src).convert("RGB"); im = im.resize((738, round(im.height * 738 / im.width)), Image.LANCZOS)
            im.save(OUT_ASSETS / f"{slug}-{n}.webp", "WEBP", quality=75)
    print("내보냄:", len(list(OUT_ASSETS.glob("*.webp"))), "장")

if __name__ == "__main__":
    cmd = ARGV[1] if len(ARGV) > 1 else ""
    if cmd == "gen":
        gen(ARGV[2].split(",") if len(ARGV) > 2 else None)
    elif cmd == "export":
        export()
    else:
        print(__doc__)
