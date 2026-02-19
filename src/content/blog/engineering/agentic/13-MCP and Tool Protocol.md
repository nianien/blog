---
title: "MCP and Tool Protocol: Agent 工具的协议化未来"
pubDate: "2026-01-27"
description: "当前 Agent 工具集成面临 N×M 问题：每个框架、每个应用都在重复造轮子。MCP（Model Context Protocol）正在尝试成为 Agent 工具世界的 HTTP——一个标准化的通信协议。本文深入剖析 MCP 的架构设计、通信机制与安全模型，探讨工具协议化的趋势、trade-off 与未来走向。"
tags: ["Agentic", "AI Engineering", "MCP", "Protocol"]
---

# MCP and Tool Protocol: Agent 工具的协议化未来

> 每一次技术生态的成熟，都伴随着协议的诞生。Web 有 HTTP，邮件有 SMTP，实时通信有 WebSocket。当 Agent 从实验走向生产，工具调用也必然需要自己的协议层。
>
> 本文是 Agentic 系列第 13 篇。我们将从当前工具集成的痛点出发，深入分析 MCP（Model Context Protocol）的设计哲学与技术细节，探讨工具协议化对 Agent 生态的深远影响。

---

## 1. 开篇：重复造轮子的困境

假设你正在构建一个 Agent，需要它能够：查询 Jira 工单、读取 GitHub PR、搜索 Confluence 文档、发送 Slack 消息。

如果你用 LangChain，你需要找到或编写四个 LangChain Tool wrapper。如果明天切换到 LlamaIndex，这四个 wrapper 全部作废。如果后天决定用 OpenAI Assistants API，又得按 Function Calling 的 schema 再来一遍。**同样的能力，被实现了三遍。**

这个问题并不新鲜。Web 技术演进史上，我们见过完全相同的模式：

```
早期 Web：每个 CGI 脚本都有自己的通信方式
  → HTTP 统一了通信 → REST 统一了风格 → OpenAPI 统一了描述

Agent 工具（当前）：每个框架都有自己的工具定义格式
  → ??? 统一工具通信 → ??? 统一工具描述 → ??? 统一工具发现
```

从 CGI 到 HTTP，Web 用了十年。Agent 工具生态能更快吗？MCP 正在尝试回答这个问题。

---

## 2. 工具集成的现状与问题

### 2.1 五大痛点

**硬编码模式**：工具在代码中写死，新增工具需要改代码、重新部署。**框架绑定**：LangChain Tool、OpenAI Function、Anthropic Tool 各有格式，互不兼容——工具提供者要么选边站，要么维护三份代码。**缺乏发现机制**：Agent 不知道有哪些工具可用。**缺乏权限控制**：Agent 可以调用任何已注册的工具。**缺乏版本管理**：工具升级可能静默破坏 Agent 行为。

### 2.2 N x M 集成问题

这些痛点的根源，是经典的 **N x M 集成问题**：

```
当前：N 个框架 × M 个工具 = N×M 个适配器

  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │LangChain │   │LlamaIndex│   │  OpenAI  │
  └──┬─┬─┬───┘   └──┬─┬─┬───┘   └──┬─┬─┬───┘
     │ │ │          │ │ │          │ │ │
     ▼ ▼ ▼          ▼ ▼ ▼          ▼ ▼ ▼       ← 15 个适配器
  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
  │ Jira │ │GitHub│ │Slack │ │  DB  │ │Search│
  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘

期望：通过协议层解耦，N + M

  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │LangChain │   │LlamaIndex│   │  OpenAI  │
  └────┬─────┘   └────┬─────┘   └────┬─────┘
       ▼               ▼               ▼
  ┌──────────────────────────────────────────┐
  │           标准化协议层（MCP）              │
  └──┬───────┬───────┬───────┬───────┬───────┘
     ▼       ▼       ▼       ▼       ▼         ← 8 个实现
  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
  │ Jira │ │GitHub│ │Slack │ │  DB  │ │Search│
  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘
```

**将 N x M 降为 N + M**——这正是 MCP 试图解决的核心问题。

---

## 3. MCP 深入分析

### 3.1 什么是 MCP

MCP（Model Context Protocol）是 Anthropic 于 2024 年末提出的开放协议，定义了 AI 应用与外部工具/数据源之间的标准化通信方式。不绑定任何特定 LLM 或框架。

