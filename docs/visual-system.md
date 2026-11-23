# 视觉系统

本文件是视觉刻度的真值说明：字号、行高、间距、控件高度、圆角、图标与动效各有哪些档，
为什么是这些档，以及新样式怎么落进来。**布局**（列宽、档位、抽屉、层级）的真值在
`docs/layout.md`；界面语言与交互在 `docs/ui_design_specification.md`；本文件只管"一个数该
从哪儿取"。口径冲突时以本文为准，并在同一分支把设计稿对齐。

代码里的两份真值：

| 导出 | 位置 | 装什么 |
| :--- | :--- | :--- |
| `VISUAL_SCALE` | `packages/ui/src/styles/visual-contract.ts` | 刻度：字号、行高、间距、控件高度、圆角、图标、动效 |
| `VISUAL_PX` | 同上 | 具名长度：正文列宽、对话导航竖轨、浮层落点、编辑器标题行间距 |
| `theme.css` | `packages/ui/src/styles/theme.css` | 颜色：六套配色的同一组语义键，外加阴影、遮罩与选区 |

样式表那头的对应物是 `packages/ui/src/styles/base.css` 的 `:root`（`--text-*` /
`--leading-*` / `--space-*` / `--control-*` / `--radius-*` / `--icon-*` / `--dur-*` /
`--ease-standard`）。两边由 `packages/ui/src/styles/visual-contract.test.ts` 读源码逐条比对，
改一处不改另一处就红——与 `layout/layout-contract.ts` 同一套做法。

## 1. 刻度

### 1.1 字号（6 档）

| 变量 | 值 | 用途 |
| :--- | ---: | :--- |
| `--text-xs` | `12px` | 辅助信息、元数据、徽标、代码 |
| `--text-ui` | `13px` | 界面外壳：按钮、侧栏行、标签、表头、表单 |
| `--text-body` | `14px` | 内容正文：对话消息、描述、输入区 |
| `--text-title-sm` | `16px` | 小标题、弹窗标题 |
| `--text-title-md` | `20px` | 设置页与区块标题 |
| `--text-title-lg` | `26px` | 主展示标题（空态等） |

取代原先的 9.5 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 15 / 16 / 17 / 20px 一串半档。

正文只有一个入口：`--text-size` 指向 `--text-body`，对话正文、用户气泡与 Markdown 都读它，
整体大小仍由窗口缩放控制。

### 1.2 行高（4 档）

| 变量 | 值 | 用途 |
| :--- | ---: | :--- |
| `--leading-tight` | `16px` | 紧凑计数、脚注 |
| `--leading-ui` | `20px` | 控件、菜单、侧栏、普通正文 |
| `--leading-prose` | `24px` | Markdown 长文阅读区 |
| `--leading-display` | `32px` | 主标题 |

行高给 px 而不是倍数：13px 的字与 14px 的字落在同一条 20px 基线上，同一行里的控件才等高。

**代码区是唯一例外**：`--leading-code-block`（`1.6667`）与 `--text-code-inline`（`0.9285em`）
是比例值。等宽字体在小字号下需要比正文松一点，又必须跟着用户改的编辑器字号一起缩放——写死
像素会让大字号下的代码挤成一片。围栏代码块、Mermaid 源码、Diff 代码区与输入区代码块共用它们，
缩进宽度统一 `tab-size: 4`。

### 1.3 间距（10 档，4px 网格）

`--space-1` `2` · `--space-2` `4` · `--space-3` `6` · `--space-4` `8` · `--space-5` `10` ·
`--space-6` `12` · `--space-8` `16` · `--space-10` `20` · `--space-12` `24` · `--space-16` `32`（px）。

2 / 6 / 10 是半步：2px 只用于紧邻列表项与页签间隙；6px 与 10px 只用于控件内边距，用来凑出
28px 与 32px 的整数高度。

### 1.4 控件高度（4 档）

| 变量 | 值 | 用途 |
| :--- | ---: | :--- |
| `--control-xs` | `24px` | 迷你图标按钮、极紧凑文件树行 |
| `--control-sm` | `28px` | IDE 主力：工具条按钮、图标按钮、侧栏与菜单行 |
| `--control-md` | `32px` | 表单主按钮、输入框、对话框按钮 |
| `--control-lg` | `40px` | 大号按钮、区块标题行 |

高度由 20px 行高加两倍纵向内边距与两倍边框推出来，所以纵向内边距只有 2 / 4 / 6px 三种取法；
高度写死、内边距另编一套会把行内元素顶歪。

