/**
 * 流程图渲染。
 *
 * 与代码块同一套卡片：标题栏常态隐身，悬浮才出现复制与源码切换。图表交给 mermaid 自己渲染，
 * 配色取界面上的 CSS 变量，节点文字走 SVG（`htmlLabels` 关掉），宽度跟着对话列走。
 */
import { Check, Code2, Copy, Maximize2, Workflow, ZoomIn, ZoomOut } from "lucide-react";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";

/** 缩放的上下限与单步倍率。1 倍是铺满宽度，不再往更小缩。 */
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.25;

export interface MermaidBlockProps {
	/** 库解析出来的代码块节点 */
	node: { code?: string | undefined; raw?: string | undefined; loading?: boolean | undefined };
	/** 当前是否深色，库会传进来；配色一律取界面变量，这里不用 */
	isDark?: boolean | undefined;
}

/**
 * mermaid 的渲染共用内部状态，几张图同时画会互相踩，排在一条链上串行执行。
 */
let renderQueue: Promise<unknown> = Promise.resolve();

function enqueueRender<T>(run: () => Promise<T>): Promise<T> {
	const next = renderQueue.then(run, run);
	renderQueue = next.catch(() => undefined);
	return next;
}

/** 画出来的 SVG 有内容才算成功：图被吞掉时 mermaid 只留一个空壳。 */
function hasDiagramContent(svg: string): boolean {
	const template = document.createElement("template");
	template.innerHTML = svg;
	return (template.content.querySelector("svg")?.querySelectorAll("g, text, rect").length ?? 0) > 1;
}

/**
 * 补几处 themeVariables 管不到的默认样式。
 *
 * 边标签的默认做法是给文字描一圈同色边再把底块做成半透明，字会显得粗；状态图的状态名默认拿
 * `stateBkg` 当文字色，深色底上等于看不见。
 */
function themeCss(palette: Record<string, string>): string {
	const text = palette.textColor ?? "#fafafa";
	return `
		.edgeLabel .label, .edgeLabel .label * { stroke: none; }
		.edgeLabel rect { opacity: 1; stroke: none; }
		.stateLabel text, .stateGroup .state-title, .statediagram-state .nodeLabel { fill: ${text}; }
		.stateLabel .box { opacity: 1; }
	`;
}

/** 把界面上的语义色读成 mermaid 的 themeVariables。 */
function readThemeVariables(): Record<string, string> {
	const css = getComputedStyle(document.documentElement);
	const read = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
	const card = read("--card", "#1b1b1f");
	const surface = read("--surface2", "#232327");
	// 边框与线条要比底色亮一档，否则深色底上几乎看不见
	const border = read("--t3", "#71717a");
	const text = read("--t1", "#fafafa");
	const muted = read("--t2", "#a1a1aa");
	const font = read("--font-sans", "sans-serif");
	return {
		background: card,
		mainBkg: surface,
		primaryColor: surface,
		primaryTextColor: text,
		primaryBorderColor: border,
		secondaryColor: surface,
		secondaryTextColor: text,
		secondaryBorderColor: border,
		tertiaryColor: card,
		tertiaryTextColor: text,
		tertiaryBorderColor: border,
		nodeBkg: surface,
		nodeBorder: border,
		nodeTextColor: text,
		clusterBkg: card,
		clusterBorder: border,
		lineColor: muted,
		textColor: text,
		titleColor: text,
		edgeLabelBackground: card,
		labelBackground: card,
		labelTextColor: text,
		// 时序图：坐标轴、消息线、激活条与备注块，缺一个就会在深色底上掉线
		actorBkg: surface,
		actorBorder: border,
		actorTextColor: text,
		actorLineColor: border,
		signalColor: muted,
		signalTextColor: text,
		activationBkgColor: surface,
		activationBorderColor: border,
		noteBkgColor: surface,
		noteBorderColor: border,
		noteTextColor: text,
		labelBoxBkgColor: surface,
		labelBoxBorderColor: border,
		loopTextColor: text,
		sequenceNumberColor: card,
		// 状态图：状态块与转移线。状态名默认取 `stateBkg` 当文字色（等于画在底色上），必须单列
		stateBkg: surface,
		stateBorder: border,
		stateLabelColor: text,
		labelColor: text,
		transitionColor: muted,
		transitionLabelColor: text,
		fontFamily: font,
		fontSize: "14px",
	};
}