类比：**USB-C 之于硬件外设，正如 MCP 之于 Agent 工具。** 没有 USB-C 时，每个设备一种接口；有了 USB-C，一个接口连接一切。MCP 的目标是同样的——一个协议连接所有工具。

### 3.2 核心架构：Host → Client → Server

```
┌─────────────────────────────────────────────────────┐
│  Host (Claude Desktop / IDE / 自定义 Agent)           │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │              MCP Client                        │  │
│  └───┬──────────────┬──────────────┬──────────────┘  │
└──────┼──────────────┼──────────────┼─────────────────┘
       │              │              │
       ▼              ▼              ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│ MCP Server │ │ MCP Server │ │ MCP Server │
│  (GitHub)  │ │  (Slack)   │ │ (Database) │
│ Tools:     │ │ Tools:     │ │ Tools:     │
│ -search    │ │ -send_msg  │ │ -query     │
│ -create_pr │ │ -list_ch   │ │ -insert    │
└────────────┘ └────────────┘ └────────────┘
```

- **Host**：最终用户面对的应用，创建和管理 MCP Client 实例。
- **Client**：协议客户端，与 Server 保持一对一连接，负责能力协商与请求路由。
- **Server**：工具/数据提供者，暴露 Tools、Resources 和 Prompts。轻量级，不需了解 LLM。

### 3.3 三大原语

MCP 定义了三种核心原语，覆盖 Agent 与外部世界交互的主要模式：

```
┌────────────┬──────────────┬──────────────────────────────┐
│   原语      │  控制权归属    │  语义                        │
├────────────┼──────────────┼──────────────────────────────┤
│  Tools     │  Model 控制   │  可执行操作，LLM 自主决定调用  │
│  Resources │  App 控制     │  可读数据源，Host 决定读取     │
│  Prompts   │  User 控制    │  交互模板，用户显式选择        │
└────────────┴──────────────┴──────────────────────────────┘
```

这种**分层控制**是 MCP 设计中最精妙的部分——避免"一切交给 LLM"的风险，保留人类最终控制权。Tools 是 Agent 的"手"，Resources 是"眼"，Prompts 是"工作手册"。

---

## 4. 通信机制

### 4.1 传输层

**stdio**：本地进程间通信。零网络开销、简单可靠，但仅限同一台机器。
**HTTP + SSE**：远程服务通信。Client 通过 HTTP POST 发请求，Server 通过 SSE 推响应。2025 年的 Streamable HTTP 更新进一步统一了远程传输层。

### 4.2 消息格式：JSON-RPC 2.0

MCP 使用成熟的 JSON-RPC 2.0（2010 年发布，大量现成实现）：

```json
// 请求
{"jsonrpc": "2.0", "id": 1, "method": "tools/call",
 "params": {"name": "query_db", "arguments": {"sql": "SELECT * FROM users"}}}

// 响应
{"jsonrpc": "2.0", "id": 1,
 "result": {"content": [{"type": "text", "text": "Found 42 users..."}]}}
```

### 4.3 生命周期

```
Client                                       Server
  │  ① initialize (clientInfo, capabilities)    │
  │ ───────────────────────────────────────────▶│
  │  ② response (serverInfo, capabilities)      │
  │◀─────────────────────────────────────────── │
  │  ③ notifications/initialized                │
  │ ───────────────────────────────────────────▶│
  │  ④ Normal: tools/list, tools/call ...       │
  │◀───────────────────────────────────────────▶│
  │  ⑤ Shutdown                                 │
```

初始化阶段的**能力协商**是关键设计——Client 和 Server 各自声明支持的能力，只使用交集。这使得旧 Client 可以连新 Server，只是无法使用新功能。

### 4.4 一次完整的工具调用

关键设计：**LLM 不直接与 MCP Server 通信**。LLM 只表达"我想调用某工具"，Host 运行时执行实际 MCP 调用。这层间接性让 Host 可以在调用前进行权限检查、参数验证、用户确认。

```
User → Host: "查询活跃用户"
Host → LLM:  消息 + 可用工具列表
LLM  → Host: tool_use: query_db(sql="...")
Host → MCP Client → MCP Server: tools/call
MCP Server → MCP Client → Host: 结果
Host → LLM:  工具结果 + 继续对话
LLM  → Host: "共 42 个活跃用户"
Host → User: 最终回答
```

---

## 5. 实现一个 MCP Server

