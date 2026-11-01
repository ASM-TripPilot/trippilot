/**
 * @jest-environment node
 */
// 출시·보안 금지를 ESLint 규칙으로 옮긴 뒤 그 규칙이 실제로 발동하는지 `lintText` 로 탐침한다
// (README §테스트 전략 판정 3). FSD 층 방향·딥 import 탐침은 TRIP-1350 에서 지웠다 — 구조 규칙은
// eslint.config.js 와 CI lint(Steiger 포함)가 지킨다.
//
// ⚠️ 단독 실행 시 `NODE_OPTIONS=--experimental-vm-modules` 필요(ESLint 의 동적 import).
//    `pnpm test:node <경로>` 로 돌린다 — `pnpm exec jest <경로>` 단독은 실패한다.
import path from 'path';

import { ESLint } from 'eslint';

const BOUNDARY_RULE = 'import/no-restricted-paths';

let eslint: ESLint;

beforeAll(() => {
  // 인스턴스 1개를 재사용한다(config 는 최초 1회만 로드 — 30+ 프로브가 빨라진다).
  eslint = new ESLint();
});

// filePath 위치에서 code 를 린트하고, severity=error 인 메시지의 룰 ID 배열만 뽑는다.
// 개수가 아니라 "어느 룰이 잡았는가"를 본다 — 개수만 세면 다른 룰이 대신 잡아도 통과한다.
// 딥 zone(TRIP-1157)은 층 zone 과 룰 ID 가 같아 별도 이름표로 가른다 — 안 가르면 층 zone 이 사라져도 딥 zone 이 대신 울려 층 탐침이 green 이다.
async function lint(
  code: string,
  filePath: string
): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.resolve(filePath),
  });
  return result.messages
    .filter((m) => m.severity === 2)
    .map((m) =>
      m.ruleId === BOUNDARY_RULE && m.message.includes('TRIP-1157')
        ? `${BOUNDARY_RULE}#TRIP-1157`
        : m.ruleId
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-1145 · 출시·보안 소스 스캔을 eslint 규칙으로 옮긴 뒤 그 규칙이 실제로 발동하는지 본다
// (원 스캔: noMswInStaticGraph · deleteAccountDialogGate · noDeadHandlers 전체, 옛 recordPhotoBinaryGuard G3 ·
// 옛 shareCardStructure G5 · stayRecommendStructure 프리뷰 데이터 · itineraryCoPickStructure 콘솔 일부).
//
// ⚠️ flat config 는 같은 규칙을 거는 블록이 여럿이면 **뒤 블록 옵션이 앞 블록을 통째로 덮는다**(합쳐지지
//    않는다). StateNotice·shareCaptureNative 예외 블록은 공통 금지 목록을 펼쳐 다시 선언해야 한다 —
//    아래 "덮어쓰기" describe 가 양쪽 목록이 함께 살아 있는지 본다(02a ★1, 실측으로 useState 금지 소실 확인).
// ⚠️ `no-restricted-imports` 는 정적 import·export-from 만 본다 — require()·import() 는 안 본다(02a ★2).
//    그래서 shared/photo 의 호출 시점 require 와 shareCapture.ts 의 동적 import 는 예외 블록 없이 허용된다.
// 정상 탐침은 import 대상을 실파일로, JSX 는 실컴포넌트(Pressable)로 써야 `[]` 를 단언할 수 있다(★3·★7).

const RESTRICTED_IMPORTS = 'no-restricted-imports';
const RESTRICTED_SYNTAX = 'no-restricted-syntax';
const NO_CONSOLE = 'no-console';

const PROD_PROBE = 'src/features/settings/__release_probe__.ts';
const PHOTO_PROBE = 'src/shared/photo/__release_probe__.ts';
const REFLECTION_UI_PROBE =
  'src/features/share-trip-card/ui/__release_probe__.ts';
const REFLECTION_MODEL_PROBE =
  'src/features/share-trip-card/model/__release_probe__.ts';
// 캡처 어댑터 자신의 경로 — 예외 블록이 이 파일에만 걸린다.
const CAPTURE_ADAPTER =
  'src/features/share-trip-card/model/shareCaptureNative.ts';
const STATE_NOTICE = 'src/shared/ui/StateNotice.tsx';
// 라우트는 루트 app/ 에 있다(TRIP-1161) — src/app 은 FSD app 층이라 거기 탐침을 두면 라우트가 아니라 그 층을 본다(green 위장).
const ROUTE_PROBE = 'app/trips/__release_probe__.tsx';
const PAGE_PROBE = 'src/pages/__release_probe__/x.tsx';
const SETTINGS_UI_PROBE =
  'src/pages/settings/settings/ui/__release_probe__.tsx';
const DEV_PREVIEW_PROBE = 'app/_dev/__release_probe__.tsx';
const SETTINGS_UI_PROBE_TS =
  'src/pages/settings/settings/ui/__release_probe__.ts';
// TRIP-1422 — 설정 내보내기의 expo-sharing 어댑터(캡처 어댑터와 같은 예외 블록에 얹힌다)와 그 옆 탐침 자리.
const EXPORT_ADAPTER = 'src/pages/settings/settings/model/exportShareNative.ts';
const SETTINGS_MODEL_PROBE =
  'src/pages/settings/settings/model/__release_probe__.ts';

describe('msw·목은 앱 코드에 들어오지 않는다 (noMswInStaticGraph 이관)', () => {
  it.each([
    ['msw', "import { http } from 'msw';\nexport const probe = http;\n"],
    [
      'msw/node',
      "import { setupServer } from 'msw/node';\nexport const probe = setupServer;\n",
    ],
    [
      '@/mocks',
      "import { server } from '@/mocks/server';\nexport const probe = server;\n",
    ],
  ])('프로덕션 파일이 %s 를 import 하면 error', async (_label, code) => {
    const ruleIds = await lint(code, PROD_PROBE);

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  it.each([
    [
      '통합 테스트 파일',
      'src/features/settings/__release_probe__.integration.test.ts',
    ],
    ['src/mocks 안', 'src/mocks/__release_probe__.ts'],
  ])(
    '%s 에서 msw import 는 error 0 (테스트 오라클 자리)',
    async (_label, filePath) => {
      const ruleIds = await lint(
        "import { http } from 'msw';\nexport const probe = http;\n",
        filePath
      );

      expect(ruleIds).toEqual([]);
    }
  );

  // 5-b B1 — 원 스캔은 별칭만이 아니라 상대경로 `../mocks/…` 도 잡았다(src/mocks/server → msw/node 부팅 크래시).
  it.each([
    ['두 칸 위', PROD_PROBE, '../../mocks/server'],
    ['라우트에서 src 로', 'app/__release_probe__.ts', '../src/mocks/handlers'],
  ])(
    '프로덕션 파일이 src/mocks 를 상대경로(%s)로 import 하면 error',
    async (_label, filePath, spec) => {
      const ruleIds = await lint(
        `import * as mocks from '${spec}';\nexport const probe = mocks;\n`,
        filePath
      );

      expect(ruleIds).toContain(RESTRICTED_IMPORTS);
    }
  );

  // 짝 — `__mocks__`(jest 수동 목 폴더)는 `mocks` 와 다른 경로 조각이라 같은 패턴에 걸리지 않는다.
  it('이름에 mocks 가 들어가도 __mocks__ 경로는 이 금지에 걸리지 않는다', async () => {
    const ruleIds = await lint(
      "import * as notifications from '../../../__mocks__/expo-notifications';\nexport const probe = notifications;\n",
      PROD_PROBE
    );

    expect(ruleIds).toEqual([]);
  });
});

describe('네이티브 사진·캡처 모듈은 정적으로 끌지 않는다 (옛 recordPhotoBinaryGuard G3 · shareCardStructure G5 이관)', () => {
  it('shared/photo 입구도 expo-image-picker 를 정적 import 하면 error', async () => {
    const ruleIds = await lint(
      "import * as ImagePicker from 'expo-image-picker';\nexport const probe = ImagePicker;\n",
      PHOTO_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  it('shared/photo 입구가 함수 안에서 require 로 여는 것은 error 0', async () => {
    const ruleIds = await lint(
      "export const probe = () =>\n  // eslint-disable-next-line @typescript-eslint/no-require-imports\n  require('expo-image-picker') as typeof import('expo-image-picker');\n",
      PHOTO_PROBE
    );

    expect(ruleIds).toEqual([]);
  });

  it.each([
    [
      'import',
      "import { captureRef } from 'react-native-view-shot';\nexport const probe = captureRef;\n",
    ],
    ['export-from', "export { captureRef } from 'react-native-view-shot';\n"],
  ])(
    '어댑터 밖 feature 가 캡처 패키지를 %s 로 끌면 error',
    async (_label, code) => {
      const ruleIds = await lint(code, REFLECTION_UI_PROBE);

      expect(ruleIds).toContain(RESTRICTED_IMPORTS);
    }
  );

  it.each([
    ['같은 폴더 상대경로', REFLECTION_MODEL_PROBE, './shareCaptureNative'],
    ['상위 상대경로', REFLECTION_UI_PROBE, '../model/shareCaptureNative'],
    [
      '@ 별칭',
      REFLECTION_UI_PROBE,
      '@/features/share-trip-card/model/shareCaptureNative',
    ],
  ])(
    '캡처 어댑터를 %s 로 정적 import 하면 error',
    async (_label, filePath, spec) => {
      const ruleIds = await lint(
        `import { shareAsync } from '${spec}';\nexport const probe = shareAsync;\n`,
        filePath
      );

      expect(ruleIds).toContain(RESTRICTED_IMPORTS);
    }
  );

  it('캡처 어댑터를 동적 import() 로 부르는 것은 error 0', async () => {
    const ruleIds = await lint(
      "export const probe = () => import('./shareCaptureNative');\n",
      REFLECTION_MODEL_PROBE
    );

    expect(ruleIds).toEqual([]);
  });

  it('어댑터 파일은 캡처 3종을 정적으로 다시 내보내도 error 0', async () => {
    const ruleIds = await lint(
      [
        "export { captureRef } from 'react-native-view-shot';",
        "export { saveToLibraryAsync } from 'expo-media-library';",
        "export { shareAsync } from 'expo-sharing';",
        '',
      ].join('\n'),
      CAPTURE_ADAPTER
    );

    expect(ruleIds).toEqual([]);
  });

  it('어댑터 파일이라도 사진 피커는 error (캡처 3종만 허용)', async () => {
    const ruleIds = await lint(
      "import * as ImagePicker from 'expo-image-picker';\nexport const probe = ImagePicker;\n",
      CAPTURE_ADAPTER
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  // TRIP-1422 — 설정 내보내기는 .json 파일을 expo-sharing 으로 넘긴다. 정적 import 는 어댑터 파일 하나만,
  // 소비처는 그 어댑터를 동적 import() 로만 부른다(재빌드 전 빌드의 부팅 크래시 방지 — 캡처 어댑터와 같은 이음새).
  it('내보내기 어댑터 파일은 expo-sharing 을 정적으로 다시 내보내도 error 0', async () => {
    const ruleIds = await lint(
      "export { shareAsync } from 'expo-sharing';\n",
      EXPORT_ADAPTER
    );

    expect(ruleIds).toEqual([]);
  });

  it('어댑터가 아닌 설정 파일이 expo-sharing 을 정적 import 하면 error (예외는 어댑터 한 파일뿐)', async () => {
    const ruleIds = await lint(
      "import { shareAsync } from 'expo-sharing';\nexport const probe = shareAsync;\n",
      SETTINGS_MODEL_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  it.each([
    ['같은 폴더 상대경로', SETTINGS_MODEL_PROBE, './exportShareNative'],
    ['상위 상대경로', SETTINGS_UI_PROBE_TS, '../model/exportShareNative'],
    [
      '@ 별칭',
      SETTINGS_UI_PROBE_TS,
      '@/pages/settings/settings/model/exportShareNative',
    ],
  ])(
    '내보내기 어댑터를 %s 로 정적 import 하면 error',
    async (_label, filePath, spec) => {
      const ruleIds = await lint(
        `import { shareAsync } from '${spec}';\nexport const probe = shareAsync;\n`,
        filePath
      );

      expect(ruleIds).toContain(RESTRICTED_IMPORTS);
    }
  );

  it('내보내기 어댑터를 동적 import() 로 부르는 것은 error 0', async () => {
    const ruleIds = await lint(
      "export const probe = () => import('./exportShareNative');\n",
      SETTINGS_MODEL_PROBE
    );

    expect(ruleIds).toEqual([]);
  });

  // 5-b W4 — 원 스캔은 하위 경로 import 도 잡았다(패키지 루트 이름만 막으면 `pkg/build/X` 로 샌다).
  it.each([
    ['expo-image-picker/build/ImagePicker'],
    ['expo-media-library/build/MediaLibrary'],
    ['react-native-view-shot/src/index'],
    ['expo-sharing/build/Sharing'],
  ])('네이티브 모듈의 하위 경로 %s 를 정적 import 하면 error', async (spec) => {
    const ruleIds = await lint(
      `import * as nativeModule from '${spec}';\nexport const probe = nativeModule;\n`,
      'src/features/record/__release_probe__.ts'
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });
});

describe('★ 덮어쓰기 함정 — 예외 블록이 있는 파일에서도 공통 금지와 자기 금지가 함께 산다', () => {
  // 선제 green — 지금 있는 StateNotice 금지가 새 전역 블록에 덮여 사라지지 않는지(덮이면 red).
  it('StateNotice.tsx 의 기존 금지(useState)가 계속 error', async () => {
    const ruleIds = await lint(
      "import { useState } from 'react';\nexport const probe = useState;\n",
      STATE_NOTICE
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  it.each([
    ['StateNotice.tsx', STATE_NOTICE],
    ['캡처 어댑터', CAPTURE_ADAPTER],
    ['내보내기 어댑터', EXPORT_ADAPTER],
  ])('%s 에서도 공통 금지(msw)가 error', async (_label, filePath) => {
    const ruleIds = await lint(
      "import { http } from 'msw';\nexport const probe = http;\n",
      filePath
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  // TRIP-1169 — 예외 블록이 공통 목록을 펼쳐 다시 선언하는 **하위 경로 패턴** 줄이 지워져도 위 테스트들은
  // 전부 green 이었다. 루트 이름(paths)이 아니라 `<패키지>/*` 패턴(patterns)을 직접 문다.
  it.each([
    ['StateNotice.tsx', STATE_NOTICE, 'expo-sharing/build/Sharing'],
    // 캡처 어댑터는 캡처 3종 루트를 허용하지만 사진 피커는 루트·하위 경로 모두 막는다.
    [
      '캡처 어댑터(사진 피커 하위 경로)',
      CAPTURE_ADAPTER,
      'expo-image-picker/build/ImagePicker',
    ],
    [
      '내보내기 어댑터(사진 피커 하위 경로)',
      EXPORT_ADAPTER,
      'expo-image-picker/build/ImagePicker',
    ],
  ])('%s 의 하위 경로 import 는 error', async (_label, filePath, spec) => {
    const ruleIds = await lint(
      `import * as Mod from '${spec}';\nexport const probe = Mod;\n`,
      filePath
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });
});

describe('개발 프리뷰의 가짜 데이터는 앱 코드가 끌지 않는다 (stayRecommendStructure 일부 이관)', () => {
  it.each([
    ['@ 별칭', '@routes/_dev/preview'],
    ['상대경로', '../_dev/preview'],
  ])('라우트 파일이 프리뷰를 %s 로 import 하면 error', async (_label, spec) => {
    const ruleIds = await lint(
      `import Preview from '${spec}';\nexport const probe = Preview;\n`,
      ROUTE_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  it('라우트 파일이 page 를 import 하는 것은 error 0', async () => {
    const ruleIds = await lint(
      "import { HomePage } from '@/pages/home';\nexport const probe = HomePage;\n",
      ROUTE_PROBE
    );

    expect(ruleIds).toEqual([]);
  });
});

describe('디버그 콘솔 출력은 앱 코드에 남지 않는다 (itineraryCoPickStructure 일부 이관)', () => {
  const CONSOLE_CODE =
    "export function probe() {\n  console.log('PROBE');\n}\n";

  it('프로덕션 파일의 console.log 는 error', async () => {
    const ruleIds = await lint(CONSOLE_CODE, PAGE_PROBE);

    expect(ruleIds).toContain(NO_CONSOLE);
  });

  it('테스트 파일의 console.log 는 이 규칙 대상이 아니다', async () => {
    const ruleIds = await lint(
      CONSOLE_CODE,
      'src/pages/__release_probe__/x.test.tsx'
    );

    expect(ruleIds).not.toContain(NO_CONSOLE);
  });
});

describe('계정 삭제 다이얼로그는 1단계부터만 열린다 (deleteAccountDialogGate 이관)', () => {
  const dialogTag = (props: string, importPath = './DeleteAccountDialog') =>
    [
      `import { DeleteAccountDialog } from '${importPath}';`,
      'declare const noop: () => void;',
      'declare const rest: { onCancel: () => void; onConfirmDeletion: () => void };',
      `export const Probe = () => <DeleteAccountDialog ${props} />;`,
      '',
    ].join('\n');

  it('features 에서 onCancel·onConfirmDeletion 밖 prop(initialStep)을 넘기면 error', async () => {
    const ruleIds = await lint(
      dialogTag('initialStep="final" onCancel={noop} onConfirmDeletion={noop}'),
      SETTINGS_UI_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  // ★ no-restricted-syntax 도 tsx 전역 블록과 pages·app 블록이 겹친다 — pages 쪽이 게이트를 덮어 지우면 red.
  it('pages 에서 initialStep 을 넘겨도 error', async () => {
    const ruleIds = await lint(
      dialogTag(
        'initialStep="final" onCancel={noop} onConfirmDeletion={noop}',
        '@/pages/settings/settings/ui/DeleteAccountDialog'
      ),
      PAGE_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  it('props 를 펼쳐 넘기면(숨은 initialStep 통로) error', async () => {
    const ruleIds = await lint(dialogTag('{...rest}'), SETTINGS_UI_PROBE);

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  // 5-b W3 — 다른 이름으로 들여오면 태그 이름 검사(`<DeleteAccountDialog`)를 통째로 비켜 간다.
  it('다른 이름으로 import 하면(별칭) 넘기는 prop 과 무관하게 error', async () => {
    const ruleIds = await lint(
      [
        "import { DeleteAccountDialog as Dialog } from './DeleteAccountDialog';",
        'declare const noop: () => void;',
        'export const Probe = () => <Dialog onCancel={noop} onConfirmDeletion={noop} />;',
        '',
      ].join('\n'),
      SETTINGS_UI_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  // TRIP-1169 — JSX 가 없는 .ts 에서도 별칭은 같은 우회다(태그 검사를 비켜 가는 통로).
  it.each([
    [
      '.ts 의 별칭 import',
      "import { DeleteAccountDialog as Dialog } from './DeleteAccountDialog';\nexport const probe = Dialog;\n",
      SETTINGS_UI_PROBE_TS,
    ],
    [
      '.ts 의 별칭 재수출',
      "export { DeleteAccountDialog as SafeDialog } from './DeleteAccountDialog';\n",
      SETTINGS_UI_PROBE_TS,
    ],
    [
      '.tsx 의 별칭 재수출',
      "export { DeleteAccountDialog as SafeDialog } from './DeleteAccountDialog';\n",
      SETTINGS_UI_PROBE,
    ],
  ])('%s 는 error', async (_label, code, filePath) => {
    const ruleIds = await lint(code, filePath);

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  // 대조군 — 원래 이름의 재수출은 막지 않는다(별칭만 막는 규칙이 과하게 물지 않는지).
  it('.ts 에서 원래 이름 그대로 재수출하면 error 0', async () => {
    const ruleIds = await lint(
      "export { DeleteAccountDialog } from './DeleteAccountDialog';\n",
      SETTINGS_UI_PROBE_TS
    );

    expect(ruleIds).toEqual([]);
  });

  it('onCancel·onConfirmDeletion 두 prop 만 넘기면 error 0', async () => {
    const ruleIds = await lint(
      dialogTag('onCancel={noop} onConfirmDeletion={noop}'),
      SETTINGS_UI_PROBE
    );

    expect(ruleIds).toEqual([]);
  });

  it('개발 프리뷰(app/_dev)는 2단계 얼굴을 보여 주려 initialStep 을 넘겨도 error 0', async () => {
    const ruleIds = await lint(
      dialogTag(
        'initialStep="final" onCancel={noop} onConfirmDeletion={noop}',
        '@/pages/settings/settings/ui/DeleteAccountDialog'
      ),
      DEV_PREVIEW_PROBE
    );

    expect(ruleIds).toEqual([]);
  });
});

describe('pages·app 은 아무것도 안 하는 핸들러를 넘기지 않는다 (noDeadHandlers 이관, 심사 2.1)', () => {
  const pressable = (attr: string) =>
    [
      "import { Pressable } from 'react-native';",
      'declare function go(): void;',
      'declare const onPressTab: (() => void) | undefined;',
      `export const Probe = () => (\n  <Pressable\n${attr}\n  />\n);`,
      '',
    ].join('\n');

  it.each([
    ['빈 본문', PAGE_PROBE, '    onPress={() => {}}'],
    [
      '줄주석만 있는 본문',
      PAGE_PROBE,
      '    onPress={() => {\n      // 후속 티켓 } 에서 배선\n    }}',
    ],
    [
      '블록주석만 있는 본문',
      PAGE_PROBE,
      '    onPress={() => { /* 준비 중 */ }}',
    ],
    ['명시적 undefined', ROUTE_PROBE, '    onLongPress={undefined}'],
  ])('%s 핸들러는 error', async (_label, filePath, attr) => {
    const ruleIds = await lint(pressable(attr), filePath);

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  it.each([
    ['실제 호출 본문', '    onPress={() => {\n      go();\n    }}'],
    ['옵셔널 콜백의 기본값', '    onPress={onPressTab ?? (() => {})}'],
    [
      'eslint-disable 사유가 붙은 허용 자리',
      '    // eslint-disable-next-line no-restricted-syntax -- 화면이 편집을 로컬로 연다(BR-U5-36)\n    onPress={() => {}}',
    ],
  ])('%s 는 error 0', async (_label, attr) => {
    const ruleIds = await lint(pressable(attr), PAGE_PROBE);

    expect(ruleIds).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-1627 · worklet('worklet' 지시자 함수)의 기본 매개변수 금지 (TRIP-1522 재발 방지)
//
// 같은 `no-restricted-syntax` 룰에는 삭제 다이얼로그·빈 핸들러 셀렉터도 걸려 있어 룰 ID 만으로는 어느
// 셀렉터가 울렸는지 모른다 — 이번 규칙 고유 메시지 태그(TRIP-1522)로 가른다(TRIP-1157 이름표와 같은 방식).
// 파싱 실패는 "이번 규칙 0건" 으로 위장하므로 fatal 을 따로 돌려받아 먼저 본다.

const WORKLET_TAG = 'TRIP-1522';
const WORKLET_TSX_PROBE = 'src/features/auth/ui/__release_probe__.tsx';
const APP_TS_PROBE = 'app/__release_probe__.ts';
const TEST_FILE_PROBE = 'src/features/settings/__release_probe__.test.ts';

async function lintWorklet(
  code: string,
  filePath: string
): Promise<{ lines: number[]; fatal: string[] }> {
  const [result] = await eslint.lintText(code, {
    filePath: path.resolve(filePath),
  });
  return {
    lines: result.messages
      .filter(
        (m) =>
          m.severity === 2 &&
          m.ruleId === RESTRICTED_SYNTAX &&
          m.message.includes(WORKLET_TAG)
      )
      .map((m) => m.line),
    fatal: result.messages.filter((m) => m.fatal).map((m) => m.message),
  };
}

const WORKLET_DECL_WITH_CONST_DEFAULT =
  "const K = 1;\nexport function f(a: number, w = K): number {\n  'worklet';\n  return a + w;\n}\n";

describe('worklet 함수의 기본 매개변수는 error (TRIP-1522 — UI 스레드에서만 죽는다)', () => {
  it.each([
    [
      '선언문 + 모듈 상수 기본값(TRIP-1522 원형)',
      WORKLET_DECL_WITH_CONST_DEFAULT,
    ],
    [
      '리터럴 기본값',
      "export function f(a: number, w = 3): number {\n  'worklet';\n  return a + w;\n}\n",
    ],
    [
      '화살표 함수(블록 본문)',
      "export const f = (a: number, w = 3): number => {\n  'worklet';\n  return a + w;\n};\n",
    ],
    [
      '함수 표현식',
      "export const f = function (a: number, w = 3): number {\n  'worklet';\n  return a + w;\n};\n",
    ],
    [
      '객체 메서드',
      "export const o = {\n  f(a: number, w = 3): number {\n    'worklet';\n    return a + w;\n  },\n};\n",
    ],
    [
      '객체 구조분해 매개변수',
      "export function f({ a, w = 3 }: { a: number; w?: number }): number {\n  'worklet';\n  return a + w;\n}\n",
    ],
    [
      '배열 구조분해 매개변수',
      "export function f([a, w = 3]: number[]): number {\n  'worklet';\n  return a + w;\n}\n",
    ],
    [
      '중첩 구조분해(객체 안 객체)',
      "export function f({ p: { w = 3 } }: { p: { w?: number } }): number {\n  'worklet';\n  return w;\n}\n",
    ],
    [
      '중첩 구조분해(객체 안 배열)',
      "export function f({ p: [w = 3] }: { p: number[] }): number {\n  'worklet';\n  return w;\n}\n",
    ],
  ])('%s 는 error', async (_label, code) => {
    const { lines, fatal } = await lintWorklet(code, PROD_PROBE);

    expect(fatal).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
  });

  // ★ 덮어쓰기 함정 — no-restricted-syntax 블록 3개(.ts / .tsx / pages·app .tsx)에 새 규칙을 모두 펼쳐야 한다.
  // 한 블록에서 빠지면 그 파일군에서만 조용히 죽는다.
  it.each([
    ['src .ts (블록 1)', PROD_PROBE],
    ['app .ts (블록 1)', APP_TS_PROBE],
    ['src features .tsx, pages 밖 (블록 2)', WORKLET_TSX_PROBE],
    ['src pages .tsx (블록 3)', PAGE_PROBE],
    ['app 라우트 .tsx (블록 3)', ROUTE_PROBE],
  ])('%s 에서도 error', async (_label, filePath) => {
    const { lines, fatal } = await lintWorklet(
      WORKLET_DECL_WITH_CONST_DEFAULT,
      filePath
    );

    expect(fatal).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
  });
});

const WORKLET_NEGATIVES: [string, string][] = [
  [
    '정상 처방(w?: number + 본문 ?? 값)',
    "export function f(a: number, w?: number): number {\n  'worklet';\n  return a + (w ?? 3);\n}\n",
  ],
  [
    "'worklet' 없는 일반 함수·props 구조분해 기본값",
    'export function f(a: number, w = 3): number {\n  return a + w;\n}\nexport const g = ({ a = 1 }: { a?: number }) => a;\n',
  ],
  [
    'worklet 본문 안 구조분해 대입',
    "export function f(a: { x?: number }): number {\n  'worklet';\n  const { x = 1 } = a;\n  return x;\n}\n",
  ],
  [
    'worklet 본문 안 중첩 일반 함수의 기본값',
    "export function f(a: number): number {\n  'worklet';\n  const h = (v = 1) => v;\n  const i = ({ v = 1 }: { v?: number }) => v;\n  return h(a) + i({});\n}\n",
  ],
  [
    "첫 문장이 아닌 'worklet'",
    "export function f(a: number, w = 3): number {\n  const z = 1;\n  'worklet';\n  return a + w + z;\n}\n",
  ],
  [
    '화살표 식 본문(블록 본문 없음)',
    'export const f = (a: number, w = 3) => a + w;\n',
  ],
  // 5-b W1 보강 — 셀렉터가 "구조분해 매개변수 전부" 로 넓어지면 제스처 콜백 모양이 오탐으로 걸린다.
  [
    '기본값 없는 객체 구조분해 worklet(제스처 콜백 모양)',
    "declare function onUpdate(cb: (e: { translationX: number }) => void): void;\nonUpdate(({ translationX }) => {\n  'worklet';\n  const x = translationX;\n  return x;\n});\n",
  ],
  [
    '기본값 없는 배열·중첩 구조분해 worklet',
    "export function f([a, b]: number[], { p: { w } }: { p: { w: number } }): number {\n  'worklet';\n  return a + b + w;\n}\n",
  ],
  // 'use strict' 는 기본 매개변수와 함께 쓰면 SyntaxError 라 쓸 수 없다 — 파싱되는 다른 문자열 지시자를 쓴다.
  [
    "'worklet' 이 아닌 다른 지시자 + 기본값 함수",
    "export function f(a: number, w = 3): number {\n  'use no memo';\n  return a + w;\n}\n",
  ],
  [
    "'worklet' 이 아닌 다른 지시자 + 구조분해 기본값",
    "export const f = ({ a, w = 3 }: { a: number; w?: number }) => {\n  'use no memo';\n  return a + w;\n};\n",
  ],
];

describe('worklet 이 아니거나 매개변수가 아닌 기본값은 이번 규칙에 안 걸린다', () => {
  it.each(WORKLET_NEGATIVES)('%s 는 error 0', async (_label, code) => {
    const { lines, fatal } = await lintWorklet(code, PROD_PROBE);

    expect(fatal).toEqual([]);
    expect(lines).toEqual([]);
  });

  // TEST_IGNORES·app/_dev 는 운영 번들 밖이라 의도적으로 제외한다(결정 D3).
  it.each([
    ['*.test.ts', TEST_FILE_PROBE],
    ['app/_dev 프리뷰', DEV_PREVIEW_PROBE],
  ])('%s 는 worklet 기본값이 있어도 error 0', async (_label, filePath) => {
    const { lines, fatal } = await lintWorklet(
      WORKLET_DECL_WITH_CONST_DEFAULT,
      filePath
    );

    expect(fatal).toEqual([]);
    expect(lines).toEqual([]);
  });
});

// 공허 통과 방지 앵커 — 음성 코드 전부와 양성 1줄을 한 파일에 이어붙여, 음성은 안 울리고 양성만 정확히
// 그 줄에서 울리는지 본다(규칙이 아예 없으면 [] ≠ [줄] 로 red). 개수가 아니라 줄 번호로 비교한다.
describe('음성 코드 묶음과 같은 파일에서 양성은 자기 줄에서만 울린다', () => {
  it.each([
    ['src .ts', PROD_PROBE],
    ['src .tsx', WORKLET_TSX_PROBE],
  ])('%s 에서 앵커 한 줄만 error', async (_label, filePath) => {
    const negatives = WORKLET_NEGATIVES.map(([, code]) => code).join('');
    const anchor =
      "export function anchor(a: number, w = 3): number {\n  'worklet';\n  return a + w;\n}\n";
    const anchorLine = negatives.split('\n').length;

    const { lines, fatal } = await lintWorklet(negatives + anchor, filePath);

    expect(fatal).toEqual([]);
    expect(Array.from(new Set(lines))).toEqual([anchorLine]);
  });
});

describe('누름 이동 연타 관통 (TRIP-1013) — 인라인 화살표의 router 이동만 error', () => {
  // 얼린 기존 위반은 lintText 에 적용되지 않는다 — 규칙 발동과 오탐 제외(서버 응답 뒤 onSuccess)만 본다.
  const page = (attr: string) =>
    [
      "import { useRouter } from 'expo-router';",
      "import { Pressable } from 'react-native';",
      'declare function save(o: { onSuccess: () => void }): void;',
      'export function Probe() {',
      '  const router = useRouter();',
      `  return <Pressable onPress={${attr}} />;`,
      '}',
      '',
    ].join('\n');
  it('onPress={() => router.push(…)} 는 error, mutate onSuccess 안 이동은 error 0', async () => {
    expect(await lint(page("() => router.push('/')"), PAGE_PROBE)).toContain(
      RESTRICTED_SYNTAX
    );
    expect(
      await lint(
        page("() => save({ onSuccess: () => router.replace('/') })"),
        PAGE_PROBE
      )
    ).toEqual([]);
  });
});

describe('테스트 재팽창 방지 (2026-11-01 jest 축소 — README 판정 3~6)', () => {
  // 기존 위반은 eslint-suppressions.json 에 얼려 있다(CLI 전용) — lintText 는 얼림을 적용하지 않아 규칙 발동만 본다.
  const T = 'src/__tests__/zzRegrowthProbe.test.tsx';
  it.each([
    [
      'UNSAFE 쿼리',
      'screen.UNSAFE_getByType(View);',
      'no-restricted-properties',
    ],
    [
      'className 읽기',
      'expect(el.props.className).toContain("x");',
      'no-restricted-properties',
    ],
    [
      'style 읽기',
      'expect(el.props.style).toEqual({});',
      'no-restricted-properties',
    ],
    [
      'toHaveStyle',
      'expect(el).toHaveStyle({ opacity: 1 });',
      'no-restricted-syntax',
    ],
    [
      '통과형 목 prop',
      'expect(sheet.props.snapPoints).toEqual([]);',
      'no-restricted-syntax',
    ],
    [
      '손 조립 QueryClient',
      'const qc = new QueryClient();',
      'no-restricted-syntax',
    ],
    ['소스 스캔 import', "import fs from 'fs';", 'no-restricted-imports'],
  ])('%s → error', async (_label, code, rule) => {
    expect(await lint(code, T)).toContain(rule);
  });
  it('test-support 는 QueryClient 를 만들어도 error 0 (정의처)', async () => {
    expect(
      await lint('const qc = new QueryClient();', 'src/test-support/zzProbe.ts')
    ).toEqual([]);
  });
  it('남은 출시·보안 스캔 파일은 fs 를 써도 error 0 (SCAN_ALLOW)', async () => {
    expect(
      await lint(
        "import fs from 'fs';",
        'src/__tests__/socialSdkSecrets.test.ts'
      )
    ).not.toContain('no-restricted-imports');
  });
  it('앱 코드에는 이 금지를 걸지 않는다 (props.style 을 쓰는 프로덕션 코드)', async () => {
    expect(
      await lint(
        'export const s = (p: { style: unknown }) => p.style;',
        'src/shared/ui/zzProbe.ts'
      )
    ).toEqual([]);
  });
});
