# 布局

本文件是外壳布局的架构真值：档位语义、列宽的两个来源、抽屉与层级。**规则与红线**在仓库根的 `AGENTS.md`，界面视觉与文案在 `docs/ui_design_specification.md`；两边口径不一致时以本文为准，并在同一分支把设计稿对齐。

状态：方案 C 已按 PR1 / PR2 / PR3 落地；PR4（主区去标签栏、右栏改成工作区）与 PR5（右栏去掉固定上限）之后，PR6 把右栏改成「动态标签 + 空态启动清单 + 单栏钻取 / 宽阈双子栏 + `⤢` 宽展开」，并删掉了图钉与收起态竖轨。当前代码与本文一致。

## 1. 总体结构（方案 C）

三层，自外向内：

1. **单一 CSS Grid 外壳**：顶带（`var(--chrome-height)` 那一行）与正文（`1fr` 那一行）在同一个 grid 容器里，共享同一组 `grid-template-columns`：

   ```css
   .app {
     grid-template-columns: var(--col-sidebar) minmax(0, 1fr) var(--col-panel);
     grid-template-rows: var(--chrome-height) minmax(0, 1fr);
   }
   ```

   顶带与 `.shell` 都是 `grid-column: 1 / -1` 的行，并用 `grid-template-columns: subgrid` 继承同一组列轨道；三格与三列各自用 `grid-column` 定位。宽度对齐因此是**派生结果**，顶带里不再有任何宽度计算或宽度同步代码。

2. **双层宽度变量**：

   | 变量 | 含义 | 写入方 | 读取方 |
   | :--- | :--- | :--- | :--- |
   | `--sidebar-width` | **偏好宽**：用户拖出来的意图，跟本地存储走 | `PaneResizer` 拖动期间直接写在 `.app` 上；`AppFrame` 在非拖动时对齐到存储值 | 只作为下一行的输入 |
   | `--panel-width` | **实占宽**：右栏真正常占的宽度。偏好宽在状态里（`panel.width`），写下来之前先与「给正文留够地方」取小（`panelEffectiveWidth`） | `PaneResizer` 拖动期间直接写；`AppFrame` 在非拖动时写实占宽 | 只作为下一行的输入 |
   | `--col-sidebar`、`--col-panel` | **实占宽**：当前布局里这一列真正占的横向空间 | 样式表由上一行派生；折叠态与窄档的左栏为 `0px` | 列轨道、`.sb`、`.panel`、顶带三格 |

   右栏与左栏这点不对称：左栏的上限是它自己的 `SIDEBAR_MAX_WIDTH`，所以偏好宽可以直接写；右栏没有固定上限，它的上限由正文的最小可用宽现算，写进 `--panel-width` 的因此已经是「压窄之后」的值。偏好宽本身保留在状态与本地存储里，窗口变大后按它长回去（见约束 2）。

   派生只写在 `.app` 一处，折叠与窄档只在它上面覆写被折起的那一列。手动收起与预算折起走同一条路：两栏各一个显隐类名，样式只看类名，不关心是被谁折起的：

   ```css
   .app { --col-sidebar: var(--sidebar-width); --col-panel: var(--panel-width); }
   /* 窄档：左栏进抽屉，实占宽归零；右栏没有抽屉，照旧占列 */
   .app.is-narrow { --col-sidebar: 0px; }
   /* 栏位显隐：手动收起与中档预算折起共用，只把那一列的实占宽归零，偏好宽不动 */
   .app.is-sidebar-hidden { --col-sidebar: 0px; }
   .app.is-panel-hidden { --col-panel: 0px; }
   ```

   拖动仍然只写偏好宽，实占宽由 CSS 跟着算，**拖动期间不经过 React 渲染**（`PaneResizer` 的既有前提）。非拖拽状态下的显隐切换（左右栏开合、宽展开、`narrow` 抽屉）走 `--dur-structural`（`320ms`）配 `--ease-panel`：左侧栏与顶带头部通过贴齐右缘的固定宽在外层裁剪中滑出并用 `allow-discrete` 延迟 `visibility: hidden`；右栏顶格与本体跨列 2/4 右贴齐并持有不继承的 `--panel-box-width`，开关时沿右缘平移滑入/滑出（`usePanelPresence()` 等关闭过渡结束再卸载），`⤢` 宽展开时第 2 列保持原宽不被挤压，右栏直接从右往左扩宽覆盖主区并在结束后以 `allow-discrete` 隐藏主区，拖拽与窗口缩放期间由 `data-window-resizing` 将四档时长清零冻结。

3. **档位与折叠单处判定**：两个纯模块，都不读窗口：
   - `apps/desktop/src/renderer/src/resolve-layout.ts`：阈值常量（`LAYOUT_BREAKPOINT_PX = 880`、`LAYOUT_WIDE_BREAKPOINT_PX = 1216`、`MAIN_MIN_WIDTH = 520`）、`resolveLayout()`、`paneMaxWidth()` 与 `clampDragMax()`，全程纯函数，单测在 `resolve-layout.test.ts`。
   - `apps/desktop/src/renderer/src/layout-mode.ts`：一个 `matchMedia` 与结果类名（`is-narrow` / `is-wide`），结果写到 `.app` 与根节点上。

   样式表**不再写档位 `@media`**；`@media` 只留给与档位无关的细节（滚动条、`prefers-*`、对比度）。`packages/ui-terminal` 不认外壳类名，按自身宽度用容器查询响应。

### 1.1 主区与工作区

