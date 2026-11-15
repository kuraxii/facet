#!/usr/bin/env bash
# 从本机的完整 Maple Mono CN 生成界面用的 woff2。
#
# 400 / 500 / 600 三个文件都包含 Latin、符号、制表符与整个 CJK 基本区，由浏览器按字重选用；
# 字体来自 Maple Mono NL NF CN v7.9，OFL-1.1，许可文本随字体一起放在
# packages/ui/src/assets/fonts/LICENSE.txt。
#
# 用法：scripts/build-fonts.sh [字体目录]，缺省读 ~/.fonts。
set -euo pipefail

source_dir="${1:-$HOME/.fonts}"
target_dir="$(dirname "$0")/../packages/ui/src/assets/fonts"

mkdir -p "$target_dir"
for pair in Regular:400 Medium:500 SemiBold:600; do
	weight="${pair%%:*}"
	name="${pair##*:}"
	uvx --with brotli --from fonttools fonttools ttLib.woff2 compress \
		"$source_dir/MapleMonoNL-NF-CN-$weight.ttf" \
		-o "$target_dir/maple-mono-cn-$name.woff2"
done
echo "字体已生成到 $target_dir"
