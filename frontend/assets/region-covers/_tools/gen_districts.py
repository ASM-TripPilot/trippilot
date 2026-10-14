"""서울·부산·제주 시군구 커버 일괄 생성 — 수묵담채(K5) 스타일.

사용: python3 -I gen_districts.py <스타일키> <대상,대상,...|all>
  대상 = 지역코드(5자리) 또는 시도 별칭(seoul/busan/jeju). 파일: districts/<스타일>_<코드|별칭>.png (3:2, 1536x1024)
"""
import base64, json, pathlib, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parents[4]  # 리포 루트(.env·시드 SQL 위치)
OUT = pathlib.Path(__file__).parent / "out"  # 원본 PNG(1536x1024) — 커밋하지 않는다
OUT.mkdir(exist_ok=True)
env = dict(l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if "=" in l and not l.startswith("#"))
BASE, KEY = env["OPENAI_BASE_URL"], env["OPENAI_API_KEY"]

# K5 = K3(하이키 담채)에서 먹 붓질·여백을 키운 수묵담채. a=조금 더, b=확실히.
STYLES = {
    "K5a": ("Korean ink-wash and light-color painting (sumuk-damchae) on bright hanji paper, high-key and airy. "
            "Expressive gray-to-black ink brushwork with visible dry-brush strokes and thick-and-thin line variation defines mountains, rocks, pines, rooftops and buildings, "
            "with soft ink-wash mist and generous breathing space (yeobaek) in the sky and water. "
            "Color is restrained: only very pale washes of peach, celadon green and light indigo, plus small vermilion accents such as a small red sun, maple leaves or a pavilion. "
            "Visible hanji paper fibers, wet-on-wet bleeding edges, hand-painted look, not digital, not airbrushed, no saturated colors. "
            "Bright, fresh, calm mood, medium-high finish"),
    "K5b": ("Korean ink-wash painting (sumukhwa) with light color (damchae) on bright hanji paper, ink is the main voice: about 70 percent ink and 30 percent pale color. "
            "Confident calligraphic brush outlines in medium gray ink (never solid black masses), bold dry-brush texture on rocks, pine trunks and roof tiles, "
            "graded ink tones from pale gray to mid gray, drifting ink-wash mist and large areas of untouched white paper as intentional empty space (yeobaek). "
            "Color only as faint washes of peach, celadon and pale indigo with a few small vermilion accents. "
            "Visible hanji fibers, wet-on-wet ink bleeding, authentic hand-painted East Asian ink painting look, not digital, not airbrushed. "
            "Overall bright and light, no dark areas, calm and elegant, medium-high finish"),
}
# K6 = K5a 보정판 — 산·안개 능선을 빼고 색을 키우며, 자연이 아니라 건축·거리·시설이 주인공이다.
STYLES["K6"] = ("Korean ink-wash and light-color painting (sumuk-damchae) on bright hanji paper, high-key, with clearly visible color. "
                "Confident ink brush outlines in gray to black with thick-and-thin lines describe the main subject, its architecture and rooftops, with delicate dry-brush texture. "
                "Color is light but clearly present: transparent washes of rose, apricot, celadon green, pale indigo and ochre fill roofs, walls, foliage, water and sky, plus small vermilion accents. "
                "Visible hanji paper fibers, hand-painted look, not digital, not airbrushed. Bright, lively and warm mood, medium-high finish. "
                "")
# 건축·거리형은 산·안개 능선을 막고, 자연형은 풍경이 주인공이되 능선 안개는 최소로 한다.
K6_ARCH = ("Architecture and everyday city life are the subject, not nature: no mountain ranges and no layered misty ridges in the background, "
           "keep the sky simple and open, and do not add landmarks from other districts. "
           "Draw only what is described: do not add street stalls, tents, awnings, vendors, vehicles, boats, pavilions, "
           "or famous towers in the far distance unless they are named in the subject")
K6_NAT = ("The scenery itself is the subject: keep distant misty ridges minimal and the sky simple and open, with clear fresh color. "
          "Draw only what is described: do not add pavilions, vehicles, boats or famous towers in the far distance unless they are named in the subject")