- **主区（`.main`，中列）只放对话**：消息流 `.scroll` 与输入区 `.footer` 直接撑满这一列，主区里不再有标签栏，也不再有任何「在主区打开一份文档」的路径。
- **右栏（`.panel`，右列）是一整个工作区**：顶端一条动态标签栏（`WorkspaceTabBar` + `WorkspaceTabMenu`），下面是标签内容。工具当前是四类，数据结构按「一条 = 标识 + 名字 + 图标 + 可选计数 + 是否可用 + 快捷键提示」描述，加一类要同时改 `panel-state.ts` 的取值表与 `workspace-tabs.ts` 的条目表：

  - `files`：编辑器与文件树在**同一层并排**占位（见 §2「文件视图的文件树」）；
  - `changes`：补丁预览 + 可折叠变更列表（**只**看工作树，不含提交历史）；
  - `git-graph`：满宽的提交图谱列表 → 点一条钻入提交详情（见下）；
  - `terminal`：终端独占整宽，两边都没有索引，**切走只藏起来不卸载**（保住 PTY 会话与回滚）。

  整屏因此是 `会话栏 | 对话 | 预览 | 索引`：宽到放得下两栏时**预览在左、索引在右**，与左边那三栏的阅读方向连着；窄到放不下时退成单栏钻取，见下一条。
- **变更与提交图谱的分工**：`changes` 只看工作树（`git status` + 单文件补丁），跟着保存与暂存高频刷新；`git-graph` 看历史（分页的提交 + 单次提交的详情），**只在它自己看得见时才取**，第一页之外按需加载。图谱的两级是「满宽列表 → 钻入详情」：
  - 列表：每行只有三样——左侧 SVG 泳道（`packages/ui/src/git/git-graph-layout.ts` 算列号、颜色与连线，纯函数）、中间的提交说明（单行省略）、**右端**的引用胶囊（HEAD / 本地分支 / 远端分支 / Tag，贴右对齐）。作者、短哈希与相对时间不放行里：它们由悬浮卡与详情页给，行里留给说明本身。分页每页 50 条，**滚到底自动取下一页**：列表底部一个零高度哨兵，进入视口（提前 `240px`）就按 `skip` 追加，正在取时底部换成一条读取提示——没有「加载更多」按钮，滚到底不该再要一次点击。
  - 详情是一份**变更文档**（与 `changes` 页同一个 `ChangesDocument`）：这条提交改到的所有文件排在同一个滚动区里，每个文件一个吸顶文件头、可折叠，补丁进入视口附近才按 `gitCommitDiff` 取，已取到的折叠后保留。详情**只有一层**：点一条提交直接给这份改动文档，没有中间的文件列表，也没有单独的概览块——提交说明、作者、时间、改动规模与远端链接在列表里**悬停那条提交**就有（`CommitTip`），进去之后呆在补丁里就够了。顶栏那一条线上并排着「退回图谱」（`.workspace-back`，任何宽度都在，图谱详情只有这一条退路）、短哈希与说明、总 `+N −M`、全部折叠与折行（`ChangesDocument` 的 `toolbarLeading` + `title`）。改动里没有刷新按钮：提交的补丁不会变，只有失败时才给重试。
  - 从详情退回列表时恢复列表原来的滚动位置；`Esc` 与顶栏那枚箭头是同一条路（详情 → 图谱），不会顺手关掉右栏。
- **标签是运行时的集合**：状态是 `openTabs: RightPanelTab[]` + `activeTab: RightPanelTab | null`（`panel-state.ts`），标签栏只渲染已打开的那些，每条带关闭按钮（`×`、中键、`Delete`）；末尾固定跟一枚 `+`（四件工具全开时不渲染），弹出全部工具的菜单（没开的追加并激活，已开的只切过去）。`openTabs` 为空时右栏**不收起**，正文区换成居中启动清单（`WorkspaceLauncher`：图标 + 名字 + 右对齐的快捷键提示），关掉最后一个标签就回到那里。
### 1.2 工作区的文件地图

标签内容按领域拆开，`workspace-body.tsx` 只做路由（不含任何 `useState`）：

| 路径 | 职责 |
| :--- | :--- |
| `apps/desktop/.../views/workspace-body.tsx` | 四类标签的轻量路由 + 共享上下文透传 |
| `apps/desktop/.../views/workspace/files-tab.tsx` | 编辑器 + 文件树（树开关、树宽、容器宽） |
| `apps/desktop/.../views/workspace/changes-tab.tsx` | 工作树改动（钻取层次、索引栏收起） |
| `apps/desktop/.../views/workspace/git-graph-tab.tsx` | 提交图谱（分页、钻入状态、滚动位置恢复、`Esc` 逐级返回） |
| `apps/desktop/.../views/workspace/terminal-tab.tsx` | 终端（唯一靠显隐保活的标签） |
| `packages/ui/src/git/git-graph-layout.ts` | 泳道布局纯函数（列号、颜色、连线、最大列数） |
| `packages/ui/src/git/git-graph-lanes.tsx` | 一行的 SVG 泳道 |
| `packages/ui/src/git/git-graph-list.tsx` | 满宽图谱列表（工具栏、行、触底自动加载） |
| `packages/ui/src/git/git-patch.tsx` | 补丁正文（变更页与提交详情共用） |
| `packages/ui/src/git/git-status-mark.tsx` / `git-refs.tsx` / `commit-tip.tsx` | 状态图形、引用胶囊、提交悬浮卡（作者 / 时间 / 改动规模 / 引用胶囊都在卡里） |
| `packages/ui/src/styles/changes.css` / `git-graph.css` / `panel.css` | 全局样式按领域拆：变更与补丁、图谱页、面板骨架与文件视图 |

