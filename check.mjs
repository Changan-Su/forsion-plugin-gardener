/**
 * 库园丁自检:宿主同款 new Function('ctx', src) 求值 main.js + DOM 垫片 + 冻结时钟 + 内存 vault。
 * 覆盖(对应 SPEC「check.mjs 额外必测」1–22):
 *   行切分往返恒等 / diffLines 已知向量 / 块标记行 / 代码区与 frontmatter 区跳过 / resolveLink 五档 /
 *   标签簇与并列裁决 / parseFrontmatter 三态 / applyFindReplace 开关 /
 *   第一验证假设①预览==落盘 ②写后自校验能回滚 ③全批拒绝零写入 /
 *   stale 拒写 / 回滚守卫 / 孤儿快照与 writing 恢复 / 三态接缝 / 双语 / 旧宿主 / XSS /
 *   时间(冻钟 + 四时区扫描 + 跨年) / 契约往返 / 贡献点齐全 / 源码级红线。
 * 1.1.0 追加:标签操作 32 组★边界匹配向量(「不许命中」那一半是重点)/ tagOpTarget 与 validateTagName 单元向量 /
 *   三种 frontmatter 形态 / 合并去重(正文不去重)/ codeRanges 追加字段的逐字节回归 /
 *   t() 单趟占位符 / 20260821 BRIEF 增量五第 9 项(v4 载体路由自检)与第 10 项(活动页写保护)。
 * 跑法:node check.mjs
 */
import { readFileSync } from 'node:fs'
import { strict as A } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ── 含日期算术 → 自钉 TZ,四时区扫描(UTC / 上海 / 伦敦 / 纽约) ──
if (!process.env.VG_TZ) {
  for (const tz of ['UTC', 'Asia/Shanghai', 'Europe/London', 'America/New_York']) {
    execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, TZ: tz, VG_TZ: tz } })
  }
  console.log('check ok — 四时区(UTC / Asia/Shanghai / Europe/London / America/New_York)全部通过')
  process.exit(0)
}

const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8')

// ══ 极简 DOM 垫片(bluebird 同款,补 style / value / checked / type 等属性面) ══
function mkText(txt) {
  const n = { tag: '#text', children: [], attrs: {}, style: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }
  let v = String(txt)
  Object.defineProperty(n, 'textContent', { get: () => v, set: (x) => { v = String(x) } })
  return n
}
function mkEl(tag) {
  const n = { tag, children: [], attrs: {}, style: {}, listeners: {}, className: '' }
  let own = ''
  n.appendChild = (c) => {
    if (c && c.tag === '#frag') for (const k of c.children) n.children.push(k)
    else n.children.push(c)
    return c
  }
  n.setAttribute = (k, v) => { n.attrs[k] = v }
  n.addEventListener = (ev, fn) => { (n.listeners[ev] = n.listeners[ev] || []).push(fn) }
  Object.defineProperty(n, 'textContent', {
    get: () => own + n.children.map((c) => c.textContent || '').join(''),
    set: (x) => { n.children.length = 0; own = String(x) },
  })
  return n
}
globalThis.document = { createElement: mkEl, createTextNode: mkText, createDocumentFragment: () => mkEl('#frag'), addEventListener() {} }
const _ls = new Map()
globalThis.localStorage = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
}
const findAll = (node, tag) => {
  const out = []
  const walk = (n) => { for (const c of (n.children || [])) { if (c.tag === tag) out.push(c); walk(c) } }
  walk(node)
  return out
}
const anyAttr = (node, key) => {
  let hit = false
  const walk = (n) => { if (n.attrs && key in n.attrs) hit = true; for (const c of (n.children || [])) walk(c) }
  walk(node)
  return hit
}
const fire = (node, ev) => { for (const fn of ((node.listeners || {})[ev] || [])) fn() }
const findByText = (node, txt) => {
  let hit = null
  const walk = (n) => {
    if (!hit && n.tag === 'button' && String(n.textContent || '').includes(txt)) hit = n
    for (const c of (n.children || [])) walk(c)
  }
  walk(node)
  return hit
}

// ── 冻结时钟:2026-08-14T04:00:00Z(四个受测时区的本地日期同为 2026-08-14) ──
const NOW = Date.parse('2026-08-14T04:00:00.000Z')
const realNow = Date.now
Date.now = () => NOW

// ══ 内存 vault ═══════════════════════════════════════════════════════════════
function mkVault() {
  const V = new Map()
  const writes = []
  const api = {
    map: V, writes, corrupt: null,
    readFile: async (p) => (V.has(p) ? V.get(p) : null),
    writeFile: async (p, text) => {
      writes.push(p)
      const t = api.corrupt ? api.corrupt(p, text) : text
      V.set(p, t)
    },
  }
  return api
}

function mkCtx(opts) {
  const o = opts || {}
  const reg = { views: [], commands: [], settings: [], status: [], series: [], acts: [], notes: [], opened: [], loaded: [] }
  const vault = mkVault()
  const c = {
    reg, vault,
    locale: o.locale || 'zh',
    registerView: (v) => reg.views.push(v),
    registerCommand: (x) => reg.commands.push(x),
    registerSetting: (s) => reg.settings.push(s),
    registerStatusItem: (s) => { reg.status.push(s); return { update(p) { s.text = p.text; s.title = p.title }, dispose() {} } },
    registerTheme() {}, registerSlashItem() {}, registerPropertyType() {},
    registerFileType() {}, registerFileCreator() {}, registerEmbedRenderer() {}, registerPanel() {},
    openView() {},
    notify: (m, x) => reg.notes.push({ m, x }),
    activity: { log: (e, d) => reg.acts.push({ e, d }) },
    achievements: { registerSeries: (s) => reg.series.push(s), track: () => {} },
    getLocale: () => c.locale,
    subscribeLocale: (cb) => { c.localeCb = cb; return () => { c.localeCb = null } },
    app: {
      workFolder: () => o.wf || '库园丁',
      notify() {},
      readFile: (p) => vault.readFile(p),
      writeFile: (p, t) => vault.writeFile(p, t),
      openFile: (p) => reg.opened.push(p),
      loadPage: (p) => reg.loaded.push(p),
      listPages: o.listPages !== undefined ? o.listPages : async () => Object.keys(o.pages || {}),
      listFiles: o.listFiles !== undefined ? o.listFiles : async () => (o.otherFiles || []),
      searchVault: o.searchVault !== undefined ? o.searchVault : async () => [],
      vaultRoot: () => null,
    },
  }
  if (o.noSeam) delete c.app.listPages
  for (const [p, text] of Object.entries(o.pages || {})) vault.map.set(p, text)
  return c
}
function load(ctx) {
  globalThis.__VAULT_GARDENER_TEST__ = {}
  const dispose = new Function('ctx', src)(ctx)
  return { T: globalThis.__VAULT_GARDENER_TEST__, dispose }
}

// ══ ① 主实例 ═════════════════════════════════════════════════════════════════
const ctx = mkCtx({ pages: {} })
const { T, dispose } = load(ctx)

// ── 21. 贡献点齐全 ──
A.deepEqual(ctx.reg.views.map((v) => v.id), ['inbox', 'diff', 'history'], '视图注册顺序必须是 inbox → diff → history')
for (const v of ctx.reg.views) A.equal(typeof v.mount, 'function', `${v.id} 应有 mount`)
A.deepEqual(ctx.reg.commands.map((x) => x.id).sort(), ['vault-gardener-open', 'vault-gardener-scan'], '两条命令 id 必须带插件前缀')
A.deepEqual(ctx.reg.settings.map((s) => s.key).sort(), ['fmRequired', 'maxFileKB', 'maxScanFiles', 'rules'], '四条设置')
A.equal(ctx.reg.settings.find((s) => s.key === 'rules').default, 'broken-link,tag-variant,fm-missing')
A.equal(ctx.reg.settings.find((s) => s.key === 'fmRequired').default, '', 'fmRequired 默认空 = R3 关闭')
A.equal(ctx.reg.settings.find((s) => s.key === 'maxScanFiles').min, 50)
A.equal(ctx.reg.settings.find((s) => s.key === 'maxFileKB').max, 4096)
A.equal(ctx.reg.status.length, 1, '一个状态栏项')
A.equal(ctx.reg.status[0].id, 'pending')
A.equal(ctx.reg.series.length, 1, '一个成就系列')
A.deepEqual(ctx.reg.series[0].achievements.map((a) => a.id), ['first-fix', 'fifty', 'scanner'])
A.equal(typeof dispose, 'function', 'setup 必须返回 disposer')
for (const k of ['hashText', 'fnv1a32', 'splitLines', 'joinLines', 'diffLines', 'inlineSpans', 'isMarkerLine', 'codeRanges',
  'scanWikilinks', 'resolveLink', 'extractTags', 'tagKey', 'clusterTags', 'canonicalOf', 'parseFrontmatter', 'applyRule',
  'applyBrokenLink', 'applyTagCanon', 'applyFmMissing', 'applyFindReplace', 'buildProposals', 'applyProposal', 'rollbackOp',
  'seamState', 'fmtDate', 'renderDiffInto', 'wfRoot']) {
  A.equal(typeof T[k], 'function', `钩子应暴露 ${k}`)
}

// ── 1. 行切分往返恒等(空输入边界 + CRLF) ──
for (const s of ['', 'a', 'a\n', '\n', '\n\n', 'a\r\nb', 'a\r\nb\r\n', '\r\n', 'a\nb\r\nc']) {
  A.equal(T.joinLines(T.splitLines(s)), s, `joinLines(splitLines(${JSON.stringify(s)})) 必须恒等`)
}

// ── 2. diffLines 已知向量 ──
A.deepEqual(T.diffLines('a\nb', 'a\nb'), [], '两串全等 → 零 del/add')
A.deepEqual(T.diffLines('a', 'a\nb\nc').map((r) => r.type), ['add', 'add'], '纯新增')
A.deepEqual(T.diffLines('a\nb\nc', 'a').map((r) => r.type), ['del', 'del'], '纯删除')
const dMid = T.diffLines('a\nb\nc', 'a\nB\nc')
A.deepEqual(dMid.map((r) => r.type), ['del', 'add'], '中间改一行 = 1 del + 1 add')
A.equal(dMid[0].a, 2)
A.equal(dMid[1].b, 2)
const dCRLF = T.diffLines('a\r\nb\r\nc\r\n', 'a\r\nB\r\nc\r\n')
A.equal(dCRLF.length, 2, 'CRLF 文件改一行仍只出两行')
A.equal(dCRLF[0].text, 'b\r', '删行的 \\r 随行走')
A.equal(dCRLF[1].text, 'B\r', '增行的 \\r 随行走')
const longLine = 'x'.repeat(5000)
A.equal(T.diffLines(longLine, longLine + 'y')[1].text.length, 5001, '超长行不截断')

// ── 3. 块标记行 ──
A.equal(T.isMarkerLine('<!-- a 3 -->'), true)
A.equal(T.isMarkerLine('<!--a-->'), false)
A.equal(T.isMarkerLine('  <!-- a b-1 -->  '), true, '缩进过的标记行同样是宿主结构数据')
A.equal(T.isMarkerLine('正文 <!-- a 3 -->'), false)

// ── 4. 代码区跳过 ──
const fenced = 'text\n```\n#tag [[link]]\n```\n#real\n'
A.deepEqual(T.scanTags(fenced).map((o) => o.tag), ['real'], '围栏内的 #tag 不算')
A.equal(T.scanWikilinks(fenced).length, 0, '围栏内的 [[link]] 不算')
A.deepEqual(T.scanTags('~~~\n#a\n~~~\n#b\n').map((o) => o.tag), ['b'], '~~~ 围栏同样跳过')
A.deepEqual(T.scanTags('```\n#a\n#b\n').map((o) => o.tag), [], '未闭合围栏一直到 EOF 都算代码')
A.deepEqual(T.scanTags('`#a` #b\n').map((o) => o.tag), ['b'], '行内 code 里的 #tag 不算')
A.equal(T.scanWikilinks('`[[a]]` [[b]]\n').length, 1, '行内 code 里的 wikilink 不算')
// frontmatter 区不给 R1/R4 碰
const fmDoc = '---\nalias: [[x]]\nnote: needle\n---\n\n[[y]] needle\n'
A.deepEqual(T.scanWikilinks(fmDoc).map((w) => w.target), ['y'], 'frontmatter 里的 wikilink 不进扫描')
A.deepEqual(T.applyFindReplace(fmDoc, { find: 'needle', to: 'X' }).hits.map((h) => h.line), [6], 'frontmatter 里的串不参与查找替换')

// ── 5. resolveLink 五档 + 尾巴逐字节保留 ──
const PAGES = ['笔记/Project X.md', '笔记/B.md', '归档/B.md', 'Top.md']
A.equal(T.resolveLink('笔记/Project X.md', PAGES, []).ok, true, '精确路径命中 = 健康')
A.equal(T.resolveLink('Top', PAGES, []).ok, true, 'basename 唯一命中(不带 .md)= 健康')
A.equal(T.resolveLink('Top.md', PAGES, []).ok, true, 'basename 唯一命中(带 .md)= 健康')
A.equal(T.resolveLink('B', PAGES, []).kind, 'ambiguous', 'basename 多重命中 → 不出提案')
A.equal(T.resolveLink('查无此页', PAGES, []).kind, 'missing', '零候选 → 待办清单')
const fix = T.resolveLink('ProJect  x', PAGES, [])
A.equal(fix.kind, 'fix', '仅大小写/空白差 → 出提案')
A.equal(fix.to, 'Project X', '裸名写法给裸名 basename')
A.equal(T.resolveLink('笔记/project-x', PAGES, []).to, '笔记/Project X', '全路径写法给全路径')
A.equal(T.resolveLink('图.png', PAGES, ['图.png']).ok, true, 'listFiles 里的附件也算健康')
const tailDoc = '![[ProJect x#标题]] [[ProJect x^blk]] [[ProJect x|别名]]\n'
const tailOut = T.applyBrokenLink(tailDoc, { fixes: [{ from: 'ProJect x', to: 'Project X' }] }).text
A.equal(tailOut, '![[Project X#标题]] [[Project X^blk]] [[Project X|别名]]\n', '锚点/块 id/别名/! 前缀逐字节保留')

