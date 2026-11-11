/**
 * 提供方列表的组装。
 *
 * 内置与自定义放在同一份列表里：pi 的目录本来就把两者一起列出来，再按 models.json 里有没有
 * 模型清单标一下来源，同一个提供方只出现一次。
 */
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
