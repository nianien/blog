---
title: "框架与协议：从SDK选型到MCP"
pubDate: "2026-01-22"
description: "Agent 生态正在走向两极分化——一极是 LangChain/LangGraph 的厚抽象，另一极是 Claude Agent SDK / OpenAI Agents SDK 的薄抽象 + MCP 协议化。本文给出框架选型的八维决策框架、LangGraph 状态机的最小代码、MCP Server/Client 的核心实现，以及 N×M 集成问题的协议化解法。"
tags: ["Agentic", "AI Engineering", "Framework", "MCP"]
series:
  key: "agentic"
  order: 8
author: "skyfalling"
---

Agent 生态在 2025 走向两极分化：一极是 LangChain/LangGraph 这种厚抽象框架——给 Chain、Graph、Memory 等高层概念；另一极是 Claude Agent SDK / OpenAI Agents SDK 这种厂商薄抽象——只给 Agent Loop + Tools，把复杂度让回给模型本身。同时一个更根本的层在浮现：**协议**——MCP 把工具集成的 N×M 降为 N+M，A2A 把 Agent 间协作做了同样的事。框架解决"开发效率"，协议解决"生态互通"——两层共同支撑 Agent 工程从手工作坊走向工业化。

---

## 1. 你需要框架吗

读完前几篇你已具备从零构建 Agent 的能力——Tool Calling 的 JSON Schema 契约、控制循环的状态机、Memory 分层、Planner 模式。这时面临三条路：

- A 自己实现所有组件
- B 用框架快速启动
- C 理解框架后选择性借鉴

大多数成熟团队走 C。但前提是理解框架在做什么。

框架解决的核心问题：

| 价值 | 具体内容 |
|------|---------|
| 减少样板 | 工具注册调度、消息格式管理、LLM API 差异屏蔽、状态序列化 |
| 集成生态 | 70+ LLM、50+ 向量库、100+ 预置工具 |
| 最佳实践 | ReAct、RAG pipeline、记忆管理已编码为默认行为 |
| 快速原型 | 10 行代码跑通工具调用 Agent |

**框架的甜蜜点是 PoC**——5 分钟跑通一个搜索 Agent。生产部署后这些"便利"开始变成负担。

---

## 2. LangChain：生态最大、争议最多

LangChain 围绕四个抽象设计：

![LangChain 架构](/images/blog/agentic/langchain-architecture.svg)

| 抽象 | 本质 | 职责 |
|------|------|------|
| Chain | 链式调用 | 把多步骤串联为顺序管道 |
| Agent | 工具选择 + 循环 | LLM 自主决定调哪个工具，循环到完成 |
| Memory | 对话状态管理 | 滑动窗口、摘要压缩等策略 |
| Retriever | 知识检索 | 从向量库或其他数据源检索文档 |

### 2.1 优点

- **生态最大**：截至 2025 年是 AI Agent 框架领域最大集成生态
- **社区活跃**：StackOverflow 和 GitHub Issues 都能找到答案
- **上手快**：PoC 阶段从零到一只需几小时

### 2.2 生产中暴露的问题

| 问题 | 具体表现 |
|------|---------|
| **过度抽象** | 调 LLM 拿 JSON——OpenAI SDK 3 行直白代码，LangChain 要理解 ChatPromptTemplate、JsonOutputParser、LCEL 管道操作符等多个新概念 |
| **调试困难** | 错误堆栈 20-30 层深，涉及 `RunnableSequence`、`RunnableParallel` 等内部抽象。生产 3AM 报警时这种调试体验是痛苦的 |
| **版本混乱** | API 频繁变更，老代码常常因为依赖升级跑不通 |
| **Chain 思维局限** | Chain 是线性管道，现实 Agent 逻辑往往非线性——分支、循环、并行 |

"版本混乱"具体到时间线上更扎心。截至 2026 年初，LangChain 在两年内的几次关键变更：

