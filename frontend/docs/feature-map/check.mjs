// 기능 지도 대조: (1) 어느 기능 파일 routes 에도 없는 app/ 라우트, (2) routes 에 적혔는데 없는 파일, (3) 코드에 없는 testID,
// (4) e2e/*.yaml 의 파일 이름·tags 가 지도에 없는 기능 ID. 끝에 E2E 로 덮인 기능 수를 보고한다.
// 실행: frontend/ 에서 `node docs/feature-map/check.mjs` — 하나라도 있으면 exit 1.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const mapDir = join(root, 'docs/feature-map');

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const routes = walk(join(root, 'app'))
  .map((p) => relative(root, p))
  .filter(
    (p) =>
      p.endsWith('.tsx') && !p.includes('/_dev/') && !p.endsWith('_layout.tsx')
  );

const source = walk(join(root, 'src'))
  .filter(
    (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.includes('__')
  )
  .concat(walk(join(root, 'app')).filter((p) => p.endsWith('.tsx')))
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');

// 코드의 템플릿 testID(`pref-${slug}`)는 고정 접두로 모은다 — 지도는 실제 값(`pref-art`)으로 풀어 적는다
const templatePrefixes = [...source.matchAll(/`([\w-]+)\$\{/g)]
  .map((m) => m[1])
  .filter((p) => p.length >= 4);
// 위젯이 접두 prop 뒤에 붙이는 꼬리(`${testIDPrefix}-row`) — 접두 값은 호출처에 문자열로 있다
const templateSuffixes = [...source.matchAll(/\}(-[\w-]+)`/g)].map((m) => m[1]);
// 가운데 꼬리(`${testIDPrefix}-menu-${id}`)는 다른 템플릿 문자열과 안 섞이게 접두 prop 만, 접두 값도 prop 대입으로만 인정한다
const prefixPropTails = [
  ...source.matchAll(/\$\{\w*[pP]refix\w*\}(-[\w-]+?)-?\$\{/g),
].map((m) => m[1]);
const existsInCode = (id) => {
  // 변수 자리 표기(`${x}`·`{x}`·`<x>`·`*`) 앞까지가 고정 부분이다
  const fixed = id.split(/\$\{|\{|<|\*/)[0].replace(/[-_]$/, '');
  if (
    source.includes(fixed) ||
    templatePrefixes.some((p) => fixed.startsWith(p))
  )
    return true;
  return (
    templateSuffixes.some(
      (s) =>
        fixed.endsWith(s) &&
        new RegExp(`['"]${fixed.slice(0, -s.length)}['"]`).test(source)
    ) ||
    prefixPropTails.some(
      (s) =>
        fixed.endsWith(s) &&
        new RegExp(
          `[pP]refix\\w*[=:]\\s*\\{?['"]${fixed.slice(0, -s.length)}['"]`
        ).test(source)
    )
  );
};

const covered = new Set();
const problems = [];
const featureOf = new Map(); // 하위 기능 ID·파일 id → 기능 파일 id

for (const f of readdirSync(mapDir).filter(
  (n) => n.endsWith('.md') && n !== 'README.md'
)) {
  const text = readFileSync(join(mapDir, f), 'utf8');
  const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const fileId = front.match(/^id:\s*(\S+)/m)?.[1] ?? f.replace(/\.md$/, '');
  featureOf.set(fileId, fileId);
  // Sub-features 절 불릿 머리의 `id`(여러 개면 `a`/`b`·`a`·`b`)
  const subs = text.match(/^## Sub-features\n([\s\S]*?)^## /m)?.[1] ?? '';
  for (const [, head] of subs.matchAll(/^- (`[^`]+`(?:[/·]`[^`]+`)*)/gm))
    for (const [, id] of head.matchAll(/`([^`]+)`/g)) featureOf.set(id, fileId);
  const listed = [
    ...front.matchAll(/^\s*-\s*['"]?(app\/[^'"\s]+)['"]?\s*$/gm),
  ].map((m) => m[1]);
  if (!/^routes:/m.test(front))
    problems.push(
      `${f}: frontmatter routes 가 없다 (라우트 없는 기능은 routes: [])`
    );
  for (const r of listed) {
    if (!existsSync(join(root, r)))
      problems.push(`${f}: routes 의 ${r} 파일이 없다`);
    covered.add(r);
  }
  for (const [, id] of text.matchAll(/testID:\s*`([^`]+)`/g)) {
    if (!existsInCode(id))
      problems.push(`${f}: testID \`${id}\` 가 코드에 없다`);
  }
}

for (const r of routes)
  if (!covered.has(r)) problems.push(`미배정 라우트: ${r}`);

// E2E 흐름: 파일 이름과 tags 가 곧 덮는 기능 ID 다 — 지도에 없는 ID 면 실패
const e2eDir = join(root, 'e2e');
const e2eIds = new Set();
for (const f of readdirSync(e2eDir).filter((n) => n.endsWith('.yaml'))) {
  const head = readFileSync(join(e2eDir, f), 'utf8').split(/^---$/m)[0];
  // YAML 파서 없이 읽는 대신 표기를 하나로 묶는다 — 다른 표기(인라인 [a, b] 등)가 조용히 안 읽히면 없는 ID 가 통과하니 실패시킨다
  const lines = head
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '').trimEnd())
    .filter(Boolean);
  const start = lines.findIndex((l) => /^tags:/.test(l));
  const ids = [f.replace(/\.yaml$/, '')];
  if (start >= 0) {
    if (lines[start] !== 'tags:')
      problems.push(`e2e/${f}: tags 는 줄마다 \`- id\` 목록으로 쓴다`);
    for (const line of lines.slice(start + 1)) {
      const tag = line.match(/^\s*- ['"]?([^'"\s]+)['"]?$/);
      if (!tag) break;
      ids.push(tag[1]);
    }
  }
  for (const id of ids) {
    if (featureOf.has(id)) e2eIds.add(id);
    else problems.push(`e2e/${f}: 기능 지도에 없는 ID \`${id}\``);
  }
}
const allFeatures = new Set(featureOf.values());
const e2eFeatures = new Set([...e2eIds].map((id) => featureOf.get(id)));

console.log(
  problems.length
    ? problems.join('\n')
    : `OK — 라우트 ${routes.length}개 전부 배정, testID 전부 실재`
);
console.log(
  `E2E 로 덮인 기능 ${e2eFeatures.size}/${allFeatures.size} (ID ${e2eIds.size}/${featureOf.size}): ${[...e2eFeatures].sort().join(', ')}`
);
process.exit(problems.length ? 1 : 0);
