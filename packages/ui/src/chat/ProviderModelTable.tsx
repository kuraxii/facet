/**
 * 提供方弹窗里的模型清单。
 *
 * 表头与每行共用同一组列宽（见 `settings.css` 的 `--prov-model-columns`），字段上下对齐。
 * 这一块只画表、不认识保存与拉取：改哪一格、拉取按钮什么时候能按，都由弹窗传进来。
 */
import type { CustomModelInfo } from "@facet/protocol";
import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../common/Button.tsx";
import { IconButton } from "../common/IconButton.tsx";
import { Input } from "../common/Input.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { ProviderThinkingLevels } from "./ProviderThinkingLevels.tsx";
import type { ModelRow } from "./provider-model-row.ts";

/** 模型表的参数。 */
export interface ProviderModelTableProps {
	/** 表单里的模型行 */
	rows: readonly ModelRow[];
	/** 正在从上游拉清单 */
	isFetching: boolean;
	/** 接口地址填了才能拉 */
	canFetch: boolean;
	/** 从上游拉清单 */
	onFetch: () => void;
	/** 加一行空模型 */
	onAdd: () => void;
	/** 改一行的某个字段 */
	onPatch: (key: string, change: Partial<CustomModelInfo>) => void;
	/** 删一行 */
	onRemove: (key: string) => void;
}

/** 模型清单。 */
export function ProviderModelTable({
	rows,
	isFetching,
	canFetch,
	onFetch,
	onAdd,
	onPatch,
	onRemove,
}: ProviderModelTableProps): ReactNode {
	const { t } = useI18n();
	return (
		<section className="prov-section">
			<div className="prov-section-head">
				<span className="set-label">{t("providerForm.models")}</span>
				<span className="prov-section-actions">
					<Button
						variant="ghost"
						size="sm"
						className="prov-tone-accent"
						disabled={isFetching || !canFetch}
						onClick={onFetch}
					>
						{t("providerForm.fetchModels")}
					</Button>
					<Button variant="ghost" size="sm" className="prov-tone-accent" onClick={onAdd}>
						<Plus size={ICON_SIZE.md} aria-hidden="true" />
						{t("providerForm.addModel")}
					</Button>
				</span>
			</div>
			<div className="prov-model-head" aria-hidden="true">
				<span>{t("providerForm.modelId")}</span>
				<span>{t("providerForm.modelName")}</span>
				<span>{t("providerForm.contextWindow")}</span>
				<span>{t("providerForm.maxOutput")}</span>
				<span>{t("providerForm.supportsThinking")}</span>
				<span />
			</div>
			<ul className="prov-models">
				{rows.map((row, index) => {
					const model = row.model;
					return (
						<li key={row.key} className="prov-model">
							<Input
								size="md"
								value={model.id}
								onChange={(event) => onPatch(row.key, { id: event.target.value })}
								placeholder={t("providerForm.modelId")}
								aria-label={t("providerForm.modelIdLabel", { index: index + 1 })}
							/>
							<Input
								size="md"
								value={model.name ?? ""}
								onChange={(event) => onPatch(row.key, { name: event.target.value })}
								placeholder={t("providerForm.modelName")}
								aria-label={t("providerForm.modelNameLabel", { index: index + 1 })}
							/>
							<Input
								size="md"
								type="number"
								value={model.contextWindow ?? ""}
								onChange={(event) =>
									onPatch(row.key, {
										contextWindow: event.target.value === "" ? undefined : Number(event.target.value),
									})
								}
								placeholder={t("providerForm.contextWindow")}
								aria-label={t("providerForm.modelContextLabel", { index: index + 1 })}
							/>
							<Input
								size="md"
								type="number"
								value={model.maxTokens ?? ""}
								onChange={(event) =>
									onPatch(row.key, {
										maxTokens: event.target.value === "" ? undefined : Number(event.target.value),
									})
								}
								placeholder={t("providerForm.maxOutput")}
								aria-label={t("providerForm.modelOutputLabel", { index: index + 1 })}
							/>
							<ProviderThinkingLevels
								levels={model.thinkingLevels ?? []}
								onChange={(levels) => onPatch(row.key, { thinkingLevels: levels })}
								label={t("providerForm.thinkingLevelsLabel", { index: index + 1 })}
								anchor={`prov-levels-${row.key}`}
							/>
							<IconButton
								variant="outline"
								size="sm"
								aria-label={t("providerForm.remove")}
								disabled={rows.length <= 1}
								onClick={() => onRemove(row.key)}
							>
								<X size={ICON_SIZE.lg} aria-hidden="true" />
							</IconButton>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
