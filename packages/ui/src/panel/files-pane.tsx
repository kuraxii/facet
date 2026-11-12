/**
 * 文件页。
 *
 * 惰性目录树：只列点开过的目录，展开时按需请求，结果按路径缓存。目录在前、文件在后，
 * 名称按目录自己的排序来（主机已排好）。点目录展开或收起，点文件交给宿主打开。
 */

import type { FileEntry } from "@facet/protocol";
import { File as FileGlyph, Folder, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ChevronIcon } from "../transcript/chevron.tsx";

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

/** 目录树里的一行。 */
interface Row {
	entry: FileEntry;
	/** 缩进层级，根为 0 */
	depth: number;
}

export function FilesPane({ loadDirectory, onOpenFile, selectedPath }: FilesPaneProps) {
	const [directories, setDirectories] = useState<Readonly<Record<string, DirectoryState>>>({});
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([""]));

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

	const root = directories[""];

	const header = (
		<div className="tree-head">
			<span className="tree-root">项目文件</span>
			<button
				type="button"
				className="ib"
				aria-label="刷新文件树"
				title="刷新文件树"
				disabled={root?.isLoading === true}
				onClick={refresh}
			>
				<RefreshCw size={13} strokeWidth={1.5} />
			</button>
		</div>
	);

	if (root?.error !== undefined) {
		return (
			<>
				{header}
				<p className="chg-note is-error">
					{root.error}
					<button type="button" className="chg-retry" onClick={() => void load("")}>
						重试
					</button>
				</p>
			</>
		);
	}

	if (root?.entries === undefined) {
		return (
			<>
				{header}
				<p className="chg-note">正在读取目录…</p>
			</>
		);
	}

	if (rows.length === 0) {
		return (
			<>
				{header}
				<p className="chg-note">这个目录是空的。</p>
			</>
		);
	}

	return (
		<>
			{header}
			<div className="tree" role="tree" aria-label="项目文件">
				{rows.map(({ entry, depth }): ReactNode => {
					const isDirectory = entry.kind === "directory";
					const isOpen = expanded.has(entry.path);
					const state = directories[entry.path];
					const isSelected = entry.path === selectedPath;
					return (
						<div key={entry.path} className="tree-item">
							<button
								type="button"
								className={isSelected ? "tree-row is-on" : "tree-row"}
								style={{ paddingLeft: `${6 + depth * 12}px` }}
								title={entry.path}
								aria-expanded={isDirectory ? isOpen : undefined}
								onClick={() => (isDirectory ? toggle(entry) : onOpenFile(entry.path))}
							>
								{isDirectory ? <ChevronIcon isOpen={isOpen} size={11} /> : <span className="tree-spacer" />}
								{isDirectory ? (
									<Folder size={13} strokeWidth={1.5} className="tree-icon" />
								) : (
									<FileGlyph size={13} strokeWidth={1.5} className="tree-icon" />
								)}
								<span className="tree-name">{entry.name}</span>
								{state?.isLoading === true ? <span className="tree-note">…</span> : null}
								{state?.error === undefined ? null : (
									<span className="tree-note is-error" title={state.error}>
										读取失败
									</span>
								)}
							</button>
						</div>
					);
				})}
			</div>
		</>
	);
}