| 时间 | 变更 | 升级代价 |
|------|------|--------|
| 2024-01 | 包拆分：`langchain` → `langchain-core` + `langchain-community` + `langchain-openai` | 几乎所有 import 路径要改 |
| 2024-03 | LCEL 成为默认范式，旧 `LLMChain` 弃用 | Chain 的写法整套重学 |
| 2024-08 | `initialize_agent()` 弃用，要求迁移到 `create_*_agent` 工厂 | Agent 创建方式整套换 |
| 2025-02 | LangGraph 与 LangChain 部分能力重合，社区资料一半推 LangGraph 一半推 LCEL Agent | 决策疲劳 |

不是说这些变更没必要——很多是真实演进。但如果你团队的 Agent 项目要长期维护，这些升级代价是真实成本。一个降低这种成本的工程实践：**业务代码不直接 import LangChain，通过自己定义的抽象层间接调用**（见后面的 6.3 节）。第 4 个问题（Chain 思维局限）则导致了 LangGraph 的诞生。

---

## 3. LangGraph：从 Chain 到 Graph

LangGraph 用**有向图**替代**链**作为基础抽象。核心思想：**Agent 的执行流程就是一个状态机**。

| 抽象 | 状态机对应 |
|------|----------|
| State | 共享状态对象（明确声明结构） |
| Node | 状态处理函数 |
| Edge | 状态转移条件 |
| Graph | 整个有限状态机 |

![LangGraph 状态机](/images/blog/agentic/langgraph-state-machine.svg)

### 3.1 LangGraph 的最小代码骨架

```python
# 1. 定义状态结构（强类型）
class AgentState(TypedDict):
    messages: list[Message]
    next_action: str
    tool_results: dict
    iteration: int

# 2. 定义节点——每个节点是一个状态转换函数
def think_node(state: AgentState) -> AgentState:
    """LLM 推理，决定下一步"""
    decision = llm.complete(state["messages"], tools=TOOLS, schema=DECISION_SCHEMA)
    return {
        **state,
        "next_action": decision.action,
        "messages": state["messages"] + [assistant_msg(decision)],
    }

def act_node(state: AgentState) -> AgentState:
    """执行工具"""
    tool_call = state["messages"][-1].tool_calls[0]
    result = invoke_tool(tool_call)
    return {
        **state,
        "messages": state["messages"] + [tool_msg(tool_call.id, result)],
        "tool_results": {**state["tool_results"], tool_call.id: result},
        "iteration": state["iteration"] + 1,
    }

# 3. 定义条件路由
def should_continue(state: AgentState) -> str:
    if state["iteration"] >= MAX_STEPS:
        return "end"
    if state["next_action"] == "call_tool":
        return "act"
    return "end"

# 4. 编译图
graph = StateGraph(AgentState)
graph.add_node("think", think_node)
graph.add_node("act", act_node)
graph.set_entry_point("think")
graph.add_conditional_edges("think", should_continue, {"act": "act", "end": END})
graph.add_edge("act", "think")  # 工具执行完回到 think

app = graph.compile(checkpointer=PostgresSaver(...))
```

这段代码揭示了 LangGraph 与 LangChain 的本质区别：**节点和边在编译时就被静态声明**，运行时只是按 LLM 输出在边上走。整张图的可能路径在编译时就能枚举出来——这就是它"可预测"的来源。

### 3.2 关键设计哲学：确定性 + 非确定性

| 确定性（代码定义） | 非确定性（LLM 决定） |
|------------------|-------------------|
| 有哪些节点 | 每个节点内部的推理 |
| 节点间如何连接 | 工具选择和参数 |
| 条件路由的判断逻辑 | 是否继续循环 |
| 状态的数据结构 | 最终输出内容 |

**图的拓扑是确定性的，但每一步走哪条路径是 LLM 运行时决定的**——编译时就知道所有可能路径，运行时由 LLM 选择实际走的那一条。这是 LangGraph 比 LangChain 强的根本——可预测的系统行为与灵活的智能决策的平衡。

### 3.3 Checkpoint：暂停、恢复、Time-Travel

LangGraph 内置状态检查点，意味着：

