/**
 * 库园丁 Vault Gardener —— Forsion 桌面插件(裸 setup(ctx) 体,宿主 new Function('ctx', code) 装载)。
 *
 * 三个 LCL 视图(space.json 组合成工作台:左 inbox + 主 diff + 右 history):
 *   plugin:vault-gardener:inbox   —— 扫描 + 提案队列 + 查找替换表单 + 待办清单
 *   plugin:vault-gardener:diff    —— 逐条前后对照,批准才落盘(**没有「全部应用」**)
 *   plugin:vault-gardener:history —— 撤销台账 + 逐条回滚 + 未完成写入/孤儿快照恢复区
 *
 * 定位:库越用越脏(坏 wikilink / 标签大小写与层级变体 / frontmatter 缺字段 / 一个词要在两百篇里改)。
 *   本插件扫全库、逐条给出前后逐字节 diff、你点批准才落盘、一次一条一文件、全程活动日志 + 撤销台账。
 *   **全部提案由插件自己用确定性规则算出——v1 一次都不发给模型**:核心承诺是「diff 可逐字节复核、
 *   预览等于落盘」,这条承诺一旦交给模型转述就当场破产(queue schema 预留 producer 字段供 v2 接第二生产者)。
 *
 * 毁数据防线(顺序不许调,见 applyProposalInner):读失败即拒写 → preHash 不符即拒写 → 无变化短路 →
 *   写快照并读回逐字节比对 → 台账 writing 并读回校验 → 写目标 → 读回自校验,不一致立刻回滚 → 台账 applied。
 * 逐字节保真:绝不归一换行(splitLines/joinLines 对任意串往返恒等);Amadeus 块标记行、围栏与行内代码、
 *   frontmatter 区(只有 fm-missing 与 tags 行例外)一律跳过;改写一律行内最小替换。
 *
 * 安全:全文件不拼任何 HTML 字符串、不做 markdown 渲染。diff 渲染的是原始文本行,一律 createElement + textContent。
 * 双语:一份 MSG(zh/en 键集合完全相等),ctx.getLocale() 取值、ctx.subscribeLocale() 跟变化,切语言不重挂即变。
 */
const PLUGIN_ID = 'vault-gardener'
const DEFAULT_WF = '库园丁'
const DEFAULT_RULES = 'broken-link,tag-variant,fm-missing'
const SCAN_RULES = ['broken-link', 'tag-variant', 'fm-missing']
const ALL_RULES = ['broken-link', 'tag-variant', 'fm-missing', 'find-replace', 'tag-op']
/** 单文件命中上限(内部常量,不做成设置项:它是「一条提案 = 一屏能看完的 diff」这条产品约束,不是调参旋钮)。 */
const MAX_HITS_PER_FILE = 200
const CHUNK = 20

// ══ 双语词表(两侧键集合必须完全相等,check.mjs 有断言) ══════════════════════
const MSG = {
  zh: {
    viewInbox: '库园丁:提案',
    viewDiff: '库园丁:对照',
    viewHistory: '库园丁:台账',
    cmdOpen: '库园丁:打开',
    cmdScan: '库园丁:扫描全库',
    setRulesLabel: '启用的规则(逗号分隔)',
    setRulesDesc: 'broken-link 坏链修复 / tag-variant 标签归一 / fm-missing 补 frontmatter 缺字段。与 inbox 的规则按钮互为镜像。',
    setFmLabel: 'frontmatter 必填字段(逗号分隔)',
    setFmDesc: '留空 = 关闭 fm-missing 规则。缺的字段会以空值补进去,绝不发明值。',
    setMaxScanLabel: '单次扫描文件数上限',
    setMaxScanDesc: '超出的文件不扫,记进待办清单。',
    setMaxKbLabel: '单文件大小上限(KB)',
    setMaxKbDesc: '超过的文件跳过并记进待办清单。',
    inboxTitle: '库园丁',
    inboxSub: '扫全库、逐条看 diff、你点批准才落盘。提案由确定性规则算出,不经过任何模型。',
    btnScan: '扫描全库',
    btnScanning: '扫描中…',
    btnHistory: '撤销台账',
    noRulesNote: '规则一条都没开 —— 现在扫描什么都找不到。先在上面点亮至少一条。',
    scanProgress: '已扫 {done}/{total}',
    wfHint: '产物写在工作文件夹:{wf}',
    rulesLabel: '规则',
    ruleBrokenLink: '坏链修复',
    ruleBrokenLinkDesc: '把指不到任何笔记的 [[wikilink]] 修成唯一那个候选;多候选或零候选只进待办清单。',
    ruleTagVariant: '标签归一',
    ruleTagVariantDesc: '同一标签的大小写 / 层级变体归到出现最多的那个写法;整标签边界替换,不碰别的标签。',
    ruleFmMissing: '补 frontmatter',
    ruleFmMissingDesc: '按设置里的必填字段补缺键,值留空;解析失败的 frontmatter 只进待办清单。',
    ruleFindReplace: '查找替换',
    ruleFindReplaceDesc: '全库字面串查找替换,由你显式发起;v1 不接正则。',
    ruleTagOp: '标签操作',
    ruleTagOpDesc: '标签改名 / 合并 / 层级重构,由你显式发起。整标签边界替换,正文的 #标签 与 frontmatter 的 tags: 列表两处都改。',
    frTitle: '查找替换',
    frFind: '查找',
    frReplace: '替换为',
    frCase: '区分大小写',
    frWhole: '全词匹配',
    frCode: '含代码块',
    frRun: '扫描命中',
    frNeedFind: '请先填写要查找的字符串。',
    tagOpTitle: '标签操作',
    tagOpModeRename: '改名',
    tagOpModeMerge: '合并',
    tagOpModeRestructure: '层级重构',
    tagOpFrom: '源标签',
    tagOpFromMulti: '源标签(逗号分隔,可多个)',
    tagOpTo: '目标标签',
    tagOpChildren: '连子层级一起搬',
    tagOpChildrenHint: '勾上时 #a/b/c 跟着 #a/b 一起搬;不勾只改 #a/b 自己。',
    tagOpRun: '预览影响',
    tagOpSummary: '将影响 {files} 篇,共 {hits} 处',
    tagOpForms: '命中的书面形态',
    tagOpForm: '{tag} × {n}',
    tagOpNoHit: '整库一处都没命中,没有产生任何提案 —— 一个字节都没写。',
    tagOpDedupeNote: 'frontmatter 的 tags 列表里,本次操作造成的重复会去掉多余的那条;文件原本就有的重复不动。',
    tagOpBodyDupNote: '正文里的重复标签不去重:那是句子里的词,删掉一个会留下断句。',
    errTagEmpty: '标签名不能为空。',
    errTagSpace: '标签名不能含空格:{tag}',
    errTagHash: '标签名里不能再有 # 号:{tag}',
    errTagSlash: '标签名不能以 / 起止,也不能出现连续的 //:{tag}',
    errTagPunct: '标签名的第一个字符不能是标点或符号:{tag}',
    errTagDigits: '标签名不能是纯数字(扫描器不会把纯数字当标签):{tag}',
    errTagTail: '标签名结尾不能是句读标点(扫描时会被当成句子里的标点剥掉):{tag}',
    errTagChar: '标签名里有扫描器认不回来的字符:{tag}',
    errTagSame: '目标标签与源标签完全一样,没有可改的东西:{tag}',
    errTagRoundTrip: '这个标签写下去之后我们自己的扫描器认不回原样,已拒绝:{tag}',
    errTagNeedFrom: '请先填写要操作的源标签。',
    proposalsLabel: '提案',
    todosLabel: '待办清单(只提示,不执行)',
    btnReport: '写出 audit 报告',
    reportOk: '已写出报告:{path}',
    reportOkSnap: '已写出报告:{path}(上一份里有你的改动,已存快照 {snap})',
    reportFail: '报告写入失败:{msg}',
    emptyNoScan: '还没扫描过。点「扫描全库」开始——扫描只读文件,一个字节都不会写。',
    emptyNoProposals: '这次扫描没有找到可自动修复的问题。',
    emptyNoTodos: '没有需要你手工处理的项。',
    seamNoSeam: '当前宿主版本不支持库枚举,请升级 Forsion 桌面后再扫描。',
    seamEmptyVault: '库里没有可扫的笔记(或当前没有打开笔记库)。',
    seamError: '库枚举失败:{msg}',
    statsLine: '笔记 {pages} 篇,已扫 {scanned},跳过 {skipped},提案 {proposals},待办 {todos}',
    hits: '命中 {n} 处',
    lineNo: '第 {n} 行',
    stOpen: '待审',
    stApproved: '已批准',
    stRejected: '已拒绝',
    stStale: '已过期',
    stApplied: '已应用',
    stFailed: '失败',
    stRolledBack: '已回滚',
    stWriting: '写入未完成',
    stBar: '园丁待审 {n}',
    stBarTitle: '库园丁:待你审批的提案条数',
    diffTitle: '逐条对照',
    diffNone: '还没有选中提案。到「库园丁:提案」里点一条,这里会显示它改前改后的每一行。',
    diffLoading: '正在重读文件复核…',
    diffStaleBanner: '文件已在扫描后改动,请重扫。这里不会画一份骗人的 diff。',
    diffMissing: '读不到这个文件了(可能已被移动或删除),请重扫。',
    diffNoChange: '按当前规则重算后这个文件没有变化,批准它等于零写入。',
    diffFile: '文件',
    diffRule: '规则',
    btnApprove: '批准并写入',
    btnReject: '拒绝',
    btnSkip: '跳过',
    btnPrev: '上一条',
    btnNext: '下一条',
    msgApplied: '已写入。同一文件的其它提案已标为过期,请重扫。',
    msgNoChange: '无变化,未写入任何字节。',
    msgRejected: '已拒绝。',
    msgStale: '文件已在扫描后改动,拒绝写入。请重扫。',
    msgReadFail: '读不到这个文件,拒绝写入。',
    msgSnapFail: '撤销快照写入或校验失败,一个字节都没碰目标文件:{msg}',
    msgLedgerFail: '撤销台账写入失败,拒绝继续,目标文件未改动。',
    msgFailedRolled: '写后自校验不一致,已自动回滚到改前内容:{path}',
    msgFailedHardOp: '写入与回滚都校验失败,本次会话已停止一切后续写入。操作 {op},快照在 {snap}',
    msgHalted: '本次会话已因一次写入失败而停止写入,请重开 Forsion 后再试。',
    msgActivePage: '这个文件正开在编辑器里:{path}。编辑器手上有一份更新的副本,它下一次自动保存会把整篇盖回去 —— 那样改动会凭空消失而台账却记着成功。已拒绝写入,一个字节都没碰。请先关掉这篇笔记(或切到别的标签页)再回来批准。',
    msgApplyError: '写入过程出错:{msg}',
    histTitle: '撤销台账',
    histEmpty: '还没有任何写入记录。',
    histUnfinished: '上次写入可能未完成',
    histOrphan: '孤儿快照(不在台账里)',
    btnRollback: '回滚',
    btnViewSnap: '查看快照',
    btnHideSnap: '收起快照',
    snapTitle: '改前快照(只读)',
    msgRollbackOk: '已回滚到改前内容。',
    msgRollbackNotLanded: '文件仍是改前内容 —— 那次写入根本没落地。台账这一条已结为失败,你的文件一个字节都没被碰过。',
    msgRollbackChanged: '该文件在应用之后又被改过,回滚会吃掉你的后续编辑,已拒绝。',
    msgRollbackNoSnap: '找不到改前快照(可能被手工删掉了),无法回滚。',
    msgRollbackBadSnap: '快照与台账记录的哈希对不上,拒绝回滚。',
    msgRollbackNoFile: '读不到这个文件,无法回滚。',
    msgRollbackFail: '回滚失败:{msg}',
    todoLinkAmbiguous: '这个链接同时像 {n} 篇笔记,请自己定夺',
    todoLinkMissing: '这个链接指不到任何笔记,也没有近似候选',
    todoFmParseError: 'frontmatter 的 --- 开了没闭合,解析不了,已完全跳过这个文件',
    todoFileTooLarge: '文件 {n} KB 超过上限,已跳过',
    todoScanLimit: '超过单次扫描上限,这一批 {n} 个文件没扫',
    todoHitsTooMany: '单文件命中 {n} 处超过上限,没有出提案',
    todoReadFailed: '读不到这个文件,已跳过',
    achSeries: '库园丁',
    achFirst: '第一株杂草',
    achFirstDesc: '批准并写入第一条提案',
    achFifty: '园丁的手',
    achFiftyDesc: '累计批准写入 50 条提案',
    achScanner: '巡园人',
    achScannerDesc: '累计扫描全库 10 次',
    repTitle: '库园丁待办清单',
    repMeta: '扫描于 {at},笔记 {pages} 篇,已扫 {scanned},跳过 {skipped}',
    repTodos: '需要你手工处理',
    repProposals: '待你审批的提案',
    repNone: '(无)',
    repFoot: '本清单由库园丁生成。移动 / 重命名 / 归档 / 合并类建议一律只出现在这里,插件不会执行它们。',
  },
  en: {
    viewInbox: 'Gardener: Proposals',
    viewDiff: 'Gardener: Diff',
    viewHistory: 'Gardener: Journal',
    cmdOpen: 'Vault Gardener: Open',
    cmdScan: 'Vault Gardener: Scan vault',
    setRulesLabel: 'Enabled rules (comma separated)',
    setRulesDesc: 'broken-link / tag-variant / fm-missing. Mirrors the rule buttons in the inbox view.',
    setFmLabel: 'Required frontmatter keys (comma separated)',
    setFmDesc: 'Empty turns the fm-missing rule off. Missing keys are added with an empty value — no value is ever invented.',
    setMaxScanLabel: 'Max files per scan',
    setMaxScanDesc: 'Files beyond this limit are left unscanned and listed in the follow-up list.',
    setMaxKbLabel: 'Max file size (KB)',
    setMaxKbDesc: 'Larger files are skipped and listed in the follow-up list.',
    inboxTitle: 'Vault Gardener',
    inboxSub: 'Scan the vault, read every diff, approve one at a time. Proposals come from deterministic rules — no model is involved.',
    btnScan: 'Scan vault',
    btnScanning: 'Scanning…',
    btnHistory: 'Undo journal',
    noRulesNote: 'Not a single rule is on — a scan would find nothing. Turn at least one on above.',
    scanProgress: 'Scanned {done}/{total}',
    wfHint: 'Output goes to the work folder: {wf}',
    rulesLabel: 'Rules',
    ruleBrokenLink: 'Broken links',
    ruleBrokenLinkDesc: 'Repairs a [[wikilink]] that resolves to nothing when exactly one candidate matches; several or zero candidates go to the follow-up list instead.',
    ruleTagVariant: 'Tag variants',
    ruleTagVariantDesc: 'Folds case and hierarchy variants of a tag into the most frequent spelling, on whole-tag boundaries only.',
    ruleFmMissing: 'Frontmatter keys',
    ruleFmMissingDesc: 'Adds the required keys from settings with empty values; unparseable frontmatter only goes to the follow-up list.',
    ruleFindReplace: 'Find and replace',
    ruleFindReplaceDesc: 'Literal vault-wide find and replace that you start yourself; no regular expressions in v1.',
    ruleTagOp: 'Tag operations',
    ruleTagOpDesc: 'Rename, merge or restructure tags, started by you. Whole-tag boundaries only; both homes are covered — inline #tags in the body and the tags: list in frontmatter.',
    frTitle: 'Find and replace',
    frFind: 'Find',
    frReplace: 'Replace with',
    frCase: 'Match case',
    frWhole: 'Whole word',
    frCode: 'Include code blocks',
    frRun: 'Scan for matches',
    frNeedFind: 'Type the text you want to find first.',
    tagOpTitle: 'Tag operations',
    tagOpModeRename: 'Rename',
    tagOpModeMerge: 'Merge',
    tagOpModeRestructure: 'Restructure',
    tagOpFrom: 'Source tag',
    tagOpFromMulti: 'Source tags (comma separated, several allowed)',
    tagOpTo: 'Target tag',
    tagOpChildren: 'Move sub-levels too',
    tagOpChildrenHint: 'When ticked, #a/b/c moves along with #a/b; when not, only #a/b itself changes.',
    tagOpRun: 'Preview impact',
    tagOpSummary: '{files} note(s) affected, {hits} match(es) in total',
    tagOpForms: 'Spellings matched',
    tagOpForm: '{tag} × {n}',
    tagOpNoHit: 'Not a single match in the whole vault, so no proposal was made — and not a byte was written.',
    tagOpDedupeNote: 'Inside a frontmatter tags list, a duplicate created by this operation is dropped; duplicates the file already had are left alone.',
    tagOpBodyDupNote: 'Repeated tags in the body are never de-duplicated: they are words inside sentences, and deleting one would leave a broken phrase.',
    errTagEmpty: 'A tag name cannot be empty.',
    errTagSpace: 'A tag name cannot contain whitespace: {tag}',
    errTagHash: 'A tag name cannot contain another # sign: {tag}',
    errTagSlash: 'A tag name cannot start or end with /, and cannot contain //: {tag}',
    errTagPunct: 'A tag name cannot start with punctuation or a symbol: {tag}',
    errTagDigits: 'A tag name cannot be digits only — the scanner never treats those as tags: {tag}',
    errTagTail: 'A tag name cannot end with sentence punctuation; the scanner strips that as part of the sentence: {tag}',
    errTagChar: 'This tag name contains a character the scanner cannot read back: {tag}',
    errTagSame: 'The target tag is identical to the source, so there is nothing to change: {tag}',
    errTagRoundTrip: 'Written out, this tag does not come back unchanged through our own scanner, so it was refused: {tag}',
    errTagNeedFrom: 'Fill in the source tag you want to operate on first.',
    proposalsLabel: 'Proposals',
    todosLabel: 'Follow-up list (reported only, never executed)',
    btnReport: 'Write audit report',
    reportOk: 'Report written to {path}',
    reportOkSnap: 'Report written to {path} (the previous one had your edits — snapshot kept at {snap})',
    reportFail: 'Could not write the report: {msg}',
    emptyNoScan: 'Nothing scanned yet. Press “Scan vault” to start — scanning only reads files, it never writes a byte.',
    emptyNoProposals: 'This scan found nothing that can be fixed automatically.',
    emptyNoTodos: 'Nothing needs your manual attention.',
    seamNoSeam: 'This host version cannot enumerate the vault. Update Forsion Desktop, then scan again.',
    seamEmptyVault: 'There are no notes to scan (or no vault is open right now).',
    seamError: 'Vault enumeration failed: {msg}',
    statsLine: '{pages} notes, {scanned} scanned, {skipped} skipped, {proposals} proposals, {todos} follow-ups',
    hits: '{n} matches',
    lineNo: 'line {n}',
    stOpen: 'Pending',
    stApproved: 'Approved',
    stRejected: 'Rejected',
    stStale: 'Outdated',
    stApplied: 'Applied',
    stFailed: 'Failed',
    stRolledBack: 'Rolled back',
    stWriting: 'Unfinished write',
    stBar: 'Gardener {n}',
    stBarTitle: 'Vault Gardener: proposals waiting for your review',
    diffTitle: 'Diff review',
    diffNone: 'No proposal selected. Pick one in “Gardener: Proposals” and every changed line shows up here.',
    diffLoading: 'Re-reading the file to verify…',
    diffStaleBanner: 'The file changed after the scan, so please scan again. No fake diff is drawn here.',
    diffMissing: 'This file can no longer be read (moved or deleted). Please scan again.',
    diffNoChange: 'Recomputing this rule leaves the file unchanged, so approving it writes nothing.',
    diffFile: 'File',
    diffRule: 'Rule',
    btnApprove: 'Approve and write',
    btnReject: 'Reject',
    btnSkip: 'Skip',
    btnPrev: 'Previous',
    btnNext: 'Next',
    msgApplied: 'Written. Other proposals for the same file are now outdated — scan again.',
    msgNoChange: 'No change, not a single byte was written.',
    msgRejected: 'Rejected.',
    msgStale: 'The file changed after the scan, so the write was refused. Please scan again.',
    msgReadFail: 'That file cannot be read, so the write was refused.',
    msgSnapFail: 'The undo snapshot could not be written or verified, so the target file was left untouched: {msg}',
    msgLedgerFail: 'The undo journal could not be written, so nothing was applied and the file is untouched.',
    msgFailedRolled: 'Verification after writing failed, so the file was rolled back to its previous content: {path}',
    msgFailedHardOp: 'Both the write and the rollback failed verification. All further writes are stopped for this session. Operation {op}, snapshot at {snap}',
    msgHalted: 'Writing is stopped for this session after a failed write. Restart Forsion before trying again.',
    msgActivePage: 'That file is open in the editor right now: {path}. The editor holds a fresher copy and its next autosave would overwrite the whole note — the change would vanish while the journal claimed success. The write was refused and not a single byte was touched. Close that note (or switch to another tab) and come back to approve it.',
    msgApplyError: 'The write failed: {msg}',
    histTitle: 'Undo journal',
    histEmpty: 'Nothing has been written yet.',
    histUnfinished: 'Possibly unfinished writes',
    histOrphan: 'Orphan snapshots (not in the journal)',
    btnRollback: 'Roll back',
    btnViewSnap: 'View snapshot',
    btnHideSnap: 'Hide snapshot',
    snapTitle: 'Pre-image snapshot (read only)',
    msgRollbackOk: 'Rolled back to the previous content.',
    msgRollbackNotLanded: 'The file still holds its pre-write content — that write never landed. The journal entry is now closed as failed and your file was never touched.',
    msgRollbackChanged: 'That file was edited again after it was applied, so a rollback would eat your later edits. Refused.',
    msgRollbackNoSnap: 'The pre-image snapshot is gone (deleted by hand?), so this cannot be rolled back.',
    msgRollbackBadSnap: 'The snapshot does not match the hash recorded in the journal. Rollback refused.',
    msgRollbackNoFile: 'That file cannot be read, so it cannot be rolled back.',
    msgRollbackFail: 'Rollback failed: {msg}',
    todoLinkAmbiguous: 'this link looks like {n} different notes at once — your call',
    todoLinkMissing: 'this link resolves to nothing and has no near match',
    todoFmParseError: 'the frontmatter opens with --- but never closes, so the whole file was skipped',
    todoFileTooLarge: 'the file is {n} KB, over the limit, so it was skipped',
    todoScanLimit: 'over the per-scan file limit, so these {n} files were not scanned',
    todoHitsTooMany: '{n} matches in one file is over the limit, so no proposal was made',
    todoReadFailed: 'this file could not be read, so it was skipped',
    achSeries: 'Vault Gardener',
    achFirst: 'First weed',
    achFirstDesc: 'Approve and write your first proposal',
    achFifty: "Gardener's hands",
    achFiftyDesc: 'Approve and write 50 proposals in total',
    achScanner: 'Groundskeeper',
    achScannerDesc: 'Scan the whole vault 10 times',
    repTitle: 'Vault Gardener follow-up list',
    repMeta: 'Scanned at {at}: {pages} notes, {scanned} scanned, {skipped} skipped',
    repTodos: 'Needs your hands',
    repProposals: 'Proposals waiting for review',
    repNone: '(none)',
    repFoot: 'Generated by Vault Gardener. Move / rename / archive / merge suggestions only ever appear here — the plugin never performs them.',
  },
}
const L = () => {
  try { return ctx.getLocale && ctx.getLocale() === 'en' ? 'en' : 'zh' } catch { return 'zh' }
}
function tl(loc, k, vars) {
  const d = MSG[loc] || MSG.zh
  const s = d[k] != null ? d[k] : (MSG.zh[k] != null ? MSG.zh[k] : k)
  // ⚠️**单趟**正则,未知键原样留着。逐个 split/join 是错的:先替进去的值会被后面的轮次再扫一遍 ——
  //   1.1.0 起标签操作把**用户输入的标签字面**塞进 {from}/{to}/{tag},用户把标签命名成 `{n}`
  //   就会自食其数据。占位符只认 \w+,值一律按字面写入(replace 的函数形态不解释 $&)。
  return vars ? s.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? String(vars[n]) : m)) : s
}
function t(k, vars) { return tl(L(), k, vars) }

