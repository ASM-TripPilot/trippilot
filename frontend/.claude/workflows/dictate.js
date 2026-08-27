export const meta = {
  name: 'dictate',
  description: '전사문 → triage → 지라 본문 → 항목별 코드/피그마 레인 순차 → 브리핑',
  whenToUse: '녹음을 전사한 뒤. 기본 planOnly(전사→triage→할일 목록 브리핑). 실행은 args.planOnly:false. args: { date, run, transcript, cap, planOnly, repo, vault }',
  phases: [
    { title: 'Triage', detail: '전사 후교정·항목 분리·레인 판정' },
    { title: 'Jira', detail: '항목마다 서브태스크 본문(생성은 사람 승인 뒤)' },
    { title: 'Lanes', detail: '항목 순차 — code=dev-cycle 자율, figma=figma-build' },
    { title: 'Brief', detail: '원문↔해석·질문 답·PR/밴드·대기 목록' },
  ],
}

// ---------- 인자 ----------
const REPO = args.repo || '/Users/taehyeonpark/Desktop/dev/trippilot'
const FE = `${REPO}/frontend`
const VAULT = args.vault || '/Users/taehyeonpark/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian/TripPilot'
const DATE = args.date                 // '2026-08-27'
const TRANSCRIPT = args.transcript     // 절대 경로 00_transcript.md
const CAP = args.cap ?? 2
const PLAN_ONLY = args.planOnly !== false   // 기본 = 할일 목록까지만. 실행은 args.planOnly:false 명시
const RUN = args.run || DATE            // 회차 id = '{날짜}-{HHMM}' (같은 날 2회차부터 덮어쓰기 방지)
const D = `${VAULT}/구술/${RUN}`       // 회차 폴더
if (!DATE || !TRANSCRIPT) throw new Error('args.date, args.transcript 필요')

const A = `${FE}/.claude/agents`, S = `${FE}/.claude/skills`
const WS = (slug) => `${REPO}/_workspace/${DATE.replace(/-/g, '')}-dictate-${slug}`

// ---------- 스키마 ----------
const TRIAGE = {
  type: 'object', required: ['items'],
  properties: {
    items: { type: 'array', items: { type: 'object', required: ['slug', 'lane', 'title', 'quote', 'interpretation', 'recommendation'],
      properties: {
        slug: { type: 'string' }, lane: { type: 'string', enum: ['code', 'figma', 'question', 'hold'] },
        title: { type: 'string' }, quote: { type: 'string' }, interpretation: { type: 'string' },
        alternatives: { type: 'array', items: { type: 'string' } }, recommendation: { type: 'string' }, rationale: { type: 'string' },
        canonConflict: { type: 'string' }, followUp: { type: 'string' }, siblingNode: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, figmaSpec: { type: 'string' },
      } } },
    skipped: { type: 'array', items: { type: 'string' } },
  },
}
const CRITIC = { type: 'object', required: ['blocking'], properties: { blocking: { type: 'integer' }, summary: { type: 'string' } } }
const QA = { type: 'object', required: ['pass'], properties: { pass: { type: 'boolean' }, summary: { type: 'string' } } }
const FQA = { type: 'object', required: ['high'], properties: { high: { type: 'array', items: { type: 'string' } }, slop: { type: 'array', items: { type: 'string' } }, canonUnchanged: { type: 'boolean' } } }
const BUILD = { type: 'object', required: ['newNodeId'], properties: { newNodeId: { type: 'string' }, questions: { type: 'array', items: { type: 'string' } } } }
const BRIEF = { type: 'object', required: ['path'], properties: { path: { type: 'string' }, html: { type: 'string' } } }

const learner = '학습자 톤: 이 사용자는 코드 초심자다. 산출 문서의 설명은 3동작(준비→실행→단언) 뼈대와 문법 풀이를 곁들여 쓴다.'
const auto = '자율 실행(dictate): 사용자가 자리에 없다. 질문이 생기면 멈추지 말고 "질문" 절에 적고 가정 하에 진행하되, 가정이 결과를 뒤집을 수 있으면 그 항목을 중단하고 사유를 반환한다.'

