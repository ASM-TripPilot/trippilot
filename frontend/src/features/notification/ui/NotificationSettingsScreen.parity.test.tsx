import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import {
  NotificationSettingsScreen,
  type ToggleValueMap,
} from './NotificationSettingsScreen';
import { PermissionBanner } from './PermissionBanner';

/**
 * TRIP-774 · l02 알림 설정 Figma(1600:2388) 정합 — 렌더 트리 className 가드.
 *
 * 무엇을 보장하나:
 *  - AC-2 열 정렬: 헤더 "인앱" 칸과 행의 인앱 토글 칸이 같은 폭·같은 간격을 쓰고, 공통 조상까지의
 *    오른쪽 여백 합이 같다. 지금은 카드에만 `px-lg` 가 있어 헤더 글자가 토글보다 16px 오른쪽에 있다.
 *  - AC-4b(01b Q2=A): 숨은 푸시 분기의 권한 배너는 r12·버튼 r8·문구 13. 운영·프리뷰 어디에도 안 보여
 *    육안 대조가 닿지 않으므로 이 가드가 유일한 그물이다.
 *
 * jest 는 좌표를 모른다 — 실제 픽셀 정렬·구분선 전폭·그림자는 [검증] 04b·6-b 소관(02a §4-11).
 * 조상은 호스트 요소만 센다: 합성 `View` 도 className 을 들고 있어 그대로 세면 토큰이 두 번 잡힌다.
 */

/** BR-U6-18 기본값 — SLOT_PRE·PLAN_B 는 푸시 OFF·인앱 ON, 나머지는 둘 다 ON. */
const DEFAULT_VALUES: ToggleValueMap = {
  STAY: { pushEnabled: true, inAppEnabled: true },
  TRIP_PRE: { pushEnabled: true, inAppEnabled: true },
  TRIP_DAY: { pushEnabled: true, inAppEnabled: true },
  SLOT_PRE: { pushEnabled: false, inAppEnabled: true },
  PLAN_B: { pushEnabled: false, inAppEnabled: true },
  REFLECTION: { pushEnabled: true, inAppEnabled: true },
};

function tokens(el: ReactTestInstance): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

function hostAncestors(el: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  let cur = el.parent;
  while (cur) {
    if (typeof cur.type === 'string') out.push(cur);
    cur = cur.parent;
  }
  return out;
}

const WIDTH = /^(min-|max-)?w-/;
const GAP = /^gap-(x-)?(.+)$/;
/** 오른쪽 여백을 만드는 토큰 → 값 부분(`px-lg`→`lg`, `-mx-lg`→`-lg`). */
const RIGHT_INSET = /^(-?)(?:p|px|pr|m|mx|mr)-(.+)$/;

function widthTokens(el: ReactTestInstance): string[] {
  return tokens(el)
    .filter((t) => WIDTH.test(t))
    .sort();
}

function gapKeys(el: ReactTestInstance): string[] {
  return tokens(el)
    .map((t) => GAP.exec(t)?.[2])
    .filter((v): v is string => v !== undefined)
    .sort();
}

function insetKeys(chain: ReactTestInstance[]): string[] {
  return chain
    .flatMap(tokens)
    .map((t) => {
      const m = RIGHT_INSET.exec(t);
      return m ? `${m[1]}${m[2]}` : undefined;
    })
    .filter((v): v is string => v !== undefined)
    .sort();
}

function renderColumns() {
  render(
    <NotificationSettingsScreen
      values={DEFAULT_VALUES}
      pushColumnAvailable
      onToggle={jest.fn()}
      onOpenSettings={jest.fn()}
    />
  );
  const header = hostAncestors(screen.getByText('인앱'));
  const row = hostAncestors(
    screen.getByTestId('notification-settings-toggle-inapp-STAY')
  );
  return { header, row };
}

describe('TRIP-774 · AC-2 — 열 헤더 "인앱"이 인앱 토글 열과 정렬된다', () => {
  it('헤더 칸과 행의 인앱 칸이 같은 폭 클래스를 쓰고, 옛 52px 칸이 아니다', () => {
    // 준비·실행: 헤더 글자와 인앱 토글의 바로 위 칸.
    const { header, row } = renderColumns();
    const headerCell = header[0];
    const rowCell = row[0];

    // 단언: 폭 토큰이 있고, 서로 같고, 52px 이 아니다.
    expect(widthTokens(rowCell).length).toBeGreaterThan(0);
    expect(widthTokens(headerCell)).toEqual(widthTokens(rowCell));
    expect(widthTokens(rowCell)).not.toContain('w-[52px]');
  });

  it('두 열 사이 간격이 헤더와 행에서 같다', () => {
    const { header, row } = renderColumns();

    // 칸의 부모 = 두 열을 묶는 클러스터.
    expect(gapKeys(header[1])).toEqual(gapKeys(row[1]));
  });

  it('공통 조상까지의 오른쪽 여백 합이 헤더 줄과 토글 행에서 같다', () => {
    // 준비·실행: 두 조상 목록이 처음 만나는 곳(공통 조상) 직전까지를 사슬로 자른다.
    const { header, row } = renderColumns();
    const common = row.find((el) => header.includes(el));
    expect(common).toBeDefined();
    const headerChain = header.slice(2, header.indexOf(common!));
    const rowChain = row.slice(2, row.indexOf(common!));

    // 단언: 사슬이 비지 않았고(헤더 줄·행 루트), 오른쪽 여백 값 목록이 같다.
    expect(headerChain.length).toBeGreaterThan(0);
    expect(rowChain.length).toBeGreaterThan(0);
    expect(insetKeys(headerChain)).toEqual(insetKeys(rowChain));
  });
});

describe('TRIP-774 · AC-4b (01b Q2=A) — 숨은 권한 배너 값', () => {
  it('배너는 r12, [설정 이동] 버튼은 r8, 안내 문구는 13(text-label)이다', () => {
    // 준비·실행: 배너 단독 렌더(화면의 푸시 분기는 비공개 상수 뒤라 닿지 않는다).
    render(<PermissionBanner onOpenSettings={jest.fn()} />);
    const banner = screen.getByTestId(
      'notification-settings-permission-banner'
    );
    const button = hostAncestors(screen.getByText('설정 이동'))[0];
    const copy = screen.getByText('기기 설정에서 알림 권한을 허용하세요');

    // 단언
    expect(tokens(banner)).toContain('rounded-[12px]');
    expect(tokens(banner)).not.toContain('rounded-[20px]');
    expect(tokens(button)).toContain('rounded-[8px]');
    expect(tokens(button)).not.toContain('rounded-pill');
    expect(tokens(copy)).toContain('text-label');
  });
});
