---
title: "Git 常用命令速查手册"
pubDate: "2024-04-05"
description: "一份面向日常开发的 Git 命令速查手册，覆盖分支管理、暂存与恢复、提交操作、远程协作、文件追踪控制、子模块、日志查询与常见问题处理等场景，适合收藏备用。"
tags: ["Git", "版本控制", "开发工具"]
---

# Git 常用命令速查手册

> 本文按使用场景组织，覆盖日常开发中最常用的 Git 操作。每条命令附带简要说明，部分附有使用示例。

---

## 1. 配置

```bash
# 查看当前配置
git config --list

# 设置用户信息（全局）
git config --global user.name "Your Name"
git config --global user.email "your@email.com"

# 仅对当前仓库设置（去掉 --global）
git config user.name "Your Name"

# 设置默认编辑器
git config --global core.editor "vim"

# 设置默认分支名
git config --global init.defaultBranch main

# 配置命令别名
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.st status
git config --global alias.lg "log --oneline --graph --all"
```

---

## 2. 仓库初始化与克隆

```bash
# 初始化新仓库
git init

# 克隆远程仓库
git clone <url>

# 克隆指定分支
git clone -b <branch> <url>

# 浅克隆（只拉最近 1 次提交，适合大仓库）
git clone --depth 1 <url>

# 克隆并指定本地目录名
git clone <url> my-project
```

---

## 3. 文件追踪与暂存

```bash
# 查看工作区状态
git status

# 简洁模式
git status -s

# 添加文件到暂存区
git add <file>
git add .                    # 当前目录所有变更
git add -A                   # 整个仓库所有变更
git add -p                   # 交互式选择要暂存的代码块

# 取消暂存（保留工作区修改）
git restore --staged <file>
git reset HEAD <file>        # 旧写法，效果相同

# 丢弃工作区修改（危险操作，不可恢复）
git restore <file>
git checkout -- <file>       # 旧写法
```

### 取消跟踪已版本控制的文件

```bash
# 不再追踪文件改动（文件保留在仓库中，但本地修改不再显示为 dirty）
git update-index --assume-unchanged <filePath>

# 恢复追踪
git update-index --no-assume-unchanged <filePath>

# 查看所有被 assume-unchanged 的文件
git ls-files -v | grep '^h'

# 从版本控制中删除文件（但保留本地文件）
git rm --cached <filePath>

# 从版本控制中删除文件夹
git rm -r -f --cached <dirPath>
```

> **`--assume-unchanged` vs `--skip-worktree`**：两者都能让 Git 忽略本地修改，但语义不同。`--assume-unchanged` 是性能优化提示（告诉 Git "这个文件不会变"），`--skip-worktree` 是明确的意图声明（"我故意修改了这个文件，但不想提交"）。对于本地配置文件的修改，推荐使用 `--skip-worktree`。

```bash
git update-index --skip-worktree <filePath>
git update-index --no-skip-worktree <filePath>
git ls-files -v | grep '^S'    # 查看所有 skip-worktree 文件
```

---

## 4. 提交

```bash
# 提交暂存区内容
git commit -m "commit message"

# 添加并提交所有已跟踪文件的修改（不含新文件）
git commit -am "commit message"

# 修改最近一次提交的信息（未推送到远程时使用）
git commit --amend -m "new message"

# 修改最近一次提交，追加文件但不改消息
git commit --amend --no-edit

# 创建空提交（可用于触发 CI）
git commit --allow-empty -m "trigger build"
```

---

## 5. 分支管理

```bash
# 查看本地分支
git branch

# 查看所有分支（含远程）
git branch -a

# 查看分支及最后一次提交
git branch -v

# 创建分支
git branch <name>

# 创建并切换
git checkout -b <name>
git switch -c <name>         # 推荐新写法

# 切换分支
git checkout <name>
git switch <name>            # 推荐新写法

# 重命名当前分支
git branch -m <new-name>

# 删除本地分支（已合并）
git branch -d <name>

# 强制删除本地分支（未合并也删）
git branch -D <name>

# 删除远程分支
git push origin --delete <name>

# 查看已合并到当前分支的分支
git branch --merged

# 查看未合并到当前分支的分支
git branch --no-merged
```

