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

| 变量 | 值 | 用途 |
| :--- | :--- | :--- |
| `--ease-standard` | `cubic-bezier(0.2, 0.6, 0.3, 1)` | 全仓唯一曲线 |
| `--dur-fast` | `120ms` | 颜色、透明度这类极快反馈 |
| `--dur-slow` | `180ms` | 展开、折叠、位移 |

`data-motion="reduced"` 把两条时长清零，曲线不动；时长只认这两个变量，别处不写裸值。

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

## 6. 滚动条

滚动条是全仓唯一一处"同一个外观要落到一堆动不了的容器上"的地方：`.scroll-y` / `.scroll-x` /
`.scroll-both` 是我们自己的容器，CodeMirror 的 `.cm-scroller`、xterm 的 `.xterm-viewport`、
markstream 里画表格与代码块的节点是第三方的，DOM 不在手里，只能按类名字符串挑出来。

于是容器清单只写一遍，六条伪元素（`::-webkit-scrollbar`、`-button`、`-track`、`-corner`、
`-thumb`、`-thumb:hover`）连同"没有伪元素的引擎"那条 `@supports not` 兜底，一起嵌套在同一个
`:where(...)` 里。改清单就是改一处；拆成六段重复的选择器链既难对齐，漏一处也没有任何提示。

`--scrollbar-width` 参与三处计算：伪元素的宽高、拇指的内缩边框（`(width - thumb) / 2`），
以及 `.scroll-row` 的右内边距——所以它必须等于实际画出来的宽度，这也是这里不用标准
`scrollbar-width`（只有三档、画不出圆角拇指）而用伪元素的原因。

## 7. 迁移状态

四轮迁移已全部落地，全仓几何零存量：

| 轮次 | 范围 | 结果 |
| :--- | :--- | :--- |
| 1 | 刻度契约与纪律门禁 | 六档字号、四档行高、十档间距、四档控件高度、五档圆角、三档图标进 `:root`，与 `visual-contract.ts` 互为真值 |
| 2 | 颜色语义化 | `theme.css` 重写为 38 个角色键 × 6 套配色；阴影收成三档；焦点环画在盒子内侧；13 个死 token 删除 |
| 3 | 控件原语与图标真值 | 五个原语接管按钮、图标按钮、输入框、列表行与徽标；图标尺寸收到 `12 / 14 / 16`，描边宽度只剩一处 |
| 4 | 全仓几何清零 | 12 个样式表里最后 457 条写死数值迁到刻度；滚动条清单去重；门禁从"棘轮"升级为"全仓零债" |

增量的做法：真要调外观（不是迁移），另开一次提交，别混在结构收紧里——迁移只换取值来源，
屏幕上应当看不出差别；调外观要能被一句提交说明讲清楚。