- **暂停**：`interrupt_before=["tool_node"]` 在工具执行前暂停，等人类审批
- **恢复**：再次 invoke 同一个 thread_id 从中断点继续
- **Time-Travel**：回滚到任意 checkpoint 重新执行

```python
# 暂停模式：高风险操作前等人审
app = graph.compile(checkpointer=PostgresSaver(...), interrupt_before=["act"])
# 运行到 act 前会暂停，状态持久化
result = app.invoke({...}, config={"configurable": {"thread_id": "abc"}})

# 人审通过后恢复
app.invoke(None, config={"configurable": {"thread_id": "abc"}})

# 回滚到任意历史 state
history = list(app.get_state_history({"configurable": {"thread_id": "abc"}}))
app.invoke(None, config={"configurable": {
    "thread_id": "abc",
    "checkpoint_id": history[3].config["configurable"]["checkpoint_id"],
}})
```

这在 Human-in-the-Loop 场景极其有价值——Agent 在执行敏感操作前暂停，等人类确认。Checkpoint 让"等审批"这件事不需要保持整个进程在内存里挂着，状态可以彻底持久化下来。

### 3.4 何时不该选 LangGraph

- **学习曲线**：要理解状态机、有向图、条件路由。习惯了"调用函数就跑"的开发者需要适应
- **简单任务**：调 LLM → 可能调工具 → 返回结果。用 LangGraph 定义 State/Node/Edge 是大炮打蚊子。原生 Python 一个 while 循环就够

---

## 4. 厂商 SDK：薄抽象的第二极

2025-2026 出现一个结构性变化：**模型厂商自己推出 Agent SDK**。Anthropic Claude Agent SDK、OpenAI Agents SDK、Google ADK、AWS Strands。

不是巧合——**当厂商最了解自家模型的能力边界时，由他们定义 Agent 抽象是自然演进**。

| SDK | 厂商 | 核心理念 |
|-----|------|---------|
| **Claude Agent SDK** | Anthropic | 极简 Agent Loop——Agent + Tool + 循环，原生支持 MCP 和 Extended Thinking |
| **OpenAI Agents SDK** | OpenAI | **Handoff 机制**——Agent 间通过显式交接传递控制权，本质是把 Agent 间转移建模为 Tool Call |
| **Google ADK** | Google | 全栈框架——四语言（Python/TS/Go/Java）、与 GCP 一键部署 |
| **AWS Strands** | AWS | 模型驱动（Model-First）——假设模型足够聪明，框架尽量少干预 |

### 两极对比

| 维度 | 第三方框架（LangChain/CrewAI） | 模型厂商 SDK |
|------|---------------------------|------------|
| 模型绑定 | 多模型抽象层 | 深度优化自家模型 |
| 抽象层次 | 厚——提供 Chain/Graph/角色等高层抽象 | 薄——Agent Loop + Tools |
| 核心优势 | 生态广、模型无关、社区大 | 模型能力最大化、延迟最低、官方维护 |
| 核心风险 | 抽象泄漏、版本不稳定、性能损耗 | 厂商锁定、跨模型困难 |
| 多 Agent | 各家方案（Graph/Crew/Conversation） | Handoff / Sub-Agent |
| **何时选** | 跨模型 A/B 测试 / 多 LLM 厂商共存 / 内嵌大量第三方工具集成 | 团队已绑定单一模型厂商 / 需要利用厂商专属特性（Extended Thinking、Computer Use 等）/ 对延迟敏感 |

**核心趋势**：模型能力越强，框架"编排"的价值越低，厂商 SDK 的"薄抽象"路线越有优势。但当需要跨模型切换或复杂状态机编排时，第三方框架的"厚抽象"仍有价值。

### 多 Agent 编排范式对比

三种主流方式代表不同的设计哲学：

| 范式 | 代表 | 控制权 | 灵活性 | 可预测性 | 适用 |
|------|------|------|-------|---------|------|
| Handoff（显式交接） | OpenAI | LLM 决定转交对象 | 高（动态路由） | 低（依赖 LLM 判断） | 客服、意图路由 |
| Graph（状态机） | LangGraph | 开发者定义路径 | 中（预定义路径） | 高（确定性状态机） | 复杂工作流、审批 |
| Crew（角色委派） | CrewAI | 框架自动编排 | 低（固定流程） | 中 | 内容生产、研究 |