---

## 6. 合并与变基

```bash
# 合并指定分支到当前分支
git merge <branch>

# 合并时不使用 fast-forward（保留合并提交记录）
git merge --no-ff <branch>

# 只生成一个合并提交（压缩对方所有提交）
git merge --squash <branch>

# 变基（将当前分支的提交移到目标分支的最新提交之后）
git rebase <branch>

# 交互式变基（修改/合并/删除/排序最近 N 次提交）
git rebase -i HEAD~N

# 变基冲突后继续 / 跳过 / 终止
git rebase --continue
git rebase --skip
git rebase --abort

# 合并冲突后终止合并
git merge --abort
```

### Cherry-pick

```bash
# 将某个提交应用到当前分支
git cherry-pick <commit-hash>

# 连续多个提交
git cherry-pick <hash1> <hash2>

# 只暂存不提交
git cherry-pick <hash> --no-commit
```

---

## 7. 远程协作

```bash
# 查看远程仓库
git remote -v

# 添加远程仓库
git remote add origin <url>

# 修改远程仓库地址
git remote set-url origin <new-url>

# 拉取远程更新（不合并）
git fetch
git fetch --all              # 拉取所有远程
git fetch --prune            # 同时清理已删除的远程分支引用

# 拉取并合并（= fetch + merge）
git pull

# 拉取并变基（= fetch + rebase，保持线性历史）
git pull --rebase

# 推送
git push
git push origin <branch>

# 首次推送并建立追踪关系
git push -u origin <branch>

# 强制推送（覆盖远程历史，团队协作慎用）
git push --force

# 安全的强制推送（远程有新提交时会拒绝）
git push --force-with-lease

# 推送所有分支
git push --all

# 推送所有标签
git push --tags
```

---

## 8. 暂存工作区（Stash）

```bash
# 暂存当前工作区和暂存区的修改
git stash

# 带描述信息
git stash save "work in progress: feature X"
git stash push -m "description"   # 推荐新写法

# 暂存时包含未跟踪的文件
git stash -u

# 暂存时包含所有文件（含 .gitignore 忽略的）
git stash -a

# 查看 stash 列表
git stash list

# 恢复最近的 stash（保留 stash 记录）
git stash apply

# 恢复并删除最近的 stash
git stash pop

# 恢复指定的 stash
git stash apply stash@{2}

# 删除指定 stash
git stash drop stash@{0}

# 清空所有 stash
git stash clear

# 查看某个 stash 的内容
git stash show -p stash@{0}
```

---

## 9. 日志与差异

```bash
# 查看提交日志
git log

# 简洁单行显示
git log --oneline

# 图形化显示分支合并历史
git log --oneline --graph --all

# 显示每次提交的文件变更统计
git log --stat

# 显示每次提交的具体修改
git log -p

# 最近 N 次提交
git log -n 5

# 按作者过滤
git log --author="name"

# 按时间范围过滤
git log --since="2024-01-01" --until="2024-06-30"

# 按提交信息关键字搜索
git log --grep="fix bug"

# 搜索某段代码的变更历史
git log -S "functionName"

# 查看某个文件的提交历史
git log -- <file>
git log --follow -- <file>   # 包含重命名前的历史
```

### 差异对比

```bash
# 工作区 vs 暂存区
git diff

# 暂存区 vs 最新提交
git diff --staged
git diff --cached            # 同义

# 两个分支之间的差异
git diff <branch1>..<branch2>

# 两个提交之间的差异
git diff <commit1>..<commit2>

# 只看文件名列表
git diff --name-only

# 查看文件改动统计
git diff --stat
```

---

## 10. 撤销与回退

