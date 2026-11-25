/**
 * 变更标签：工作树相对 HEAD 的改动。
 *
 * 只看高频的工作区态：已暂存与未暂存合成一份的文件清单、单文件补丁预览。提交历史不在这里
 * ——那是低频的历史态，归「提交图谱」。
 *
 * 文件清单与补丁在同一条滚动轴上一前一后：文件头可以点开收起，补丁进视口附近才取。原先还
 * 另有一个索栏列，和文件头重复，删掉之后点一下文件头就是看补丁。
 */
import type { GitFileChange } from "@facet/protocol";
import { ChangesDocument, useI18n } from "@facet/ui";
import type { ReactNode } from "react";
import type { WorkspaceDocs } from "../../hooks/useWorkspaceDocs.ts";
import { useHostClient } from "../../host-context.tsx";

/** 变更标签的参数。 */
export interface ChangesTabProps {
	/** 文档数据 */
	docs: WorkspaceDocs;
	/** 当前会话所在的目录；没有会话时为空 */
	sessionCwd: string | undefined;
}

/** 变更标签。 */
export function ChangesTab({ docs, sessionCwd }: ChangesTabProps): ReactNode {
	const { t } = useI18n();
	const client = useHostClient();

	return (
		<ChangesDocument
			status={docs.changes.status}
			error={docs.changes.error}
			focusPath={docs.changesFocus?.path}
			focusRequestId={docs.changesFocus?.requestId}
			loadDiff={(file: GitFileChange) =>
				sessionCwd === undefined
					? Promise.reject(new Error(t("app.noSession")))
					: client.gitDiff(sessionCwd, file.path, file.status === "untracked")
			}
			onRefresh={() => void docs.refreshChanges({ force: true })}
		/>
	);
}
