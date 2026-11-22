/**
 * 项目过滤器。
 *
 * 一个按钮加一层浮层：浮层里是搜索框、项目清单与「添加项目」。浮层挂在按钮下方，放不下
 * 就向上弹；打开期间焦点锁在里面，`Tab` 循环、`Esc` 关掉并把焦点还给按钮。点浮层外面同样
 * 收起（点右键菜单里的东西不算外面）。
 *
 * 浮层自己的临时状态（关键字、朝上朝下）留在这里；「选哪个目录」由调用方决定。
 */
import { Plus, Search } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import type { HoverTip } from "../tip.tsx";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { FolderIcon } from "../transcript/icons.tsx";
import { filterProjects, scopeLabel } from "./session-list-model.ts";
import { type SidebarProject, samePath } from "./sidebar-model.ts";

/** 过滤器面板最小可用高度之外的余量，与 `sb-pop` 的上限一起决定向哪边弹。 */
const POPOVER_MAX_HEIGHT = 320;

/** 浮层离窗口边缘的留白。 */
const POPOVER_MARGIN = 12;

/** 项目过滤器的参数。 */
export interface ProjectFilterProps {
	/** 已经按当前范围算好的项目清单 */
	projects: readonly SidebarProject[];
	/** 此刻的范围目录；`undefined` 表示全部项目 */
	scopeCwd: string | undefined;
	/** 过滤器是否展开（由调用方持有，右键菜单关闭时也会连带收起） */
	isOpen: boolean;
	/** 面板元素：调用方点外部判定要用 */
	panelRef: React.RefObject<HTMLDivElement | null>;
	/** 项目清单上一次刷新失败 */
	isStale: boolean;
	/** 过滤器的悬浮提示状态机 */
	tip: HoverTip;
	/** 开合切换 */
	onToggle: () => void;
	/** 选一个目录；`undefined` 是「全部项目」 */
	onSelect: (cwd: string | undefined) => void;
	/** 右键一个项目：打开它的菜单 */
	onOpenMenu: (project: SidebarProject, position: { x: number; y: number }) => void;
	/** 打开添加项目的对话框 */
	onAddProject: () => void;
	/** 重新拉项目清单 */
	onRefresh: () => void;
	/** 收起浮层并把焦点还给按钮 */
	onClose: () => void;
}

/** 点击组件外部时关闭浮层，点击触发器本身不算外部。 */
function useDismiss(
	ref: React.RefObject<HTMLElement | null>,
	isOpen: boolean,
	close: () => void,
	ignoreSelector?: string,
): void {
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}
			if (ref.current?.contains(target) === true) {
				return;
			}
			if (ignoreSelector !== undefined && target instanceof Element && target.closest(ignoreSelector)) {
				return;
			}
			close();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [close, ignoreSelector, isOpen, ref]);
}

