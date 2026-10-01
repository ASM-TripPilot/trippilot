/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

/**
 * TRIP-1125 · 스켈레톤 교체·모션 소스 가드(AC-6·AC-8·AC-17).
 *
 * 무엇을 보장하나:
 *  - G1: 로딩 회색 잎 44자리(15파일)가 `@/shared/ui/Skeleton` 으로 바뀌었고, 모양(className 토큰)이 그대로
 *    옮겨졌으며, 로딩 밖 회색 잎(사진 배경·빈 상태 콜라주·구분선·행 썸네일)은 그대로 남고 Skeleton 이
 *    되지 않았다.
 *  - G2: 이번 변경 파일에 `setTimeout`/`setInterval` 이 없다 — `features/record`·`home`·`stay`·`trip` 은
 *    디렉토리 타이머 가드가 없어서 변경 파일 목록 기준으로 잰다. 동작 줄이기는 공용 게이트 한 곳만 묻는다.
 *
 * 왜 AST 인가: 같은 회색 토큰을 사진 배경·콜라주·구분선이 쓰고, 스켈레톤과 className 이 글자까지 같은
 * 비-스켈레톤 잎도 있다(저장 숙소 썸네일). 그래서 "파일 전체 회색 View 0개"로는 못 걸고, **자식 없는
 * View(잎)** 만 모아 남아야 할 것을 파일별 다중집합으로 정확히 맞춘다. JSX 주석은 AST 에서 식이 없는
 * 표현식이라 전처리 없이 걸러진다(G0 이 실제 문자열로 확인한다).
 */

const ROOT = path.resolve('src');

const GRAY = /(?<![\w-])bg-(surface-strong|surface-soft|hairline)(?![\w/-])/;
const LEAF_TAGS = ['View', 'Animated.View'];
const SKELETON_IMPORT = "from '@/shared/ui/Skeleton'";

const PHOTO_BACKDROP = 'absolute inset-0 bg-surface-strong';
const EMPTY_COLLAGE = 'h-[118px] w-[74px] rounded-card bg-surface-strong';
const DIVIDER = 'h-[1px] bg-hairline';
const ROW_THUMB = 'h-20 w-[104px] rounded-thumb bg-surface-strong';
const PICK_CIRCLE = 'h-[26px] w-[26px] rounded-pill bg-surface-strong';
const PICK_TITLE = 'h-[15px] w-2/3 rounded-[6px] bg-hairline';
const PICK_SUB = 'h-[13px] w-1/2 rounded-[6px] bg-surface-strong';

/**
 * 교체 대상 15파일(브리프 §4 12파일 + 01b Q1 3파일). `skeletons` = 그 파일의 `<Skeleton>` className
 * **다중집합**(같은 모양이 두 자리면 두 번 적는다 — 합계 44), `keep` = 교체 뒤에도 남아야 할 회색 잎
 * (다중집합 — 로딩 밖이라 스켈레톤이 아니다). 표의 출처는 develop 기준 원본의 회색 잎 − `keep` 이다.
 */
