/**
 * 思考档位的两种写法之间的换算。
 *
 * 界面上选的是「这个模型支持哪几档」，pi 的 `models.json` 里要的是逐档的映射
 * （`thinkingLevelMap`）：值给档位名表示这一档可用，给 `null` 表示这一档不支持。两边语义差
 * 一层，换算规则写在这里，读写配置与补全上游清单共用同一份，免得各自的缺省值走偏。
 *
 * pi 的判定规则（`getSupportedThinkingLevels`）决定了映射怎么省：
 *
 * - `off` / `minimal` / `low` / `medium` / `high` 五项**不写就是可用**，值缺省等于档位名；
 *   `off` 的缺省由各协议自己决定关法（OpenAI 兼容是 `none`，DeepSeek 系是 `thinking.type`）。
 * - `xhigh` / `max` 两项**必须显式写值才出现**，不写就是不支持。
 *
 * 所以「可用」只在 `xhigh` / `max` 上需要写出来，「不可用」一律写 `null`；写出来的映射与 pi
 * 自己目录里的形状一致（例如只列 `xhigh` 与 `max` 的那两条）。
 */
import type { ThinkingLevel } from "@facet/protocol";

/** 七档，从低到高。界面、配置与补全都按这个顺序排。 */
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** 需要显式写值才出现的两档。 */
const EXPLICIT_LEVELS: readonly ThinkingLevel[] = ["xhigh", "max"];

/** `models.json` 里一档的取值：档位名，或 `null` 表示不支持。 */
export type ThinkingLevelMapValue = string | null;

/** `models.json` 里的整张映射。 */
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, ThinkingLevelMapValue>>;

/** 把任意一组档位收成标准顺序、去重后的数组。 */
export function normalizeLevels(levels: readonly ThinkingLevel[]): ThinkingLevel[] {
	return THINKING_LEVELS.filter((level) => levels.includes(level));
}

/**
 * 这一组档位里有没有「会思考」的那一档。
 *
 * 只有 `off` 或者一档都没有时，这个模型按不会思考处理：写入时给 `reasoning: false`，
 * pi 给出的可用档位就只剩 `off`。
 */
export function hasThinking(levels: readonly ThinkingLevel[]): boolean {
	return levels.some((level) => level !== "off");
}

/**
 * 档位集合 → `thinkingLevelMap`。
 *
 * 不会思考时返回 `undefined`：这一项压根不写，由 `reasoning: false` 表达。写空对象与不写
 * 等价，但空对象等于「给了映射却什么都没说」，不写更干净。
 */
export function levelsToMap(levels: readonly ThinkingLevel[]): ThinkingLevelMap | undefined {
	if (!hasThinking(levels)) {
		return undefined;
	}
	const supported = new Set(levels);
	const map: ThinkingLevelMap = {};
	for (const level of THINKING_LEVELS) {
		if (!supported.has(level)) {
			map[level] = null;
		} else if (EXPLICIT_LEVELS.includes(level)) {
			map[level] = level;
		}
	}
	return map;
}

/**
 * `thinkingLevelMap` → 档位集合。
 *
 * 判读顺序与 pi 一致：`off` 到 `high` 不写即可用，`xhigh` / `max` 写了才算。`reasoning` 为假
 * 时 pi 只给 `off`，这里给空集——两者写入时都落到 `reasoning: false`，但空集表示「这个模型
 * 没有档位可选」，界面上不会假装它有一档。
 */
export function levelsFromMap(
	map: ThinkingLevelMap | undefined,
	reasoning: boolean | undefined,
): ThinkingLevel[] {
	if (reasoning !== true) {
		return [];
	}
	return THINKING_LEVELS.filter((level) => {
		const value = map?.[level];
		return EXPLICIT_LEVELS.includes(level) ? value !== undefined && value !== null : value !== null;
	});
}
