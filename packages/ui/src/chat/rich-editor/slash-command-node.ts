/**
 * `/命令` 胶囊。
 *
 * 选中一条交给 pi 的命令之后，打进去的那截 `/名字` 换成一个原子 token：整块选中、整块删除，
 * 光标不会停在它里面，也不会把输入法组词切开——和 `@文件` 胶囊同一套行为。
 *
 * 屏幕上显示 `/名字`，对外写出去的也是 `/名字`。草稿真值仍然只是一段 Markdown，发给主机之后
 * 由 `parseCommand` 拆名字与参数，这里不额外造一种表示法。
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

/** 序列化之后的形状：文本节点的全部字段，外加上命令名。 */
export type SerializedSlashCommandNode = Spread<
	{
		/** 命令名，不带前导斜杠 */
		commandName: string;
	},
	SerializedTextNode
>;

/** 胶囊上显示的文本，也是对外导出的文本。 */
function commandLabel(commandName: string): string {
	return `/${commandName}`;
}

/** 一段 `/命令` 胶囊。 */
export class SlashCommandNode extends TextNode {
	/** 命令名，不带前导斜杠；显示文本由它推出来，不单独存 */
	__commandName: string;

	constructor(commandName: string, key?: NodeKey) {
		super(commandLabel(commandName), key);
		this.__commandName = commandName;
	}

	static override getType(): string {
		return "slash-command";
	}

	static override clone(node: SlashCommandNode): SlashCommandNode {
		return new SlashCommandNode(node.__commandName, node.__key).setMode("token");
	}

	/** 命令名，不带前导斜杠。 */
	getCommandName(): string {
		return this.__commandName;
	}

	override createDOM(config: EditorConfig): HTMLElement {
		const dom = super.createDOM(config);
		dom.classList.add(config.theme.slashCommand ?? "composer-command");
		dom.setAttribute("data-command", this.__commandName);
		return dom;
	}

	override updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
		if (prevNode.__commandName !== this.__commandName) {
			dom.textContent = commandLabel(this.__commandName);
			dom.setAttribute("data-command", this.__commandName);
		}
		return super.updateDOM(prevNode, dom, config);
	}

	override exportJSON(): SerializedSlashCommandNode {
		return { ...super.exportJSON(), type: SlashCommandNode.getType(), commandName: this.__commandName };
	}

	override exportDOM(editor: LexicalEditor): DOMExportOutput {
		const { element } = super.exportDOM(editor);
		if (element instanceof HTMLElement) {
			element.setAttribute("data-command", this.__commandName);
		}
		return { element };
	}

	static override importJSON(json: SerializedSlashCommandNode): SlashCommandNode {
		return $createSlashCommandNode(json.commandName);
	}

	static override importDOM(): DOMConversionMap | null {
		return {
			span: (domNode: HTMLElement) => {
				const commandName = domNode.getAttribute("data-command");
				if (commandName === null || !domNode.classList.contains("composer-command")) {
					return null;
				}
				return {
					conversion: (): DOMConversionOutput => ({ node: $createSlashCommandNode(commandName) }),
					priority: 2,
				};
			},
		};
	}
}

/** 造一条胶囊节点。 */
export function $createSlashCommandNode(commandName: string): SlashCommandNode {
	return $applyNodeReplacement(new SlashCommandNode(commandName).setMode("token"));
}

/** 这个节点是不是胶囊。 */
export function $isSlashCommandNode(node: LexicalNode | null | undefined): node is SlashCommandNode {
	return node instanceof SlashCommandNode;
}