```bash
# 撤销工作区修改（未暂存）
git restore <file>

# 撤销暂存（保留工作区修改）
git restore --staged <file>

# 回退到某个提交（保留修改在工作区）
git reset --soft <commit>

# 回退到某个提交（保留修改在暂存区）
git reset --mixed <commit>     # 默认模式

# 回退到某个提交（丢弃所有修改，危险操作）
git reset --hard <commit>

# 回退最近 N 次提交
git reset --soft HEAD~N

# 创建一个新提交来撤销指定提交（安全的回退方式，不改写历史）
git revert <commit>

# 撤销多个连续提交
git revert <older-commit>..<newer-commit>

# 只修改工作区不自动提交
git revert --no-commit <commit>
```

> **`reset` vs `revert`**：`reset` 改写提交历史（适合未推送的本地提交），`revert` 创建新提交来撤销（适合已推送的公共分支）。在多人协作的分支上，永远优先使用 `revert`。

---

## 11. 标签

```bash
# 查看所有标签
git tag

# 按模式过滤
git tag -l "v1.*"

# 创建轻量标签
git tag <tag-name>

# 创建附注标签（推荐）
git tag -a <tag-name> -m "description"

# 给历史提交打标签
git tag -a <tag-name> <commit-hash>

# 查看标签详情
git show <tag-name>

# 推送单个标签到远程
git push origin <tag-name>

# 推送所有标签
git push origin --tags

# 删除本地标签
git tag -d <tag-name>

# 删除远程标签
git push origin --delete <tag-name>
```

---

## 12. 子模块

```bash
# 添加子模块
git submodule add <url> <path>

# 克隆含子模块的仓库
git clone --recurse-submodules <url>

# 已克隆后初始化子模块
git submodule init
git submodule update

# 一步到位
git submodule update --init --recursive

# 更新所有子模块到最新
git submodule update --remote

# 删除子模块
git submodule deinit <path>
git rm <path>
rm -rf .git/modules/<path>
```

---

## 13. Worktree（多工作目录）

```bash
# 为指定分支创建一个独立的工作目录（无需 stash 即可同时处理多个分支）
git worktree add <path> <branch>

# 创建新分支并建立 worktree
git worktree add -b <new-branch> <path>

# 查看所有 worktree
git worktree list

# 删除 worktree
git worktree remove <path>

# 清理无效的 worktree 引用
git worktree prune
```

---

## 14. 查找与定位

```bash
# 查找引入 bug 的提交（二分法）
git bisect start
git bisect bad                # 当前版本有 bug
git bisect good <commit>      # 某个已知正常的版本
# Git 自动切换到中间版本，测试后标记 good/bad，直到定位到具体提交
git bisect reset              # 结束 bisect

# 查看某行代码的最后修改人和提交
git blame <file>
git blame -L 10,20 <file>    # 只看第 10-20 行

# 在所有提交中搜索内容
git grep "pattern"
git grep "pattern" <branch>
```

---

## 15. 清理

```bash
# 预览将被清理的未跟踪文件
git clean -n

# 删除未跟踪的文件
git clean -f

# 删除未跟踪的文件和目录
git clean -fd

# 删除未跟踪的文件（含 .gitignore 忽略的文件）
git clean -fdx

# 垃圾回收（压缩历史，清理悬空对象）
git gc

# 清理远程已删除的分支引用
git remote prune origin
git fetch --prune             # 等价
```

---

## 16. 常见场景速查

### 撤销最近一次提交但保留代码

```bash
git reset --soft HEAD~1
```

### 合并多次提交为一个

```bash
git rebase -i HEAD~3
# 编辑器中将后两个 pick 改为 squash (或 s)，保存退出
```

### 从其他分支拿一个文件

```bash
git checkout <branch> -- <file>
git restore --source <branch> -- <file>   # 推荐新写法
```

### 找回误删的分支或提交

```bash
# 查看所有引用变更记录（包括已删除的）
git reflog

# 基于 reflog 中的哈希恢复
git checkout -b recovered-branch <hash>
```

### 修改历史提交的作者信息

```bash
git rebase -i <commit>^
# 将目标提交标记为 edit，保存退出
git commit --amend --author="Name <email>" --no-edit
git rebase --continue
```

### 统计代码贡献

```bash
# 按作者统计提交数
git shortlog -sn

# 统计某人的代码行数增删
git log --author="name" --numstat --pretty="%H" | awk 'NF==3 {add+=$1; del+=$2} END {print "+"add, "-"del}'
```