ALT = {  # 자연이 아닌 소재 시험 — 코드 → 장면
    "11215": "Common Ground shopping mall in Gwangjin-gu: a playful stack of colorful shipping containers forming a courtyard mall, pastel and bright container walls, stairs and bridges between boxes, trees in planters",
    "11230": "Gyeongdong herbal medicine market in Dongdaemun-gu: a busy narrow market lane with rows of stalls, burlap sacks and baskets of dried herbs, ginseng roots and mushrooms, hanging bundles, canvas awnings and paper lanterns",
    "11350": "Hwarangdae Railway Park in Nowon-gu: a small old brick-and-wood train station building with a vintage locomotive and old passenger carriages parked on the tracks, gravel rail bed and a few autumn trees",
    "11590": "Noryangjin Fisheries Market in Dongjak-gu: a large market hall with rows of fish stalls, glass tanks and crates of fresh seafood, red and blue plastic crates, ice boxes, lively market atmosphere",
    "11710": "Lotte World Tower rising behind the fairytale castle of Lotte World Adventure theme park in Songpa-gu: colorful castle roofs, flags, a carousel and a lake boardwalk in front",
    "26110": "Jagalchi Market in Jung-gu Busan: the seagull-winged modern market building by the harbor, small fishing boats moored at the quay, fish stalls with red buckets and drying squid on lines",
    "26170": "Choryang Ibagu-gil in Dong-gu Busan: a steep street of 168 stairs climbing a hillside of small old houses with a sky-capsule inclined elevator beside the stairs, laundry lines, narrow alleys and harbor cranes in the distance",
    "50130": "Saeyeongyo Bridge in Seogwipo: a white sail-shaped pylon pedestrian bridge connecting to Saeseom island, calm blue sea, small fishing boats and a little lighthouse",
}
# --- 승인된 소재 확정표(2026-10-13). "[N] " 접두는 자연형(풍경이 주인공). 11230 은 뒤에 성문이 끼어들어 재생성. ---
ALT.update({
    "seoul": "[N] N Seoul Tower on Namsan hill rising above a sea of traditional hanok tiled rooftops and a few modern towers, autumn maple and ginkgo trees in the foreground",
    "11110": "Geunjeongjeon throne hall of Gyeongbokgung Palace on its two-tier stone terrace with painted eaves and a tiled double roof, a stone-paved courtyard with rows of stone rank markers and a palace gate at the side",
    "11140": "Namdaemun Market lane in Jung-gu: a busy covered shopping street with colorful awnings, clothing racks and food stalls, with Sungnyemun (Namdaemun) gate and its two-tier tiled roof visible at the far end of the street",
    "11170": "National Museum of Korea in Yongsan-gu: the very long horizontal modern stone building with a wide stone plaza, a calm mirror pond in front reflecting the building, and a stone pagoda beside the pond",
    "11200": "Seongsu-dong in Seongdong-gu: a lane of converted red-brick factory buildings turned into cafes and galleries, a tall brick chimney, ivy on brick walls, outdoor cafe tables and painted shutters",
    "11230": "Gyeongdong herbal medicine market in Dongdaemun-gu: a busy narrow market lane with rows of stalls, burlap sacks and baskets of dried herbs, ginseng roots and mushrooms, hanging bundles, canvas awnings and paper lanterns, ordinary low market buildings at the far end, no city gate and no tower",
    "11260": "[N] Jungnangcheon stream rose tunnel in Jungnang-gu: a long walking path under arches of blooming red and pink roses beside the stream, rose beds and a few benches",
    "11290": "Gilsangsa Buddhist temple in Seongbuk-gu: the elegant Geungnakjeon hall with a tiled roof, a small bell pavilion, stone lanterns and a serene Avalokiteshvara statue in a quiet courtyard of autumn trees",
    "11305": "[N] Buk-Seoul Dream Forest park in Gangbuk-gu: a calm lotus pond with a small pavilion, a wooden bridge and a tall observation tower seen across the water, framed by autumn trees",
    "11320": "[N] Dobongsan mountain's tall pointed granite peaks rising above an autumn forest of red maples with a temple roof in the foreground",
    "11380": "Eunpyeong Hanok Village in Eunpyeong-gu: neat rows of new traditional hanok houses with tiled roofs, a stone-walled lane, persimmon trees and a small village square",
    "11410": "Seodaemun Prison History Hall in Seodaemun-gu: the red-brick prison building with its tall brick watchtower and walls, and the stone Independence Gate arch in the foreground",
    "11440": "[N] Haneul Park in Mapo-gu: a hill covered with golden-silver pampas grass in autumn with a winding wooden walkway and a distant view of a Han River bridge",
    "11470": "Yongwangsan Skywalk in Yangcheon-gu: a spiral snail-shaped wooden deck ramp winding up through the trees to a two-storey traditional pavilion on top",
    "11500": "Seoul Botanic Park in Gangseo-gu: a large rounded glass greenhouse dome beside a lake, with a lakeside walking path, reeds and trees",
    "11530": "Gocheok Sky Dome in Guro-gu: the large round white translucent-roof baseball dome stadium with a plaza and green trees in front",
    "11545": "Geumcheon Falls Park in Geumcheon-gu: an artificial waterfall of three streams cascading down a rock wall into a pond, with a pavilion and trees, in a quiet urban park",
    "11560": "Yeouido in Yeongdeungpo-gu: the golden glass 63 Building towering over the Han River park, with the green copper dome of the National Assembly beside it and cherry trees along the riverside",
    "11620": "Nakseongdae in Gwanak-gu: a three-tier granite stone pagoda in front of the tiled Anguksa shrine hall with its stone wall and pine trees, a stone-paved path",
    "11650": "Banpo Bridge Moonlight Rainbow Fountain in Seocho-gu: jets of water arching from the long bridge deck in rainbow tones, and the Sebitseom floating buildings with sail-like roofs on the Han River",
    "11680": "Bongeunsa Buddhist temple in Gangnam-gu: the tall stone Maitreya Buddha statue and tiled halls in the foreground with glass skyscrapers rising directly behind",
    "11740": "Amsa-dong prehistoric settlement in Gangdong-gu: a village of cone-shaped thatched pit-dwelling huts on a riverside field with a wooden fence and a few trees",
    "busan": "Busan coast: the long Gwangan Bridge across the bay beyond a curved sandy beach with waves and a few umbrellas, the Haeundae high-rise skyline across the water",
    "26140": "Songdo Marine Cable Car in Seo-gu Busan: colorful cable cabins gliding over the sea above the beach, and the Songdo Yonggung walking suspension bridge reaching a small rocky island with a pavilion",
    "26200": "[N] Taejongdae in Yeongdo-gu: a white lighthouse on a cliff edge with pine trees and rocky cliffs above deep blue waves and a coastal path",
    "26230": "Samgwangsa Buddhist temple in Busanjin-gu: a nine-story pagoda and temple halls under hundreds of colorful hanging lotus lanterns in a courtyard",
    "26260": "Dongnae Fortress in Dongnae-gu Busan: the restored stone fortress wall and a tiled wooden gate tower with flags, a stone-paved path and old pine trees",
    "26290": "[N] Oryukdo islets in Nam-gu Busan: rocky islets rising from the blue sea seen from the Igidae coastal trail with a glass skywalk, pines and rocks",
    "26320": "Geumbit Noeul Bridge in Buk-gu Busan: a long slender pedestrian bridge crossing the Nakdong River at golden sunset with a riverside park and reed banks",
    "26350": "Haeundae beach in Busan: a long curved sandy beach with colorful parasols, Marine City glass skyscrapers behind, and the pine-covered Dongbaekseom peninsula at one end",
    "26380": "Gamcheon Culture Village in Saha-gu Busan: a terraced hillside of small colorful pastel houses stacked down toward the sea, narrow alleys and stairs, a small lookout",
    "26410": "Beomeosa Buddhist temple in Geumjeong-gu: the tall stone Iljumun gate and the tiled Daeungjeon main hall with ornate painted eaves, a three-tier stone pagoda in the courtyard and pine trees",
    "26440": "Gadeokdo in Gangseo-gu Busan: a white lighthouse and a red lighthouse standing on the harbor breakwater with blue sea, fishing boats and a distant long bridge",
    "26470": "Yeonsan-dong ancient tombs in Yeonje-gu Busan: a long row of round grass-covered burial mounds along a ridge path with pine trees and a stone-paved walkway, apartment rooftops far behind",
    "26500": "Millak Waterfront Park in Suyeong-gu Busan: a wide promenade along the waterfront with people sitting on the steps far away, a raw-fish market building with awnings and the long Gwangan Bridge in the distance",
    "26530": "[N] Samnak Ecological Park in Sasang-gu Busan: a tunnel of blooming cherry trees along a riverbank levee path beside a pond full of lotus leaves, the Nakdong River beyond",
    "26710": "Haedong Yonggungsa temple in Gijang-gun: temple halls with tiled roofs on seaside cliffs reached by a long stairway and a stone bridge, a large seated Buddha statue near the waves",
    "jeju": "[N] Seongsan Ilchulbong crater cone rising from the sea beyond fields of bright yellow rapeseed flowers and black basalt stone walls",
    "50110": "Dodu Rainbow Coastal Road in Jeju City: a seaside road with a seawall painted in rainbow colors, a haenyeo diver statue, and calm blue sea with a small lighthouse",
    "seoul-hero": "[N] N Seoul Tower on Namsan hill rising above a sea of traditional hanok tiled rooftops and a few modern towers, autumn maple and ginkgo trees in the foreground",
    "busan-hero": "Busan coast: the long Gwangan Bridge across the bay beyond a curved sandy beach with waves and a few umbrellas, the Haeundae high-rise skyline across the water",
    "jeju-hero": "[N] Seongsan Ilchulbong crater cone rising from the sea beyond fields of bright yellow rapeseed flowers and black basalt stone walls",
    "stay": "A cozy hotel room interior: neatly made bed with white linen and a coral throw blanket, bedside lamp, a large window with a soft view of city rooftops and trees",
    "place": "A charming small neighborhood street with low tiled-roof shops, hanging lanterns, ginkgo trees in autumn yellow and a few cafe tables",
})
# --- 적대적 검토 후 교체(2026-10-13): 사용자가 처음 듣는다고 한 소재(낙성대·금천폭포공원·용왕산 스카이워크·봉은사) ---
ALT.update({
    "11680": "Starfield Library at COEX Mall in Gangnam-gu: a grand open atrium with three enormous floor-to-ceiling bookshelves about thirteen meters tall rising across two levels, rows of reading chairs and tables in the central plaza, soft glass skylight light, shoppers sitting and reading far away",
    "11620": "[N] Gwanaksan mountain in Gwanak-gu: a rugged ridge of granite rock outcrops with twisted pine trees and autumn colors above a quiet valley trail, hikers very small in the distance",
    "11545": "Gasan Digital Complex in Geumcheon-gu: rows of tall modern office towers of stone and glass along a wide tree-lined avenue, an elevated subway line crossing the street, workers walking far away",
    "11470": "Mokdong in Yangcheon-gu: a dense cluster of tall apartment towers rising behind a stream-side walking path lined with blooming cherry trees, a small footbridge over the stream",
})
# --- 적대적 검토 반영 일괄 재생성(2026-10-13) — 교체 5 · 수정 19 · 히어로 2 · 관악 구도 변경 ---
ALT.update({
    # 교체
    "11215": "Seoul Children's Grand Park in Gwangjin-gu: a wide entrance plaza with a music fountain shooting jets of water high into the air, a large octagonal multi-storey pavilion building (Palgakdang) beside it, green lawns and trees, families with children and balloons far away",
    "11440": "Hongdae Walking Street in Mapo-gu: a lively pedestrian street with buskers performing for small circles of onlookers, colorful murals on the walls, rows of small fashion shops and cafes with terrace seating, signs without readable text, and playful street art painted on the paved plaza floor",
    "26230": "Seomyeon downtown in Busanjin-gu Busan: a busy pedestrian shopping and dining street lined with rows of bars, cafes and restaurants with colorful neon-style signs without readable text, a wide intersection with crowds crossing far away, late afternoon with the signs beginning to glow",
    "26320": "Gupo Market in Buk-gu Busan: a crowded traditional five-day market lane under cloth awnings with produce, seafood and dried-goods stalls, and noodle shops whose long strands of white noodles hang on racks to dry in the sun and sea breeze",
    "50130": "[N] Seongsan Ilchulbong in Seogwipo: the great tuff cone rising from the sea with a crown-like rim of many rocky pinnacles around a round green crater bowl, green grass fields and a coastal path in the foreground, no flowers in bloom",
    # 수정(소재 유지·그림 보정)
    "11140": "Sungnyemun (Namdaemun) gate in Jung-gu: the stone fortress gate with its arched opening and two-tier tiled hip roof standing on a broad paved plaza, a ring road and modern glass office towers behind it, trees in front",
    "11170": "National Museum of Korea in Yongsan-gu: the very long horizontal modern stone building with a wide stone plaza and a calm mirror pond in front reflecting the building, a small traditional pavilion standing on the water in the middle of the pond, no pagoda",
    "11230": "Seoul Yangnyeongsi herbal medicine street in Jegi-dong, Dongdaemun-gu: a street of low modern shop buildings housing traditional herbal medicine shops, each shopfront piled with sacks and baskets of dried herbs, ginseng roots and mushrooms, plain colored shop signs without readable text, and a large covered market building along one side, no city gate",
    "11260": "[N] Jungnangcheon stream in Jungnang-gu: a wide calm urban stream with flat grassy embankments, a long walkway under blooming red and pink roses along the bank, a road bridge and a skyline of apartment buildings in the distance",
    "11305": "[N] Buk-Seoul Dream Forest park in Gangbuk-gu: a calm lotus pond with a tall fountain jet in its center, a small octagonal pavilion on the shore and a low waterfall at the edge, autumn trees around",
    "11350": "Hwarangdae Railway Park in Nowon-gu: the small one-storey wooden former train station painted in yellow and red with an asymmetrical gabled roof, a vintage steam locomotive on the tracks and an old tram car parked beside it, gravel rail bed and a few autumn trees",
    "11380": "Eunpyeong Hanok Village in Eunpyeong-gu: neat rows of new traditional hanok houses with tiled roofs and varied stone-and-plaster walls along a stone-paved lane, the rocky ridge of Bukhansan rising behind the rooftops",
    "11410": "Dongnimmun Independence Gate in Seodaemun-gu: the granite triumphal arch with a carved plum-blossom crest and a stone plaque, standing in a park, with the two-storey red-brick Seodaemun Prison History Hall building and its tall brick wall behind it",
    "11500": "Seoul Botanic Park in Gangseo-gu: a very wide low saucer-shaped glass greenhouse with a flat hexagonal-panel roof that is lower in the middle and higher at the edges, beside a lake with reeds and trees",
    "11590": "Noryangjin Fisheries Market in Dongjak-gu: a large modern market building with a wavy roof decorated with fish shapes, an older market lane with blue tarp roofs and stalls of fresh seafood in tanks and ice boxes, no boats and no towers in the distance",
    "11740": "Amsa-dong prehistoric settlement in Gangdong-gu: a village of cone-shaped thatched pit-dwelling huts half sunk into the ground on an open riverside field, simple and quiet, no fences, no boats, no gates",
    "11620": "[N] Gwanaksan mountain rising behind the rooftops of Gwanak-gu: a rugged granite summit with pine trees above a hillside of low houses and apartment blocks and a wide city road lined with trees in autumn colors",
    "busan": "Busan at twilight: the long double-suspension Gwangan Bridge across the bay lit with colorful lights, the Haeundae Marine City skyscrapers glowing on the far shore, calm deep blue sea with golden light reflections, deep indigo and gold twilight sky",
    "busan-hero": "Busan at twilight: the long double-suspension Gwangan Bridge across the bay lit with colorful lights, the Haeundae Marine City skyscrapers glowing on the far shore, calm deep blue sea with golden light reflections, deep indigo and gold twilight sky",
    "26260": "Dongnae Fortress north gate in Dongnae-gu Busan: a restored stone fortress wall climbing a wooded hillside ridge to a tiled wooden gate tower with flags, the rooftops of Busan spread out far below, old pine trees",
    "26290": "[N] Oryukdo islets in Nam-gu Busan: five or six rocky islets lined up in a row off the shore, the farthest islet carrying a white lighthouse, seen from a pine-covered headland with a glass U-shaped skywalk reaching out from the cliff",
    "26440": "[N] Geoga Bridge seen from Yeondaebong viewpoint on Gadeokdo in Gangseo-gu Busan: a long cable-stayed bridge crossing the deep blue sea between islands, rocky coastline and pines in the foreground, small islets and gentle hills beyond",
    "26530": "[N] Samnak Ecological Park in Sasang-gu Busan in spring: a long tunnel of blooming cherry trees along a levee path beside fields of yellow rapeseed flowers, the wide Nakdong River beyond, no lotus",
    "26410": "Beomeosa Buddhist temple in Geumjeong-gu: an old pine-lined forest path leading to the stone Iljumun gate with granite pillars and a tiled roof, temple halls and a three-tier stone pagoda visible beyond",
    "jeju": "[N] Hallasan mountain in the distance with its broad gentle shield-shaped summit rising above rolling green oreum hills, a foreground of black basalt stone walls, green fields and a few traditional low houses, no flowers in bloom",
    "jeju-hero": "[N] Hallasan mountain in the distance with its broad gentle shield-shaped summit rising above rolling green oreum hills, a foreground of black basalt stone walls, green fields and a few traditional low houses, no flowers in bloom",
    "50110": "Dodu Rainbow Coastal Road in Jeju City: a coastal road with a seawall painted in rainbow colors, a haenyeo diver statue standing on the black basalt shore, calm blue sea, no lighthouse, no palm trees, no shops and no vehicles",
})
COMPOSE = ("Wide panoramic composition filling the entire canvas edge to edge. Place the main subject at the vertical center of the image; "
           "keep the top 25% and the bottom 25% as simple tonal wash (sky, mist or foreground) so that center crops to 2:1, 5:4 and 4:5 still keep the subject complete. "
           "Strong simple silhouettes that stay readable at 150 px wide. "
           "No text, no letters, no numbers, no logos, no signboards, no watermark, no frame, no border, no people close up.")