使用官方 `mcp` Python SDK 实现一个项目管理工具 Server：

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, Resource
import json, asyncio

server = Server("project-manager")
TASKS = {
    "TASK-001": {"title": "实现用户认证", "status": "done", "assignee": "alice"},
    "TASK-002": {"title": "设计 DB schema", "status": "in_progress", "assignee": "bob"},
    "TASK-003": {"title": "编写 API 文档", "status": "todo", "assignee": "alice"},
}

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(name="list_tasks",
             description="列出项目任务，可按状态和负责人筛选",
             inputSchema={"type": "object", "properties": {
                 "status": {"type": "string", "enum": ["todo", "in_progress", "done"]},
                 "assignee": {"type": "string"},
             }}),
        Tool(name="update_task_status",
             description="更新任务状态",
             inputSchema={"type": "object", "properties": {
                 "task_id": {"type": "string"},
                 "new_status": {"type": "string", "enum": ["todo", "in_progress", "done"]},
             }, "required": ["task_id", "new_status"]}),
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "list_tasks":
        results = {tid: t for tid, t in TASKS.items()
                   if (not arguments.get("status") or t["status"] == arguments["status"])
                   and (not arguments.get("assignee") or t["assignee"] == arguments["assignee"])}
        return [TextContent(type="text", text=json.dumps(results, ensure_ascii=False, indent=2))]
    elif name == "update_task_status":
        tid, ns = arguments["task_id"], arguments["new_status"]
        if tid not in TASKS:
            return [TextContent(type="text", text=f"任务 {tid} 不存在")]
        old = TASKS[tid]["status"]
        TASKS[tid]["status"] = ns
        return [TextContent(type="text", text=f"已将 {tid} 从 {old} 更新为 {ns}")]
    return [TextContent(type="text", text=f"未知工具: {name}")]

@server.list_resources()
async def list_resources() -> list[Resource]:
    return [Resource(uri="project://tasks/summary", name="项目任务总览",
                     description="任务统计摘要", mimeType="application/json")]

@server.read_resource()
async def read_resource(uri: str) -> str:
    if str(uri) == "project://tasks/summary":
        summary = {"total": len(TASKS), "by_status": {}, "by_assignee": {}}
        for t in TASKS.values():
            summary["by_status"][t["status"]] = summary["by_status"].get(t["status"], 0) + 1
            summary["by_assignee"][t["assignee"]] = summary["by_assignee"].get(t["assignee"], 0) + 1
        return json.dumps(summary, ensure_ascii=False, indent=2)
    raise ValueError(f"未知资源: {uri}")

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
```

核心模式：**声明式工具注册**（`list_tools` 返回名称、描述、JSON Schema）→ **请求路由**（`call_tool` 根据工具名分发）→ **资源暴露**（URI 标识的可读数据源）→ **传输透明**（同一份代码可跑 stdio 或 HTTP）。

Host 通过配置文件声明连接：

```json
{
    "mcpServers": {
        "project-manager": {
            "command": "python",
            "args": ["path/to/server.py"]
        },
        "github": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "env": {"GITHUB_TOKEN": "ghp_xxxx"}
        }
    }
}
```

### 5.1 实现一个 MCP Client

上面实现了 Server 端。现在看另一半——Client 如何连接 Server、发现工具、并与 LLM Agent 循环集成。

以下代码展示一个完整的 MCP Client，它连接 Server、获取工具列表、将工具转换为 LLM Function Calling 格式、并在 Agent 循环中路由 LLM 的 `tool_use` 请求回 MCP：

```python
from mcp import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters
import json, asyncio

class MCPAgentClient:
    """MCP Client：连接 Server，桥接 LLM Function Calling"""

    def __init__(self, server_command: str, server_args: list[str]):
        self.server_params = StdioServerParameters(
            command=server_command, args=server_args
        )
        self.session: ClientSession | None = None
        self._tools_cache: list[dict] = []

    async def connect(self, read_stream, write_stream):
        """建立连接并完成初始化握手"""
        self.session = ClientSession(read_stream, write_stream)
        await self.session.initialize()
        # 初始化后立即拉取工具列表
        await self.refresh_tools()

    async def refresh_tools(self):
        """从 Server 获取最新工具列表"""
        result = await self.session.list_tools()
        self._tools_cache = [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.inputSchema
            }
            for tool in result.tools
        ]

    def get_tools_for_llm(self) -> list[dict]:
        """将 MCP 工具转换为 LLM Function Calling 格式

        关键桥接：MCP 工具描述 → LLM 能理解的 function schema
        不同 LLM 的格式略有差异，这里以常见格式为例。
        """
        return [
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool["description"],
                    "parameters": tool["input_schema"]
                }
            }
            for tool in self._tools_cache
        ]

    async def route_tool_call(self, tool_name: str, arguments: dict) -> str:
        """将 LLM 的 tool_use 请求路由到 MCP Server"""
        result = await self.session.call_tool(tool_name, arguments)
        # 提取文本内容返回给 LLM
        return "\n".join(
            block.text for block in result.content
            if hasattr(block, "text")
        )