const RULE_NAME = { 'broken-link': 'ruleBrokenLink', 'tag-variant': 'ruleTagVariant', 'fm-missing': 'ruleFmMissing', 'find-replace': 'ruleFindReplace', 'tag-op': 'ruleTagOp' }
const RULE_DESC = { 'broken-link': 'ruleBrokenLinkDesc', 'tag-variant': 'ruleTagVariantDesc', 'fm-missing': 'ruleFmMissingDesc', 'find-replace': 'ruleFindReplaceDesc', 'tag-op': 'ruleTagOpDesc' }
const STATE_KEY = { open: 'stOpen', approved: 'stApproved', rejected: 'stRejected', stale: 'stStale', applied: 'stApplied', failed: 'stFailed' }
const TODO_KEY = {
  'link-ambiguous': 'todoLinkAmbiguous', 'link-missing': 'todoLinkMissing', 'fm-parse-error': 'todoFmParseError',
  'file-too-large': 'todoFileTooLarge', 'scan-limit': 'todoScanLimit', 'hits-too-many': 'todoHitsTooMany', 'read-failed': 'todoReadFailed',
}

// ══ 设置(值现读,无变更通知) ═════════════════════════════════════════════════
ctx.registerSetting({ key: 'rules', label: t('setRulesLabel'), type: 'text', default: DEFAULT_RULES, description: t('setRulesDesc') })
ctx.registerSetting({ key: 'fmRequired', label: t('setFmLabel'), type: 'text', default: '', description: t('setFmDesc') })
ctx.registerSetting({ key: 'maxScanFiles', label: t('setMaxScanLabel'), type: 'number', default: 2000, min: 50, max: 20000, description: t('setMaxScanDesc') })
ctx.registerSetting({ key: 'maxFileKB', label: t('setMaxKbLabel'), type: 'number', default: 512, min: 16, max: 4096, description: t('setMaxKbDesc') })

function getSetting(k, d) {
  try {
    const v = localStorage.getItem(`plugin.${PLUGIN_ID}.${k}`)
    return v == null ? d : v
  } catch { return d }
}
function setSetting(k, v) {
  try { localStorage.setItem(`plugin.${PLUGIN_ID}.${k}`, String(v)) } catch { /* ignore */ }
}
function numSetting(k, d, min, max) {
  const n = parseInt(String(getSetting(k, String(d))), 10)
  if (!isFinite(n)) return d
  return Math.max(min, Math.min(max, n))
}
function listSetting(k, d) {
  return String(getSetting(k, d)).split(',').map((s) => s.trim()).filter(Boolean)
}

// ══ 纯函数(经文末 __VAULT_GARDENER_TEST__ 暴露给 check.mjs) ══════════════════

/** FNV-1a 32,逐 UTF-16 code unit。 */
function fnv1a32(s) {
  const str = String(s == null ? '' : s)
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
/** 长度 + 哈希双保险。preHash 不符即拒写,是毁数据第一防线的判据。 */
function hashText(s) {
  const str = String(s == null ? '' : s)
  return `${str.length}.${fnv1a32(str).toString(16).padStart(8, '0')}`
}

/** 行切分/合并:`\r` 作为行尾字符随行走,joinLines(splitLines(t)) === t 对任意串恒成立(绝不归一换行)。 */
const splitLines = (s) => String(s == null ? '' : s).split('\n')
const joinLines = (a) => (a || []).join('\n')
const stripCR = (s) => String(s == null ? '' : s).replace(/\r$/, '')
/** 插入新行时跟随文件里占多数的行尾形态,不制造混合换行。 */
function crSuffix(lines) {
  let cr = 0
  let n = 0
  for (const l of lines || []) {
    if (l === '' ) continue
    n++
    if (/\r$/.test(l)) cr++
  }
  return n > 0 && cr * 2 > n ? '\r' : ''
}

/** Amadeus 块标记行 = 宿主结构数据,四条规则一律跳过(本插件的一号毁档面)。
 *  正则本体与 memoflow / 宿主 BLOCK_MARKER_RE 同款;调用前先剥前导空白,
 *  是因为缩进过的标记行同样是宿主结构数据 —— 多跳过永远比误改安全。 */
const MARKER_LINE = /^<!--\s*a\s+[A-Za-z0-9_-]+\s*-->\s*$/
function isMarkerLine(line) { return MARKER_LINE.test(String(line == null ? '' : line).replace(/^\s+/, '')) }

/** 行内成对反引号区间(含反引号本身)。 */
function inlineSpans(line) {
  const s = String(line == null ? '' : line)
  const ticks = []
  const re = /`+/g
  let m
  while ((m = re.exec(s))) ticks.push({ i: m.index, n: m[0].length })
  const used = []
  const out = []
  for (let a = 0; a < ticks.length; a++) {
    if (used[a]) continue
    for (let b = a + 1; b < ticks.length; b++) {
      if (used[b]) continue
      if (ticks[b].n !== ticks[a].n) continue
      out.push({ s: ticks[a].i, e: ticks[b].i + ticks[b].n })
      for (let k = a; k <= b; k++) used[k] = true
      break
    }
  }
  out.sort((x, y) => x.s - y.s)
  return out
}
function inSpans(spans, idx) {
  for (const s of spans || []) if (idx >= s.s && idx < s.e) return true
  return false
}
/** 行内 HTML 注释区间 + 该行结束时是否仍开着一个未闭合的 `<!--`。
 *  与 isMarkerLine 互不替代:标记行是**整行**跳过,这里是**区间**跳过,两条网都留着。 */
function commentScan(line, startInside) {
  const s = String(line == null ? '' : line)
  const spans = []
  let open = !!startInside
  let i = 0
  if (open) {
    const close = s.indexOf('-->')
    if (close < 0) return { spans: [{ s: 0, e: s.length }], open: true }
    spans.push({ s: 0, e: close + 3 })
    i = close + 3
    open = false
  }
  for (;;) {
    const at = s.indexOf('<!--', i)
    if (at < 0) break
    const close = s.indexOf('-->', at + 4)
    if (close < 0) { spans.push({ s: at, e: s.length }); open = true; break }
    spans.push({ s: at, e: close + 3 })
    i = close + 3
  }
  return { spans, open }
}
/** 行内数学 `$…$` / `$$…$$` 区间。
 *  ⚠️配对判据比反引号严一档:**开 `$` 的后一个字符非空白、闭 `$` 的前一个字符非空白**,
 *  否则「价格 $5 和 $10」会被当成一整段数学 —— 货币是真实语料里最常见的假阳性。 */
function mathSpans(line) {
  const s = String(line == null ? '' : line)
  const out = []
  let i = 0
  while (i < s.length) {
    if (s.charAt(i) !== '$') { i++; continue }
    const dbl = s.charAt(i + 1) === '$'
    const openLen = dbl ? 2 : 1
    const after = s.charAt(i + openLen)
    if (!after || /\s/.test(after)) { i += openLen; continue }
    let j = i + openLen
    let found = -1
    while (j < s.length) {
      if (s.charAt(j) === '$') {
        const before = s.charAt(j - 1)
        const closes = dbl ? s.charAt(j + 1) === '$' : true
        if (closes && before && !/\s/.test(before)) { found = j; break }
      }
      j++
    }
    if (found < 0) { i += openLen; continue }
    out.push({ s: i, e: found + (dbl ? 2 : 1) })
    i = found + (dbl ? 2 : 1)
  }
  return out
}
/** 围栏代码块(``` / ~~~,记同栏字符与最小长度;未闭合视为一直到 EOF)+ 每行的行内 code 区间。
 *  1.1.0 追加 math / mathBlock / comment / commentBlock 四个字段;
 *  ⚠️`lines` / `fenced` / `inline` 三个既有字段的语义与内容**逐字节不变**(check 有回归向量),
 *  新状态机只在非围栏行上跑、绝不参与 fence 的状态转移 —— 所以 broken-link / find-replace 零改动。 */
function codeRanges(text) {
  const lines = splitLines(text)
  const fenced = []
  const inline = []
  const math = []
  const mathBlock = []
  const comment = []
  const commentBlock = []
  let fence = null
  let inMath = false
  let inComment = false
  const blank = (fen) => { fenced.push(fen); math.push([]); mathBlock.push(false); comment.push([]); commentBlock.push(false) }
  for (let i = 0; i < lines.length; i++) {
    const s = stripCR(lines[i])
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(s)
    if (fence) {
      blank(true)
      inline.push([])
      if (m && m[1].charAt(0) === fence.char && m[1].length >= fence.len && !m[2].trim()) fence = null
      continue
    }
    if (m) {
      fence = { char: m[1].charAt(0), len: m[1].length }
      blank(true)
      inline.push([])
      continue
    }
    fenced.push(false)
    inline.push(inlineSpans(s))
    // 注释先算:注释里的 `$$` 不该开一段数学
    const cm = commentScan(s, inComment)
    commentBlock.push(inComment) // 进入本行时就已在注释里 → 整行跳过(多跳过永远比误改安全)
    comment.push(cm.spans)
    inComment = cm.open
    if (commentBlock[i]) { math.push([]); mathBlock.push(inMath); continue }
    if (s.trim() === '$$') { mathBlock.push(true); math.push([]); inMath = !inMath; continue }
    mathBlock.push(inMath)
    math.push(inMath ? [] : mathSpans(s))
  }
  return { lines, fenced, inline, math, mathBlock, comment, commentBlock }
}

/** frontmatter:首行是 `---` 才算;只认顶层单行 `key: value`。三态 present / parseError / 缺席。 */
function parseFrontmatter(text) {
  const lines = splitLines(text)
  if (!lines.length || stripCR(lines[0]).trim() !== '---') return { present: false, parseError: false, start: -1, end: -1, keys: [], lastKeyLine: -1 }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (stripCR(lines[i]).trim() === '---') { end = i; break }
  }
  if (end < 0) return { present: true, parseError: true, start: 0, end: -1, keys: [], lastKeyLine: -1 }
  const keys = []
  let lastKeyLine = -1
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z0-9_][^:\n]*):(.*)$/.exec(stripCR(lines[i]))
    if (!m) continue
    keys.push(m[1].trim())
    lastKeyLine = i
  }
  // ⚠️`lastKeyLine` 只描述「最后一个**匹配键正则**的行」,块值(`tags:` 换行接 `  - x`)的续行
  //   不更新它。**绝不要拿它当补键的插入点** —— 那正是 P0-1 毁数据的来源,插入点一律 `end - 1`。
  return { present: true, parseError: false, start: 0, end, keys, lastKeyLine }
}
/** 正文起始行:frontmatter 区(含解析失败时的整个文件)一律不给 broken-link / tag-variant / find-replace 碰。 */
function bodyStart(text) {
  const fm = parseFrontmatter(text)
  if (!fm.present) return 0
  if (fm.parseError) return splitLines(text).length
  return fm.end + 1
}

