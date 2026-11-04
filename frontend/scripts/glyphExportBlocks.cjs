// TRIP-1773 · 글리프 이름 겹침 가드의 "금지 이름 계산" — 디스크를 읽지 않는 순수 함수라 eslint.config.js 와 단위 테스트가 같이 쓴다.
//
// 입력: { '루트 기준 상대 경로': 소스 문자열 } (`*Glyphs.tsx` 들).
// 출력: eslint flat config 에 그대로 펼치는 블록 배열.
//   [0] catch-all { files: ['src/**/*Glyphs.tsx'], … 전체 이름 } — 어느 실파일도 아닌 새 글리프 파일용
//   [1…] 파일마다 { files: [그 파일], … "그 파일이 아닌 다른 파일이 정의한 이름의 합집합" } — catch-all 뒤에서 덮어쓴다
// 금지 목록이 "전체 − 내 이름"이 아니라 "다른 파일의 합집합"인 이유: 두 파일이 같은 이름을 정의하면 서로 자기 이름이라 양쪽 다 면제돼 가드가 영영 안 울린다.
//
// "정의"로 거두는 것(바깥 이름 기준): `export [async] function X` · `export const X` · `export { X }` · `export { Y as X }`.
// 안 거두는 것: `export { X } from '…'`(재수출 — 정의자가 아니다. 린트가 그 줄을 직접 잡는다) · `export type/interface` · `export *`(이름이 없어 룰도 못 본다).
// 알려진 오탐: 공용 이름을 import 해 `export { X }` 로 되내보내면 슬라이스 파일과 공용 원본 양쪽에 error 가 뜬다(린트는 실패해 안전, 범인 위치만 흐림) — 재수출은 `export { X } from '…'` 로 쓴다.
// 이름 조건: 대문자로 시작하고 소문자가 하나라도 있어야 한다(`MUTED`·`GLYPH_COLORS` 같은 ALL_CAPS 상수 제외, `UIDupGlyph`·`AIGlyph` 는 포함).

const DECL = /^export (?:async )?(?:function|const) ([A-Za-z_]\w*)/gm;
const LIST = /^export\s*\{([^}]*)\}\s*(from\b)?/gm;
const isComponentName = (n) => /^[A-Z]\w*$/.test(n) && /[a-z]/.test(n);

const definedNames = (source) => {
  const names = new Set();
  for (const [, name] of source.matchAll(DECL)) names.add(name);
  for (const [, list, fromClause] of source.matchAll(LIST)) {
    if (fromClause) continue;
    for (const spec of list.split(',')) {
      const outer = spec
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (outer) names.add(outer);
    }
  }
  return [...names].filter(isComponentName);
};

const block = (files, names) => ({
  files,
  rules: {
    'no-restricted-exports': ['error', { restrictedNamedExports: names }],
  },
});

function glyphExportBlocks(sources) {
  const definedIn = new Map(); // 이름 → 그 이름을 정의한 파일들
  for (const [file, source] of Object.entries(sources)) {
    for (const name of definedNames(source)) {
      if (!definedIn.has(name)) definedIn.set(name, new Set());
      definedIn.get(name).add(file);
    }
  }
  const forbiddenIn = (file) =>
    [...definedIn]
      .filter(([, files]) => [...files].some((f) => f !== file))
      .map(([name]) => name);
  return [
    block(['src/**/*Glyphs.tsx'], [...definedIn.keys()]),
    ...Object.keys(sources).map((file) => block([file], forbiddenIn(file))),
  ];
}

module.exports = { glyphExportBlocks };
