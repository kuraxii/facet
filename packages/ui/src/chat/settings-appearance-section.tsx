/**
 * 设置页的外观分节。
 *
 * 从 `SettingsPage.tsx` 拆出来的：页面外壳只管分类、读取与保存，每一节的控件与文案键留在
 * 自己这一份里。改动的入口仍是父级给的 `patch`，外观另外多一条 `onPreview`——外观改动要
 * 立刻作用到界面上，关掉设置页而不保存时由宿主恢复。
 */
import type { FacetSettings, LiveMotion } from "@facet/protocol";
import { Input } from "../common/Input.tsx";
import { Select } from "../common/select.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { MONO_FONT_FAMILY } from "../styles/font-families.ts";
import { CODE_THEME_OPTIONS, UI_THEME_OPTIONS } from "../theme.ts";
import { SettingsGroup, SettingsRow } from "./settings-layout.tsx";

/** 运行中动效的选项，顺序与设置页列出的顺序一致。 */
const LIVE_MOTION_OPTIONS: ReadonlyArray<{
	id: LiveMotion;
	labelKey: "settings.appearancePage.pulse" | "settings.appearancePage.shimmer";
}> = [
	{ id: "pulse", labelKey: "settings.appearancePage.pulse" },
	{ id: "shimmer", labelKey: "settings.appearancePage.shimmer" },
];