### 临时切到其他分支修 bug，不想 stash

```bash
# 用 worktree 在另一个目录打开 hotfix 分支，互不干扰
git worktree add ../hotfix-dir hotfix/issue-123

# 修完后删除
git worktree remove ../hotfix-dir
```

### 只克隆仓库的某个子目录（Sparse Checkout）

```bash
git clone --filter=blob:none --sparse <url>
cd <repo>
git sparse-checkout set path/to/subdir
```

### 把未提交的修改生成补丁发给别人

```bash
# 生成补丁文件
git diff > my-changes.patch

# 对方应用补丁
git apply my-changes.patch
```

### 把已提交的 commit 生成补丁

```bash
# 生成最近 3 次提交的补丁文件（每个提交一个 .patch 文件）
git format-patch -3

# 对方应用
git am *.patch
```

---

## 17. .gitignore

```bash
# .gitignore 文件常用模式

# 忽略所有 .log 文件
*.log

# 但保留 important.log
!important.log

# 忽略根目录下的 build 文件夹（不影响子目录中的 build）
/build/

# 忽略所有目录下的 node_modules
node_modules/

# 忽略所有 .env 文件（防止泄露密钥）
.env
.env.*

# 忽略 IDE 配置
.idea/
.vscode/
*.swp
*.swo
*~

# 忽略操作系统文件
.DS_Store
Thumbs.db
```

```bash
# .gitignore 已经添加规则，但文件之前已被跟踪？需要先从缓存中移除
git rm --cached <file>
git commit -m "stop tracking <file>"

# 检查某个文件为什么被忽略
git check-ignore -v <file>

# 列出所有被忽略的文件
git status --ignored

# 全局 gitignore（对所有仓库生效）
git config --global core.excludesfile ~/.gitignore_global
```

---

## 18. Git Hooks

Git Hooks 是在特定事件（提交、推送等）发生时自动执行的脚本，存放在 `.git/hooks/` 目录下。

### 常用 Hook 类型

| Hook | 触发时机 | 典型用途 |
|------|---------|---------|
| `pre-commit` | `git commit` 执行前 | 代码格式检查、lint、单元测试 |
| `commit-msg` | 提交信息写入后 | 校验 commit message 格式 |
| `pre-push` | `git push` 执行前 | 运行测试、阻止推送到 main |
| `post-merge` | `git merge` 完成后 | 自动安装依赖 |
| `pre-rebase` | `git rebase` 执行前 | 阻止对公共分支变基 |
| `post-checkout` | `git checkout` 完成后 | 环境初始化 |

### 示例：pre-commit 检查是否有 console.log

```bash
#!/bin/sh
# .git/hooks/pre-commit

if git diff --cached --name-only | grep -E '\.(js|ts|tsx)$' | xargs grep -l 'console\.log' 2>/dev/null; then
    echo "Error: console.log found in staged files"
    exit 1
fi
```

### 使用 Husky 管理 Hooks（推荐）