async def agent_loop(llm_client, mcp_client: MCPAgentClient):
    """Agent 主循环：LLM 决策 → MCP 执行 → 结果反馈"""
    tools = mcp_client.get_tools_for_llm()
    messages = [{"role": "user", "content": "帮我看看 alice 有哪些进行中的任务"}]

    while True:
        response = await llm_client.chat(messages=messages, tools=tools)

        # LLM 没有调用工具，对话结束
        if not response.tool_calls:
            print(f"Agent: {response.content}")
            break

        # LLM 请求调用工具 → 路由到 MCP Server
        for call in response.tool_calls:
            tool_result = await mcp_client.route_tool_call(
                call.function.name,
                json.loads(call.function.arguments)
            )
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": tool_result
            })


async def main():
    client = MCPAgentClient("python", ["server.py"])
    async with stdio_client(client.server_params) as (read, write):
        await client.connect(read, write)
        print(f"已连接，发现 {len(client._tools_cache)} 个工具：")
        for t in client._tools_cache:
            print(f"  - {t['name']}: {t['description']}")
        # await agent_loop(llm_client, client)

if __name__ == "__main__":
    asyncio.run(main())
```

核心模式总结：**连接与握手**（`initialize` 完成能力协商）→ **工具发现**（`list_tools` 获取 Server 暴露的所有工具）→ **格式转换**（MCP Tool schema → LLM Function Calling schema，这是 Client 的关键职责）→ **请求路由**（LLM 输出 `tool_use` → Client 调用 `call_tool` → 结果回填到对话上下文）。

注意 Client 在架构中的定位：它是 **LLM 世界与 MCP 世界之间的翻译层**。LLM 不知道 MCP 的存在，MCP Server 不知道 LLM 的存在。Client 把两边连接起来，同时也是插入权限检查、参数验证、超时控制等逻辑的最佳位置。

---

## 6. 工具发现与动态注册

**静态发现**：配置文件声明所有 Server，Host 启动时初始化。简单可靠，但新增 Server 需重启。

**动态发现**：MCP 支持 `notifications/tools/list_changed` 通知——Server 可在运行时告知 Client 工具列表变更，无需重启连接。

更大的愿景是**工具注册中心（Tool Registry）**——Agent 在运行时查询"有哪些 MCP Server 可用"，按需连接。本质上是 Agent 版的 Service Discovery。

与传统 Service Discovery 的核心区别：传统消费者是确定性代码（知道要调哪个 API），MCP 消费者是 LLM（根据自然语言意图选工具）。因此工具描述的**语义质量**至关重要——模糊的 description 会导致 LLM 误选工具。

---

## 7. 安全与权限控制

### 7.1 威胁模型

Agent 工具调用面临五类威胁：**Prompt Injection**（诱导调用不该调用的工具）、**权限越权**（只读 Agent 执行写入）、**数据泄露**（敏感数据通过 LLM 响应外泄）、**恶意 Server**（第三方 Server 返回恶意内容）、**参数篡改**（被诱导传入 SQL 注入等恶意参数）。

### 7.2 防护策略

**工具级 ACL**：在 Host 层实现访问控制——白名单/黑名单决定哪些 Agent 可调用哪些工具。

**参数级约束**：即使允许调用，也限制参数范围（如 SQL 工具只允许 SELECT、禁止 DROP/DELETE）。

**Human-in-the-Loop**：高风险操作（写入、删除、发送消息）要求用户显式确认后再执行。

**审计日志**：记录所有工具调用的时间戳、Agent ID、工具名、参数、结果、耗时、状态。

```python
# 工具级 ACL 示例
async def guarded_tool_call(agent_id: str, tool_name: str, arguments: dict):
    perms = TOOL_PERMISSIONS[agent_id]
    if tool_name in perms["denied"]:
        raise PermissionError(f"{agent_id} cannot call {tool_name}")
    # 参数验证
    validate_arguments(tool_name, arguments)
    # 高风险确认
    if tool_name in HIGH_RISK_TOOLS:
        if not await prompt_user(f"允许调用 {tool_name}? [y/n]"):
            return {"error": "用户拒绝"}
    return await mcp_client.call_tool(tool_name, arguments)