- **文件视图的文件树（只在 `files` 视图）**：编辑器与文件树是**同一个 flex 行里的两栏**——编辑器 `flex: 1 1 0; min-width: 0`，文件树 `flex: 0 0 auto`，互不覆盖。底色与文件内容相同（`--bg-canvas`）、无投影，只有左缘一条 `1px` 线。
  - 每层都写 `min-width: 0`（`.panel-body` → `.workspace-files` → 编辑器外壳 → `.code-surface`）：不给 0 时 flex 子项的自动最小宽度会被长代码行顶成内容宽，一路把容器撑破。
  - 宽度三层：样式 `clamp(var(--file-tree-min), var(--file-tree-width, var(--file-tree-default)), min(var(--file-tree-max), calc(100% - var(--editor-keep-width))))` 兜底；界面按本地存储写的偏好宽（`facet.files.treeWidth`，`file-tree-state.ts`）；拖动时的实时上限 `fileTreeMaxWidth()`（`min(420, max(180, 容器宽 − 120))`，`120` 是 `EDITOR_KEEP_WIDTH`）。四个数都在 `:root` 与 `layout-contract.ts` 里各有一份并逐条对齐。右栏拖到下限 `300` 时树让到 `180`、编辑器还剩 `120`。
  - 偏好宽写在根节点的 `--file-tree-width` 上；拖动期间分隔条把同一个变量写在 `.app` 上（更近的祖先赢），松手才落盘，拖动不经过 React 渲染。
  - 左缘一条透明命中区（`.file-tree-resizer`）加宽 / 收窄；收起时整栏 `display: none`（`is-hidden`），编辑器吃满整行，树的展开状态与滚动位置都留着。
  - 树的滚动容器带 `.scroll-y`（与变更索引栏、正文滚动区同一套细滚动条与沟槽口径），不另写一套 `overflow` 规则。
  - 两类滚动容器别混用：`scroll-y` 管纵向、`scroll-x` 管横向。只挂 `scroll-x` 的块（补丁正文、长代码行）里写 `overscroll-behavior-x`，**不要写短写 `overscroll-behavior: contain`**——`overflow-y: hidden` 在规范里也算滚动容器，短写会把纵向一起关掉，滚轮落在补丁上就再也滚不到外面那个列表。
  - 补丁正文可以被选中复制（`.diffBody` 写 `user-select: text`，行号那列单独 `user-select: none`），因为全局在 `body` 上关了选择。
  - 开关在编辑器二级顶栏的最右端；没有全屏 `Esc` 监听——正常流的分栏按 `Esc` 留给编辑器自己的交互。
  - 编辑器**不折行**（不挂 `EditorView.lineWrapping`）：被文件树挤窄之后，长行由 `.cm-scroller` 横向滚动，滚动条画在编辑器底边（与全仓同一套细滚动条样式）。
- **单栏钻取 / 宽阈双子栏（`WorkspaceSplit`，变更视图用）**：右栏正文这一层是容器查询的容器，`@container (width >= WORKSPACE_SPLIT_WIDE_WIDTH_PX /* 680px */)` 才解锁两栏。
  - 两栏态：预览在左、索引在右，DOM 顺序就是视觉顺序（不用 `row-reverse` 翻转，否则键盘 Tab 与读屏顺序会和眼睛看到的对不上）。索引栏宽 `--workspace-list-width`，分隔线画在它的**左缘**（`border-inline-start`）：外层左侧那条是 `.panel-resizer` 的分隔条，窗口右缘是纯边界，三条线各在一处，不会叠成双线。这条分界线**可拖**（`.workspace-list-resizer`，与文件树那条同一个 `PaneResizer`，命中宽 `--divider-hit-width`、悬停与拖动时只染分界线的颜色）：拖动期间把变量直接写在 `.app` 上不经过渲染，松手才提交一次并落盘；上限按 `WorkspaceSplit` 自己量到的容器宽现算（预览至少留 `280px`），所以 `⤢` 宽展开与窄档都能拖。变更页与提交图谱共用同一份偏好宽——两处的索引是同一件事，拖一次两边都是这个值。
  - 单栏态：一次只显示一层（`data-view="list" | "detail"`），满宽。点文件 / 改动 / 提交进预览，预览二级顶栏**左上角**那枚 `←` 退回列表（面包屑就是「箭头 + 路径」，路径由预览视图自己给）。
  - 「收起索引」只在两栏态有：收起之后预览占满、左缘不动，展开入口在预览顶栏最右端（`PanelRightOpen`）；单栏态两个按钮都由样式藏起来——那里没有「收起」这回事，`←` 才是退路。
  - 哪一层显示只由 `data-view` 表达，组件不做宽度判断；`WORKSPACE_SPLIT_WIDE_WIDTH_PX` 与 `panel.css` 里那条 `@container` 是同一个数。
- 顶带右格用的是一组控件（`WorkspacePanelControls`）：动态标签 + `+` 菜单 + 右端的 `⤢` 宽展开（窄档不给 `⤢`：正文那一列已经让到接近极限，展开没有意义）；右栏开合按钮（`PanelToggle`）常驻在 `.app-chrome` 右端、窗口按钮簇左侧，任何开合与宽展开状态都不位移，只原地切换图标。

## 2. 三档语义

| 档 | 视口（CSS px） | 左栏 | 正文 | 右栏 | 判定 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 宽 | `≥ 1216px` | 平铺，可拖 | 剩余宽度 | 平铺，可拖 | 只看意图位 |
| 中 | `880–1215px` | 放不下时折起（预算只折它） | 不小于 `--main-min` | 占列，只缩不折 | `resolveLayout()` |
| 窄 | `< 880px` | 全高抽屉 | 与右栏分剩下的宽度 | 占列，继续收窄 | `matchMedia` |

右栏没有抽屉也没有折起态：任何档位它都占第 3 列，只按下面的让位顺序变窄。`1216` 仍是宽档阈值——到了它就不再评估预算折叠；折叠实际只在 `880–1091` 发生（右栏已经到底、正文还不够 `--main-min` 时折起左栏），`1092–1215` 与宽档结果一致。

正文最小宽从 `420` 提到 `520` 是因为聊天区改成了三列网格（`--chat-gutter-min` + 正文 + `--outline-slot`）：正文那列要同时让出两侧轨道，地板因此高一档。

**窗口变小时的三级让位**（`fitPanelWidth()`，三档一体）：

| 顺序 | 让谁 | 让到哪儿 |
| :--- | :--- | :--- |
| ① | 正文两侧的留白 | 先吃掉 `1fr` 的松量，退到 `--chat-rail-gutter`（100% 缩放时 `52`，导航轨那一档）为止 |
| ② | 右栏 | 从偏好宽一路窄到 `PANEL_MIN_WIDTH`（`300`），保住正文的阅读上限 |
| ③ | 正文列 | 右栏到底之后才开始缩，可以低于 `--main-min`（窄窗口里正文比输入区的地板更要紧的是「还在一列里」） |