// ── 6. clusterTags / canonicalOf ──
A.equal(T.canonicalOf([{ tag: 'Project', count: 3 }, { tag: 'project', count: 1 }]), 'Project', '频次最高者胜出')
A.equal(T.canonicalOf([{ tag: 'a/b', count: 2 }, { tag: 'A/B', count: 2 }]), 'A/B', '频次并列取字典序最小')
A.equal(T.tagKey('a/'), 'a')
A.equal(T.tagKey('A/B'), 'a/b')
const cl = T.clusterTags({ Project: 3, project: 1, projectx: 9 })
A.equal(cl.length, 2, '#projectx 自成一簇,不被 #project 波及')
A.equal(cl.find((c) => c.key === 'project').canonical, 'Project')
A.equal(T.clusterTags({ 'a/b': 1, 'A/B': 2 }).length, 1, '#a/b 与 #A/B 同簇')
A.equal(T.clusterTags({ 'a/': 1, a: 2 }).length, 1, '#a/ 与 #a 同簇')
A.equal(T.clusterTags({ 'a/': 1, a: 2 })[0].canonical, 'a', '同簇内仍按频次裁决')
A.deepEqual(T.extractTags('#123 #产品 #a/b'), ['产品', 'a/b'], '纯数字不算标签,中文算')
A.deepEqual(T.extractTags('a#b #c'), ['c'], '# 前必须是行首或空白')
A.deepEqual(T.extractTags('#!bad #ok'), ['ok'], '首字符是标点/符号的不算')
A.deepEqual(T.extractTags('见 #tag。'), ['tag'], '尾部标点被剥掉')
// 整标签边界:canonical #project 绝不能碰 #projectx
const tagDoc = '#project #projectx #Project\n'
const tagOut = T.applyTagCanon(tagDoc, { changes: [{ from: 'project', to: 'Project' }] }).text
A.equal(tagOut, '#Project #projectx #Project\n', '整标签边界替换,#projectx 一个字节不动')
// frontmatter 单行 tags 列表同样归一,键与格式不动
const fmTag = '---\ntitle: T\ntags: project, other\n---\n\n#project\n'
const fmTagOut = T.applyTagCanon(fmTag, { changes: [{ from: 'project', to: 'Project' }] }).text
A.ok(fmTagOut.includes('tags: Project, other'), 'frontmatter tags 行按同一 canonical 归一')
A.ok(fmTagOut.includes('title: T'), '其它键一个字节不动')

// ── 7. parseFrontmatter 三态 ──
const noFm = '正文第一行\n第二行\n'
A.equal(T.parseFrontmatter(noFm).present, false)
const addedFm = T.applyFmMissing(noFm, { required: ['tags', 'created'] }).text
A.equal(addedFm, '---\ntags:\ncreated:\n---\n' + noFm, '无 frontmatter → 新起一个块,原正文逐字节接在后面')
const okFm = '---\ntitle: 我\nauthor: 你\n---\n正文\n'
const okOut = T.applyFmMissing(okFm, { required: ['title', 'created'] }).text
A.equal(okOut, '---\ntitle: 我\nauthor: 你\ncreated:\n---\n正文\n', '缺字段插在闭合 --- 之前,已有值不改')
A.deepEqual(T.parseFrontmatter(okFm).keys, ['title', 'author'], '键序保留')
// ⚠️毁数据回归(P0-1):最后一个顶层键带**块值**(YAML 列表 = Obsidian 里 tags 的默认形态)。
//   旧写法按「最后一个键行之后」插入,会把新键插进列表中间 —— `tags` 的值被新键接管、当场销毁,
//   而 diff 只显示「+ author:」一行,逐字节是真的、语义是灾难。新键必须落在闭合 `---` 的前一行。
const listFm = '---\ntitle: 我的笔记\ntags:\n  - 项目\n  - 重要\n---\n正文\n'
const listOut = T.applyFmMissing(listFm, { required: ['author'] }).text
A.equal(listOut, '---\ntitle: 我的笔记\ntags:\n  - 项目\n  - 重要\nauthor:\n---\n正文\n', 'YAML 列表型 frontmatter:新键插在闭合 --- 前,列表逐字节不动')
A.ok(listOut.includes('tags:\n  - 项目\n  - 重要\n'), '已有键的值永不修改:tags 的列表项必须紧跟着 tags: 原样保留')
A.equal(T.applyFmMissing(listFm, { required: ['author'] }).hits[0].line, 6, '新键行号 = 实际落点(闭合 --- 前一行)')
// 块标量同理
const blockFm = '---\ntitle: T\ndesc: |\n  第一行\n  第二行\n---\n'
A.equal(
  T.applyFmMissing(blockFm, { required: ['created'] }).text,
  '---\ntitle: T\ndesc: |\n  第一行\n  第二行\ncreated:\n---\n',
  'YAML 块标量:续行一个字节不动',
)
// CRLF 下同样落在闭合 --- 前
A.equal(
  T.applyFmMissing('---\r\ntags:\r\n  - a\r\n---\r\n正文\r\n', { required: ['x'] }).text,
  '---\r\ntags:\r\n  - a\r\nx:\r\n---\r\n正文\r\n',
  'CRLF + 列表值:换行风格随行走,插入点仍在闭合 --- 前',
)
const badFm = '---\ntitle: 我\n没有闭合\n'
A.equal(T.parseFrontmatter(badFm).parseError, true, '--- 开了没闭合 = parseError')
A.equal(T.parseFrontmatter(badFm).present, true, 'parseError ≠ 缺席:present 仍为 true')
A.equal(T.applyFmMissing(badFm, { required: ['x'] }).text, badFm, '解析失败一个字节都不动')
const badBuilt = T.buildProposals([{ path: 'bad.md', text: badFm }], { rules: ['fm-missing'], pages: ['bad.md'], required: ['x'], now: NOW })
A.equal(badBuilt.proposals.length, 0, '解析失败提案数必须为 0')
A.equal(badBuilt.todos[0].kind, 'fm-parse-error', '解析失败只进 todos')
const missBuilt = T.buildProposals([{ path: 'n.md', text: noFm }], { rules: ['fm-missing'], pages: ['n.md'], required: ['x'], now: NOW })
A.equal(missBuilt.proposals.length, 1, '缺席 → 出提案(与解析失败行为必须不同)')
A.equal(missBuilt.todos.length, 0)

// ── 8. applyFindReplace ──
A.equal(T.applyFindReplace('Foo foo\n', { find: 'foo', to: 'bar', caseSensitive: true }).text, 'Foo bar\n', '区分大小写')
A.equal(T.applyFindReplace('Foo foo\n', { find: 'foo', to: 'bar' }).text, 'bar bar\n', '不区分大小写')
A.equal(T.applyFindReplace('cat category\n', { find: 'cat', to: 'dog', wholeWord: true }).text, 'dog category\n', '全词开关')
A.equal(T.applyFindReplace('a\n```\nfoo\n```\nfoo\n', { find: 'foo', to: 'X' }).text, 'a\n```\nfoo\n```\nX\n', '含代码块关时围栏内不改')
A.equal(T.applyFindReplace('a\n```\nfoo\n```\nfoo\n', { find: 'foo', to: 'X', includeCode: true }).text, 'a\n```\nX\n```\nX\n', '含代码块开时围栏内也改')
A.deepEqual(T.applyFindReplace('nothing here\n', { find: 'zzz', to: 'y' }).hits, [], '零命中不产提案')
A.equal(T.applyFindReplace('a foo b\n', { find: 'foo', to: '$& $1 $$' }).text, 'a $& $1 $$ b\n', '替换串里的正则特殊字符按字面处理')
A.equal(T.applyFindReplace('<!-- a 3 -->\nbanana\n', { find: 'a', to: 'A' }).text, '<!-- a 3 -->\nbAnAnA\n', '标记行不参与替换,正文照改')
A.equal(T.applyFindReplace('foo\r\nbar\r\n', { find: 'foo', to: 'X' }).text, 'X\r\nbar\r\n', 'CRLF 原样活下来')
// 大小写折叠改变长度的字符(U+0130 İ.toLowerCase() 是两个 code unit)→ 该行退回区分大小写,
// 绝不按错位偏移写回去(宁可少改一处,也不许写出乱码)
const turkish = 'İstanbul ve istanbul\n'
A.equal(T.applyFindReplace(turkish, { find: 'istanbul', to: 'X' }).text, 'İstanbul ve X\n', '折叠会变长的行退回区分大小写,不错位')
A.equal(T.applyFindReplace(turkish, { find: 'İstanbul', to: 'X' }).text, 'X ve istanbul\n', '查找串自己折叠会变长时同样退回区分大小写')

// ── 3(续). 含标记行的文件跑完四条规则后,每一条标记行逐字节不动 ──
const markerDoc = ['---', 'tags: project', '---', '<!-- a 1 -->', '见 [[ProJect x]] 与 #project', '<!-- a 2 -->', 'needle 一行', '<!-- a 3 -->'].join('\n')
for (const [rule, params] of [
  ['broken-link', { fixes: [{ from: 'ProJect x', to: 'Project X' }] }],
  ['tag-variant', { changes: [{ from: 'project', to: 'Project' }] }],
  ['fm-missing', { required: ['created'] }],
  ['find-replace', { find: 'needle', to: 'X' }],
]) {
  const outText = T.applyRule(markerDoc, { rule, params })
  const before = T.splitLines(markerDoc).filter((l) => T.isMarkerLine(l))
  const after = T.splitLines(outText).filter((l) => T.isMarkerLine(l))
  A.deepEqual(after, before, `${rule} 跑完后块标记行必须逐字节不动`)
}

// ── 15. 三态接缝判定(三条文案互不相同、都非空;都不许有未捕获 rejection) ──
const seamMsgs = new Set()
for (const key of ['seamNoSeam', 'seamEmptyVault', 'seamError']) {
  const s = T.t(key, { msg: 'x' })
  A.ok(s && s.length > 4, `${key} 文案不能为空`)
  seamMsgs.add(s)
}
A.equal(seamMsgs.size, 3, '三态文案必须互不相同')
{
  const cEmpty = mkCtx({ pages: {} })
  const e = load(cEmpty)
  A.equal((await e.T.seamState()).state, 'emptyVault', 'listPages 是函数且 resolve [] → emptyVault')
  e.dispose()
  const cNo = mkCtx({ noSeam: true })
  const n = load(cNo)
  A.equal((await n.T.seamState()).state, 'noSeam', 'listPages 缺席 → noSeam')
  n.dispose()
  const cErr = mkCtx({ listPages: async () => { throw new Error('boom') } })
  const r = load(cErr)
  const st = await r.T.seamState()
  A.equal(st.state, 'seamError', 'listPages reject → seamError')
  A.ok(st.msg.includes('boom'))
  r.dispose()
}

// ══ ② 端到端:扫描 → 预览 → 批准 → 台账 → 回滚 ═══════════════════════════════
const VAULT_PAGES = {
  '笔记/A.md': '# A\n\n见 [[ProJect x]] 与 #project 与 #Project\n<!-- a 1 -->\n',
  '笔记/Project X.md': '# Project X\n\n#Project\n',
  '笔记/坏.md': '[[查无此页]] 与 [[B]]\n',
  '笔记/B.md': 'b\n',
  '归档/B.md': 'b2\n',
  '笔记/v1.2-发布说明.md': '[[ProJect x]]\n',
  '库园丁/Reports/audit-2026-08-13.md': '[[ProJect x]]\n',
  '.trash/x.md': '[[ProJect x]]\n',
  '图.excalidraw.md': '[[ProJect x]]\n',
}
const c2 = mkCtx({ pages: VAULT_PAGES })
const e2 = load(c2)
const T2 = e2.T

// 扫描域白名单
A.equal(T2.isScannable('笔记/A.md', '库园丁'), true)
A.equal(T2.isScannable('库园丁/Reports/audit-2026-08-13.md', '库园丁'), false, '工作文件夹整棵子树排除')
A.equal(T2.isScannable('.trash/x.md', '库园丁'), false, '点开头目录排除')
A.equal(T2.isScannable('图.excalidraw.md', '库园丁'), false, '复合后缀排除')
A.equal(T2.isScannable('笔记/v1.2-发布说明.md', '库园丁'), false, 'basename 里第二个点 → 跳过(白名单式的代价)')
A.equal(T2.isScannable('图.png', '库园丁'), false)

await T2.runScan(null)
const q = T2.state.queue
A.ok(q, '扫描后应有 queue')
A.ok(/^s-\d+-\d+$/.test(q.scanId), `scanId 形状 s-<ms>-<seq>,实得 ${q.scanId}`)
A.equal(q.scannedAt, NOW, '冻钟下 scannedAt 可复现')
A.equal(q.stats.scanned, 5, '只有 5 篇裸 .md 进扫描域(其余 4 条被白名单式判定挡在外面)')
A.equal(q.stats.pages, 9)
A.equal(q.stats.skipped, 4)
A.ok(q.proposals.length >= 1, '应至少出一条提案')
for (const p of q.proposals) {
  A.ok(/^op-[0-9a-z]+-[0-9a-z]+$/.test(p.id), `opId 形状 op-<b36>-<b36>,实得 ${p.id}`)
  A.equal(p.producer, 'rule', 'v1 的 producer 恒为 rule(v2 接 Agent 第二生产者时零迁移)')
}
A.ok(q.todos.find((d) => d.kind === 'link-missing'), '[[查无此页]] 应进待办清单')
A.ok(q.todos.find((d) => d.kind === 'link-ambiguous'), '[[B]] 同时像两篇 → 待办清单')
A.ok(c2.reg.acts.find((a) => a.e === 'scan'), 'activity.log(scan) 应被调用')
A.ok(c2.vault.writes.includes('库园丁/.gardener/queue.json'), 'queue.json 应落盘')