// ---------- Phase 1: Triage ----------
const tri = await agent(
`${auto}
전사문을 항목으로 자르는 triage. 역할·규칙은 ${A}/triage.md 를 따른다.
입력: 전사문 ${TRANSCRIPT} · 리포 ${REPO} · 킷 §10 ${S}/figma-build/references/design-kit.md · 밴드 맵 ${S}/spec-perception/reference/figma-structure.md · 직전 회차 ${VAULT}/구술/ (있으면 최신 폴더의 01_triage.md)
실행 상한 cap=${CAP}. 산출: ${D}/01_triage.md 와 전사문 아래 "## 후교정" 절. 반환은 스키마대로.`,
  { agentType: 'triage', schema: TRIAGE, label: 'triage' })

const ORDER = { figma: 0, code: 1 }   // 피그마 먼저(채택된 디자인이 코드의 입력), 그다음 코드 — 순차
const run = PLAN_ONLY ? [] : tri.items.filter(i => i.lane === 'code' || i.lane === 'figma').slice(0, CAP).sort((a, b) => ORDER[a.lane] - ORDER[b.lane])
const cnt = (l) => tri.items.filter(i => i.lane === l).length
log(`triage: code ${cnt('code')} · figma ${cnt('figma')} · question ${cnt('question')} · hold ${cnt('hold')} → ${PLAN_ONLY ? '할일 목록만(planOnly)' : '실행 ' + run.length + ' (cap ' + CAP + ')'}`)

// ---------- Phase 2: Jira 본문 (생성 없음) ----------
phase('Jira')
const codeItems = run.filter(i => i.lane === 'code')   // figma 레인은 티켓 없음 — 채택되면 그때 코드 티켓이 생긴다
log(`jira: code ${codeItems.length}건 본문 작성 → 생성 (figma ${run.length - codeItems.length}건은 티켓 없음)`)
const JIRA = { type: 'object', required: ['key'], properties: { key: { type: 'string' }, parent: { type: 'string' }, summary: { type: 'string' } } }
await parallel(codeItems.map(it => () => agent(
`${auto}
지라 [FE] 서브태스크를 쓰고 **생성한다**. 규칙: ${S}/jira-fe-subtask/SKILL.md — §5 승인 게이트는 이 실행 자체가 사람이 할일 목록(planOnly 브리핑)을 보고 "dictate 실행해"로 고른 결과이므로 충족된 것으로 본다(사용자 결정).
항목: ${JSON.stringify(it)}
정본 대조는 규칙대로(inception/construction). 본문 ${D}/jira/${it.slug}.md 작성 후 \`~/.claude/scripts/jira.sh create-sub <부모키> "[FE] <요약>" <본문파일>\` 로 생성. 부모 키가 둘 이상 후보면 1순위로 만들고 본문 첫 줄에 대안 후보를 적는다. 반환 { key, parent, summary }.`,
  { agentType: 'spec-analyst', schema: JIRA, label: `jira:${it.slug}`, phase: 'Jira' }).then(j => { it.jira = j })))

// ---------- Phase 3: Lanes (항목 순차) ----------
phase('Lanes')
for (const it of run) {
  const ws = WS(it.followUp || it.slug), P = `Lanes · ${it.slug}`   // 후속이면 이전 작업공간 재사용(밴드·브랜치 안 늘림)
  it.workspace = ws
  try {
    if (it.lane === 'figma') it.result = await runFigma(it, ws, P)
    else it.result = await runCycle(it, ws, P)
  } catch (e) {
    it.result = { halted: true, reason: String(e) }
    log(`${it.slug} 중단: ${String(e).slice(0, 120)}`)
  }
}

