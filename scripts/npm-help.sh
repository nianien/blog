#!/bin/bash

# NPM 命令帮助脚本
# 提供交互式的 npm 命令查询和快速执行功能

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 切换到项目根目录
cd "$(dirname "$0")/.."

# 显示标题
echo -e "${CYAN}================================${NC}"
echo -e "${CYAN}    NPM 命令帮助工具${NC}"
echo -e "${CYAN}================================${NC}"
echo ""

# 显示当前项目信息
echo -e "${BLUE}📋 项目信息:${NC}"
echo "   项目名称: $(node -p "require('./package.json').name")"
echo "   版本: $(node -p "require('./package.json').version")"
echo "   描述: $(node -p "require('./package.json').description")"
echo ""

# 显示可用的 npm 脚本
echo -e "${GREEN}📜 可用的 npm 脚本:${NC}"
npm run 2>/dev/null | grep -E "^  [a-zA-Z]" | while read line; do
    script_name=$(echo "$line" | awk '{print $1}')
    echo "   $script_name"
done
echo ""

# 显示常用命令
show_common_commands() {
    echo -e "${YELLOW}🚀 开发命令:${NC}"
    echo "   npm run dev      - 启动开发服务器"
    echo "   npm run build    - 构建生产版本"
    echo "   npm run start    - 启动生产服务器"
    echo ""
    
    echo -e "${YELLOW}🔧 代码质量:${NC}"
    echo "   npm run lint     - 代码检查"
    echo "   npm run lint:fix - 自动修复代码问题"
    echo "   npm run type-check - TypeScript 类型检查"
    echo ""
    
    echo -e "${YELLOW}🧹 维护命令:${NC}"
    echo "   npm run clean    - 清理缓存"
    echo "   npm run export   - 导出静态文件"
    echo ""
    
    echo -e "${YELLOW}📦 依赖管理:${NC}"
    echo "   npm install      - 安装依赖"
    echo "   npm update       - 更新依赖"
    echo "   npm outdated     - 查看过时的包"
    echo ""
}

# 显示快速操作菜单
show_menu() {
    echo -e "${PURPLE}🎯 快速操作:${NC}"
    echo "   1) 启动开发服务器"
    echo "   2) 构建生产版本"
    echo "   3) 代码检查"
    echo "   4) 清理缓存"
    echo "   5) 查看依赖信息"
    echo "   6) 显示所有命令"
    echo "   7) 退出"
    echo ""
}

# 执行快速操作
execute_action() {
    case $1 in
        1)
            echo -e "${GREEN}🚀 启动开发服务器...${NC}"
            npm run dev
            ;;
        2)
            echo -e "${GREEN}🔨 构建生产版本...${NC}"
            npm run build
            ;;
        3)
            echo -e "${GREEN}🔍 代码检查...${NC}"
            npm run lint
            echo ""
            echo -e "${GREEN}📝 TypeScript 类型检查...${NC}"
            npm run type-check
            ;;
        4)
            echo -e "${GREEN}🧹 清理缓存...${NC}"
            npm run clean
            echo "缓存已清理！"
            ;;
        5)
            echo -e "${GREEN}📦 依赖信息:${NC}"
            echo ""
            echo "📋 顶层依赖:"
            npm list --depth=0
            echo ""
            echo "📋 过时的包:"
            npm outdated
            ;;
        6)
            echo -e "${GREEN}📜 所有可用命令:${NC}"
            npm run
            ;;
        7)
            echo -e "${GREEN}👋 再见！${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}❌ 无效选择，请输入 1-7${NC}"
            ;;
    esac
}

# 显示帮助信息
show_help() {
    echo -e "${CYAN}📖 帮助信息:${NC}"
    echo ""
    echo "这个脚本提供以下功能："
    echo "• 显示项目信息和可用脚本"
    echo "• 提供常用 npm 命令的快速访问"
    echo "• 交互式菜单操作"
    echo "• 命令执行和状态反馈"
    echo ""
    echo "使用方法："
    echo "  ./scripts/npm-help.sh     - 显示交互式菜单"
    echo "  ./scripts/npm-help.sh -h  - 显示此帮助信息"
    echo ""
}

# 主函数
main() {
    # 检查参数
    if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
        show_help
        exit 0
    fi
    
    # 检查是否在项目根目录
    if [ ! -f "package.json" ]; then
        echo -e "${RED}❌ 错误: 未找到 package.json 文件${NC}"
        echo "请确保在项目根目录运行此脚本"
        exit 1
    fi
    
    # 显示项目信息
    show_common_commands
    
    # 交互式菜单
    while true; do
        show_menu
        read -p "请选择操作 (1-7): " choice
        
        if [ -n "$choice" ]; then
            execute_action "$choice"
            echo ""
            read -p "按回车键继续..."
            echo ""
        fi
    done
}

# 运行主函数
main "$@" 