const linkProp = q.proposals.find((p) => p.rule === 'broken-link' && p.path === '笔记/A.md')
A.ok(linkProp, '笔记/A.md 应出一条 broken-link 提案')
A.equal(linkProp.preHash, T2.hashText(VAULT_PAGES['笔记/A.md']))
A.ok(/^\d+\.[0-9a-f]{8}$/.test(linkProp.preHash), `hashText 形状 <len>.<hex8>,实得 ${linkProp.preHash}`)

// ── 9. 第一验证假设①:预览 == 落盘(逐字节) ──
const pre = VAULT_PAGES['笔记/A.md']
const post1 = T2.applyRule(pre, linkProp)
const post2 = T2.applyRule(pre, linkProp)
A.equal(post1, post2, 'applyRule 连调两次结果必须全等')
A.notEqual(post1, pre)
const rows = T2.diffLines(pre, post1)
A.ok(rows.length >= 2, 'diff 至少一 del 一 add')
const before2 = c2.vault.writes.length
const res1 = await T2.applyProposal(linkProp)
A.equal(res1.ok, true, `批准应成功,实得 ${JSON.stringify(res1)}`)
A.equal(c2.vault.map.get('笔记/A.md'), post1, '内存 vault 里的文本必须 === diff 视图依据的 post')
A.equal(linkProp.state, 'applied')
const wroteSnap = c2.vault.writes.slice(before2).find((p) => p.endsWith('.snap'))
A.ok(wroteSnap, '应写过 .snap 快照')
A.ok(wroteSnap.startsWith('库园丁/.gardener-undo/'), '快照落在点开头 sidecar 目录')
A.equal(c2.vault.map.get(wroteSnap), pre, '快照 = 改前逐字节原文')
A.ok(!wroteSnap.endsWith('.md'), '快照后缀绝不能是 .md')
const led = T2.state.ledger.entries
A.equal(led.length, 1)
A.equal(led[0].status, 'applied')
A.equal(led[0].postHash, T2.hashText(post1))
A.ok(c2.reg.acts.find((a) => a.e === 'apply'), 'activity.log(apply) 应被调用')

// ── 同文件其余提案立刻标 stale ──
// ⚠️别把这条包进 `if (tagProp)` —— 夹具哪天不再产出 tag 提案,这条毁数据相关的检查就静默消失了
const tagProp = q.proposals.find((p) => p.rule === 'tag-variant' && p.path === '笔记/A.md')
A.ok(tagProp, '夹具必须在同一文件上同时产出 tag-variant 提案,否则下面那条 stale 断言等于没跑')
A.equal(tagProp.state, 'stale', '同文件同一次扫描的其余提案应立刻标 stale')

// ── 应用两次同一提案:短路,零写入 ──
const wBefore = c2.vault.writes.filter((p) => p === '笔记/A.md').length
linkProp.state = 'open'
linkProp.preHash = T2.hashText(post1)
const res2 = await T2.applyProposal(linkProp)
A.equal(res2.key, 'msgNoChange', '再应用一次应短路成无变化')
A.equal(c2.vault.writes.filter((p) => p === '笔记/A.md').length, wBefore, '幂等:零写入')

// ── 13. 回滚守卫 ──
const entry = led[0]
c2.vault.map.set('笔记/A.md', post1 + '用户后来又加的一行\n')
const rb1 = await T2.rollbackOp(entry)
A.equal(rb1.ok, false)
A.equal(rb1.key, 'msgRollbackChanged', '当前内容与 postHash 不符 → 拒绝回滚')
A.equal(c2.vault.writes.filter((p) => p === '笔记/A.md').length, wBefore, '拒绝回滚 = 零写入')
c2.vault.map.set('笔记/A.md', post1)
const snapKeep = c2.vault.map.get(entry.snap)
c2.vault.map.delete(entry.snap)
const rb2 = await T2.rollbackOp(entry)
A.equal(rb2.key, 'msgRollbackNoSnap', '快照缺失 → 拒绝并给出原因')
c2.vault.map.set(entry.snap, snapKeep)
const rb3 = await T2.rollbackOp(entry)
A.equal(rb3.ok, true, `回滚应成功,实得 ${JSON.stringify(rb3)}`)
A.equal(c2.vault.map.get('笔记/A.md'), pre, '回滚后逐字节回到改前原文')
A.equal(entry.status, 'rolled-back')
A.ok(c2.reg.acts.find((a) => a.e === 'rollback'), 'activity.log(rollback) 应被调用')

// ── 14b. 未完成写入(writing)的恢复:两条路都由哈希自己判 ──
{
  const orig = '还没被碰过的原文\n'
  const post = '写落地了的新内容\n'
  c2.vault.map.set('未完成.md', orig)
  const w1 = { op: 'op-w1', at: NOW, scanId: 's-x', path: '未完成.md', rule: 'broken-link', preHash: T2.hashText(orig), postHash: T2.hashText(post), snap: '库园丁/.gardener-undo/s-x/op-w1.snap', status: 'writing', hits: 1 }
  T2.state.ledger.entries.push(w1)
  c2.vault.writes.length = 0
  const rw1 = await T2.rollbackOp(w1)
  A.equal(rw1.key, 'msgRollbackNotLanded', '文件仍是改前内容 → 那次写入没落地,不许报成「文件又被改过」')
  A.equal(rw1.ok, true)
  A.equal(w1.status, 'failed', '台账那条 writing 应被结掉')
  A.deepEqual(c2.vault.writes.filter((w) => /\.md$/i.test(w)), [], '没落地的写入,恢复时零写入用户文件')
  // 写落地了但台账没确认 → 走正常回滚
  const w2 = { op: 'op-w2', at: NOW, scanId: 's-x', path: '未完成.md', rule: 'broken-link', preHash: T2.hashText(orig), postHash: T2.hashText(post), snap: '库园丁/.gardener-undo/s-x/op-w2.snap', status: 'writing', hits: 1 }
  c2.vault.map.set('未完成.md', post)
  c2.vault.map.set(w2.snap, orig)
  T2.state.ledger.entries.push(w2)
  const rw2 = await T2.rollbackOp(w2)
  A.equal(rw2.ok, true, `写已落地的 writing 条目应能还原,实得 ${JSON.stringify(rw2)}`)
  A.equal(c2.vault.map.get('未完成.md'), orig, '还原后逐字节回到改前原文')
  A.equal(w2.status, 'rolled-back')
}

// ── 14. 孤儿快照 / writing 恢复 ──
const ledgerFixture = { entries: [{ op: 'op-1', snap: '库园丁/.gardener-undo/s-1/op-1.snap', status: 'writing' }] }
A.deepEqual(
  T2.findOrphanSnaps(['库园丁/.gardener-undo/s-1/op-1.snap', '库园丁/.gardener-undo/s-1/op-9.snap', '别处/x.snap', '笔记/A.md'], ledgerFixture, '库园丁/.gardener-undo'),
  ['库园丁/.gardener-undo/s-1/op-9.snap'],
  '不在台账里的 .snap 才是孤儿',
)
A.equal(ledgerFixture.entries.filter((e) => e.status === 'writing').length, 1, 'writing 条目应可被单列')

// ⚠️P1-3 回归:光有纯函数不够 —— 真机上 `listFiles()` 跳过一切点开头目录(vaultManager.ts
//   `collectFiles`),`.gardener-undo/` 整棵不进枚举,那道网恒为空 = 结构性死代码。
//   所以 refreshOrphans 必须**主动按 queue 里的 opId 探测 snapPath**。下面这条夹具里
//   `listFiles` 返回空数组(= 真机行为),孤儿仍必须被找出来。
{
  const scanId = 's-9-0'
  const orphanOp = 'op-orphan'
  const knownOp = 'op-known'
  const snapOf = (op) => `库园丁/.gardener-undo/${scanId}/${op}.snap`
  const mkProp = (id) => ({ id, producer: 'rule', rule: 'broken-link', path: 'a.md', preHash: 'h', params: {}, hits: [], state: 'open', createdAt: NOW })
  const c7 = mkCtx({ pages: { 'a.md': 'x\n' }, listFiles: async () => [] })
  c7.vault.map.set('库园丁/.gardener/queue.json', JSON.stringify({ v: 1, scanId, scannedAt: NOW, stats: {}, proposals: [mkProp(orphanOp), mkProp(knownOp)], todos: [] }))
  c7.vault.map.set('库园丁/.gardener/ledger.json', JSON.stringify({ v: 1, entries: [{ op: knownOp, at: NOW, scanId, path: 'a.md', rule: 'broken-link', preHash: 'h', postHash: 'h2', snap: snapOf(knownOp), status: 'applied', hits: 0 }] }))
  c7.vault.map.set(snapOf(orphanOp), '改前原文\n')
  c7.vault.map.set(snapOf(knownOp), '改前原文\n')
  const e7 = load(c7)
  await e7.T.ensureLoaded()
  A.deepEqual(e7.T.state.orphans, [snapOf(orphanOp)], 'listFiles 看不见点目录时,孤儿快照仍须靠 opId 探测找出来')
  A.ok(e7.T.state.orphans.indexOf(snapOf(knownOp)) < 0, '台账里有的快照不是孤儿')
  e7.dispose()

  // 快照根本不存在(常态)→ 不许凭 queue 里有 opId 就报孤儿
  const c7b = mkCtx({ pages: { 'a.md': 'x\n' }, listFiles: async () => [] })
  c7b.vault.map.set('库园丁/.gardener/queue.json', JSON.stringify({ v: 1, scanId, scannedAt: NOW, stats: {}, proposals: [mkProp(orphanOp)], todos: [] }))
  const e7b = load(c7b)
  await e7b.T.ensureLoaded()
  A.deepEqual(e7b.T.state.orphans, [], '快照文件不存在时不许误报孤儿')
  e7b.dispose()
}

// ── 20. 契约往返(写 → 读 → 再写,字段不丢) ──
const roundQ = T2.normalizeQueue(JSON.parse(JSON.stringify(T2.state.queue)))
A.equal(roundQ.v, 1)
A.equal(roundQ.proposals.length, T2.state.queue.proposals.length)
A.equal(roundQ.proposals[0].producer, 'rule', 'producer 字段必须往返不丢')
A.equal(roundQ.todos.length, T2.state.queue.todos.length, 'todos 往返不丢')
A.deepEqual(roundQ.stats, T2.state.queue.stats, 'stats 往返不丢')
const legacy = T2.normalizeQueue({ scanId: 's-0-0', proposals: [{ id: 'op-x', rule: 'broken-link', path: 'a.md' }], todos: [] })
A.equal(legacy.v, 1, 'v 字段缺失的旧文件按 v1 解析不抛')
A.equal(legacy.proposals[0].producer, 'rule', '旧文件缺 producer 时补成 rule')

