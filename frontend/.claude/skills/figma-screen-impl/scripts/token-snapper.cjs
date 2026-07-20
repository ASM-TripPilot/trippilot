#!/usr/bin/env node
/**
 * token-snapper — Figma raw 값(hex/px/font size)을 이 프로젝트의 tailwind.config 커스텀 토큰으로 역매핑.
 *
 * 왜: Figma 화면 노드는 대개 변수 미바인딩이라 get_variable_defs가 빈 {} → design_context의 raw 값을
 *     tailwind.config(theme.extend)의 토큰과 대조해 "토큰 쓸 값"과 "일회성/브랜드 값"을 가른다.
 *     기계적 매핑(스크립트) + 미스 판단(사람)의 경계를 고정한다.
 *
 * 사용:
 *   node token-snapper.cjs <values.json> [--config path/to/tailwind.config.js] [--json]
 * values.json 예:
 *   [{ "type":"color", "value":"#ff385c", "role":"회원가입 버튼 bg" },
 *    { "type":"font",  "value":"22",      "role":"타이틀" },
 *    { "type":"radius","value":"12",      "role":"버튼" },
 *    { "type":"space", "value":"16",      "role":"섹션 gap" }]
 *
 * 출력: 값별 → 토큰(OK)/근접스냅(~)/MISS 표 + 요약. --json 이면 구조화 결과(프로그램 소비용).
 */
const path = require('path');
const fs = require('fs');

const TYPES = ['color', 'space', 'radius', 'font'];

function die(msg) {
  console.error('token-snapper: ' + msg);
  process.exit(2);
}

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
}
const valuesPath = process.argv[2];
if (!valuesPath || valuesPath.startsWith('--')) {
  die('usage: token-snapper.cjs <values.json> [--config <tailwind.config.js>] [--json]');
}

// --config 기본값은 cwd 기준이라 frontend/ 밖에서 부르면 못 찾는다.
// 스택트레이스 대신 무엇을 하라는지 알려준다(Claude가 "스크립트가 깨졌나"로 빠지지 않게).
const cfgPath = path.resolve(argVal('--config', 'tailwind.config.js'));
if (!fs.existsSync(cfgPath)) {
  die(
    'tailwind.config.js를 찾을 수 없습니다: ' + cfgPath +
    '\n  → frontend/ 에서 실행하거나 --config <경로>로 지정하세요.'
  );
}
let cfg;
try {
  cfg = require(cfgPath);
} catch (e) {
  die('tailwind.config.js를 읽지 못했습니다: ' + cfgPath + '\n  → ' + e.message);
}
const asJson = process.argv.includes('--json');

const ext = (cfg.theme && cfg.theme.extend) || {};
const groups = {
  color: ext.colors || {},
  space: ext.spacing || {},
  radius: ext.borderRadius || {},
  font: ext.fontSize || {},
};

/**
 * hex 정규화. 반환 { hex, alpha } — alpha는 'ff'(불투명)가 아니면 토큰 매칭 대상이 아니다.
 * 알파를 조용히 잘라내면 #FFFFFF00(완전 투명)이 흰색 토큰으로 OK 판정된다 —
 * 사람은 MISS만 검토하므로 그 오답은 아무도 못 본다. 확신에 찬 오답이 최악의 실패다.
 * 반환 null = hex 형식이 아님.
 */