### 1.5 圆角（5 档）

| 变量 | 值 | 用途 |
| :--- | ---: | :--- |
| `--radius-sm` | `4px` | 菜单项、小标签、行内高亮 |
| `--radius-md` | `6px` | 按钮、输入框、代码块、侧栏行 |
| `--radius-lg` | `8px` | 卡片、内联表单、大号按钮、工具提示 |
| `--radius-xl` | `12px` | 菜单容器、输入区、搜索层、对话框 |
| `--radius-pill` | `999px` | 胶囊徽标、圆点 |

### 1.6 图标（3 档）

`--icon-sm` `12px`（徽标、行内状态点）· `--icon-md` `14px`（侧栏、密集工具条）·
`--icon-lg` `16px`（标准 28 / 32px 图标按钮）。

### 1.7 动效

时长按"变了什么"分四档，曲线按方向分五条：

| 变量 | 值 | 用途 |
| :--- | :--- | :--- |
| `--dur-fast` | `120ms` | 颜色、透明度这类极快反馈 |
| `--dur-slow` | `180ms` | 展开、折叠、位移 |
| `--dur-enter` | `220ms` | 弹层、对话框的进出场 |
| `--dur-structural` | `320ms` | 折叠区、面板展开收起这类结构性变化 |
| `--ease-standard` | `cubic-bezier(0.2, 0.6, 0.3, 1)` | 通用：两头都收，位移或位移叠透明度 |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | 出现：纯减速，起手快、落点稳 |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | 退场：纯加速，离开要干脆 |
| `--ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | 弹层进场：前段极快、后段长尾 |
| `--ease-panel` | `cubic-bezier(0.65, 0, 0.35, 1)` | 面板展开收起：对称缓入缓出 |

时长只认这四个变量、曲线只认这五条，别处不写裸值——`transition` 的写死值由门禁盯着。

**减少动效**：`data-motion="reduced"` 与 `prefers-reduced-motion: reduce` 都把四档时长清零，
曲线不动（曲线只决定形状，不产生时长）。

**拖拽冻结**：拖窗口边缘或拖分栏期间，根节点上挂 `data-window-resizing`，四档时长同样清零。
窗口那侧由外壳的 `useWindowResizeFreeze` 管（最后一次 `resize` 之后 150ms 摘掉），分栏那侧
由 `PaneResizer` 在 `pointerdown` / `pointerup` 之间挂上。冻结走的是同一套变量，不需要一条
`!important`，也不用遍历 DOM 打补丁。

**弹层进场只动 `transform`**：顶层元素（原生 `<dialog>` 走 Top Layer）在无合成器的环境里动画
时间线不推进，起始帧会原地冻住；若起始帧里带 `opacity: 0`，弹层就一直是透明的。所以进场用
一次性 `animation`（不带 `fill-mode`，播完回自然值）且只动缩放位移，最坏情况是位置差 6px。

## 2. 颜色与主题

颜色只有一份真值：`theme.css` 里六套配色（`light` / `dark` / `midnight` / `claude` / `ghostty` /
`pureBlack`）填满**同一组语义键**。组件读名字，不读具体色值；换主题只换取值。

变量按角色分组，不按颜色分组——这就是"语义化主题层"的全部意思：

| 组 | 变量 | 用法 |
| :--- | :--- | :--- |
| 表面海拔 | `--bg-canvas` `--bg-subtle` `--bg-surface` `--bg-elevated` | 从最底的工作台到浮在最上的弹层；`elevated` 必须不透明 |
| 交互态 | `--bg-hover` `--bg-active` | 全仓只有这两个交互底色，由各主题自己的 `--fg-default` 按 7% / 14% 混出 |
| 前景 | `--fg-default` `--fg-muted` `--fg-subtle` | 三档文字 |
| 边框 | `--border-subtle` `--border-default` `--border-focus` | 结构线、控件边框、焦点环 |
| 语义 | `--accent-*` `--status-*` `--dot-*` `--diff-*` `--code-*` | 强调、状态、差异、代码区 |
| 阴影与遮罩 | `--shadow-control` `--shadow-popover` `--shadow-modal` `--scrim-bg` `--selection-bg` | 明暗分治，组件不写 alpha |

几条硬规矩：

- **主按钮只有一个底色**：`--accent-fill` 配 `--accent-on-fill`。悬停与按下走
  `--accent-fill-hover` / `--accent-fill-active`（按各主题自身色相混出），不写 `filter`、
  不用 `opacity` 临时提亮，也不拿 `--fg-default` 反色当主按钮。
- **选中态只有一个底色**：`--bg-active`。侧栏选中行、设置导航、工具条 `is-on`、标签页当前项
  都是同一个值，不再各调一档。
- **阴影只有三档**：内容卡片 `--shadow-control`、浮层 `--shadow-popover`、模态 `--shadow-modal`。
  组件里不写 `box-shadow` 的字面量。
- **浮层的轮廓只有一圈**：带 `--shadow-popover` / `--shadow-modal` 的浮层由阴影里那条
  `0 0 0 1px` 环提供 1px 轮廓，规则里不再额外写 `border`——两者都画会叠成 2px，深色主题下
  还是同色双圈。需要单边状态条（`.toast` 的 3px 左条）时只写那一边。
- **焦点环画在盒子内侧**：`outline: 2px solid var(--border-focus)` 配 `outline-offset: -2px`
  （输入类控件 `-1px`）。向外扩会挤动相邻元素、贴边时溢出容器。

- 六套配色的键集完全一致（`theme.test.ts`）。
- `theme.css` 里每个变量在全仓至少有一处引用，没人读的色彩变量等于一份要一直维护的死配置（`theme.test.ts`）。
- `theme.css` 与泳道色（`git-graph.css`）之外不许出现裸颜色字面量：`#hex` / `rgb()` / `hsl()`
  （`visual-contract.test.ts`）。豁免逐条写在测试里——遮罩只取 alpha、"跟随系统"色片要两种底色
  同屏、贴在图片上的移除按钮必须一直是深色。

