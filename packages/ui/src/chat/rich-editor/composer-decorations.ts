/**
 * CodeMirror 6 胶囊装饰器。
 *
 * 把已落定的文首 `/命令` 与文中 `@文件` 原文区间视觉上渲染为原子胶囊（`.composer-command` /
 * `.composer-mention`），同时通过 `atomicRanges` 保证光标整块跳过、退格整块删除、输入法不切进胶囊；
 * 底层文档字符串始终是完整原文。
 */
import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { fileBasename, findDecorations } from "./composer-triggers.ts";

/** 装饰器依赖的动态目录与命令集合。 */
export interface ComposerDecorationConfig {
	readonly files: ReadonlySet<string>;
	readonly knownCommands: ReadonlySet<string>;
}

/** 外部目录或命令清单变化时派发的更新信号。 */
export const setDecorationConfig = StateEffect.define<ComposerDecorationConfig>();

class FileMentionWidget extends WidgetType {
	readonly filePath: string;

	constructor(filePath: string) {
		super();
		this.filePath = filePath;
	}

	override eq(other: FileMentionWidget): boolean {
		return this.filePath === other.filePath;
	}

	override toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "composer-mention";
		span.title = this.filePath;
		span.dataset.filePath = this.filePath;
		span.textContent = `@${fileBasename(this.filePath)}`;
		return span;
	}

	override ignoreEvent(event: Event): boolean {
		// 点击由外层容器统一委托给 onOpenMentionFile，避免浏览器把点击吞成选区跳转
		return event.type !== "click";
	}
}

class SlashCommandWidget extends WidgetType {
	readonly commandName: string;

	constructor(commandName: string) {
		super();
		this.commandName = commandName;
	}

	override eq(other: SlashCommandWidget): boolean {
		return this.commandName === other.commandName;
	}

	override toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "composer-command";
		span.dataset.command = this.commandName;
		span.textContent = `/${this.commandName}`;
		return span;
	}
}

function buildDecorations(docText: string, config: ComposerDecorationConfig): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	for (const item of findDecorations(docText, config.files, config.knownCommands)) {
		const widget =
			item.kind === "command" ? new SlashCommandWidget(item.name) : new FileMentionWidget(item.filePath);
		builder.add(item.from, item.to, Decoration.replace({ widget }));
	}
	return builder.finish();
}

interface DecorationFieldState {
	readonly config: ComposerDecorationConfig;
	readonly set: DecorationSet;
}

const decorationStateField = StateField.define<DecorationFieldState>({
	create(state) {
		const config: ComposerDecorationConfig = { files: new Set(), knownCommands: new Set() };
		return { config, set: buildDecorations(state.doc.toString(), config) };
	},
	update(value, tr) {
		let nextConfig = value.config;
		let configChanged = false;
		for (const effect of tr.effects) {
			if (effect.is(setDecorationConfig)) {
				nextConfig = effect.value;
				configChanged = true;
			}
		}
		if (!tr.docChanged && !configChanged) {
			return value;
		}
		return {
			config: nextConfig,
			set: buildDecorations(tr.newDoc.toString(), nextConfig),
		};
	},
	provide: (field) => [
		EditorView.decorations.from(field, (value) => value.set),
		EditorView.atomicRanges.of((view) => view.state.field(field).set),
	],
});

/** 生成挂到 CM6 EditorState 上的胶囊装饰扩展。 */
export function composerDecorationsExtension(initialConfig: ComposerDecorationConfig): Extension {
	return decorationStateField.init((state) => ({
		config: initialConfig,
		set: buildDecorations(state.doc.toString(), initialConfig),
	}));
}
