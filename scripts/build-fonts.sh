#!/usr/bin/env bash
# 从本机的 Maple Mono 生成界面用的 woff2。
#
# 这里只切 Latin、符号与制表符：汉字与中文标点由 @automann/maple-mono-cn 的 400 分片提供
# （见 packages/ui/src/styles/fonts.css）。CJK 字形放进每个 woff2 会让一个字重多出五兆左右。
# 字体来自 Maple Mono NL NF CN v7.9，OFL-1.1，许可文本随字体一起放在
# packages/ui/src/assets/fonts/LICENSE.txt。
#
# 用法：scripts/build-fonts.sh [字体目录]，缺省读 ~/.fonts。
set -euo pipefail

source_dir="${1:-$HOME/.fonts}"
target_dir="$(dirname "$0")/../packages/ui/src/assets/fonts"
# 空白、拉丁字母与常用符号：箭头、数学符号、技术符号、制表符、几何图形、杂项符号
unicodes="U+0020-007E,U+00A0-024F,U+2000-206F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+2500-257F,U+25A0-25FF,U+2600-27BF"

mkdir -p "$target_dir"
for pair in Regular:400 Medium:500 SemiBold:600; do
	weight="${pair%%:*}"
	name="${pair##*:}"
	uvx --with brotli --from fonttools fonttools subset "$source_dir/MapleMonoNL-NF-CN-$weight.ttf" \
		--output-file="$target_dir/maple-mono-$name.woff2" --flavor=woff2 \
		--unicodes="$unicodes" --no-hinting
done
echo "字体已生成到 $target_dir"