const baseNoExt = (p) => {
  const seg = String(p == null ? '' : p).split('/')
  return seg[seg.length - 1].replace(/\.md$/i, '')
}
const normKey = (x) => String(x == null ? '' : x).normalize('NFC').toLowerCase().replace(/[\s_-]+/g, '')

/** `[[t]]` / `[[t|别名]]` / `![[t]]` / `[[t#锚点]]` / `[[t^块]]`:只取目标段,尾巴与前缀逐字节保留。 */
function scanWikilinks(text) {
  const src = String(text == null ? '' : text)
  const cr = codeRanges(src)
  const from = bodyStart(src)
  const out = []
  for (let i = from; i < cr.lines.length; i++) {
    if (cr.fenced[i]) continue
    const line = cr.lines[i]
    if (isMarkerLine(line)) continue
    const spans = cr.inline[i] || []
    const re = /(!?)\[\[([^[\]\n]+)\]\]/g
    let m
    while ((m = re.exec(line))) {
      if (inSpans(spans, m.index)) continue
      const inner = m[2]
      const innerStart = m.index + m[1].length + 2
      const pipe = inner.indexOf('|')
      const head = pipe >= 0 ? inner.slice(0, pipe) : inner
      let cut = head.length
      for (let k = 0; k < head.length; k++) {
        const ch = head.charAt(k)
        if (ch === '#' || ch === '^') { cut = k; break }
      }
      const seg = head.slice(0, cut)
      const core = seg.trim()
      if (!core) continue
      const lead = seg.length - seg.replace(/^\s+/, '').length
      out.push({ line: i, rawStart: m.index, raw: m[0], start: innerStart + lead, end: innerStart + lead + core.length, target: core, bang: m[1] === '!' })
    }
  }
  return out
}
/** 健康 = 精确路径命中,或去 .md 后的 basename 在 pages 里唯一命中。否则按归一候选数三分。 */
function resolveLink(target, pages, files) {
  const tg = String(target == null ? '' : target).trim()
  if (!tg) return { ok: true, kind: 'healthy', candidates: [] }
  const ps = pages || []
  const all = ps.concat(files || [])
  for (const p of all) if (p === tg || p === tg + '.md') return { ok: true, kind: 'healthy', candidates: [] }
  const base = baseNoExt(tg)
  let exact = 0
  for (const p of ps) if (baseNoExt(p) === base) exact++
  if (exact === 1) return { ok: true, kind: 'healthy', candidates: [] }
  const nk = normKey(base)
  const cands = ps.filter((p) => normKey(baseNoExt(p)) === nk)
  if (cands.length === 1) return { ok: false, kind: 'fix', to: linkReplacement(tg, cands[0]), candidates: cands }
  if (cands.length === 0) return { ok: false, kind: 'missing', candidates: [] }
  return { ok: false, kind: 'ambiguous', candidates: cands }
}
/** 保持用户原来的书写形态:原文带路径就给全路径,原文带 .md 就留 .md。 */
function linkReplacement(target, pagePath) {
  const tg = String(target == null ? '' : target)
  const hasSlash = tg.indexOf('/') >= 0
  const hasExt = /\.md$/i.test(tg)
  const seg = String(pagePath || '').split('/')
  let out = hasSlash ? String(pagePath || '') : seg[seg.length - 1]
  if (!hasExt) out = out.replace(/\.md$/i, '')
  return out
}