const REPLACED: Record<string, { skeletons: string[]; keep: string[] }> = {
  'features/home/ui/HomeScreen.tsx': {
    skeletons: [
      'h-[300px] w-[230px] rounded-[18px] bg-surface-strong',
      'h-[166px] flex-1 rounded-card bg-surface-strong',
      'h-[470px] w-full bg-surface-strong',
    ],
    keep: Array(5).fill(PHOTO_BACKDROP),
  },
  'features/stay/ui/SkeletonList.tsx': {
    skeletons: [
      'h-[178px] w-full rounded-card bg-surface-strong',
      'h-[14px] w-2/3 rounded-[6px] bg-hairline',
      'h-[12px] w-1/2 rounded-[6px] bg-surface-strong',
      'h-[16px] w-1/3 rounded-[6px] bg-surface-strong',
    ],
    keep: [],
  },
  'features/stay/ui/StayRegisterScreen.tsx': {
    skeletons: Array(2).fill('h-16 w-full rounded-button bg-surface-strong'),
    keep: [],
  },
  'features/explore/ui/PlaceExploreScreen.tsx': {
    skeletons: [
      'h-[132px] w-full rounded-[14px] bg-surface-strong',
      'h-[13px] w-2/3 rounded-[6px] bg-hairline',
      'h-[11px] w-1/2 rounded-[6px] bg-surface-strong',
    ],
    keep: [],
  },
  'pages/saved-places/ui/MustVisitPickScreen.tsx': {
    skeletons: [PICK_CIRCLE, PICK_CIRCLE, ROW_THUMB, PICK_TITLE, PICK_SUB],
    keep: [EMPTY_COLLAGE, EMPTY_COLLAGE],
  },
  'features/explore/ui/ExploreLandingScreen.tsx': {
    skeletons: ['rounded-card bg-surface-soft'],
    keep: [],
  },
  'pages/saved-places/ui/SavedPlaceListScreen.tsx': {
    skeletons: [PICK_CIRCLE, PICK_CIRCLE, ROW_THUMB, PICK_TITLE, PICK_SUB],
    keep: [EMPTY_COLLAGE, EMPTY_COLLAGE],
  },
  'features/trip/ui/TripWizardStep1Screen.tsx': {
    skeletons: [
      'h-[12px] rounded-[10px] bg-hairline w-[${w}px]',
      'h-[64px] w-[64px] rounded-[10px] bg-hairline',
    ],
    keep: Array(4).fill(DIVIDER),
  },
  'features/trip/ui/TripWizardStep2Screen.tsx': {
    skeletons: [
      'h-[14px] w-[92px] rounded-[6px] bg-surface-strong',
      'h-[48px] w-[48px] rounded-thumb bg-surface-strong',
      'h-[14px] w-[150px] rounded-[6px] bg-hairline',
      'h-[12px] w-[104px] rounded-[6px] bg-surface-strong',
    ],
    keep: Array(3).fill(DIVIDER),
  },
  'features/itinerary/ui/SlotCandidateSheet.tsx': {
    skeletons: [
      'h-[56px] w-[56px] rounded-thumb bg-surface-soft',
      'h-[14px] w-1/2 rounded-pill bg-surface-soft',
      'h-[14px] w-1/3 rounded-pill bg-surface-soft',
    ],
    keep: [],
  },
  'features/itinerary/ui/MyTripsListScreen.tsx': {
    skeletons: [
      'h-[178px] w-full bg-surface-soft',
      'h-[15px] w-2/3 rounded-input bg-surface-soft',
      'h-[13px] w-1/2 rounded-input bg-surface-soft',
    ],
    keep: [],
  },
  'features/itinerary/ui/MustVisitPickerScreen.tsx': {
    skeletons: [
      'h-[170px] w-full rounded-card bg-surface-soft',
      'h-[26px] w-[26px] rounded-pill bg-surface-soft',
      'h-[78px] w-[78px] rounded-thumb bg-surface-soft',
      'h-[14px] w-1/3 rounded-pill bg-surface-soft',
      'h-[14px] w-2/3 rounded-pill bg-surface-soft',
    ],
    keep: [],
  },
  'features/stay/ui/SavedStayListScreen.tsx': {
    skeletons: [
      'h-[178px] w-full rounded-card bg-surface-strong',
      'h-[15px] w-2/3 rounded-thumb bg-hairline',
    ],
    keep: [],
  },
  'features/explore/ui/RegionPickerScreen.tsx': {
    skeletons: ['mb-md h-[152px] w-[48%] rounded-card bg-surface-soft'],
    keep: [],
  },
  'features/itinerary/ui/DraftScreen.tsx': {
    skeletons: ['h-[98px] w-full rounded-[14px] bg-surface-soft'],
    keep: [],
  },
};