## 3. 控件原语

五个原语在 `packages/ui/src/common/`，外观在 `styles/primitives.css`（`index.css` 里紧跟
`base.css`、排在所有业务样式表之前），样式与类型从 `@facet/ui/primitives` 一起出去。

原语只决定"哪一种、多大"，用 `data-*` 属性表达；业务层要的外边距、定位、领域配色用同优先级的
类盖上去即可——`primitives.css` 排在最前，后面的规则天然赢，不需要 `!important`。

| 原语 | 维度 | 取值 |
| :--- | :--- | :--- |
| `Button` | `variant` | `primary`（`--accent-fill` 三态 + `--accent-on-fill`）、`secondary`（描边 + `--bg-hover`）、`ghost`（无边框，`--fg-muted`）、`danger`（`--status-err-fg`）；`armed` 表示两步确认的第一步 |
| | `size` | `sm` 28 / `md` 32 / `lg` 40（`--control-*`） |
| `IconButton` | `variant` | `ghost` / `outline` / `primary`；`active` 走 `--bg-active` |
| | `size` | `xs` 24 / `sm` 28 / `md` 32；`radius="lg"` 单独放宽圆角（输入区的发送按钮） |
| `Input` | `variant` | `default`（`--bg-elevated` + `--border-default`）/ `ghost`（无边框，嵌在带框容器里） |
| | `size` | `sm` 28 / `md` 32 / `lg` 40；`invalid` 转错误色并带 `aria-invalid` |
| `ListRow` | `as` | `div`（展示）/ `button`（可点，自动 `type="button"`）/ `li` |
| | `size` | `xs` 24 / `sm` 28 / `md` 32 |
| | `variant` | `list`（`--radius-md`）/ `menu`（`--radius-sm`）；`selected` / `active` 走 `--bg-active`，`interactive={false}` 不给悬停 |
| `Badge` | `variant` | `neutral` / `accent` / `ok` / `warn` / `err` |
| | `shape` | `pill`（`--radius-pill`）/ `tag`（`--radius-sm` + 描边）；字号固定 `--text-xs` |

几条边界：

- **不纳入原语**：多行富文本输入区 `.composer`（Lexical 有自己的编辑语义与滚动规则）、快捷键
  `.kbd`、输入区胶囊 `.chip`、Git 图谱的引用 `.ref`——它们各自是一件事，塞进通用件反而要开
  一堆口子。
- **不在原语里写死间距**：外边距一律留在业务样式表。原语只管自身的内边距、行高与圆角。
- **禁用态**：底色 `--bg-active`、文字 `--fg-subtle`、不再有任何悬停反馈；幽灵按钮保持透明，
  只压暗文字。