export function ProjectFilter({
	projects,
	scopeCwd,
	isOpen,
	panelRef,
	isStale,
	tip,
	onToggle,
	onSelect,
	onOpenMenu,
	onAddProject,
	onRefresh,
	onClose,
}: ProjectFilterProps): ReactNode {
	const { t } = useI18n();
	const [keyword, setKeyword] = useState("");
	const [isUp, setIsUp] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	useDismiss(rootRef, isOpen, onClose, ".sb-project-menu, .sb-session-menu");

	// 浮层打开时量一次可用空间：下方放不下且上方更宽裕就向上弹，焦点移进搜索框
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const trigger = triggerRef.current;
		const panel = panelRef.current;
		if (trigger !== null && panel !== null) {
			const rect = trigger.getBoundingClientRect();
			const below = window.innerHeight - rect.bottom;
			const above = rect.top;
			setIsUp(below < Math.min(panel.scrollHeight + POPOVER_MARGIN, POPOVER_MAX_HEIGHT) && above > below);
		}
		const frame = requestAnimationFrame(() => searchRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [isOpen, panelRef]);

	/** 浮层内循环焦点，打开期间不把焦点交给对话框之外。 */
	const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onClose();
			triggerRef.current?.focus();
			return;
		}
		if (event.key !== "Tab") {
			return;
		}
		const panel = panelRef.current;
		if (panel === null) {
			return;
		}
		const items = [...panel.querySelectorAll<HTMLElement>("button:not([disabled]), input")].filter(
			(element) => element.offsetParent !== null,
		);
		const first = items[0];
		const last = items[items.length - 1];
		if (first === undefined || last === undefined) {
			return;
		}
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
			return;
		}
		if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	const matches = filterProjects(projects, keyword);

	return (
		<div className="sb-filter" ref={rootRef}>
			<button
				type="button"
				ref={triggerRef}
				className={isOpen ? "sb-filter-btn is-open" : "sb-filter-btn"}
				aria-haspopup="dialog"
				aria-expanded={isOpen}
				onClick={() => {
					onToggle();
					onRefresh();
				}}
			>
				<FolderIcon size={ICON_SIZE.md} />
				<span className="sb-filter-name ell">{scopeLabel(projects, scopeCwd, t("sidebar.allProjects"))}</span>
				<ChevronIcon isOpen={isOpen} />
			</button>

			{isOpen ? (
				// biome-ignore lint/a11y/useSemanticElements: 这是挂在过滤器按钮下的浮层，用不到 fieldset 的表单语义
				<div
					ref={panelRef}
					className={isUp ? "sb-pop is-up" : "sb-pop"}
					role="group"
					aria-label={t("sidebar.chooseProject")}
					onKeyDown={trapFocus}
				>
					<label className="sb-search">
						<Search size={ICON_SIZE.md} />
						<input
							ref={searchRef}
							value={keyword}
							onChange={(event) => setKeyword(event.target.value)}
							placeholder={t("sidebar.searchProjects")}
							aria-label={t("sidebar.searchProjects")}
						/>
					</label>
					<div className="sb-opts">
						<button
							type="button"
							className={scopeCwd === undefined ? "sb-opt is-on" : "sb-opt"}
							aria-pressed={scopeCwd === undefined}
							onClick={() => {
								setKeyword("");
								onSelect(undefined);
								triggerRef.current?.focus();
							}}
						>
							<span className="sb-opt-name ell">{t("sidebar.allProjects")}</span>
						</button>
						{matches.map((project) => {
							const isOn = scopeCwd !== undefined && samePath(project.cwd, scopeCwd);
							return (
								<div key={project.cwd} className="sb-opt-item">
									<button
										type="button"
										className={isOn ? "sb-opt is-on" : "sb-opt"}
										aria-pressed={isOn}
										{...tip.handlers(project.cwd)}
										onClick={() => {
											setKeyword("");
											onSelect(project.cwd);
											triggerRef.current?.focus();
										}}
										onContextMenu={(event) => {
											if (project.id === undefined) return;
											event.preventDefault();
											onOpenMenu(project, {
												x: Math.min(event.clientX, window.innerWidth - 240),
												y: Math.min(event.clientY, window.innerHeight - 180),
											});
										}}
									>
										<FolderIcon size={ICON_SIZE.md} />
										<span className="sb-opt-name ell">{project.name}</span>
									</button>
								</div>
							);
						})}
						{matches.length === 0 ? <p className="sb-opt-empty">{t("sidebar.noMatchingProjects")}</p> : null}
						{isStale ? (
							<div className="sb-opt-stale">
								<span className="sb-opt-name ell">{t("sidebar.projectsStale")}</span>
								<button type="button" className="sb-opt-action" onClick={onRefresh}>
									{t("sidebar.refresh")}
								</button>
							</div>
						) : null}
					</div>
					<button
						type="button"
						className="sb-opt is-add"
						onClick={() => {
							onClose();
							triggerRef.current?.focus();
							onAddProject();
						}}
					>
						<Plus size={ICON_SIZE.md} />
						<span className="sb-opt-name">{t("common.addProject")}</span>
					</button>
				</div>
			) : null}
		</div>
	);
}