---

## 5. 用框架还是自己写：八个维度

| 考量 | 倾向框架 | 倾向自研 |
|------|---------|---------|
| 项目阶段 | 原型、MVP | 生产系统、长期维护 |
| 团队规模 | 1-3 人小团队 | 5+ 人专职 AI 团队 |
| 定制化程度 | 标准 ReAct/RAG | 有独特的控制流或状态管理需求 |
| 调试要求 | 能接受黑盒 | 需要完全可观测、可追踪 |
| 性能要求 | 对 latency 不敏感 | 需要极致优化每一毫秒 |
| 依赖容忍度 | 能接受版本变化 | 需要完全掌控依赖 |
| 上线时间 | 2 周内 | 3 个月以上 |

### 实际最常见的方案：分层使用

| 层 | 做法 |
|---|------|
| 控制循环 | **自研**——Agent 最核心的逻辑，40-60 行 Python 就够 |
| LLM 调用 | **原生 SDK**——OpenAI/Anthropic SDK 已经很好用，不需要再包一层 |
| 工具集成 | **借用框架生态**——`pip install langchain-community` 只用它的 Tool 集成 |
| 状态管理 | **自研**——根据持久化需求（Redis、PostgreSQL）定制 |

你在最关键的层（控制流）保留掌控力，在最不需要掌控的层（第三方服务集成）借用生态。

---

## 6. 用框架不被框架绑死

### 6.1 理解原理再用框架

**不理解原理用框架**：框架 = 黑魔法（出错时手足无措）
**理解原理后用框架**：框架 = 已知原理的一种实现（出错时知道去哪里找原因）

- LangChain `AgentExecutor` 出错——它内部在跑控制循环，可以猜哪个阶段出问题
- LangGraph 状态转移异常——本质是状态机的转移条件判断错误
- 框架的 Memory 不符合需求——你知道自己需要什么样的记忆架构，可以替换或扩展

### 6.2 反模式：为了适配框架扭曲业务逻辑

```python
# 反模式：业务需要 Agent 在两个工具结果之间做比较，
# 但框架不直接支持，于是"发明"一个假工具来绕过

@tool
def compare_results(result_a, result_b):
    # 这不应该是 Tool，是 Agent 内部的推理逻辑
    return llm.invoke(f"Compare: {result_a} vs {result_b}")
```

**正确做法**：框架不支持的逻辑用原生代码实现，插入到框架流程中。

### 6.3 框架可替换架构

健康的架构应该允许在不重写业务逻辑的情况下替换底层框架。实现方式是**依赖倒置**——业务代码依赖自己定义的接口，框架是接口的具体实现：

```python
class BaseLLM(ABC):
    @abstractmethod
    def chat(self, messages, tools=None) -> dict: ...

class LangChainLLM(BaseLLM):  # 框架实现，可替换
    def chat(self, messages, tools=None):
        from langchain.chat_models import ChatOpenAI
        return ChatOpenAI().invoke(messages, tools=tools).dict()

class NativeLLM(BaseLLM):     # 原生 SDK 实现，可替换
    def chat(self, messages, tools=None):
        from openai import OpenAI
        return OpenAI().chat.completions.create(
            model="gpt-4o", messages=messages, tools=tools,
        ).model_dump()

class MyAgent:  # 业务代码只依赖 BaseLLM 接口
    def __init__(self, llm: BaseLLM, ...):
        self.llm = llm
```

这是**依赖倒置原则**在 Agent 架构中的直接应用。当框架发生 breaking change（LangChain 几乎每季度都有）时，只需修改适配层，业务代码无需动。同样的思路也适用于 Tool 接口——定义自己的 `BaseTool` 抽象，框架的 Tool 是其中一种实现，原生 OpenAI Function Calling 是另一种。

---

## 7. N×M 集成问题：协议为什么出现

