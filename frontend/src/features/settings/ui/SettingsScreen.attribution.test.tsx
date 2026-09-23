import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { buildSettingsSections } from '../model/settingsSections';
import { SettingsScreen } from './SettingsScreen';

/**
 * TRIP-886 AC-1 · AC-2 · AC-4 · AC-5 — 설정 하단 데이터 출처 고지 블록(프레젠테이션).
 *
 * 무엇을 보장하나:
 *  - AC-1: 버전 문구 바로 다음에 출처 세 줄이 글자 그대로 보인다 — 링크 콜백이 없어도(고지는 의무).
 *  - AC-2: OSM 줄을 누르면 주입된 콜백이 정확히 1회 나가고, 나머지 두 줄은 링크가 아니다.
 *  - AC-4: 계정 삭제 유예(pending) 상태에서도 블록이 남는다.
 *  - AC-5: 블록은 그룹이 아니다 — 그룹 수는 buildSettingsSections 그대로, 어느 그룹 안에도 없다.
 * URL 과 Linking.openURL 배선은 페이지 몫이라 SettingsPage.attribution.test.tsx 가 잠근다.
 *
 * ⚠️ 문구의 `·`(U+00B7)·`©`(U+00A9)는 글자 그대로 적었다 — 문자열 매처는 완전일치라 ASCII `.`·`(c)`
 *  로 바뀌면 red 다(02a ★1).
 *
 * (개념) `fireEvent.press` 는 누른 요소에서 위로 올라가며 가장 가까운 onPress 를 부른다 — 블록 전체를
 *  Pressable 로 감싸면 TourAPI 줄을 눌러도 콜백이 나가므로, "이 줄만 링크"를 그 성질로 잰다(02a ★3).
 */

const noop = () => {};

const SOURCE_TITLE = '데이터 출처';
const SOURCE_DATASETS = '한국관광공사 TourAPI · Overture Maps Foundation';
const SOURCE_OSM = '© OpenStreetMap contributors';

function sections() {
  return buildSettingsSections({ nickname: '여행자123', email: 'a@b.com' });
}

function renderScreen(
  overrides: Partial<React.ComponentProps<typeof SettingsScreen>> = {}
) {
  return render(
    <SettingsScreen
      groups={sections()}
      deletionState="active"
      currentNickname="여행자123"
      onPressBack={noop}
      onSubmitNickname={noop}
      onPressExport={noop}
      onPressDeleteAccount={noop}
      onPressCancelDeletion={noop}
      {...overrides}
    />
  );
}

/**
 * 렌더 트리의 글자를 읽는 순서대로 모아 하나로 잇는다. 중첩 Text(`© <Text>…</Text>`)는 조각으로
 * 쪼개져 나오므로 구분자 없이 이어야 원문이 된다(02a ★2).
 */
function readingText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(readingText).join('');
  const children = (node as { children?: unknown[] | null }).children;
  return children ? children.map(readingText).join('') : '';
}

