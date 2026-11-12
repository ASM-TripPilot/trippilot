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
// TRIP-1799 — 클립보드 입구(`shared/clipboard`)도 photo 와 같은 "정적 import 금지·호출 시점 require 허용" 계약.
const CLIPBOARD_PROBE = 'src/shared/clipboard/__release_probe__.ts';
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

  // TRIP-1799 — 모듈 없는 옛 dev build 에서 expo-clipboard 는 로드 순간 던진다(`requireNativeModule`). 입구(`@/shared/clipboard`)만 호출 시점에 연다.
  it('shared/clipboard 입구도 expo-clipboard 를 정적 import 하면 error', async () => {
    const ruleIds = await lint(
      "import * as Clipboard from 'expo-clipboard';\nexport const probe = Clipboard;\n",
      CLIPBOARD_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  it('shared/clipboard 입구가 함수 안에서 require 로 여는 것은 error 0', async () => {
    const ruleIds = await lint(
      "export const probe = () =>\n  // eslint-disable-next-line @typescript-eslint/no-require-imports\n  require('expo-clipboard') as typeof import('expo-clipboard');\n",
      CLIPBOARD_PROBE
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
    ['expo-clipboard/build/Clipboard'],
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
      // TRIP-1765 — role 을 달아 둔다(없으면 role 게이트가 음성까지 울린다).
      `export const Probe = () => (\n  <Pressable\n    accessibilityRole="button"\n${attr}\n  />\n);`,
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
      `  return <Pressable accessibilityRole="button" onPress={${attr}} />;`,
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

// TRIP-1765 · M-99 — 누름 요소(Pressable·Touchable*)에 역할이 없으면 낭독기·XCUITest 가 버튼으로 못 본다.
// 조각은 role 말고 어떤 게이트에도 안 걸리게 짰다(실제 함수 핸들러·router 이동 없음) — 음성 짝이 [] 로 그것을 보인다.
// pages·app 블록과 .tsx 전역 블록이 같은 룰을 덮어쓰므로(위 ⚠️) 두 쪽 경로에서 각각 양성을 본다.
describe('누름 요소엔 역할을 단다 (TRIP-1765) — role 없는 Pressable·Touchable* 은 error', () => {
  const roleProbe = (tag: string, attr = '') =>
    [
      "import { Pressable, TouchableOpacity } from 'react-native';",
      'declare function go(): void;',
      `export const Probe = () => <${tag} ${attr}onPress={go} />;`,
      '',
    ].join('\n');

  it.each([
    ['pages', 'Pressable', PAGE_PROBE],
    ['app 라우트', 'Pressable', ROUTE_PROBE],
    ['pages 밖 features', 'Pressable', WORKLET_TSX_PROBE],
    ['pages 밖 features 의 Touchable', 'TouchableOpacity', WORKLET_TSX_PROBE],
  ])('%s — role 없는 <%s> 는 error', async (_label, tag, filePath) => {
    const ruleIds = await lint(roleProbe(tag), filePath);

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  it.each([
    ['accessibilityRole', 'accessibilityRole="button" '],
    ['role', 'role="button" '],
  ])('%s 가 있으면 error 0', async (_label, attr) => {
    const ruleIds = await lint(roleProbe('Pressable', attr), PAGE_PROBE);

    expect(ruleIds).toEqual([]);
  });
});

// TRIP-1768 · react-hooks 7.x 컴파일러 규칙(recommended)이 error 로 켜져 있는지 대표 1규칙으로 본다.
// 기존 위반은 eslint-suppressions.json 에 얼려 있다 — lintText 는 얼림을 적용하지 않아 규칙 발동만 본다.
describe('React Compiler 규칙은 error (TRIP-1768) — 렌더 중 ref.current 읽기', () => {
  const refDuringRender = [
    "import { useRef } from 'react';",
    '',
    'export function useProbe(): number {',
    '  const ref = useRef(0);',
    '  return ref.current;',
    '}',
    '',
  ].join('\n');

  it.each([
    ['pages', PAGE_PROBE],
    ['app 라우트', ROUTE_PROBE],
  ])('%s — react-hooks/refs 가 error 로 울린다', async (_label, filePath) => {
    const ruleIds = await lint(refDuringRender, filePath);

    expect(ruleIds).toContain('react-hooks/refs');
  });
});

// TRIP-1773 · M-66 — 글리프 파일(`*Glyphs.tsx`) 사이에 같은 이름을 내보내면 error (`no-restricted-exports`).
// 금지 목록은 설정 로드 때 디스크의 글리프 파일에서 읽는다: 파일 F 에는 "F 가 아닌 다른 글리프 파일이 정의한 이름"이 걸린다.
// 그래서 가짜 경로(어느 실파일도 아님)에서는 모든 글리프 이름이, 실파일에서는 자기 이름만 빠진 목록이 걸린다.
// 양성 탐침의 이름은 공용(shared/ui/glyphs)이 계속 들고 있을 `ChevronRightGlyph`·`LockGlyph` 다 — 슬라이스 쪽 이름은 개명되므로 쓰지 않는다.
// 이 룰은 `export * from`(이름 없는 전체 재수출)을 못 본다 — 그 사각은 탐침으로 굳히지 않고 02a 에 적었다.
describe('글리프 이름은 파일 사이에 겹치지 않는다 (TRIP-1773) — no-restricted-exports', () => {
  const NO_RESTRICTED_EXPORTS = 'no-restricted-exports';
  const SLICE_GLYPH_PROBE = 'src/features/settings/ui/zzProbeGlyphs.tsx';
  const PAGES_GLYPH_PROBE = 'src/pages/settings/settings/ui/zzProbeGlyphs.tsx';
  const NAVIGATION_GLYPHS = 'src/shared/ui/glyphs/NavigationGlyphs.tsx';
  const declare = (name: string) =>
    `export function ${name}() {\n  return null;\n}\n`;

  it('다른 파일이 이미 정의한 이름을 새 글리프 파일이 내보내면 error', async () => {
    const ruleIds = await lint(declare('ChevronRightGlyph'), SLICE_GLYPH_PROBE);

    expect(ruleIds).toEqual([NO_RESTRICTED_EXPORTS]);
  });

  it('고유한 이름이면 error 0', async () => {
    const ruleIds = await lint(declare('ZzProbeOnlyGlyph'), SLICE_GLYPH_PROBE);

    expect(ruleIds).toEqual([]);
  });

  it('pages 경로에서도 error (같은 룰을 덮는 pages 블록 뒤에서 살아 있다)', async () => {
    const ruleIds = await lint(declare('ChevronRightGlyph'), PAGES_GLYPH_PROBE);

    expect(ruleIds).toEqual([NO_RESTRICTED_EXPORTS]);
  });

  it('`export { A as 겹치는이름 }` 별칭으로 내보내도 error', async () => {
    const aliased =
      'function Local() {\n  return null;\n}\nexport { Local as ChevronRightGlyph };\n';

    const ruleIds = await lint(aliased, SLICE_GLYPH_PROBE);

    expect(ruleIds).toEqual([NO_RESTRICTED_EXPORTS]);
  });

  it('`export const` 화살표 정의도 error', async () => {
    const arrow = 'export const ChevronRightGlyph = () => null;\n';

    const ruleIds = await lint(arrow, SLICE_GLYPH_PROBE);

    expect(ruleIds).toEqual([NO_RESTRICTED_EXPORTS]);
  });

  it('실파일은 자기 이름만 통과하고 다른 파일의 이름은 여전히 error (자기를 뺀 덮어쓰기 블록)', async () => {
    const own = await lint(declare('ChevronRightGlyph'), NAVIGATION_GLYPHS);
    const other = await lint(declare('LockGlyph'), NAVIGATION_GLYPHS);

    expect(own).toEqual([]);
    expect(other).toEqual([NO_RESTRICTED_EXPORTS]);
  });

  it('글리프 파일이 아니면(이름이 *Glyphs.tsx 가 아님) 이 금지를 걸지 않는다', async () => {
    const ruleIds = await lint(
      declare('ChevronRightGlyph'),
      'src/features/settings/ui/zzProbe.tsx'
    );

    expect(ruleIds).toEqual([]);
  });
});

// TRIP-1774 · M-76 — 화면·TS 소스에 raw hex 가 새로 들어오면 error (`trippilot/no-raw-hex`, 로컬 규칙 `scripts/noRawHex.cjs`).
// 독립 규칙 id 라 `no-restricted-syntax` 덮어쓰기 함정(블록 3개 펼침)이 없고, 면제 파일은 이 규칙만 끄므로 다른 게이트는 그대로 켜져 있다.
// 이 규칙은 hex 만 본다 — rgba()·이름 색(white·black)·문자열 연결로 만든 hex·`.js/.cjs/.json`·루트 app.config.ts 는 사정거리 밖이다.
// 정규식·토큰 이름 찾기의 경계는 scripts/noRawHex.test.ts 가 문자열로 직접 잰다. 여기서는 "어느 파일에서 울리나"만 본다.
// ⚠️ 규칙 정의가 안 보이는 파일의 `eslint-disable trippilot/no-raw-hex` 도 같은 ruleId 로 error("Definition … not found")가 난다 —
//    그래서 아래 탐침은 ruleId 만이 아니라 줄 번호·메시지까지 본다.
describe('raw hex 는 토큰으로 (TRIP-1774) — trippilot/no-raw-hex', () => {
  const NO_RAW_HEX = 'trippilot/no-raw-hex';
  const TS_PROBE = 'src/features/settings/__hex_probe__.ts';
  const TSX_PROBE = 'src/features/settings/__hex_probe__.tsx';
  const PAGES_TSX_PROBE = 'src/pages/settings/settings/ui/__hex_probe__.tsx';
  const ROUTE_TSX_PROBE = 'app/trips/__hex_probe__.tsx';
  const DEV_TSX_PROBE = 'app/_dev/__hex_probe__.tsx';
  // 01b 결정 5 — 토큰 밖 고유 색을 파일 단위로 면제한다(블록 위 주석에 사유).
  const EXEMPT_FILES = [
    'src/features/reflection/model/categoryPalette.ts',
    'src/features/explore/model/regions.ts',
    'src/features/auth/config/gradients.ts',
    'src/shared/map/webMapController.ts',
    'src/features/auth/ui/AuthGlyphs.tsx',
    'src/pages/onboarding/onboarding-tour/ui/TourGlyphs.tsx',
  ];
  const siblingOf = (file: string) =>
    file.replace(/([^/]+)(\.tsx?)$/, '__hex_sibling__$2');
  const hexIn = (hex: string) => `export const COLOR = '${hex}';\n`;

  // severity=error 메시지 전체(ruleId·줄·본문). 위 ⚠️ 때문에 ruleId 만 보면 "정의 없음" error 가 양성처럼 보인다.
  async function errors(code: string, filePath: string) {
    const [result] = await eslint.lintText(code, {
      filePath: path.resolve(filePath),
    });
    return result.messages
      .filter((m) => m.severity === 2)
      .map((m) => ({ ruleId: m.ruleId, line: m.line, message: m.message }));
  }
  const hexErrorLines = async (code: string, filePath: string) =>
    (await errors(code, filePath))
      .filter((e) => e.ruleId === NO_RAW_HEX)
      .map((e) => e.line);

  it('.ts 의 hex 문자열은 error', async () => {
    const found = await errors(hexIn('#C2CCD6'), TS_PROBE);

    expect(found.map((e) => e.ruleId)).toEqual([NO_RAW_HEX]);
  });

  it('.tsx 의 JSX 속성 문자열 hex 는 error', async () => {
    const code = [
      "import Svg, { Path } from 'react-native-svg';",
      'export const Probe = () => (',
      '  <Svg>',
      '    <Path fill="#C2CCD6" />',
      '  </Svg>',
      ');',
      '',
    ].join('\n');

    const found = await errors(code, TSX_PROBE);

    expect(found.map((e) => e.ruleId)).toEqual([NO_RAW_HEX]);
  });

  it('pages 경로의 .tsx 도 error (no-restricted-syntax 블록과 달리 pages 만 빠지지 않는다)', async () => {
    const code = 'export const Probe = () => <view fill="#C2CCD6" />;\n';

    const found = await errors(code, PAGES_TSX_PROBE);

    expect(found.map((e) => e.ruleId)).toContain(NO_RAW_HEX);
  });

  it.each([
    ['app 라우트', ROUTE_TSX_PROBE],
    ['app/_dev 프리뷰 (면제 아님)', DEV_TSX_PROBE],
  ])('%s 의 hex 도 error', async (_label, filePath) => {
    const found = await errors(hexIn('#C2CCD6'), filePath);

    expect(found.map((e) => e.ruleId)).toEqual([NO_RAW_HEX]);
  });

  it('className 임의값 bg-[#ECECEC] 도 error', async () => {
    const code = [
      "import { View } from 'react-native';",
      'export const Probe = () => <View className="items-start bg-[#ECECEC]" />;',
      '',
    ].join('\n');

    const found = await errors(code, TSX_PROBE);

    expect(found.map((e) => e.ruleId)).toEqual([NO_RAW_HEX]);
  });

  it('템플릿 리터럴 안의 hex 도 error (표현식이 섞인 것·없는 것 둘 다)', async () => {
    const withExpr = 'export const A = `a ${1} b #C2CCD6`;\n';
    const plain = 'export const B = `border-[#C4C9CF]`;\n';

    expect(await hexErrorLines(withExpr, TS_PROBE)).toEqual([1]);
    expect(await hexErrorLines(plain, TS_PROBE)).toEqual([1]);
  });

  it('한 문자열에 hex 가 둘이면 error 도 둘', async () => {
    const found = await errors(
      "export const A = 'linear #C2CCD6 #C4C9CF';\n",
      TS_PROBE
    );

    expect(found.map((e) => e.ruleId)).toEqual([NO_RAW_HEX, NO_RAW_HEX]);
  });

  it.each([
    ['3자리', '#000', true],
    ['8자리(알파)', '#FFFFFF00', true],
    ['4자리', '#abcd', false],
    ['5자리', '#abcde', false],
  ])('%s %s → error %s', async (_label, hex, flagged) => {
    const lines = await hexErrorLines(hexIn(hex), TS_PROBE);

    expect(lines).toEqual(flagged ? [1] : []);
  });

  it('토큰과 같은 값이면 메시지가 그 토큰 이름을 알려준다 (별칭이면 둘 다)', async () => {
    const canon = jest.requireActual<Record<string, string>>(
      '../shared/config/colorTokens.cjs'
    );
    const primary = await errors(hexIn(canon.primary), TS_PROBE);
    const white = await errors(
      hexIn(canon['on-primary'].toLowerCase()),
      TS_PROBE
    );

    expect(primary).toHaveLength(1);
    expect(primary[0].message).toContain('같은 값 토큰:');
    expect(primary[0].message).toContain('`primary`');
    expect(white[0].message).toContain('`on-primary`');
    expect(white[0].message).toContain('`canvas`');
  });

  it('토큰에 없는 값이면 토큰 안내 없이 hex 만 알려준다', async () => {
    const [only] = await errors(hexIn('#010203'), TS_PROBE);

    expect(only.ruleId).toBe(NO_RAW_HEX);
    expect(only.message).toContain('#010203');
    expect(only.message).not.toContain('같은 값 토큰:');
  });

  describe('예외는 사유 주석 한 줄이거나 이름 붙인 면제 파일뿐', () => {
    it('`eslint-disable-next-line` 사유 줄은 바로 다음 줄만 덮는다 — 주석 안 hex 는 안 걸리고, 그다음 줄은 여전히 error', async () => {
      const code = [
        '// eslint-disable-next-line trippilot/no-raw-hex -- Figma raw fill #C2CCD6, 토큰 없음',
        "export const DISABLED = '#C2CCD6';",
        "export const STILL_BAD = '#C2CCD6';",
        '',
      ].join('\n');

      const found = await errors(code, TS_PROBE);

      expect(found.map((e) => [e.ruleId, e.line])).toEqual([[NO_RAW_HEX, 3]]);
    });

    it('JSX 속성 사이의 `//` 사유 줄은 바로 아래 속성만 덮는다', async () => {
      const code = [
        "import Svg, { Path } from 'react-native-svg';",
        'export const Probe = () => (',
        '  <Svg>',
        '    <Path',
        '      // eslint-disable-next-line trippilot/no-raw-hex -- Figma raw fill, 토큰 없음',
        '      fill="#C2CCD6"',
        '      stroke="#C2CCD6"',
        '    />',
        '  </Svg>',
        ');',
        '',
      ].join('\n');

      const found = await errors(code, TSX_PROBE);

      expect(found.map((e) => [e.ruleId, e.line])).toEqual([[NO_RAW_HEX, 7]]);
    });

    it('템플릿 문자열 안 `${ … }` 표현식 속 리터럴도 윗줄 사유 주석으로 덮인다 (위저드 버튼 className 형태)', async () => {
      const code = [
        'export const cls = (off: boolean) =>',
        '  `w ${',
        '    // eslint-disable-next-line trippilot/no-raw-hex -- Figma raw fill, 토큰 없음',
        "    off ? 'bg-[#E9E9EB]' : 'bg-primary'",
        '  }`;',
        '',
      ].join('\n');

      const found = await errors(code, TS_PROBE);

      expect(found).toEqual([]);
    });

    it.each(EXEMPT_FILES)(
      '면제 파일 %s 는 통과, 같은 폴더의 형제 파일은 여전히 error (폴더 단위 면제 아님)',
      async (file) => {
        const exempt = await errors(hexIn('#C2CCD6'), file);
        const sibling = await errors(hexIn('#C2CCD6'), siblingOf(file));

        expect(exempt).toEqual([]);
        expect(sibling.map((e) => e.ruleId)).toEqual([NO_RAW_HEX]);
      }
    );

    it('면제 파일에서도 다른 게이트는 켜져 있다 — role 없는 Pressable 은 여전히 error, hex 는 아니다', async () => {
      const code = [
        "import { Pressable } from 'react-native';",
        'declare function go(): void;',
        'export const Probe = () => <Pressable onPress={go} testID="#C2CCD6" />;',
        '',
      ].join('\n');
      const exemptFile = 'src/features/auth/ui/AuthGlyphs.tsx';

      const exempt = await errors(code, exemptFile);
      const sibling = await errors(code, siblingOf(exemptFile));

      expect(exempt.map((e) => e.ruleId)).toEqual([RESTRICTED_SYNTAX]);
      expect(sibling.map((e) => e.ruleId).sort()).toEqual(
        [NO_RAW_HEX, RESTRICTED_SYNTAX].sort()
      );
    });
  });

  describe('규칙이 닿지 않는 파일', () => {
    it.each([
      ['단위 테스트', 'src/features/settings/__hex_probe__.test.ts'],
      ['__tests__ 폴더', 'src/__tests__/__hex_probe__.ts'],
      ['__mocks__ 폴더', 'src/shared/__mocks__/__hex_probe__.ts'],
      ['test-support', 'src/test-support/__hex_probe__.ts'],
    ])('%s 의 hex 는 error 아님', async (_label, filePath) => {
      const found = await errors(hexIn('#C2CCD6'), filePath);

      expect(found).toEqual([]);
    });

    it('정본 폴더에서 `.cjs` 는 면제(블록 files 밖)이고 같은 폴더의 `.ts` 는 면제가 아니다', async () => {
      const cjs = await errors(
        "module.exports = { primary: '#FF385C' };\n",
        'src/shared/config/__hex_probe__.cjs'
      );
      const ts = await errors(
        hexIn('#FF385C'),
        'src/shared/config/__hex_probe__.ts'
      );

      expect(cjs).toEqual([]);
      expect(ts.map((e) => e.ruleId)).toEqual([NO_RAW_HEX]);
    });

    it('규칙이 꺼진 파일(테스트·.cjs)에 사유 주석이 남아 있어도 "정의 없음" error 는 나지 않는다 — 플러그인이 모든 파일에 등록돼 있다', async () => {
      const code =
        '// eslint-disable-next-line trippilot/no-raw-hex -- 사유\nexport const A = 1;\n';

      const inTest = await errors(
        code,
        'src/features/settings/__hex_probe__.test.ts'
      );
      const inCjs = await errors(
        '// eslint-disable-next-line trippilot/no-raw-hex -- 사유\nmodule.exports = 1;\n',
        'src/shared/config/__hex_probe__.cjs'
      );

      expect(inTest).toEqual([]);
      expect(inCjs).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-1740 · 서버 POI 사진은 `PoiPhoto` 로만 그린다 — `<PlacePhoto imageUrl=…>`·`<Image source={{ uri }}>` 직접 사용은 error.
//
// 왜 린트인가: 관광공사 3유형 사진은 자르면 안 되고(변경금지) 출처를 달아야 한다. 새 출구가 옛 부품으로 그리면 tsc 도 jest 도
// 침묵하므로(필수 prop 은 `PoiPhoto` 에만 있다) 우회 통로를 린트로 막는다. 예외(기기 사진·타사 숙소 사진)는 윗줄 사유 주석.
// 규칙 소스는 `no-restricted-syntax` 라서 다른 금지 항목이 같은 룰 ID 로 울려도 이 탐침이 green 이 되지 않도록
// **메시지 태그 `TRIP-1740`** 인 error 만 센다(worklet 절과 같은 방식 — 구현자 계약: 메시지에 `TRIP-1740` 을 넣는다).
// ⚠️ 덮어쓰기 함정: `.tsx` 블록이 셋(전체·pages·app 포함)이라 각 블록에서 따로 울리는지 파일군별로 본다.
describe('서버 사진은 PoiPhoto 로만 (TRIP-1740) — PlacePhoto imageUrl·Image source uri 직접 사용 금지', () => {
  const TAG = 'TRIP-1740';
  const tagged = async (code: string, filePath: string): Promise<number> => {
    const [result] = await eslint.lintText(code, {
      filePath: path.resolve(filePath),
    });
    return result.messages.filter(
      (m) => m.severity === 2 && m.message.includes(TAG)
    ).length;
  };

  const PLACE_PHOTO_IMPORT =
    "import { PlacePhoto } from '@/shared/ui/PlacePhoto';";
  const IMAGE_IMPORT = "import { Image } from '@/shared/ui/Image';";
  const placePhotoWithUrl = [
    PLACE_PHOTO_IMPORT,
    'export const Probe = () => <PlacePhoto imageUrl="https://img.example/a.jpg" category="맛집" />;',
    '',
  ].join('\n');
  const imageWithUri = [
    IMAGE_IMPORT,
    "export const Probe = () => <Image source={{ uri: 'https://img.example/a.jpg' }} />;",
    '',
  ].join('\n');
  // imageUrl 이 없는 PlacePhoto 는 번들 표지·숙소 그림 전용이라 통과해야 한다(과잉 매칭 방지).
  const bundleOnly = [
    PLACE_PHOTO_IMPORT,
    'export const Probe = () => <PlacePhoto category="숙소" poiId="stay-1" />;',
    '',
  ].join('\n');

  // 파일군 — 층 4곳(pages·widgets·entities·features) + 라우트. 덮어쓰기 블록마다 하나씩 걸린다.
  const TARGETS: [string, string][] = [
    ['pages (pages 블록)', PAGE_PROBE],
    ['features (전체 .tsx 블록)', WORKLET_TSX_PROBE],
    ['entities', 'src/entities/place/ui/__release_probe__.tsx'],
    ['widgets', 'src/widgets/time-sheet/ui/__release_probe__.tsx'],
    ['app 라우트', ROUTE_PROBE],
  ];

  it.each(TARGETS)(
    '%s — <PlacePhoto imageUrl=…> 는 error, imageUrl 없는 번들 전용 PlacePhoto 는 통과',
    async (_label, filePath) => {
      expect(await tagged(placePhotoWithUrl, filePath)).toBeGreaterThanOrEqual(
        1
      );
      expect(await tagged(bundleOnly, filePath)).toBe(0);
    }
  );

  it.each(TARGETS)(
    '%s — <Image source={{ uri }}> 직접 사용은 error',
    async (_label, filePath) => {
      expect(await tagged(imageWithUri, filePath)).toBeGreaterThanOrEqual(1);
    }
  );

  it('예외는 윗줄 사유 주석 한 줄이면 열린다 — 같은 코드가 주석 없이는 error, 있으면 0', async () => {
    const withReason = [
      PLACE_PHOTO_IMPORT,
      '// eslint-disable-next-line no-restricted-syntax -- 기기 사진(서버 POI 사진 아님)',
      'export const Probe = () => <PlacePhoto imageUrl="file:///device.jpg" />;',
      '',
    ].join('\n');
    const withoutReason = withReason.replace(
      /^\/\/ eslint-disable-next-line.*\n/m,
      ''
    );

    expect(
      await tagged(withoutReason, WORKLET_TSX_PROBE)
    ).toBeGreaterThanOrEqual(1);
    expect(await tagged(withReason, WORKLET_TSX_PROBE)).toBe(0);
  });

  it('테스트 파일은 이 금지의 대상이 아니다 — 같은 코드가 앱 파일에선 error, 테스트에선 0', async () => {
    expect(
      await tagged(placePhotoWithUrl, WORKLET_TSX_PROBE)
    ).toBeGreaterThanOrEqual(1);
    expect(
      await tagged(
        placePhotoWithUrl,
        'src/features/auth/ui/__release_probe__.test.tsx'
      )
    ).toBe(0);
  });
});
