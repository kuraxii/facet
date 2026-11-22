/**
 * 输入区：草稿、待发图片与发送。
 *
 * 草稿与图片都存在本端，发送之后由主机确认再收；命令与文字分开处理，图形界面有对应
 * 入口的命令就地执行，不当消息发出去。
 */
import type { HostHandshake, MessageImage, SessionClient, SessionView } from "@facet/client-core";
import type { SlashCommand, ThinkingLevel } from "@facet/protocol";
import { parseCommand, useI18n } from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../bridge.ts";
import { blobFromBase64, encodeImage, IMAGE_MAX_BYTES, IMAGE_MIME_TYPES } from "../image-encode.ts";
import { createSendGate } from "./send-gate.ts";
import type { SessionErrorNotice } from "./useSessionLifecycle.ts";

/** 草稿在本地保存的键 */
const DRAFTS_KEY = "facet.drafts";
/** 还没打开会话时草稿用的键 */
const NEW_DRAFT_KEY = "__new__";

/** 一张已经放进输入框、还没发出去的图片。 */
export interface DraftImage {
	/** 本次输入内的稳定标识 */
	readonly id: string;
	/** 文件名，来自选择窗口、粘贴或拖拽 */
	readonly name: string;
	/** 媒体类型，发送时原样写进图片块 */
	readonly mimeType: string;
	/** 图片字节，发送那一刻才读成 base64 */
	readonly blob: Blob;
	/** 预览地址，objectURL */
	readonly previewUrl: string;
}

/** 没有待发图片时用的空列表，避免每帧新建数组 */
const EMPTY_IMAGES: readonly DraftImage[] = [];

/** 从历史消息还原的图片没有原始文件名，按媒体类型编一个：扩展名与内容对得上就行。 */
function restoredImageName(mimeType: string): string {
	return `restored.${mimeType.slice(mimeType.indexOf("/") + 1)}`;
}

/** 生成一张待发图片的标识。 */
function draftImageId(): string {
	return `img_${Math.random().toString(36).slice(2, 10)}`;
}

/** 读出保存的各会话草稿；读不懂时当作没有草稿。 */
function readDrafts(): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}");
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
		);
	} catch {
		return {};
	}
}

export interface ComposerOptions {
	/** 会话客户端 */
	client: SessionClient;
	/** 当前会话视图 */
	session: SessionView | undefined;
	/** 当前会话标识，取命令清单用 */
	openedSessionId: string | undefined;
	/** 当前会话文件，草稿按它分开存 */
	activeFile: string | undefined;
	/** 对话此刻的状态，决定发送是插话还是普通发送 */
	activity: "idle" | "running" | "compacting" | "stopping";
	/** 握手结果，扩展编辑器的草稿按主机分开存 */
	host: HostHandshake | undefined;
	/** 会话操作的结果摆在这里 */
	setSessionError: (notice: SessionErrorNotice | undefined) => void;
	/** 先确认目录信任再执行，来自会话域 */
	withTrust: (cwd: string | undefined, run: () => void) => void;
	/** 跑一次会话切换类操作，来自会话域 */
	runSessionAction: (
		action: () => Promise<string | undefined>,
		onDone?: (file: string | undefined) => void,
	) => void;
	/** 会话改名后重取清单 */
	refreshSessions: () => Promise<unknown>;
}

export interface Composer {
	/** 当前草稿的键 */
	draftKey: string;
	/** 当前草稿 */
	draft: string;
	/** 当前草稿待发的图片 */
	pendingImages: readonly DraftImage[];
	/**
	 * 有没有一条发送刚刚发出、还没被主机确认（或在编码图片）。
	 *
	 * 界面靠它把发送入口锁住：草稿要等回执才收，不锁的话慢回执期间每次点击都是一次新发送。
	 */
	isSending: boolean;
	/** 被拒图片给出的事实 */
	imageNotice: string | undefined;
	/** 输入区能用的命令：界面自带几条，加会话里的扩展、模板与技能 */
	commands: readonly SlashCommand[];
	/** 改当前草稿 */
	updateDraft: (change: string | ((current: string) => string)) => void;
	/** 发一条消息 */
	send: () => void;
	/** 收回排队内容，把文字拼回输入框 */
	takeBackQueue: () => void;
	/** 把一批文件加入待发图片 */
	addImages: (files: readonly File[]) => void;
	/** 打开系统选图窗口 */
	pickImages: () => void;
	/** 丢掉一张待发图片 */
	removeImage: (id: string) => void;
	/** 跑一条界面自己处理的命令，返回是否认领 */
	runFacetCommand: (name: string, args: string) => boolean;
	/** 回退到某条用户消息之前，文本与图片一起放回输入区 */
	revertTo: (entryId: string, text: string, images: readonly MessageImage[]) => void;
	/** 重试失败的一轮，图片跟着一起重发 */
	retryTurn: (entryId: string, text: string, images: readonly MessageImage[]) => void;
}

