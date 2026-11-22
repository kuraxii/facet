/**
 * 行外壳、行尾动作与计时用的小工具。
 *
 * 对话面板里每一行都长在同一只 `Shell` 上：外壳负责 `is-streaming` 与对话导航的定位键，
 * 行尾的复制按钮、正在计时的时长都挂在这一层。这里只有渲染与计时，不碰渲染单元的投影。
 */
import type { Part } from "@facet/client-core";
import { Check, Copy } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import type { DisplayRow } from "./group.ts";
import { MessageAction } from "./message-action.tsx";

/** 重试倒计时的文案,没有剩余时间时为空。 */
export function retryDelayText(
	delayMs: number,
	startedAt: number | undefined,
	now: number | undefined,
	t: ReturnType<typeof useI18n>["t"],
): string | undefined {
	if (delayMs <= 0 || startedAt === undefined || now === undefined) {
		return undefined;
	}
	const left = Math.ceil((startedAt + delayMs - now) / 1000);
	return left <= 0 ? t("transcript.retrying") : t("transcript.retryIn", { seconds: left });
}

export function useNow(isTicking: boolean): number | undefined {
	const [now, setNow] = useState<number | undefined>(undefined);
	useEffect(() => {
		if (!isTicking) {
			setNow(undefined);
			return;
		}
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [isTicking]);
	// 刚进入计时的第一帧还没有定时器时间，先用当前时刻，避免时长闪空
	return isTicking ? (now ?? Date.now()) : now;
}

/** 默认收起的行。 */
export function isCollapsedByDefault(kind: DisplayRow["kind"]): boolean {
	return kind === "meta";
}

export function textOf(parts: readonly Part[]): string {
	return parts
		.map((part) => (part.kind === "text" ? part.text : ""))
		.join("")
		.trim();
}

/**
 * 复制一段原文。
 *
 * 复制成功之后对勾亮一小会儿再换回复制图标，避免连点时分不清是没反应还是已经复制过。
 */
export function CopyButton({
	text,
	onCopy,
	isReveal,
}: {
	text: string;
	onCopy: (text: string) => void;
	isReveal?: boolean;
}) {
	const { t } = useI18n();
	const [isDone, setIsDone] = useState(false);
	useEffect(() => {
		if (!isDone) {
			return;
		}
		const timer = setTimeout(() => setIsDone(false), 1200);
		return () => clearTimeout(timer);
	}, [isDone]);
	return (
		<MessageAction
			action="copy"
			label={isDone ? t("transcript.copied") : t("transcript.copy")}
			isDone={isDone}
			isReveal={isReveal === true}
			onClick={() => {
				onCopy(text);
				setIsDone(true);
			}}
		>
			{isDone ? <Check size={ICON_SIZE.md} /> : <Copy size={ICON_SIZE.md} />}
		</MessageAction>
	);
}

/**
 * 一行外壳。
 *
 * 正在流式写入的行带上 is-streaming：样式据此把它排除在视口裁剪之外，
 * 新增内容始终有真实的布局盒模型。
 */
export function Shell({
	className,
	children,
	outlineKey,
	isStreaming = false,
}: {
	className: string;
	children: ReactNode;
	/** 对话导航的定位键，只在用户消息行上给 */
	outlineKey?: string;
	/** 这一行是否仍在增长 */
	isStreaming?: boolean;
}) {
	return (
		<div
			className={isStreaming ? `row ${className} is-streaming` : `row ${className}`}
			data-outline-key={outlineKey}
		>
			{children}
		</div>
	);
}

/**
 * 收起体：留在 DOM 里，收起时标成 `hidden="until-found"`。
 *
 * 这样浏览器自己的页内查找（`Ctrl+F` / `⌘F`）能命中折叠起来的内容：命中前浏览器派一个
 * `beforematch` 事件，我们在这里把这一块展开，查找结果就能滚到眼前——`display: none` 的
 * 内容查找看不见，这也是不用条件渲染的原因。
 *
 * 属性用 `setAttribute` 直接写而不是走 JSX：React 把 `hidden` 当布尔属性，传字符串只会得到
 * `hidden=""`（那是 `display: none`，正好把查找也一起关掉）。写在 `useLayoutEffect` 里是为了
 * 赶在首次绘制之前——晚一帧的话，收起的折叠体会先亮一下再消失。
 */
export function useUntilFound<T extends HTMLElement>(
	isOpen: boolean,
	reveal: () => void,
): RefObject<T | null> {
	const ref = useRef<T>(null);
	// 回调用 ref 兜住：调用方多半是内联箭头函数，每次渲染都换引用，不该因此重绑监听
	const revealRef = useRef(reveal);
	revealRef.current = reveal;
	useLayoutEffect(() => {
		const node = ref.current;
		if (node === null) {
			return;
		}
		if (isOpen) {
			node.removeAttribute("hidden");
			return;
		}
		node.setAttribute("hidden", "until-found");
		const onBeforeMatch = (): void => {
			revealRef.current();
		};
		// `beforematch` 只有 Chromium 系覆盖；别的引擎里折叠体仍是普通收起，不影响其它功能
		node.addEventListener("beforematch", onBeforeMatch);
		return () => node.removeEventListener("beforematch", onBeforeMatch);
	}, [isOpen]);
	return ref;
}
