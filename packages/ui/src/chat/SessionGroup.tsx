/**
 * 会话队列的一组。
 *
 * 组标题是时间分组（进行中 / 今天 / 昨天 / 更早），下面是这一组的行。分组本身由
 * `sidebar-model.ts` 算好，这里只管画。
 */
import type { ReactNode } from "react";
import { memo } from "react";
import { SessionRow } from "./SessionRow.tsx";
import type { SidebarGroup, SidebarSession } from "./sidebar-model.ts";

/** 一组的参数。 */
export interface SessionGroupProps {
	/** 这一组 */
	group: SidebarGroup;
	/** 当前打开的会话路径 */
	activeFile: string | undefined;
	/** 不过滤到单个项目：行上来两行 */
	twoLine: boolean;
	/** 组标题文案 */
	label: string;
	/** 点开一条会话 */
	onOpen: (session: SidebarSession) => void;
	/** 右键一条会话 */
	onContextMenu: (session: SidebarSession, event: React.MouseEvent<HTMLButtonElement>) => void;
}

/** 一组会话。 */
export const SessionGroup = memo(function SessionGroup({
	group,
	activeFile,
	twoLine,
	label,
	onOpen,
	onContextMenu,
}: SessionGroupProps): ReactNode {
	return (
		<section className="sb-group">
			<h2 className="sb-group-head">
				<span>{label}</span>
			</h2>
			{group.sessions.map((session) => (
				<SessionRow
					key={session.path}
					session={session}
					isActive={session.path === activeFile}
					twoLine={twoLine}
					onOpen={onOpen}
					onContextMenu={onContextMenu}
				/>
			))}
		</section>
	);
});