- **可访问名**：`IconButton` 要求 `aria-label` / `aria-labelledby` / `title` 至少一个，漏写在
  编译期就红；`Button` 与 `ListRow`（`as="button"`）缺省 `type="button"`，不会误提交表单。

即将来加一个控件，先问三句：它是按钮、输入、行还是徽标？几何上能不能只用 `--control-*` 与
`--radius-*` 表达？业务差异是不是只有外边距与颜色？三句都"是"就用原语，否则先在原语里加一个
维度，而不是在业务样式表里重写一遍几何。

## 4. 配套基准

- **零字距微调**：层级靠字号与字重（`400 / 500 / 600`）拉开，不写 `letter-spacing`。
- **单向下边距**：正文与 Markdown 区块只用 `margin-bottom`，首尾由
  `> :first-child { margin-top: 0 }` 与 `> :last-child { margin-bottom: 0 }` 归零。
- **一个数一处定义**：脚本要读的长度进 `VISUAL_PX`，样式要用的进 `:root`，两边同名同值；
  不许在组件里再抄一份字面量。

## 5. 门禁

`visual-contract.test.ts` 跑六类断言：

1. **刻度对齐**：`base.css` 的 `:root` 与 `VISUAL_SCALE` / `VISUAL_PX` 逐条相等。
2. **纪律**：全仓样式表 `0` 处 `!important`、`0` 处裸 `z-index`、`0` 处 `prefers-*` 之外的
   `@media`。
3. **颜色只从主题来**：`theme.css` 与泳道色之外不许有裸颜色字面量，豁免逐条写在测试里。
4. **零债**：全仓每个样式文件的 `font-size` / `border-radius` / `gap` / `padding` /
   `box-shadow` / `transition` 都断言为 `0`——没有基线表，也没有豁免表，新加的文件从第一天
   起就按同一把尺子量。另有一条防呆：用一段已知的坏样式喂给计数器，它必须先数出 4，证明这个
   "全仓为 0" 不是计量器失灵换来的。
5. **单入口**：旧名 `--ease` 不再出现，`--text-size` 只指向 `--text-body`。
6. **图标**：全局 `svg` 规则里没有描边宽度，宽度只在 `.lucide` / `.ui-icon` 上按
   `--icon-stroke-width` 落地；TSX 里不再写 `strokeWidth=`，`size` 只从 `ICON_SIZE` 的三档取，
   也没有绕开样式表的内联 `fontSize`。

计数口径（一条声明算不算写死）：

- 声明里有 `var()`，就不算：`var(--text-xs)` 与 `calc(var(--a) - 1px)` 都算走变量。边框折叠
  的 `-1px`、图标基线的 `-2px` 这类结构性微调本来就是 `calc(...)`，不会被误伤。
- 全零复位（`padding: 0`）不算：它没引入数值。
- 只写相对单位的字号（`1.6em` 标题、`0.8em` 行内代码）不算：它跟着父级缩放，换成固定档位
  反而丢掉这层关系。
- `transition` 另算——抹掉 `var(...)` 之后还剩时间字面量或缓动关键字才算。

## 6. 滚动与折叠

**滚动容器**：`.scroll-y` / `.scroll-x` / `.scroll-both` 三件套管行为，`--scrollbar-width` 由
滚动条统一给。`.scroll` 另行显式声明 `scroll-behavior: auto`（交给原生惯性）与
`overflow-anchor: none`（吸底由脚本按 `scrollTop` 管，不要让浏览器自己锚定）；`html, body`
用 `overscroll-behavior-y: none` 关掉整窗回弹。

**聊天轨道**：消息列与输入区共用 `.chat-grid` 的三列非对称网格——`minmax(--chat-gutter-min, 1fr)`
+ `minmax(0, --chat-column-max)` + `minmax(--outline-slot, 1fr)`。右轨锁住导航轨的占位宽
（`--outline-slot` 由已缩放的轨宽拼出来），左轨退到 `--chat-gutter-min`，中间那列上界是阅读
上限（`840px`）、下限是 `0`；宽屏时左右等宽、正文居中，窄屏时正文自己收，**与导航轨在数学上
不可能重叠**。内容一律 `grid-column: 2` 且 `min-width: 0`：宽代码块、长 URL、Mermaid 图与
表格只在各自容器里横滚，不会顶进右轨。没有导航内容时（`data-outline-active="false"`）右轨
退回最小留白，左右对称。