D = "in clear daylight"

# 시도 대표(이미 K3 로 만든 것과 같은 소재)
SIDO = {
    "seoul": f"Seoul {D}: N Seoul Tower on Namsan hill above layered traditional hanok rooftops and modern city towers, autumn trees in the foreground",
    "busan": f"Busan coast {D}: Gwangan Bridge spanning the bay, Haeundae high-rise skyline across the water, waves rolling onto the beach and a few pine trees on a rocky headland",
    "jeju": f"Jeju island {D}: Hallasan volcano peak rising above rolling green oreum hills, tangerine orchard rows, black basalt stone walls and a coastal horizon",
}
# 홈 히어로(세로 6:7, 2:3 으로 생성) · 숙소/장소 공용 폴백 — 시도 대표와 같은 소재·같은 스타일.
COMPOSE_TALL = ("Tall vertical composition filling the entire canvas edge to edge. Place the main subject in the vertical middle 50% of the image; "
                "keep the top 25% as soft sky wash and the bottom 25% as simple calm foreground wash with no important detail "
                "(a dark gradient and white title text will be overlaid on the bottom third, a small badge on the top-left). "
                "Strong simple silhouettes. No text, no letters, no numbers, no logos, no signboards, no watermark, no frame, no border, no people close up.")
EXTRA = {f"{k}-hero": SIDO[k] for k in SIDO}
EXTRA["stay"] = (f"A cozy hotel room interior {D}: neatly made bed with white linen and a coral throw blanket, bedside lamp, "
                 "large window with a soft view of distant mountains and city rooftops")
