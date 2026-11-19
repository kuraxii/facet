/**
 * 提供方列表的组装。
 *
 * 内置与自定义放在同一份列表里：pi 的目录本来就把两者一起列出来，再按 models.json 里有没有
 * 模型清单标一下来源，同一个提供方只出现一次。
 */

import type { Translate } from "@facet/i18n";
import type { CustomProviderInfo, ProviderInfo } from "@facet/protocol";

/** 列表里的一行。 */
export interface ProviderRow {
	/** pi 目录里的提供方信息 */
	provider: ProviderInfo;
	/** 对应的自定义配置；内置提供方没有 */
	custom?: CustomProviderInfo;
}

/**
 * 组装提供方列表。
 *
 * 顺序沿用 pi 目录的顺序；只出现在配置里、目录里还没有的条目补在末尾，避免刚保存的自定义
 * 提供方因为目录还没刷新而消失。
 */
export function providerRows(
	providers: readonly ProviderInfo[],
	customs: readonly CustomProviderInfo[],
): ProviderRow[] {
	const customById = new Map(customs.map((entry) => [entry.id, entry]));
	const rows: ProviderRow[] = providers.map((provider) => {
		const custom = customById.get(provider.id);
		return custom === undefined ? { provider } : { provider, custom };
	});
	const known = new Set(providers.map((provider) => provider.id));
	for (const custom of customs) {
		if (known.has(custom.id)) {
			continue;
		}
		rows.push({
			provider: {
				id: custom.id,
				name: custom.name,
				authenticated: false,
				modelCount: custom.models.length,
				baseUrl: custom.baseUrl,
			},
			custom,
		});
	}
	return rows;
}

/** 地址里看得懂的那一段：去掉协议与末尾斜杠。 */
function hostOf(baseUrl: string): string {
	return baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/**
 * 列表行下面那行来源。
 *
 * 接口地址一眼能对上「这个提供方连的是哪儿」，内置与自定义都写它；后面跟模型数量。
 */
export function providerMeta(row: ProviderRow, t: Translate): string {
	const baseUrl = row.custom?.baseUrl ?? row.provider.baseUrl;
	const origin = baseUrl === undefined || baseUrl.trim().length === 0 ? row.provider.id : hostOf(baseUrl);
	if (row.provider.modelCount <= 0) {
		return origin;
	}
	return `${origin} · ${t("providers.modelsCount", { count: row.provider.modelCount })}`;
}