```

### 7.3 Sandbox 执行

MCP 的 stdio 模式天然提供进程级隔离。更严格的方案：容器隔离（Docker）→ VM 隔离（Firecracker）→ WASM 沙箱。执行不可信代码的 Server，容器隔离是最低要求。

### 7.4 错误处理与容错

MCP Server 的错误最终会进入 LLM 的上下文窗口。这意味着错误信息的设计有双重读者——**人类开发者**需要 debug 信息，**LLM** 需要可理解、可行动的恢复指引。

**错误传播设计原则**：

```
❌ 糟糕的错误：  "Internal Server Error"
   → LLM 无法理解原因，只能对用户说 "出了点问题"

❌ 过于技术化：  "psycopg2.OperationalError: connection refused on port 5432"
   → LLM 不知道该重试还是放弃

✅ 面向 LLM 的错误：  "数据库连接暂时不可用。这是临时性故障，建议等待 30 秒后重试。
   如果多次重试仍失败，请告知用户数据库服务可能在维护中。"
```

核心思路：错误信息中要包含**原因分类**（临时故障/参数错误/权限不足）、**建议动作**（重试/换参数/告知用户），以及**足够的上下文**让 LLM 能生成有意义的回复。

**Timeout 与 Retry 策略**：MCP 工具调用需要明确的超时边界。没有 timeout 的工具调用可能永远挂起，阻塞整个 Agent 循环。Retry 应使用 exponential backoff，且只对临时性故障重试（网络超时、服务暂时不可用），对确定性错误（参数无效、权限不足）不应重试。

**Circuit Breaker 模式**：对于不可靠的外部 Server，连续失败应触发熔断，避免浪费 LLM tokens 反复尝试一个已知不可用的服务。

以下是一个整合 timeout、retry 和 circuit breaker 的 MCP Client 容错封装：

```python
import asyncio
import time
from dataclasses import dataclass, field
from mcp import ClientSession

@dataclass
class CircuitBreaker:
    """简单的 Circuit Breaker：连续失败超过阈值则熔断"""
    failure_threshold: int = 5
    recovery_timeout: float = 60.0  # 熔断恢复等待时间（秒）
    _failure_count: int = field(default=0, init=False)
    _last_failure_time: float = field(default=0.0, init=False)
    _state: str = field(default="closed", init=False)  # closed / open / half_open

    def record_success(self):
        self._failure_count = 0
        self._state = "closed"

    def record_failure(self):
        self._failure_count += 1
        self._last_failure_time = time.time()
        if self._failure_count >= self.failure_threshold:
            self._state = "open"

    def allow_request(self) -> bool:
        if self._state == "closed":
            return True
        if self._state == "open":
            if time.time() - self._last_failure_time > self.recovery_timeout:
                self._state = "half_open"
                return True  # 允许试探性请求
            return False
        return True  # half_open: 允许一次试探

class ResilientMCPClient:
    """带容错能力的 MCP Client 封装"""

    def __init__(self, session: ClientSession, timeout: float = 30.0,
                 max_retries: int = 3, base_delay: float = 1.0):
        self.session = session
        self.timeout = timeout
        self.max_retries = max_retries
        self.base_delay = base_delay
        self._breakers: dict[str, CircuitBreaker] = {}

    def _get_breaker(self, tool_name: str) -> CircuitBreaker:
        if tool_name not in self._breakers:
            self._breakers[tool_name] = CircuitBreaker()
        return self._breakers[tool_name]

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        breaker = self._get_breaker(tool_name)

        if not breaker.allow_request():
            return {
                "error": f"工具 {tool_name} 当前不可用（连续失败已触发熔断）。"
                         f"请告知用户该服务暂时不可用，大约 {breaker.recovery_timeout} 秒后可重试。"
            }

        last_error = None
        for attempt in range(self.max_retries):
            try:
                result = await asyncio.wait_for(
                    self.session.call_tool(tool_name, arguments),
                    timeout=self.timeout
                )
                breaker.record_success()
                return {"content": result.content}

            except asyncio.TimeoutError:
                last_error = f"工具 {tool_name} 调用超时（>{self.timeout}s）"
                breaker.record_failure()
            except Exception as e:
                if _is_permanent_error(e):
                    # 参数错误、权限不足等确定性失败，不重试
                    return {"error": f"工具调用失败：{e}。请检查参数后重新尝试。"}
                last_error = str(e)
                breaker.record_failure()

            if attempt < self.max_retries - 1:
                delay = self.base_delay * (2 ** attempt)  # exponential backoff
                await asyncio.sleep(delay)

        return {"error": f"工具 {tool_name} 在 {self.max_retries} 次重试后仍然失败：{last_error}。"
                         f"这可能是临时性故障，建议稍后重试或告知用户。"}