EXTRA["place"] = (f"A quiet autumn forest walking trail along a lake {D}: wooden fence beside the path, trees arching overhead, "
                  "fallen leaves and soft light through the branches")
# 시군구 — (시도코드, 이름) → 대표 장면. 같은 이름(중구·서구·강서구 등)이 있어 코드로 구분한다.
DISTRICT = {
    ("11", "종로구"): "Gyeongbokgung Palace main hall with its tiled roofs and the rugged Bugaksan mountain rising behind",
    ("11", "중구"): "Sungnyemun (Namdaemun) gate with its two-tier tiled roof in front of modern downtown towers",
    ("11", "용산구"): "N Seoul Tower on the pine-covered Namsan hillside above the rooftops of Yongsan",
    ("11", "성동구"): "Seoul Forest park with tall trees and a wooden walking bridge, brick factory-style buildings of Seongsu beyond",
    ("11", "광진구"): "Gwangnaru riverside park on the Han River with a bicycle path, reeds and a long bridge in the distance",
    ("11", "동대문구"): "Kyung Hee University's grand Gothic-style building with a tree-lined avenue and cherry blossoms",
    ("11", "중랑구"): "Jungnangcheon stream lined with cherry trees and a rose garden, Yongmasan hill behind",
    ("11", "성북구"): "the old Seoul City Wall winding along a ridge above Seongbuk-dong with stone-walled hanok alleys below",
    ("11", "강북구"): "Bukhansan mountain's granite peaks Insubong and Baegundae above a pine valley",
    ("11", "도봉구"): "Dobongsan mountain's sharp granite peaks Jaunbong and Manjangbong with autumn forest below",
    ("11", "노원구"): "Suraksan mountain's rocky ridge rising above Nowon apartment blocks and a cherry-lined stream",
    ("11", "은평구"): "Eunpyeong Hanok Village with its tiled-roof houses on a hillside and Bukhansan mountain behind",
    ("11", "서대문구"): "Dongnimmun Independence Gate stone arch beside a red-brick historic building with Inwangsan mountain behind",
    ("11", "마포구"): "Haneul Park's silver grass fields in autumn above the Han River with a bridge and the Mapo skyline",
    ("11", "양천구"): "Anyangcheon stream with cherry trees in bloom and a calm pond with apartment towers of Mokdong beyond",
    ("11", "강서구"): "Seoul Botanic Park's glass dome greenhouse beside a lake and reeds, Gaehwasan hill behind",
    ("11", "구로구"): "Gocheok Sky Dome stadium and the Guro Digital Complex towers beside a green riverside park",
    ("11", "금천구"): "Gasan Digital Complex towers beside Anyangcheon stream with Gwanaksan mountain behind",
    ("11", "영등포구"): "Yeouido Han River park with cherry blossoms, the golden 63 Building and the National Assembly dome",
    ("11", "동작구"): "Dongjak Bridge crossing the wide Han River with riverside trees and the city skyline beyond",
    ("11", "관악구"): "Gwanaksan mountain's rocky peak with the small Yeonjudae temple perched on a cliff among pines",
    ("11", "서초구"): "Banpo Bridge with its rainbow fountain jets over the Han River and the floating Sebitseom islands",
    ("11", "강남구"): "Bongeunsa Buddhist temple with its tiled roofs and pagoda in the foreground and Gangnam glass skyscrapers behind",
    ("11", "송파구"): "Lotte World Tower rising above Seokchon Lake with cherry blossoms along the shore",
    ("11", "강동구"): "Amsa-dong prehistoric settlement with thatched pit-dwelling huts on a riverside hill by the Han River",
    ("26", "중구"): "Busan Tower on the green Yongdusan hill above the harbor and old downtown rooftops",
    ("26", "서구"): "Songdo beach with the long Songdo Skywalk over the sea and a marine cable car crossing the bay",
    ("26", "동구"): "Busan Harbor Bridge over the busy port with the colorful hillside village of Ibagu-gil above",
    ("26", "영도구"): "Taejongdae sea cliffs with a white lighthouse among pine trees above blue waves",
    ("26", "부산진구"): "Seomyeon downtown towers beside the green Busan Citizens Park with a calm pond",
    ("26", "동래구"): "Dongnae Fortress stone wall and tiled gate with old pine trees on a hillside",
    ("26", "남구"): "Oryukdo islets rising from the sea seen from the Igidae coastal trail with rocky shore and pines",
    ("26", "북구"): "Hwamyeong Ecological Park by the Nakdong River with reed fields and a long bridge",
    ("26", "해운대구"): "Haeundae beach with parasols along a long curved shore, Marine City skyscrapers and the pine-covered Dongbaekseom islet",
    ("26", "사하구"): "Gamcheon Culture Village's terraced hillside of small colorful houses stacked down to the sea",
    ("26", "금정구"): "Beomeosa Buddhist temple's tiled halls among pine forest at the foot of Geumjeongsan mountain",
    ("26", "강서구"): "rapeseed flower fields in bloom beside the wide Nakdong River estuary with a faint mountain in the distance",
    ("26", "연제구"): "Busan City Hall plaza with a wide lawn and cherry trees in bloom along a quiet avenue",
    ("26", "수영구"): "Gwangalli beach with the long Gwangan Bridge across the bay and the Haeundae skyline in the distance",
    ("26", "사상구"): "Samnak Ecological Park beside the Nakdong River with flower fields, a riverside path and a bridge",
    ("26", "기장군"): "Haedong Yonggungsa temple perched on seaside cliffs with tiled roofs above the waves",
    ("50", "제주시"): "Yongduam Dragon Head Rock coastline with dark volcanic rocks and waves, Hallasan mountain faint in the distance",
    ("50", "서귀포시"): "Seongsan Ilchulbong crater cone rising from the sea beside fields of yellow rapeseed flowers",
}

