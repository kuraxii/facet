/**
 * 自定义提供方表单。
 *
 * 一个提供方由标识、名称、接口地址、协议与模型清单组成；标识与名称必填，接口地址只接受
 * http 与 https，模型清单至少一行且标识不能为空。保存与删除都交给主机校验，失败原因原样
 * 显示在表单里。
 */
import type { CustomModelInfo, CustomProviderInfo } from "@facet/protocol";
import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";

/** 可选的接口协议。 */
const API_OPTIONS: ReadonlyArray<{
	value: string;
	label: string;
	labelKey?: "providerForm.apiOpenAICompatible";
}> = [
	{
		value: "openai-completions",
		label: "OpenAI compatible (chat completions)",
		labelKey: "providerForm.apiOpenAICompatible",
	},
	{ value: "openai-responses", label: "OpenAI Responses" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "google-generative-ai", label: "Google Generative AI" },
	{ value: "mistral-conversations", label: "Mistral Conversations" },
];

/** 表单里的一行模型。key 只用于渲染，跟着行一起移动，不用下标当键。 */
interface ModelRow {
	key: string;
	model: CustomModelInfo;
}

let rowCounter = 0;

/** 造一行模型。 */
function modelRow(model: CustomModelInfo = { id: "" }): ModelRow {
	rowCounter += 1;
	return { key: `row-${rowCounter}`, model };
}

/** 空表单的初始值。 */
function emptyDraft(): CustomProviderInfo & { rows: ModelRow[] } {
	return {
		id: "",
		name: "",
		baseUrl: "",
		api: API_OPTIONS[0]?.value ?? "openai-completions",
		models: [],
		rows: [modelRow()],
	};
}

/** 表单参数。 */
export interface ProviderFormProps {
	/** 编辑已有的提供方；为空表示新增 */
	initial: CustomProviderInfo | undefined;
	/** 保存，失败时抛错 */
	onSave: (provider: CustomProviderInfo) => Promise<void>;
	/** 取消 */
	onCancel: () => void;
}