**无滚动条**：聊天主滚动区用 `.scroll-y-hidden`（`scrollbar-width: none` + `::-webkit-scrollbar
{ display: none }`），横向留白交给网格而不是滚动条沟槽。`.scroll-y` 对其余区域的行为一字未改。

正文（与输入框）到**窗口左缘与右缘的间距恒等**，导航轨落在右侧那段留白里：

| 主区宽 | 左留白 | 正文 | 右留白 | 导航轨 |
| ---: | ---: | ---: | ---: | :--- |
| `1270` | `215` | `840` | `215` | 右留白远端（`1226–1262`） |
| `1000` | `80` | `840` | `80` | 右留白远端（`956–992`） |
| `880` | `52` | `776` | `52` | 右留白远端（`836–872`） |
| `520` | `52` | `416` | `52` | 右留白远端（`476–512`） |
| `1400`（`--outline-scale: 2`） | `280` | `840` | `280` | 右留白远端（右轨 `88` 仍在 280 内） |

**聊天视口**：`.chat-viewport` 包住滚动区，上下各一层 40px 的渐隐（`--z-content`、不接指针），
按 `data-can-scroll-top` / `data-can-scroll-bottom` 淡入——滚到头就收掉，静止时不凭空压暗一条。
输入区上方另有一条六阶渐变（`.footer::before`，全部由 `color-mix` 从 `--bg-canvas` 派生），
消息滚到输入区边缘不再是一条硬切线。它永远可见，所以滚动区的下内边距取
`--transcript-bottom-clearance`（= 过渡带高度 + 一档呼吸）：滚到最底时最后一行连同它的
复制 / 回退 / 分叉都落在带子上面，不会被渐变压住。

**消息行**：面板按行虚拟化（`@tanstack/react-virtual`，接线在
`transcript/use-virtual-transcript.ts`）：只挂视口附近的行，滚出去的收掉，行的位置由
`.column.chat-grid` 的正常流加前后留白撑出来（`transcript/virtual-anchor.ts`），三列轨道与
`row-gap` 原样保留——MUST NOT 改用 `position: absolute`，那会同时丢掉列宽、行距，还给行内浮层
造出新的层叠上下文。行距与列表起点这两个数由 `virtual-layout.test.ts` 盯住 `.column` 的
`row-gap` 与 `.scroll` 的上内边距。行上 MUST NOT 再写 `content-visibility`：占位高度与虚拟坐标
会打架。

虚拟化带走的原生能力有两条，都是明写的取舍：**页内查找**（`Ctrl+F`）只覆盖当前挂载的行，
收起体照旧靠 `hidden="until-found"` 在命中时展开；**拖选跨行**由 `use-selection-pin.ts` 把选区
端点之间的行钉在 DOM 里（`MAX_SELECTION_PIN_SPAN`，上限 60 行，再长只钉两端），否则选区会在
行被卸载处断掉。「引用」因此照常可用。用户在落位之前自己滚动（滚轮、触摸、翻页键）或点了导航轨，
挂着的恢复与正在进行的落位校准都会立刻让路；恢复的目标行已经不在窗口里（被裁掉或换了标识）时，
面板回到底部而不是停在一个既不是原位置、也不是最近内容的地方。

**竖轨跳转与「回到底部」走同一套 rAF 曲线**（`transcript/scroll-motion.ts` 出数学，
`scroll-driver.ts` 出帧循环）：落点是按估高算的，交给浏览器的 `behavior: "smooth"` 会边滚边改
目标，看起来就是「一边加载一边抖」。距离不到一个半视口时一次 `easeOutCubic`（260ms）到位；
更远则拆三段——起步 70ms 朝目标挪 56px（不牵连大量新行挂载）、瞬移到落点来向侧 260px、
再缓入 270ms 落地。缓入段每帧按 35% 的比例追最新目标（走到 85% 时直接对齐），台阶式的高度
回填因此被摊成几帧，不会在单帧上折一下。曲线期间虚拟化器的尺寸补偿会停手，位置只由曲线决定，
两边不会抢同一帧。竖轨判「当前轮次」的阈值（`ACTIVE_OFFSET`）与跳转留白同值，点第 N 项停稳后
高亮的正是第 N 项。目标坐标每帧重读，瞬移后头一两帧测量出来的估算残差就在减速段里吸收掉，
停稳后不再补跳。目标行一挂载就按它的**真实矩形**算落点，所以跳过去的消息顶边正好停在顶部渐隐
（`--control-lg`，`JUMP_LEAD` 与它同值）的下边缘，不会被那层渐暗压住。系统要求
`prefers-reduced-motion: reduce` 时退回一步落位。鼠标滚轮与触控板的惯性是浏览器自己的，不受
影响；任何滚轮、触摸、指针按下或翻页键都会**当场**取消曲线。