const SKELETON_REL = 'shared/ui/Skeleton.tsx';
const GATE_REL = 'shared/motion/reduceMotion.ts';
const HEART_REL = 'shared/ui/HeartButton.tsx';
const CARD_REL = 'features/record/ui/VisitRecordCard.tsx';
const GENERATING_REL = 'features/itinerary/ui/GeneratingScreen.tsx';
/** 이번에 새로 만들거나 바꾸는 파일 전부 — AC-17 타이머 스캔 모집단. */
const CHANGED_FILES = [
  SKELETON_REL,
  GATE_REL,
  HEART_REL,
  CARD_REL,
  GENERATING_REL,
  ...Object.keys(REPLACED),
];
/** 게이트를 써야 하는 새 애니메이션 자리. */
const GATE_CONSUMERS = [SKELETON_REL, HEART_REL, CARD_REL];
const GATE_IMPORT =
  /from ['"](@\/shared\/motion\/reduceMotion|\.\.\/motion\/reduceMotion)['"]/;

const TIMER = /\bset(Timeout|Interval)\s*\(/;

/** 콜론(:) 뒤 // 는 주석으로 보지 않는다 — URL 의 `//` 를 스캔 전에 안 지우기 위함. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** className 을 토큰 정렬한 문자열로 — 순서만 바뀐 것은 같은 모양이다. */
function norm(className: string): string {
  return className.split(/\s+/).filter(Boolean).sort().join(' ');
}

function classText(
  attr: ts.JsxAttribute,
  sf: ts.SourceFile
): string | undefined {
  const init = attr.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const expr = init.expression;
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))
      return expr.text;
    if (ts.isTemplateExpression(expr)) return expr.getText(sf).slice(1, -1);
    return expr.getText(sf);
  }
  return undefined;
}