export function ProviderForm({ initial, onSave, onCancel }: ProviderFormProps) {
	const { t } = useI18n();
	const [draft, setDraft] = useState<CustomProviderInfo & { rows: ModelRow[] }>(() =>
		initial === undefined
			? emptyDraft()
			: { ...initial, rows: initial.models.map((model) => modelRow(model)) },
	);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const isEditing = initial !== undefined;

	const patchModel = (key: string, change: Partial<CustomModelInfo>): void => {
		setDraft((current) => ({
			...current,
			rows: current.rows.map((row) =>
				row.key === key ? { ...row, model: { ...row.model, ...change } } : row,
			),
		}));
	};

	/** 提交前的本地校验，只说最明显的几条；主机侧还会再校验一次。 */
	const validate = (): string | undefined => {
		if (!/^[a-z0-9][a-z0-9._-]*$/.test(draft.id.trim())) {
			return t("providerForm.invalidId");
		}
		if (draft.name.trim().length === 0) {
			return t("providerForm.invalidName");
		}
		if (draft.baseUrl.trim().length === 0) {
			return t("providerForm.invalidBaseUrl");
		}
		if (draft.rows.length === 0 || draft.rows.some((row) => row.model.id.trim().length === 0)) {
			return t("providerForm.invalidModelId");
		}
		return undefined;
	};

	const submit = async () => {
		const invalid = validate();
		if (invalid !== undefined) {
			setError(invalid);
			return;
		}
		setIsSaving(true);
		setError(undefined);
		try {
			await onSave({
				...draft,
				id: draft.id.trim(),
				name: draft.name.trim(),
				baseUrl: draft.baseUrl.trim(),
				models: draft.rows.map((row) => ({ ...row.model, id: row.model.id.trim() })),
			});
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : String(saveError));
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="prov-form">
			<label className="set-field">
				<span className="set-label">{t("providerForm.id")}</span>
				<input
					className="set-input mono"
					value={draft.id}
					onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))}
					placeholder="my-gateway"
					aria-label={t("providerForm.id")}
					disabled={isEditing}
				/>
			</label>
			<label className="set-field">
				<span className="set-label">{t("providerForm.name")}</span>
				<input
					className="set-input"
					value={draft.name}
					onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
					placeholder={t("providerForm.name")}
					aria-label={t("providerForm.name")}
				/>
			</label>
			<label className="set-field">
				<span className="set-label">{t("providerForm.baseUrl")}</span>
				<input
					className="set-input mono"
					value={draft.baseUrl}
					onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
					placeholder="https://gateway.example.com/v1"
					aria-label={t("providerForm.baseUrl")}
				/>
			</label>
			<label className="set-field">
				<span className="set-label">{t("providerForm.api")}</span>
				<select
					className="set-input"
					value={draft.api}
					onChange={(event) => setDraft((current) => ({ ...current, api: event.target.value }))}
					aria-label={t("providerForm.api")}
				>
					{API_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.labelKey === undefined ? option.label : t(option.labelKey)}
						</option>
					))}
				</select>
			</label>

			<p className="set-label">{t("providerForm.models")}</p>
			<ul className="set-list">
				{draft.rows.map((row, index) => {
					const model = row.model;
					return (
						<li key={row.key} className="set-row is-block">
							<div className="set-row-head">
								<input
									className="set-input mono"
									value={model.id}
									onChange={(event) => patchModel(row.key, { id: event.target.value })}
									placeholder={t("providerForm.modelId")}
									aria-label={t("providerForm.modelIdLabel", { index: index + 1 })}
								/>
								<input
									className="set-input"
									value={model.name ?? ""}
									onChange={(event) => patchModel(row.key, { name: event.target.value })}
									placeholder={t("providerForm.modelName")}
									aria-label={t("providerForm.modelNameLabel", { index: index + 1 })}
								/>
								<input
									className="set-input mono"
									type="number"
									value={model.contextWindow ?? ""}
									onChange={(event) =>
										patchModel(row.key, {
											contextWindow: event.target.value === "" ? undefined : Number(event.target.value),
										})
									}
									placeholder={t("providerForm.contextWindow")}
									aria-label={t("providerForm.modelContextLabel", { index: index + 1 })}
								/>
								<input
									className="set-input mono"
									type="number"
									value={model.maxTokens ?? ""}
									onChange={(event) =>
										patchModel(row.key, {
											maxTokens: event.target.value === "" ? undefined : Number(event.target.value),
										})
									}
									placeholder={t("providerForm.maxOutput")}
									aria-label={t("providerForm.modelOutputLabel", { index: index + 1 })}
								/>
								<label className="set-toggle">
									<input
										type="checkbox"
										checked={model.reasoning === true}
										onChange={(event) => patchModel(row.key, { reasoning: event.target.checked })}
									/>
									<span>{t("providerForm.supportsThinking")}</span>
								</label>
								<button
									type="button"
									className="set-row-action is-danger"
									onClick={() =>
										setDraft((current) => ({
											...current,
											rows: current.rows.filter((item) => item.key !== row.key),
										}))
									}
									disabled={draft.rows.length <= 1}
								>
									{t("providerForm.remove")}
								</button>
							</div>
						</li>
					);
				})}
			</ul>
			<div className="set-actions">
				<button
					type="button"
					className="set-reset"
					onClick={() => setDraft((current) => ({ ...current, rows: [...current.rows, modelRow()] }))}
				>
					{t("providerForm.addModel")}
				</button>
			</div>

			{error === undefined ? null : <p className="set-row-error">{error}</p>}

			<div className="set-actions">
				<button type="button" className="set-save" disabled={isSaving} onClick={() => void submit()}>
					{isSaving ? t("providerForm.saving") : t("providerForm.save")}
				</button>
				<button type="button" className="set-reset" onClick={onCancel}>
					{t("providerForm.cancel")}
				</button>
			</div>
		</div>
	);
}