「阅读上限」是 `--chat-column-max`（`840`），加上两侧留白就是主区的基准宽 `944`（`resolve-layout.ts` 的 `MAIN_PREFERRED_WIDTH`，两个数都来自样式契约）。两栏默认开时右栏的实占宽因此是 `min(偏好宽, 视口 − 左栏 − 944)`，到 `300` 为止：

| 视口 | 左栏 | 右栏 | 正文列 |
| ---: | ---: | ---: | ---: |
| 1600 | 272 | 384 | 840 |
| 1516 | 272 | 300 | 840 |
| 1400 | 272 | 300 | 724 |
| 1216 | 272 | 300 | 540 |
| 1092 | 272 | 300 | 416 |

**中档（预算折叠）**：

- 判据只有一条：右栏让到下限之后，正文还够不够 `--main-min`——`sidebarPref + MAIN_MIN_WIDTH + fitPanelWidth(...) <= viewportWidth`。够就两栏平铺，不够就折起左栏。右栏不参与折叠，所以没有「保留哪一栏」这回事（`priorityPane` 已删除）。
- 折叠只改实占宽，不改偏好宽；视口回到装得下时按偏好宽与用户意图无感恢复。
- 重算时机只有三个：意图位变化、偏好宽提交（`pointerup`）、视口 `resize`。**不用 `ResizeObserver`** 看内部容器（折起会让容器变宽，看容器就是折展死循环）；**拖动期间整段锁定**，否则折起会先卸载分隔条，`lostpointercapture` 那次收尾会把一个没人在看的宽度提交上去。
- 弃用 `clamp()` 硬挤压：夹紧能吸收的缺口只有两栏上下限之差，而中档低端的缺口比它大得多，实测会整段退化到下限，正文仍不足（见 §5.1）。右栏的让位改由 `fitPanelWidth()` 现算，不再靠 CSS 夹紧。

**窄档（左栏抽屉 + 右栏占列）**：

- 左栏 `--col-sidebar` 是 `0px`，进抽屉；右栏没有抽屉，照旧占列，只是被收得更窄（让位的优先级见 §3 约束 2）。
- 抽屉从窗口顶边到底边（`position: fixed`，`inset: 0 auto 0 0`），表面、右边线、阴影从 `y=0` 起连续，顶部 36px 就是它自己的顶头（见 §4）。
- 抽屉开合不写回宽档的意图位：拉宽后仍按侧栏收起位平铺。
- 遮罩（`.drawer-scrim`）只服务左抽屉：盖住正文与顶带，点它、点 `Esc`、点抽屉自己的关闭按钮都关抽屉；关闭后焦点还给打开它的那个顶带开关（开关在抽屉开着时仍留在 DOM 里）。
- 抽屉用传统 `position: fixed` + 可控遮罩 + `Esc` + 点外部关闭。**不使用 `popover="auto"`**：Top Layer 压过一切，`z-index` 无法让窗口按钮浮在抽屉之上；且 `popover` 的 Esc 没有可拦截的 `cancel` 事件，与仓库现有 `Modal` 依赖 `onCancel` + `preventDefault` 的做法冲突。同一份理由只否掉「抽屉用 popover」，不否掉 popover 本身：弹窗**内部**的小菜单（目前只有设置里模型行的思考档位）用它，因为那一层要的是 Top Layer 带来的「不被滚动区裁掉」与浏览器的点外部关闭，且它没有需要压在它上面的东西。`Esc` 的冲突由菜单自己在 `document` 捕获阶段 `preventDefault()` 补上——不拦的话一次 `Esc` 会把设置窗一起关掉。

**宽展开（`⤢`，右栏最大化）**：

- 含义只有一条：**右栏从右往左盖住正文那一列**。展开时第 2 列轨道（主区）保持原宽不动、不被压缩挤压；`.chrome-slot.is-panel` 与 `.panel` 跨第 2 / 3 列右贴齐，从 `var(--panel-box-width)` 平滑扩宽到 `100%`（即 `视口宽 − 左栏`）覆盖在主栏之上，左栏照旧按意图摆，不给正文留 `--main-min`——最大化就是覆盖。
- 临时视图状态（`isPanelExpanded`），**不落盘**：刷新、切进窄档、或右栏自己也收起时自动归 `false`。
- 只在非窄档且右栏想开时生效（`resolveLayout()` 里它排在窄档判定之后、宽档之前），并且**跳过预算折叠**：中档放不下也照样展开。两侧的意图位与偏好宽一个字都不改——退出展开时从左往右缩回，原样露出静止在底下的主区。
- 宽度由样式现算，不在 JS 里：

  ```css
  .app:where(.is-panel-expanded:not(.is-narrow)) .chrome-slot.is-panel {
    width: 100%;
  }
  .app:where(.is-panel-expanded:not(.is-narrow)) .panel {
    width: calc(100% - var(--space-4));
  }
  ```

- 展开期间**不渲染 `.panel-resizer`**（通过不传 `onWidthChange` 控制）：拖动改的是偏好宽，会覆盖用户原本那一份，而展开已经是「能给多宽就给多宽」。
- 顶带中格与 `.main` 在展开期间留在原位不动、不提前卸载，样式用 `visibility: hidden` + `allow-discrete` 等覆盖动画走完后再屏蔽焦点与指针；退出展开时立即恢复可见并随右格/右栏缩回而露出。
- 点 `⤡`、收起右栏，任一动作都退出展开。

**入口与收起**：

- 右栏收起时，主区顶带右端只留一枚紧凑的右栏开关，改动数大于 0 时带数字角标。
- 非窄档不再有贴右缘的悬浮竖轨：三件工具的入口统一在顶带右格的 `+` 菜单里。

**数值口径**：