function normHex(h) {
  const s = String(h).trim().toLowerCase();
  const m = s.match(/^#([0-9a-f]+)$/);
  if (!m) return null;
  const x = m[1];
  const expand = (c) => c + c;
  if (x.length === 3) return { hex: '#' + x.split('').map(expand).join(''), alpha: 'ff' };
  if (x.length === 4) return { hex: '#' + x.slice(0, 3).split('').map(expand).join(''), alpha: expand(x[3]) };
  if (x.length === 6) return { hex: '#' + x, alpha: 'ff' };
  if (x.length === 8) return { hex: '#' + x.slice(0, 6), alpha: x.slice(6) };
  return null; // 5·7자리 등 잘못된 길이
}
const hexKey = (h) => {
  const n = normHex(h);
  return n ? n.hex : String(h).trim().toLowerCase();
};
const num = (v) => parseFloat(String(v));
const sizeOf = (v) => (Array.isArray(v) ? v[0] : v); // fontSize는 ['22px',{lineHeight}] 형태 가능

// value(정규화) → [토큰명...] (동률 값은 여러 토큰이 붙음)
function reverse(map, kind) {
  const rev = {};
  for (const [name, raw] of Object.entries(map)) {
    const key = kind === 'color' ? hexKey(raw) : num(sizeOf(raw));
    (rev[key] = rev[key] || []).push(name);
  }
  return rev;
}
const rev = {
  color: reverse(groups.color, 'color'),
  space: reverse(groups.space),
  radius: reverse(groups.radius),
  font: reverse(groups.font, 'font'),
};

// 동률 후보(같은 값에 여러 토큰: 예 #ffffff=canvas·on-primary, 12px=button·input·thumb) disambiguation용
// role 키워드 힌트(한글/영문). 관찰된 모호 그룹을 커버하며 프로젝트에 맞게 확장한다.
const ROLE_HINTS = {
  canvas: ['배경', 'background', 'bg', '화면', 'surface'],
  'on-primary': ['버튼 텍스트', '버튼 라벨', 'on-primary', '흰 글자', 'white text', 'cta 텍스트'],
  button: ['버튼', 'btn', 'button', 'cta'],
  input: ['인풋', 'input', '입력', '필드', 'field'],
  thumb: ['썸네일', 'thumb', '이미지', '카드'],
};

// 동률 후보 중 선택: role에 토큰명 직접 포함(2점) + ROLE_HINTS 키워드 포함(1점씩). 점수 0이면 config 순서(첫번째).
function pick(names, role) {
  if (names.length === 1) return { primary: names[0], alt: [] };
  const r = String(role || '').toLowerCase();
  const score = (n) => {
    let s = r.includes(n.toLowerCase()) ? 2 : 0;
    for (const kw of ROLE_HINTS[n] || []) if (r.includes(kw.toLowerCase())) s += 1;
    return s;
  };
  const ranked = [...names].sort((a, b) => score(b) - score(a));
  const primary = score(ranked[0]) > 0 ? ranked[0] : names[0];
  return { primary, alt: names.filter((n) => n !== primary) };
}

// 토큰 그룹이 비어 있으면 best가 null로 남아 revMap[null]=undefined가 된다 → 호출측에서 null 처리.
function nearest(revMap, v) {
  let best = null, bd = Infinity;
  for (const k of Object.keys(revMap)) {
    const d = Math.abs(Number(k) - v);
    if (d < bd) { bd = d; best = k; }
  }
  if (best === null) return null;
  return { names: revMap[best], val: Number(best), delta: Math.round(bd * 1000) / 1000 };
}

/**
 * 근접 스냅 허용 오차(px). Figma auto-layout의 반올림 오차는 흡수하되
 * 디자이너가 의도한 차이는 보존하는 선. 값이 클수록 서로 다른 토큰이 뭉개진다.
 *   radius 1.0 — 1px 차이는 모서리 인상이 같다. 2px부터는 다른 토큰일 가능성이 높아 사람이 봐야 한다.
 *   font   0.5 — 폰트는 0.5px도 행높이 계산에 영향을 준다. 가장 보수적으로 둔다.
 *   space  1.5 — 간격은 Figma 반올림으로 1~2px가 흔히 흔들린다. 그 이상은 의도된 차이로 본다.
 * 이 값들은 관측 기반 초기값이다 — MISS/스냅 판정이 실전과 어긋나면 여기를 조정하고 사유를 남긴다.
 */
const SNAP_TOLERANCE = { radius: 1, font: 0.5, space: 1.5 };

function snap(it) {
  const { type, value, role } = it;

  // 지원하지 않는 type을 'no-token'으로 뭉개면 "그라디언트/브랜드색 → raw 하드코딩"으로 오독된다.
  // 이 스킬의 존재 이유(raw 남발 차단)와 정반대라 별도 사유로 가른다.
  if (!TYPES.includes(type)) {
    return { status: 'miss', reason: 'unknown-type' };
  }

  if (type === 'color') {
    const n = normHex(value);
    if (!n) return { status: 'miss', reason: 'bad-hex' };
    // 반투명 값은 토큰이 아니다 — 알파를 잘라내고 매칭하면 확신에 찬 오답이 된다.
    if (n.alpha !== 'ff') return { status: 'miss', reason: 'alpha', alpha: n.alpha, base: n.hex };
    const names = rev.color[n.hex];
    if (!names) return { status: 'miss', reason: 'no-token' };
    const p = pick(names, role);
    return { status: 'ok', token: p.primary, alt: p.alt };
  }

  const v = num(value);
  if (Number.isNaN(v)) return { status: 'miss', reason: 'bad-number' };
  const rm = rev[type];
  if (!rm || Object.keys(rm).length === 0) return { status: 'miss', reason: 'empty-group' };
  if (rm[v]) {
    const p = pick(rm[v], role);
    return { status: 'ok', token: p.primary, alt: p.alt };
  }
  const nr = nearest(rm, v);
  if (!nr) return { status: 'miss', reason: 'empty-group' };
  if (nr.delta <= SNAP_TOLERANCE[type]) {
    const p = pick(nr.names, role);
    return { status: 'snap', token: p.primary, alt: p.alt, from: v, to: nr.val };
  }
  return { status: 'miss', reason: 'one-off', nearest: nr.names[0], nearestVal: nr.val, delta: nr.delta };
}

const valuesAbs = path.resolve(valuesPath);
if (!fs.existsSync(valuesAbs)) die('입력 파일이 없습니다: ' + valuesAbs);
let values;
try {
  values = require(valuesAbs);
} catch (e) {
  die('입력 JSON을 읽지 못했습니다: ' + valuesAbs + '\n  → ' + e.message);
}
if (!Array.isArray(values)) {
  die('입력은 배열이어야 합니다: [{ "type":"color", "value":"#ff385c", "role":"..." }, ...]');
}
const results = values.map((it) => ({ type: it.type, value: it.value, role: it.role, ...snap(it) }));

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

let ok = 0, sn = 0, miss = 0;
function fmt(r) {
  if (r.status === 'ok') {
    ok++;
    return 'OK   ' + r.token + (r.alt.length ? '  (동률: ' + r.alt.join('/') + ' — role로 확인)' : '');
  }
  if (r.status === 'snap') {
    sn++;
    return '~    ' + r.token + '  (' + r.from + '->' + r.to + ' 스냅)';
  }
  miss++;
  switch (r.reason) {
    case 'one-off':
      return 'MISS 일회성/임의값 (근접 ' + r.nearest + '=' + r.nearestVal + ', d' + r.delta + ')';
    case 'alpha':
      return 'MISS 반투명 (알파 ' + r.alpha + ' — 토큰 아님. 불투명 ' + r.base + '는 별도 확인)';
    case 'unknown-type':
      return 'MISS 지원 안 하는 type (' + TYPES.join('|') + ' 중 하나여야 함 — 오타 확인)';
    case 'bad-hex':
      return 'MISS hex 형식 아님 (#rgb·#rgba·#rrggbb·#rrggbbaa)';
    case 'bad-number':
      return 'MISS 숫자로 못 읽음';
    case 'empty-group':
      return 'MISS tailwind.config에 해당 토큰 그룹이 비어 있음';
    default:
      return 'MISS 토큰 없음 (그라디언트/브랜드색 → raw)';
  }
}
console.log('type   value            role                        → 우리 토큰 / MISS');
console.log('-'.repeat(92));
for (const r of results) {
  console.log(String(r.type).padEnd(6) + ' ' + String(r.value).padEnd(16) + ' ' + String(r.role || '').padEnd(27) + ' ' + fmt(r));
}
console.log('-'.repeat(92));
console.log('합계 ' + results.length + ' · OK ' + ok + ' · 스냅 ' + sn + ' · MISS ' + miss + '  (MISS=디자인시스템 토큰 아닌 값 → 사람 판단)');