/** 外观设置。 */
export function AppearanceSection({
	draft,
	patch,
	onPreview,
}: {
	draft: FacetSettings;
	patch: (change: (current: FacetSettings) => FacetSettings) => void;
	onPreview: ((appearance: FacetSettings["appearance"]) => void) | undefined;
}) {
	const { t } = useI18n();
	const appearance = draft.appearance;
	/**
	 * 编辑器与终端留空时实际用的字体。
	 *
	 * 两者在样式表里是 `var(--font-mono)`，所以代码字体填了就跟着它走，没填就是随包的那一个；
	 * 占位提示写这个，不写「跟代码字体」这种说法。
	 */
	const monoFallback = appearance.codeFont.trim().length > 0 ? appearance.codeFont.trim() : MONO_FONT_FAMILY;
	const themeLabel = (id: FacetSettings["appearance"]["theme"]): string => {
		switch (id) {
			case "light":
				return t("theme.light");
			case "dark":
				return t("theme.dark");
			case "midnight":
				return t("theme.midnight");
			case "claude":
				return t("theme.claude");
			case "ghostty":
				return t("theme.ghostty");
			case "pureBlack":
				return t("theme.pureBlack");
			case "system":
				return t("theme.system");
		}
	};
	// 外观改动立刻作用到界面上，关掉设置页而不保存时由宿主恢复
	const patchAppearance = (change: Partial<FacetSettings["appearance"]>): void => {
		const next = { ...appearance, ...change };
		patch((current) => ({ ...current, appearance: next }));
		onPreview?.(next);
	};
	/** 字号输入的公共写法：留空或越界时保持原值。 */
	const sizeInput = (value: number, name: keyof FacetSettings["appearance"]): React.JSX.Element => (
		<Input
			size="md"
			type="number"
			min={11}
			max={20}
			step={0.5}
			value={value}
			onChange={(event) => {
				const next = Number(event.target.value);
				if (Number.isFinite(next)) {
					patchAppearance({ [name]: next } as Partial<FacetSettings["appearance"]>);
				}
			}}
			aria-label={String(name)}
		/>
	);

	return (
		<>
			<h2 className="set-section-title">{t("settings.appearancePage.title")}</h2>
			<SettingsGroup label={t("settings.appearancePage.general")}>
				<SettingsRow title={t("settings.appearancePage.theme")} isStacked>
					<div className="set-swatches">
						{/* 跟随系统排最前：它是缺省行为，也是唯一不直接挑色板的选项 */}
						<button
							type="button"
							className={appearance.theme === "system" ? "set-swatch is-active" : "set-swatch"}
							aria-label={t("theme.system")}
							aria-pressed={appearance.theme === "system"}
							onClick={() => patchAppearance({ theme: "system" })}
						>
							<i className="set-swatch-chip is-system" />
							<span className="set-swatch-name">{t("theme.system")}</span>
						</button>
						{UI_THEME_OPTIONS.map((option) => (
							<button
								key={option.id}
								type="button"
								className={appearance.theme === option.id ? "set-swatch is-active" : "set-swatch"}
								aria-label={themeLabel(option.id)}
								aria-pressed={appearance.theme === option.id}
								onClick={() => patchAppearance({ theme: option.id })}
							>
								<i className="set-swatch-chip" style={{ background: option.swatch }} />
								<span className="set-swatch-name">{themeLabel(option.id)}</span>
							</button>
						))}
					</div>
				</SettingsRow>
				<SettingsRow title={t("settings.appearancePage.liveMotion")}>
					<Select
						value={appearance.liveMotion}
						options={LIVE_MOTION_OPTIONS.map((option) => ({ value: option.id, label: t(option.labelKey) }))}
						onChange={(value) => patchAppearance({ liveMotion: value as LiveMotion })}
						ariaLabel={t("settings.appearancePage.liveMotion")}
					/>
				</SettingsRow>
				<SettingsRow title={t("settings.appearancePage.reducedMotion")}>
					<input
						type="checkbox"
						checked={appearance.reducedMotion}
						onChange={(event) => patchAppearance({ reducedMotion: event.target.checked })}
						aria-label={t("settings.appearancePage.reducedMotion")}
					/>
				</SettingsRow>
				<SettingsRow title={t("settings.appearancePage.outlineScale")}>
					<Input
						size="md"
						type="number"
						min={50}
						max={200}
						step={5}
						value={appearance.outlineScale}
						onChange={(event) => {
							const next = Number(event.target.value);
							if (Number.isFinite(next)) {
								patchAppearance({ outlineScale: next });
							}
						}}
						aria-label={t("settings.appearancePage.outlineScale")}
					/>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label={t("settings.appearancePage.fonts")}>
				{/* 占位提示写「留空时实际用的那个字体」：代码字体留空是随包的那一个，编辑器与终端
				    留空是跟着代码字体走，所以它们的提示就是代码字体当前的值 */}
				<SettingsRow title={t("settings.appearancePage.codeFont")}>
					<Input
						size="md"
						value={appearance.codeFont}
						onChange={(event) => patchAppearance({ codeFont: event.target.value })}
						placeholder={MONO_FONT_FAMILY}
						aria-label={t("settings.appearancePage.codeFont")}
					/>
				</SettingsRow>
				<SettingsRow title={t("settings.appearancePage.editorFont")}>
					<Input
						size="md"
						value={appearance.editorFont}
						onChange={(event) => patchAppearance({ editorFont: event.target.value })}
						placeholder={monoFallback}
						aria-label={t("settings.appearancePage.editorFont")}
					/>
				</SettingsRow>
				<SettingsRow title={t("settings.appearancePage.editorFontSize")}>
					{sizeInput(appearance.editorFontSize, "editorFontSize")}
				</SettingsRow>
				<SettingsRow title={t("settings.appearancePage.terminalFont")}>
					<Input
						size="md"
						value={appearance.terminalFont}
						onChange={(event) => patchAppearance({ terminalFont: event.target.value })}
						placeholder={monoFallback}
						aria-label={t("settings.appearancePage.terminalFont")}
					/>
				</SettingsRow>
				<SettingsRow title={t("settings.appearancePage.terminalFontSize")}>
					{sizeInput(appearance.terminalFontSize, "terminalFontSize")}
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label={t("settings.appearancePage.codeTheme")}>
				<SettingsRow title={t("settings.appearancePage.codeTheme")}>
					<Select
						value={appearance.codeTheme}
						options={CODE_THEME_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
						onChange={(value) =>
							patchAppearance({ codeTheme: value as FacetSettings["appearance"]["codeTheme"] })
						}
						ariaLabel={t("settings.appearancePage.codeTheme")}
					/>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}