样式与脚本共用的那几个数只在 `packages/ui/src/layout/layout-contract.ts` 里写一次（`LAYOUT_PX` 与 `SHELL_DATA_ATTRS`）：左栏 / 右栏 / 文件树 / 索引栏的上下限与缺省、正文最小可用宽、两个档位断点、单栏两栏折点、顶栏标签的折点、窗口按钮簇，以及 `.app` 上的两个拖拽折叠属性名。各领域模块（`sidebar-state.ts`、`panel-state.ts`、`file-tree-state.ts`、`workspace-list-state.ts`、`workspace-split.tsx`、`resolve-layout.ts`）的导出常量都指向它，`index.ts` 一并转发 `LAYOUT_PX` / `SHELL_DATA_ATTRS`。容器查询与属性选择器里不能写变量，样式表那边仍是字面量，所以 `layout-contract.test.ts` 反过来读 `panel.css` / `base.css` / `chrome.css` 的源码逐条比对：三个容器折点、`--main-min`、文件树与索引栏那两组 `:root` 变量、窗口按钮簇的派生式、两个 `data-*-drag-collapsed` 选择器——任何一边单独改都会红。

| 变量 | 值 | 含义 |
| :--- | :--- | :--- |
| `--chat-column-max` | `780px` | 正文**最佳阅读上限**，窄档退到 `--chat-column-max-narrow`（`760px`） |
| `--main-min` | `520px` | 正文**最小可用宽**：输入区一行 chip 放得下、气泡不塌。三列网格下它 = `20px` 左留白 + `52px` 导航轨 + `448px` 正文。与阅读上限是两回事，不要互相顶替 |
| `--sidebar-width` 范围 | `220–420px`（缺省 `272`） | 偏好宽，落盘 |
| `--panel-width` 范围 | `≥ 300px`（缺省 `420`，**没有固定上限**） | 界面写下来的宽度：三档一体的实占宽，偏好宽与正文预算取小之后的值（见约束 2） |
| `--workspace-list-width` | `200–480px`（缺省 `320`） | 两栏态里**索引栏**（右侧列表）的宽度，落盘 `facet.workspace.listWidth`；容器放不下时被 `clamp()` 与 `workspaceListMaxWidth()` 收住，左边永远留 `280px`（`WORKSPACE_DETAIL_KEEP_WIDTH`）给预览 |
| 极窄顶带 | `420px`（容器查询，`LAYOUT_PX.workspaceTabBar.tight`） | 窄于它只收紧标签间距与同排的 `+`、动作按钮间距 |
| 标签栏溢出 | 横着滚（无可见滚动条） | 标签按内容占宽、文字永不折成图标；放不下就滚，鼠标竖向滚轮也接到 `scrollLeft` 上，当前项切过去时自动滚进可视范围 |
| 提交历史分页 | `COMMIT_PAGE_SIZE = 50` | 图谱每页取多少条；`gitCommits` 带 `limit` / `skip`，返回体用 `hasMore` 说明后面还有没有 |
| 提交图谱泳道 | `LANE_GAP = 14px`、`GRAPH_ROW_HEIGHT = 28px`、最多 16 列 | 纯函数 `layoutGitGraph()` 算列号与连线，SVG 按它画；16 列是「再宽也看不清」的上限 |
| 单栏 / 两栏的折点 | `680px`（容器查询，`WORKSPACE_SPLIT_WIDE_WIDTH_PX`） | **变更视图**窄于它时单栏钻取，宽于等于它时解锁两栏 |
| `--file-tree-width` | `180–420px`（缺省 `240`） | 文件树的宽度，落盘；容器放不下时被 `clamp()` 与 `fileTreeMaxWidth()` 收住，右侧永远留 `120px`（`EDITOR_KEEP_WIDTH`）给编辑器 |
| 宽展开的宽度 | `calc(100% − var(--col-sidebar))` | 右栏最大化：盖住正文那一列，见 §2「宽展开」 |
| 主区基准宽 | `MAIN_PREFERRED_WIDTH = 944px` | 右栏让位的基准：`--chat-column-max`（`840`）+ 两侧 `--chat-rail-gutter`（各 `52`）。两个数取自样式契约（`VISUAL_PX.readingColumnMax` / `outlineRail`），100% 缩放下的值 |
| 档位断点 | `LAYOUT_BREAKPOINT_PX = 880`、`LAYOUT_WIDE_BREAKPOINT_PX = 1216` | 只在 `resolve-layout.ts` 写一次；容器查询里的数字不受这两个约束 |

## 3. 三条工程硬约束

### 约束 1：窗口按钮防撞

自绘三按钮（`--window-button-width × 3 = 132px`）作为**右上角独立的 `fixed` 簇**常驻，不占列轨道，因此右栏收起或左栏进抽屉都不会让它们失业。代价是它们可能压住顶带中栏，所以：

```css
:root { --window-controls-width: calc(var(--window-button-width) * 3); }

.chrome-slot.is-main {
  padding-inline-end: max(0px, calc(var(--window-controls-width) - var(--col-panel)));
}

/* 右格自己是容器查询的容器，量到的必须是整列宽，所以横向内边距落在里面那一行 */
.chrome-slot-row,
.panel-head-row {
  padding-inline-end: var(--window-controls-width);
}
```

中栏让出的宽度等于「窗口按钮簇宽度减去右栏实占宽」：右栏展开且够宽时让 `0`，右栏收起（`--col-panel: 0`）时让满 `132px`。右栏那一格再自己扣掉这段，两格的内容因此都不会钻到按钮底下。

**为什么让位在内层**：右格（`.chrome-slot.is-panel`）是容器查询的容器，折点按整列宽判定。容器查询量的是查询容器的内容盒，所以这两处 MUST NOT 留横向内边距；否则查询到的宽度比列窄 132px，`420px` 的右栏会被当成 `288px`。让位因此写在内层那一行上：外层的宽度就是列宽，内层的内容仍然停在按钮左侧。宽展开时中格那条让位清零（见 §2「宽展开」），否则它里面的 `--col-panel` 是个百分比，会按中格自己的宽度解析。

**标签栏溢出**：标签一律按内容占宽（`flex: none`），文字永远在、不折成图标，也不向内省略——放不下时 `.workspace-tabs` 自己横着滚。滚动条不画（这一条只有 `--workspace-tab-height` 高），滚轮与触控板都由 `workspace-tab-bar.tsx` 的 `useWheelScroll` 接到 `scrollLeft` 上（鼠标只给 `deltaY`）；当前项切过去时那只 effect 把它滚回可视范围，只动标签栏自己的 `scrollLeft`，不调 `scrollIntoView`。右端的两枚动作与 `+` 不受影响：滚动的是标签那一条，不是整行。四件工具全开时不再渲染 `+`（没有可打开的东西，留着只会占掉最紧的那几十像素）。