// ── audit 报告:两种语言各自成文,落盘文件不随语言变 ──
const repZh = T2.buildReport(T2.state.queue, 'zh')
const repEn = T2.buildReport(T2.state.queue, 'en')
A.ok(repZh.includes('库园丁待办清单'))
A.ok(repEn.includes('Vault Gardener follow-up list'))
A.ok(!/[一-鿿]/.test(repEn.replace(/`[^`]*`/g, '')), '英文报告的模板部分不应残留中文(用户路径除外)')
e2.dispose()

// ══ ③ 第一验证假设②:写后自校验能回滚 ═══════════════════════════════════════
{
  const orig = '原文一\n[[ProJect x]]\n'
  const c3 = mkCtx({ pages: { 'x.md': orig, 'Project X.md': 'p\n' } })
  const e3 = load(c3)
  await e3.T.runScan(null)
  const p = e3.T.state.queue.proposals.find((pp) => pp.path === 'x.md')
  A.ok(p, '应对 x.md 出提案')
  const good = e3.T.applyRule(orig, p)
  // 只在「写新内容」那一次篡改一个字节;回滚写回 pre-image 时不篡改
  c3.vault.corrupt = (path, text) => (path === 'x.md' && text === good ? text.slice(0, -1) + String.fromCharCode(0) : text)
  const res = await e3.T.applyProposal(p)
  A.equal(res.ok, false, '写后自校验不一致必须判失败')
  A.equal(res.key, 'msgFailedRolled')
  const wrotePre = c3.vault.writes.filter((w) => w === 'x.md').length
  A.ok(wrotePre >= 2, '应存在一次把 pre-image 写回的落盘')
  A.equal(c3.vault.map.get('x.md'), orig, '最终 vault 内容必须 === 原文')
  A.equal(p.state, 'failed', '提案状态 failed')
  A.equal(e3.T.state.ledger.entries[0].status, 'auto-rolled-back', '台账 auto-rolled-back')
  A.ok(c3.reg.notes.length > 0, 'ctx.notify 必须被调用过')
  A.equal(c3.reg.notes[c3.reg.notes.length - 1].x.level, 'error')
  A.equal(c3.reg.notes[c3.reg.notes.length - 1].x.sticky, true)
  e3.dispose()
}

// ══ ④ 第一验证假设③:全批拒绝 = 零写入 ═════════════════════════════════════
{
  const c4 = mkCtx({
    pages: {
      'a.md': '[[ProJect x]]\n', 'b.md': '[[ProJect x]]\n', 'c.md': '[[ProJect x]]\n', 'Project X.md': 'p\n',
    },
  })
  const e4 = load(c4)
  await e4.T.runScan(null)
  const props = e4.T.state.queue.proposals
  A.equal(props.length, 3, '三篇各出一条提案')
  c4.vault.writes.length = 0
  for (const p of props) p.state = 'rejected'
  await e4.T.enqueueWrite(() => Promise.resolve())
  const mdWrites = c4.vault.writes.filter((w) => /\.md$/i.test(w))
  A.deepEqual(mdWrites, [], '全批拒绝后不许有任何用户 .md 落盘')

  // 12. stale 拒写:批准前把文件改掉
  const p0 = props[0]
  p0.state = 'open'
  c4.vault.map.set(p0.path, '被别人改过了\n')
  c4.vault.writes.length = 0
  const r = await e4.T.applyProposal(p0)
  A.equal(r.key, 'msgStale', 'preHash 不符 → stale')
  A.equal(p0.state, 'stale')
  A.deepEqual(c4.vault.writes.filter((w) => w === p0.path), [], 'stale 拒写 = 零写入')

  // 重扫是全量重建:queue 整份覆盖,已 applied / rejected 的不迁移
  c4.vault.map.set(p0.path, '[[ProJect x]]\n')
  c4.vault.writes.length = 0
  await e4.T.runScan(null)
  A.equal(e4.T.state.queue.proposals.length, 3, '重扫是全量重建,queue 整份覆盖')
  A.ok(e4.T.state.queue.proposals.every((p) => p.state === 'open'), '重扫后提案一律回到 open(不迁移旧状态)')
  A.equal(c4.vault.writes.filter((w) => w.endsWith('queue.json')).length, 1, '一次扫描只在收尾落一次 queue.json,不落半份')
  A.deepEqual(c4.vault.writes.filter((w) => /\.md$/i.test(w)), [], '扫描全程只读,不许写任何 .md')
  e4.dispose()

  // 中断可恢复:枚举本身失败(seamError)→ 上一份 queue 原样留着,不落半份新的
  const c4b = mkCtx({ pages: { 'a.md': '[[ProJect x]]\n', 'Project X.md': 'p\n' } })
  const e4b = load(c4b)
  await e4b.T.runScan(null)
  const keep = JSON.stringify(e4b.T.state.queue)
  c4b.app.listPages = async () => { throw new Error('vault gone') }
  c4b.vault.writes.length = 0
  await e4b.T.runScan(null)
  A.equal(e4b.T.state.seam.state, 'seamError', '枚举失败应落到 seamError 而不是抛出去')
  A.equal(JSON.stringify(e4b.T.state.queue), keep, '扫描中断后上一份 queue 原样留着')
  A.deepEqual(c4b.vault.writes, [], '中断的扫描一个字节都不落盘')
  e4b.dispose()
}

// ══ ④b F1 回归:searchVault 只排序、绝不过滤(宿主硬截断 50 条) ═══════════════
// 命门:宿主 `searchVault` 是 `hits.slice(0, 50)` 硬截断的(vaultIndex.ts),而 F1 的原话是
// 「一个词要在两百篇里改」。旧写法「拿到非空结果就把候选集换成它」= 静默只改前 50 篇,
// 零告警、零待办,用户逐条批准完还以为整库改干净了。
{
  const many = {}
  const names = []
  for (let i = 0; i < 120; i++) {
    const n = `n${String(i).padStart(3, '0')}.md`
    names.push(n)
    many[n] = `第 ${i} 篇里有 needle 这个词\n`
  }
  const truncated = names.slice(70) // 恰好 50 条 = 索引触顶时宿主能给的全部
  A.equal(truncated.length, 50, '夹具本身必须模拟宿主的 50 条硬上限')
  const c6 = mkCtx({ pages: many, searchVault: async () => truncated.map((p) => ({ path: p, title: p, snippet: '', line: 1, score: 1 })) })
  const e6 = load(c6)
  await e6.T.runScan({ find: 'needle', to: '钩子' })
  const q6 = e6.T.state.queue
  A.equal(q6.proposals.length, 120, 'searchVault 触顶到 50 条时,查找替换仍须覆盖全部 120 篇(绝不静默截断)')
  A.ok(q6.proposals.some((p) => p.path === 'n000.md'), '不在 searchVault 结果里的文件必须照样出提案')
  A.equal(q6.stats.scanned, 120, '统计行里的「已扫」必须是真的全库,不是索引给的那 50 篇')
  A.equal(q6.stats.skipped, 0, '「跳过」只能是不合规文件,索引窄化绝不能混进这个数')
  A.equal(q6.todos.filter((d) => d.kind === 'scan-limit').length, 0, '没触发 maxScanFiles 就不该有 scan-limit 待办')
  // searchVault 仍在用 —— 只是降级成**排序提示**:命中的排前面,maxScanFiles 真要截断时先留它们
  A.deepEqual(q6.proposals.slice(0, 50).map((p) => p.path), truncated, 'searchVault 命中的排在候选队列最前面(排序提示,不是过滤器)')
  A.deepEqual(q6.proposals.slice(50).map((p) => p.path), names.slice(0, 70), '其余文件原序接在后面,一篇不少')
  e6.dispose()

  // 索引整个不可用(抛)→ 按原序全量复核,同样一篇不少
  const c6b = mkCtx({ pages: many, searchVault: async () => { throw new Error('index down') } })
  const e6b = load(c6b)
  await e6b.T.runScan({ find: 'needle', to: '钩子' })
  A.equal(e6b.T.state.queue.proposals.length, 120, 'searchVault 抛错 → 全量复核,覆盖面不变')
  A.deepEqual(e6b.T.state.queue.proposals.map((p) => p.path), names, '索引不可用时按 listPages 原序扫')
  e6b.dispose()
}

// ══ ④c P2-6:`---` 开了没闭合的笔记不许被静默整篇跳过 ═════════════════════════
// bodyStart 在 parseError 时返回行数 → broken-link / tag-variant / find-replace 整篇跳过。
// 那条 fm-parse-error 待办**不能挂在 fm-missing 的 required 上**(fmRequired 默认留空 = 该规则关闭),
// 否则统计行说「已扫 2 篇」,其中一篇一条规则都没跑过,用户看不到任何痕迹。
{
  const brokenFm = '---\ntitle: 我\n[[ProJect x]]\n#Project\n'
  const noReq = T.buildProposals([{ path: 'bad.md', text: brokenFm }], {
    rules: ['broken-link', 'tag-variant', 'find-replace'], pages: ['bad.md', 'Project X.md'], required: [], now: NOW,
  })
  A.equal(noReq.proposals.length, 0, 'frontmatter 解析失败 → 提案数必须为 0')
  A.equal(noReq.todos.filter((d) => d.kind === 'fm-parse-error').length, 1, 'fm-missing 关着也必须报 fm-parse-error,不许零痕迹跳过')
  A.equal(noReq.todos.find((d) => d.kind === 'fm-parse-error').path, 'bad.md')
  // fm-missing 开着时不许重复推两条
  const withReq = T.buildProposals([{ path: 'bad.md', text: brokenFm }], {
    rules: ['broken-link', 'fm-missing'], pages: ['bad.md'], required: ['author'], now: NOW,
  })
  A.equal(withReq.todos.filter((d) => d.kind === 'fm-parse-error').length, 1, '每篇最多一条 fm-parse-error,不许重复推')
  // 一条规则都没开时不报(那时本来就没扫)
  const noRules = T.buildProposals([{ path: 'bad.md', text: brokenFm }], { rules: [], pages: ['bad.md'], required: [], now: NOW })
  A.equal(noRules.todos.length, 0, '一条规则都没开时不报 fm-parse-error')
}

// ══ ④d 评审 P3 批次回归 ═════════════════════════════════════════════════════
{
  // ── P3-7:「命中 N 处」的口径 = 命中**处**数,不是命中**行**数 ──
  const fr2 = T.applyFindReplace('aa 与 aa 同一行\n', { find: 'aa', to: 'bb' })
  A.equal(fr2.hits.length, 1, 'find-replace 的 hits 按行聚合')
  A.equal(fr2.hits[0].n, 2, '同一行两处命中记在 n 上')
  A.equal(T.hitCount({ hits: fr2.hits }), 2, 'hitCount 数的是「处」,与 buildProposals 的 maxHits 门控同口径')
  A.equal(T.hitCount({ hits: [{ line: 1 }, { line: 2 }] }), 2, '没有 n 的规则每条 hit 记一处')
  A.equal(T.hitCount(null), 0, 'hitCount 对空提案给 0 而不是抛')

  // ── P3-13:inbox 必须有打开撤销台账的入口(不装随包 Space 时它否则没有任何代码路径) ──
  const c8 = mkCtx({ pages: { 'a.md': 'x\n' } })
  const opened = []
  c8.openView = (id) => opened.push(id)
  const e8 = load(c8)
  const host8 = document.createElement('div')
  const un8 = e8.T.mountView(host8, 'inbox')
  const histBtn = findByText(host8, e8.T.MSG.zh.btnHistory)
  A.ok(histBtn, 'inbox 里必须有一个按钮能打开 history 视图')
  fire(histBtn, 'click')
  A.ok(opened.indexOf('history') >= 0, '点它必须真的 openView(history)')

  // ── P3-15:规则被全关掉时必须说清楚,不能只回一句「没找到可自动修复的问题」 ──
  A.ok(!host8.textContent.includes(e8.T.MSG.zh.noRulesNote), '默认三条规则都开着,不该出现「一条都没开」')
  for (const label of [e8.T.MSG.zh.ruleBrokenLink, e8.T.MSG.zh.ruleTagVariant, e8.T.MSG.zh.ruleFmMissing]) {
    const chip = findByText(host8, label)
    A.ok(chip, `规则按钮 ${label} 应存在`)
    fire(chip, 'click')
  }
  A.ok(host8.textContent.includes(e8.T.MSG.zh.noRulesNote), '规则全关后必须明确提示,而不是让扫描静默回空')
  un8()
  e8.dispose()
  localStorage.removeItem('plugin.vault-gardener.rules') // 设置是全局 localStorage,别污染后面的实例

  // ── P3-9:换队列必须进写串行队列(否则扫描中批准一条会把它的 applied 状态写没) ──
  const c9 = mkCtx({ pages: { 'a.md': '[[ProJect x]]\n', 'Project X.md': 'p\n' } })
  const e9 = load(c9)
  await e9.T.runScan(null)
  const oldQueue = e9.T.state.queue
  let release = null
  const gate = new Promise((r) => { release = r })
  e9.T.enqueueWrite(() => gate)
  const scanning = e9.T.runScan(null)
  await new Promise((r) => setTimeout(r, 40))
  A.equal(e9.T.state.queue, oldQueue, '写链被占住时,扫描不许提前把 state.queue 换掉')
  release()
  await scanning
  A.notEqual(e9.T.state.queue, oldQueue, '写链空出来后队列才整份替换')
  e9.dispose()

  // ── P3-11:disposer 必须让挂着的 later() promise settle,否则扫描循环永久挂起 ──
  const c10 = mkCtx({ pages: {} })
  const e10 = load(c10)
  const pending = e10.T.later(60000)
  e10.dispose()
  const settled = await Promise.race([pending.then(() => 'settled'), new Promise((r) => setTimeout(() => r('hung'), 200))])
  A.equal(settled, 'settled', 'disposer 光 clearTimeout 不够:必须 resolve,否则 await later() 的闭包永不回收')

  // ── P3-10:硬失败停写之后,回滚仍必须可用(它写的是快照原文,风险方向相反) ──
  const c11 = mkCtx({ pages: { 'a.md': '[[ProJect x]]\n', 'Project X.md': 'p\n' } })
  const e11 = load(c11)
  await e11.T.runScan(null)
  const p11 = e11.T.state.queue.proposals[0]
  const before11 = c11.vault.map.get('a.md')
  A.equal((await e11.T.applyProposal(p11)).ok, true, '先正常写入一条')
  const entry11 = e11.T.state.ledger.entries[e11.T.state.ledger.entries.length - 1]
  A.notEqual(c11.vault.map.get('a.md'), before11, '文件确实被改了')
  e11.T.state.halted = true
  const rb11 = await e11.T.rollbackOp(entry11)
  A.equal(rb11.ok, true, 'state.halted 不许挡住回滚 —— 硬失败之后用户最需要的就是它')
  A.equal(rb11.key, 'msgRollbackOk')
  A.equal(c11.vault.map.get('a.md'), before11, '回滚后文件逐字节回到改前')
  A.equal(entry11.status, 'rolled-back')
  // 而应用提案仍然被 halted 挡住(SPEC 那句「停止一切后续写入」说的是它)
  const p11b = e11.T.state.queue.proposals.find((p) => p.state === 'open') || p11
  p11b.state = 'open'
  A.equal((await e11.T.applyProposal(p11b)).key, 'msgHalted', 'halted 仍必须挡住继续应用提案')
  e11.dispose()

  // ── P3-14:audit 报告是派生物,但也要读回校验,不许是唯一一条「写完不看」的落盘路径 ──
  const c12 = mkCtx({ pages: { 'a.md': 'x\n' } })
  const e12 = load(c12)
  await e12.T.runScan(null)
  c12.vault.corrupt = (p, text) => (/audit-.*\.md$/.test(p) ? text + '被别人塞了一行\n' : text)
  await e12.T.writeReport()
  A.equal(e12.T.state.msg.key, 'reportFail', '报告写完读回不一致必须报错,而不是回一句「已写出」')
  c12.vault.corrupt = null
  await e12.T.writeReport()
  // [回归 2026-08-21 · 评审 Finding 2] 上一次写进去的是被污染的那份 —— 现在覆写前必须先留快照,
  //   所以这里的成功文案是带快照路径的那一条,而不是光秃秃的 reportOk。
  A.equal(e12.T.state.msg.key, 'reportOkSnap', '同名覆写必须先留快照并在文案里说出来')
  A.ok(/\.gardener-undo\/reports\/.*\.snap$/.test(e12.T.state.msg.vars.snap), '快照落在 .gardener-undo/reports/')
  A.ok(String(c12.vault.map.get(e12.T.state.msg.vars.snap)).includes('被别人塞了一行'), '快照是上一份的逐字节副本')

  // ── [回归 2026-08-21] 评审四条 ────────────────────────────────────────────
  {
    // F3 / FIXLIST P0-A:报告是裸 .md,必须走 loadPage,不能走 openFile(会被系统默认程序抢走)
    A.ok(c12.reg.loaded.some((x) => /audit-.*\.md$/.test(x)), 'R-F3 报告必须走 ctx.app.loadPage')
    A.equal(c12.reg.opened.length, 0, 'R-F3 一次都没调 ctx.app.openFile')
  }
  {
    // F2 反向:全新报告(此前没有同名文件)不该留快照,也不该改文案
    const c13 = mkCtx({ pages: { 'a.md': 'x\n' } })
    const e13 = load(c13)
    await e13.T.runScan(null)
    await e13.T.writeReport()
    A.equal(e13.T.state.msg.key, 'reportOk', 'R-F2 首次生成报告不留快照')
    A.equal(Array.from(c13.vault.map.keys()).filter((k) => /\.snap$/.test(k)).length, 0, 'R-F2 首次没有 .snap')
    // 用户在报告里加了一行批注,再生成一次 → 批注必须进快照
    const rp = Array.from(c13.vault.map.keys()).find((k) => /audit-.*\.md$/.test(k))
    c13.vault.map.set(rp, c13.vault.map.get(rp) + '\n> 我的批注:第 3 条别改\n')
    await e13.T.writeReport()
    A.equal(e13.T.state.msg.key, 'reportOkSnap', 'R-F2 同名覆写必须留快照')
    A.ok(String(c13.vault.map.get(e13.T.state.msg.vars.snap)).includes('我的批注'), 'R-F2 用户的批注逐字节存进快照')
    e13.dispose()
  }
  {
    // F1:自往返闸必须覆盖四种 frontmatter 形态 —— `k:v` 在流式数组/块序列两支里抽不回来
    A.equal(T.validateTagName('k:v').ok, false, 'R-F1 含 : 的目标名必须被自往返闸拒掉')
    A.equal(T.validateTagName('k:v').err, 'errTagRoundTrip', 'R-F1 拒因是自往返')
    A.equal(T.validateTagName('a/b').ok, true, 'R-F1 层级标签仍然合法(别拒过头)')
    A.equal(T.validateTagName('中文标签').ok, true, 'R-F1 中文标签仍然合法')
  }
  {
    // F6:getActivePage 抛错 ≠ 没有活动页 —— 问不出来就拒写,不许让闸静默失效
    const c14 = mkCtx({ pages: { 'a.md': 'x #foo\n' } })
    c14.app.getActivePage = () => { throw new Error('store 异常') }
    const e14 = load(c14)
    A.equal(e14.T.activePagePath(), e14.T.ACTIVE_UNKNOWN, 'R-F6 抛错回哨兵,不是 null')
    A.equal(e14.T.blockedByActivePage('a.md'), true, 'R-F6 问不出来一律拒写')
    e14.dispose()
    const c15 = mkCtx({ pages: { 'a.md': 'x\n' } })
    delete c15.app.getActivePage
    const e15 = load(c15)
    A.equal(e15.T.activePagePath(), null, 'R-F6 方法缺席(旧宿主)仍是 null')
    A.equal(e15.T.blockedByActivePage('a.md'), false, 'R-F6 旧宿主一律不拦(SPEC 明确要的降级)')
    e15.dispose()
  }
  e12.dispose()
}

// ══ ④e 1.1.0 标签操作:抽取器补全的**逐字节回归** ════════════════════════════
// codeRanges 追加了 math / mathBlock / comment / commentBlock 四个字段。既有的
// lines / fenced / inline 三个字段必须逐字节不变 —— 也就是说 broken-link 与 find-replace 的
// 输出与 1.0.0 完全相同(数学与注释**只**收窄 scanTags)。下面用手写期望值钉死。
{
  const mixDoc = [
    '价格 $5 和 $10 里的 needle',
    '公式 $a+b$ 与 needle',
    '<!-- needle 在注释里 -->',
    '`needle` 与 needle',
    '```',
    'needle',
    '```',
    '[[ProJect x]] needle',
  ].join('\n') + '\n'
  const frExpect = [
    '价格 $5 和 $10 里的 X',
    '公式 $a+b$ 与 X',
    '<!-- X 在注释里 -->',
    '`needle` 与 X',
    '```',
    'needle',
    '```',
    '[[ProJect x]] X',
  ].join('\n') + '\n'
  A.equal(T.applyFindReplace(mixDoc, { find: 'needle', to: 'X' }).text, frExpect, '数学与 HTML 注释绝不能渗进 find-replace(那会静默缩小它已承诺的覆盖面)')
  const blExpect = mixDoc.replace('[[ProJect x]]', '[[Project X]]')
  A.equal(T.applyBrokenLink(mixDoc, { fixes: [{ from: 'ProJect x', to: 'Project X' }] }).text, blExpect, 'broken-link 行为一个字节不变')
  const cr = T.codeRanges(mixDoc)
  A.deepEqual(cr.fenced, [false, false, false, false, true, true, true, false, false], 'fenced 语义不变(末尾 \\n 带出的空行也算一行)')
  A.equal(cr.inline[3].length, 1, 'inline 语义不变:第 4 行有一对反引号')
  A.equal(cr.math[0].length, 0, '货币的 $ 不成对 → 不是数学(闭 $ 前是空白)')
  A.equal(cr.math[1].length, 1, '$a+b$ 是行内数学')
  A.equal(cr.comment[2].length, 1, '行内 HTML 注释被认出来')
  // tag-variant 的簇计数同步收紧:数学 / 注释里的写法不再参与频次裁决
  A.deepEqual(T.extractTags('$x #Foo$ 与 #foo\n'), ['foo'], '行内数学里的标签不进标签计数')
  A.deepEqual(T.extractTags('<!-- #Foo --> #foo\n'), ['foo'], '行内注释里的标签不进标签计数')
  A.deepEqual(T.extractTags('<!--\n#Foo\n-->\n#foo\n'), ['foo'], '跨行注释里的标签不进标签计数')
  A.deepEqual(T.extractTags('$$\n#Foo\n$$\n#foo\n'), ['foo'], '块级数学里的标签不进标签计数')
}

