/**
 * 会话队列里的一行。
 *
 * 一行只有三样东西：行首状态点、标题、行尾的相对时间（不过滤到单个项目时，中间多一行
 * 项目名与主机名）。类名与 `aria-current` 是样式与读屏认的那一套，别改。
 */
import type { ReactNode } from "react";
import { memo } from "react";
import { ScrollRow } from "../common/scroll-area.tsx";
import type { HoverTip } from "../tip.tsx";
import { SessionStatusMark } from "./session-status-mark.tsx";
import type { SidebarSession } from "./sidebar-model.ts";

/** 一行的参数。 */
export interface SessionRowProps {
	/** 这一条会话 */
	session: SidebarSession;
	/** 是否是当前打开的会话 */
	isActive: boolean;
	/** 不过滤到单个项目：标题下面再给一行项目与时间 */
	twoLine: boolean;
	/** 点开这一条 */
	onOpen: (session: SidebarSession) => void;
	/** 右键：打开这一条的菜单，位置由调用方算 */
	onContextMenu: (session: SidebarSession, event: React.MouseEvent<HTMLButtonElement>) => void;
	/** 行的悬浮提示（标题全文）；用调用方那份提示的状态机 */
	tip: HoverTip;
}

/** 一条会话。 */
export const SessionRow = memo(function SessionRow({
	session,
	isActive,
	twoLine,
	onOpen,
	onContextMenu,
	tip,
}: SessionRowProps): ReactNode {
	return (
		<ScrollRow className="sb-row-item">
			<div className="sb-row-wrap">
				<button
					type="button"
					className={`sb-row${isActive ? " is-active" : ""}${twoLine ? " is-two-line" : ""}`}
					aria-current={isActive}
					onClick={() => onOpen(session)}
					onContextMenu={(event) => onContextMenu(session, event)}
					disabled={session.isPlaceholder === true}
					{...tip.handlers(session.title)}
				>
					<SessionStatusMark bucket={session.bucket} />
					{twoLine ? (
						<span className="sb-row-body">
							<span className="sb-row-title ell">{session.title}</span>
							<span className="sb-row-meta">
								<span className="sb-row-proj ell">{session.host ?? session.project}</span>
								<span className="sb-row-time mono">{session.timeText}</span>
							</span>
						</span>
					) : (
						<>
							<span className="sb-row-title ell">{session.title}</span>
							<span className="sb-row-time mono">{session.timeText}</span>
						</>
					)}
				</button>
			</div>
		</ScrollRow>
	);
});