### 约束 2：右栏实占宽与拖拽上限

右栏的宽度有两个口径，都在 `resolve-layout.ts` 里算，三档一体：

- **实占宽** `fitPanelWidth()`：窗口变小时先让右栏（§2 的三级让位）。
  - **没手动定过宽**（`panel.widthViewport` 是 `undefined`）：只拿主区放得下 `MAIN_PREFERRED_WIDTH`（`944`）之后剩下的部分，下限 `PANEL_MIN_WIDTH`。
  - **手动拖过**：拖出来的宽度先照摆；窗口每少一像素，右栏先还回一像素，到下限为止，之后正文才开始缩。窗口比定宽时更宽就按偏好宽长回去，不越过它。基准落在 `panel.widthViewport`（本地存储 `facet.panel.widthViewport`），只有宽度真的变了才更新——切标签不会冲掉它。
  - 两级都收在同一条硬边界上：正文不小于 `--main-min`。
- **拖拽上限** `paneMaxWidth()` / `clampDragMax()`：`max(min, 视口 − MAIN_MIN_WIDTH − 另一栏)`。它比自动实占宽宽一档，所以「拖动优先」成立——手动能拖到正文只剩 `-main-min` 的地方，自动值只会停在让位顺序算出来的位置。

```ts
const budget = viewportWidth - MAIN_MIN_WIDTH - (另一栏可见 ? 另一栏宽度 : 0);
const max = Math.max(min, budget);              // 右栏：没有别上限，下限优先
const sidebarMax = Math.min(SIDEBAR_MAX_WIDTH, max); // 左栏还有自己的 420
```

- **偏好宽不被压小**：窗口变小只是实占宽变小，落盘里仍是用户拖出来的宽度（`panel.width` 与 `widthViewport` 都不动），窗口变大之后按它长回去。
- 分隔条与列轨道都用实占宽（拖动起点与屏幕上看到的一致，不会一抓手就跳），只钳上限、不触发折叠；松手提交的宽度一定是折完还能放下的宽度。
- 钳制命中时不写盘，分隔条保持不动并给出「已到底」的指针反馈，避免 §5 里的拖拽假死。

### 约束 2.1：拖收关闭（左右侧栏）

平铺可拖拽态下，把一栏缩到「最小宽再往里一半」就进待关闭态：**拖动中当场收起这一栏**，松手就真的关掉它。

```ts
// 判定看的是**未钳制**的目标宽；缩到哪里停下则由 [min, max] 决定
const raw = startWidth + (side === "start" ? -delta : delta);
const next = clampPaneWidth(raw, { min, max, defaultWidth: startWidth });
const pending = collapseThreshold !== undefined && raw <= collapseThreshold; // 左 220/2、右 300/2
```

- 阈值与两侧下限绑在一起：左栏 `SIDEBAR_MIN_WIDTH / 2 = 110`、右栏 `PANEL_MIN_WIDTH / 2 = 150`。
- 越过阈值时在 `.app` 上挂 `data-sidebar-drag-collapsed` / `data-panel-drag-collapsed`（`collapsePreviewAttr`），样式据此把 `--col-sidebar` / `--col-panel` 摁到 `0px`——正文、顶带与窗口按钮簇按既有列轨道一起重排。属性直接写在元素上、不经过 React 状态，拖动期间一次渲染都不发生。
- 拖回阈值之上立刻摘掉属性，宽度从 `min` 起重新跟手；进入 `[min, max]` 之后 1:1 跟随指针。
- 预览期间**不卸载 DOM、不收指针捕获、也不给那一栏 `display: none`**：本体只收 `padding` / `border` / `overflow: visible`，非分隔条子元素用 `visibility: hidden` 收起来（会话列表的滚动位置与终端的 DOM 都不能在拖动中被重建）。分隔条留在原地整条染强调色，并贴到窗口内侧边缘（左栏 `left: 0`、右栏 `right: 0`），提示线不被 `.app` 的 `overflow: hidden` 裁掉。
- 左栏那条线**顶到窗口上缘**：分隔条在第 2 行里，`.shell` 的 `overflow: hidden` 会把它裁在接缝上，所以顶带那 `--chrome-height`（36px）由 `.chrome-slot.is-sidebar` 自己画同色的一条（`--divider-hit-width` 宽），两段接成一条。右栏不跟着上去——窗口按钮簇钉在右上角，线会从 ✕ 底下穿过。
- 松手时若仍在待关闭态：**不提交宽度、不写盘**，把 `.app` 上的宽度变量还原成这次拖动的起点，`flushSync` 让 `is-*-hidden` 先落到 DOM 上，再摘预览属性（反过来的话会闪回一帧原宽度），最后调用 `onCollapse()`——下次打开还是原来那份偏好宽。
- `pointercancel` 与「拖到一半被卸载」只还原变量与属性，不关闭也不提交。
- `⤢` 宽展开不渲染分隔条（那一列的宽度由视口现算，拖了也会被覆盖），因此没有这条路径。

### 约束 3：跨 Portal 的 Esc 协调

提示、右键菜单、toast 等浮层 Portal 到 `document.body`，在抽屉的 DOM 子树之外。因此**不靠 `stopPropagation()`** 区分内外层，统一用默认动作：

- 所有内层浮层（会话行内重命名、右键菜单、`text-menu`、`Modal`）处理 `Escape` 时必须调用 `event.preventDefault()`。
- 抽屉的全局 `Escape` 监听**首行**必须是 `if (event.defaultPrevented) return;`。

一次 `Esc` 只关最内层，抽屉留在原地。

## 4. 层级刻度

`:root` 里只留这组命名刻度，样式里不再写裸 `z-index`：