// ══ ④f scanFmTags:逗号串逐字节回归 + 两种新形态 ═════════════════════════════
{
  // 回归:1.0.0 的逗号串行为一字不动
  const comma = '---\ntitle: T\ntags: project, other\n---\n\n#project\n'
  A.deepEqual(T.scanFmTags(comma).map((o) => o.tag), ['project', 'other'], '逗号串形态照旧')
  A.equal(T.applyTagCanon(comma, { changes: [{ from: 'project', to: 'Project' }] }).text,
    '---\ntitle: T\ntags: Project, other\n---\n\n#Project\n', '逗号串归一逐字节与 1.0.0 相同')
  // 新增:流式数组
  const flow = '---\ntags: [foo, other]\n---\n'
  A.deepEqual(T.scanFmTags(flow).map((o) => o.tag), ['foo', 'other'], '流式数组认')
  for (const o of T.scanFmTags(flow)) A.equal(T.splitLines(flow)[o.line].slice(o.start, o.end), o.raw, '偏移量必须精确对上原文(replaceOccurrences 的前置条件)')
  A.deepEqual(T.scanFmTags('---\ntags: [a,b]\n---\n').map((o) => o.tag), ['a', 'b'], '无空格的流式数组也认')
  A.deepEqual(T.scanFmTags('---\ntags: [a, b] 尾巴\n---\n'), [], '] 之后还有东西 → 保守不碰')
  A.deepEqual(T.scanFmTags('---\ntags: [a\n---\n'), [], '没闭合的 [ → 保守不碰')
  // 新增:块序列
  const seq = '---\ntitle: T\ntags:\n  - foo\n  - other\nauthor: X\n---\n'
  A.deepEqual(T.scanFmTags(seq).map((o) => o.tag), ['foo', 'other'], '块序列认,遇到不匹配的行即止')
  for (const o of T.scanFmTags(seq)) A.equal(T.splitLines(seq)[o.line].slice(o.start, o.end), o.raw, '块序列偏移量精确')
  A.deepEqual(T.scanFmTags('---\ntags:\n  - "foo"\n---\n'), [], '带引号的条目保守不碰')
  A.deepEqual(T.scanFmTags('---\ntags:\n  - a: b\n---\n'), [], '嵌套映射条目保守不碰')
  A.deepEqual(T.scanFmTags('---\ntags: |\n  foo\n---\n'), [], '块标量仍然不碰')
  A.deepEqual(T.scanFmTags('---\ntitle: foo\nkeywords: foo\n---\n'), [], '只认 tags / tag 键')
  A.deepEqual(T.scanFmTags('---\ntag: foo\n---\n').map((o) => o.tag), ['foo'], '单数 tag 键也认')
  A.equal(T.scanFmTagList === undefined ? 'missing' : typeof T.scanFmTagList, 'function', '1.0.0 的旧名保留为别名')
  A.deepEqual(T.scanFmTagList(seq).map((o) => o.tag), T.scanFmTags(seq).map((o) => o.tag), '别名行为 = 新函数,不留两份实现')
  // 回归:scanFmTags 变宽不许误伤 applyFmMissing 的 P0-1 四条向量(它们在上面 ── 7. 里逐条跑过)
  A.equal(T.applyFmMissing(seq, { required: ['created'] }).text,
    '---\ntitle: T\ntags:\n  - foo\n  - other\nauthor: X\ncreated:\n---\n', '块序列在场时补键仍落在闭合 --- 前一行')
}

// ══ ④g ★边界匹配向量表(32 组,「不许命中」那一半是重点) ══════════════════════
{
  const S = (over) => Object.assign({ op: 'rename', from: ['foo'], to: 'bar', children: false }, over || {})
  const n = (text, spec) => T.tagOpHits(text, spec || S()).length
  const V = [
    ['#foo\n', 1, '基线'],
    ['#foobar\n', 0, '词元不等,结构上不可能命中'],
    ['#foo-bar\n', 0, '连字符后缀不算同一个标签'],
    ['#foo_bar\n', 0, '下划线后缀不算同一个标签'],
    ['#foo/child\n', 0, '子层级开关关着'],
    ['```\n#foo\n```\n', 0, '围栏'],
    ['~~~\n#foo\n~~~\n', 0, '~~~ 围栏'],
    ['```\n#foo\n', 0, '未闭合围栏一直到 EOF'],
    ['$a + #foo$\n', 0, '行内数学'],
    ['$$\n#foo\n$$\n', 0, '块级数学'],
    ['见 https://a.com/p#foo\n', 0, 'URL 片段'],
    ['[x](y#foo)\n', 0, 'markdown 链接锚点'],
    ['[x](#foo)\n', 0, '同上,页内锚点'],
    ['[[a#foo]]\n', 0, 'wikilink 块锚'],
    ['[[a^foo]]\n', 0, 'wikilink 块 id 根本没有 #'],
    ['<!-- #foo -->\n', 0, '行内 HTML 注释'],
    ['<!--\n#foo\n-->\n', 0, '跨行 HTML 注释'],
    ['# foo\n', 0, '一级标题不是标签'],
    ['## foo\n', 0, '二级标题不是标签'],
    ['###foo\n', 0, '连着的 # 不是标签'],
    ['---\ntitle: foo\nkeywords: foo\n---\n', 0, '只认 tags / tag 键'],
    ['---\ntags:\n  - "foo"\n---\n', 0, '带引号的 frontmatter 条目'],
  ]
  for (const [text, want, why] of V) A.equal(n(text), want, `边界向量「${why}」:${JSON.stringify(text)} 应命中 ${want} 处`)
  // 需要单独口径的几组
  A.equal(n('`#foo` #foo\n'), 1, '行内 code 里那个不算,行外那个算')
  A.equal(T.tagOpHits('`#foo` #foo\n', S())[0].line, 1)
  A.equal(n('价格 $5 和 $10 里的 #foo\n'), 1, '货币的 $ 不成对 → 不是数学,标签照常命中(新能力的假阳性防线)')
  A.equal(n('#foo/child\n', S({ op: 'restructure', children: true })), 1, '开了子层级 → 命中')
  A.equal(T.tagOpHits('#foo/child\n', S({ op: 'restructure', children: true }))[0].to, 'bar/child', '尾巴逐字节保留')
  A.equal(n('#foobar/x\n', S({ op: 'restructure', children: true })), 0, '子层级也要整段边界:foo 后面必须是 /')
  A.equal(n('---\ntitle: T\n---\n#foo\n'), 1, 'frontmatter 与正文分开处理,正文照常')
  A.deepEqual(T.tagOpHits('---\ntags: foo, other\n---\n', S()).map((h) => h.where), ['fm'], '逗号串命中记在 fm')
  A.deepEqual(T.tagOpHits('---\ntags: [foo, other]\n---\n', S()).map((h) => h.where), ['fm'], '流式数组命中记在 fm')
  A.deepEqual(T.tagOpHits('---\ntags:\n  - foo\n  - other\n---\n', S()).map((h) => h.where), ['fm'], '块序列命中记在 fm')
  A.deepEqual(T.tagOpHits('#Foo 与 #foo\n', S()).map((h) => h.from), ['Foo', 'foo'], '按 tagKey 匹配,大小写变体都算命中')
  A.equal(T.applyTagOps('#Foo 与 #foo\n', S()).text, '#bar 与 #bar\n', '两种写法都改成目标')
  A.deepEqual(T.applyTagOps('#Foo 与 #foo\n', S()).forms, [{ tag: 'Foo', n: 1 }, { tag: 'foo', n: 1 }], '命中形态表把大小写变体摊开给用户看')
  A.equal(T.applyTagOps('见 #foo。\n', S()).text, '见 #bar。\n', 'TAG_TAIL 剥离后替换,句号逐字节保留')
  A.equal(T.applyTagOps('#foo\r\n', S()).text, '#bar\r\n', 'CRLF 原样活下来')
  // ⚠️折叠会变长(U+0130 'İ' 小写成两个 code unit)→ 按字面下标切不齐,一律不命中(宁可少改一处)
  // İ(U+0130)小写成两个 code unit → tagKey 比字面**长**。子层级档必须**只按字面下标切**:
  //   ① 用户填的就是字面 `İfoo` → 切得齐 → 正常命中,尾巴逐字节保留
  A.equal(n('#İfoo/x\n', S({ from: ['İfoo'], op: 'restructure', children: true })), 1, '字面对得上时必须照常命中(拿 tagKey 的长度去切会在这里静默漏改)')
  A.equal(T.applyTagOps('#İfoo/x 与 #İfoobar\n', S({ from: ['İfoo'], op: 'restructure', children: true })).text, '#bar/x 与 #İfoobar\n', '折叠变长时子层级仍然逐字节正确,#İfoobar 不受牵连')
  //   ② 用户填的是折叠后的形态 `i̇foo` → 按字面切不齐 → **不命中**(宁可少改一处,绝不按错位偏移写出乱码)
  A.equal(n('#İfoo/x\n', S({ from: ['i̇foo'], op: 'restructure', children: true })), 0, '折叠变长切不齐 → 不命中,绝不按错位偏移写出乱码')
  // 块标记行(1.0.0 就有的防线,回归位)
  const markerTagDoc = '<!-- a 1 -->\n见 #foo\n  <!-- a b-1 -->  \n'
  A.equal(n(markerTagDoc), 1, '标记行之间的正文标签照常命中')
  const markerOut = T.applyTagOps(markerTagDoc, S()).text
  A.deepEqual(T.splitLines(markerOut).filter((l) => T.isMarkerLine(l)), T.splitLines(markerTagDoc).filter((l) => T.isMarkerLine(l)), 'tag-op 跑完后块标记行逐字节不动')
  A.equal(markerOut, '<!-- a 1 -->\n见 #bar\n  <!-- a b-1 -->  \n')
  // 四条规则跑完标记行不动 —— 把 tag-op 也接进那条既有断言的口径
  A.equal(T.applyRule(markerTagDoc, { rule: 'tag-op', params: S() }), markerOut, 'applyRule 路由到 tag-op')
}