/** 复制原始定义。 */
function CopyButton({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) {
			return;
		}
		const timer = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<button
			type="button"
			className="code-copy"
			aria-label={copied ? "已复制" : "复制定义"}
			title={copied ? "已复制" : "复制定义"}
			onClick={() => {
				void navigator.clipboard?.writeText(code).then(
					() => setCopied(true),
					() => setCopied(false),
				);
			}}
		>
			{copied ? <Check size={13} strokeWidth={1.5} /> : <Copy size={13} strokeWidth={1.5} />}
		</button>
	);
}

/**
 * 流程图卡片。
 *
 * 围栏还在写入时先显示源码，写完再画图；画图失败时留在源码并给出提示，不把整段正文带崩。
 */
export function MermaidBlock({ node }: MermaidBlockProps) {
	const code = (node.code ?? "").trim();
	const isLoading = node.loading === true;
	const [svg, setSvg] = useState<string | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	const [showSource, setShowSource] = useState(false);
	const [palette, setPalette] = useState<Record<string, string> | undefined>(undefined);
	const revision = useRef(0);
	// mermaid 的临时容器按 id 命名，同一页里的多张图必须各不相同，否则会互相覆盖掉
	const instance = useId().replace(/[^a-zA-Z0-9]/g, "");

	// 配色取界面变量；换主题时根节点的 data-theme 会变，重取一次就够
	useEffect(() => {
		if (typeof document === "undefined") {
			return;
		}
		const update = (): void => setPalette(readThemeVariables());
		update();
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (code.length === 0 || isLoading || palette === undefined) {
			return;
		}
		const current = ++revision.current;
		let cancelled = false;
		// 流式期间内容一跳一跳，等它停下来再画
		const timer = setTimeout(() => {
			void import("mermaid").then(
				async (module) => {
					if (cancelled || current !== revision.current) {
						return;
					}
					const mermaid = module.default;
					try {
						// 初始化与取图放在同一段串行任务里：中途被别的卡片重新 initialize 会把这一张弄空
						const rendered = await enqueueRender(() => {
							mermaid.initialize({
								startOnLoad: false,
								securityLevel: "strict",
								suppressErrorRendering: true,
								theme: "base",
								themeVariables: palette,
								flowchart: { htmlLabels: false, curve: "basis" },
								class: { htmlLabels: false },
								themeCSS: themeCss(palette),
							});
							return mermaid.render(`facet-mermaid-${instance}-${current}`, code);
						});
						if (cancelled || current !== revision.current) {
							return;
						}
						if (!hasDiagramContent(rendered.svg)) {
							setSvg(undefined);
							setError("这张图没有画出来");
							return;
						}
						setSvg(rendered.svg);
						setError(undefined);
						setView({ scale: 1, x: 0, y: 0 });
					} catch (cause) {
						if (cancelled || current !== revision.current) {
							return;
						}
						setSvg(undefined);
						setError(cause instanceof Error ? cause.message.split("\n")[0] : String(cause));
					}
				},
				() => {
					if (!cancelled && current === revision.current) {
						setError("流程图组件没有加载起来");
					}
				},
			);
		}, 160);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [code, isLoading, palette, instance]);

	// 视图：1 表示铺满宽度，缩放与平移都叠在它上面
	const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
	const [isPanning, setIsPanning] = useState(false);
	const panStart = useRef<{ x: number; y: number; viewX: number; viewY: number } | undefined>(undefined);

	const zoomBy = useCallback((factor: number) => {
		setView((current) => {
			const scale = Math.min(Math.max(current.scale * factor, MIN_SCALE), MAX_SCALE);
			// 回到 1 倍就是把图放回原位，不留偏移
			return scale <= 1 ? { scale, x: 0, y: 0 } : { ...current, scale };
		});
	}, []);

	/**
	 * 滚轮缩放要能拦住默认行为，React 的 onWheel 是 passive 的，只能挂原生监听。
	 *
	 * 视图容器要等图画出来才挂载，所以用回调 ref 在挂上时接、摘时断，不能按 ref 的值在
	 * effect 里取一次。
	 */
	const detachWheel = useRef<(() => void) | undefined>(undefined);
	const attachViewport = useCallback(
		(element: HTMLDivElement | null) => {
			detachWheel.current?.();
			detachWheel.current = undefined;
			if (element === null) {
				return;
			}
			const onWheel = (event: WheelEvent): void => {
				// 只有按着修饰键才缩放，普通滚轮留给页面滚动
				if (!event.ctrlKey && !event.metaKey) {
					return;
				}
				event.preventDefault();
				zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
			};
			element.addEventListener("wheel", onWheel, { passive: false });
			detachWheel.current = () => element.removeEventListener("wheel", onWheel);
		},
		[zoomBy],
	);
	useEffect(() => () => detachWheel.current?.(), []);

	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (view.scale <= 1) {
			return;
		}
		// 先记起点再抓指针：抓取失败（指针已失效）时拖动仍然可用
		panStart.current = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
		event.currentTarget.setPointerCapture(event.pointerId);
		setIsPanning(true);
	};

	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const start = panStart.current;
		if (start === undefined) {
			return;
		}
		setView((current) => ({
			...current,
			x: start.viewX + (event.clientX - start.x),
			y: start.viewY + (event.clientY - start.y),
		}));
	};

	const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
		panStart.current = undefined;
		setIsPanning(false);
		event.currentTarget.releasePointerCapture(event.pointerId);
	};

	const showsSource = showSource || isLoading || svg === undefined;

	return (
		<div className="code-card mermaid-card">
			<div className="code-card-head">
				<span className="code-lang">mermaid</span>
				{svg === undefined || showSource ? null : (
					<>
						<button
							type="button"
							className="code-copy"
							aria-label="缩小"
							title="缩小"
							disabled={view.scale <= MIN_SCALE}
							onClick={() => zoomBy(1 / ZOOM_STEP)}
						>
							<ZoomOut size={13} strokeWidth={1.5} />
						</button>
						<button
							type="button"
							className="code-copy"
							aria-label="放大"
							title="放大"
							disabled={view.scale >= MAX_SCALE}
							onClick={() => zoomBy(ZOOM_STEP)}
						>
							<ZoomIn size={13} strokeWidth={1.5} />
						</button>
						<button
							type="button"
							className="code-copy"
							aria-label="适应宽度"
							title="适应宽度"
							onClick={() => setView({ scale: 1, x: 0, y: 0 })}
						>
							<Maximize2 size={13} strokeWidth={1.5} />
						</button>
					</>
				)}
				{svg === undefined ? null : (
					<button
						type="button"
						className="code-copy"
						aria-label={showSource ? "显示图表" : "显示源码"}
						title={showSource ? "显示图表" : "显示源码"}
						onClick={() => setShowSource((shown) => !shown)}
					>
						{showSource ? <Workflow size={13} strokeWidth={1.5} /> : <Code2 size={13} strokeWidth={1.5} />}
					</button>
				)}
				<CopyButton code={code} />
			</div>
			{showsSource ? (
				<>
					<pre className="mermaid-source">{code}</pre>
					{error === undefined ? null : <p className="mermaid-note">{error}</p>}
				</>
			) : (
				<div
					className={
						view.scale > 1
							? isPanning
								? "mermaid-viewport is-zoomed is-panning"
								: "mermaid-viewport is-zoomed"
							: "mermaid-viewport"
					}
					ref={attachViewport}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onPointerCancel={handlePointerUp}
					onDoubleClick={() => setView({ scale: 1, x: 0, y: 0 })}
					role="img"
					aria-label="流程图"
				>
					<div
						className="mermaid-diagram"
						style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
						// 跳过安全检查：SVG 由 mermaid 以 securityLevel: "strict" 生成
						// biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid 生成的 SVG
						dangerouslySetInnerHTML={{ __html: svg ?? "" }}
					/>
				</div>
			)}
		</div>
	);
}