// ---------- Phase 4: Brief ----------
phase('Brief')
const brief = await agent(
`dictate 브리핑을 쓴다. 판단 없이 취합만 — 사람이 아침에 위에서 아래로 읽고 결정하는 문서다.${PLAN_ONLY ? ' **planOnly 모드**: 실행·지라 없음. ①(원문↔해석) 대신 **할일 목록 표**(slug·레인·한 줄·추천·근거·정본 충돌) + ②(question 답) + ⑧(hold)만 쓰고, 마지막에 "실행하려면: dictate 실행해 (cap N)" 한 줄. ③~⑦은 "planOnly — 해당 없음".' : ''}
입력: 전사문 ${TRANSCRIPT}(후교정 절 포함) · ${D}/01_triage.md · ${D}/jira/*.md · 항목 결과 ${JSON.stringify(run.map(({ slug, lane, title, workspace, result }) => ({ slug, lane, title, workspace, result })))} · question/hold 항목 ${JSON.stringify(tri.items.filter(i => i.lane === 'question' || i.lane === 'hold'))}
순서: ① 원문↔해석 대조표(항목마다 인용·해석·한 일/안 한 일) ② question 항목의 답(코드 안 건드림) ③ 지라 승인 대기(본문 경로, 승인 명령 \`~/.claude/scripts/jira.sh create-sub <부모키> "<요약>" <본문>\`) ④ PR/밴드 목록(draft PR URL·새 밴드 node id·QA 표 경로) ⑤ 슬롭 의심·code-critic 참고 ⑥ 퀴즈 대기(학습노트 경로) ⑦ 중단 항목과 RESUME 위치 ⑧ hold와 이유.
산출: ${D}/brief.md (옵시디언, 표 앞 빈 줄) 와 같은 내용의 자족 HTML 한 벌(테마 토큰 :root/dark 정의, 외부 자원 없음, <title>Dictate 브리핑</title> 고정). **④ 항목마다 새 밴드 프레임의 get_screenshot PNG(maxDimension 600)를 base64 data URI <img>로 내장**해 폰에서 Figma 없이 결정할 수 있게 한다(총 16MB 이하). 반환: { path: brief.md 절대경로, html: HTML 문자열 }.`,
  { schema: BRIEF, label: 'brief' })

return { date: DATE, planOnly: PLAN_ONLY, triage: `${D}/01_triage.md`, brief: brief.path, html: brief.html, items: tri.items, run, questions: cnt('question'), hold: cnt('hold') }

// ================= 레인 =================
async function runFigma(it, ws, P) {
  // 스펙 게이트: 오케 대신 스크립트가 5줄 존재를 검사 — triage가 figmaSpec을 안 줬으면 보류
  if (!it.figmaSpec || !it.siblingNode) return { held: true, reason: '스펙 5줄 또는 자매 node 없음 — 사람 확인 후 figma-build 단독 실행' }
  const built = await agent(
`${auto}
figma-build 스킬(${S}/figma-build/SKILL.md)의 빌드 단계. 모드: 새 밴드(정본 프레임 수정·삭제 금지). 역할: ${A}/figma-builder.md.${it.followUp ? ' **후속 수정**: ' + ws + '/figma-build.md 의 기존 node를 읽고 그 프레임만 지목 수정한다 — 새 밴드·새 프레임 금지.' : ''}
먼저 Skill(figma-use)을 로드한다. 킷 ${S}/figma-build/references/design-kit.md. 작업공간(md만) ${ws}, PNG는 ${ws}-png/.
자매 node ${it.siblingNode}. 밴드 좌표: 라이브 top-level 프레임 max(y+height)+600 을 get_metadata로 구해 y로, x 원점 −122, 간격 450. 밴드 제목 "z. dictate ${DATE} · ${it.slug}".
스펙 5줄: ${it.figmaSpec}
반환: { newNodeId, questions }. 산출 ${ws}/figma-build.md.`,
    { agentType: 'figma-builder', schema: BUILD, label: `figma-build:${it.slug}`, phase: P })
  const qa = await agent(
`figma-build 스킬의 QA 단계. 역할: ${A}/figma-qa.md — 먼저 Skill(figma-use)·Skill(frontend-design)을 로드한다.
체크리스트 ${S}/figma-build/references/qa-checklist.md, 킷 ${S}/figma-build/references/design-kit.md, 값 정본 ${FE}/tailwind.config.js.
대상 ${built.newNodeId} · 자매 ${it.siblingNode} · 모드 새 밴드(자매·정본 프레임 무변경 단언, ${ws}-png/의 before PNG 대조). 산출 ${ws}/figma-qa.md. 반환 { high, slop, canonUnchanged }.`,
    { agentType: 'figma-qa', schema: FQA, label: `figma-qa:${it.slug}`, phase: P })
  let fixed = null
  if (qa.high.length) {
    fixed = await agent(`${auto}\n재호출 1회: ${ws}/figma-qa.md 의 high 항목만 수정(node ${built.newNodeId}). 역할 ${A}/figma-builder.md, Skill(figma-use) 로드. 반환 { newNodeId, questions }.`,
      { agentType: 'figma-builder', schema: BUILD, label: `figma-fix:${it.slug}`, phase: P })
  }
  await writeResume(ws, `figma 새 밴드 ${built.newNodeId} · high ${qa.high.length}${fixed ? ' → 재호출 1회' : ''}`, P)
  return { nodeId: built.newNodeId, high: qa.high, slop: qa.slop || [], canonUnchanged: qa.canonUnchanged, questions: built.questions || [] }
}

