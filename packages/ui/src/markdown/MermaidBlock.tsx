/**
 * 流程图渲染。
 *
 * 与代码块同一套卡片：标题栏常态隐身，悬浮才出现复制与源码切换。图表交给 mermaid 自己渲染，
 * 配色取界面上的 CSS 变量，节点文字走 SVG（`htmlLabels` 关掉），宽度跟着对话列走。
 */
import { Check, Code2, Copy, Workflow } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

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

/** 把界面上的语义色读成 mermaid 的 themeVariables。 */
function readThemeVariables(): Record<string, string> {
	const css = getComputedStyle(document.documentElement);
	const read = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
	const card = read("--card", "#1b1b1f");
	const surface = read("--surface2", "#232327");
	const line = read("--line", "#2e2e33");
	const text = read("--t1", "#fafafa");
	const muted = read("--t2", "#a1a1aa");
	const font = read("--font-sans", "sans-serif");
	return {
		background: card,
		mainBkg: surface,
		primaryColor: surface,
		primaryTextColor: text,
		primaryBorderColor: line,
		secondaryColor: surface,
		secondaryTextColor: text,
		secondaryBorderColor: line,
		tertiaryColor: card,
		tertiaryTextColor: text,
		tertiaryBorderColor: line,
		nodeBkg: surface,
		nodeBorder: line,
		nodeTextColor: text,
		clusterBkg: card,
		clusterBorder: line,
		lineColor: muted,
		textColor: text,
		titleColor: text,
		edgeLabelBackground: card,
		labelBackground: card,
		labelTextColor: text,
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

	const showsSource = showSource || isLoading || svg === undefined;

	return (
		<div className="code-card mermaid-card">
			<div className="code-card-head">
				<span className="code-lang">mermaid</span>
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
				<div className="mermaid-body">
					{/* 跳过安全检查：SVG 由 mermaid 以 securityLevel: "strict" 生成 */}
					{/* biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid 生成的 SVG */}
					<div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg ?? "" }} />
				</div>
			)}
		</div>
	);
}