describe('TRIP-886 · 설정 데이터 출처 고지 (AC-1 · AC-2 · AC-4 · AC-5)', () => {
  it('AC-1: 링크 콜백이 없어도 출처 블록에 세 줄이 글자 그대로 보인다', () => {
    // 준비·실행: 링크 콜백 없이 그린다(프리뷰와 같은 조건).
    renderScreen();

    // 단언: 블록 안에 세 줄이 완전일치로 있다.
    const block = within(screen.getByTestId('settings-data-attribution'));
    expect(block.getByText(SOURCE_TITLE)).toBeTruthy();
    expect(block.getByText(SOURCE_DATASETS)).toBeTruthy();
    expect(block.getByText(SOURCE_OSM)).toBeTruthy();
  });

  it('AC-1(위치): 출처 블록은 버전 문구 바로 다음에 온다 — 사이에 다른 문구가 끼지 않는다', () => {
    // 준비: 링크 콜백 없이, 버전을 주고 그린다(TRIP-935 — 버전이 없으면 버전 줄 자체가 없다).
    renderScreen({ appVersion: '0.1.0' });

    // 실행: 화면 글자를 읽는 순서대로 잇는다.
    const text = readingText(screen.toJSON());
    const versionAt = text.indexOf('TripPilot v');
    const blockAt = text.indexOf(SOURCE_TITLE + SOURCE_DATASETS + SOURCE_OSM);

    // 단언: 버전이 있고, 블록이 그 뒤에 있으며, 둘 사이에 한글(그룹 이름·행 문구)이 없다.
    expect(versionAt).toBeGreaterThanOrEqual(0);
    expect(blockAt).toBeGreaterThan(versionAt);
    expect(text.slice(versionAt, blockAt)).not.toMatch(/[가-힣]/);
  });

  it('AC-2: OSM 줄을 누르면 주입된 링크 콜백이 정확히 1회 나간다', () => {
    // 준비: 링크 콜백을 가짜로 주입한다.
    const onPressOsmCopyright = jest.fn();
    renderScreen({ onPressOsmCopyright });

    // 실행: OSM 줄을 누른다.
    fireEvent.press(screen.getByTestId('settings-osm-copyright'));

    // 단언: 정확히 한 번.
    expect(onPressOsmCopyright).toHaveBeenCalledTimes(1);
  });

  it('AC-2(이 줄만 링크): 제목·TourAPI 줄을 눌러도 콜백은 나가지 않는다 — OSM 줄만 링크다', () => {
    // 준비: 링크 콜백을 가짜로 주입한다.
    const onPressOsmCopyright = jest.fn();
    renderScreen({ onPressOsmCopyright });
    const block = within(screen.getByTestId('settings-data-attribution'));

    // 실행: 링크가 아닌 두 줄을 누른다.
    fireEvent.press(block.getByText(SOURCE_TITLE));
    fireEvent.press(block.getByText(SOURCE_DATASETS));

    // 단언: 콜백 0회.
    expect(onPressOsmCopyright).not.toHaveBeenCalled();

    // 짝 앵커: OSM 줄은 여전히 눌리고 1회 나간다(콜백이 아예 끊긴 구현의 공허 통과 차단).
    fireEvent.press(block.getByText(SOURCE_OSM));
    expect(onPressOsmCopyright).toHaveBeenCalledTimes(1);
  });

  it('AC-4: 계정 삭제 유예(pending) 상태에서도 출처 블록 세 줄이 보인다', () => {
    // 준비·실행: 유예 상태로 그린다.
    renderScreen({ deletionState: 'pending', purgeAt: '2026-10-23T00:00:00Z' });

    // 앵커: 화면이 실제로 유예 상태로 그려졌다.
    expect(screen.getByTestId('settings-deletion-pending')).toBeTruthy();

    // 단언: 출처 블록은 상태와 무관하게 남는다.
    const block = within(screen.getByTestId('settings-data-attribution'));
    expect(block.getByText(SOURCE_TITLE)).toBeTruthy();
    expect(block.getByText(SOURCE_DATASETS)).toBeTruthy();
    expect(block.getByText(SOURCE_OSM)).toBeTruthy();
  });

  it('AC-5: 출처 블록은 그룹이 아니다 — 그룹 수는 그대로이고 어느 그룹 안에도 없다', () => {
    // 준비·실행: 링크 콜백 없이 그린다.
    renderScreen();

    // 단언 1: 그룹 수는 입력 VM 그대로(블록이 그룹 하나를 더 만들지 않는다, 02a ★10).
    const groups = screen.getAllByTestId('settings-group');
    expect(groups).toHaveLength(sections().length);

    // 단언 2: 어느 그룹 안에도 블록이 없다.
    for (const group of groups) {
      expect(
        within(group).queryByTestId('settings-data-attribution')
      ).toBeNull();
    }

    // 짝 앵커: 블록 자체는 화면에 있다(블록이 아예 없어 공허 통과하는 것 차단).
    expect(screen.getByTestId('settings-data-attribution')).toBeTruthy();
  });
});
