/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

/**
 * TRIP-774 · l02 알림 설정 Figma 정합 — 소스 가드.
 *
 * 무엇을 보장하나:
 *  - AC-3: `ToggleRow`·화면에 옛 칸 폭 `w-[52px]` 가 0건(780 이 "774 몫"으로 남긴 조각).
 *  - AC-4(01b Q2=A): "권한 필요" 칩 Text 가 `numberOfLines={1}` 로 한 줄이고, 칩을 감싼 어떤 조상도
 *    숫자 고정 폭(`w-[..]`·`max-w-..`)이 아니다 — 칩이 좁은 칸에 갇혀 두 줄로 꺾이던 결함.
 *  - AC-5: 바뀌는 `.tsx` 3개가 토큰이 있는 색을 raw hex 로 쓰지 않는다(그림자 `#000000`·MISS `#C4C9CF` 제외).
 *
 * 왜 소스인가: 칩은 푸시 개통 플래그(TRIP-939) 뒤라 렌더로 닿지 않는다. "칩을 감싼 칸"은 JSX 중첩
 * 관계라 정규식으로는 어느 `<View` 가 조상인지 모른다 → TypeScript 구문 트리로 부모를 따라 올라간다.
 * 구문 트리에는 주석이 노드로 들어오지 않는다. 문자열 스캔(AC-3·5)은 주석을 걷고 본다.
 */

const ROOT = path.resolve('src');
const UI = 'features/notification/ui';
const SCREEN = `${UI}/NotificationSettingsScreen.tsx`;
const TOGGLE_ROW = `${UI}/ToggleRow.tsx`;
const BANNER = `${UI}/PermissionBanner.tsx`;