def _is_permanent_error(e: Exception) -> bool:
    """判断是否为确定性错误（不应重试）"""
    permanent_types = (ValueError, PermissionError, KeyError)
    return isinstance(e, permanent_types)
```

这个封装的设计思路：**timeout 防挂起**（每次调用有明确的时间上限）→ **retry 抗抖动**（临时性故障用 exponential backoff 重试）→ **circuit breaker 防雪崩**（连续失败后快速失败，避免反复调用一个已知坏掉的服务）→ **LLM 友好的错误信息**（每个错误路径都返回 LLM 可理解的文本描述）。

---

## 8. MCP 之外的协议探索

**OpenAI Function Calling**：定义了工具描述格式，但更多是 API 特性而非通信协议——没有定义工具发现、连接管理、生命周期。MCP 是完整的端到端协议。

**Google Genkit**：跨语言 Agent 开发框架。注意区分：**框架绑定实现**（你的代码运行在框架中），**协议解耦实现**（你的代码遵循协议通信，实现自由选择）。

**Agent Protocol（by e2b）**：标准化 Agent 本身的通信接口，与 MCP（Agent 与工具的通信）互补。

**OpenAPI / AsyncAPI**：可用于工具描述，但缺少面向 LLM 优化的语义——工具描述需要让模型"理解"何时该用，而非只让人类开发者读懂。

趋势清晰：**工具协议化正在发生**。MCP 目前的优势在于开放协议、社区快速增长、设计简洁实用。

### 8.1 协议对比矩阵

以下从六个维度横向对比当前主要的工具/Agent 协议方案：

| 维度 | MCP | OpenAI Function Calling | Google Genkit | Agent Protocol (e2b) | OpenAPI |
|------|-----|------------------------|---------------|---------------------|---------|
| **工具发现** | 动态发现，`tools/list` + `list_changed` 通知 | 无，工具需在请求中硬编码传入 | 框架内注册，支持反射式发现 | 无工具发现，聚焦 Agent 任务管理 | 静态，通过 spec 文件描述 |
| **通信方式** | JSON-RPC 2.0 over stdio / HTTP+SSE | HTTP API（嵌入 Chat Completion 请求） | 框架内函数调用（Go/JS） | REST API（HTTP） | REST / HTTP |
| **安全模型** | Host 层 ACL + 参数约束 + Human-in-the-Loop | API Key 级别，无工具粒度控制 | 框架内中间件 | API Token 认证 | OAuth / API Key |
| **多语言支持** | Python, TypeScript, Java, Kotlin 等 SDK | 任何能发 HTTP 的语言 | Go, JavaScript/TypeScript | 任何能发 HTTP 的语言 | 语言无关（spec 是 YAML/JSON） |
| **生态成熟度** | 快速增长，1000+ 社区 Server | 最大用户基数，但非独立协议 | 较新，Google 生态内使用 | 小众，e2b 社区为主 | 极成熟，但非 AI 原生 |
| **适用场景** | Agent ↔ 工具的标准化通信 | 单一 LLM 的工具调用 | Google 生态内的全栈 AI 应用 | Agent 间的任务编排与通信 | 传统 API 描述与集成 |

几个关键观察：

**MCP 是唯一面向 Agent 工具设计的完整协议**。Function Calling 只解决了"LLM 怎么表达想调用工具"，但没有解决"工具怎么被发现、怎么连接、怎么管理生命周期"。MCP 覆盖了从发现到调用到关闭的完整链路。

**OpenAPI 有潜力但缺 AI 语义**。OpenAPI spec 描述了 API 的结构，但缺少面向 LLM 优化的语义层——什么时候该用这个 API？参数的哪些组合是有意义的？错误时该怎么恢复？这些信息在 OpenAPI spec 中要么缺失，要么只面向人类开发者。已有项目尝试将 OpenAPI spec 自动转换为 MCP Server，桥接两个生态。

**Agent Protocol 与 MCP 是互补关系**。MCP 标准化 Agent 与工具的通信，Agent Protocol 标准化 Agent 与 Agent（或 Agent 与编排器）的通信。未来的 Multi-Agent 系统可能同时需要两者。

---

## 9. Trade-off 分析

### 9.1 标准化 vs 灵活性

标准化收益显而易见（生态共享、减少重复、互操作），代价是表达力受限和演进惯性。关键判断：**MCP 的抽象层次选得好**。它定义通信方式但不限制工具实现——类似 HTTP 定义请求-响应模式但不限制 body 内容。

### 9.2 额外复杂度

没有 MCP 时工具就是函数调用。有了 MCP 需要进程管理、连接维护、序列化。决策框架：

```
工具少（< 5）且团队单一   → 直接硬编码
工具多（> 10）且跨团队    → MCP 收益显现
工具需被多 Agent 共享     → MCP 几乎必需
工具需独立部署和升级      → MCP 最佳选择
```

### 9.3 生态依赖

MCP 由 Anthropic 主导——缓解策略：MIT 开源可 fork、Server 是独立进程（最坏只需换 Client）、核心业务逻辑应与协议层分离。**投入合理，但要做好隔离。**

### 9.4 性能

stdio 通信 0.1-1ms，HTTP 通信 1-50ms，连接初始化 100ms-2s。相比 LLM 推理耗时（100ms-10s），**MCP 性能开销可忽略**。

---

## 10. 实践建议

### 10.1 工具描述的最佳实践

这是最影响效果的环节。工具描述不是给人类读的 API 文档——它是 LLM 的决策依据。描述质量直接决定 Agent 选对工具的概率。

**反面示例**：

```python
Tool(
    name="search",
    description="Search for things",
    inputSchema={"type": "object", "properties": {
        "q": {"type": "string"},
    }}
)
```

问题：`search` 搜什么？"things" 是什么？参数 `q` 代表什么？LLM 无法准确判断何时应该调用这个工具。

**正面示例**：

```python
Tool(
    name="search_jira_issues",
    description=(
        "在 Jira 中搜索 issue。适用场景：用户想查找 bug、需求、任务等工单。"
        "支持 JQL 语法。不适用于搜索 Confluence 文档或代码仓库。"
        "返回匹配的 issue 列表，包含 key、标题、状态、负责人。"
        "最多返回 50 条结果。"
    ),
    inputSchema={"type": "object", "properties": {
        "jql": {
            "type": "string",
            "description": "Jira Query Language 查询语句，例如: 'project = BACKEND AND status = Open'"
        },
        "max_results": {
            "type": "integer",
            "description": "最大返回条数，默认 20，最大 50",
            "default": 20
        },
    }, "required": ["jql"]}
)
```

关键原则：**名称具体**（`search_jira_issues` 而非 `search`）、**描述含边界**（说清楚能做什么和不能做什么）、**参数有示例**（LLM 看到 JQL 示例才知道该用什么语法）、**返回值说明**（LLM 知道能拿到什么，才能决定要不要调用）。

### 10.2 Server 粒度设计

**保持 Server 单一职责**：`github-server`、`database-server`、`slack-server` 而非 `all-tools-server`——独立升级、细粒度权限、缩小故障面。

但"单一职责"的粒度怎么把握？以下是决策框架：

```
何时拆分 Server：
  - 工具属于不同领域（GitHub vs Slack）         → 拆
  - 工具需要不同权限凭证                        → 拆
  - 工具有不同的故障域（一个挂了不该影响另一个）  → 拆
  - 工具需要独立的部署和升级周期                 → 拆

