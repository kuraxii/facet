/** 扩展交互请求；requestId 在一次会话运行内唯一，expiresAt 由 server 计时。 */
export type UiPrompt = {
	/** 应答定位标识，完成后不可再次使用。 */
	requestId: string;
	/** 扩展提供的标题。 */
	title: string;
	/** 超时时刻的 Unix 毫秒数；缺省表示等待取消或应答。 */
	expiresAt?: number;
} & (
	| {
			/** 从给定选项中选择。 */
			kind: "select";
			/** 返回值必须与其中一个选项完全相同。 */
			options: string[];
	  }
	| {
			/** 确认或拒绝操作。 */
			kind: "confirm";
			/** 扩展提供的确认内容。 */
			message: string;
	  }
	| {
			/** 输入单行文本。 */
			kind: "input";
			/** 输入框为空时显示的内容。 */
			placeholder?: string;
	  }
	| {
			/** 编辑多行文本。 */
			kind: "editor";
			/** 完整的初始内容，保留换行与空白。 */
			prefill?: string;
	  }
);

/** 用户应答；cancel 对确认请求返回 false，对其他请求返回 undefined。 */
export type UiResponse =
	| {
			/** 取消当前请求。 */
			kind: "cancel";
	  }
	| {
			/** 选择请求的应答。 */
			kind: "select";
			/** 请求选项中的原始字符串。 */
			value: string;
	  }
	| {
			/** 确认请求的应答。 */
			kind: "confirm";
			/** 是否同意；false 表示明确拒绝。 */
			confirmed: boolean;
	  }
	| {
			/** 单行输入的应答。 */
			kind: "input";
			/** 用户提交的完整内容，允许空字符串。 */
			value: string;
	  }
	| {
			/** 多行编辑的应答。 */
			kind: "editor";
			/** 用户提交的完整内容，保留空白。 */
			value: string;
	  };

/** 对应会话的输入草稿替换请求。 */
export interface UiEditorUpdate {
	/** 客户端据此避免重连或切换会话时重复写入。 */
	id: string;
	/** 完整的草稿内容。 */
	text: string;
}

/** 保留在当前运行内的应用通知，不写入会话 JSONL。 */
export interface UiNotice {
	/** 通知标识。 */
	id: string;
	/** 通知样式。 */
	level: "info" | "warning" | "error";
	/** 扩展提供的事实内容。 */
	message: string;
}

/** 通过会话快照与 session/uiChanged 同步的扩展交互状态。 */
export interface ExtensionUiState {
	/** 按发起顺序排列的待答请求。 */
	prompts: UiPrompt[];
	/** 最新的草稿替换；客户端按 id 仅应用一次。 */
	editor?: UiEditorUpdate;
	/** 有数量限制的通知列表；旧端可以缺省。 */
	notices?: UiNotice[];
}

/** 扩展初始化状态，与本轮 phase 和 maintenance 分别维护。 */
export type SessionInitialization =
	| {
			/** 扩展正在初始化，允许订阅与应答。 */
			kind: "starting";
	  }
	| {
			/** 扩展已经可以接收常规操作。 */
			kind: "ready";
	  }
	| {
			/** 扩展初始化未完成，常规操作不可用。 */
			kind: "failed";
			/** 初始化返回的具体原因。 */
			message: string;
	  };