| 变量 | 值 | 成员 |
| :--- | ---: | :--- |
| `--z-content` | `0` | 正文内容、顶带拖拽区 |
| `--z-content-local` | `3` | 正文内的局部贴靠：分隔条命中区、文件树的拖拽条、对话导航竖轨、吸顶行、终端拖动条、侧栏头部 |
| `--z-chrome` | `10` | 顶带基础层：`.app-chrome` 与常规顶带控件 |
| `--z-drawer-scrim` | `20` | 左抽屉的遮罩：盖住正文与顶带，点顶带空白也能关抽屉 |
| `--z-drawer` | `30` | 左栏全高抽屉：从 `y = 0` 连续到底边，顶部不被顶带截断 |
| `--z-window-controls` | `40` | 右上角 `132px` 窗口按钮簇：唯一浮在抽屉之上的顶带控件，恒定可点 |
| `--z-popup` | `60` | 行内弹层与右键菜单：侧栏弹层、右栏的 `+` 菜单、命令列表、chip 弹层、主机切换、选中文字菜单 |
| `--z-tip` | `90` | 悬浮提示 |
| `--z-drag-overlay` | `95` | 分隔条拖动遮罩 |
| `--z-toast` | `200` | 轻提示、缩放徽标 |

顺序的含义固定：抽屉遮罩盖住正文与顶带，全高抽屉压在遮罩上（表面与左边线从顶边连续到底），只有窗口按钮簇始终浮在抽屉之上；抽屉之外的弹层与提示再往上。弹窗不用这组值：`<dialog>` 走浏览器 Top Layer。

**层叠上下文**：窗口按钮簇必须是 `.app` 的直接子元素，不能放在 `.app-chrome` 里——后者带 `--z-chrome`，会自己成一层层叠上下文，把簇里的 `40` 锁在 `10` 里，遮罩和抽屉照样能盖住它。

**抽屉顶头**：抽屉盖过整条顶带，自身顶部 `var(--chrome-height)`（`36px`）这一条就是它的顶头（侧栏头部与关闭按钮），不再把控件留在顶带里；顶头里的控件保留 `-webkit-app-region: no-drag`。右栏没有顶头——它的控件一直在顶带右格。

## 5. 取舍依据（为什么不用夹紧、为什么不看容器）

### 5.1 中档夹紧算穿

CSS `clamp(min, val, max)` 在 `max < min` 时返回 `min`，实测（正文最小可用宽按当时的 `780px` 量，侧栏 `420`、右栏下限 `260`）：

| 视口 | 夹紧结果 | 正文实得 |
| ---: | ---: | ---: |
| 881 | 260（退化到下限） | 201 |
| 900 | 260 | 220 |
| 1100 | 260 | 420 |
| 1280 | 440 | 420 |

夹紧只有在视口足够大时才有意义，中档整段失效。根因是 `420 + 260 + 420 = 1100`：低于 1100px 的视口三栏在数学上就不共存，而窄档阈值是 880。右栏下限抬到 `360`（后来降到 `300`）之后这条缺口只会更大，这也是 §2 用预算折叠替代夹紧、并把宽档阈值抬到缺省三栏那条预算线的原因。

### 5.2 拖拽假死

夹紧后屏幕画的是实占宽、拖动改的是偏好宽：指针在动、分隔线不动，松手却把「从未显示过的宽度」写进本地存储。约束 2 与 §2 的折叠语义一起解决它。

### 5.3 顶带与浮层两个宽度源

顶带读偏好宽、浮层读样式常量；两套宽度会让顶带的标签按钮悬在正文上方。§1 的实占宽收口消掉这一条：顶带、列轨道与右栏本体都读同一个 `--col-panel`。

### 5.4 浮层不占顶栏、层级散落

浮层相对 `.shell` 定位，顶边从 `36px` 起，顶带那一条仍是别的东西；`z-index` 有 26 处裸数字，右栏浮层（`25`）压在主区菜单（`30`）之下。§2 的全高抽屉与 §4 的刻度消掉这两条（PR3）。

## 6. 落地顺序

| PR | 提交 | 范围 | 独立验收 |
| :--- | :--- | :--- | :--- |
| PR1 | `refactor(ui): 外壳改单一 Grid，列宽拆成偏好宽与实占宽` | 单一 Grid 外壳、`--col-*` 派生、`--main-min`、断点单处 + 类名、窗口按钮固定簇与约束 1、删档位 `@media`（终端改容器查询）。**不改交互行为** | 顶带与列在 `640 / 881 / 900 / 1100 / 1280` 各档对齐；拖动分隔条顶带跟随；缩放到 80 / 150 后布局与终端列数正常 |
| PR2 | `feat(ui): 中档预算折叠` | `resolveLayout()` / `clampDragMax()` 纯函数 + 单测、意图位与结果位分离、显隐类名与约束 2 的上限钳制 | 1280 → 640 → 1280 往返折叠与恢复符合意图；拖动分隔条不触发折叠；手动开栏时预算让位 |
| PR3 | `fix(ui): 抽屉占满全高、遮罩与层级刻度` | 抽屉 `fixed` 全高、遮罩、互斥、焦点返回、约束 3 的 Esc 协调、§4 刻度替换全部裸 `z-index` | 一次 `Esc` 只关最内层；抽屉表面从 `y=0` 通到底；窗口按钮在抽屉之上可点 |
| PR4 | `refactor(ui): 主区去标签栏，右栏改三张分页的工作区` | 删 `.main-tabs` 与 38px 顶条、`WorkspaceTabBar` / `WorkspaceSplit` 两个可复用组件、右栏三张分页（文件 / 变更 / 终端，终端保活）、图钉与收起态竖轨、宽度改 `360–840`（缺省 `520`）、宽档阈值 `1240`、分页文字按容器查询折起 | 1400 三栏平铺时右栏三张图文分页可切、终端切走再切回不丢会话；1000 中档拖窄到 `360` 时只剩图标且不压窗口按钮；1280 取消图钉后右栏变全高抽屉、`--col-panel` 归零；640 窄档竖轨隐藏、顶带入口打开右抽屉 |
| PR5 | `refactor(ui): 右栏去掉固定上限，改由正文最小宽约束` | 删 `PANEL_MAX_WIDTH`、`clampDragMax()` 去掉档位判断（三档都按正文预算钳制）、新增 `paneMaxWidth()` 与实占宽 `panelEffectiveWidth`；窗口缩小时只压窄实占宽，偏好宽不动 | 1400 视口里右栏最多拖到 `708`（正文仍是 `420`）；把偏好宽写成 `1600` 再在 1400 视口打开，右栏显示 `708`、窗口拉到 2560 后按 `1600` 长回去 |
| PR6 | `refactor(ui): 右栏改动态标签，顶带做减法` | 右栏状态改 `openTabs` / `activeTab`（旧单标签键迁移）、`WorkspaceTabBar` 精简为动态标签 + 关闭、新增 `WorkspaceTabMenu`（`+`）与 `WorkspaceLauncher`（空态）、单栏钻取 / 宽阈双子栏、`⤢` 宽展开（`isPanelExpanded`）、宽度改 `300–无上限`（缺省 `420`）、宽档阈值 `1120`、删图钉与收起态竖轨、顶带中格加会话标题与开关角标 | 1280 空态右栏给居中启动清单；开文件出标签与 `+`，关掉退回清单；`420` 单栏钻取、`⤢` 后左栏让位、右栏 `832`（两栏解锁）且正文仍 `448`；终端切走切回同一实例、`⤢` 后重算列宽；`640` 抽屉里没有 `⤢`，`+` 菜单一次 `Esc` 只关菜单 |