框架解决了"怎么写一个 Agent"。但当你有多个 Agent、多个工具提供者、多个模型时，一个更根本的问题浮现：**这些组件之间用什么协议通信**？

今天的现状：同一个工具能力（比如查询 Jira），在 LangChain 里要写一个 Tool wrapper，OpenAI 要按 Function Calling 格式再来一遍，Claude Agent SDK 又得重写。**同样的能力被实现了三遍**。

这是经典的 **N×M 集成问题**：N 个 Agent 框架 × M 个工具系统 = N×M 个集成。

![N×M 问题](/images/blog/agentic/n-x-m-problem.svg)

把 N×M 降为 N+M——这正是 MCP 试图解决的核心问题。Web 演进史上完全一样的模式：**从 CGI 到 HTTP**。

---

## 8. MCP：Agent 工具的标准协议

**MCP**（Model Context Protocol）是 Anthropic 2024 年末提出的开放协议。USB-C 之于硬件外设，正如 MCP 之于 Agent 工具——**一个协议连接所有工具**。

### 8.1 三层架构

![MCP 架构](/images/blog/agentic/mcp-architecture.svg)

| 层 | 角色 |
|---|------|
| Host | 用户面对的应用（Claude Desktop、Cursor），创建和管理 Client 实例 |
| Client | 协议客户端，与 Server 一对一连接，负责能力协商和请求路由 |
| Server | 工具/数据提供者，暴露 Tools、Resources、Prompts |

### 8.2 三大原语

![MCP 三大原语](/images/blog/agentic/mcp-primitives.svg)

| 原语 | 谁触发 | 用途 |
|------|------|------|
| **Tools** | LLM 触发（自动调用） | Agent 的"手"——查询、操作 |
| **Resources** | Host 触发（应用决定） | Agent 的"眼"——文件、文档、数据库 |
| **Prompts** | 用户触发（用户选择） | Agent 的"工作手册"——预定义的提示模板 |

**分层控制是关键设计**——避免"一切交给 LLM"的风险，保留人类最终控制权。

### 8.3 MCP Server 的最小实现

一个暴露"查 Jira issue"工具的 Server，骨架如下：

```python
# server.py - 用官方 mcp SDK
from mcp.server import Server
from mcp.types import Tool, TextContent

server = Server("jira-mcp")

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="search_jira_issues",
            description="在 Jira 中搜索 issue。支持 JQL。返回匹配的 issue 列表。",
            inputSchema={
                "type": "object",
                "properties": {
                    "jql": {
                        "type": "string",
                        "description": "JQL 查询，例如 'project = BACKEND AND status = Open'"
                    },
                    "limit": {"type": "integer", "default": 10, "maximum": 50},
                },
                "required": ["jql"],
            },
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "search_jira_issues":
        results = jira_client.search(arguments["jql"], limit=arguments.get("limit", 10))
        return [TextContent(type="text", text=json.dumps(results))]
    raise ValueError(f"unknown tool: {name}")

# stdio 模式启动（本地用）
if __name__ == "__main__":
    import asyncio
    asyncio.run(server.run_stdio())
```

这个 Server 现在可以被任何 MCP 兼容的 Host（Claude Desktop、Cursor、自研 Agent）使用，**完全不需要为每个 Host 单独适配**。这就是 MCP 把 N×M 降为 N+M 的具体体现——Server 写一遍，所有 Host 都能用。

### 8.4 MCP Client 的接入

Host 这边连 Server 的最小代码：

```python
# client.py
from mcp.client.stdio import stdio_client
from mcp.client.session import ClientSession

async def use_mcp_server():
    # 启动 Server 子进程，stdin/stdout 通信
    async with stdio_client(["python", "server.py"]) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # 发现可用工具
            tools = await session.list_tools()
            # tools = [Tool(name="search_jira_issues", inputSchema={...}, ...)]

            # 调工具
            result = await session.call_tool(
                "search_jira_issues",
                arguments={"jql": "status = Open AND assignee = currentUser()"}
            )
            return result.content
```

### 8.5 一个完整的工具调用流程

