import { MagazinePage } from '@/pages/magazine';

/**
 * a02 매거진 목록 라우트 `/magazine`(TRIP-700). 홈 진입은 출시 심사 감사(TRIP-935)로
 * 막혔다 — 화면이 고정 샘플·무반응이라 지금은 딥링크로만 닿는다. 페이지는 배럴 `@/pages/magazine`으로
 * 받는다(TRIP-1147로 배럴 신설 — 그 전엔 리포 유일의 무배럴 페이지였다). `(tabs)` 밖 파일시스템 라우트.
 */
export default function MagazineRoute() {
  return <MagazinePage />;
}