**代码高亮排期**：围栏代码块先出纯文本，分词（`markdown/highlighter.ts`）排进空闲时间，
一次空闲只跑一块（`markdown/highlight-queue.ts`）。跳到一个没去过的地方时，落点那一窗的代码卡
会一起挂载，同步分词正好压在最卡的那一帧上；排期之后颜色晚几帧到，但那一帧不再被按住。
内容变了（流式追加）、配色变了或组件卸载时，排着的那一块会被取消并从队列里摘掉。

**滚动监听**一律显式声明 `passive`：不要 `preventDefault()` 的写 `true`，真要拦的（Mermaid 图
的 Ctrl+滚轮缩放）写 `false`，漏写由 `visual-contract.test.ts` 拦下。

**折叠体**：思考、工具输出与过程组收起时留在 DOM 里并标 `hidden="until-found"`，浏览器页内
查找（`Ctrl+F`）命中时派 `beforematch`，我们据此展开。属性在 `useLayoutEffect` 里
`setAttribute` 写入——React 把 `hidden` 当布尔属性，传字符串只会得到 `hidden=""`（那是
`display: none`，正好把查找也关掉）。收起态由尺寸包含压到零高，边框与内边距另有一条规则收掉。
展开箭头是一枚 chevron 转 90°（`--dur-slow` + `--ease-out`），与折叠体同一个节拍。

## 7. 滚动条

滚动条是全仓唯一一处"同一个外观要落到一堆动不了的容器上"的地方：`.scroll-y` / `.scroll-x` /
`.scroll-both` 是我们自己的容器，CodeMirror 的 `.cm-scroller`、xterm 的 `.xterm-viewport`、
markstream 里画表格与代码块的节点是第三方的，DOM 不在手里，只能按类名字符串挑出来。

于是容器清单只写一遍，六条伪元素（`::-webkit-scrollbar`、`-button`、`-track`、`-corner`、
`-thumb`、`-thumb:hover`）连同"没有伪元素的引擎"那条 `@supports not` 兜底，一起嵌套在同一个
`:where(...)` 里。改清单就是改一处；拆成六段重复的选择器链既难对齐，漏一处也没有任何提示。

`--scrollbar-width` 参与三处计算：伪元素的宽高、拇指的内缩边框（`(width - thumb) / 2`），
以及 `.scroll-row` 的右内边距——所以它必须等于实际画出来的宽度，这也是这里不用标准
`scrollbar-width`（只有三档、画不出圆角拇指）而用伪元素的原因。

## 8. 迁移状态

四轮迁移已全部落地，全仓几何零存量：

| 轮次 | 范围 | 结果 |
| :--- | :--- | :--- |
| 1 | 刻度契约与纪律门禁 | 六档字号、四档行高、十档间距、四档控件高度、五档圆角、三档图标进 `:root`，与 `visual-contract.ts` 互为真值 |
| 2 | 颜色语义化 | `theme.css` 重写为 38 个角色键 × 6 套配色；阴影收成三档；焦点环画在盒子内侧；13 个死 token 删除 |
| 3 | 控件原语与图标真值 | 五个原语接管按钮、图标按钮、输入框、列表行与徽标；图标尺寸收到 `12 / 14 / 16`，描边宽度只剩一处 |
| 4 | 全仓几何清零 | 12 个样式表里最后 457 条写死数值迁到刻度；滚动条清单去重；门禁从"棘轮"升级为"全仓零债" |
| 5 | 动效、滚动与 Diff | 动效补到四档时长 + 五条曲线、拖拽冻结、代码比例行高、聊天边缘渐隐、`hidden="until-found"` 折叠、Diff 四列网格与 3px 增删条 |
| 6 | 长会话虚拟化 | 消息行改成按行挂载，滚出去的收掉；向上补历史按行标识锚回原位，切会话按（行标识, 行内偏移）恢复位置，拖选跨行钉住选区两端的行 |

增量的做法：真要调外观（不是迁移），另开一次提交，别混在结构收紧里——迁移只换取值来源，
屏幕上应当看不出差别；调外观要能被一句提交说明讲清楚。
