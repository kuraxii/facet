/**
 * `@文件` 引用胶囊。
 *
 * 一个原子 token：整块选中、整块删除，光标不会停在它里面，也不会把输入法组词切开。
 * 屏幕上显示 `@文件名`，悬停给完整相对路径；对外写出去的永远是完整路径
 * （`@src/chat/Composer.tsx`），因为草稿真值仍然只是一段 Markdown 字符串。
 */
import {
	$applyNodeReplacement,
	type DOMConversionMap,
	type DOMConversionOutput,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedTextNode,
	type Spread,
	TextNode,
} from "lexical";

/** 序列化之后的形状：文本节点的全部字段，外加上完整路径。 */
export type SerializedFileMentionNode = Spread<
	{
		/** 项目根下的相对路径，斜杠分隔 */
		filePath: string;
	},
	SerializedTextNode
>;

/** 路径的最后一段，也就是文件名。 */
export function fileBasename(filePath: string): string {
	const cut = filePath.lastIndexOf("/");
	return cut < 0 ? filePath : filePath.slice(cut + 1);
}

/** 路径去掉最后一段之后的部分；根目录下的文件为空串。 */
export function fileDirname(filePath: string): string {
	const cut = filePath.lastIndexOf("/");
	return cut < 0 ? "" : filePath.slice(0, cut);
}

/** 胶囊上显示的文本：`@` 加文件名。 */
function mentionLabel(filePath: string): string {
	return `@${fileBasename(filePath)}`;
}

/** 一段 `@文件` 胶囊。 */
export class FileMentionNode extends TextNode {
	/** 完整相对路径；显示名由它推出来，不单独存 */
	__filePath: string;

	constructor(filePath: string, key?: NodeKey) {
		super(mentionLabel(filePath), key);
		this.__filePath = filePath;
	}

	static override getType(): string {
		return "file-mention";
	}

	static override clone(node: FileMentionNode): FileMentionNode {
		return new FileMentionNode(node.__filePath, node.__key).setMode("token");
	}

	/** 完整相对路径。 */
	getFilePath(): string {
		return this.__filePath;
	}

	/**
	 * 对外的文本就是完整路径。
	 *
	 * 节点的 `__text` 是屏幕上那个短名字，导出 Markdown 用的是这个：两边各说各的场合，
	 * 只看 `__text` 的话草稿里会只剩文件名，读回来就还原不回胶囊了。
	 */
	override getTextContent(): string {
		return `@${this.__filePath}`;
	}

	override createDOM(config: EditorConfig): HTMLElement {
		const dom = super.createDOM(config);
		dom.classList.add(config.theme.fileMention ?? "composer-mention");
		dom.title = this.__filePath;
		dom.setAttribute("data-file-path", this.__filePath);
		return dom;
	}

	override updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
		if (prevNode.__filePath !== this.__filePath) {
			dom.textContent = mentionLabel(this.__filePath);
			dom.title = this.__filePath;
			dom.setAttribute("data-file-path", this.__filePath);
		}
		return super.updateDOM(prevNode, dom, config);
	}

	override exportJSON(): SerializedFileMentionNode {
		return { ...super.exportJSON(), type: FileMentionNode.getType(), filePath: this.__filePath };
	}

	override exportDOM(editor: LexicalEditor): DOMExportOutput {
		const { element } = super.exportDOM(editor);
		if (element instanceof HTMLElement) {
			element.setAttribute("data-file-path", this.__filePath);
		}
		return { element };
	}

	static override importJSON(json: SerializedFileMentionNode): FileMentionNode {
		return $createFileMentionNode(json.filePath);
	}

	static override importDOM(): DOMConversionMap | null {
		return {
			span: (domNode: HTMLElement) => {
				const filePath = domNode.getAttribute("data-file-path");
				if (filePath === null || !domNode.classList.contains("composer-mention")) {
					return null;
				}
				return {
					conversion: (): DOMConversionOutput => ({ node: $createFileMentionNode(filePath) }),
					priority: 2,
				};
			},
		};
	}
}

/** 造一条胶囊节点。 */
export function $createFileMentionNode(filePath: string): FileMentionNode {
	return $applyNodeReplacement(new FileMentionNode(filePath).setMode("token"));
}

/** 这个节点是不是胶囊。 */
export function $isFileMentionNode(node: LexicalNode | null | undefined): node is FileMentionNode {
	return node instanceof FileMentionNode;
}
