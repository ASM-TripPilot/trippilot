/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * AC3 · AC4 · AC5 · (제약) PUT 배선 없음 — 취향 온보딩 구조 가드.
 *
 * 무엇을 보장하나: 렌더로는 관찰할 수 없는 소스·배치 수준의 제약을 잠근다.
 *  - 취향 라우트(pref1·pref2)가 (onboarding) 그룹에 있고 각 라우트가 해당 컨테이너를
 *    참조하는 얇은 래퍼다(D7 회귀 방지, 위치 라우트 패턴과 동일).
 *  - preferenceStore.ts가 zustand create를 쓰되 persist류 저장을 참조하지 않는다
 *    ("세션 메모리만" 결정을 기계로 강제).
 *  - 신규 취향 표면(store·containers·screens·routes) 전체가 서버 취향 저장 엔드포인트를
 *    참조하지 않는다(Q1 미결 — PUT 배선 금지, ScopeBoundaryHit 가드).
 *  - 약관·닉네임 화면에는 '나중에 설정하고 시작' 탈출구가 새어 들어오지 않는다(AC-11-3).
 *
 * 가짜 통과 방지 규약(onboardingStructure.test.ts 관례 그대로): "없어야 한다" 단언은
 * 반드시 "있어야 한다" 단언과 같은 it 안에서 짝을 이룬다 — 부정 단언만 있으면 대상
 * 파일이 통째로 비어 있어도 초록으로 통과한다(§7-5).
 */

const ROOT = path.resolve('src');
const ONBOARDING_ROUTE_DIR = path.join(ROOT, 'app', '(onboarding)');
const TABS_ROUTE_DIR = path.join(ROOT, 'app', '(tabs)');
const FEATURE_DIR = path.join(ROOT, 'features', 'onboarding');
const PAGES_DIR = path.join(ROOT, 'pages');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

describe('취향 라우트 배치 (AC3 · 6-1)', () => {
  it('pref1·pref2 라우트가 (onboarding) 그룹에 있고 각각 해당 컨테이너를 참조하며, (tabs)에는 없다', () => {
    const pref1Path = path.join(ONBOARDING_ROUTE_DIR, 'pref1.tsx');
    const pref2Path = path.join(ONBOARDING_ROUTE_DIR, 'pref2.tsx');

    // 긍정 — 두 라우트 파일이 실제로 있다.
    expect(fs.existsSync(pref1Path)).toBe(true);
    expect(fs.existsSync(pref2Path)).toBe(true);

    // 긍정 — 얇은 래퍼답게 각자 해당 컨테이너를 참조한다(terms.tsx/nickname.tsx와 동형).
    expect(read(pref1Path)).toMatch(/PrefStep1Page/);
    expect(read(pref2Path)).toMatch(/PrefStep2Page/);

    // 부정 — 탭 그룹에는 pref 라우트가 없다.
    const tabsFiles = fs.existsSync(TABS_ROUTE_DIR)
      ? fs.readdirSync(TABS_ROUTE_DIR)
      : [];
    expect(tabsFiles.filter((f) => /pref/i.test(f))).toEqual([]);
  });
});

