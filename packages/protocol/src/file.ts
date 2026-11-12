/**
 * 文件浏览与读取。
 *
 * 目录列举与文件读取都在主机上做，路径一律相对项目根，主机侧做包含校验；界面只拿到结果与
 * 明确的失败类型，不自己拼路径。
 */

/** 目录里一项的类型。 */
export type FileEntryKind = "file" | "directory";

/** 目录里的一项。 */
export interface FileEntry {
	/** 文件名，不含目录 */
	name: string;
	/** 相对项目根的路径，斜杠分隔 */
	path: string;
	/** 是文件还是目录 */
	kind: FileEntryKind;
}

/** 读文件的结果。 */
export type FileContent =
	| {
			/** 文本文件，内容已按 UTF-8 解码 */
			kind: "text";
			/** 文件内容 */
			content: string;
			/** 字节数 */
			size: number;
			/** 内容摘要，写回时用它判断文件有没有被外部改动 */
			revision: string;
			/** 最后修改时间，Unix 毫秒 */
			modifiedAt: number;
	  }
	| {
			/** 二进制文件，不给内容 */
			kind: "binary";
			/** 字节数 */
			size: number;
			/** 内容摘要 */
			revision: string;
			/** 最后修改时间，Unix 毫秒 */
			modifiedAt: number;
	  }
	| {
			/** 文件太大，不给内容 */
			kind: "tooLarge";
			/** 字节数 */
			size: number;
	  };

/** 写文件的结果。 */
export interface FileWriteResult {
	/** 写完之后的摘要，下一次写回用它 */
	revision: string;
	/** 写完之后的修改时间，Unix 毫秒 */
	modifiedAt: number;
}