const OLD_CELL = 'w-[52px]';
const CHIP_COPY = '권한 필요';
/** 숫자 고정 폭 — `min-w-*`(앞 글자 `-`)·`w-full`·`w-auto` 는 안 잡는다. */
const FIXED_WIDTH = /(?:^|[\s"'`{])(?:max-)?w-(?:\[\d|\d)/;

/** tailwind 토큰으로 이미 있는 색 — sharedToggleStructure 와 같은 목록. */
const TOKENIZED_HEX = [
  '#ffffff',
  '#222222',
  '#6a6a6a',
  '#9aa1ab',
  '#dddddd',
  '#ededed',
  '#ff385c',
  '#f7f7f7',
  '#ffe4e9',
  '#3f3f3f',
  '#f2f2f2',
  '#fafafa',
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

interface ChipInfo {
  tag: string;
  numberOfLines: string | undefined;
  ancestorClassNames: string[];
}

/** "권한 필요" 글자를 품은 가장 가까운 JSX 요소(칩 Text)와 그 JSX 조상들의 className 원문. */
function findChipTexts(source: string): ChipInfo[] {
  const sf = ts.createSourceFile(
    'screen.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const attr = (el: ts.JsxElement, name: string) =>
    el.openingElement.attributes.properties.find(
      (a): a is ts.JsxAttribute =>
        ts.isJsxAttribute(a) && a.name.getText(sf) === name
    );

  const hits: ts.JsxElement[] = [];
  const visit = (node: ts.Node): void => {
    const isCopy =
      (ts.isJsxText(node) && node.text.trim() === CHIP_COPY) ||
      (ts.isStringLiteral(node) &&
        node.text === CHIP_COPY &&
        ts.isJsxExpression(node.parent));
    if (isCopy) {
      let p: ts.Node | undefined = node.parent;
      while (p && !ts.isJsxElement(p)) p = p.parent;
      if (p) hits.push(p);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return hits.map((el) => {
    const ancestorClassNames: string[] = [];
    let p: ts.Node | undefined = el.parent;
    while (p) {
      if (ts.isJsxElement(p)) {
        ancestorClassNames.push(
          attr(p, 'className')?.initializer?.getText(sf) ?? ''
        );
      }
      p = p.parent;
    }
    return {
      tag: el.openingElement.tagName.getText(sf),
      numberOfLines: attr(el, 'numberOfLines')
        ?.initializer?.getText(sf)
        .replace(/\s/g, ''),
      ancestorClassNames,
    };
  });
}

describe('탐지기 자가검사 — 전처리·구문 트리가 탐지 대상을 지우지 않는다', () => {
  it('주석 속 w-[52px] 는 걷히고 코드 속 1건은 남는다', () => {
    const sample = [
      '// 옛 칸 w-[52px]',
      '/** w-[52px] 설명 */',
      '<View className="w-[52px] items-center" />',
    ].join('\n');

    expect(count(stripComments(sample), OLD_CELL)).toBe(1);
  });

  it('칩 탐지기는 주석을 무시하고 코드 속 칩만 찾으며, 고정 폭 판정 경계가 맞다', () => {
    const sample = `
      // <View className="w-[52px]"><Text>${CHIP_COPY}</Text></View>
      /* ${CHIP_COPY} */
      const a = (
        <View className="max-w-[52px]">
          <View className="min-w-[46px] w-full items-end">
            <View className={\`rounded-[8px] \${x}\`}>
              <Text numberOfLines={ 1 }>{'${CHIP_COPY}'}</Text>
            </View>
          </View>
        </View>
      );`;

    const chips = findChipTexts(sample);

    expect(chips).toHaveLength(1);
    expect(chips[0].tag).toBe('Text');
    expect(chips[0].numberOfLines).toBe('{1}');
    expect(chips[0].ancestorClassNames.map((c) => FIXED_WIDTH.test(c))).toEqual(
      [false, false, true]
    );
  });
});

describe('TRIP-774 · AC-3 — 옛 칸 폭 w-[52px] 0건', () => {
  it.each([
    [TOGGLE_ROW, '<Toggle'],
    [SCREEN, '인앱'],
  ])('%s 에 w-[52px] 가 없다', (rel, anchor) => {
    const source = read(rel);

    // 짝 앵커 — 경로 오타·빈 파일이면 여기서 red.
    expect(source).toContain(anchor);
    expect(count(source, OLD_CELL)).toBe(0);
  });
});

describe('TRIP-774 · AC-4 (01b Q2=A) — "권한 필요" 칩 한 줄', () => {
  it('칩 Text 는 numberOfLines={1} 이고, 감싼 조상 어디에도 숫자 고정 폭이 없다', () => {
    // 준비·실행: 화면 소스의 구문 트리에서 칩과 조상 className 을 모은다.
    const chips = findChipTexts(
      fs.readFileSync(path.join(ROOT, SCREEN), 'utf8')
    );

    // 단언: 칩은 화면에 정확히 1개, Text, 한 줄 고정.
    expect(chips).toHaveLength(1);
    expect(chips[0].tag).toBe('Text');
    expect(chips[0].numberOfLines).toBe('{1}');
    // 단언: 칩이 넓어질 수 있다 — 고정 폭 조상 0개.
    expect(
      chips[0].ancestorClassNames.filter((c) => FIXED_WIDTH.test(c))
    ).toEqual([]);
  });
});

describe('TRIP-774 · AC-5 — 바뀌는 .tsx 에 토큰화된 색 raw hex 0', () => {
  it('화면·ToggleRow·PermissionBanner 가 토큰 경유로만 색을 쓴다', () => {
    const offenders = [SCREEN, TOGGLE_ROW, BANNER].flatMap((rel) => {
      const source = read(rel).toLowerCase();
      // 짝 앵커 — 빈 스캔이면 red.
      expect(source).toContain('classname');
      return TOKENIZED_HEX.filter((hex) => source.includes(hex)).map(
        (hex) => `${rel}: ${hex}`
      );
    });

    expect(offenders).toEqual([]);
  });
});
