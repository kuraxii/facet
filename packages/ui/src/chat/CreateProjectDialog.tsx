/**
 * 创建项目。
 *
 * 居中的对话框：填写名称，用系统文件管理器选目录，提交后由宿主写入项目清单。
 */

import { FolderPlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../common/Button.tsx";
import { IconButton } from "../common/IconButton.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { isComposingKey } from "../keys.ts";
import { Modal } from "../modal.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { FolderIcon } from "../transcript/icons.tsx";
import { RequestEpoch } from "./request-epoch.ts";

/** 对话框参数。 */
export interface CreateProjectDialogProps {
	/** 是否打开 */
	isOpen: boolean;
	/** 调起文件管理器选择目录，取消时返回空 */
	onPickFolder: () => Promise<string | undefined>;
	/** 提交创建，失败时抛错，错误信息显示在对话框里 */
	onCreate: (input: { cwd: string; name: string | undefined }) => Promise<void>;
	/** 关闭对话框 */
	onClose: () => void;
}

export function CreateProjectDialog({ isOpen, onPickFolder, onCreate, onClose }: CreateProjectDialogProps) {
	const { t } = useI18n();
	const [name, setName] = useState("");
	const [cwd, setCwd] = useState<string | undefined>(undefined);
	const [isNameFocused, setIsNameFocused] = useState(false);
	const [isPicking, setIsPicking] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const nameRef = useRef<HTMLInputElement>(null);
	/** 本次打开的轮次，关闭或重开都会推进它 */
	const epoch = useRef(new RequestEpoch());

	// 每次打开都从空白开始，并换一个新的轮次
	useEffect(() => {
		if (isOpen) {
			epoch.current.advance();
			setName("");
			setCwd(undefined);
			setIsNameFocused(false);
			setIsPicking(false);
			setIsSubmitting(false);
			setError(undefined);
			nameRef.current?.focus();
		}
	}, [isOpen]);

	/** 关闭并作废在途请求。 */
	const close = useCallback(() => {
		epoch.current.advance();
		onClose();
	}, [onClose]);

	if (!isOpen) {
		return null;
	}

	const pickFolder = async () => {
		const mine = epoch.current.advance();
		setIsPicking(true);
		setError(undefined);
		try {
			const picked = await onPickFolder();
			if (epoch.current.matches(mine) && picked !== undefined) {
				setCwd(picked);
			}
		} catch (pickError) {
			if (epoch.current.matches(mine)) {
				setError(pickError instanceof Error ? pickError.message : String(pickError));
			}
		} finally {
			if (epoch.current.matches(mine)) {
				setIsPicking(false);
			}
		}
	};

	/**
	 * 提交。
	 *
	 * 成功后只在轮次未变时关掉窗口：等待期间关掉又重开时，这次结果属于上一个对话框。
	 * 失败时错误只写回发起它的那一次。
	 */
	const submit = async () => {
		if (cwd === undefined || isSubmitting) {
			return;
		}
		const mine = epoch.current.advance();
		setIsSubmitting(true);
		setError(undefined);
		try {
			const trimmed = name.trim();
			await onCreate({ cwd, name: trimmed.length > 0 ? trimmed : undefined });
			if (epoch.current.matches(mine)) {
				close();
			}
		} catch (createError) {
			if (epoch.current.matches(mine)) {
				setError(createError instanceof Error ? createError.message : String(createError));
			}
		} finally {
			if (epoch.current.matches(mine)) {
				setIsSubmitting(false);
			}
		}
	};

	return (
		<Modal open onClose={close} label={t("projectDialog.title")}>
			<div className="dialog-head">
				<h2 className="dialog-title">{t("projectDialog.title")}</h2>
				<IconButton
					variant="ghost"
					size="sm"
					className="dialog-close"
					aria-label={t("common.close")}
					onClick={close}
				>
					<X size={ICON_SIZE.lg} />
				</IconButton>
			</div>

			<label className={isNameFocused ? "project-field is-focused" : "project-field"}>
				<FolderIcon size={ICON_SIZE.lg} />
				<span className="name-divider" />
				<input
					ref={nameRef}
					data-autofocus
					className="project-name"
					value={name}
					onChange={(event) => setName(event.target.value)}
					onFocus={() => setIsNameFocused(true)}
					onBlur={() => setIsNameFocused(false)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !isComposingKey(event)) {
							void submit();
						}
					}}
					placeholder={t("projectDialog.name")}
					aria-label={t("projectDialog.name")}
				/>
			</label>

			<p className="dialog-label">{t("projectDialog.sourceFolder")}</p>
			<div className="source-box">
				{cwd === undefined ? (
					<span className="source-hint">
						{t("projectDialog.sourceHint")}
						<ChevronIcon isOpen={false} />
					</span>
				) : (
					<span className="source-path mono">{cwd}</span>
				)}
				<button type="button" className="source-add" onClick={() => void pickFolder()} disabled={isPicking}>
					<FolderPlus size={ICON_SIZE.md} />
					{isPicking ? t("projectDialog.picking") : t("projectDialog.add")}
				</button>
			</div>

			{error === undefined ? null : <p className="dialog-error">{error}</p>}

			<div className="dialog-actions">
				<Button variant="ghost" size="md" onClick={close}>
					{t("common.cancel")}
				</Button>
				<Button
					variant="primary"
					size="md"
					onClick={() => void submit()}
					disabled={cwd === undefined || isSubmitting}
				>
					{isSubmitting ? t("projectDialog.creating") : t("projectDialog.create")}
				</Button>
			</div>
		</Modal>
	);
}