| 步 | 谁触发 | 内容 |
|---|------|------|
| 1 | User | 向 Host 发起请求 |
| 2 | Host → LLM | 把消息 + 可用工具列表送给 LLM |
| 3 | LLM → Host | 输出 tool_use 决策（"我想调 search_jira_issues"） |
| 4 | Host → MCP Client → Server | 实际发起工具调用 |
| 5 | Server → Client → Host | 返回工具结果 |
| 6 | Host → LLM | 注入工具结果，继续推理 |
| 7 | LLM → Host → User | 生成最终回答 |

**关键设计**：**LLM 不直接与 MCP Server 通信**。LLM 只表达"我想调某工具"，Host 运行时执行实际 MCP 调用。这层间接性让 Host 可以在调用前做权限检查、参数验证、用户确认。

### 8.6 传输层：从 SSE 到 Streamable HTTP

| 模式 | 适用 |
|------|------|
| **stdio** | 本地——Client 以子进程启动 Server，stdin/stdout 交换 JSON-RPC。零网络开销，IDE 插件首选 |
| **Streamable HTTP** | 远程——2025-03 规范引入，取代早期 HTTP+SSE |

**Streamable HTTP 的工程意义**：单端点设计、无状态友好、可选会话。让 Remote MCP 真正可部署在生产环境——Cloudflare Workers 后面、K8s 集群里、API Gateway 统一管理都没问题。

**为什么 stdio 在 IDE 插件场景成为默认**？三个真实原因：

1. **进程隔离天然存在**——Client 把 Server 作为子进程启动，每次会话独立、崩溃影响范围小、不需要额外的容器化
2. **无需网络配置**——不用考虑端口冲突、证书、防火墙；用户安装即用
3. **跨平台一致性**——Windows/macOS/Linux 都能跑 stdin/stdout

代价是**单机部署、不支持跨网络共享**——这正好和 IDE 插件的部署形态匹配。Remote 场景（企业内的多 Agent 共享一套 MCP Server）才用 Streamable HTTP。

### 8.7 OAuth 2.1 授权层

2025-06 规范更新把 OAuth 2.1 集成进协议：

- **PKCE**：防止授权码劫持
- **动态客户端注册**（RFC 7591）：Client 首次连接 Server 自动注册，无需人工配置
- **Resource Indicators**（RFC 8707）：Token 绑定目标 Server 地址，防止 Token 被恶意 Server 滥用

让企业可以把 MCP Server 暴露给外部 Agent 同时保持细粒度访问控制。

---

## 9. MCP 落地踩过的几个坑

### 9.1 工具描述的工程价值

工具描述质量直接决定 Agent 选对工具的概率。**这是给 LLM 看的接口文档，不是给人类看的注释**：

| 差 | 好 |
|---|----|
| `name: "search", description: "Search for things"` | `name: "search_jira_issues", description: "在 Jira 中搜索 issue。适用：用户查找 bug、需求、任务。支持 JQL 语法。不适用于搜索 Confluence 或代码。返回匹配的 issue 列表"` |
| `q: string` | `jql: string, "Jira Query Language 查询语句，例如: 'project = BACKEND AND status = Open'"` |

### 9.2 名字空间冲突

接入多个 MCP Server 时，工具名容易撞车——两个 Server 都有 `search` 工具。Host 层必须做命名空间隔离：

```python
def namespaced_tools(servers: dict[str, MCPSession]) -> list[Tool]:
    """把每个 Server 的工具加上 server_id 前缀"""
    tools = []
    for server_id, session in servers.items():
        for tool in await session.list_tools():
            namespaced = tool.copy()
            namespaced.name = f"{server_id}__{tool.name}"
            tools.append(namespaced)
    return tools

def route_tool_call(name: str, args: dict, servers: dict[str, MCPSession]):
    """按前缀路由回对应的 Server"""
    server_id, raw_name = name.split("__", 1)
    return servers[server_id].call_tool(raw_name, args)
```

### 9.3 安全的多层防护