`.git/hooks/` 不会被提交到仓库，团队共享不方便。[Husky](https://typicode.github.io/husky/) 解决了这个问题：

```bash
# 安装
npm install husky -D
npx husky init

# 添加 pre-commit hook
echo "npm run lint" > .husky/pre-commit
```

---

## 19. Git LFS（大文件存储）

Git 不擅长处理大文件（二进制、模型文件、设计稿等），Git LFS 用指针文件替代大文件，实际内容存储在单独的 LFS 服务器上。

```bash
# 安装（macOS）
brew install git-lfs

# 在仓库中启用
git lfs install

# 追踪特定类型的大文件
git lfs track "*.psd"
git lfs track "*.zip"
git lfs track "models/**"

# 追踪规则保存在 .gitattributes 中，需要提交
git add .gitattributes
git commit -m "track large files with LFS"

# 后续正常 add/commit/push，LFS 文件会自动走 LFS 通道
git add large-file.psd
git commit -m "add design file"
git push

# 查看当前 LFS 追踪的文件模式
git lfs track

# 查看 LFS 管理的文件列表
git lfs ls-files

# 拉取所有 LFS 文件（克隆后可能需要）
git lfs pull
```

---

## 20. Git Archive（导出代码）

```bash
# 导出当前 HEAD 为 zip
git archive --format=zip HEAD -o project.zip

# 导出指定分支
git archive --format=tar.gz release/v1.0 -o release-v1.0.tar.gz

# 只导出某个子目录
git archive HEAD --prefix=src/ -- src/ -o src-only.zip

# 导出两个版本之间的差异文件
git diff --name-only v1.0 v2.0 | xargs git archive HEAD -o diff-files.zip --
```

---

## 21. 交互式变基详解

`git rebase -i` 是最强大的提交历史编辑工具，编辑器中每行一个提交，支持以下操作：

| 命令 | 缩写 | 作用 |
|------|------|------|
| `pick` | `p` | 保留该提交（默认） |
| `reword` | `r` | 保留提交但修改提交信息 |
| `edit` | `e` | 暂停在该提交，允许修改内容 |
| `squash` | `s` | 合并到上一个提交，合并提交信息 |
| `fixup` | `f` | 合并到上一个提交，丢弃本条提交信息 |
| `drop` | `d` | 删除该提交 |

### 典型场景

```bash
# 合并最近 4 次提交为 1 个
git rebase -i HEAD~4
# 编辑器中：第一个保持 pick，其余改为 squash 或 fixup

# 调整提交顺序：直接在编辑器中拖动行的位置

# 拆分一个提交为多个
git rebase -i HEAD~3
# 将目标提交标记为 edit，保存退出
git reset HEAD~1              # 撤回提交但保留文件修改
git add file1 && git commit -m "part 1"
git add file2 && git commit -m "part 2"
git rebase --continue
```

---

## 22. 签名与验证

```bash
# 配置 GPG 签名
git config --global user.signingkey <GPG-KEY-ID>
git config --global commit.gpgsign true    # 默认对所有提交签名

# 签名提交
git commit -S -m "signed commit"

# 签名标签
git tag -s v1.0 -m "signed release"

# 验证提交签名
git log --show-signature

# 验证标签签名
git tag -v v1.0
```

---

## 23. 高级配置技巧

```bash
# 自动纠正拼写错误的命令（如 git stauts → git status）
git config --global help.autocorrect 10   # 1 秒后自动执行

# 启用 rerere（记住冲突解决方式，下次自动应用）
git config --global rerere.enabled true

# diff 时使用更好的算法（对函数移动更友好）
git config --global diff.algorithm histogram

# 全局忽略文件权限变更（在 macOS/Windows 上避免无意义的 diff）
git config --global core.fileMode false

# 设置 pull 默认使用 rebase（保持线性历史）
git config --global pull.rebase true

# 推送时自动设置上游分支
git config --global push.autoSetupRemote true

# 多行 commit message 使用 heredoc
git commit -m "$(cat <<'EOF'
feat: add user authentication

- Add JWT token generation
- Add login/logout endpoints
- Add middleware for protected routes
EOF
)"
```

---

## 24. 速查表

| 想做什么 | 命令 |
|---------|------|
| 查看状态 | `git status` |
| 添加所有修改 | `git add -A` |
| 提交 | `git commit -m "msg"` |
| 拉取 + 变基 | `git pull --rebase` |
| 推送 | `git push` |
| 新建分支并切换 | `git switch -c feat/xxx` |
| 合并分支 | `git merge --no-ff feat/xxx` |
| 暂存工作区 | `git stash -u` |
| 恢复暂存 | `git stash pop` |
| 查看简洁日志 | `git log --oneline --graph` |
| 撤销最近提交 | `git reset --soft HEAD~1` |
| 安全回退已推送的提交 | `git revert <hash>` |
| 找回误删内容 | `git reflog` |
| 查看某行代码作者 | `git blame <file>` |
| 二分法查 bug | `git bisect start` |
| 只拿某个提交 | `git cherry-pick <hash>` |
| 导出代码压缩包 | `git archive HEAD -o out.zip` |
