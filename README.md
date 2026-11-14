# dsh-sync（加入自建 Gitea / Forgejo 的自动 PR）

[DeepSeek Harness](https://github.com/deepseek-ai) 的多机同步插件，本仓库是
[`weibaohui/dsh-sync`](https://github.com/weibaohui/dsh-sync) 的 **fork**：
在上游 0.4.11 的基础上，把「分支 → PR → 合并」从 GitCode 专属扩展到了**自建 Gitea / Forgejo**。

> 包名沿用 `@weibaohui/dsh-sync`（方便直接替换上游依赖），代码与版本号以本仓库为准。

## 为什么需要这个 fork

上游的 PR 三件套只实现了一份：`parseRepoUrl()` 只认 `gitcode.com`，`createPullRequest` /
`getPullRequest` / `mergePullRequest` 全部固定走 `api.gitcode.com/api/v5`。任何非 gitcode
域名都会被判成「自建/未知主机」，走「只推分支」降级路径（`prSkipped`）——分支会越堆越多，
`main` 永远不前进，多机同步实际上不成立。

## 与上游的差异

| 能力 | 说明 |
|---|---|
| 托管方探测 | 请求 `<origin>/api/v1/version`，返回 `{"version":…}` 即认定 Gitea/Forgejo；按 origin 缓存，失败只缓存 60 秒（避免网络抖动导致 PR 永久降级） |
| PR 创建 / 查询 / 合并 | `POST /repos/{o}/{r}/pulls`、`GET …/pulls/{n}`、`POST …/pulls/{n}/merge` + `Do: "squash"` |
| 私仓校验 | 有 API 就能真查 `private` 字段：不再弹「无法校验私有性」的风险确认，公共仓库直接拒绝保存 |
| 空仓库首次接入 | 远端没有 base 分支时 PR 无从创建（Gitea 返回 404）。首个提交直接推成 base 分支，后续同步照常走 PR |
| mergeable 轮询 | Gitea 的 `mergeable` 是异步算的，推送后短轮询 4 拍再判定，避免把「还没算完」误判为冲突 |
| 清理遗留分支 | 改查 `pulls?state=closed` 并筛 `merged`；分支名取 `head.label`（Gitea 在分支删除后会把 `head.ref` 变成 `refs/pull/N/head`） |
| AI 冲突处理 | 门控从「仅 gitcode」改为「有 PR target 即可」，Gitea 上可用 |

GitCode 原有路径未改动；没有 PR API 的远端（SSH-only、裸 git 服务器）仍是「只推分支」。

## 安装

```bash
# 装进指定 profile（web / desktop / 自定义）
dsh plugin --profile web add github:xophiix/dsh-sync#v0.4.12-gitea.1
```

或者直接写进 profile 的 `package.json`：

```json
{
  "dependencies": {
    "@weibaohui/dsh-sync": "github:xophiix/dsh-sync#v0.4.12-gitea.1"
  }
}
```

由于包名没变，`dsh.profile.bundles` 里原有的 `@weibaohui/dsh-sync` 和包内
`cordis.patch.yml` 都不用改。装完重启 DSH 生效。

> 想要独立包名（`@xophiix/dsh-sync`）的话，改 `package.json` 的 `name` 与
> `cordis.patch.yml` 里的 `name`，并同步改 profile 依赖名与 bundle 列表即可。

## 使用（Gitea 侧准备）

1. 在 Gitea 建一个**私有**仓库，例如 `xophiix/dsh-backup`
2. 生成 PAT：头像 → 设置 → 应用 → 管理访问令牌 → 生成令牌，权限勾 `write:repository` 即可
   （建仓库需要 `write:user`，同步用不到）
3. DSH 设置页 → dsh-sync → Git 页签：
   - 仓库地址：`https://gitea.example.com/owner/repo.git`（必须 HTTPS；SSH 远端拿不到 PR）
   - 令牌：粘贴 PAT → 保存
4. 保存时会自动探测该主机是不是 Gitea，并校验仓库为私有

> Gitea 的 git over HTTPS 接受 `oauth2:<token>` 作为用户名密码，插件正是这么做的
> （`GIT_ASKPASS` 注入，token 不进 argv、不落盘）。

## 界面语言

插件设置页跟随「宿主 locale（zh）→ 系统/浏览器语言（zh）→ 英文」的顺序自动选择；
中文系统上默认就是中文，即使宿主 locale 服务在客户端插件里不可用。

需要强制某一语言时，在页面控制台执行后刷新：

```js
localStorage.setItem('dsh-sync:locale', 'zh')   // 或 'en'
localStorage.removeItem('dsh-sync:locale')      // 恢复自动
```

## 多机同步时的注意事项

- **插件清单策略建议用「备份」而不是「并集」**：profile 的 `package.json` 里常有
  `link:` / `file:` 这类机器特定路径，并集推上去后，另一台机器 `pnpm install` 会失败。
- 第一次同步若目标仓库是空的，会走「首个提交直接推 base」，这一次没有 review 环节。
- 合并策略固定 squash；不处理分支保护 / 必需审批。

## 从上游升级

补丁相对上游 0.4.11，见仓库根目录 [`gitea-provider.patch`](./gitea-provider.patch)（12 个 hunk）：

```bash
cd node_modules/@weibaohui/dsh-sync
patch -p1 --dry-run < /path/to/gitea-provider.patch
patch -p1 < /path/to/gitea-provider.patch
```

冲突集中在 `runPush` / `promoteSnapshotToCloud` / `finalizeConflictBranch` /
`prune-branches` / `checkRepoAccess`。

## 测试

```bash
node --test test/gitea-provider.test.mjs          # 6 项离线用例（假 Gitea 服务端）

# 真机端到端：真 git push + 真 PR 合并（需要一个空的私有 scratch 仓库）
GITEA_TOKEN=xxx GITEA_REPO_URL=https://gitea.example.com/owner/scratch.git \
  PLUGIN_ENTRY=./src/index.js node test/e2e-runpush.mjs
```

离线用例覆盖：探测与缓存、私仓校验（私有放行 / 公共拒绝）、PR 三件套的路径与请求体、
GitCode 路径不受影响、SSH 远端保持「只推分支」。

## 上游与许可

- 上游：[weibaohui/dsh-sync](https://github.com/weibaohui/dsh-sync)（MIT）
- 本 fork 仅新增 Gitea/Forgejo 相关逻辑，其余功能、文档、客户端代码均来自上游
- 许可证：[MIT](./LICENSE)，上游版权归 weibaohui，fork 改动归 xophiix