何时合并 Server：
  - 工具间共享状态（同一数据库连接）             → 合
  - 工具总是一起使用（read_file + write_file）   → 合
  - 工具数量少（< 3）且属于同一上下文            → 合
```

实际案例——一个数据分析场景：

```
❌ 过细：query-server, chart-server, export-server  （3 个进程管理成本高，且紧耦合）
❌ 过粗：analytics-server（含 20 个工具，LLM 选择困难）
✅ 合适：data-query-server（查询+聚合）, visualization-server（图表+导出）
```

### 10.3 测试策略

MCP Server 本质是一个暴露工具的进程，需要三层测试覆盖：

**单元测试**：测试工具的核心逻辑，不涉及 MCP 协议。

```python
import pytest

# 直接测试业务逻辑函数，不通过 MCP 协议
async def test_list_tasks_filter_by_status():
    result = filter_tasks(TASKS, status="in_progress")
    assert len(result) == 1
    assert "TASK-002" in result

async def test_update_task_nonexistent():
    with pytest.raises(TaskNotFoundError):
        update_task_status("TASK-999", "done")
```

**集成测试**：通过 MCP Client 连接 Server，测试完整的协议交互。

```python
from mcp import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters

async def test_mcp_tool_call():
    """通过 MCP 协议发起完整的工具调用"""
    params = StdioServerParameters(command="python", args=["server.py"])
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # 验证工具列表
            tools = await session.list_tools()
            tool_names = [t.name for t in tools.tools]
            assert "list_tasks" in tool_names

            # 验证工具调用
            result = await session.call_tool("list_tasks", {"status": "todo"})
            assert "TASK-003" in result.content[0].text
