/**
 * 代码块的门控。
 *
 * 围栏行还在写、块里还没有正文时,语言标记可能只是 `pyt` 这种半截词,此时不出卡片,
 * 等出现换行、正文非空再渲染。
 */

/** 判断一块代码要不要渲染时看的信息。 */
export interface CodeBlockShape {
	/** 块内已有的正文,可能为空 */
	code?: string | undefined;
	/** 库报告的进行中标记 */
	loading?: boolean | undefined;
}

/** 围栏行未写完且没有正文时返回 false。 */
export function shouldShowCodeBlock(block: CodeBlockShape): boolean {
	return !(block.loading === true && (block.code ?? "").length === 0);
}
