import { MagazinePage } from '@/pages/magazine/ui/MagazinePage';

/**
 * a02 매거진 목록 라우트 `/magazine`(TRIP-700). 홈(a01) discovery 캐러셀 page0 에서 push 로
 * 진입한다. `pages/magazine` 은 배럴(index.ts)이 없어 페이지를 딥 경로로 직참조한다(리포 최초
 * 무배럴 페이지 — 01b 확정, 티켓 §FSD "배럴 안 만듦"). `(tabs)` 밖 파일시스템 라우트.
 */
export default function MagazineRoute() {
  return <MagazinePage />;
}