/** 标签抽取(memoflow 同款形状):`#` 前必须是行首或空白;丢纯数字、丢首字符是标点/符号的;剥尾部标点。 */
const TAG_TAIL = /[.,;:!?)\]}。，、；：！？）】》]+$/
function scanTags(text) {
  const src = String(text == null ? '' : text)
  const cr = codeRanges(src)
  const from = bodyStart(src)
  const out = []
  for (let i = from; i < cr.lines.length; i++) {
    if (cr.fenced[i]) continue
    // 1.1.0:块级数学与跨行 HTML 注释整行跳过(**只加在 scanTags**——用户的「不许命中」清单是关于标签的;
    //        把数学/注释塞进 find-replace 会静默缩小它已经承诺过的覆盖面)
    if (cr.mathBlock[i] || cr.commentBlock[i]) continue
    const line = cr.lines[i]
    if (isMarkerLine(line)) continue
    const spans = cr.inline[i] || []
    const re = /#([^\s#]+)/g
    let m
    while ((m = re.exec(line))) {
      const at = m.index
      if (inSpans(spans, at)) continue
      if (inSpans(cr.math[i], at)) continue
      if (inSpans(cr.comment[i], at)) continue
      const prev = at > 0 ? line.charAt(at - 1) : ''
      if (prev && !/\s/.test(prev)) continue
      const raw = m[1]
      if (/^\d+$/.test(raw)) continue
      if (/^[\p{P}\p{S}]/u.test(raw)) continue
      const tag = raw.replace(TAG_TAIL, '')
      if (!tag || /^\d+$/.test(tag)) continue
      out.push({ line: i, start: at, end: at + 1 + tag.length, raw: '#' + tag, tag })
    }
  }
  return out
}
/** 块序列 / 流式数组的条目只接受**裸词元**:带引号、嵌套映射、锚点一律跳过(保守,README 写明)。 */
const FM_ITEM_BAD = /[,:[\]{}"'`|<>$]/
/** frontmatter 里的 `tags:` 列表。三种形态:
 *    - 逗号串 `tags: a, b`      —— 1.0.0 就有,行为**逐字节不变**(有回归断言)
 *    - 流式数组 `tags: [a, b]`  —— 1.1.0 新增
 *    - 块序列 `tags:`↵`  - a`   —— 1.1.0 新增
 *  块标量(`tags: |` / `tags: >`)、锚点/引用、带引号条目、`tags`/`tag` 以外的键**一律不碰**。
 *  返回的 `start/end` 必须满足 `line.slice(start,end) === raw`(replaceOccurrences 的前置条件)。
 *  `listLine` = 这条列表的 `tags:` 头行,`kind` = 形态 —— 两个都只给去重用,替换原语不看。 */
function scanFmTags(text) {
  const src = String(text == null ? '' : text)
  const fm = parseFrontmatter(src)
  if (!fm.present || fm.parseError) return []
  const lines = splitLines(src)
  const out = []
  const push = (line, listLine, kind, start, token) => {
    out.push({ line, listLine, kind, start, end: start + token.length, raw: token, tag: token.replace(/^#/, '') })
  }
  for (let i = fm.start + 1; i < fm.end; i++) {
    const m = /^(tags?[ \t]*:[ \t]*)(.*)$/i.exec(stripCR(lines[i]))
    if (!m) continue
    const head = m[1].length
    const val = m[2]
    const trimmed = val.trim()
    // ① 块序列:`tags:` 的值为空,往下走 `- 条目`,遇到第一条不匹配的行即止
    if (!trimmed) {
      for (let j = i + 1; j < fm.end; j++) {
        const dm = /^(\s*-[ \t]+)(\S.*)$/.exec(stripCR(lines[j]))
        if (!dm) break
        const token = dm[2].replace(/[ \t]+$/, '')
        if (!token || FM_ITEM_BAD.test(token)) continue
        push(j, i, 'seq', dm[1].length, token)
      }
      continue
    }
    // ② 流式数组:`[` 与 `]` 之间按逗号切,`[` 之外只允许空白
    if (trimmed.charAt(0) === '[') {
      const lb = val.indexOf('[')
      const rb = val.lastIndexOf(']')
      if (rb <= lb || val.slice(rb + 1).trim()) continue
      let pos = lb + 1
      for (const part of val.slice(lb + 1, rb).split(',')) {
        const lead = part.length - part.replace(/^\s+/, '').length
        const token = part.trim()
        if (token && !FM_ITEM_BAD.test(token)) push(i, i, 'flow', head + pos + lead, token)
        pos += part.length + 1
      }
      continue
    }
    // ③ 逗号串(1.0.0 原样:`|` / `>` 块标量开头整条跳过,条目不做字符过滤)
    if (/^[|>]/.test(trimmed)) continue
    let pos = 0
    for (const part of val.split(',')) {
      const lead = part.length - part.replace(/^\s+/, '').length
      const token = part.trim()
      if (token) push(i, i, 'comma', head + pos + lead, token)
      pos += part.length + 1
    }
  }
  return out
}
/** 1.0.0 的旧名,行为 = 新函数(不留两份实现)。 */
function scanFmTagList(text) { return scanFmTags(text) }
const tagKey = (tg) => String(tg == null ? '' : tg).normalize('NFC').toLowerCase().replace(/\/+$/, '')
/** 同键的不同书面形态成一簇;canonical = 频次最高者,并列取字典序最小(确定性)。 */
function canonicalOf(forms) {
  let best = null
  for (const f of forms || []) {
    if (!best) { best = f; continue }
    if (f.count > best.count) { best = f; continue }
    if (f.count === best.count && f.tag < best.tag) best = f
  }
  return best ? best.tag : ''
}
function clusterTags(counts) {
  const byKey = Object.create(null)
  for (const tg of Object.keys(counts || {}).sort()) {
    const k = tagKey(tg)
    if (!byKey[k]) byKey[k] = { key: k, forms: [] }
    byKey[k].forms.push({ tag: tg, count: counts[tg] })
  }
  const out = []
  for (const k of Object.keys(byKey).sort()) {
    const c = byKey[k]
    c.forms.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    c.canonical = canonicalOf(c.forms)
    out.push(c)
  }
  return out
}

/** 行内最小替换:命中区间左右的字符逐字节保留,行序与缩进一律不动。 */
function replaceOccurrences(text, occ, mapper) {
  const lines = splitLines(text)
  const hits = []
  const byLine = Object.create(null)
  for (const o of occ) {
    const to = mapper(o)
    if (to == null) continue
    const cur = lines[o.line]
    if (cur == null) continue
    if (!byLine[o.line]) byLine[o.line] = []
    byLine[o.line].push({ o, to })
  }
  for (const key of Object.keys(byLine)) {
    const i = Number(key)
    const list = byLine[i].slice().sort((a, b) => b.o.start - a.o.start)
    let line = lines[i]
    for (const it of list) {
      if (line.slice(it.o.start, it.o.end) !== it.o.raw) continue
      line = line.slice(0, it.o.start) + it.to + line.slice(it.o.end)
    }
    lines[i] = line
  }
  for (const key of Object.keys(byLine)) {
    for (const it of byLine[key]) hits.push({ line: it.o.line + 1, from: it.o.raw, to: it.to })
  }
  hits.sort((a, b) => a.line - b.line)
  return { text: joinLines(lines), hits }
}

/** R1 坏 wikilink 修复。params = { fixes: [{from: 目标串, to: 目标串}] }(位置无关,落盘时在 fresh 上重扫)。 */
function applyBrokenLink(text, params) {
  const map = Object.create(null)
  for (const f of ((params || {}).fixes || [])) if (f && f.from != null) map[String(f.from)] = String(f.to)
  const src = String(text == null ? '' : text)
  const occ = scanWikilinks(src).filter((w) => Object.prototype.hasOwnProperty.call(map, w.target) && map[w.target] !== w.target)
  const marked = occ.map((w) => ({ line: w.line, start: w.start, end: w.end, raw: w.target, link: w }))
  const r = replaceOccurrences(src, marked, (o) => map[o.raw])
  const hits = []
  for (const w of occ) {
    const to = map[w.target]
    const rel = w.start - w.rawStart
    hits.push({ line: w.line + 1, from: w.raw, to: w.raw.slice(0, rel) + to + w.raw.slice(rel + w.target.length) })
  }
  hits.sort((a, b) => a.line - b.line)
  return { text: r.text, hits }
}

/** R2 标签变体归一。params = { changes: [{from: 书面形态, to: canonical}] }。整标签边界替换。 */
function applyTagCanon(text, params) {
  const map = Object.create(null)
  for (const c of ((params || {}).changes || [])) if (c && c.from != null) map[String(c.from)] = String(c.to)
  const src = String(text == null ? '' : text)
  const occ = scanTags(src).concat(scanFmTagList(src)).filter((o) => Object.prototype.hasOwnProperty.call(map, o.tag) && map[o.tag] !== o.tag)
  return replaceOccurrences(src, occ, (o) => (o.raw.charAt(0) === '#' ? '#' : '') + map[o.tag])
}

// ══ R5 标签操作(改名 / 合并 / 层级重构) ══════════════════════════════════════
// 抽取器(scanTags / scanFmTags)与替换原语(replaceOccurrences / applyTagCanon)**一个字节都不重写**,
// 新代码只有「已抽出的词元 → 目标词元」这一个映射 —— 所以 tag-variant 与 tag-op 永远同一口径。

/** 目标名里绝不允许出现的字符(会把标签写成自己都认不回来的东西)。 */
const TAG_BAD_CHARS = /[,[\]{}|<>"'`$#]/
/** 目标 / 源标签名合法性。`err` 是 MSG 键,直接给 UI;前导 `#` 可写可不写。 */
function validateTagName(raw) {
  let tag = String(raw == null ? '' : raw).trim()
  if (tag.charAt(0) === '#') tag = tag.slice(1).trim()
  if (!tag) return { ok: false, tag: '', err: 'errTagEmpty' }
  if (/\s/u.test(tag)) return { ok: false, tag, err: 'errTagSpace' }
  if (tag.indexOf('#') >= 0) return { ok: false, tag, err: 'errTagHash' }
  if (tag.charAt(0) === '/' || tag.charAt(tag.length - 1) === '/' || tag.indexOf('//') >= 0) return { ok: false, tag, err: 'errTagSlash' }
  if (/^[\p{P}\p{S}]/u.test(tag)) return { ok: false, tag, err: 'errTagPunct' }
  if (/^\d+$/.test(tag)) return { ok: false, tag, err: 'errTagDigits' }
  if (TAG_TAIL.test(tag)) return { ok: false, tag, err: 'errTagTail' }
  if (TAG_BAD_CHARS.test(tag)) return { ok: false, tag, err: 'errTagChar' }
  // ★最后一道闸:**自往返**。写下去的标签必须能被我们自己的抽取器原样抽回来,而且不能污染后面的行
  //   (探针那条 `#vgprobe` 就是为了抓「写下去之后把后续内容吞掉」这一类:上面的字符表哪天漏了一类,
  //    这条兜住)。抽不回来 = 下一次扫描要么漏掉它、要么把它切成两半,一律拒绝。
  const body = scanTags('#' + tag + '\nX #vgprobe\n')
  if (body.length !== 2 || body[0].tag !== tag || body[1].tag !== 'vgprobe') return { ok: false, tag, err: 'errTagRoundTrip' }
  // ⚠️ 四种 frontmatter 形态都要探。1.1.0 只探了「逗号串」那一支,而流式数组 / 块序列两支另有一张
  //    更严的字符表(FM_ITEM_BAD 含 `:`)—— 只探一支的话,`type:book` 这类目标名会写成
  //    `tags: [type:book]`,从此我们自己的 scanFmTags 再也抽不回来(评审 Finding 1,实证:
  //    /tmp/fip0821-review/gardener/probe-roundtrip.mjs)。
  const FM_FORMS = [
    '---\ntags: ' + tag + '\nvgk: 1\n---\n',
    '---\ntags: [' + tag + ']\nvgk: 1\n---\n',
    '---\ntags:\n  - ' + tag + '\nvgk: 1\n---\n',
    '---\ntags: [' + tag + ', vgprobe]\nvgk: 1\n---\n',
  ]
  for (const form of FM_FORMS) {
    const fm = scanFmTags(form)
    if (!fm.some((x) => x.tag === tag)) return { ok: false, tag, err: 'errTagRoundTrip' }
  }
  return { ok: true, tag, err: null }
}
/** 一次操作的完整规格。总函数:任何垃圾输入都只返回 `{ok:false}`,绝不抛
 *  (params 会经 queue.json 往返,用户手改过的文件不能把 applyRule 打成 failed)。 */
function validateTagOpSpec(spec) {
  const s = spec || {}
  const op = s.op === 'merge' || s.op === 'restructure' ? s.op : 'rename'
  const children = op === 'restructure' ? (s.children == null ? true : !!s.children) : false
  // 合并档才按逗号切多源;改名 / 层级重构是单源(源里带逗号 = errTagChar,不静默丢)
  const raw = Array.isArray(s.from) ? s.from : op === 'merge' ? String(s.from == null ? '' : s.from).split(',') : [s.from]
  const from = []
  for (const one of raw) {
    if (!String(one == null ? '' : one).trim()) continue
    const v = validateTagName(one)
    if (!v.ok) return { ok: false, spec: null, err: v.err, errVars: { tag: String(one == null ? '' : one).trim() } }
    if (from.indexOf(v.tag) < 0) from.push(v.tag)
  }
  if (!from.length) return { ok: false, spec: null, err: 'errTagNeedFrom', errVars: null }
  const tv = validateTagName(s.to)
  if (!tv.ok) return { ok: false, spec: null, err: tv.err, errVars: { tag: String(s.to == null ? '' : s.to).trim() } }
  // ⚠️「不能与源同名」比的是**字面**不是 key:`#Foo → #foo` 是合法改名,按 key 比会把它误拒
  for (const f of from) if (f === tv.tag) return { ok: false, spec: null, err: 'errTagSame', errVars: { tag: tv.tag } }
  from.sort((a, b) => (b.length - a.length) || (a < b ? -1 : a > b ? 1 : 0))
  return { ok: true, spec: { op, from, to: tv.tag, children, dedupe: s.dedupe !== false }, err: null, errVars: null }
}
/** ★边界匹配语义核心:一个**已经抽出来的**标签字面 → 替换后的字面,或 null(不命中)。 */
function tagOpTarget(tag, spec) {
  const s = spec || {}
  const lit = String(tag == null ? '' : tag)
  const to = String(s.to == null ? '' : s.to)
  const froms = Array.isArray(s.from) ? s.from : []
  if (!lit || !to) return null
  // ① 精确档:大小写 / 尾部 '/' 归一后相等即命中(整词元比较,`#foo` 结构上不可能命中 `#foobar`)
  const key = tagKey(lit)
  for (const src of froms) {
    const f = String(src == null ? '' : src)
    if (f && key === tagKey(f)) return to
  }
  if (!s.children) return null
  // ② 子层级档:**只按字面下标切**,再比 key。
  //    ⚠️不许拿 tagKey 的长度去切字面:折叠会变长(U+0130 'İ'.toLowerCase() 是两个 code unit)、
  //      NFC 也会变长,按错位偏移切片就会写出乱码。切不齐 = 不命中,**宁可少改一处**
  //      (与 applyFindReplace 的 foldable 退让同一条纪律)。
  for (const src of froms) {
    const f = String(src == null ? '' : src)
    if (!f || lit.length <= f.length) continue
    if (lit.charAt(f.length) !== '/') continue
    if (tagKey(lit.slice(0, f.length)) !== tagKey(f)) continue
    return to + lit.slice(f.length)
  }
  return null
}
/** 一篇文本里所有会被改写的位置(**只读**,给干跑统计与命中形态表用)。 */
function tagOpHits(text, spec) {
  const src = String(text == null ? '' : text)
  const v = validateTagOpSpec(spec)
  if (!v.ok) return []
  const out = []
  const take = (list, where) => {
    for (const o of list) {
      const to = tagOpTarget(o.tag, v.spec)
      if (to == null || to === o.tag) continue
      out.push({ line: o.line + 1, where, from: o.tag, to })
    }
  }
  take(scanTags(src), 'body')
  take(scanFmTags(src), 'fm')
  out.sort((a, b) => a.line - b.line)
  return out
}
/** 合并造成的重复,**只在 frontmatter 的 tags 列表里**去掉。
 *  收得很紧:只删 ①tagKey 等于本次目标、②不是该列表里同键的第一条、③落在本次真改动过的那一行 的条目。
 *  文件原本就有的 `tags: a, a`(本次没碰过那两处)一个字节不动 —— 用户没让我们动它。
 *  正文里的重复**一律不动**:`#a`/`#b` 是句子里的词,合并成「关于 #t 和 #t 的讨论」后删掉一个
 *  会留下「和  的讨论」,比重复更糟,而且违反行内最小替换。 */
function dedupeFmTags(text, targetKeys, touchedLines) {
  const src = String(text == null ? '' : text)
  const keys = (targetKeys || []).map((k) => String(k))
  const touched = touchedLines || {}
  if (!keys.length) return { text: src, removed: [] }
  const groups = Object.create(null)
  for (const o of scanFmTags(src)) {
    if (keys.indexOf(tagKey(o.tag)) < 0) continue
    const g = `${o.listLine}`
    if (!groups[g]) groups[g] = []
    groups[g].push(o)
  }
  const cutInLine = Object.create(null) // line → [{start,end}]
  const dropLines = []
  const removed = []
  for (const g of Object.keys(groups)) {
    const list = groups[g]
    for (let k = 1; k < list.length; k++) {
      const o = list[k]
      if (!touched[o.line]) continue
      removed.push({ line: o.line + 1, tag: o.tag })
      if (o.kind === 'seq') { dropLines.push(o.line); continue }
      if (!cutInLine[o.line]) cutInLine[o.line] = []
      cutInLine[o.line].push(o)
    }
  }
  if (!removed.length) return { text: src, removed: [] }
  const lines = splitLines(src)
  for (const key of Object.keys(cutInLine)) {
    const i = Number(key)
    let line = lines[i]
    // 同行多处从右往左,偏移量才不会互相错位
    for (const o of cutInLine[key].slice().sort((a, b) => b.start - a.start)) {
      if (line.slice(o.start, o.end) !== o.raw) continue
      const comma = line.lastIndexOf(',', o.start - 1)
      if (comma < 0) continue // 没有前一个分隔符 = 它其实是第一条,不动
      line = line.slice(0, comma) + line.slice(o.end)
    }
    lines[i] = line
  }
  for (const i of dropLines.slice().sort((a, b) => b - a)) lines.splice(i, 1)
  return { text: joinLines(lines), removed }
}
/** R5 规则入口。= 同一条替换原语(applyTagCanon)+ frontmatter 列表去重。
 *  规格非法 → 原样返回、零命中(**绝不抛**:抛出去会把提案标成 failed,而它其实只是没得改)。 */
function applyTagOps(text, params) {
  const src = String(text == null ? '' : text)
  const v = validateTagOpSpec(params)
  if (!v.ok) return { text: src, hits: [], forms: [] }
  const spec = v.spec
  const bodyOcc = scanTags(src)
  const fmOcc = scanFmTags(src)
  const map = Object.create(null)
  const counts = Object.create(null)
  const order = []
  for (const o of bodyOcc.concat(fmOcc)) {
    if (map[o.tag] === undefined) map[o.tag] = tagOpTarget(o.tag, spec)
    const to = map[o.tag]
    if (to == null || to === o.tag) continue
    if (counts[o.tag] === undefined) { counts[o.tag] = 0; order.push(o.tag) }
    counts[o.tag]++
  }
  if (!order.length) return { text: src, hits: [], forms: [] }
  const r = applyTagCanon(src, { changes: order.map((k) => ({ from: k, to: map[k] })) })
  let out = r.text
  if (spec.dedupe) {
    const touched = Object.create(null)
    for (const o of fmOcc) { const to = map[o.tag]; if (to != null && to !== o.tag) touched[o.line] = true }
    out = dedupeFmTags(out, [tagKey(spec.to)], touched).text
  }
  const forms = order.slice().sort().map((k) => ({ tag: k, n: counts[k] }))
  return { text: out, hits: r.hits, forms }
}

/** R3 补 frontmatter 缺字段。值一律留空,绝不发明值;解析失败一律不动。 */
function applyFmMissing(text, params) {
  const required = ((params || {}).required || []).map((s) => String(s).trim()).filter(Boolean)
  const src = String(text == null ? '' : text)
  if (!required.length) return { text: src, hits: [] }
  const fm = parseFrontmatter(src)
  if (fm.parseError) return { text: src, hits: [] }
  const missing = required.filter((k) => fm.keys.indexOf(k) < 0)
  if (!missing.length) return { text: src, hits: [] }
  const lines = splitLines(src)
  const cr = crSuffix(lines)
  const add = missing.map((k) => k + ':' + cr)
  if (!fm.present) {
    const head = ['---' + cr].concat(add, ['---' + cr])
    const hits = missing.map((k, i) => ({ line: i + 2, from: '', to: k + ':' }))
    return { text: joinLines(head.concat(lines)), hits }
  }
  // ⚠️插入点是**闭合 `---` 的前一行**,不是「最后一个键行之后」。后者在 Obsidian 最常见的
  //   块值 frontmatter(`tags:` 换行接 `  - 项目`)上会把新键插进列表中间 —— 续行有前导空格、
  //   不匹配键正则、不更新 lastKeyLine,于是新键接管了下面那串列表项,`tags` 的值当场被销毁。
  //   逐字节 diff 那时是真的,语义却是毁数据,而且看上去人畜无害。扁平 frontmatter 下
  //   `fm.end - 1 === fm.lastKeyLine`,输出与旧写法逐字节相同。
  const at = fm.end - 1
  const out = lines.slice(0, at + 1).concat(add, lines.slice(at + 1))
  const hits = missing.map((k, i) => ({ line: at + 2 + i, from: '', to: k + ':' }))
  return { text: joinLines(out), hits }
}

function wordBounded(line, at, len) {
  const W = /[\p{L}\p{N}_]/u
  const before = at > 0 ? line.charAt(at - 1) : ''
  const after = at + len < line.length ? line.charAt(at + len) : ''
  if (before && W.test(before)) return false
  if (after && W.test(after)) return false
  return true
}
/** R4 全库字面查找替换。纯字面串(替换串里的 $& 等一律按字面处理,不走 String.replace 的替换模式)。 */
function applyFindReplace(text, params) {
  const p = params || {}
  const find = String(p.find == null ? '' : p.find)
  const to = String(p.to == null ? '' : p.to)
  const src = String(text == null ? '' : text)
  if (!find) return { text: src, hits: [] }
  const cr = codeRanges(src)
  const from = bodyStart(src)
  const lines = cr.lines.slice()
  const hits = []
  const cs = !!p.caseSensitive
  const lowFind = find.toLowerCase()
  // ⚠️大小写折叠可能**改变长度**(U+0130 「İ」小写成两个 code unit),那样 hay 的下标就与原行
  //   对不上,按错位偏移切片会写出乱码。一旦长度不等就退回区分大小写:宁可少改一处。
  const foldable = lowFind.length === find.length
  for (let i = from; i < lines.length; i++) {
    if (cr.fenced[i] && !p.includeCode) continue
    const line = lines[i]
    if (isMarkerLine(line)) continue
    const spans = cr.inline[i] || []
    const low = cs || !foldable ? null : line.toLowerCase()
    const fold = low != null && low.length === line.length
    const hay = fold ? low : line
    const needle = fold ? lowFind : find
    let out = ''
    let pos = 0
    let n = 0
    for (;;) {
      const at = hay.indexOf(needle, pos)
      if (at < 0) break
      const blocked = (!p.includeCode && inSpans(spans, at)) || (p.wholeWord && !wordBounded(line, at, find.length))
      if (blocked) {
        out += line.slice(pos, at + 1)
        pos = at + 1
        continue
      }
      out += line.slice(pos, at) + to
      pos = at + find.length
      n++
    }
    if (n > 0) {
      lines[i] = out + line.slice(pos)
      hits.push({ line: i + 1, from: find, to, n })
    }
  }
  return { text: joinLines(lines), hits }
}

/** 预览与落盘调的是同一个函数、同一份输入 —— 第一验证假设①的结构性保证。 */
function ruleResult(preText, proposal) {
  const p = proposal || {}
  const params = p.params || {}
  if (p.rule === 'broken-link') return applyBrokenLink(preText, params)
  if (p.rule === 'tag-variant') return applyTagCanon(preText, params)
  if (p.rule === 'fm-missing') return applyFmMissing(preText, params)
  if (p.rule === 'find-replace') return applyFindReplace(preText, params)
  if (p.rule === 'tag-op') return applyTagOps(preText, params)
  return { text: String(preText == null ? '' : preText), hits: [] }
}
function applyRule(preText, proposal) { return ruleResult(preText, proposal).text }

/** 逐行 diff:先剥公共前后缀;中段等长则逐行配对(多处小改不塌成一整块)。 */
function diffLines(aText, bText) {
  const A = splitLines(aText)
  const B = splitLines(bText)
  let s = 0
  while (s < A.length && s < B.length && A[s] === B[s]) s++
  let ea = A.length
  let eb = B.length
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb-- }
  const out = []
  const la = ea - s
  const lb = eb - s
  if (la === lb) {
    for (let k = 0; k < la; k++) {
      if (A[s + k] === B[s + k]) continue
      out.push({ type: 'del', a: s + k + 1, b: null, text: A[s + k] })
      out.push({ type: 'add', a: null, b: s + k + 1, text: B[s + k] })
    }
    return out
  }
  for (let i = s; i < ea; i++) out.push({ type: 'del', a: i + 1, b: null, text: A[i] })
  for (let j = s; j < eb; j++) out.push({ type: 'add', a: null, b: j + 1, text: B[j] })
  return out
}

// ══ 扫描域与提案构建 ═════════════════════════════════════════════════════════

/** 白名单式:只收裸 `.md`(basename 里只能有一个点),跳过点开头段与插件自己的工作文件夹整棵子树。 */
function isScannable(path, wf) {
  const p = String(path == null ? '' : path)
  if (!p) return false
  const segs = p.split('/')
  for (const s of segs) if (s.charAt(0) === '.') return false
  const w = String(wf || '')
  if (w && (p === w || p.indexOf(w + '/') === 0)) return false
  const base = segs[segs.length - 1]
  if (!/\.md$/i.test(base)) return false
  if ((base.match(/\./g) || []).length !== 1) return false
  return true
}

/** 全库一次算完:只有唯一确定解才成提案,否则进待办清单。纯函数,不碰 ctx。 */
function buildProposals(files, opts) {
  const o = opts || {}
  const rules = o.rules || []
  const pages = o.pages || []
  const others = o.files || []
  const required = (o.required || []).map((s) => String(s).trim()).filter(Boolean)
  const now = o.now != null ? Number(o.now) : Date.now()
  const maxHits = o.maxHitsPerFile != null ? o.maxHitsPerFile : MAX_HITS_PER_FILE
  const list = files || []
  const proposals = []
  const todos = []
  // 标签操作的干跑统计(只在这次扫描是 tag-op 时才有;其余情况恒 null,现有两键语义不变)
  const tagOpSpec = rules.indexOf('tag-op') >= 0 && o.tagOp ? validateTagOpSpec(o.tagOp) : null
  const formCount = Object.create(null)
  const formOrder = []
  const summary = tagOpSpec && tagOpSpec.ok
    ? { kind: 'tag-op', op: tagOpSpec.spec.op, from: tagOpSpec.spec.from.slice(), to: tagOpSpec.spec.to, children: tagOpSpec.spec.children, files: 0, hits: 0, forms: [] }
    : null
  let seq = 0
  const mkId = () => `op-${now.toString(36)}-${(seq++).toString(36)}`
  const push = (rule, path, text, params, hits) => {
    proposals.push({
      id: mkId(), producer: 'rule', rule, path, preHash: hashText(text), params, hits,
      state: 'open', createdAt: now,
    })
  }

  let canonMap = null
  if (rules.indexOf('tag-variant') >= 0) {
    const counts = Object.create(null)
    for (const f of list) {
      for (const oc of scanTags(f.text).concat(scanFmTagList(f.text))) counts[oc.tag] = (counts[oc.tag] || 0) + 1
    }
    canonMap = Object.create(null)
    for (const c of clusterTags(counts)) {
      for (const form of c.forms) if (form.tag !== c.canonical) canonMap[form.tag] = c.canonical
    }
  }

  for (const f of list) {
    // ⚠️`---` 开了没闭合 → bodyStart 让 broken-link / tag-variant / find-replace **整篇**跳过。
    //   这条 todo 必须在「任一规则开着」时就推,**不能挂在 fm-missing 的 required 上**:
    //   fmRequired 默认留空 = fm-missing 关闭,那时统计行会说「已扫 N 篇」,而其中一篇一条规则
    //   都没跑过,用户看不到任何痕迹。每篇最多推一条(下面 fm-missing 分支不再重复推)。
    const fmState = parseFrontmatter(f.text)
    if (fmState.parseError && rules.length) todos.push({ kind: 'fm-parse-error', path: f.path, line: 1, text: '---' })
    if (rules.indexOf('broken-link') >= 0) {
      const fixes = []
      const seen = Object.create(null)
      for (const w of scanWikilinks(f.text)) {
        if (seen[w.target]) continue
        seen[w.target] = true
        const r = resolveLink(w.target, pages, others)
        if (r.ok) continue
        if (r.kind === 'fix') { fixes.push({ from: w.target, to: r.to }); continue }
        todos.push({ kind: r.kind === 'ambiguous' ? 'link-ambiguous' : 'link-missing', path: f.path, line: w.line + 1, text: w.raw, n: r.candidates.length })
      }
      if (fixes.length) {
        const res = applyBrokenLink(f.text, { fixes })
        if (res.text !== f.text) push('broken-link', f.path, f.text, { fixes }, res.hits)
      }
    }
    if (rules.indexOf('tag-variant') >= 0 && canonMap) {
      const changes = []
      const seen = Object.create(null)
      for (const oc of scanTags(f.text).concat(scanFmTagList(f.text))) {
        if (seen[oc.tag]) continue
        seen[oc.tag] = true
        if (!Object.prototype.hasOwnProperty.call(canonMap, oc.tag)) continue
        changes.push({ from: oc.tag, to: canonMap[oc.tag] })
      }
      if (changes.length) {
        const res = applyTagCanon(f.text, { changes })
        if (res.text !== f.text) push('tag-variant', f.path, f.text, { changes }, res.hits)
      }
    }
    if (rules.indexOf('fm-missing') >= 0 && required.length && !fmState.parseError) {
      const res = applyFmMissing(f.text, { required })
      if (res.text !== f.text) push('fm-missing', f.path, f.text, { required }, res.hits)
    }
    if (rules.indexOf('find-replace') >= 0 && o.fr && o.fr.find) {
      const res = applyFindReplace(f.text, o.fr)
      let n = 0
      for (const hh of res.hits) n += hh.n || 1
      if (n > maxHits) todos.push({ kind: 'hits-too-many', path: f.path, line: res.hits.length ? res.hits[0].line : 1, text: String(o.fr.find), n })
      else if (res.text !== f.text) push('find-replace', f.path, f.text, o.fr, res.hits)
    }
    if (summary) {
      const res = applyTagOps(f.text, o.tagOp)
      let n = 0
      for (const hh of res.hits) n += hh.n || 1
      if (n > 0) {
        summary.files++
        summary.hits += n
        for (const fo of res.forms) {
          if (formCount[fo.tag] === undefined) { formCount[fo.tag] = 0; formOrder.push(fo.tag) }
          formCount[fo.tag] += fo.n
        }
      }
      // 超限复用**已有**的 todo kind,不新增 kind、不新增 MSG 键
      if (n > maxHits) todos.push({ kind: 'hits-too-many', path: f.path, line: res.hits.length ? res.hits[0].line : 1, text: summary.to, n })
      else if (res.text !== f.text) push('tag-op', f.path, f.text, o.tagOp, res.hits)
    }
  }
  if (summary) summary.forms = formOrder.slice().sort().map((tg) => ({ tag: tg, n: formCount[tg] }))
  return { proposals, todos, summary }
}

// ══ 时间(「现在」一律 Date.now();日键正午锚定推导) ═══════════════════════════
function dayKey(ms) {
  const d = new Date(Number(ms) || 0)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function fmtDate(ms) {
  const d = new Date(Number(ms) || 0)
  try { return d.toLocaleDateString(L() === 'zh' ? 'zh-CN' : 'en-US') } catch { return dayKey(ms) }
}
function fmtTime(ms) {
  const d = new Date(Number(ms) || 0)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

// ══ ctx 兼容垫片(07-18 之后与 08-14 新增的面一律可选) ══════════════════════
const rdFile = (p) => {
  try { return ctx.app && ctx.app.readFile ? ctx.app.readFile(p) : Promise.resolve(null) } catch (e) { return Promise.resolve(null) }
}
const wrFile = (p, s) => {
  try { return ctx.app && ctx.app.writeFile ? ctx.app.writeFile(p, s) : Promise.reject(new Error('writeFile unavailable')) } catch (e) { return Promise.reject(e) }
}
const errMsg = (e) => String(e && e.message ? e.message : e)
/** 活动页 = 编辑器里正开着的那篇(vault 相对路径,与 readFile/writeFile 同一个字符串口径)。
 *  它在编辑器内存里有一份 ≤800ms 陈旧的副本;我们把新文本落盘之后,编辑器下一次自动保存会拿
 *  那份副本把整篇盖回去 —— 我们写成功了、读回一致了、台账记了 applied,而用户看到的是改动
 *  凭空消失(= 状态机对失败记了成功,违反 20260821 BRIEF 增量三第 3 条)。
 *  所以三个写用户文件的入口一律**拒写并说清楚**:不排队、不硬写、不改提案状态(保持 open 可重来)。
 *  `insertMarkdown` 只能追加,救不了「就地替换」这种改法,所以也不走它。
 *  旧宿主没有 getActivePage → 恒 null → 一律不拦(与 1.0.0 行为相同)。 */
/** 「问不出来」的哨兵:宿主 getActivePage 抛了错,与「没打开笔记」是两回事(评审 Finding 6)。 */
const ACTIVE_UNKNOWN = {}
function activePagePath() {
  if (!(ctx.app && ctx.app.getActivePage)) return null // 旧宿主没有这个方法 = SPEC 明确要的降级,不拦
  try {
    const v = ctx.app.getActivePage()
    return typeof v === 'string' && v ? v : null
  } catch { return ACTIVE_UNKNOWN } // 读失败三态别折叠成「没有活动页」——那会让整条闸静默失效
}
function blockedByActivePage(path) {
  const a = activePagePath()
  if (a === ACTIVE_UNKNOWN) return true // 问不出来就当它可能正是这一篇:拒写(同「读失败一律中止写入」)
  return !!a && !!path && a === String(path)
}
function say(m, o) {
  try {
    if (ctx.notify) ctx.notify(m, o)
    else if (ctx.app && ctx.app.notify) ctx.app.notify(m)
  } catch { /* ignore */ }
}
function track(ev) {
  try { if (ctx.achievements && ctx.achievements.track) ctx.achievements.track(ev) } catch { /* ignore */ }
}
function logAct(ev, d) {
  try { if (ctx.activity && ctx.activity.log) ctx.activity.log(ev, d) } catch { /* ignore */ }
}
function openView(id) {
  try { if (ctx.openView) ctx.openView(id) } catch { /* ignore */ }
}
const wfRoot = () => {
  try {
    const v = ctx.app && ctx.app.workFolder ? ctx.app.workFolder() : ''
    return v || DEFAULT_WF
  } catch { return DEFAULT_WF }
}
const dataDir = () => `${wfRoot()}/.gardener`
const queuePath = () => `${dataDir()}/queue.json`
const ledgerPath = () => `${dataDir()}/ledger.json`
const undoDir = () => `${wfRoot()}/.gardener-undo`
const snapPath = (scanId, opId) => `${undoDir()}/${scanId}/${opId}.snap`
const reportPath = (day) => `${wfRoot()}/Reports/audit-${day}.md`

/** 三态判定,一个都不许混:`[]` 绝不等于「缺席」(facade 在底层 ipc 缺席时恒 resolve `[]`)。 */
async function seamState() {
  if (!ctx.app || typeof ctx.app.listPages !== 'function') return { state: 'noSeam', pages: [], msg: '' }
  let pages = null
  try { pages = await ctx.app.listPages() } catch (e) { return { state: 'seamError', pages: [], msg: errMsg(e) } }
  if (!Array.isArray(pages)) return { state: 'seamError', pages: [], msg: 'bad payload' }
  if (!pages.length) return { state: 'emptyVault', pages: [], msg: '' }
  return { state: 'ok', pages, msg: '' }
}

// ══ 运行时状态 ═══════════════════════════════════════════════════════════════
let disposed = false
let scanSeq = 0
/** 状态栏 handle。**必须在这里就声明**:syncStatus() 会被 loadState() 这类异步路径提前调到,
 *  若把它留成文件末尾的 const,一次早到的调用就会撞进 TDZ 抛 ReferenceError。 */
let statusHandle = null
/** id → resolve。**存 resolve 是必需的**:disposer 只 clearTimeout 的话,later() 那个 promise
 *  永不 settle,runScanInner 会永久挂在 await 上、闭包永不回收。收尾时逐个 resolve,让扫描循环
 *  走到下一句的 `if (disposed) return` 自己退出。 */
const timers = new Map()
const mounted = new Set()
const state = {
  loaded: false, queue: null, ledger: { v: 1, entries: [] }, orphans: [],
  seam: null, scanning: false, progress: null, selected: null, halted: false,
  msg: null, diff: null, showFr: false, snapOpen: null, snapText: null,
  fr: { find: '', to: '', caseSensitive: false, wholeWord: false, includeCode: false },
  // ⚠️表单值一律存在 state 里,不靠 DOM:切语言时整棵视图重建,挂在 DOM 上的输入会当场消失
  showTagOp: false,
  tagOp: { op: 'rename', from: '', to: '', children: true },
}

function later(ms) {
  return new Promise((res) => {
    const id = setTimeout(() => { timers.delete(id); res() }, ms || 0)
    timers.set(id, res)
  })
}

// ══ 写通道串行队列(读-改-写全程排队) ══════════════════════════════════════════
let writeChain = Promise.resolve()
function enqueueWrite(job) {
  const p = writeChain.then(job)
  writeChain = p.then(() => {}, () => {})
  return p
}

async function writeJsonInner(path, obj) {
  const text = JSON.stringify(obj, null, 2)
  try { await wrFile(path, text) } catch (e) { return false }
  const back = await rdFile(path)
  return back === text
}
function writeQueueInner() {
  if (!state.queue) return Promise.resolve(true)
  return writeJsonInner(queuePath(), state.queue)
}
function writeLedgerInner() { return writeJsonInner(ledgerPath(), state.ledger) }

function normalizeQueue(q) {
  const src = q || {}
  const proposals = (Array.isArray(src.proposals) ? src.proposals : []).map((p) => ({
    id: String(p.id || ''), producer: p.producer || 'rule', rule: String(p.rule || ''), path: String(p.path || ''),
    preHash: String(p.preHash || ''), params: p.params || {}, hits: Array.isArray(p.hits) ? p.hits : [],
    state: String(p.state || 'open'), createdAt: Number(p.createdAt) || 0,
  }))
  const todos = (Array.isArray(src.todos) ? src.todos : []).map((d) => ({
    kind: String(d.kind || ''), path: String(d.path || ''), line: Number(d.line) || 0, text: String(d.text == null ? '' : d.text), n: Number(d.n) || 0,
  }))
  const st = src.stats || {}
  return {
    v: 1, scanId: String(src.scanId || ''), scannedAt: Number(src.scannedAt) || 0,
    stats: {
      pages: Number(st.pages) || 0, scanned: Number(st.scanned) || 0, skipped: Number(st.skipped) || 0,
      proposals: Number(st.proposals) || proposals.length, todos: Number(st.todos) || todos.length,
    },
    proposals, todos, summary: normalizeSummary(src.summary),
  }
}
/** 干跑统计。白名单化:队列文件是用户可手改的,任何形状不对的东西一律归成 null。 */
function normalizeSummary(s) {
  if (!s || typeof s !== 'object' || s.kind !== 'tag-op') return null
  return {
    kind: 'tag-op',
    op: String(s.op || 'rename'),
    from: (Array.isArray(s.from) ? s.from : []).map((x) => String(x)),
    to: String(s.to == null ? '' : s.to),
    children: !!s.children,
    files: Number(s.files) || 0,
    hits: Number(s.hits) || 0,
    forms: (Array.isArray(s.forms) ? s.forms : []).map((f) => ({ tag: String((f && f.tag) || ''), n: Number(f && f.n) || 0 })),
  }
}
function findOrphanSnaps(files, ledger, dir) {
  const known = Object.create(null)
  for (const e of ((ledger && ledger.entries) || [])) if (e && e.snap) known[e.snap] = true
  const pre = String(dir || '') + '/'
  return (files || []).filter((p) => typeof p === 'string' && p.indexOf(pre) === 0 && /\.snap$/i.test(p) && !known[p])
}

let loadPromise = null
function ensureLoaded() {
  if (!loadPromise) loadPromise = loadState().catch(() => { state.loaded = true })
  return loadPromise
}
async function readJson(path, dflt) {
  const raw = await rdFile(path)
  if (raw == null) return dflt
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o : dflt
  } catch { return dflt }
}
async function loadState() {
  const q = await readJson(queuePath(), null)
  if (q) state.queue = normalizeQueue(q)
  const l = await readJson(ledgerPath(), null)
  if (l && Array.isArray(l.entries)) state.ledger = { v: 1, entries: l.entries }
  await refreshOrphans()
  state.loaded = true
  syncStatus()
}
/** 孤儿快照 = 落在 `.gardener-undo/` 里、却不在台账中的 `.snap`(进程死在「写快照」与「写台账」之间)。
 *  ⚠️**光靠 `listFiles()` 找不到它们**:宿主的遍历跳过一切点开头目录(vaultManager.ts `collectFiles`),
 *  `.gardener-undo` 整棵不进枚举 —— 那条网在真机上恒为空。所以这里改成**主动探测**:拿当前 queue.json
 *  里每条提案的 `snapPath(scanId, opId)` 去 readFile,读得到、又不在台账里的就是孤儿。
 *  **能力边界(README 与 CHANGELOG 已如实写明)**:queue.json 每次重扫整份覆盖,历史 scan 的 opId 已不可知,
 *  所以只查得出「当前这一轮」的孤儿。真正的恢复权威始终是台账里的 `writing` 条目。 */
const ORPHAN_PROBE_MAX = 200
async function refreshOrphans() {
  state.orphans = []
  const found = []
  // ① 宿主枚举(今天扫不到点目录,留着是为了宿主哪天放开就自动生效,一次 IPC)
  if (ctx.app && typeof ctx.app.listFiles === 'function') {
    try {
      const r = await ctx.app.listFiles()
      if (Array.isArray(r)) for (const p of r) if (typeof p === 'string') found.push(p)
    } catch { /* 枚举不可用不影响 ② */ }
  }
  // ② 按当前队列的 opId 主动探测
  const q = state.queue
  if (q && q.scanId && Array.isArray(q.proposals)) {
    const known = Object.create(null)
    for (const e of ((state.ledger && state.ledger.entries) || [])) if (e && e.snap) known[e.snap] = true
    const probe = []
    for (const p of q.proposals) {
      const sp = snapPath(q.scanId, p.id)
      if (known[sp] || probe.indexOf(sp) >= 0) continue
      probe.push(sp)
      if (probe.length >= ORPHAN_PROBE_MAX) break
    }
    await Promise.all(probe.map((sp) => rdFile(sp).then((x) => { if (x != null) found.push(sp) }, () => {})))
  }
  const uniq = found.filter((p, i) => found.indexOf(p) === i).sort()
  state.orphans = findOrphanSnaps(uniq, state.ledger, undoDir())
}

// ══ 扫描 ═════════════════════════════════════════════════════════════════════
/** job:`null` = 常规规则;`{find,…}` = 查找替换;`{tagOp:{…}}` = 标签操作。三者互斥,一次扫描只跑一类。 */
function runScan(job) {
  if (state.scanning) return Promise.resolve()
  return ensureLoaded().then(() => runScanInner(job)).catch((e) => {
    state.scanning = false
    state.progress = null
    state.seam = { state: 'seamError', pages: [], msg: errMsg(e) }
    renderAll()
  })
}
async function runScanInner(job) {
  const fr = job && job.find ? job : null
  const tagOp = job && job.tagOp ? job.tagOp : null
  state.scanning = true
  state.msg = null
  state.progress = { done: 0, total: 0 }
  renderAll()
  const seam = await seamState()
  state.seam = seam
  if (seam.state !== 'ok') {
    state.scanning = false
    state.progress = null
    renderAll()
    return
  }
  const wf = wfRoot()
  const scannable = seam.pages.filter((p) => isScannable(p, wf))
  const maxFiles = numSetting('maxScanFiles', 2000, 50, 20000)
  const maxKB = numSetting('maxFileKB', 512, 16, 4096)
  const todos = []
  let candidates = scannable
  // ⚠️`searchVault` 是**硬截断到 50 条**的(vaultIndex.ts `hits.slice(0, 50)`),而 F1 的原话是
  //   「一个词要在两百篇里改」。所以它**只用来排序、绝不用来过滤**:命中的排前面,其余原序接在后面。
  //   这样索引陈旧或触顶都不会漏掉任何一篇,而 maxScanFiles 真要截断时优先留下最可能命中的那批。
  //   (旧写法 `if (narrowed.length) candidates = narrowed` 会把候选集静默锁死在 50 篇,
  //    用户批准完 50 条还以为整库改干净了 —— 零告警、零待办。)
  if (fr && fr.find && ctx.app && typeof ctx.app.searchVault === 'function') {
    try {
      const hitList = await ctx.app.searchVault(String(fr.find))
      if (Array.isArray(hitList) && hitList.length) {
        const want = Object.create(null)
        for (const hh of hitList) if (hh && hh.path) want[hh.path] = true
        const first = scannable.filter((p) => want[p])
        if (first.length && first.length < scannable.length) {
          const seenP = Object.create(null)
          for (const p of first) seenP[p] = true
          candidates = first.concat(scannable.filter((p) => !seenP[p]))
        }
      }
    } catch { /* 索引不可用就按原序全量复核 */ }
  }
  const targets = candidates.slice(0, maxFiles)
  if (candidates.length > targets.length) todos.push({ kind: 'scan-limit', path: '', line: 0, text: '', n: candidates.length - targets.length })
  state.progress = { done: 0, total: targets.length }
  renderAll()
  const files = []
  for (let i = 0; i < targets.length; i++) {
    if (disposed) { state.scanning = false; return }
    const path = targets[i]
    let text = null
    try { text = await rdFile(path) } catch { text = null }
    if (text == null) todos.push({ kind: 'read-failed', path, line: 0, text: '', n: 0 })
    else if (text.length > maxKB * 1024) todos.push({ kind: 'file-too-large', path, line: 0, text: '', n: Math.round(text.length / 1024) })
    else files.push({ path, text })
    state.progress = { done: i + 1, total: targets.length }
    if ((i + 1) % CHUNK === 0) {
      renderAll()
      await later(0)
    }
  }
  let others = []
  if (ctx.app && typeof ctx.app.listFiles === 'function') {
    try {
      const r = await ctx.app.listFiles()
      if (Array.isArray(r)) others = r
    } catch { others = [] }
  }
  const now = Date.now()
  const scanId = `s-${now}-${scanSeq++}`
  // ⚠️tagOp **刻意不用 searchVault 排序提示**:标签操作要穷举整库,索引 50 条硬截断对它零收益、只多一次 IPC
  const rules = fr ? ['find-replace'] : tagOp ? ['tag-op'] : listSetting('rules', DEFAULT_RULES).filter((r) => SCAN_RULES.indexOf(r) >= 0)
  const built = buildProposals(files, {
    rules, pages: seam.pages, files: others, required: listSetting('fmRequired', ''), now, fr, tagOp, maxHitsPerFile: MAX_HITS_PER_FILE,
  })
  const allTodos = built.todos.concat(todos)
  const nextQueue = {
    v: 1, scanId, scannedAt: now,
    stats: {
      pages: seam.pages.length, scanned: files.length, skipped: seam.pages.length - files.length,
      proposals: built.proposals.length, todos: allTodos.length,
    },
    proposals: built.proposals, todos: allTodos, summary: built.summary || null,
  }
  // ⚠️换队列这一步必须**进写串行队列**:扫描本身不排队(它只读),但如果用户在扫描过程中批准了
  //   一条旧提案,那条 apply 正在链上跑;直接在链外改 state.queue 会让它写盘时写出新队列
  //   (旧提案的 applied 状态丢失),而且 entry.scanId / snapPath 会取到还没落盘的新 scanId。
  //   放进链里 = 在飞的那条 apply 先跑完(用旧 scanId 写完自己的台账与快照),再整份替换。
  await enqueueWrite(() => {
    state.queue = nextQueue
    state.selected = null
    state.diff = null
    return writeQueueInner()
  })
  state.scanning = false
  state.progress = null
  logAct('scan', { pages: seam.pages.length, proposals: built.proposals.length })
  track('scan')
  syncStatus()
  renderAll()
}

// ══ 单条写入协议(毁数据第一防线,顺序不许调) ═══════════════════════════════
function applyProposal(p) { return enqueueWrite(() => applyProposalInner(p)) }
async function applyProposalInner(p) {
  if (!p) return { ok: false, key: 'msgReadFail' }
  if (state.halted) return { ok: false, key: 'msgHalted' }
  // 0. 活动页闸:**零写入**(连提案状态与 queue.json 都不动),提案保持 open,用户关掉笔记还能再点
  if (blockedByActivePage(p.path)) return { ok: false, key: 'msgActivePage', vars: { path: p.path } }
  // 1. 读失败即拒写(null 不等于空文件,不许据此重写整篇)
  const fresh = await rdFile(p.path)
  if (fresh == null) {
    p.state = 'failed'
    await writeQueueInner()
    return { ok: false, key: 'msgReadFail' }
  }
  // 2. preHash 不符 → stale,零写入
  if (hashText(fresh) !== p.preHash) {
    p.state = 'stale'
    await writeQueueInner()
    return { ok: false, key: 'msgStale' }
  }
  // 3. 预览与落盘同一个函数、同一份输入;无变化短路,零写入
  let post = null
  try { post = applyRule(fresh, p) } catch (e) {
    p.state = 'failed'
    await writeQueueInner()
    return { ok: false, key: 'msgApplyError', vars: { msg: errMsg(e) } }
  }
  if (post === fresh) {
    p.state = 'applied'
    await writeQueueInner()
    return { ok: true, key: 'msgNoChange' }
  }
  // 4. 写快照 → 立即读回逐字节比对;不一致则一个字节都不碰目标文件
  const snap = snapPath((state.queue && state.queue.scanId) || 's-0', p.id)
  try {
    await wrFile(snap, fresh)
    const back = await rdFile(snap)
    if (back !== fresh) throw new Error('snapshot readback mismatch')
  } catch (e) {
    p.state = 'failed'
    await writeQueueInner()
    say(t('msgSnapFail', { msg: errMsg(e) }), { level: 'error', sticky: true })
    return { ok: false, key: 'msgSnapFail', vars: { msg: errMsg(e) } }
  }
  // 5. 台账追加 writing → 写后读回校验(ledger 是恢复的权威)
  const entry = {
    op: p.id, at: Date.now(), scanId: (state.queue && state.queue.scanId) || '', path: p.path, rule: p.rule,
    preHash: p.preHash, postHash: hashText(post), snap, status: 'writing', hits: (p.hits || []).length,
  }
  state.ledger.entries.push(entry)
  const ledgerOk = await writeLedgerInner()
  if (!ledgerOk) {
    entry.status = 'ledger-unconfirmed'
    p.state = 'failed'
    await writeQueueInner()
    say(t('msgLedgerFail'), { level: 'error', sticky: true })
    return { ok: false, key: 'msgLedgerFail' }
  }
  // 6. 写目标文件
  try { await wrFile(p.path, post) } catch { /* 落到第 7 步统一按读回结果处置 */ }
  // 7. 读回自校验;不一致立刻回滚
  const back = await rdFile(p.path)
  if (back !== post) {
    let rolled = false
    try {
      await wrFile(p.path, fresh)
      const b2 = await rdFile(p.path)
      rolled = b2 === fresh
    } catch { rolled = false }
    p.state = 'failed'
    if (rolled) {
      entry.status = 'auto-rolled-back'
      await writeLedgerInner()
      await writeQueueInner()
      say(t('msgFailedRolled', { path: p.path }), { level: 'error', sticky: true })
      return { ok: false, key: 'msgFailedRolled', vars: { path: p.path } }
    }
    entry.status = 'failed'
    state.halted = true
    await writeLedgerInner()
    await writeQueueInner()
    say(t('msgFailedHardOp', { op: p.id, snap }), { level: 'error', sticky: true })
    return { ok: false, key: 'msgFailedHardOp', vars: { op: p.id, snap } }
  }
  // 8. 一切正常
  entry.status = 'applied'
  p.state = 'applied'
  if (state.queue) {
    for (const q of state.queue.proposals) {
      if (q !== p && q.path === p.path && q.state === 'open') q.state = 'stale'
    }
  }
  await writeLedgerInner()
  await writeQueueInner()
  logAct('apply', { rule: p.rule, path: p.path })
  track('apply')
  return { ok: true, key: 'msgApplied' }
}

// ══ 回滚(对称带守卫) ════════════════════════════════════════════════════════
function rollbackOp(entry) { return enqueueWrite(() => rollbackOpInner(entry)) }
async function rollbackOpInner(entry) {
  if (!entry) return { ok: false, key: 'msgRollbackNoFile' }
  // 活动页闸:回滚同样是整文件覆写,同一张脸,同样零写入
  if (blockedByActivePage(entry.path)) return { ok: false, key: 'msgActivePage', vars: { path: entry.path } }
  // ⚠️`state.halted` **刻意不挡回滚**:硬失败之后用户最需要的恰恰是把文件还原回去,而回滚写的是
  //   快照原文(风险方向与 apply 相反),四道守卫一个不少 —— postHash 不符拒绝、快照缺失拒绝、
  //   快照哈希不符拒绝、写回后再读校验。SPEC 那句「停止一切后续写入」说的是继续应用提案。
  const cur = await rdFile(entry.path)
  if (cur == null) return { ok: false, key: 'msgRollbackNoFile' }
  const curHash = hashText(cur)
  if (curHash !== entry.postHash) {
    // 未完成写入(status writing / ledger-unconfirmed)的恢复:文件仍是改前内容 = 那次写入
    // 根本没落地,没有什么可回滚的,只把台账那一条结掉。**零写入用户文件**,而且绝不能落进
    // 「文件又被改过」那条文案 —— 那会告诉用户他改过一个其实没人碰过的文件。
    if (curHash === entry.preHash) {
      entry.status = 'failed'
      await writeLedgerInner()
      return { ok: true, key: 'msgRollbackNotLanded' }
    }
    return { ok: false, key: 'msgRollbackChanged' }
  }
  const snap = await rdFile(entry.snap)
  if (snap == null) return { ok: false, key: 'msgRollbackNoSnap' }
  if (hashText(snap) !== entry.preHash) return { ok: false, key: 'msgRollbackBadSnap' }
  try { await wrFile(entry.path, snap) } catch (e) { return { ok: false, key: 'msgRollbackFail', vars: { msg: errMsg(e) } } }
  const back = await rdFile(entry.path)
  if (back !== snap) return { ok: false, key: 'msgRollbackFail', vars: { msg: 'readback mismatch' } }
  entry.status = 'rolled-back'
  await writeLedgerInner()
  logAct('rollback', { path: entry.path })
  return { ok: true, key: 'msgRollbackOk' }
}

// ══ audit 报告(一次性产物,按写出那一刻的语言生成) ════════════════════════════
function buildReport(queue, loc) {
  const q = queue || { stats: {}, proposals: [], todos: [] }
  const st = q.stats || {}
  const out = []
  out.push('# ' + tl(loc, 'repTitle'))
  out.push('')
  out.push(tl(loc, 'repMeta', { at: fmtDate(q.scannedAt) + ' ' + fmtTime(q.scannedAt), pages: st.pages || 0, scanned: st.scanned || 0, skipped: st.skipped || 0 }))
  out.push('')
  out.push('## ' + tl(loc, 'repTodos'))
  out.push('')
  const todos = q.todos || []
  if (!todos.length) out.push(tl(loc, 'repNone'))
  for (const d of todos) {
    const label = tl(loc, TODO_KEY[d.kind] || d.kind, { n: d.n || 0 })
    const where = d.path ? `\`${d.path}\`` + (d.line ? ' · ' + tl(loc, 'lineNo', { n: d.line }) : '') : ''
    out.push(`- [ ] ${where}${where ? ' — ' : ''}${label}${d.text ? ' `' + d.text + '`' : ''}`)
  }
  out.push('')
  out.push('## ' + tl(loc, 'repProposals'))
  out.push('')
  const open = (q.proposals || []).filter((p) => p.state === 'open')
  if (!open.length) out.push(tl(loc, 'repNone'))
  for (const p of open) {
    out.push(`- [ ] \`${p.path}\` — ${tl(loc, RULE_NAME[p.rule] || p.rule)} · ${tl(loc, 'hits', { n: hitCount(p) })}`)
  }
  out.push('')
  out.push('---')
  out.push('')
  out.push(tl(loc, 'repFoot'))
  out.push('')
  return out.join('\n')
}

// ══ 视图 ═════════════════════════════════════════════════════════════════════
const STYLE = `
.vg-root{height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:14px;overflow:auto;color:inherit;background:var(--bg, transparent);font-size:13px;line-height:1.55}
.vg-root *{box-sizing:border-box}
.vg-h{margin:0;font-size:17px;font-weight:650;color:var(--text, currentColor)}
.vg-sub{margin:4px 0 0;color:var(--text-muted, #8a8a8a);font-size:12.5px}
.vg-label{font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted, #8a8a8a)}
.vg-mut{color:var(--text-muted, #8a8a8a);font-size:12px}
.vg-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.vg-btn{padding:6px 12px;font:inherit;font-size:12.5px;color:var(--text-light, var(--text, currentColor));background:var(--bg-card, rgba(128,128,128,.10));border:1px solid var(--border, rgba(128,128,128,.30));border-radius:var(--radius-md, 10px);cursor:pointer;white-space:nowrap}
.vg-btn:hover:not(:disabled){background:var(--accent-light, rgba(128,128,128,.16))}
.vg-btn:disabled{opacity:.55;cursor:default}
.vg-btn.primary{color:var(--on-accent, #fdfdfc);background:var(--accent, #4c2585);border-color:transparent;font-weight:550}
.vg-btn.sm{padding:3px 9px;font-size:11.5px;border-radius:var(--radius-sm, 8px)}
.vg-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.vg-chip{padding:4px 10px;font:inherit;font-size:12px;border-radius:999px;cursor:pointer;color:var(--text-muted, #8a8a8a);background:var(--bg-card, rgba(128,128,128,.10));border:1px solid var(--border, rgba(128,128,128,.30))}
.vg-chip.on{color:var(--accent, currentColor);background:var(--accent-light, rgba(128,128,128,.16));border-color:var(--accent, currentColor)}
.vg-card{border:1px solid var(--border, rgba(128,128,128,.30));border-radius:var(--radius-md, 10px);background:var(--bg-card, rgba(128,128,128,.06));padding:10px 12px}
.vg-sec{display:flex;flex-direction:column;gap:6px}
.vg-form{display:flex;flex-direction:column;gap:8px}
.vg-frow{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.vg-in{flex:1;min-width:150px;padding:6px 10px;font:inherit;font-size:12.5px;color:var(--text, currentColor);background:var(--bg, transparent);border:1px solid var(--border, rgba(128,128,128,.30));border-radius:var(--radius-sm, 8px);outline:none}
.vg-ck{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-light, var(--text, currentColor));cursor:pointer}
.vg-item{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;padding:7px 10px;border:1px solid var(--border, rgba(128,128,128,.30));border-radius:var(--radius-sm, 8px);background:var(--bg-card, rgba(128,128,128,.06));cursor:pointer}
.vg-item.on{border-color:var(--accent, currentColor);background:var(--accent-light, rgba(128,128,128,.16))}
.vg-path{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:var(--text, currentColor);word-break:break-all}
.vg-tag{font-size:11px;padding:1px 7px;border-radius:999px;color:var(--text-muted, #8a8a8a);background:var(--accent-light, rgba(128,128,128,.14))}
.vg-empty{padding:16px 4px;color:var(--text-muted, #8a8a8a);font-size:12.5px}
.vg-note{padding:8px 11px;border-radius:var(--radius-sm, 8px);border:1px solid var(--border, rgba(128,128,128,.30));background:var(--accent-light, rgba(128,128,128,.10));font-size:12.5px;color:var(--text, currentColor)}
.vg-note.bad{border-color:var(--danger, #a3503f);color:var(--danger, #a3503f);background:transparent}
.vg-diff{border:1px solid var(--border, rgba(128,128,128,.30));border-radius:var(--radius-sm, 8px);overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
.vg-dline{display:flex;gap:8px;padding:1px 8px;white-space:pre-wrap;word-break:break-word}
.vg-dline.add{background:color-mix(in srgb, var(--green, #4f6f52) 16%, transparent)}
.vg-dline.del{background:color-mix(in srgb, var(--danger, #a3503f) 16%, transparent)}
.vg-dno{flex:0 0 auto;min-width:34px;text-align:right;color:var(--text-muted, #8a8a8a);user-select:none}
.vg-dsign{flex:0 0 auto;width:10px;user-select:none}
.vg-dline.add .vg-dsign{color:var(--green, #4f6f52)}
.vg-dline.del .vg-dsign{color:var(--danger, #a3503f)}
.vg-dtext{flex:1;min-width:0;color:var(--text, currentColor)}
.vg-snap{max-height:260px;overflow:auto;padding:8px 10px;border:1px solid var(--border, rgba(128,128,128,.30));border-radius:var(--radius-sm, 8px);white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;color:var(--text, currentColor);background:var(--bg-card, rgba(128,128,128,.06))}
.vg-day{margin-top:6px}
`

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = String(text)
  return n
}
const div = (cls, text) => el('div', cls, text)
function btn(label, cls, onClick) {
  const b = el('button', cls || 'vg-btn', label)
  if (onClick) b.addEventListener('click', onClick)
  return b
}
function tip(node, text) {
  try { node.setAttribute('title', String(text)) } catch { /* ignore */ }
  return node
}

/** diff 渲染:原始文本行,一律 createElement + textContent,永不解析 markdown、永不拼 HTML。 */
function renderDiffInto(container, rows) {
  container.textContent = ''
  const box = div('vg-diff')
  for (const r of rows || []) {
    const line = div('vg-dline ' + (r.type === 'add' ? 'add' : r.type === 'del' ? 'del' : 'ctx'))
    line.appendChild(el('span', 'vg-dno', String(r.type === 'add' ? r.b : r.a)))
    line.appendChild(el('span', 'vg-dsign', r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' '))
    line.appendChild(el('span', 'vg-dtext', String(r.text == null ? '' : r.text)))
    box.appendChild(line)
  }
  container.appendChild(box)
  return box
}

/** 显示用「命中 N 处」:find-replace 的 hits 是**按行**聚合的(`h.n` = 该行命中处数),
 *  与 buildProposals 里 maxHits 门控用的口径必须一致 —— 拿 hits.length 当处数会在
 *  「单行多命中」时偏小,inbox / diff / audit 报告三处一起骗人。其余规则每条 hit 就是一处。 */
function hitCount(p) {
  let n = 0
  for (const h of ((p && p.hits) || [])) n += h.n || 1
  return n
}
function pendingCount() {
  if (!state.queue) return 0
  let n = 0
  for (const p of state.queue.proposals) if (p.state === 'open') n++
  return n
}
function selectedProposal() {
  if (!state.queue || !state.selected) return null
  for (const p of state.queue.proposals) if (p.id === state.selected) return p
  return null
}
function openProposals() {
  if (!state.queue) return []
  return state.queue.proposals.filter((p) => p.state !== 'rejected')
}
function setMsg(res) {
  state.msg = res && res.key ? { key: res.key, vars: res.vars || null, bad: !res.ok } : null
}

function renderAll() {
  for (const m of Array.from(mounted)) {
    try { m.render() } catch { /* 单个视图渲染失败不能拖垮别的视图 */ }
  }
}
function syncStatus() {
  if (!statusHandle || !statusHandle.update) return
  try { statusHandle.update({ text: t('stBar', { n: pendingCount() }), title: t('stBarTitle') }) } catch { /* ignore */ }
}

// ── inbox ────────────────────────────────────────────────────────────────────
function renderInbox(root) {
  root.textContent = ''
  const head = div('vg-sec')
  head.appendChild(el('h2', 'vg-h', t('inboxTitle')))
  head.appendChild(el('p', 'vg-sub', t('inboxSub')))
  root.appendChild(head)

  const bar = div('vg-bar')
  const scanBtn = btn(state.scanning ? t('btnScanning') : t('btnScan'), 'vg-btn primary', () => { runScan(null) })
  scanBtn.disabled = !!state.scanning
  tip(scanBtn, t('wfHint', { wf: wfRoot() }))
  bar.appendChild(scanBtn)
  const frBtn = btn(t('frTitle'), 'vg-btn', () => {
    state.showFr = !state.showFr
    renderAll()
  })
  bar.appendChild(frBtn)
  const tagOpBtn = btn(t('tagOpTitle'), 'vg-btn', () => {
    state.showTagOp = !state.showTagOp
    renderAll()
  })
  tip(tagOpBtn, t('ruleTagOpDesc'))
  bar.appendChild(tagOpBtn)
  // 撤销台账的唯一入口(不装随包 Space 时,history 视图否则只能靠宿主工作台的视图列表找到)
  bar.appendChild(btn(t('btnHistory'), 'vg-btn', () => { openView('history') }))
  if (state.scanning && state.progress) bar.appendChild(el('span', 'vg-mut', t('scanProgress', state.progress)))
  root.appendChild(bar)

  const chips = div('vg-chips')
  chips.appendChild(el('span', 'vg-label', t('rulesLabel')))
  const active = listSetting('rules', DEFAULT_RULES)
  for (const r of SCAN_RULES) {
    const on = active.indexOf(r) >= 0
    const c = btn(t(RULE_NAME[r]), 'vg-chip' + (on ? ' on' : ''), () => { toggleRule(r) })
    tip(c, t(RULE_DESC[r]))
    chips.appendChild(c)
  }
  root.appendChild(chips)
  // 规则被全关掉时说清楚,别让扫描回一句「没找到可自动修复的问题」把用户骗过去
  if (!active.length) root.appendChild(div('vg-note', t('noRulesNote')))

  if (state.showFr) root.appendChild(renderFrForm())
  if (state.showTagOp) root.appendChild(renderTagOpForm())

  if (state.msg) {
    const note = div('vg-note' + (state.msg.bad ? ' bad' : ''), t(state.msg.key, state.msg.vars))
    root.appendChild(note)
  }
  if (state.seam && state.seam.state !== 'ok') {
    const key = state.seam.state === 'noSeam' ? 'seamNoSeam' : state.seam.state === 'emptyVault' ? 'seamEmptyVault' : 'seamError'
    root.appendChild(div('vg-note bad', t(key, { msg: state.seam.msg || '' })))
  }
  if (state.queue) root.appendChild(el('div', 'vg-mut', t('statsLine', state.queue.stats)))
  if (state.queue && state.queue.summary) root.appendChild(renderTagOpSummary(state.queue.summary))

  const sec = div('vg-sec')
  sec.appendChild(el('div', 'vg-label', t('proposalsLabel')))
  const list = openProposals()
  if (!state.queue) sec.appendChild(div('vg-empty', t('emptyNoScan')))
  else if (!list.length) sec.appendChild(div('vg-empty', t('emptyNoProposals')))
  else {
    for (const rule of ALL_RULES) {
      const group = list.filter((p) => p.rule === rule)
      if (!group.length) continue
      sec.appendChild(el('div', 'vg-mut', t(RULE_NAME[rule]) + ' · ' + group.length))
      for (const p of group) sec.appendChild(proposalRow(p))
    }
  }
  root.appendChild(sec)

  const tsec = div('vg-sec')
  const thead = div('vg-bar')
  thead.appendChild(el('span', 'vg-label', t('todosLabel')))
  if (state.queue) {
    thead.appendChild(btn(t('btnReport'), 'vg-btn sm', () => { writeReport() }))
  }
  tsec.appendChild(thead)
  const todos = state.queue ? state.queue.todos : []
  if (!todos || !todos.length) tsec.appendChild(div('vg-empty', t('emptyNoTodos')))
  else {
    for (const d of todos.slice(0, 200)) {
      const row = div('vg-item')
      if (d.path) row.appendChild(el('span', 'vg-path', d.path + (d.line ? ':' + d.line : '')))
      row.appendChild(el('span', 'vg-mut', t(TODO_KEY[d.kind] || d.kind, { n: d.n || 0 })))
      if (d.text) row.appendChild(el('span', 'vg-path', d.text))
      tsec.appendChild(row)
    }
  }
  root.appendChild(tsec)
}
function proposalRow(p) {
  const row = div('vg-item' + (p.id === state.selected ? ' on' : ''))
  row.appendChild(el('span', 'vg-path', p.path))
  row.appendChild(el('span', 'vg-mut', t('hits', { n: hitCount(p) })))
  row.appendChild(el('span', 'vg-tag', t(STATE_KEY[p.state] || 'stOpen')))
  row.addEventListener('click', () => {
    state.selected = p.id
    state.diff = null
    state.msg = null
    renderAll()
    openView('diff')
    loadDiff(p)
  })
  return row
}
function renderFrForm() {
  const box = div('vg-card')
  const form = div('vg-form')
  form.appendChild(el('div', 'vg-label', t('frTitle')))
  form.appendChild(el('div', 'vg-mut', t('ruleFindReplaceDesc')))
  const r1 = div('vg-frow')
  const find = el('input', 'vg-in')
  find.value = state.fr.find
  find.placeholder = t('frFind')
  find.addEventListener('input', () => { state.fr.find = String(find.value == null ? '' : find.value) })
  const to = el('input', 'vg-in')
  to.value = state.fr.to
  to.placeholder = t('frReplace')
  to.addEventListener('input', () => { state.fr.to = String(to.value == null ? '' : to.value) })
  r1.appendChild(find)
  r1.appendChild(to)
  form.appendChild(r1)
  const r2 = div('vg-frow')
  r2.appendChild(checkbox('caseSensitive', t('frCase')))
  r2.appendChild(checkbox('wholeWord', t('frWhole')))
  r2.appendChild(checkbox('includeCode', t('frCode')))
  const run = btn(t('frRun'), 'vg-btn', () => {
    if (!state.fr.find) {
      state.msg = { key: 'frNeedFind', vars: null, bad: true }
      renderAll()
      return
    }
    runScan({ find: state.fr.find, to: state.fr.to, caseSensitive: state.fr.caseSensitive, wholeWord: state.fr.wholeWord, includeCode: state.fr.includeCode })
  })
  run.disabled = !!state.scanning
  r2.appendChild(run)
  form.appendChild(r2)
  box.appendChild(form)
  return box
}
/** 标签操作表单。与查找替换同一个套路(state.fr 的孪生兄弟),走同一条
 *  runScan → buildProposals → queue → diff → applyProposal 管线 —— **没有第二条写路径**。 */
function renderTagOpForm() {
  const box = div('vg-card')
  const form = div('vg-form')
  form.appendChild(el('div', 'vg-label', t('tagOpTitle')))
  form.appendChild(el('div', 'vg-mut', t('ruleTagOpDesc')))
  const modes = div('vg-chips')
  for (const [op, key] of [['rename', 'tagOpModeRename'], ['merge', 'tagOpModeMerge'], ['restructure', 'tagOpModeRestructure']]) {
    const on = state.tagOp.op === op
    modes.appendChild(btn(t(key), 'vg-chip' + (on ? ' on' : ''), () => {
      state.tagOp.op = op
      state.msg = null
      renderAll()
    }))
  }
  form.appendChild(modes)
  const r1 = div('vg-frow')
  const from = el('input', 'vg-in')
  from.value = state.tagOp.from
  from.placeholder = state.tagOp.op === 'merge' ? t('tagOpFromMulti') : t('tagOpFrom')
  from.addEventListener('input', () => { state.tagOp.from = String(from.value == null ? '' : from.value) })
  const to = el('input', 'vg-in')
  to.value = state.tagOp.to
  to.placeholder = t('tagOpTo')
  to.addEventListener('input', () => { state.tagOp.to = String(to.value == null ? '' : to.value) })
  r1.appendChild(from)
  r1.appendChild(to)
  form.appendChild(r1)
  const r2 = div('vg-frow')
  if (state.tagOp.op === 'restructure') {
    const wrap = el('label', 'vg-ck')
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = !!state.tagOp.children
    cb.addEventListener('change', () => { state.tagOp.children = !!cb.checked })
    wrap.appendChild(cb)
    wrap.appendChild(document.createTextNode(t('tagOpChildren')))
    tip(wrap, t('tagOpChildrenHint'))
    r2.appendChild(wrap)
  }
  const run = btn(t('tagOpRun'), 'vg-btn', () => {
    const spec = validateTagOpSpec({ op: state.tagOp.op, from: state.tagOp.from, to: state.tagOp.to, children: state.tagOp.children })
    // 校验失败当场说清楚,**不发起扫描**
    if (!spec.ok) {
      state.msg = { key: spec.err, vars: spec.errVars, bad: true }
      renderAll()
      return
    }
    runScan({ tagOp: spec.spec })
  })
  run.disabled = !!state.scanning
  r2.appendChild(run)
  form.appendChild(r2)
  form.appendChild(el('div', 'vg-mut', t('tagOpDedupeNote')))
  form.appendChild(el('div', 'vg-mut', t('tagOpBodyDupNote')))
  box.appendChild(form)
  return box
}
/** 干跑统计 + 命中形态表。按 tagKey 匹配是有意的,所以把 `#Foo × 12 / #foo × 3` 全摊开给用户看,
 *  没有任何一种写法被藏起来 —— 这是那个决定的透明度保证。 */
function renderTagOpSummary(sum) {
  const box = div('vg-card')
  const sec = div('vg-sec')
  sec.appendChild(el('div', 'vg-label', t('tagOpTitle')))
  sec.appendChild(el('div', 'vg-path', '#' + (sum.from || []).join(L() === 'zh' ? '、#' : ', #') + ' → #' + sum.to))
  if (!sum.files) sec.appendChild(el('div', 'vg-mut', t('tagOpNoHit')))
  else {
    sec.appendChild(el('div', 'vg-mut', t('tagOpSummary', { files: sum.files, hits: sum.hits })))
    if ((sum.forms || []).length) {
      sec.appendChild(el('div', 'vg-label', t('tagOpForms')))
      const chips = div('vg-chips')
      for (const f of sum.forms) chips.appendChild(el('span', 'vg-tag', t('tagOpForm', { tag: '#' + f.tag, n: f.n })))
      sec.appendChild(chips)
    }
  }
  box.appendChild(sec)
  return box
}
function checkbox(key, label) {
  const wrap = el('label', 'vg-ck')
  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.checked = !!state.fr[key]
  cb.addEventListener('change', () => { state.fr[key] = !!cb.checked })
  wrap.appendChild(cb)
  wrap.appendChild(document.createTextNode(String(label)))
  return wrap
}
function toggleRule(r) {
  const active = listSetting('rules', DEFAULT_RULES)
  const at = active.indexOf(r)
  if (at >= 0) active.splice(at, 1)
  else active.push(r)
  setSetting('rules', active.join(','))
  renderAll()
}
function writeReport() {
  const day = dayKey(Date.now())
  const path = reportPath(day)
  // 活动页闸:同日重写会整份覆盖报告,而上一份报告写完就被 openFile 打开了 —— 它极可能正是活动页
  if (blockedByActivePage(path)) {
    state.msg = { key: 'msgActivePage', vars: { path }, bad: true }
    renderAll()
    return Promise.resolve()
  }
  const md = buildReport(state.queue, L())
  let snapped = ''
  // 报告是派生物,但**用户会在里面加批注** —— 同名覆写前先留一份逐字节快照
  // (BRIEF 增量三第 2 条:真要覆写,先留快照。评审 Finding 2)。写完照旧读回校验一次。
  return enqueueWrite(async () => {
    const old = await rdFile(path)
    // ⚠️ 读失败 ≠ 文件不存在(P0 模板 1),而 rdFile 把两者都折叠成 null。拿宿主的只读枚举面
    //    当存在性判据:「列表里有、却读不出来」= 读失败,一律中止,别把用户的批注盖掉。
    if (old == null && ctx.app && ctx.app.listPages) {
      let pages = null
      try { pages = await ctx.app.listPages() } catch { pages = null }
      if (pages && pages.indexOf(path) >= 0) throw new Error('report exists but could not be read')
    }
    if (old != null && old !== md) {
      const snap = `${undoDir()}/reports/${day}-${Date.now()}.snap`
      await wrFile(snap, old)
      if ((await rdFile(snap)) !== old) throw new Error('report snapshot verify failed')
      snapped = snap
    }
    await wrFile(path, md)
    const back = await rdFile(path)
    if (back !== md) throw new Error('readback mismatch')
  }).then(() => {
    state.msg = snapped ? { key: 'reportOkSnap', vars: { path, snap: snapped }, bad: false } : { key: 'reportOk', vars: { path }, bad: false }
    renderAll()
    // ⚠️ 报告是裸 `.md`,本插件没注册任何 fileExtensions → 宿主的 openFile 会把它交给系统默认程序
    //    (amadeusNav.ts:215-217)。必须走 loadPage;这一行在写盘 + 读回校验成功之后才跑,
    //    所以「先 write 再 load」这条安全约束天然满足。评审 Finding 3 / FIXLIST P0-A。
    try {
      if (ctx.app && typeof ctx.app.loadPage === 'function') ctx.app.loadPage(path)
      else if (ctx.app && ctx.app.openFile) ctx.app.openFile(path)
    } catch { /* ignore */ }
  }, (e) => {
    state.msg = { key: 'reportFail', vars: { msg: errMsg(e) }, bad: true }
    renderAll()
  })
}

// ── diff ─────────────────────────────────────────────────────────────────────
/** 打开时重读文件并复核 preHash;不符就渲染「已过期」,而不是画一份骗人的 diff。 */
function loadDiff(p) {
  if (!p) return Promise.resolve()
  state.diff = { id: p.id, loading: true, stale: false, missing: false, rows: [], post: null }
  renderAll()
  return rdFile(p.path).then((fresh) => {
    if (!state.diff || state.diff.id !== p.id) return
    if (fresh == null) {
      state.diff = { id: p.id, loading: false, stale: false, missing: true, rows: [], post: null }
      renderAll()
      return
    }
    if (hashText(fresh) !== p.preHash) {
      if (p.state === 'open') p.state = 'stale'
      state.diff = { id: p.id, loading: false, stale: true, missing: false, rows: [], post: null }
      renderAll()
      return
    }
    const post = applyRule(fresh, p)
    state.diff = { id: p.id, loading: false, stale: false, missing: false, rows: diffLines(fresh, post), post }
    renderAll()
  }, () => {
    state.diff = { id: p.id, loading: false, stale: false, missing: true, rows: [], post: null }
    renderAll()
  })
}
function renderDiff(root) {
  root.textContent = ''
  root.appendChild(el('h2', 'vg-h', t('diffTitle')))
  if (state.msg) root.appendChild(div('vg-note' + (state.msg.bad ? ' bad' : ''), t(state.msg.key, state.msg.vars)))
  const p = selectedProposal()
  if (!p) {
    root.appendChild(div('vg-empty', t('diffNone')))
    return
  }
  const meta = div('vg-bar')
  meta.appendChild(el('span', 'vg-label', t('diffFile')))
  meta.appendChild(el('span', 'vg-path', p.path))
  meta.appendChild(el('span', 'vg-label', t('diffRule')))
  meta.appendChild(el('span', 'vg-tag', t(RULE_NAME[p.rule] || p.rule)))
  meta.appendChild(el('span', 'vg-mut', t('hits', { n: hitCount(p) })))
  meta.appendChild(el('span', 'vg-tag', t(STATE_KEY[p.state] || 'stOpen')))
  root.appendChild(meta)

  // 告知性提示(没有活动页变化订阅,可能滞后一次渲染);真正的闸永远是 applyProposalInner 里那条
  const onAir = blockedByActivePage(p.path)
  if (onAir) root.appendChild(div('vg-note bad', t('msgActivePage', { path: p.path })))

  const d = state.diff && state.diff.id === p.id ? state.diff : null
  if (!d || d.loading) root.appendChild(div('vg-empty', t('diffLoading')))
  else if (d.missing) root.appendChild(div('vg-note bad', t('diffMissing')))
  else if (d.stale) root.appendChild(div('vg-note bad', t('diffStaleBanner')))
  else if (!d.rows.length) root.appendChild(div('vg-note', t('diffNoChange')))
  else {
    const host = div('vg-sec')
    renderDiffInto(host, d.rows)
    root.appendChild(host)
  }

  const acts = div('vg-bar')
  const canApply = !!d && !d.loading && !d.stale && !d.missing && p.state === 'open' && !onAir
  const ok = btn(t('btnApprove'), 'vg-btn primary', () => { doApply(p) })
  ok.disabled = !canApply
  acts.appendChild(ok)
  const no = btn(t('btnReject'), 'vg-btn', () => { doReject(p) })
  no.disabled = p.state !== 'open'
  acts.appendChild(no)
  acts.appendChild(btn(t('btnSkip'), 'vg-btn', () => { step(1) }))
  acts.appendChild(btn(t('btnPrev'), 'vg-btn sm', () => { step(-1) }))
  acts.appendChild(btn(t('btnNext'), 'vg-btn sm', () => { step(1) }))
  root.appendChild(acts)
}
function step(delta) {
  const list = openProposals()
  if (!list.length) return
  let at = 0
  for (let i = 0; i < list.length; i++) if (list[i].id === state.selected) at = i
  const next = list[Math.max(0, Math.min(list.length - 1, at + delta))]
  state.selected = next.id
  state.msg = null
  state.diff = null
  renderAll()
  loadDiff(next)
}
function doApply(p) {
  applyProposal(p).then((res) => {
    setMsg(res)
    state.diff = null
    syncStatus()
    if (res && res.ok) {
      // 写成功 = 这一条的生命周期结束:清掉选中,面板只留结果消息,不再画一份已经过期的 diff。
      state.selected = null
      renderAll()
      return
    }
    renderAll()
    loadDiff(p)
  }, (e) => {
    state.msg = { key: 'msgApplyError', vars: { msg: errMsg(e) }, bad: true }
    renderAll()
  })
}
function doReject(p) {
  p.state = 'rejected'
  state.msg = { key: 'msgRejected', vars: null, bad: false }
  syncStatus()
  renderAll()
  enqueueWrite(writeQueueInner).then(() => {}, () => {})
}

// ── history ──────────────────────────────────────────────────────────────────
function renderHistory(root) {
  root.textContent = ''
  root.appendChild(el('h2', 'vg-h', t('histTitle')))
  if (state.msg) root.appendChild(div('vg-note' + (state.msg.bad ? ' bad' : ''), t(state.msg.key, state.msg.vars)))
  const entries = (state.ledger && state.ledger.entries) || []
  const unfinished = entries.filter((e) => e.status === 'writing' || e.status === 'ledger-unconfirmed')
  if (unfinished.length) {
    const sec = div('vg-sec')
    sec.appendChild(el('div', 'vg-label', t('histUnfinished')))
    for (const e of unfinished) sec.appendChild(historyRow(e))
    root.appendChild(sec)
  }
  if (state.orphans.length) {
    const sec = div('vg-sec')
    sec.appendChild(el('div', 'vg-label', t('histOrphan')))
    for (const p of state.orphans) sec.appendChild(div('vg-item', p))
    root.appendChild(sec)
  }
  const rest = entries.filter((e) => unfinished.indexOf(e) < 0)
  if (!rest.length) {
    root.appendChild(div('vg-empty', t('histEmpty')))
    return
  }
  const days = []
  const byDay = Object.create(null)
  for (let i = rest.length - 1; i >= 0; i--) {
    const e = rest[i]
    const k = dayKey(e.at)
    if (!byDay[k]) { byDay[k] = []; days.push(k) }
    byDay[k].push(e)
  }
  for (const k of days) {
    const sec = div('vg-sec vg-day')
    sec.appendChild(el('div', 'vg-label', fmtDate(byDay[k][0].at)))
    for (const e of byDay[k]) sec.appendChild(historyRow(e))
    root.appendChild(sec)
  }
}
function historyRow(e) {
  const wrap = div('vg-sec')
  const row = div('vg-item')
  row.appendChild(el('span', 'vg-path', e.path))
  row.appendChild(el('span', 'vg-tag', t(RULE_NAME[e.rule] || e.rule)))
  row.appendChild(el('span', 'vg-mut', fmtTime(e.at)))
  row.appendChild(el('span', 'vg-tag', t(statusKey(e.status))))
  // 未完成写入的那两档同样给「回滚」:它在那里就是 SPEC 说的「用快照校验/还原」——
  // 写落地了就还原,没落地就把台账那条结掉,两条路都由 rollbackOpInner 按哈希自己判。
  if (e.status === 'applied' || e.status === 'writing' || e.status === 'ledger-unconfirmed') {
    row.appendChild(btn(t('btnRollback'), 'vg-btn sm', () => { doRollback(e) }))
  }
  const open = state.snapOpen === e.op
  row.appendChild(btn(open ? t('btnHideSnap') : t('btnViewSnap'), 'vg-btn sm', () => { toggleSnap(e) }))
  wrap.appendChild(row)
  if (open) {
    wrap.appendChild(el('div', 'vg-label', t('snapTitle')))
    wrap.appendChild(div('vg-snap', state.snapText == null ? t('msgRollbackNoSnap') : state.snapText))
  }
  return wrap
}
function statusKey(s) {
  if (s === 'applied') return 'stApplied'
  if (s === 'rolled-back') return 'stRolledBack'
  if (s === 'auto-rolled-back') return 'stRolledBack'
  if (s === 'failed') return 'stFailed'
  return 'stWriting'
}
function toggleSnap(e) {
  if (state.snapOpen === e.op) {
    state.snapOpen = null
    state.snapText = null
    renderAll()
    return
  }
  state.snapOpen = e.op
  state.snapText = null
  renderAll()
  rdFile(e.snap).then((s) => {
    if (state.snapOpen !== e.op) return
    state.snapText = s
    renderAll()
  }, () => {
    if (state.snapOpen !== e.op) return
    state.snapText = null
    renderAll()
  })
}
function doRollback(e) {
  rollbackOp(e).then((res) => {
    setMsg(res)
    renderAll()
  }, (err) => {
    state.msg = { key: 'msgRollbackFail', vars: { msg: errMsg(err) }, bad: true }
    renderAll()
  })
}

// ══ 挂载 ═════════════════════════════════════════════════════════════════════
function renderView(root, kind) {
  if (kind === 'inbox') renderInbox(root)
  else if (kind === 'diff') renderDiff(root)
  else renderHistory(root)
}
function mountView(host, kind) {
  host.textContent = ''
  const style = document.createElement('style')
  style.textContent = STYLE
  host.appendChild(style)
  const root = div('vg-root')
  host.appendChild(root)
  const inst = { kind, render: () => { renderView(root, kind) } }
  mounted.add(inst)
  inst.render()
  ensureLoaded().then(() => {
    if (mounted.has(inst)) inst.render()
  }, () => {})
  return () => { mounted.delete(inst) }
}

// ══ 贡献点 ═══════════════════════════════════════════════════════════════════
if (ctx.registerView) {
  ctx.registerView({ id: 'inbox', title: t('viewInbox'), mount: (host) => mountView(host, 'inbox') })
  ctx.registerView({ id: 'diff', title: t('viewDiff'), mount: (host) => mountView(host, 'diff') })
  ctx.registerView({ id: 'history', title: t('viewHistory'), mount: (host) => mountView(host, 'history') })
}
ctx.registerCommand({ id: 'vault-gardener-open', title: t('cmdOpen'), run: () => { openView('inbox') }, keywords: 'gardener vault 库园丁 清理' })
ctx.registerCommand({ id: 'vault-gardener-scan', title: t('cmdScan'), run: () => { openView('inbox'); runScan(null) }, keywords: 'gardener scan 扫描 库园丁' })

statusHandle = ctx.registerStatusItem ? ctx.registerStatusItem({
  id: 'pending', side: 'right', text: t('stBar', { n: 0 }), title: t('stBarTitle'), onClick: () => { openView('inbox') },
}) : null

if (ctx.achievements && ctx.achievements.registerSeries) {
  try {
    ctx.achievements.registerSeries({
      id: 'gardening',
      title: t('achSeries'),
      achievements: [
        { id: 'first-fix', title: t('achFirst'), desc: t('achFirstDesc'), event: 'apply', goal: 1, points: 10 },
        { id: 'fifty', title: t('achFifty'), desc: t('achFiftyDesc'), event: 'apply', goal: 50, points: 30 },
        { id: 'scanner', title: t('achScanner'), desc: t('achScannerDesc'), event: 'scan', goal: 10, points: 20 },
      ],
    })
  } catch { /* ignore */ }
}

const offLocale = ctx.subscribeLocale ? ctx.subscribeLocale(() => {
  syncStatus()
  renderAll()
}) : null

ensureLoaded().then(() => { renderAll() }, () => {})

// ══ 测试钩子 ═════════════════════════════════════════════════════════════════
if (globalThis.__VAULT_GARDENER_TEST__) {
  Object.assign(globalThis.__VAULT_GARDENER_TEST__, {
    MSG, t, tl, L,
    hashText, fnv1a32, splitLines, joinLines, diffLines, inlineSpans, isMarkerLine, codeRanges,
    scanWikilinks, resolveLink, linkReplacement, extractTags: (s) => scanTags(s).map((o) => o.tag).filter((v, i, a) => a.indexOf(v) === i),
    scanTags, scanFmTagList, tagKey, clusterTags, canonicalOf, parseFrontmatter, bodyStart,
    applyRule, ruleResult, applyBrokenLink, applyTagCanon, applyFmMissing, applyFindReplace,
    buildProposals, applyProposal, rollbackOp, seamState, fmtDate, fmtTime, dayKey, renderDiffInto, wfRoot,
    isScannable, findOrphanSnaps, refreshOrphans, ensureLoaded, normalizeQueue, buildReport, runScan, state, enqueueWrite,
    queuePath, ledgerPath, snapPath, reportPath, undoDir, pendingCount, loadDiff, mountView, renderView,
    hitCount, later, writeReport, applyProposalInner, rollbackOpInner,
    activePagePath, blockedByActivePage, ACTIVE_UNKNOWN,
    scanFmTags, tagOpTarget, tagOpHits, applyTagOps, dedupeFmTags, validateTagName, validateTagOpSpec,
  })
}

return () => {
  disposed = true
  if (offLocale) {
    try { offLocale() } catch { /* ignore */ }
  }
  for (const [id, res] of Array.from(timers.entries())) {
    clearTimeout(id)
    try { res() } catch { /* ignore */ }
  }
  timers.clear()
  mounted.clear()
  if (statusHandle && statusHandle.dispose) {
    try { statusHandle.dispose() } catch { /* ignore */ }
  }
}