/** 소스 한 파일의 회색 잎 className(정렬)과 `<Skeleton>` className(정렬). */
function scanJsx(source: string): {
  grayLeaves: string[];
  skeletons: string[];
} {
  const sf = ts.createSourceFile(
    'scan.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const grayLeaves: string[] = [];
  const skeletons: string[] = [];

  const visit = (node: ts.Node): void => {
    let opening: ts.JsxSelfClosingElement | ts.JsxOpeningElement | undefined;
    let leaf = false;
    if (ts.isJsxSelfClosingElement(node)) {
      opening = node;
      leaf = true;
    } else if (ts.isJsxElement(node)) {
      opening = node.openingElement;
      leaf = node.children.every(
        (child) => ts.isJsxText(child) && child.text.trim() === ''
      );
    }
    if (opening) {
      const tag = opening.tagName.getText(sf);
      const attr = opening.attributes.properties.find(
        (prop): prop is ts.JsxAttribute =>
          ts.isJsxAttribute(prop) && prop.name.getText(sf) === 'className'
      );
      const text = attr ? classText(attr, sf) : undefined;
      if (tag === 'Skeleton') skeletons.push(norm(text ?? ''));
      else if (leaf && LEAF_TAGS.includes(tag) && text && GRAY.test(text))
        grayLeaves.push(norm(text));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { grayLeaves: grayLeaves.sort(), skeletons };
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('G0 · 탐지기 자가검사 — 실제 문자열로 태운다', () => {
  it('자식 없는 회색 View 만 잎으로 잡고, 주석 속 JSX·테두리·자식 있는 틀·Skeleton 은 잎이 아니다', () => {
    const sample = [
      'export function A() {',
      '  return (',
      '    <View className="flex-1">',
      '      {/* <View className="h-4 bg-surface-strong" /> */}',
      '      <View',
      '        testID="x"',
      '        className="h-[14px] w-2/3 rounded-[6px] bg-hairline"',
      '        style={{ width: 10 }}',
      '      />',
      '      <View className={`h-[12px] bg-hairline w-[${w}px]`} />',
      '      <View className="rounded-card border border-hairline bg-canvas" />',
      '      <View className="rounded-card bg-surface-soft p-md"><Text>x</Text></View>',
      '      <View className="h-[1px] bg-hairline"></View>',
      '      <Skeleton className="bg-surface-strong h-4" />',
      '      <Animated.View className="h-4 bg-surface-soft" />',
      '    </View>',
      '  );',
      '}',
    ].join('\n');

    const { grayLeaves, skeletons } = scanJsx(sample);

    expect(grayLeaves).toEqual(
      [
        norm('h-[14px] w-2/3 rounded-[6px] bg-hairline'),
        norm('h-[12px] bg-hairline w-[${w}px]'),
        norm('h-[1px] bg-hairline'),
        norm('h-4 bg-surface-soft'),
      ].sort()
    );
    // 토큰 순서가 달라도 같은 모양으로 읽힌다.
    expect(skeletons).toEqual([norm('h-4 bg-surface-strong')]);
  });

  it('블록 주석 속 타이머 이름은 걷히고, URL 이 있는 줄의 코드 타이머는 살아남아 잡힌다', () => {
    const sample = [
      '/**',
      ' * 표현한다. RN `Animated`(네이티브 드라이버) 라 **자체 타이머가 없다** — `setInterval`/`setTimeout`',
      ' * 은 features/pages 타이머 금지 심판에 걸린다.',
      ' */',
      '// const dead = setTimeout(fn, 100);',
      "const u = 'https://x.example/z'; const t = setTimeout(fn, 100);",
    ].join('\n');

    const stripped = stripComments(sample);

    expect(stripped).not.toContain('setInterval');
    expect(stripped).toContain(
      "const u = 'https://x.example/z'; const t = setTimeout(fn, 100);"
    );
    expect(TIMER.test(stripped)).toBe(true);
    expect(TIMER.test(stripComments('// setTimeout(fn, 1)'))).toBe(false);
  });
});

describe('🔴 G1 · AC-6·AC-8 — 로딩 회색 잎 15파일이 Skeleton 으로 바뀌고, 로딩 밖 잎은 그대로다', () => {
  it('계약 표의 Skeleton 자리는 15파일 합계 44자리다', () => {
    const total = Object.values(REPLACED).reduce(
      (sum, { skeletons }) => sum + skeletons.length,
      0
    );
    expect(total).toBe(44);
  });

  it.each(Object.keys(REPLACED))(
    '%s — Skeleton 을 import 하고, 남은 회색 잎·Skeleton 모양이 계약과 정확히 같다',
    (rel) => {
      const source = read(rel);
      const { grayLeaves, skeletons } = scanJsx(source);
      const expected = REPLACED[rel];

      expect(source).toContain(SKELETON_IMPORT);
      // 로딩 밖 회색 잎만 남는다 — 스켈레톤 잎이 하나라도 남으면, 로딩 밖 잎이 사라지면 red.
      expect(grayLeaves).toEqual(expected.keep.map(norm).sort());
      // Skeleton 은 스켈레톤 자리 전부를 **개수까지** 그대로 받는다 — 하나를 지우거나, 로딩 밖(실패
      // 얼굴·구분선·배경)에 같은 모양을 하나 더 얹으면 red(5-b W6).
      expect([...skeletons].sort()).toEqual(
        expected.skeletons.map(norm).sort()
      );
    }
  );
});

describe('🔴 G2 · AC-17 — 변경 파일에 타이머가 없고, 동작 줄이기는 공용 게이트 한 곳만 묻는다', () => {
  it('변경 파일이 전부 실재하고, 주석을 걷은 소스에 setTimeout·setInterval 이 0건이다', () => {
    // 짝 — 파일이 없으면 아래 "타이머 없음"이 공허하게 통과한다.
    CHANGED_FILES.forEach((rel) =>
      expect({ rel, exists: fs.existsSync(path.join(ROOT, rel)) }).toEqual({
        rel,
        exists: true,
      })
    );

    const offenders = CHANGED_FILES.filter((rel) =>
      TIMER.test(stripComments(read(rel)))
    );
    expect(offenders).toEqual([]);
  });

  it('Skeleton 은 Animated.loop 로 반복하고, 새 애니메이션 자리는 게이트를 import 할 뿐 직접 묻지 않는다', () => {
    expect(fs.existsSync(path.join(ROOT, SKELETON_REL))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, GATE_REL))).toBe(true);

    expect(stripComments(read(SKELETON_REL))).toMatch(/Animated\.loop\(/);
    expect(stripComments(read(GATE_REL))).toMatch(/isReduceMotionEnabled\(/);

    GATE_CONSUMERS.forEach((rel) => {
      const source = stripComments(read(rel));
      expect({ rel, importsGate: GATE_IMPORT.test(source) }).toEqual({
        rel,
        importsGate: true,
      });
      expect({
        rel,
        asksDirectly: source.includes('isReduceMotionEnabled'),
      }).toEqual({
        rel,
        asksDirectly: false,
      });
    });
  });
});
