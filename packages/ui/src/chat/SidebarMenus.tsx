/**
 * 侧栏里的两个右键菜单：项目与会话。
 *
 * 两者长得一样，行为也一样：点外面、`Esc`、滚动都收起，打开后焦点落到第一个菜单项；改名
 * 与移除都就地展开输入框与二次确认。临时的编辑状态与忙碌/错误留在这里，真正做什么由调用方
 * 给（返回 Promise，抛错就把原话显示在菜单里）。
 */
import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Input } from "../common/Input.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { isComposingKey } from "../keys.ts";
import type { SidebarProject, SidebarSession } from "./sidebar-model.ts";

/** 菜单在视口里的位置。 */
export interface MenuPosition {
	/** 左边距，px */
	x: number;
	/** 上边距，px */
	y: number;
}

/** 菜单外壳：负责点外面 / Esc / 滚动收起，以及打开后聚焦第一项。 */
function useMenuDismiss(selector: string, isOpen: boolean, close: () => void): void {
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.closest(selector) !== null) return;
			close();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// 吃掉这次按键：外层抽屉看 `defaultPrevented`，一次 Esc 只关最内层
			event.preventDefault();
			close();
		};
		const onScroll = () => close();
		const frame = requestAnimationFrame(() => {
			document.querySelector<HTMLButtonElement>(`${selector} .sb-menu-item`)?.focus();
		});
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("scroll", onScroll, true);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("scroll", onScroll, true);
		};
	}, [close, isOpen, selector]);
}

/** 项目菜单的参数。 */
export interface ProjectMenuProps {
	/** 右键指向的项目 */
	project: SidebarProject;
	/** 视口位置 */
	position: MenuPosition | undefined;
	/** 收起菜单 */
	onClose: () => void;
	/** 改名；返回的 Promise 失败时把错误显示在菜单里 */
	onRename: (id: string, name: string | undefined) => Promise<void>;
	/** 移除 */
	onRemove: (id: string) => Promise<void>;
	/** 在主机上打开目录 */
	onReveal: (id: string) => Promise<void>;
}

/** 项目右键菜单。 */
export function ProjectMenu({
	project,
	position,
	onClose,
	onRename,
	onRemove,
	onReveal,
}: ProjectMenuProps): ReactNode {
	const { t } = useI18n();
	const [renaming, setRenaming] = useState<{ id: string; value: string } | undefined>(undefined);
	const [removingId, setRemovingId] = useState<string | undefined>(undefined);
	const [isBusy, setIsBusy] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const inputRef = useRef<HTMLInputElement>(null);

	/** 跑一次项目操作：成功收起菜单，失败把原话留在菜单里。 */
	const run = async (work: () => Promise<void>): Promise<void> => {
		setIsBusy(true);
		setError(undefined);
		try {
			await work();
			onClose();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setIsBusy(false);
		}
	};

	useMenuDismiss(".sb-project-menu", true, onClose);

	return (
		<div
			role="menu"
			aria-label={t("sidebar.projectMenu")}
			className="sb-pop sb-session-menu sb-context-menu sb-project-menu"
			style={{ left: position?.x, top: position?.y }}
			onContextMenu={(event) => event.preventDefault()}
		>
			{renaming === undefined ? null : (
				<label className="sb-rename">
					<Input
						ref={inputRef}
						size="sm"
						value={renaming.value}
						onChange={(event) => setRenaming({ id: renaming.id, value: event.target.value })}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !isComposingKey(event)) {
								void submit();
							}
							if (event.key === "Escape") {
								event.preventDefault();
								setRenaming(undefined);
							}
						}}
						placeholder={t("sidebar.projectName")}
						aria-label={t("sidebar.projectName")}
					/>
					<button type="button" className="sb-opt-action" disabled={isBusy} onClick={() => void submit()}>
						{t("common.save")}
					</button>
				</label>
			)}

			{removingId === project.id ? (
				<div className="sb-confirm">
					<span className="sb-confirm-text">{t("sidebar.removeProjectHint")}</span>
					<div className="sb-confirm-actions">
						<button
							type="button"
							className="sb-opt-action is-danger"
							disabled={isBusy}
							onClick={() => {
								const id = project.id;
								if (id === undefined) {
									return;
								}
								void run(async () => await onRemove(id));
							}}
						>
							{t("common.remove")}
						</button>
						<button type="button" className="sb-opt-action" onClick={() => setRemovingId(undefined)}>
							{t("common.cancel")}
						</button>
					</div>
				</div>
			) : (
				<div className="sb-menu-actions">
					<button
						type="button"
						className="sb-menu-item"
						onClick={() => setRenaming({ id: project.id ?? "", value: project.name })}
					>
						{t("common.rename")}
					</button>
					<button
						type="button"
						className="sb-menu-item"
						disabled={isBusy}
						onClick={() => void run(async () => await onReveal(project.id ?? ""))}
					>
						{t("sidebar.revealProject")}
					</button>
					<button type="button" className="sb-menu-item is-danger" onClick={() => setRemovingId(project.id)}>
						{t("common.remove")}
					</button>
				</div>
			)}

			{error === undefined ? null : <p className="sb-menu-error">{error}</p>}
		</div>
	);

	/** 提交改名；名字清空时恢复目录名。 */
	async function submit(): Promise<void> {
		const target = renaming;
		if (target === undefined) {
			return;
		}
		const trimmed = target.value.trim();
		await run(async () => await onRename(target.id, trimmed.length > 0 ? trimmed : undefined));
	}
}