| PR7 | `feat(ui): 侧栏拖收关闭与文件树分栏` | `PaneResizer` 加拖收阈值（`collapseThreshold` / `onCollapse` / 待关闭态反馈）、`file-tree-state.ts`（`180–420`，`facet.files.treeWidth`）、文件视图改成「编辑器 + 文件树」并排可拖拽分栏、编辑器不折行改横向滚动 | 左栏 272 拖到 105 进待关闭、拉回 140 取消、再拖到 100 松手关闭且重开仍是 272；文件树与编辑器不重叠（`editor.right <= tree.left`）、收起后编辑器吃满；文件树拖到最大锁在 420，右栏 300 时树 180、编辑器 120；长行在挤窄后出现可拖的横向滚动条 |
| PR8 | `fix(ui): 拖收关闭改成拖动中实时收起` | 待关闭态从「只染色」换成实时折叠预览：`PaneResizer` 增 `collapsePreviewAttr`，越过阈值直接把 `data-*-drag-collapsed` 挂到 `.app`（零渲染、不断指针捕获）、拖回即摘；样式把对应列轨道摁到 `0` 并在窗口内侧边缘留一条强调色提示线；松手先 `flushSync` 收起再摘属性 | 左栏按住拖到 105：列宽实时 `0`、正文扩宽、提示线整条落在 `x=0..6`；不松手拉回 240：属性消失、侧栏重新展开并跟手；再拖到 100 松手：直接关闭、无闪回，重开仍是 272 |
| PR9 | `feat(ui): 拆出提交图谱标签，工作区按领域拆分` | 协议补 `parents` / `refs` 与 `gitCommits` 的 `limit` / `skip`（`hasMore`）、`RightPanelTab` 加 `git-graph`、`WorkspaceLauncher` / `+` 菜单 / 快捷键（`Mod+Shift+H`）注册第四件工具、标签折点 `360 → 640`、极窄档藏关闭按钮、`workspace-body.tsx` 拆成四个标签组件、`packages/ui/src/git/` 抽出共享 Git 原语、`panel.css` 拆出 `changes.css` / `git-graph.css` | 1280 右栏 `420` / `300` 下四标签只剩图标且不压窗口按钮簇、`⤢` 到 `1008` 出文字、折点 `640` 两侧各验一次；420 打开图谱满宽、滚到 `400` 点一条钻入、`⤢` 后左补丁右元信息（`preview.right <= list.left`）、返回图谱滚动位置回到 `400`；640 抽屉里第一次 `Esc` 退回图谱、第二次关抽屉；文件标签并排与图谱保活无回退 |
| PR10 | `refactor(ui): 右栏取消抽屉，窄档也照旧占列` + `feat(ui): 右栏先让位，正文宽度排在最后` | 删掉右栏的 `drawer` 变体与窄档抽屉状态（只留左栏抽屉）、窄档右栏按意图占列；新增 `fitPanelWidth()`（阅读上限为基准 + 拖动优先，基准落盘 `facet.panel.widthViewport`）、中档预算折叠只折左栏并删掉 `priorityPane` | 640 窄档里右栏仍占列、左抽屉照旧；1600→1092 缩小过程中右栏 384→300、正文 840→416；1400 手动拖到 600 再缩到 1300，右栏回到 500、正文列不变 |

状态：PR1 到 PR10 均已落地。

配套：`resolveLayout({ viewportWidth, sidebarPref, panelPref, sidebarIntent, panelIntent, isPanelExpanded, priorityPane })` 返回档位、两栏显隐与宽展开位，`paneMaxWidth()` / `clampDragMax()` 给出实占宽与拖动上限；单测在 `apps/desktop/src/renderer/src/resolve-layout.test.ts`，覆盖 `640 / 879 / 880 / 881 / 899 / 900 / 1012 / 1099 / 1112 / 1215 / 1216 / 1400`、宽展开三段（宽 / 中 / 窄档）、意图位保护、非法输入与优先级换边。样式里的 `--col-*` 只是它的渲染兜底。

## 7. 不在本次范围

- 不引入 Top Layer（`popover`）承载抽屉。
- 不改业务组件（对话、变更、编辑器、设置页）的内部布局。
- 工具的**种类**不做成可配置项：当前四类写在 `panel-state.ts` 的 `PANEL_TABS` 里，加一类要同时改这张表、`workspace-tabs.ts` 的条目与 `workspace-shortcuts.ts` 的键位。已经打开哪些则是运行时的集合（`openTabs`）。
- 不合并生命周期不同的运行时容器（会话通道、`session-hub`、终端通道），`AGENTS.md` 的红线照旧。
- 断点不做成用户可配置项。
