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

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
}
const valuesPath = process.argv[2];
if (!valuesPath || valuesPath.startsWith('--')) {
  console.error('usage: token-snapper.cjs <values.json> [--config <tailwind.config.js>] [--json]');
  process.exit(2);
}
const cfgPath = path.resolve(argVal('--config', 'tailwind.config.js'));
const asJson = process.argv.includes('--json');

const cfg = require(cfgPath);
const ext = (cfg.theme && cfg.theme.extend) || {};
const groups = {
  color: ext.colors || {},
  space: ext.spacing || {},
  radius: ext.borderRadius || {},
  font: ext.fontSize || {},
};

const normHex = (h) => {
  h = String(h).trim().toLowerCase();
  const m = h.match(/^#([0-9a-f]{3,8})$/);
  if (!m) return h;
  let x = m[1];
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  return '#' + x.slice(0, 6);
};
const num = (v) => parseFloat(String(v));
const sizeOf = (v) => (Array.isArray(v) ? v[0] : v); // fontSize는 ['22px',{lineHeight}] 형태 가능

// value(정규화) → [토큰명...] (동률 값은 여러 토큰이 붙음)
function reverse(map, kind) {
  const rev = {};
  for (const [name, raw] of Object.entries(map)) {
    const key = kind === 'color' ? normHex(raw) : num(sizeOf(raw));
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

function nearest(revMap, v) {
  let best = null, bd = Infinity;
  for (const k of Object.keys(revMap)) {
    const d = Math.abs(Number(k) - v);
    if (d < bd) { bd = d; best = k; }
  }
  return { names: revMap[best], val: Number(best), delta: Math.round(bd * 1000) / 1000 };
}

function snap(it) {
  const { type, value, role } = it;
  if (type === 'color') {
    const names = rev.color[normHex(value)];
    if (!names) return { status: 'miss', reason: 'no-token' };
    const p = pick(names, role);
    return { status: 'ok', token: p.primary, alt: p.alt };
  }
  const v = num(value);
  const rm = rev[type];
  if (!rm || Number.isNaN(v)) return { status: 'miss', reason: 'no-token' };
  if (rm[v]) {
    const p = pick(rm[v], role);
    return { status: 'ok', token: p.primary, alt: p.alt };
  }
  const nr = nearest(rm, v);
  const tol = type === 'radius' ? 1 : type === 'font' ? 0.5 : 1.5;
  if (nr.delta <= tol) {
    const p = pick(nr.names, role);
    return { status: 'snap', token: p.primary, alt: p.alt, from: v, to: nr.val };
  }
  return { status: 'miss', reason: 'one-off', nearest: nr.names[0], nearestVal: nr.val, delta: nr.delta };
}

const values = require(path.resolve(valuesPath));
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
  return r.reason === 'one-off'
    ? 'MISS 일회성/임의값 (근접 ' + r.nearest + '=' + r.nearestVal + ', d' + r.delta + ')'
    : 'MISS 토큰 없음 (그라디언트/브랜드색 → raw)';
}
console.log('type   value            role                        → 우리 토큰 / MISS');
console.log('-'.repeat(92));
for (const r of results) {
  console.log(String(r.type).padEnd(6) + ' ' + String(r.value).padEnd(16) + ' ' + String(r.role || '').padEnd(27) + ' ' + fmt(r));
}
console.log('-'.repeat(92));
console.log('합계 ' + results.length + ' · OK ' + ok + ' · 스냅 ' + sn + ' · MISS ' + miss + '  (MISS=디자인시스템 토큰 아닌 값 → 사람 판단)');
