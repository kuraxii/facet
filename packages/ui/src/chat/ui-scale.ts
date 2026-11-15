/** 界面缩放的离散档位，数值是百分比。 */
export const UI_SCALE_STEPS = [80, 90, 100, 110, 125, 135, 150] as const;

/** 缺省界面缩放百分比。 */
export const DEFAULT_UI_SCALE = 100;

/** 取最接近的可用档位。 */
export function normalizeUiScale(value: number): number {
	return UI_SCALE_STEPS.reduce((closest, candidate) =>
		Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest,
	);
}

/** 按方向取相邻档位，已到末端时保持当前档位。 */
export function stepUiScale(value: number, direction: 1 | -1): number {
	const current = normalizeUiScale(value);
	const index = UI_SCALE_STEPS.indexOf(current as (typeof UI_SCALE_STEPS)[number]);
	const next = UI_SCALE_STEPS[Math.max(0, Math.min(UI_SCALE_STEPS.length - 1, index + direction))];
	return next ?? current;
}
