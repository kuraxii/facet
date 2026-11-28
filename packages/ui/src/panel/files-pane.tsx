/**
 * 文件页。
 *
 * 惰性目录树：只列点开过的目录，展开时按需请求，结果按路径缓存。目录在前、文件在后，
 * 名称按目录自己的排序来（主机已排好）。点目录展开或收起，点文件交给宿主打开。
 *
 * 键盘走的是树形导航：上下移动、右键展开或进入、左键收起或回到上一层、回车打开。
 * 文件行还可以拖进输入区：拖过去的是它的相对路径，落地是一枚 `@文件` 胶囊。
 */

import type { FileEntry } from "@facet/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RefreshCw } from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { FileSymbolIcon, FolderSymbolIcon } from "../common/FileSymbolIcon.tsx";
import { FACET_FILE_DRAG_MIME } from "../common/file-drag.ts";
import { IconButton } from "../common/IconButton.tsx";
import { ListRow } from "../common/ListRow.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE, VISUAL_SCALE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { TreeChevron } from "../transcript/chevron.tsx";

export interface FilesPaneProps {
	/** 项目根下某一层的目录内容；path 为空串表示项目根 */
	loadDirectory: (path: string) => Promise<FileEntry[]>;
	/** 打开一个文件 */
	onOpenFile: (path: string) => void;
	/** 当前打开的文件，用来高亮 */
	selectedPath?: string;
}

/** 一层目录的加载状态。 */
interface DirectoryState {
	/** 已经取到的条目 */
	entries?: readonly FileEntry[];
	/** 正在取 */
	isLoading: boolean;
	/** 取失败的原因 */
	error?: string;
}

/** 视口外预渲染行数：快速滚轮不至于先看到空白再来内容 */
const TREE_OVERSCAN = 10;

/** 目录树里的一行。 */
interface Row {
	entry: FileEntry;
	/** 缩进层级，根为 0 */
	depth: number;
}