describe('스토어 persist 금지 (AC5 · 6-2)', () => {
  it('preferenceStore.ts가 zustand create를 쓰되 영속 저장을 참조하지 않는다', () => {
    const storePath = path.join(FEATURE_DIR, 'model', 'preferenceStore.ts');

    // 긍정 — 파일이 있고 zustand의 create를 실제로 쓴다.
    expect(fs.existsSync(storePath)).toBe(true);
    const source = read(storePath);
    expect(source).toMatch(/\bcreate\(/);

    // 부정 — persist 미들웨어·AsyncStorage·secure-store 참조가 없다("세션 메모리만" 결정).
    expect(source).not.toMatch(/persist/);
    expect(source).not.toMatch(/zustand\/middleware/);
    expect(source).not.toMatch(/AsyncStorage/);
    expect(source).not.toMatch(/expo-secure-store/);
  });
});

describe('서버 미전송 (AC 제약: PUT 배선 없음 · ScopeBoundaryHit · 6-3)', () => {
  it('신규 취향 표면 전체가 서버 취향 저장 엔드포인트를 참조하지 않는다', () => {
    const files = [
      path.join(FEATURE_DIR, 'model', 'preferenceStore.ts'),
      path.join(PAGES_DIR, 'onboarding-pref1', 'ui', 'PrefStep1Page.tsx'),
      path.join(PAGES_DIR, 'onboarding-pref2', 'ui', 'PrefStep2Page.tsx'),
      path.join(FEATURE_DIR, 'ui', 'PrefStep1Screen.tsx'),
      path.join(FEATURE_DIR, 'ui', 'PrefStep2Screen.tsx'),
      path.join(ONBOARDING_ROUTE_DIR, 'pref1.tsx'),
      path.join(ONBOARDING_ROUTE_DIR, 'pref2.tsx'),
    ];

    // 긍정 — 파일들이 전부 존재한다(조용한 배선 선행을 차단하려면 대상이 실재해야 한다).
    files.forEach((file) => {
      expect({ file, exists: fs.existsSync(file) }).toEqual({
        file,
        exists: true,
      });
    });

    // 부정 — 저장 엔드포인트·함수·네트워크 계층 참조가 전혀 없다.
    const offenders = files.flatMap((file) => {
      const source = read(file);
      const hits = [
        '/me/preferences',
        'updatePreferences',
        '@/shared/api',
      ].filter((needle) => source.includes(needle));
      return hits.map((needle) => `${file}: ${needle}`);
    });
    expect(offenders).toEqual([]);
  });
});

describe('약관·닉네임은 탈출 비대상 (AC4 · AC-11-3 · 6-4 · 선제 green)', () => {
  it('약관·닉네임 화면 소스에는 일괄 탈출 문구가 없다', () => {
    const termsPath = path.join(FEATURE_DIR, 'ui', 'TermsScreen.tsx');
    const nicknamePath = path.join(FEATURE_DIR, 'ui', 'NicknameScreen.tsx');

    // 긍정 — 두 화면 파일이 존재한다(부재 단언과 짝 — 가짜 통과 방지).
    expect(fs.existsSync(termsPath)).toBe(true);
    expect(fs.existsSync(nicknamePath)).toBe(true);

    // 부정 — '나중에 설정하고 시작' 문구가 새어 들어오지 않는다. 지금은 무변경이라
    // 이미 green이지만, 앞으로 이 화면에 탈출구가 추가되면 이 가드가 잡는다.
    expect(read(termsPath)).not.toMatch(/나중에 설정하고 시작/);
    expect(read(nicknamePath)).not.toMatch(/나중에 설정하고 시작/);
  });
});

describe('활동 스포츠 부재 주석 (AC-8 · 6-5)', () => {
  it('PrefStep2Screen에 활동 블록이 있고, "스포츠는 정본 9종·계약 8종" 불일치 주석이 남아 있다', () => {
    const screenPath = path.join(FEATURE_DIR, 'ui', 'PrefStep2Screen.tsx');
    const source = read(screenPath);

    // 긍정(짝) — 활동 블록이 실재한다(별도 testID prefix, 02a §2 계약). 이게 없으면
    // "스포츠 언급"만으로 통과하는 공허 초록이 되므로 반드시 활동 블록 존재와 짝짓는다.
    expect(source).toMatch(/onboarding-pref2-activity/);

    // 긍정 — "스포츠" 언급이 소스에 남아 있다. 스포츠는 렌더 옵션이 아니므로(PrefStep2Screen
    // 렌더 테스트가 옵션 부재를 별도로 잠근다) 소스에 등장하는 "스포츠"는 주석뿐이다.
    expect(source).toMatch(/스포츠/);
    // 긍정 — 그 주석이 정본 9종·계약 8종 불일치를 설명한다(BE 확인 대기). 표현 자유도를
    // 위해 세 토큰 중 하나만 있으면 통과(구현자 문구 재량, 의도는 고정).
    expect(source).toMatch(/8종|BE|계약/);
  });
});

describe('g01 여행 생성 동반 유형 불변 (AC-10 · BR-U1-39 · 6-6 · 무회귀 앵커)', () => {
  it('온보딩 라벨을 커플로 바꿔도 g01(여행 생성)의 "연인"은 그대로 남는다', () => {
    const TRIP_MODEL_DIR = path.join(ROOT, 'features', 'trip', 'model');
    const wizardStep1Path = path.join(TRIP_MODEL_DIR, 'tripWizardStep1.ts');
    const tripDraftPath = path.join(TRIP_MODEL_DIR, 'tripDraft.ts');

    // 긍정 — 두 정본 파일이 실재한다.
    expect(fs.existsSync(wizardStep1Path)).toBe(true);
    expect(fs.existsSync(tripDraftPath)).toBe(true);

    // 긍정 — g01 동반 유형 목록에 "연인"이 여전히 있다(온보딩 커플과 별개 상수).
    expect(read(wizardStep1Path)).toMatch(/연인/);

    // 긍정 — tripDraft의 온보딩→g01 매핑이 "커플"과 "연인"을 둘 다 유지한다
    // (`['커플','연인']` — 온보딩 라벨 변경이 이 매핑을 통해 g01의 "연인"으로 이어진다).
    const tripDraftSource = read(tripDraftPath);
    expect(tripDraftSource).toMatch(/연인/);
    expect(tripDraftSource).toMatch(/커플/);
  });
});