// ══ ④h tagOpTarget / validateTagName 单元向量 ═══════════════════════════════
{
  const sp = (over) => Object.assign({ op: 'rename', from: ['foo'], to: 'bar', children: false }, over || {})
  A.equal(T.tagOpTarget('foo', sp()), 'bar', '同字面命中')
  A.equal(T.tagOpTarget('FOO', sp()), 'bar', '仅大小写差命中(tagKey 口径)')
  A.equal(T.tagOpTarget('foo/', sp()), 'bar', '尾部 / 差命中')
  A.equal(T.tagOpTarget('foo/child', sp()), null, '子层级开关关 → 不命中')
  A.equal(T.tagOpTarget('foo/child', sp({ children: true })), 'bar/child', '子层级开关开 → 命中并保留尾巴')
  A.equal(T.tagOpTarget('', sp()), null, '空字面 → null')
  A.equal(T.tagOpTarget('foo', sp({ to: '' })), null, '空目标 → null')
  A.equal(T.tagOpTarget('foo', { from: [], to: 'bar' }), null, '零源 → null')
  A.equal(T.tagOpTarget('a/b', { op: 'merge', from: ['a', 'a/b'], to: 't', children: true }), 't', '精确档优先于子层级档')
  A.equal(T.tagOpTarget('a/b/c', { op: 'restructure', from: ['a', 'a/b'], to: 't', children: true }), 't/b/c', '多源时按字面长度降序命中(确定性)')
  // validateTagName 十条规则各一
  const bad = (raw, err) => A.equal(T.validateTagName(raw).err, err, `${JSON.stringify(raw)} 应被 ${err} 拒绝`)
  bad('', 'errTagEmpty')
  bad('#', 'errTagEmpty')
  bad('a b', 'errTagSpace')
  bad('a#b', 'errTagHash')
  bad('/a', 'errTagSlash')
  bad('a/', 'errTagSlash')
  bad('a//b', 'errTagSlash')
  bad('!a', 'errTagPunct')
  bad('123', 'errTagDigits')
  bad('a。', 'errTagTail')
  bad('a,b', 'errTagChar')
  bad('a<!--', 'errTagChar')
  bad('a`b', 'errTagChar')
  bad('a$b', 'errTagChar')
  A.equal(T.validateTagName('#bar').ok, true, '前缀 # 可写可不写')
  A.equal(T.validateTagName('#bar').tag, 'bar', '前导 # 被剥掉')
  A.equal(T.validateTagName('  bar  ').tag, 'bar', '两侧空白被 trim')
  A.equal(T.validateTagName('a/b/c').ok, true, '层级名合法')
  A.equal(T.validateTagName('产品').ok, true, '中文标签合法')
  // 自往返闸:凡是我们自己的扫描器抽不回原样的,一律拒
  for (const raw of ['a<!--', 'a`b', 'a$b']) A.equal(T.validateTagName(raw).ok, false, `${raw} 必须被拒`)
  // ⚠️「与源同名」比的是字面不是 key:#Foo → #foo 是合法改名
  const sameCase = T.validateTagOpSpec({ op: 'rename', from: 'Foo', to: 'foo' })
  A.equal(sameCase.ok, true, '大小写归一式改名不许被 errTagSame 误拒')
  A.deepEqual(sameCase.spec.from, ['Foo'])
  A.equal(T.validateTagOpSpec({ op: 'rename', from: 'foo', to: 'foo' }).err, 'errTagSame', '字面完全相同才拒')
  A.equal(T.validateTagOpSpec({ op: 'rename', from: '', to: 'b' }).err, 'errTagNeedFrom', '零源要说清楚')
  A.equal(T.validateTagOpSpec({ op: 'merge', from: 'a, b, a', to: 't' }).spec.from.length, 2, '合并档按逗号切并去重')
  A.equal(T.validateTagOpSpec({ op: 'rename', from: 'a,b', to: 't' }).err, 'errTagChar', '改名档是单源,源里带逗号要报错而不是静默丢一个')
  A.equal(T.validateTagOpSpec({ op: 'rename', from: 'a, b', to: 't' }).err, 'errTagSpace', '带空格的同上,报的是更贴切的那条')
  A.equal(T.validateTagOpSpec({ op: 'restructure', from: 'a', to: 't' }).spec.children, true, '层级重构默认连子层级一起搬')
  A.equal(T.validateTagOpSpec({ op: 'restructure', from: 'a', to: 't', children: false }).spec.children, false, '开关可关')
  A.equal(T.validateTagOpSpec({ op: 'rename', from: 'a', to: 't', children: true }).spec.children, false, '改名档没有子层级语义')
  A.equal(T.validateTagOpSpec(null).ok, false, 'null 规格不许抛')
  A.equal(T.validateTagOpSpec({ op: '打劫', from: 123, to: {} }).ok, false, '垃圾规格不许抛')
  // 总函数:非法规格一律原样返回,**绝不抛**(抛出去会把提案标成 failed,而它其实只是没得改)
  A.doesNotThrow(() => T.applyTagOps('#a\n', null))
  A.equal(T.applyTagOps('#a\n', null).text, '#a\n', '非法规格 = 零改动')
  A.equal(T.applyTagOps('#a\n', { op: 'rename', from: 'zzz', to: 'y' }).text, '#a\n', '不命中 = 零改动')
}

// ══ ④i applyTagOps 三种动作 + frontmatter 去重(正文不去重) ═════════════════
{
  // 改名
  A.equal(T.applyTagOps('#foo 与 #foobar\n', { op: 'rename', from: 'foo', to: 'bar' }).text, '#bar 与 #foobar\n', '改名:整标签边界')
  // 层级重构(默认连子层级)
  const tree = '#a/b\n#a/b/c\n#a/bx\n#a\n'
  A.equal(T.applyTagOps(tree, { op: 'restructure', from: 'a/b', to: 'x/y/b' }).text, '#x/y/b\n#x/y/b/c\n#a/bx\n#a\n', '层级重构默认连子层级一起搬,#a/bx 与 #a 一个字节不动')
  A.equal(T.applyTagOps(tree, { op: 'restructure', from: 'a/b', to: 'x/y/b', children: false }).text, '#x/y/b\n#a/b/c\n#a/bx\n#a\n', '关掉子层级只改自己')
  // 合并:frontmatter 去重,正文不去重
  const merge = '---\ntags: a, b\n---\n正文 #a 和 #b\n'
  const mo = T.applyTagOps(merge, { op: 'merge', from: ['a', 'b'], to: 't' })
  A.equal(mo.text, '---\ntags: t\n---\n正文 #t 和 #t\n', 'frontmatter 列表去重;正文保持两处(删掉句子里的一个词会留下断句)')
  A.equal(T.applyTagOps(merge, { op: 'merge', from: ['a', 'b'], to: 't', dedupe: false }).text, '---\ntags: t, t\n---\n正文 #t 和 #t\n', '去重可关')
  // 流式数组与块序列的去重
  A.equal(T.applyTagOps('---\ntags: [a, b, c]\n---\n', { op: 'merge', from: ['a', 'b'], to: 't' }).text, '---\ntags: [t, c]\n---\n', '流式数组去重后括号与其余条目不动')
  A.equal(T.applyTagOps('---\ntags:\n  - a\n  - b\n  - c\n---\n', { op: 'merge', from: ['a', 'b'], to: 't' }).text, '---\ntags:\n  - t\n  - c\n---\n', '块序列去重 = 删掉整行')
  // ⚠️文件原本就有的重复一个字节不动(用户没让我们动它)
  A.equal(T.applyTagOps('---\ntags: x, x, a\n---\n', { op: 'rename', from: 'a', to: 't' }).text, '---\ntags: x, x, t\n---\n', '不是本次目标的重复项一个字节不动')
  A.equal(T.applyTagOps('---\ntags: t, t, a\n---\n', { op: 'rename', from: 'a', to: 't', dedupe: true }).text, '---\ntags: t\n---\n', '本次真改动过的那条列表里,目标标签的重复项收敛成一条(frontmatter 的 tags 是集合)')
  // ⚠️没被本次操作碰过的那条列表,原有的重复一个字节不动
  A.equal(T.applyTagOps('---\ntags: t, t\ncat: x\n---\n正文 #a\n', { op: 'rename', from: 'a', to: 't' }).text, '---\ntags: t, t\ncat: x\n---\n正文 #t\n', '本次没改动过的列表里,原有的重复一个字节不动(用户没让我们动它)')
  // 与 tag-variant 共用同一条替换原语 → 口径必然一致
  A.equal(T.applyTagOps('$#a$ `#a` #a\n', { op: 'rename', from: 'a', to: 'b' }).text, '$#a$ `#a` #b\n', '数学与行内 code 里的标签一个字节不动')
}

// ══ ④j ALL_RULES 变长不许影响 inbox 规则名册 / 报告 ═════════════════════════
{
  const c13 = mkCtx({ pages: { 'a.md': '#foo\n' } })
  const e13 = load(c13)
  const host13 = document.createElement('div')
  const un13 = e13.T.mountView(host13, 'inbox')
  // SCAN_RULES 仍是 3 条:标签操作与查找替换一样由用户显式发起,不进规则 chips
  for (const label of [e13.T.MSG.zh.ruleBrokenLink, e13.T.MSG.zh.ruleTagVariant, e13.T.MSG.zh.ruleFmMissing]) {
    A.ok(findByText(host13, label), `规则 chip ${label} 仍在`)
  }
  const chipsOf = (n) => findAll(n, 'button').filter((b) => String(b.className || '').indexOf('vg-chip') >= 0)
  A.equal(chipsOf(host13).length, 3, '规则 chips 仍是 3 条 —— 标签操作与查找替换一样由用户显式发起,不进 SCAN_RULES')
  A.ok(findByText(host13, e13.T.MSG.zh.tagOpTitle), 'inbox 工具条上有「标签操作」折叠按钮')
  fire(findByText(host13, e13.T.MSG.zh.tagOpTitle), 'click')
  A.equal(chipsOf(host13).length, 6, '展开后多出三档动作 chips(改名 / 合并 / 层级重构)')
  A.ok(host13.textContent.includes(e13.T.MSG.zh.tagOpModeRestructure), '展开后三档动作都在')
  A.ok(host13.textContent.includes(e13.T.MSG.zh.tagOpBodyDupNote), '正文不去重必须写在 UI 上,不许留下做不到的承诺')
  // 校验失败当场说清楚,**不发起扫描**
  c13.vault.writes.length = 0
  e13.T.state.tagOp.op = 'rename'
  e13.T.state.tagOp.from = 'a'
  e13.T.state.tagOp.to = 'b c'
  fire(findByText(host13, e13.T.MSG.zh.tagOpRun), 'click')
  A.equal(e13.T.state.msg.key, 'errTagSpace', '目标名非法当场拒绝并说明')
  A.deepEqual(c13.vault.writes, [], '校验没过就不发起扫描,零写入')
  A.ok(host13.textContent.includes('b c'), '错误提示里带上用户填的那个串')
  // 表单值存在 state 里(切语言整树重建也不丢)
  c13.locale = 'en'
  if (c13.localeCb) c13.localeCb('en')
  A.equal(e13.T.state.tagOp.to, 'b c', '切语言不许吃掉用户正在输入的内容')
  A.ok(host13.textContent.includes('Restructure'), '切语言后表单文案跟着变')
  c13.locale = 'zh'
  if (c13.localeCb) c13.localeCb('zh')
  un13()
  e13.dispose()
}

