import fs from 'fs';
import path from 'path';

/**
 * TRIP-939 AC-12 — 페이지·라우트가 화면에 "아무것도 안 하는 핸들러"를 넘기지 않는다(심사 2.1 회귀 그물).
 *
 * 왜 필요한가: `onSkip={() => {}}` 처럼 빈 함수를 넘기면 화면은 "콜백이 있다"고 보고 버튼을 그린다 —
 * 누르면 아무 일도 없는 버튼이 운영 빌드에 새는 가장 흔한 길이다(이 사이클의 S7·S8·B-6 이 전부 이 모양).
 * 화면은 "콜백이 없으면 그리지 않는다"로 바뀌었으니, 주입하는 쪽(pages·app)이 빈 함수를 넣지 않는 한
 * 버튼이 숨는다. 이 파일은 그 주입 쪽을 소스로 훑는다.
 *
 * 무엇을 잡나(형태 3종):
 *  1. `on…={() => {}}` — 빈 본문.
 *  2. `on…={() => { // 설명만 … }}` — 본문이 주석뿐(여러 줄 포함). 1번 정규식엔 안 걸리는 모양(B-6 선례).
 *  3. `on…={undefined}` — 명시적 undefined(버튼은 Pressable 로 그려져 눌러 보이는데 반응 없음).
 * 범위: `src/pages/**`·`src/app/**` 의 `.tsx`(테스트·`app/_dev` 제외). features/entities 의
 *   `onPressTab ?? (() => {})` 기본값(늘 주입되는 옵셔널)은 `on…={` 모양이 아니라 대상 밖이다.
 *
 * 허용 목록: 화면이 동작을 스스로 하고 부모에겐 "알림"만 주는 콜백 — 빈 본문이 곧 정상 동작이다.
 *
 * ⚠️ 전처리(주석 제거) 없이 정규식 하나가 주석을 직접 다룬다 — `//` 줄주석은 줄 끝까지 통째로 먹어
 *   주석 속 `}` 를 본문 끝으로 오인하지 않는다. 탐지기가 실제로 그 모양을 잡는지는 G0 자가검사가
 *   먼저 확인한다(조합 실검증 — 02a ★15 · §5-D).
 *
 * *유지 판정: 3사이클 관찰 — 이 가드가 새 위반을 한 번도 잡지 못하면(FAIL 0) 떼어낸다. 허용 목록이
 *  3건을 넘으면 정규식이 과잉이므로 재설계한다.*
 *
 * (개념) 정규식 `g` 플래그 + `exec` 반복 = 한 파일 안의 모든 위치를 차례로 찾는다.
 */

const ROOT = path.resolve('src');

/** 빈 본문 또는 공백·줄주석·블록주석뿐인 본문. */
const DEAD_ARROW =
  /on[A-Z]\w*=\{\s*\(\)\s*=>\s*\{(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*\}\s*\}/g;
const EXPLICIT_UNDEFINED = /on[A-Z]\w*=\{undefined\}/g;

/** `파일(src 기준):핸들러명` — 화면이 편집을 로컬로 열고 부모엔 알림만 주는 콜백(BR-U5-36). */
const ALLOWED = new Set([
  'pages/daily-reflection/ui/DailyReflectionPage.tsx:onEnterEdit',
]);

function findViolations(source: string): string[] {
  const found: string[] = [];
  for (const re of [DEAD_ARROW, EXPLICIT_UNDEFINED]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      found.push(match[0].slice(0, match[0].indexOf('=')));
    }
  }
  return found;
}

function listTsx(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_dev' ? [] : listTsx(full);
    return entry.name.endsWith('.tsx') && !/\.test\./.test(entry.name)
      ? [full]
      : [];
  });
}

describe('TRIP-939 AC-12 · G0 탐지기 자가검사 (조합 실검증)', () => {
  it('양성 4형태를 잡는다 — 빈 본문·주석만(여러 줄)·블록주석만·명시적 undefined', () => {
    expect(findViolations('<A onSkip={() => {}} />')).toEqual(['onSkip']);
    expect(
      findViolations(
        '<A\n  onPressAdd={() => {\n    // 후속 티켓 } 에서 배선\n    // ponytail: 나중에\n  }}\n/>'
      )
    ).toEqual(['onPressAdd']);
    expect(findViolations('<A onRest={() => { /* 준비 중 */ }} />')).toEqual([
      'onRest',
    ]);
    expect(findViolations('<A onPress={undefined} />')).toEqual(['onPress']);
  });

  it('음성 3형태는 안 잡는다 — 실제 호출 본문·주석+호출·기본값 폴백', () => {
    expect(findViolations('<A onSkip={() => { go(); }} />')).toEqual([]);
    expect(
      findViolations('<A onBack={() => {\n  // 뒤로\n  router.back();\n}} />')
    ).toEqual([]);
    expect(
      findViolations('<Bar onPressTab={onPressTab ?? (() => {})} />')
    ).toEqual([]);
  });
});

describe('🔴 TRIP-939 AC-12 · G1 pages·app 에 빈 핸들러 주입이 0건이다', () => {
  it('src/pages·src/app(.tsx, 테스트·_dev 제외)에서 허용 목록 밖 위반이 없다', () => {
    // 준비: 스캔 대상 파일 목록.
    const files = [
      ...listTsx(path.join(ROOT, 'pages')),
      ...listTsx(path.join(ROOT, 'app')),
    ];
    // 앵커 — 실제로 많은 파일을 훑었다(경로 오타로 빈 목록이 공허 통과하는 것 차단).
    expect(files.length).toBeGreaterThan(50);

    // 실행: 파일마다 위반을 모은다.
    const violations = files.flatMap((full) => {
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      return findViolations(fs.readFileSync(full, 'utf8'))
        .map((handler) => `${rel}:${handler}`)
        .filter((key) => !ALLOWED.has(key));
    });

    // 단언: 위반 0건(실패 시 목록이 곧 고칠 자리다).
    expect(violations).toEqual([]);
  });
});
