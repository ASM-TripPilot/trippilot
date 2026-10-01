#!/usr/bin/env python3
# test-classify.py — 테스트 파일을 칸으로 분류한다(README §테스트 전략 · TRIP-1138 정리의 판정 입력).
#   python3 scripts/test-classify.py   → _workspace/test-measure/classification.csv + 요약 출력
# 칸: D 개발도구(_dev 프리뷰) / B 소스스캔(렌더 없음) / C PBT(렌더 없음) / A 행동(렌더) / U 단위(나머지)
# ponytail: 정규식 휴리스틱 — 경계(스캔+렌더 혼합)는 요약의 '경계 후보'로 따로 센다. 판정이 갈리면 사람이 본다.
import csv, re, subprocess, collections, os

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
files = [f for f in subprocess.check_output(['git', 'ls-files', 'src'], text=True).split()
         if re.search(r'\.(ts|tsx)$', f) and re.search(r'__tests__/|\.test\.', f)]

R = {
    'scan': re.compile(r'readFileSync|readdirSync|globSync|existsSync|walk\w*\('),
    'render': re.compile(r'\brender\w*\(|renderHook\(|\bscreen\.'),
    'pbt': re.compile(r"from 'fast-check'|require\('fast-check'\)"),
    'dev': re.compile(r"_dev/|devPreview|/preview'"),
    'title': re.compile(r"\b(?:it|test|describe)(?:\.\w+)?\(\s*(['\"`])(.*?)\1", re.S),
    'target': re.compile(r"from '@/((?:pages|features|widgets|entities|shared)/[\w-]+)"),
}

rows = []
for f in files:
    s = open(f, encoding='utf-8').read()
    lines = s.count('\n') + 1
    titles = [m.group(2) for m in R['title'].finditer(s)]
    tickets = sorted({t for x in titles for t in re.findall(r'TRIP-\d+', x)})
    has = {k: bool(R[k].search(s)) for k in ('scan', 'render', 'pbt')}
    dev = bool(R['dev'].search(s)) or 'devPreview' in f or 'preview' in f.lower()
    if dev: cat = 'D'
    elif has['scan'] and not has['render']: cat = 'B'
    elif has['pbt'] and not has['render']: cat = 'C'
    elif has['render']: cat = 'A'
    else: cat = 'U'
    area = f.split('/')[1] + ('/' + f.split('/')[2] if f.split('/')[1] in ('features', 'pages', 'widgets', 'entities', 'shared') else '')
    targets = collections.Counter(R['target'].findall(s))
    rows.append(dict(file=f, cat=cat, lines=lines, cases=len([t for t in titles]), integration='.integration.' in f,
                     scan=has['scan'], render=has['render'], pbt=has['pbt'], tickets=len(tickets),
                     ticket_ids=' '.join(tickets), area=area,
                     target=targets.most_common(1)[0][0] if targets else ''))

out = '_workspace/test-measure'
os.makedirs(out, exist_ok=True)
with open(f'{out}/classification.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)

# 요약
def agg(key):
    c = collections.defaultdict(lambda: [0, 0])
    for r in rows: c[r[key]][0] += 1; c[r[key]][1] += r['lines']
    return sorted(c.items(), key=lambda x: -x[1][1])

print('== 칸별'); [print(f'{k:3} {n:4}파일 {l:7}줄') for k, (n, l) in agg('cat')]
print(f"합계 {len(rows)}파일 {sum(r['lines'] for r in rows)}줄")
print('\n== 티켓 번호 달린 파일', sum(1 for r in rows if r['tickets']), '줄', sum(r['lines'] for r in rows if r['tickets']))
print('   칸별:', dict(collections.Counter(r['cat'] for r in rows if r['tickets'])))
print('\n== 혼합(스캔+렌더) = 경계 후보', sum(1 for r in rows if r['scan'] and r['render'] and r['cat'] != 'D'))
print('\n== 영역별 상위 15'); [print(f'{k:40} {n:4}파일 {l:7}줄') for k, (n, l) in agg('area')[:15]]
print('\n== 같은 대상을 여러 파일이 테스트 (A칸, 상위 15)')
t = collections.defaultdict(list)
for r in rows:
    if r['cat'] == 'A' and r['target']: t[r['target']].append(r)
for k, v in sorted(t.items(), key=lambda x: -sum(r['lines'] for r in x[1]))[:15]:
    print(f"{k:40} {len(v):3}파일 {sum(r['lines'] for r in v):6}줄")
