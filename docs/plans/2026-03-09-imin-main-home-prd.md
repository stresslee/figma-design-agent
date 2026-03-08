# [Design] imin 메인 홈 화면 — PRD 기반 신규 디자인

## PRD 요약
아임인(imin) 핵심 서비스 '스테이지' 참여 유도 + 매일 혜택으로 리텐션 강화

## 화면 구성 (위→아래)
1. **Status Bar** — clone_node(1:3448)
2. **NavBar** — imin 로고(인스턴스) + 알림(bell) + 채팅(message-chat-circle) 아이콘
3. **Transaction Ribbon** — "누적 거래 3,191,399건" (저대비: bg-brand-primary + fg-tertiary)
4. **Hero Carousel** — 3장 배너 카드 (HORIZONTAL, clipsContent, 353×200)
   - 배너 1: "친구 초대 수입" (bg-brand-solid)
   - 배너 2: "화장품 프로모션" (bg-success-solid)
   - 배너 3: "스테이지 특별 이벤트" (bg-warning-solid)
   - Indicator dots (1/5)
5. **추천! 스테이지** — Underline 탭(빠른 시작/많은 혜택) + 스테이지 카드 2장 + 전체보기
6. **놓칠 수 없는 즐거움** — 럭키박스 + 기프트샵 카드 (2열)
7. **매일매일 혜택받기** — 친구구조대, 출석체크, 포인트쿠폰소 리스트
8. **목돈 계산기 배너** — CTA 카드 (아이콘+텍스트+chevron)
9. **FAB** — "마이 월릿" pill (120×44, ABSOLUTE)
10. **Tab Bar** — 홈/커뮤니티/스테이지/라운지/나 (ABSOLUTE)

## 디자인 규칙 적용
- $token() 컬러 참조
- Hero: HORIZONTAL carousel + clipsContent
- Tabs: Underline 스타일 (pill 금지)
- 모든 FRAME: layoutSizingHorizontal="FILL"
- Tab Bar/FAB: ABSOLUTE + 루트 하단
- FAB: pill 120×44, cornerRadius 22
- Ribbon: 저대비 (bg-brand-primary + fg-tertiary)
- 섹션 간 24px 균일 간격