export function FilesPane({ loadDirectory, onOpenFile, selectedPath }: FilesPaneProps) {
	// 文件行的完整路径与读取失败的原文都走这份提示
	const tip = useHoverTip();
	const { t } = useI18n();
	const [directories, setDirectories] = useState<Readonly<Record<string, DirectoryState>>>({});
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([""]));
	/** 键盘焦点所在的行，键为路径；根目录自身不算一行，用空串占位 */
	const [activePath, setActivePath] = useState<string | undefined>(undefined);
	/** 行元素，键盘移动之后把焦点送过去 */
	const rowRefs = useRef(new Map<string, HTMLButtonElement>());
	/** 树的滚动容器：虚拟化看它算可见窗口 */
	const treeRef = useRef<HTMLDivElement | null>(null);
	/** 已经请求、但那一行还没挂载时的待办焦点 */
	const pendingFocus = useRef<string | null>(null);

	/** 取一层目录；已经取过或正在取就不再发。 */
	const load = useCallback(
		async (path: string): Promise<void> => {
			setDirectories((current) => ({
				...current,
				[path]: { ...current[path], isLoading: true, error: undefined },
			}));
			try {
				const entries = await loadDirectory(path);
				setDirectories((current) => ({ ...current, [path]: { entries, isLoading: false } }));
			} catch (error) {
				setDirectories((current) => ({
					...current,
					[path]: {
						entries: current[path]?.entries,
						isLoading: false,
						error: error instanceof Error ? error.message : String(error),
					},
				}));
			}
		},
		[loadDirectory],
	);

	// 挂载时先取根
	useEffect(() => {
		void load("");
	}, [load]);

	/** 重新取根目录：丢掉已缓存的目录与展开状态，之后按需要重新展开。 */
	const refresh = useCallback((): void => {
		setDirectories({});
		setExpanded(new Set([""]));
		void load("");
	}, [load]);

	/** 展开或收起一个目录。 */
	const toggle = useCallback(
		(entry: FileEntry): void => {
			setExpanded((current) => {
				const next = new Set(current);
				if (next.has(entry.path)) {
					next.delete(entry.path);
				} else {
					next.add(entry.path);
				}
				return next;
			});
			if (directories[entry.path]?.entries === undefined) {
				void load(entry.path);
			}
		},
		[directories, load],
	);

	/** 按展开状态把树摊平成行。 */
	const rows: Row[] = [];
	const walk = (path: string, depth: number): void => {
		const state = directories[path];
		for (const entry of state?.entries ?? []) {
			rows.push({ entry, depth });
			if (entry.kind === "directory" && expanded.has(entry.path)) {
				walk(entry.path, depth + 1);
			}
		}
	};
	walk("", 0);

	/**
	 * 定高虚拟化：行高恒定（`ListRow` 的 `xs` 档），纯算术定位、不绑 `measureElement`。
	 *
	 * 目录树本来就是摊平的行序列（缩进靠 `--files-depth`），所以整表高度就是
	 * `行数 × 行高`；`initialRect` 给的是首帧还没量到容器高度时的可见窗口，量到之后以实测为准。
	 */
	const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: rows.length,
		getScrollElement: () => treeRef.current,
		overscan: TREE_OVERSCAN,
		estimateSize: () => VISUAL_SCALE.control.xs,
		initialRect: { width: 0, height: 600 },
	});
	const items = virtualizer.getVirtualItems();
	const totalSize = rows.length * VISUAL_SCALE.control.xs;

	// 焦点要用的两样都放 ref 里：`focusRow` 因此不必随着行数组重建
	const rowsRef = useRef<readonly Row[]>(rows);
	rowsRef.current = rows;
	const virtualizerRef = useRef(virtualizer);
	virtualizerRef.current = virtualizer;

	/**
	 * 把焦点送到某一行。
	 *
	 * 虚拟化之后目标行可能还没挂载：先让虚拟化器滚到它，再一帧帧等它挂上之后把焦点交过去
	 * （一次请求最多试 30 帧）。
	 */
	const focusRow = useCallback((path: string): void => {
		setActivePath(path);
		const index = rowsRef.current.findIndex((row) => row.entry.path === path);
		if (index >= 0) {
			virtualizerRef.current.scrollToIndex(index, { align: "auto" });
		}
		pendingFocus.current = path;
		let frames = 0;
		const tick = (): void => {
			const target = pendingFocus.current;
			if (target === null) {
				return;
			}
			const node = rowRefs.current.get(target);
			if (node !== undefined) {
				pendingFocus.current = null;
				node.focus();
				return;
			}
			frames += 1;
			if (frames < 30) {
				window.requestAnimationFrame(tick);
			}
		};
		window.requestAnimationFrame(tick);
	}, []);

	const root = directories[""];

	/* 树顶：左放标题，最右端只留刷新（文件树开合由上方文件顶栏按钮控制）。 */
	const header = (
		<div className="tree-head">
			<span className="tree-root">{t("panel.projectFiles")}</span>
			<div className="tree-head-actions">
				<IconButton
					variant="ghost"
					size="sm"
					className="ib"
					aria-label={t("panel.refreshFiles")}
					disabled={root?.isLoading === true}
					onClick={refresh}
				>
					<RefreshCw size={ICON_SIZE.md} />
				</IconButton>
			</div>
		</div>
	);

	if (root?.error !== undefined) {
		return (
			<>
				{header}
				<p className="chg-note is-error">
					{root.error}
					<button type="button" className="chg-retry" onClick={() => void load("")}>
						{t("common.retry")}
					</button>
				</p>
			</>
		);
	}

	if (root?.entries === undefined) {
		return (
			<>
				{header}
				<p className="chg-note">{t("panel.loadingDirectory")}</p>
			</>
		);
	}

	if (rows.length === 0) {
		return (
			<>
				{header}
				<p className="chg-note">{t("panel.emptyDirectory")}</p>
			</>
		);
	}

	/** 键盘导航：上下移动、左右展开收起、回车打开。 */
	const onRowKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, row: Row, index: number): void => {
		const { entry } = row;
		const isDirectory = entry.kind === "directory";
		const isOpen = expanded.has(entry.path);
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const next = rows[event.key === "ArrowDown" ? index + 1 : index - 1];
			if (next !== undefined) {
				focusRow(next.entry.path);
			}
			return;
		}
		if (event.key === "Home" || event.key === "End") {
			event.preventDefault();
			const target = event.key === "Home" ? rows[0] : rows[rows.length - 1];
			if (target !== undefined) {
				focusRow(target.entry.path);
			}
			return;
		}
		if (event.key === "ArrowRight") {
			event.preventDefault();
			if (isDirectory && !isOpen) {
				toggle(entry);
			} else if (isDirectory) {
				const child = rows[index + 1];
				if (child !== undefined && child.depth > row.depth) {
					focusRow(child.entry.path);
				}
			}
			return;
		}
		if (event.key === "ArrowLeft") {
			event.preventDefault();
			if (isDirectory && isOpen) {
				toggle(entry);
				return;
			}
			// 回到同层或上一层的父目录：往前找第一个层级更浅的行
			for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
				const candidate = rows[cursor];
				if (candidate !== undefined && candidate.depth < row.depth) {
					focusRow(candidate.entry.path);
					return;
				}
			}
			return;
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			setActivePath(entry.path);
			if (isDirectory) {
				toggle(entry);
			} else {
				onOpenFile(entry.path);
			}
		}
	};

	return (
		<>
			{header}
			{/* `scroll-y` 是全仓滚动容器的那一套：细拇指、始终预留沟槽（见 `base.css`） */}
			<div className="tree scroll-y" role="tree" aria-label={t("panel.projectFiles")} ref={treeRef}>
				{/* 虚拟画布：高度 = 行数 × 行高，行绝对定位落在自己的 offset 上 */}
				<div className="tree-canvas" style={{ height: totalSize }}>
					{items.map((item): ReactNode => {
						const row = rows[item.index];
						if (row === undefined) {
							return null;
						}
						const index = item.index;
						const { entry, depth } = row;
						const isDirectory = entry.kind === "directory";
						const isOpen = expanded.has(entry.path);
						const state = directories[entry.path];
						const isSelected = entry.path === selectedPath;
						const isActive = entry.path === activePath;
						return (
							<div
								key={entry.path}
								className="tree-item"
								style={{
									position: "absolute",
									top: 0,
									left: 0,
									width: "100%",
									transform: `translateY(${item.start}px)`,
								}}
							>
								<ListRow
									as="button"
									size="xs"
									selected={isSelected}
									ref={(node) => {
										if (node === null) {
											rowRefs.current.delete(entry.path);
										} else {
											rowRefs.current.set(entry.path, node);
										}
									}}
									className="tree-row"
									style={{ "--files-depth": depth } as CSSProperties}
									{...tip.handlers(entry.path)}
									role="treeitem"
									aria-level={depth + 1}
									aria-expanded={isDirectory ? isOpen : undefined}
									aria-selected={isSelected}
									// 文件行可以拖进输入区：拖的是它的相对路径，落地是一枚 `@文件` 胶囊
									draggable={!isDirectory}
									onDragStart={(event) => {
										if (isDirectory) {
											return;
										}
										event.dataTransfer.setData(FACET_FILE_DRAG_MIME, entry.path);
										event.dataTransfer.effectAllowed = "copy";
									}}
									tabIndex={isActive || (activePath === undefined && index === 0) ? 0 : -1}
									onFocus={() => setActivePath(entry.path)}
									onKeyDown={(event) => onRowKeyDown(event, row, index)}
									onClick={() => {
										setActivePath(entry.path);
										if (isDirectory) {
											toggle(entry);
										} else {
											onOpenFile(entry.path);
										}
									}}
								>
									{isDirectory ? (
										<>
											<TreeChevron isOpen={isOpen} size={ICON_SIZE.md} />
											<FolderSymbolIcon name={entry.name} isOpen={isOpen} className="tree-icon" />
										</>
									) : (
										<FileSymbolIcon name={entry.name} className="tree-icon" />
									)}
									<span className="tree-name">{entry.name}</span>
									{state?.isLoading === true ? <span className="tree-note">…</span> : null}
									{state?.error === undefined ? null : (
										<span className="tree-note is-error" {...tip.handlers(state.error)}>
											{t("panel.readFailed")}
										</span>
									)}
								</ListRow>
							</div>
						);
					})}
				</div>
			</div>
			{tip.render()}
		</>
	);
}