def region_codes():
    import re
    sql = (ROOT / "backend/app/src/main/resources/db/migration/R__seed_region_catalog.sql").read_text(encoding="utf-8")
    rows = re.findall(r"\('(\d+)', '([^']+)', '(\d+)', '[^']+', 'SIGUNGU', (?:true|false)\)", sql)
    return {(sd, nm): code for code, nm, sd in rows}

def build_jobs(style_key, targets):
    if style_key == "K6":
        return [(style_key, c, ALT[c] if "twilight" in ALT[c] else f"{ALT[c]} {D}", f"{style_key}_{c}") for c in ALT
                if (targets == ["all"] or c in targets) and not (OUT / f"{style_key}_{c}.png").exists()]
    codes = region_codes(); jobs = []
    for (sd, nm), desc in DISTRICT.items():
        code = codes[(sd, nm)]
        if targets == ["all"] or code in targets:
            jobs.append((style_key, code, f"{desc} {D}", f"{style_key}_{code}"))
    for k, desc in {**SIDO, **EXTRA}.items():
        if (targets == ["all"] and k in SIDO) or k in targets:
            jobs.append((style_key, k, desc, f"{style_key}_{k}"))
    return [j for j in jobs if not (OUT / f"{j[3]}.png").exists()]

def gen(job):
    style_key, tag, subj, fname = job
    tall = tag.endswith("-hero")
    style = STYLES[style_key]
    if style_key == "K6":
        nat = subj.startswith("[N] "); subj = subj[4:] if nat else subj
        style += K6_NAT if nat else K6_ARCH
    body = json.dumps({"model": "gpt-image-2.5-sunburst", "n": 1, "size": "1024x1536" if tall else "1536x1024",
                       "prompt": f"{subj}. Style: {style}. {COMPOSE_TALL if tall else COMPOSE}"}).encode()
    req = urllib.request.Request(f"{BASE}/images/generations", body,
                                 {"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    for attempt in range(4):  # 429 는 쉬었다 다시
        try:
            d = json.load(urllib.request.urlopen(req, timeout=240))
            (OUT / f"{fname}.png").write_bytes(base64.b64decode(d["data"][0]["b64_json"]))
            return f"ok   {fname}"
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:
                return f"FAIL {fname}: HTTP {e.code}"
            time.sleep(20 * (attempt + 1))
        except Exception as e:  # 키는 에러 문구에 안 실린다(헤더라서)
            return f"FAIL {fname}: {str(e)[:200]}"

if __name__ == "__main__":
    jobs = build_jobs(sys.argv[1], sys.argv[2].split(","))
    print(f"{len(jobs)}장 생성")
    with ThreadPoolExecutor(3) as ex:
        for r in ex.map(gen, jobs):
            print(r)