| 层 | 防什么 |
|---|------|
| 工具级 ACL | Host 层白名单/黑名单——哪些 Agent 可调哪些工具 |
| 参数级约束 | 即使允许调用也限制参数范围（SQL 工具只允许 SELECT） |
| Human-in-the-Loop | 高风险操作（写入、删除、发消息）必须用户显式确认 |
| 执行沙箱 | stdio 模式天然进程隔离；不可信代码必须容器隔离 |

Server 是不可信输入源——一个恶意的 MCP Server 可能在工具描述里藏提示注入指令、在返回数据里藏指令。Host 必须把 MCP Server 当外部输入处理，所有内容过 Guardrail，和处理用户输入同等小心。

---

## 10. A2A：Agent 之间怎么对话

MCP 解决了"Agent 如何与工具通信"。还有一个平行问题：**不同系统中的 Agent 如何互相协作**？

设想：企业 A 的采购 Agent 需要向企业 B 的供应链 Agent 询价。两个 Agent 跑在不同框架上、由不同团队维护。MCP 管不了这个——它定义的是 Agent 与工具的关系，不是 Agent 与 Agent 的关系。

Google 在 2025-04 提出 **A2A**（Agent-to-Agent）协议填补这个空白。

A2A 的核心抽象：**Agent Card**（放在 `/.well-known/agent.json` 的 JSON 名片，声明能力、交互模式、认证要求）、**Task**（带完整生命周期 `submitted → working → input-required → completed/failed/canceled` 的核心交互单元）、**Message + Part**（支持多模态）。跨组织 Agent 协作的发现机制就是"读对方的 Agent Card"——无需事先约定接口、无需人工配置。

| 维度 | MCP | A2A |
|------|-----|-----|
| 解决的问题 | Agent ↔ Tool | Agent ↔ Agent |
| 交互模式 | 请求-响应（同步为主） | Task 生命周期（异步、多轮）|
| 发现机制 | `tools/list` | Agent Card |
| 透明度 | 工具实现对 Agent 透明 | Agent 内部对调用方**不透明** |

**A2A 的不透明性是关键差异**：MCP 要求工具暴露输入输出 Schema、调用方精确控制参数；A2A 假设对方是黑箱——你只知道它能做什么（通过 Agent Card），不需要知道它怎么做。这符合 Agent 间协作的现实：委托供应链 Agent 询价，不需要知道它内部查数据库还是调 ERP。

**采用建议**：Agent 只在内部系统协作 → 不需要 A2A，用 Multi-Agent 框架或函数调用更直接；需要跨组织边界协作 → 关注 A2A；任何场景 → MCP 仍是基础层。截至 2026 年初，A2A 还在早期采用阶段，生产级部署案例稀少——可以关注、不必早投入，把它当"明年可能成熟"的事观察就好。**MCP 是 Agent 的手，A2A 是 Agent 的嘴**——前者操作工具，后者与其他 Agent 对话。

---

## 11. 框架解决开发效率，协议解决生态问题

框架和协议解决的不是同一个问题。框架在 Agent 内部——回答"控制循环、状态、工具、Memory 怎么组织"。协议在 Agent 之间——回答"我的工具被谁调用、我的 Agent 跟谁对话"。这两件事在工程上是垂直方向上的两层：你可以用 LangGraph + MCP、也可以用厂商原生 SDK + MCP，框架和协议各自演进。

关于框架选型，最实用的判断是别陷入"哪个框架最好"的争论——没有最好，只有最适合当下规模。学习期用 LangChain 拿到生态，规模化后核心控制循环自研、外围工具集成借框架生态、模型调用直用原生 SDK。这种"分层使用"在两年内的实战中已经被验证是最稳的姿势——把可控性集中在你想控的层，把生态借力在你不想重复造的层。

关于协议，MCP 把工具集成从 N×M 降为 N+M，A2A 在 Agent 协作的尺度上做同样的事——一个负责"Agent 的手"、一个负责"Agent 的嘴"。今天 MCP 已经从"新概念"进入"标配"阶段，A2A 还在早期但方向明确。Agent 生态从手工作坊走向工业化的基石，正是这两个协议层。