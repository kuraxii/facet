/**
 * 图片预览的纯逻辑：请求收口、缩放档位、以指针为中心的平移补偿与翻页。
 */
import { describe, expect, it } from "vitest";
import {
	clampScale,
	downloadFileName,
	fitScale,
	hasOverflow,
	normalizeRequest,
	PREVIEW_MAX_SCALE,
	PREVIEW_MIN_SCALE,
	scalePercent,
	stepIndex,
	toggleZoom,
	zoomAround,
} from "./image-preview-state.ts";

describe("normalizeRequest", () => {
	it("丢掉没有地址的项，越界的下标夹回范围内", () => {
		const session = normalizeRequest({
			items: [
				{ src: "", alt: "空" },
				{ src: "a.png", alt: "甲" },
				{ src: "b.png", alt: "乙" },
			],
			index: 9,
		});
		expect(session?.items.map((item) => item.src)).toEqual(["a.png", "b.png"]);
		expect(session?.index).toBe(1);
	});

	it("一张都不剩时不开浮层", () => {
		expect(normalizeRequest({ items: [{ src: "", alt: "" }] })).toBeUndefined();
	});

	it("没有下标时停在第一张，读不懂的下标也算第一张", () => {
		const items = [
			{ src: "a.png", alt: "" },
			{ src: "b.png", alt: "" },
		];
		expect(normalizeRequest({ items })?.index).toBe(0);
		expect(normalizeRequest({ items, index: Number.NaN })?.index).toBe(0);
		expect(normalizeRequest({ items, index: -3 })?.index).toBe(0);
	});
});

describe("clampScale", () => {
	it("夹在 0.25 与 5 之间", () => {
		expect(clampScale(0.1)).toBe(PREVIEW_MIN_SCALE);
		expect(clampScale(9)).toBe(PREVIEW_MAX_SCALE);
		expect(clampScale(2)).toBe(2);
	});

	it("读不懂的值按适应视口算", () => {
		expect(clampScale(Number.NaN)).toBe(1);
		expect(clampScale(0)).toBe(1);
		expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
	});
});

describe("zoomAround", () => {
	it("指针下方的那一点缩放前后不动", () => {
		const pan = { x: 0, y: 0 };
		const scale = 1;
		const next = 2;
		const pointer = { x: 100, y: 50 };
		const moved = zoomAround(pan, scale, next, pointer);
		// 缩放前指针下的图片点：(100, 50) / 1；缩放后要仍落在 (100, 50)
		expect(pointer.x - moved.x).toBeCloseTo((pointer.x - pan.x) * next);
		expect(pointer.y - moved.y).toBeCloseTo((pointer.y - pan.y) * next);
	});

	it("不在中心的指针会带来平移，中心点不带来", () => {
		expect(zoomAround({ x: 0, y: 0 }, 1, 2, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
		expect(zoomAround({ x: 10, y: 0 }, 1, 2, { x: 40, y: 0 })).toEqual({ x: -20, y: 0 });
	});

	it("倍率或指针读不懂时原样返回", () => {
		expect(zoomAround({ x: 3, y: 4 }, 0, 2, { x: 1, y: 1 })).toEqual({ x: 3, y: 4 });
		expect(zoomAround({ x: 3, y: 4 }, 1, Number.NaN, { x: 1, y: 1 })).toEqual({ x: 3, y: 4 });
	});
});

describe("翻页", () => {
	it("前后各走一步，到头绕回另一端", () => {
		expect(stepIndex(0, 1, 3)).toBe(1);
		expect(stepIndex(2, 1, 3)).toBe(0);
		expect(stepIndex(0, -1, 3)).toBe(2);
	});

	it("没有图片时停在 0", () => {
		expect(stepIndex(0, 1, 0)).toBe(0);
	});
});

describe("缩放档位", () => {
	it("百分比以原始像素为 100%", () => {
		expect(scalePercent(1)).toBe("100%");
		expect(scalePercent(1.25)).toBe("125%");
		expect(scalePercent(0.25)).toBe("25%");
	});

	it("适应窗口取两轴里更小的那个比例，小图不超过 100%", () => {
		expect(fitScale({ width: 2000, height: 1000 }, { width: 1000, height: 800 })).toBe(0.5);
		expect(fitScale({ width: 2000, height: 4000 }, { width: 1000, height: 800 })).toBe(0.2);
		expect(fitScale({ width: 300, height: 200 }, { width: 1000, height: 800 })).toBe(1);
		// 还没量到窗口尺寸时不做缩放
		expect(fitScale({ width: 800, height: 600 }, { width: 0, height: 0 })).toBe(1);
	});

	it("双击在 100% 与适应窗口之间切换", () => {
		expect(toggleZoom(1, 0.4)).toBe(0.4);
		expect(toggleZoom(0.4, 0.4)).toBe(1);
		expect(toggleZoom(2, 0.4)).toBe(1);
	});

	it("图片超出窗口才谈得上拖动", () => {
		const natural = { width: 2000, height: 1000 };
		const viewport = { width: 1000, height: 800 };
		expect(hasOverflow(natural, 1, viewport)).toBe(true);
		expect(hasOverflow(natural, 0.5, viewport)).toBe(false);
		expect(hasOverflow(natural, 0.4, viewport)).toBe(false);
		// 还在量窗口时不给拖动
		expect(hasOverflow(natural, 1, { width: 0, height: 0 })).toBe(false);
	});
});

describe("下载文件名", () => {
	it("用 alt，清掉文件名里的非法字符", () => {
		expect(downloadFileName({ src: "data:image/png;base64,AA", alt: "截图 2024/01" })).toBe("截图 2024-01");
	});

	it("没有 alt 时从地址里捡", () => {
		expect(downloadFileName({ src: "https://example.com/a/b/photo.jpeg?x=1", alt: "" })).toBe("photo.jpeg");
		expect(downloadFileName({ src: "data:image/png;base64,AA", alt: "" })).toBe("image.png");
	});
});
