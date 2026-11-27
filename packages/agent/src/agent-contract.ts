/**
 * 多后端代理的统一运行时契约。
 *
 * 将 PiAgent 与外部 AcpAgent 的公共控制面收拢在同一结构类型上，供 SessionHub 与
 * RPC 处理器按能力位统一调度，避免上层直接感知底层 SDK 实现差异。
 */
import type {
	AgentCapabilities,
	ContextBreakdown,
	ContextUsage,
	Entry,
	ImageBlock,
	Maintenance,
	ModelInfo,
	ModelRef,
	PromptDisposition,
	QueueDisposition,
	QueuedInput,
	SessionEventListener,
	SessionSnapshot,
	SessionStats,
	SlashCommand,
	ThinkingLevel,
	ToolInfo,
	UiResponse,
} from "@facet/protocol";
import type { QueuedMessageItem } from "./queue-state.ts";
import type { ModelMutationOptions, PromptOptions } from "./types.ts";

/** 由 SessionHub 统一托管的代理实例契约。 */
export interface ManagedAgent {
	readonly id: string;
	readonly agentId: string;
	readonly file: string | undefined;
	readonly name: string | undefined;
	readonly capabilities: AgentCapabilities;
	readonly isBusy: boolean;
	readonly isStreaming: boolean;
	readonly pendingPromptCount: number;
	readonly currentMaintenance: Maintenance | undefined;

	initialize(): Promise<void>;
	respondUi(requestId: string, response: UiResponse): boolean;
	cancelUi(): void;
	subscribe(listener: SessionEventListener): () => void;

	prompt(text: string, options?: PromptOptions): Promise<PromptDisposition>;
	steer(text: string, images?: ImageBlock[]): Promise<QueueDisposition>;
	followUp(text: string, images?: ImageBlock[]): Promise<QueueDisposition>;
	abort(): Promise<QueuedMessageItem[]>;
	demoteSteering(): void;
	clearQueue(): QueuedInput;
	promoteFollowUp(index: number): Promise<void>;
	removeFollowUp(index: number): void;

	setName(name: string): void;
	compact(customInstructions?: string): Promise<void>;
	setModel(ref: ModelRef, options?: ModelMutationOptions): Promise<ModelInfo>;
	setThinkingLevel(level: ThinkingLevel, options?: ModelMutationOptions): void;
	tools(): ToolInfo[];
	setActiveTools(names: string[]): void;

	setAcpMode?(modeId: string): Promise<void>;
	setAcpConfigOption?(configId: string, value: string): Promise<void>;

	contextUsage(): ContextUsage | undefined;
	contextBreakdown(): ContextBreakdown;
	stats(): SessionStats;
	commands(): SlashCommand[];

	entryPage(cursor: string | undefined, limit: number): { entries: Entry[]; nextCursor: string | undefined };
	entriesAfter(afterEntryId: string | null): { entries: Entry[]; leafId: string | null };
	entryBefore(entryId: string): string | null;
	revertTo(entryId: string): Promise<string | undefined>;
	leafEntryId(): string | null;
	snapshot(): SessionSnapshot;
	dispose(): void;
}
