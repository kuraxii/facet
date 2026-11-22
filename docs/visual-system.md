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

## 3. 配套基准

- **零字距微调**：层级靠字号与字重（`400 / 500 / 600`）拉开，不写 `letter-spacing`。
- **单向下边距**：正文与 Markdown 区块只用 `margin-bottom`，首尾由
  `> :first-child { margin-top: 0 }` 与 `> :last-child { margin-bottom: 0 }` 归零。
- **一个数一处定义**：脚本要读的长度进 `VISUAL_PX`，样式要用的进 `:root`，两边同名同值；
  不许在组件里再抄一份字面量。

## 4. 门禁

`visual-contract.test.ts` 跑五类断言：

1. **刻度对齐**：`base.css` 的 `:root` 与 `VISUAL_SCALE` / `VISUAL_PX` 逐条相等。
2. **纪律**：全仓样式表 `0` 处 `!important`、`0` 处裸 `z-index`、`0` 处 `prefers-*` 之外的
   `@media`。
3. **颜色只从主题来**：`theme.css` 与泳道色之外不许有裸颜色字面量，豁免逐条写在测试里。
4. **棘轮**：每个样式文件里还写死着多少个 `font-size` / `border-radius` / `gap` / `padding`，
   记在 `VISUAL_DEBT_BASELINE` 里，只许降不许升；新增一个 CSS 文件必须先在基线里登记，否则
   用例会红。`box-shadow` 与 `transition` 已经全仓归零，单独一条断言压着不许回潮。
5. **单入口**：旧名 `--ease` 不再出现，`--text-size` 只指向 `--text-body`。

棘轮的计数口径：一条声明里**一个 `var()` 都没有**就算写死（`calc(var(--a) - 1px)` 不算）；
`transition` 另算——抹掉 `var(...)` 之后还剩时间字面量或缓动关键字才算。

## 5. 迁移顺序

颜色、阴影、遮罩、动效时长与焦点环已经全仓迁移完毕（没有旧名残留）。剩下的是几何：字号、
圆角、间距与内边距仍按文件分批搬，每迁完一个文件就把基线改小；顺序按收益排：

1. `chrome.css`、`panel.css`（外壳与工具条，件数少、影响面小）
2. `sidebar.css`、`overlays.css`（列表行与浮层，行高与圆角收益最大）
3. `settings.css`、`composer.css`（表单与输入区）
4. `chat.css`、`markdown.css`、`changes.css` 与三个 CSS Modules
5. `packages/ui-terminal/src/terminal.css`、`packages/ui-editor`（读变量的一方）

迁移只换取值来源，不改几何、不改交互：一个文件迁完，屏幕上应当看不出差别。真要调外观，另
开一次提交，别混在迁移里。