/** 会话菜单的参数。 */
export interface SessionMenuProps {
	/** 右键指向的会话 */
	session: SidebarSession;
	/** 视口位置 */
	position: MenuPosition | undefined;
	/** 收起菜单 */
	onClose: () => void;
	/** 改名 */
	onRename: (path: string, name: string | undefined) => Promise<void>;
	/** 删除会话 */
	onDelete: (path: string) => Promise<void>;
	/** 在系统里打开会话所在目录 */
	onReveal: (cwd: string) => Promise<void>;
}

/** 会话右键菜单。 */
export function SessionMenu({
	session,
	position,
	onClose,
	onRename,
	onDelete,
	onReveal,
}: SessionMenuProps): ReactNode {
	const { t } = useI18n();
	const [renameValue, setRenameValue] = useState<string | undefined>(undefined);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isBusy, setIsBusy] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);

	/** 跑一次会话操作：成功收起菜单，失败把原话留在菜单里。 */
	const run = async (work: () => Promise<void>): Promise<void> => {
		setIsBusy(true);
		setError(undefined);
		try {
			await work();
			onClose();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setIsBusy(false);
		}
	};

	useMenuDismiss(".sb-session-menu", true, onClose);

	/** 提交改名；名字清空时恢复默认标题。 */
	const submit = async (): Promise<void> => {
		if (renameValue === undefined) {
			return;
		}
		const trimmed = renameValue.trim();
		await run(async () => await onRename(session.path, trimmed.length > 0 ? trimmed : undefined));
	};

	return (
		<div
			role="menu"
			aria-label={t("sidebar.sessionMenu")}
			className="sb-pop sb-session-menu sb-context-menu"
			style={{ left: position?.x, top: position?.y }}
			onContextMenu={(event) => event.preventDefault()}
		>
			{renameValue === undefined ? null : (
				<label className="sb-rename">
					<Input
						size="sm"
						value={renameValue}
						onChange={(event) => setRenameValue(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !isComposingKey(event)) {
								void submit();
							}
							if (event.key === "Escape") {
								event.preventDefault();
								setRenameValue(undefined);
							}
						}}
						placeholder={t("sidebar.sessionName")}
						aria-label={t("sidebar.sessionName")}
					/>
					<button type="button" className="sb-opt-action" disabled={isBusy} onClick={() => void submit()}>
						{t("common.save")}
					</button>
				</label>
			)}

			{isDeleting ? (
				<div className="sb-confirm">
					<span className="sb-confirm-text">{t("sidebar.deleteSessionHint")}</span>
					<div className="sb-confirm-actions">
						<button
							type="button"
							className="sb-opt-action is-danger"
							disabled={isBusy}
							onClick={() => void run(async () => await onDelete(session.path))}
						>
							{t("common.delete")}
						</button>
						<button type="button" className="sb-opt-action" onClick={() => setIsDeleting(false)}>
							{t("common.cancel")}
						</button>
					</div>
				</div>
			) : (
				<div className="sb-menu-actions">
					<button type="button" className="sb-menu-item" onClick={() => setRenameValue(session.title)}>
						{t("common.rename")}
					</button>
					<button
						type="button"
						className="sb-menu-item"
						disabled={isBusy}
						onClick={() => void run(async () => await onReveal(session.cwd))}
					>
						{t("sidebar.revealSessionFolder")}
					</button>
					<button type="button" className="sb-menu-item is-danger" onClick={() => setIsDeleting(true)}>
						{t("common.delete")}
					</button>
				</div>
			)}

			{error === undefined ? null : <p className="sb-menu-error">{error}</p>}
		</div>
	);
}

/** 右键事件的视口位置，夹进窗口内。 */
export function menuPositionOf(event: ReactMouseEvent<HTMLElement>): MenuPosition {
	return {
		x: Math.min(event.clientX, window.innerWidth - 240),
		y: Math.min(event.clientY, window.innerHeight - 180),
	};
}