// ══ ④k 端到端 tag-op:干跑零写入 → diff → 批准 → 落盘 === 预览 ═══════════════
{
  const PAGES13 = {
    '笔记/A.md': '---\ntags: 读书, 其它\n---\n\n关于 #读书 与 #阅读 的讨论\n',
    '笔记/B.md': '#阅读/技巧\n',
    '笔记/C.md': '另一篇 #阅读\n',
    '笔记/D.md': '与标签无关\n',
  }
  const c14 = mkCtx({ pages: PAGES13 })
  const e14 = load(c14)
  const T14 = e14.T
  const spec = { op: 'merge', from: ['读书', '阅读'], to: '读物', children: false }
  c14.vault.writes.length = 0
  await T14.runScan({ tagOp: spec })
  const q14 = T14.state.queue
  // ── 干跑零写入:第一验证假设③在新规则上重跑 ──
  A.deepEqual(c14.vault.writes.filter((w) => /\.md$/i.test(w)), [], '干跑阶段不许写任何用户 .md')
  A.deepEqual(c14.vault.writes, ['库园丁/.gardener/queue.json'], '一次标签扫描只落一份 queue.json')
  // ── summary 统计 ──
  A.ok(q14.summary, '标签操作扫描必须给出干跑统计')
  A.equal(q14.summary.kind, 'tag-op')
  A.equal(q14.summary.files, 2, '将影响 2 篇(A 与 C;B 的 #阅读/技巧 在 children:false 下不算,D 无标签)')
  A.equal(q14.summary.hits, 4, '共 4 处:A 的 frontmatter 一处 + 正文两处,C 正文一处')
  A.deepEqual(q14.summary.forms, [{ tag: '读书', n: 2 }, { tag: '阅读', n: 2 }], '命中形态表按字典序摊开,两种源写法各自摊开')
  A.equal(q14.proposals.length, 2, '只有真有改动的两篇出提案')
  A.ok(q14.proposals.every((p) => p.rule === 'tag-op' && p.producer === 'rule'))
  A.deepEqual(q14.proposals[0].params, spec, 'params 存的是规格本身,不是展开后的映射表')
  // #阅读/技巧 在 children:false 下不该动 → 笔记/B.md 不出提案
  A.ok(!q14.proposals.find((p) => p.path === '笔记/B.md'), '子层级开关关着时 #阅读/技巧 不动')
  // ── 预览 == 落盘(第一验证假设①在新规则上重跑) ──
  const pA = q14.proposals.find((p) => p.path === '笔记/A.md')
  A.ok(pA)
  const preA = PAGES13['笔记/A.md']
  const postA = T14.applyRule(preA, pA)
  A.equal(T14.applyRule(preA, pA), postA, 'applyRule 连调两次全等')
  A.equal(postA, '---\ntags: 读物, 其它\n---\n\n关于 #读物 与 #读物 的讨论\n', '两处居所都改到,无关标签「其它」一个字节不动;正文的两处重复保持原样')
  A.ok(T14.diffLines(preA, postA).length >= 2)
  const r14 = await T14.applyProposal(pA)
  A.equal(r14.ok, true, `批准应成功,实得 ${JSON.stringify(r14)}`)
  A.equal(c14.vault.map.get('笔记/A.md'), postA, '内存 vault 里的文本必须 === diff 视图依据的 post')
  A.equal(pA.state, 'applied')
  A.ok(c14.reg.acts.find((a) => a.e === 'apply' && a.d.rule === 'tag-op'), 'activity.log(apply) 带上 rule=tag-op')
  // ── 层级重构档:子层级跟着搬 ──
  const specR = { op: 'restructure', from: ['阅读'], to: '读物/方法', children: true }
  await T14.runScan({ tagOp: specR })
  const pB = T14.state.queue.proposals.find((p) => p.path === '笔记/B.md')
  A.ok(pB, '#阅读/技巧 在层级重构档下应出提案')
  A.equal(T14.applyRule('#阅读/技巧\n', pB), '#读物/方法/技巧\n', '子层级尾巴逐字节保留')
  // ── stale:批准前把文件改掉 ──
  c14.vault.map.set('笔记/B.md', '被别人改过了\n')
  c14.vault.writes.length = 0
  const rs = await T14.applyProposal(pB)
  A.equal(rs.key, 'msgStale', 'preHash 不符 → stale')
  A.equal(pB.state, 'stale')
  A.deepEqual(c14.vault.writes.filter((w) => /\.md$/i.test(w)), [], 'stale 拒写 = 零写入')
  // ── 命中超上限 → 复用已有 todo kind,不出提案 ──
  const many = '#a '.repeat(250) + '\n'
  const built = T.buildProposals([{ path: 'm.md', text: many }], { rules: ['tag-op'], pages: ['m.md'], now: NOW, tagOp: { op: 'rename', from: 'a', to: 'b' } })
  A.equal(built.proposals.length, 0, '单文件命中超上限不出提案')
  A.equal(built.todos[0].kind, 'hits-too-many', '复用已有的 todo kind,不新增 kind')
  // ── 一处都没命中 ──
  const none = T.buildProposals([{ path: 'x.md', text: '什么都没有\n' }], { rules: ['tag-op'], pages: ['x.md'], now: NOW, tagOp: { op: 'rename', from: 'zzz', to: 'y' } })
  A.equal(none.proposals.length, 0)
  A.equal(none.summary.files, 0, '零命中时统计如实写 0')
  // ── 常规扫描不产 summary(现有两键语义不变) ──
  A.equal(T.buildProposals([{ path: 'x.md', text: '#a\n' }], { rules: ['tag-variant'], pages: ['x.md'], now: NOW }).summary, null)
  // ── 契约往返:带 summary 写→读→再写不丢;1.0.0 的旧 queue.json 按 v1 解析不抛 ──
  const rq = T14.normalizeQueue(JSON.parse(JSON.stringify(q14)))
  A.equal(rq.summary.kind, 'tag-op')
  A.deepEqual(rq.summary.forms, q14.summary.forms, 'summary 往返不丢')
  A.deepEqual(rq.summary.from, q14.summary.from)
  A.equal(T14.normalizeQueue({ scanId: 's-0', proposals: [], todos: [] }).summary, null, 'summary 缺席的旧队列按 null 解析,不抛')
  A.equal(T14.normalizeQueue({ summary: { kind: '打劫' }, proposals: [], todos: [] }).summary, null, '形状不对的 summary 一律归 null')
  e14.dispose()
}

