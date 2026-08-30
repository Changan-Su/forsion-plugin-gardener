#!/usr/bin/env bash
# 装/更新「库园丁」捆绑包(bundle)到 Forsion 家目录。
#   用法:sh install.sh [dev|prod]     缺省 dev(~/.forsion-dev);prod=~/.forsion
# 本仓即 bundle 本体:整目录拷到 <home>/plugins/vault-gardener/ 一处即完成——
#   桌面识别 manifest.json(UI 插件)+ spaces/(内嵌 Space「库园丁」)。
# 本插件 v1 **不带 agents/ 与 skills/**:它一次都不发给模型,提案全部由插件自己用确定性规则算出。
# 用户数据(工作文件夹里的 .gardener/ledger.json 与 .gardener-undo/ 快照)在 vault 里,不受重装影响。
set -euo pipefail
MODE="${1:-dev}"
case "$MODE" in
  dev)  HOME_DIR="$HOME/.forsion-dev" ;;
  prod) HOME_DIR="$HOME/.forsion" ;;
  *) echo "用法:sh install.sh [dev|prod]" >&2; exit 2 ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME_DIR/plugins/vault-gardener"

# 不许从已安装目录内自更新:下面的 rm -rf 会先删掉复制源(自己),把插件卸成空壳
if [ "$HERE" = "$(cd "$DEST" 2>/dev/null && pwd || true)" ]; then
  echo "❌ 正在从已安装目录运行,请从源码仓的 forsion-plugin-gardener/ 目录执行 install.sh" >&2
  exit 2
fi

mkdir -p "$HOME_DIR/plugins"
rm -rf "$DEST"
cp -R "$HERE" "$DEST"
# 迁移:若曾把 space 装在顶层 spaces/vault-gardener,它会以「用户 Space 优先」遮蔽 bundle 内嵌版。
# 只在它确是库园丁配方(引用 plugin:vault-gardener: 视图)时改名备份令其不再注册——
# 目录与用户其他文件原样保留,绝不无差别删除同名用户资产。
OLD_SPACE="$HOME_DIR/spaces/vault-gardener/space.json"
if grep -q 'plugin:vault-gardener:' "$OLD_SPACE" 2>/dev/null; then
  mv "$OLD_SPACE" "$OLD_SPACE.pre-bundle.bak"
  echo "   (旧版顶层 Space 配方已备份为 space.json.pre-bundle.bak,不再遮蔽 bundle 内嵌版)"
fi

echo "✅ 已安装 bundle → $DEST"
echo "重开 Forsion(dev:重启 desktop)后:命令面板「库园丁:打开」,或工作台切到「库园丁」Space。"
echo "   首次使用建议先在插件设置里确认「启用的规则」,再点「扫描全库」——扫描只读文件,一个字节都不会写。"