export function useComposer(options: ComposerOptions): Composer {
	const {
		client,
		session,
		openedSessionId,
		activeFile,
		activity,
		host,
		setSessionError,
		withTrust,
		runSessionAction,
		refreshSessions,
	} = options;
	const { t } = useI18n();
	/** 各会话的草稿，键为会话文件路径，新会话页面用 NEW_DRAFT_KEY */
	const [drafts, setDrafts] = useState<Record<string, string>>(readDrafts);
	/** 各草稿待发的图片，与文本草稿分开存：字节不进 localStorage */
	const [draftImages, setDraftImages] = useState<ReadonlyMap<string, readonly DraftImage[]>>(() => new Map());
	/** 被拒的图片给出的事实，例如超出大小上限 */
	const [imageNotice, setImageNotice] = useState<string | undefined>(undefined);
	/** 刚发出去那一批图片属于哪个草稿，主机确认后按它清空 */
	const sentImagesKey = useRef<string | undefined>(undefined);
	/** 输入区能用的命令：界面自带几条，加会话里的扩展、模板与技能 */
	const [commands, setCommands] = useState<SlashCommand[]>([]);

	const draftKey = activeFile ?? NEW_DRAFT_KEY;
	const draft = drafts[draftKey] ?? "";
	const pendingImages = draftImages.get(draftKey) ?? EMPTY_IMAGES;
	const queued = session?.state.queued ?? { steering: [], followUp: [] };

	/**
	 * 正在编码图片的草稿键。
	 *
	 * 按草稿键隔离：同一时刻只有一个当前草稿，但编码可能比一次会话切换还慢，切回来时还得
	 * 看得见「这条还没发出去」。
	 */
	const [encodingKeys, setEncodingKeys] = useState<ReadonlySet<string>>(() => new Set());
	/** 闸门要同步读客户端，而客户端会随主机切换换实例，所以用 ref 取当前那个 */
	const clientRef = useRef(client);
	useEffect(() => {
		clientRef.current = client;
	}, [client]);
	/** 发送闸门：同步拦下同一帧里的连点与重复编码，见 `send-gate.ts` */
	const sendGate = useMemo(
		() =>
			createSendGate({
				hasPendingSend: () => clientRef.current.hasPendingSend(),
				onChange: setEncodingKeys,
			}),
		[],
	);

	/** 改当前草稿。延迟写入本地保存，切换会话时不丢。 */
	const updateDraft = useCallback(
		(change: string | ((current: string) => string)) => {
			setDrafts((current) => {
				const value = typeof change === "function" ? change(current[draftKey] ?? "") : change;
				const next = { ...current };
				if (value.length === 0) {
					delete next[draftKey];
				} else {
					next[draftKey] = value;
				}
				return next;
			});
		},
		[draftKey],
	);

	// 草稿写进本地保存，重启之后还在
	useEffect(() => {
		localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
	}, [drafts]);

	// 换会话时重取命令清单：扩展、模板与技能都跟着会话走
	useEffect(() => {
		if (openedSessionId === undefined || session?.state.initialization.kind !== "ready") {
			setCommands([]);
			return;
		}
		let cancelled = false;
		void client.listCommands().then(
			(list) => {
				if (!cancelled) {
					setCommands(list);
				}
			},
			() => {
				if (!cancelled) {
					setCommands([]);
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [client, openedSessionId, session?.state.initialization.kind]);

	// 扩展给出的编辑器内容同步进草稿
	const editorUpdate = session?.state.extensionUi.editor;
	const editorSource =
		host === undefined || session === undefined
			? undefined
			: `facet.extensionEditor.${host.hostId}.${session.channel}`;
	const editorDraftKey = session?.state.file;
	useEffect(() => {
		if (
			editorUpdate === undefined ||
			editorSource === undefined ||
			editorDraftKey === undefined ||
			host?.role === "viewer"
		)
			return;
		if (localStorage.getItem(editorSource) === editorUpdate.id) return;
		setDrafts((current) => ({ ...current, [editorDraftKey]: editorUpdate.text }));
		localStorage.setItem(editorSource, editorUpdate.id);
	}, [editorUpdate, editorSource, editorDraftKey, host?.role]);

	/**
	 * 跑一条界面自己处理的命令。
	 *
	 * 这些命令在图形界面里有对应入口，就地执行，不当成消息发出去；参数不对时把说明留在
	 * 错误条上，草稿不丢。
	 */
	const runFacetCommand = useCallback(
		(name: string, args: string): boolean => {
			if (name === "compact") {
				client.compact();
				return true;
			}
			if (name === "model") {
				const [provider, id] = args.split("/");
				if (provider === undefined || id === undefined || provider.length === 0 || id.length === 0) {
					setSessionError({ message: t("app.usageModel"), retry: () => {} });
					return true;
				}
				client.setModel({ provider, id });
				return true;
			}
			if (name === "thinking") {
				const level = args as ThinkingLevel;
				const allowed = session?.state.availableThinkingLevels ?? [];
				if (!allowed.includes(level)) {
					setSessionError({
						message:
							allowed.length === 0
								? t("app.noThinkingLevels")
								: t("app.availableLevels", { levels: allowed.join(" / ") }),
						retry: () => {},
					});
					return true;
				}
				client.setThinkingLevel(level);
				return true;
			}
			if (name === "name") {
				if (args.length === 0) {
					setSessionError({ message: t("app.usageName"), retry: () => {} });
					return true;
				}
				void client.renameSession(activeFile ?? "", args).then(
					() => void refreshSessions(),
					(error: unknown) => setSessionError({ message: String(error), retry: () => {} }),
				);
				return true;
			}
			return false;
		},
		[activeFile, client, refreshSessions, session?.state.availableThinkingLevels, setSessionError, t],
	);

	/** 把一批文件加入当前草稿的待发图片，越界与不受支持的逐个报出来。 */
	const addImages = useCallback(
		(files: readonly File[]) => {
			const accepted: DraftImage[] = [];
			const rejected: string[] = [];
			for (const file of files) {
				if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
					rejected.push(t("composer.imageUnsupported", { name: file.name }));
					continue;
				}
				if (file.size > IMAGE_MAX_BYTES) {
					rejected.push(
						t("composer.imageTooLarge", { name: file.name, limit: Math.round(IMAGE_MAX_BYTES / 1048576) }),
					);
					continue;
				}
				accepted.push({
					id: draftImageId(),
					name: file.name,
					mimeType: file.type,
					blob: file,
					previewUrl: URL.createObjectURL(file),
				});
			}
			setImageNotice(rejected.length === 0 ? undefined : rejected.join("、"));
			if (accepted.length === 0) {
				return;
			}
			setDraftImages((current) => {
				const next = new Map(current);
				next.set(draftKey, [...(next.get(draftKey) ?? []), ...accepted]);
				return next;
			});
		},
		[draftKey, t],
	);

	/** 打开系统的选图窗口，选中的内容在主进程已经读成 base64。 */
	const pickImages = useCallback(() => {
		void (async () => {
			const picked = await bridge.pickImages().catch(() => []);
			if (picked.length === 0) {
				return;
			}
			addImages(
				picked.map(
					(item) => new File([blobFromBase64(item.data, item.mimeType)], item.name, { type: item.mimeType }),
				),
			);
		})();
	}, [addImages]);

	/** 丢掉一张待发图片，顺带释放它的预览地址。 */
	const removeImage = useCallback(
		(id: string) => {
			setDraftImages((current) => {
				const list = current.get(draftKey);
				const target = list?.find((item) => item.id === id);
				if (list === undefined || target === undefined) {
					return current;
				}
				URL.revokeObjectURL(target.previewUrl);
				const next = new Map(current);
				const rest = list.filter((item) => item.id !== id);
				if (rest.length === 0) {
					next.delete(draftKey);
				} else {
					next.set(draftKey, rest);
				}
				return next;
			});
			setImageNotice(undefined);
		},
		[draftKey],
	);

	/** 清掉某个草稿的全部待发图片，发送确认后调用。 */
	const clearImages = useCallback((key: string) => {
		setDraftImages((current) => {
			const list = current.get(key);
			if (list === undefined) {
				return current;
			}
			for (const item of list) {
				URL.revokeObjectURL(item.previewUrl);
			}
			const next = new Map(current);
			next.delete(key);
			return next;
		});
	}, []);

	const send = useCallback(() => {
		// 先占位再判内容：同一个键正在编码、或本端已有待确认的发送时直接放弃。这一道必须同步
		// 问下来——React 的重绘要等一帧，等它算完时第二下已经发出去了
		const ticket = sendGate.begin(draftKey);
		if (ticket === undefined) {
			return;
		}
		const text = draft.trim();
		if (text.length === 0 && pendingImages.length === 0) {
			ticket.close();
			return;
		}
		// 界面自己处理的命令就地执行，不当消息发出去；图片不参与命令
		const command = pendingImages.length === 0 ? parseCommand(text) : undefined;
		if (
			command !== undefined &&
			commands.some((item) => item.name === command.name && item.handler === "facet")
		) {
			ticket.close();
			if (runFacetCommand(command.name, command.args)) {
				updateDraft("");
			}
			return;
		}
		// 草稿留到主机确认再收，发送被拒时不用重打
		const key = draftKey;
		const imagesKey = pendingImages.length === 0 ? undefined : key;
		void (async () => {
			try {
				const images = await Promise.all(pendingImages.map((item) => encodeImage(item)));
				sentImagesKey.current = imagesKey;
				if (activity === "running") {
					// 排队那条路只有文本，带图片时改走插入当前回合
					client.send(text, {
						streamingBehavior: "steer",
						...(images.length === 0 ? {} : { images }),
					});
					return;
				}
				client.send(text, images.length === 0 ? {} : { images });
			} finally {
				// 编码失败、派发抛错、中途切走会话都得解开，否则这个草稿键再也发不出去
				ticket.close();
			}
		})();
	}, [activity, client, commands, draft, draftKey, pendingImages, runFacetCommand, sendGate, updateDraft]);

	/**
	 * 收回排队内容：清空主机侧队列，把文字拼回输入框。
	 *
	 * 排队条来自 session/queueChanged，清空后主机会再推一次空队列，这里只改草稿。
	 */
	const takeBackQueue = useCallback(() => {
		const entries = [...queued.steering, ...queued.followUp];
		client.clearQueue();
		if (entries.length === 0) {
			return;
		}
		updateDraft((current) => {
			const restored = entries.join("\n\n");
			return current.trim().length === 0 ? restored : `${restored}\n\n${current}`;
		});
	}, [client, queued, updateDraft]);

	useEffect(() => {
		return client.onSent((text) => {
			// 只收掉刚发出的那段，等待期间新输入的内容保留
			updateDraft((current) => (current.trim() === text ? "" : current));
			const key = sentImagesKey.current;
			if (key !== undefined) {
				sentImagesKey.current = undefined;
				clearImages(key);
			}
		});
	}, [clearImages, client, updateDraft]);

	/**
	 * 把一条已有消息里的图片放回输入区。
	 *
	 * 回退与重试都要用：图片本来就在消息里（base64），拼回 `Blob` 就能走与选图窗口同一条路，
	 * 预览地址是 objectURL，与手动添加的附件没有区别。
	 */
	const restoreImages = useCallback(
		(images: readonly MessageImage[]) => {
			if (images.length === 0) {
				return;
			}
			const restored: DraftImage[] = images.map((image) => {
				const blob = blobFromBase64(image.data, image.mimeType);
				return {
					id: draftImageId(),
					name: restoredImageName(image.mimeType),
					mimeType: image.mimeType,
					blob,
					previewUrl: URL.createObjectURL(blob),
				};
			});
			setDraftImages((current) => {
				const next = new Map(current);
				next.set(draftKey, [...(next.get(draftKey) ?? []), ...restored]);
				return next;
			});
			setImageNotice(undefined);
		},
		[draftKey],
	);

	/**
	 * 回退到某条用户消息之前：把这条消息的文本与图片放回输入框。
	 *
	 * 回退在同一个会话里改分支指针，不新建会话；历史由主机推的 chat/branchMoved 触发重装。
	 */
	const revertTo = useCallback(
		(entryId: string, text: string, images: readonly MessageImage[]) => {
			client.revert(entryId);
			updateDraft(() => text);
			restoreImages(images);
		},
		[client, restoreImages, updateDraft],
	);

	/**
	 * 重试失败的一轮。
	 *
	 * 从这条用户消息之前分叉出新会话并立刻重发同一段文本：新会话里只有一份用户消息，失败
	 * 的那次调用留在原会话里，不会重复追加。
	 */
	const retryTurn = useCallback(
		(entryId: string, text: string, images: readonly MessageImage[]) => {
			withTrust(session?.state.cwd, () => {
				runSessionAction(
					async () => (await client.fork(entryId)).file,
					() => {
						updateDraft(() => text);
						// 图片按消息里的原样重发：只发文字等于把用户当初的截图丢了
						client.send(text, {
							images: images.map((image) => ({
								type: "image" as const,
								data: image.data,
								mimeType: image.mimeType,
							})),
						});
					},
				);
			});
		},
		[client, runSessionAction, session?.state.cwd, updateDraft, withTrust],
	);

	return {
		draftKey,
		draft,
		pendingImages,
		isSending: encodingKeys.has(draftKey) || (session?.state.hasPendingSend ?? false),
		imageNotice,
		commands,
		updateDraft,
		send,
		takeBackQueue,
		addImages,
		pickImages,
		removeImage,
		runFacetCommand,
		revertTo,
		retryTurn,
	};
}