// ══ ④l BRIEF 增量五第 9 项:v4 载体路由自检 ═════════════════════════════════
// 本插件是**文本层**插件(readFile / writeFile),v3/v4 载体对它透明 —— 这一项是**证明**,不是改造。
{
  const c15 = mkCtx({ pages: { '笔记/A.md': '#foo\n', 'Project X.md': 'p\n' } })
  const blockCalls = []
  let pageCalls = 0
  let tok = 0
  // 照抄 zotero check.mjs 的整套页表面 mock:令牌每次自增 + v4 页(model:'text',blocks/order 恒空)
  c15.app.getPage = () => { pageCalls++; return { token: `tok-${++tok}`, path: '笔记/A.md', status: 'ready', text: '#foo\n', model: 'text', blocks: {}, order: [], fmExtra: '' } }
  for (const k of ['insertBlockAfter', 'deleteBlock', 'mountBlocks', 'setFmExtra', 'requestFocus', 'undo', 'redo', 'insertMarkdown']) {
    c15.app[k] = (...a) => { blockCalls.push(k); return null }
  }
  const e15 = load(c15)
  await e15.T.runScan({ tagOp: { op: 'rename', from: 'foo', to: 'bar' } })
  const p15 = e15.T.state.queue.proposals[0]
  A.ok(p15, 'v4 页表面在场时扫描照常出提案')
  await e15.T.loadDiff(p15)
  A.equal((await e15.T.applyProposal(p15)).ok, true, 'v4 页表面在场时批准照常成功')
  A.equal(c15.vault.map.get('笔记/A.md'), '#bar\n', '改内容走的是 readFile/writeFile 文本层')
  A.equal(pageCalls, 0, 'getPage 一次都不许被调用(正文绝不从 page.blocks/order 拿)')
  A.deepEqual(blockCalls, [], '块寻址 API 一次都不许被调用')
  e15.dispose()
}
// 源码级:整份 main.js 里不出现块寻址的痕迹
A.ok(!/\.blocks\b/.test(src), 'main.js 不许读 page.blocks')
A.ok(!/\.order\b/.test(src), 'main.js 不许读 page.order')
A.ok(!/insertBlockAfter|mountBlocks|deleteBlock|setFmExtra|requestFocus/.test(src), 'main.js 不许调块寻址 API')
A.ok(!/getPage\s*\(/.test(src), '文本层插件不需要 getPage')

// ══ ④m BRIEF 增量五第 10 项:活动页写保护 ═══════════════════════════════════
// 目标文件正开在编辑器里时,writeFile 与「读全文→改→整篇写回」是同一张脸:我们写成功、读回一致、
// 台账记 applied,然后编辑器 ≤800ms 后的自动保存把整篇盖回去 —— 用户看到改动消失,台账却说成功。
{
  const c16 = mkCtx({ pages: { '笔记/A.md': '#foo\n', 'Project X.md': 'p\n' } })
  c16.app.getActivePage = () => '笔记/A.md'
  const e16 = load(c16)
  const T16 = e16.T
  await T16.runScan({ tagOp: { op: 'rename', from: 'foo', to: 'bar' } })
  const p16 = T16.state.queue.proposals.find((p) => p.path === '笔记/A.md')
  A.ok(p16, '扫描本身只读,活动页照扫')
  c16.vault.writes.length = 0
  const r16 = await T16.applyProposal(p16)
  A.equal(r16.ok, false, '活动页必须拒写')
  A.equal(r16.key, 'msgActivePage')
  A.equal(r16.vars.path, '笔记/A.md', '提示里带上是哪个文件')
  A.deepEqual(c16.vault.writes, [], '零写入:目标文件、.snap、ledger.json、queue.json 一个都不许写')
  A.equal(c16.vault.map.get('笔记/A.md'), '#foo\n', '文件逐字节不动')
  A.equal(p16.state, 'open', '提案保持待审 —— 用户关掉笔记回来还能再点(中途失败必须让下一轮还能重来)')
  A.equal(T16.state.ledger.entries.length, 0, '台账一条都不许加')
  // 回滚同样拒绝且零写入
  const fakeEntry = { op: 'op-x', at: NOW, scanId: 's-x', path: '笔记/A.md', rule: 'tag-op', preHash: 'h', postHash: T16.hashText('#foo\n'), snap: '库园丁/.gardener-undo/s-x/op-x.snap', status: 'applied', hits: 1 }
  c16.vault.map.set(fakeEntry.snap, '改前原文\n')
  T16.state.ledger.entries.push(fakeEntry)
  c16.vault.writes.length = 0
  const rb16 = await T16.rollbackOp(fakeEntry)
  A.equal(rb16.key, 'msgActivePage', '回滚也是整文件覆写,同样拒绝')
  A.deepEqual(c16.vault.writes, [], '拒绝回滚 = 零写入')
  A.equal(fakeEntry.status, 'applied', '台账那一条不许被改掉')
  // 写报告同样拒绝(上一份报告写完就被 openFile 打开了,它极可能正是活动页)
  const rp = T16.reportPath(T16.dayKey(NOW))
  c16.app.getActivePage = () => rp
  c16.vault.writes.length = 0
  await T16.writeReport()
  A.equal(T16.state.msg.key, 'msgActivePage', '报告目标正开着时拒绝写')
  A.deepEqual(c16.vault.writes, [], '拒绝写报告 = 零写入')
  // ── 反向:闸不许误伤 ──
  c16.app.getActivePage = () => '别的.md'
  const r16b = await T16.applyProposal(p16)
  A.equal(r16b.ok, true, `活动页是别的文件时必须照常写入,实得 ${JSON.stringify(r16b)}`)
  A.equal(c16.vault.map.get('笔记/A.md'), '#bar\n')
  c16.app.getActivePage = () => null
  await T16.writeReport()
  A.equal(T16.state.msg.key, 'reportOk', 'getActivePage 返回 null 时报告照写')
  e16.dispose()
}

// ══ ⑤ 16. 双语 ══════════════════════════════════════════════════════════════
{
  const zk = Object.keys(T.MSG.zh).sort()
  const ek = Object.keys(T.MSG.en).sort()
  A.deepEqual(ek, zk, '双语词表两侧键集合必须完全相等')
  A.ok(zk.length > 60, '词表条目数应覆盖全部 UI 串')
  for (const k of zk) {
    A.ok(String(T.MSG.zh[k]).length > 0, `zh.${k} 不能为空`)
    A.ok(String(T.MSG.en[k]).length > 0, `en.${k} 不能为空`)
    A.ok(!/[一-鿿]/.test(String(T.MSG.en[k])), `en.${k} 不许残留中文:${T.MSG.en[k]}`)
    // 纯占位符 / 纯符号的格式串(如 `{tag} × {n}`)两侧本来就该一样,其余一字不差 = 漏翻
    const bare = String(T.MSG.zh[k]).replace(/\{\w+\}/g, '').trim()
    if (/\p{L}/u.test(bare)) A.notEqual(String(T.MSG.en[k]), String(T.MSG.zh[k]), `en.${k} 与 zh.${k} 不该逐字相同(漏翻)`)
  }
  // 1.1.0 新增的 30 个键一个都不许漏
  for (const k of ['ruleTagOp', 'ruleTagOpDesc', 'tagOpTitle', 'tagOpModeRename', 'tagOpModeMerge', 'tagOpModeRestructure',
    'tagOpFrom', 'tagOpFromMulti', 'tagOpTo', 'tagOpChildren', 'tagOpChildrenHint', 'tagOpRun', 'tagOpSummary',
    'tagOpForms', 'tagOpForm', 'tagOpNoHit', 'tagOpDedupeNote', 'tagOpBodyDupNote', 'errTagEmpty', 'errTagSpace',
    'errTagHash', 'errTagSlash', 'errTagPunct', 'errTagDigits', 'errTagTail', 'errTagChar', 'errTagSame',
    'errTagRoundTrip', 'errTagNeedFrom', 'msgActivePage']) {
    A.ok(T.MSG.zh[k] && T.MSG.en[k], `1.1.0 新增的 ${k} 两侧都要有`)
  }
  // 占位符两侧一一对应
  for (const k of zk) {
    const zv = String(T.MSG.zh[k]).match(/\{\w+\}/g) || []
    const ev = String(T.MSG.en[k]).match(/\{\w+\}/g) || []
    A.deepEqual(ev.slice().sort(), zv.slice().sort(), `${k} 的占位符两侧必须一一对应`)
  }
  // ── 1.1.0:t() 的占位符替换必须**单趟**(标签字面从此会进 {from}/{to}/{tag}) ──
  // 多趟 split/join 下:先把 {op} 替成字面 `{snap}`,下一轮扫 {snap} 时会把它当占位符再吃一遍。
  const hard = T.tl('zh', 'msgFailedHardOp', { op: '{snap}', snap: 'S' })
  A.ok(hard.includes('{snap}'), '前一个占位符替进来的 `{snap}` 字面必须原样留着,不许被后一轮当占位符吃掉')
  A.equal((hard.match(/S/g) || []).length, 1, '单趟替换下 S 只应出现一次')
  const hardEn = T.tl('en', 'msgFailedHardOp', { op: '{snap}', snap: 'S' })
  A.ok(hardEn.includes('{snap}'), '英文侧同样单趟')
  A.equal(T.tl('zh', 'reportOk', { path: '$& $1 $$' }), T.MSG.zh.reportOk.replace('{path}', () => '$& $1 $$'), '值里的正则特殊字符按字面写入,不走 String.replace 的替换模式')
  A.ok(T.tl('zh', 'reportOk', { zzz: 1 }).includes('{path}'), '未知键的占位符原样保留')
  // mock ctx 切 en 后重渲,inbox 文本含英文串且不含中文标题串
  const c5 = mkCtx({ pages: {} })
  const e5 = load(c5)
  const host = mkEl('div')
  const cleanup = c5.reg.views[0].mount(host)
  const zhText = host.textContent
  A.ok(zhText.includes('库园丁'), '中文档 inbox 应含中文标题')
  A.ok(zhText.includes('扫描全库'), '中文档 inbox 应含扫描按钮')
  c5.locale = 'en'
  A.equal(typeof c5.localeCb, 'function', '插件必须订阅 subscribeLocale')
  c5.localeCb('en')
  const enText = host.textContent
  A.ok(enText.includes('Vault Gardener'), '切 en 后应出现英文串')
  A.ok(enText.includes('Scan vault'), '切 en 后按钮文案应变')
  A.ok(!enText.includes('库园丁'), '切 en 后不许残留中文标题串')
  A.ok(!enText.includes('扫描全库'), '切 en 后不许残留中文按钮串')
  A.equal(c5.reg.status[0].text.includes('Gardener'), true, '状态栏文本应经 handle.update 就地改成英文')
  // 三个视图都能挂,且都跟语言走
  const h2 = mkEl('div')
  const h3 = mkEl('div')
  const cl2 = c5.reg.views[1].mount(h2)
  const cl3 = c5.reg.views[2].mount(h3)
  A.ok(h2.textContent.includes('Diff'), 'diff 视图英文')
  A.ok(h3.textContent.includes('journal') || h3.textContent.includes('Undo'), 'history 视图英文')
  c5.locale = 'zh'
  c5.localeCb('zh')
  A.ok(h2.textContent.includes('对照'), '切回中文后 diff 视图跟着变')
  cleanup()
  cl2()
  cl3()
  e5.dispose()
}

// ══ ⑥ 17. 旧宿主 ctx(07-18 之后与 08-14 新增的面全删) ═══════════════════════
{
  const V = new Map()
  const legacyCtx = {
    registerView: () => {}, registerCommand: () => {}, registerSetting: () => {},
    app: {
      notify() {}, readFile: async (p) => (V.has(p) ? V.get(p) : null), writeFile: async (p, t) => { V.set(p, t) },
      getActivePage: () => null, loadPage() {}, createPage() {}, toggleMode() {}, setTheme() {}, openSearch() {}, openSwitcher() {}, openFile() {},
    },
  }
  const views = []
  legacyCtx.registerView = (v) => views.push(v)
  globalThis.__VAULT_GARDENER_TEST__ = {}
  let disp = null
  A.doesNotThrow(() => { disp = new Function('ctx', src)(legacyCtx) }, '旧宿主 ctx 下 setup 绝不能抛')
  const LT = globalThis.__VAULT_GARDENER_TEST__
  A.equal(LT.wfRoot(), '库园丁', '缺 workFolder 时回退到中文默认名')
  A.equal(LT.t('inboxTitle'), '库园丁', '缺 getLocale 时回退中文')
  A.equal((await LT.seamState()).state, 'noSeam', '缺 listPages → noSeam')
  for (const v of views) {
    const host = mkEl('div')
    let cl = null
    A.doesNotThrow(() => { cl = v.mount(host) }, `旧宿主下 ${v.id} 视图 mount 不能抛`)
    A.ok(host.textContent.length > 0, `旧宿主下 ${v.id} 视图仍要有可见内容`)
    if (typeof cl === 'function') cl()
  }
  A.equal(typeof disp, 'function')
  // 更旧的宿主连 getActivePage 都没有:活动页闸必须整条降级成「不拦」(与 1.0.0 行为相同),且不抛
  A.equal(LT.activePagePath(), null, '缺 getActivePage → 恒 null')
  A.equal(LT.blockedByActivePage('a.md'), false, '缺 getActivePage → 一律不拦')
  A.doesNotThrow(() => disp(), '旧宿主下 dispose 不能抛')
}
{
  const V2 = new Map([['a.md', '#foo\n']])
  const barebones = {
    registerView: () => {}, registerCommand: () => {}, registerSetting: () => {},
    app: { notify() {}, readFile: async (p) => (V2.has(p) ? V2.get(p) : null), writeFile: async (p, t) => { V2.set(p, t) } },
  }
  globalThis.__VAULT_GARDENER_TEST__ = {}
  let d2 = null
  A.doesNotThrow(() => { d2 = new Function('ctx', src)(barebones) }, 'getActivePage 完全缺席的宿主下 setup 不能抛')
  const BT = globalThis.__VAULT_GARDENER_TEST__
  const prop = { id: 'op-z', producer: 'rule', rule: 'tag-op', path: 'a.md', preHash: BT.hashText('#foo\n'), params: { op: 'rename', from: 'foo', to: 'bar' }, hits: [], state: 'open', createdAt: NOW }
  const rr = await BT.applyProposal(prop)
  A.equal(rr.ok, true, `getActivePage 缺席时批准必须照常成功,实得 ${JSON.stringify(rr)}`)
  A.equal(V2.get('a.md'), '#bar\n', '闸缺席 = 不拦,写入照常')
  d2()
}

// ══ ⑦ 18. XSS ═══════════════════════════════════════════════════════════════
{
  const evil = '<img src=x onerror=alert(1)> [[a]](javascript:evil) <script>bad()</script>'
  const box = mkEl('div')
  T.renderDiffInto(box, T.diffLines('', evil))
  A.equal(findAll(box, 'img').length, 0, '绝不能创建 img 元素')
  A.equal(findAll(box, 'script').length, 0, '绝不能创建 script 元素')
  A.equal(findAll(box, 'a').length, 0, '绝不能创建 a 元素')
  A.equal(anyAttr(box, 'onerror'), false, '绝不能设 onerror 属性')
  A.equal(anyAttr(box, 'href'), false, '绝不能设 href 属性')
  A.ok(box.textContent.includes('<img'), '字面文字完整保留')
  A.ok(box.textContent.includes('onerror'))
  A.ok(box.textContent.includes('javascript:evil'))
}

// ══ ⑦b 承载内容的那几个类的对比度(真机门禁量不到) ═══════════════════════════
// ⚠️`plugin-view.e2e.cjs` 的对比度探针只跑到 **inbox 空态** —— 真正承载内容的 `.vg-dline.add|del`
// (color-mix 半透明叠加底)、`.vg-note.bad`(--danger 描边 + 同色字 + 透明底)、`.vg-tag`
// (--text-muted on --accent-light)深浅两档都没被量过。这里用宿主主题的真值离线复算一遍。
// 真源 = `Forsion-Genesis/desktop/frontend/src/styles/base.css`(2026-08-14 实测值);它变了这里要跟。
{
  const hx = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) }
  const C = (h, a = 1) => { const [r, g, b] = hx(h); return { r, g, b, a } }
  const RGBA = (r, g, b, a) => ({ r, g, b, a })
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const mix16 = (c, bg) => over({ ...c, a: 0.16 }, bg) // color-mix(in srgb, X 16%, transparent) 叠在页面底上
  const THEMES = {
    浅色: { bg: C('#f8f7f6'), bgCard: C('#fdfdfc'), text: C('#1c1c1c'), textLight: RGBA(28, 28, 28, 0.82), textMuted: C('#5f5f5d'), green: C('#4f6f52'), danger: C('#a3503f'), accentLight: RGBA(28, 28, 28, 0.05) },
    深色: { bg: C('#2a292b'), bgCard: C('#353538'), text: C('#f2efe8'), textLight: RGBA(242, 239, 232, 0.82), textMuted: C('#a8a096'), green: C('#8fb295'), danger: C('#d99080'), accentLight: RGBA(248, 247, 246, 0.16) },
  }
  for (const [mode, t] of Object.entries(THEMES)) {
    const addBg = mix16(t.green, t.bg)
    const delBg = mix16(t.danger, t.bg)
    const cases = [
      ['.vg-dline.add .vg-dtext', t.text, addBg], ['.vg-dline.del .vg-dtext', t.text, delBg],
      ['.vg-dline.add .vg-dsign', t.green, addBg], ['.vg-dline.del .vg-dsign', t.danger, delBg],
      ['.vg-dno', t.textMuted, addBg], ['.vg-note.bad', t.danger, t.bg],
      ['.vg-tag', t.textMuted, over(t.accentLight, t.bg)], ['.vg-path', t.text, t.bgCard],
      ['.vg-snap', t.text, t.bgCard], ['.vg-mut', t.textMuted, t.bgCard], ['.vg-btn', t.textLight, t.bgCard],
      ['.vg-in', t.text, t.bg], ['.vg-ck', t.textLight, t.bgCard], ['.vg-chip', t.textMuted, t.bgCard],
    ]
    for (const [name, fg, bg] of cases) {
      const r = ratio(over(fg, bg), bg)
      A.ok(r >= 2.5, `${mode}下 ${name} 对比度 ${r.toFixed(2)} 低于门禁线 2.5`)
    }
  }
}

// ══ ⑧ 19. 时间 ══════════════════════════════════════════════════════════════
{
  // ⚠️别写 `A.equal(T.fmtDate(NOW), T.fmtDate(NOW))` —— 同一函数同一入参自比是**恒真断言**,
  //   换个实现照样绿。断言实际值(zh 档 = YYYY/M/D),期望值从 dayKey 推,四个时区各自成立。
  const dk = T.dayKey(NOW).split('-')
  A.equal(T.fmtDate(NOW), `${Number(dk[0])}/${Number(dk[1])}/${Number(dk[2])}`, `冻钟下 zh 档 fmtDate 必须是 YYYY/M/D 实际值(${process.env.VG_TZ})`)
  A.equal(T.fmtTime(NOW).length, 5, 'fmtTime 是零填充的 HH:MM')
  A.equal(T.dayKey(NOW), T.dayKey(NOW + 1000), '同一天的两个时刻日键相同')
  // 逐日推进 400 天(正午锚定)不跳日、不重复
  const seen = new Set()
  let cur = Date.parse('2025-12-31T12:00:00.000Z')
  for (let i = 0; i < 400; i++) {
    const k = T.dayKey(cur)
    A.ok(!seen.has(k), `日键 ${k} 在 ${process.env.VG_TZ} 下重复了`)
    seen.add(k)
    const d = new Date(cur)
    d.setHours(12, 0, 0, 0)
    cur = d.getTime() + 86400000
  }
  A.equal(seen.size, 400, '400 天应得 400 个互不相同的日键')
  // 跨年向量
  const y1 = Date.parse('2025-12-31T12:00:00.000Z')
  const y2 = Date.parse('2026-01-01T12:00:00.000Z')
  A.notEqual(T.dayKey(y1), T.dayKey(y2), '跨年两天必须分到不同组')
  A.ok(T.dayKey(y2) > T.dayKey(y1), '跨年日键仍可字典序排序')
}

// ══ ⑨ 22. 源码级红线 ════════════════════════════════════════════════════════
A.ok(!/^\s*(import|export)\s/m.test(src), 'main.js 不许有顶层 import/export(裸 setup 体)')
A.ok(!/#fff/i.test(src), '不许写死 #fff')
A.ok(!/color:\s*#/.test(src), '不许写死前景/背景 hex,一律 var(--token, 回退)')
A.ok(!/setInterval/.test(src), '轮询一律 setTimeout 自排程')
A.ok(!/Math\.random/.test(src), 'id 必须在冻钟下可复现,不许 Math.random')
A.ok(!/crypto\.randomUUID/.test(src), '同上,不许 crypto.randomUUID')
A.ok(!/innerHTML/.test(src), '全文件零 innerHTML')
A.ok(/var\(--on-accent/.test(src), '强调色上的字必须走 var(--on-accent)')
A.ok(!/--text-faint|--text-ghost/.test(src), '承载文字的元素禁用 --text-faint / --text-ghost')
A.ok(/registerView\(\{ id: 'inbox'/.test(src), "registerView 的 id 必须是对象字面量第一个键(verify-all 的 Space 校验按这个抠)")
// ASI 陷阱:无分号风格下,以 ( 或 [ 开头的行会粘到上一句尾部当调用/下标
const lines = src.split('\n')
const asi = [...lines.keys()].filter((i) => {
  if (!/^\s*[([]/.test(lines[i])) return false
  let p = i - 1
  while (p >= 0 && !lines[p].trim()) p--
  return p >= 0 && /[)\]'"`\w]\s*$/.test(lines[p])
}).map((i) => i + 1)
A.equal(asi.length, 0, `以 ( [ 开头的行会被 ASI 粘到上一句:第 ${asi.join(',')} 行`)

Date.now = realNow
dispose()
console.log(`check ok [TZ=${process.env.VG_TZ}] — 3 views / 2 cmds / 4 settings / 1 status / 1 series;写入协议三假设 + 回滚守卫 + 三态接缝 + 双语 + 旧宿主 + XSS + 时间 + 标签操作边界向量 + v4 路由自检 + 活动页写保护 断言通过`)