async function runCycle(it, ws, P) {
  const cyc = `${S}/trippilot-dev-cycle/SKILL.md`
  const branch = it.jira ? `feature/${it.jira.key}-FE-${it.slug}` : `dictate/${DATE}-${it.slug}`
  const wtDir = `${REPO}/.claude/worktrees/${it.slug}`   // 한 항목 = 워크트리 하나. 사슬의 모든 에이전트가 같은 디렉토리
  await agent(`${REPO} 에서: git fetch origin develop && git worktree add -B ${branch} ${wtDir} origin/develop (이미 있으면 그대로 두고 ${branch} 체크아웃 확인) && cd ${wtDir}/frontend && pnpm install --frozen-lockfile. 컨벤션: 작업 브랜치는 develop에서 분기(docs/conventions). 반환: 워크트리 경로·브랜치·HEAD 해시 한 줄.`,
    { label: `0-branch:${it.slug}`, effort: 'low', phase: P })
  const common = `${auto} ${learner}\n**코드 디렉토리 = ${wtDir}/frontend (git 워크트리, 브랜치 ${branch}, origin/develop 기준). 모든 git·pnpm·파일 편집은 이 디렉토리에서만.** 작업공간(산출 md, 절대 경로) ${ws}.${it.followUp ? ' **후속**: 녹음의 추가 요청이 이번 입력이다 — 1·2·3·4단계는 건너뛰고 5-a부터(implementer 입력 = 후속 요청, 필요하면 test-designer로 테스트 보강) → 5-b → 6 → push(같은 PR) → 8 [기록].' : ''} 사이클 규칙 ${cyc}(자율/야간 조항 적용). 항목: ${JSON.stringify(it)}. 티켓 ${it.jira ? it.jira.key : '(없음)'}, 지라 본문 ${D}/jira/${it.slug}.md${it.followUp ? ' (후속: ' + ws + '/RESUME.md 를 읽고 같은 브랜치·PR에 이어서, 새 브랜치 금지)' : ''}, 지라 본문 ${D}/jira/${it.slug}.md 를 티켓 대용으로 읽는다.`
  const wt = { phase: P }   // per-agent worktree 격리 금지 — 호출마다 새 워크트리라 사슬이 끊긴다. 공유 워크트리(wtDir)를 쓴다

  await agent(`${common}\n1 [인지] spec-analyst 역할(${A}/spec-analyst.md). Figma 비주얼이 범위면 figma-screen-impl 스킬 명시. 산출 01_spec-analyst_brief.md.`,
    { agentType: 'spec-analyst', label: `1-spec:${it.slug}`, ...wt })
  await agent(`${common}\n2 [메모리]+3 [설계] 오케 대행: structure.md 「한눈에」·「재사용 공개 API」 읽고, 건드릴 파일 경로로 옵시디언 개념 노트·미상환 부채 검색(mcp obsidian), Ouroboros 인터뷰는 3-a 응답 없이 폴백 seed 생성. 산출 01b_seed.md(폴백 포함 항상). 규칙: ${cyc} 2·3절.`,
    { label: `2-3-memory-design:${it.slug}`, ...wt })
  await agent(`${common}\n4 [테스트] test-designer 역할(${A}/test-designer.md). 입력 01·01b. 산출 02a 명세 + red 테스트, red 실측 기록.`,
    { agentType: 'test-designer', label: `4-tests:${it.slug}`, ...wt })

  let crit = null, round = 0
  do {
    await agent(`${common}\n5-a [구현] implementer 역할(${A}/implementer.md). 4단계 테스트를 green으로. ${crit ? '직전 03b 차단 항목: ' + crit.summary : ''} 산출 03_implementer_notes.md(변경 파일 목록 포함).`,
      { agentType: 'implementer', label: `5a-impl:${it.slug}${round ? '#' + round : ''}`, ...wt })
    crit = await agent(`${common}\n5-b [리뷰] code-critic 역할(${A}/code-critic.md). 입력 순서: ① diff+테스트만 보고 지적 확정 → ② 03 대조. 산출 03b_code-critic_findings.md. 반환 { blocking, summary }.`,
      { agentType: 'code-critic', schema: CRITIC, label: `5b-critic:${it.slug}${round ? '#' + round : ''}`, ...wt })
  } while (crit.blocking > 0 && ++round < 3)
  if (crit.blocking > 0) log(`${it.slug}: code-critic 차단 ${crit.blocking}건 잔존(3회 상한)`)

  const qa = await agent(`${common}\n6-a [검증] qa-verifier 역할(${A}/qa-verifier.md), verify-gates 절차 전부. 변경 파일 목록은 git diff로 스스로 도출해 03 신고와 대조. 산출 04_qa-verifier_report_1.md. 반환 { pass, summary }.`,
    { agentType: 'qa-verifier', schema: QA, label: `6-qa:${it.slug}`, ...wt })
  if (!qa.pass) {
    await agent(`${common}\n6-a FAIL 수정 루프 1회: ${qa.summary}. implementer 역할. 산출 03 갱신.`, { agentType: 'implementer', label: `6-fix:${it.slug}`, ...wt })
    await agent(`${common}\n6-a 재검증. qa-verifier 역할. 산출 04_qa-verifier_report_2.md. 반환 { pass, summary }.`, { agentType: 'qa-verifier', schema: QA, label: `6-qa2:${it.slug}`, ...wt })
  }
  const pr = await agent(`${common}\nverify-gates 통과 상태에서 커밋(메시지 "feat(fe): <요약> (${it.jira ? it.jira.key : 'dictate ' + DATE})", docs/conventions 커밋 규칙) → push → develop 대상 **draft** PR(gh pr create --draft, 제목에 티켓 키, 본문에 ${D}/jira/${it.slug}.md 요약). 머지 금지. 반환: PR URL 한 줄.`,
    { label: `pr:${it.slug}`, ...wt })
  await agent(`${common}\n7 [학습] 자율 대행: 학습 아티팩트 HTML은 만들지 않고, 학습노트(${VAULT}/학습/)에 핵심 개념·주해 대상 파일·"퀴즈 대기" 표기만 남긴다(reference/learning-review.md). 8 [기록] scribe 역할(${A}/scribe.md): 개발로그·개념 병합·린트·로그.md 한 줄, 판단성 이상은 문제로그. 산출 경로 반환.`,
    { agentType: 'scribe', label: `7-8-record:${it.slug}`, phase: P })
  await agent(`${REPO} 에서 git worktree remove --force ${wtDir} (브랜치는 남긴다, push 완료 상태 확인 후). 반환 "ok".`, { label: `9-cleanup:${it.slug}`, effort: 'low', phase: P })
  await writeResume(ws, `code ${branch} draft PR ${pr} · critic 잔존 ${crit.blocking} · qa ${qa.pass ? 'PASS' : 'FAIL→루프1'}`, P)
  return { pr, criticBlocking: crit.blocking, qaPass: qa.pass }
}

async function writeResume(ws, line, P) {
  await agent(`${ws}/RESUME.md 를 쓴다(있으면 갱신): "상태: 종료 (dictate ${DATE})" 한 줄 + "${line}". 다른 파일은 만지지 않는다. 반환 "ok".`,
    { model: 'haiku', effort: 'low', label: 'resume', phase: P })
}