```

**LLM 端到端测试**：验证 LLM 在给定上下文中能正确选择和使用工具。这类测试成本高、有非确定性，但对关键流程不可或缺。

```python
async def test_llm_selects_correct_tool():
    """验证 LLM 面对用户意图时选择正确的工具"""
    tools = await get_tool_definitions()  # 从 MCP Server 获取
    response = await llm.chat(
        messages=[{"role": "user", "content": "帮我看看 alice 有哪些待做的任务"}],
        tools=tools
    )
    # 断言 LLM 选择了 list_tasks 而非 update_task_status
    assert response.tool_calls[0].name == "list_tasks"
    assert response.tool_calls[0].arguments["assignee"] == "alice"
    assert response.tool_calls[0].arguments["status"] == "todo"
```

**做好错误处理**：MCP Server 的错误会进入 LLM 上下文。清晰的错误信息（"任务 TASK-999 不存在，请用 list_tasks 查看可用任务"）能帮助 LLM 自我纠正。详见 7.4 节的错误处理设计。

---

## 11. 进一步思考

MCP 正在快速演进，几个未解问题值得关注：

**工具组合**：工具 A 输出作为工具 B 输入时，由 LLM 串联（灵活但低效）还是协议层支持工具链（高效但复杂）？

**有状态交互**：当前每次调用独立。但数据库事务、多步操作需要跨调用的状态。如何在协议层表达？

**工具质量评估**：Agent 如何判断 MCP Server 的描述是否准确、响应是否可靠？需要"工具信誉系统"。

**多模态工具**：MCP 已支持 `ImageContent`，但多模态生态仍在早期。

长远来看，工具协议化的终局可能是一个**去中心化的 Agent 工具市场**——发布 MCP Server 如同发布 npm 包，Agent 在运行时动态发现、评估、连接、使用工具。协议保证互操作性，市场机制保证质量。

---

## 12. 总结

1. **当前工具集成不可持续**。标准化协议将 N x M 降为 N + M。
2. **MCP 设计务实**。三大原语覆盖主要交互模式，JSON-RPC 2.0 成熟可靠，双传输层适配不同场景。
3. **安全不是事后补丁**。ACL、参数约束、Human-in-the-Loop、审计日志需在架构设计阶段考虑。
4. **协议化成本可控**。性能可忽略，规模增长时收益迅速超过成本。
5. **保持务实的乐观**。MCP 目前最有前途，但要做好业务逻辑与协议层的解耦。

工具协议化是 Agent 生态从"手工作坊"走向"工业化"的关键一步。

> **系列导航**：本文是 Agentic 系列的第 13 篇。
>
> - 上一篇：[12 | LangChain vs LangGraph](/blog/engineering/agentic/12-LangChain%20vs%20LangGraph)
> - 下一篇：[14 | Production-Grade Agent Systems](/blog/engineering/agentic/14-Production-Grade%20Agent%20Systems)
> - 完整目录：[01 | From LLM to Agent](/blog/engineering/agentic/01-From%20LLM%20to%20Agent)
