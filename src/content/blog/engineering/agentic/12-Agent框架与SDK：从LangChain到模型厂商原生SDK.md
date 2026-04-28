---
title: "Agent框架与SDK：从LangChain到模型厂商原生SDK"
pubDate: "2026-01-22"
description: "客观审视 AI Agent 框架的价值与局限。深入分析 LangChain/LangGraph 的优势与陷阱，横向对比 CrewAI、AutoGen 等第三方框架，并系统剖析 2025-2026 年崛起的模型厂商原生 SDK——Claude Agent SDK、OpenAI Agents SDK、Google ADK、AWS Strands——框架与模型深度绑定的新路线。理解原理再用框架，框架是加速器而非必需品。"
tags: ["Agentic", "AI Engineering", "Framework"]
series:
  key: "agentic"
  order: 12
author: "skyfalling"
---

---

## 1. 你真的需要框架吗？

这个问题的答案不是"需要"或"不需要"，而是"取决于"。

如果你已经读完本系列前 7 篇文章（从控制循环到自研 Runtime），你已经具备了从零构建一个 Agent 系统的能力。你知道 Tool Calling 的 JSON Schema 契约，知道控制循环的 Observe-Think-Plan-Act-Reflect-Update 六阶段，知道 Memory 的短期/长期分层，知道 Planner 的 ReAct 与分层规划。

这时候你面临一个决策：

```
选择 A：自己实现所有组件，完全掌控
选择 B：使用框架，快速启动，接受其抽象和约束
选择 C：理解框架的实现，选择性地借鉴或使用其部分模块
```

大多数成熟的工程团队最终会走向选择 C。但要做到选择 C，你必须先深入理解框架到底在做什么。这就是本文的目的。

---

## 2. 为什么需要框架

框架存在是有道理的。在深入批判之前，先公正地承认它们解决了哪些真实的工程问题。

### 2.1 减少重复代码

每一个 Agent 系统都需要处理以下样板代码：

- **工具注册与调度**：维护一个 `tool_name → callable` 的映射表，处理参数校验和错误捕获
- **消息格式管理**：构造和维护 `messages` 列表，处理不同角色（system/user/assistant/tool）的消息格式
- **LLM 调用封装**：处理 API 差异（OpenAI、Anthropic、本地模型的接口都不同）、流式输出、重试、降级
- **状态序列化**：将 Agent 的运行状态持久化到数据库或文件系统

这些代码在每个项目中高度相似，但又充满细节（比如 OpenAI 的 `tool_calls` 和 Anthropic 的 `tool_use` 格式差异）。框架把这些细节屏蔽了。

### 2.2 社区生态

成熟框架最大的资产不是代码，而是生态：

- **预置 Tool 集成**：搜索引擎（Tavily、SerpAPI）、数据库（SQL、MongoDB）、文件系统、浏览器等，开箱即用
- **预置 Retriever**：支持各种向量数据库（Pinecone、Weaviate、Chroma、FAISS）的统一接口
- **文档与教程**：从入门到进阶的学习路径
- **社区问答**：遇到问题时有人讨论、有 issue 可以搜索

### 2.3 最佳实践封装

框架将社区沉淀的设计模式编码为默认行为：

- ReAct 模式的标准实现
- Retrieval-Augmented Generation 的标准 pipeline
- 对话记忆的滑动窗口管理
- 工具调用的错误处理和重试

对于刚接触 Agent 开发的团队，这些封装可以避免很多常见的设计错误。

### 2.4 快速原型验证

当你需要在两天内验证一个想法是否可行时，框架的价值最大化。10 行代码就能跑通一个带工具调用的 Agent 原型，比从零实现快一个数量级。

```python
# 10 行代码验证一个想法——这是框架的甜蜜点
from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate
from langchain_community.tools.tavily_search import TavilySearchResults

llm = ChatOpenAI(model="gpt-4o")
tools = [TavilySearchResults(max_results=3)]
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful research assistant."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])
agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)
result = executor.invoke({"input": "2025 年 AI Agent 领域有哪些重要进展？"})
```

这段代码在 5 分钟内就能跑通。但如果你打算把它部署到生产环境——请继续往下读。

---

## 3. LangChain 深入分析

LangChain 是 AI Agent 领域生态最大的框架，也是争议最多的框架。我们不吹不黑，从架构和工程两个维度来分析。

### 3.1 核心抽象

LangChain 的设计围绕四个核心抽象：

| 抽象 | 本质 | 职责 |
|------|------|------|
| **Chain** | 链式调用 | 将多个步骤串联为顺序执行的管道 |
| **Agent** | 工具选择 + 循环 | LLM 自主决定调用哪个工具，循环直到完成 |
| **Memory** | 对话状态管理 | 维护对话历史，支持滑动窗口、摘要等策略 |
| **Retriever** | 知识检索 | 从向量数据库或其他数据源检索相关文档 |

这四个抽象之间的关系可以用下图表示：

![LangChain Architecture](/images/blog/agentic-12/langchain-architecture.svg)

### 3.2 代码示例：用 LangChain 实现工具调用 Agent

下面用 LangChain 实现一个能查天气和创建日程的 Agent，同时标注每一层抽象的存在：

```python
from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool

# --- 第 1 层抽象：@tool 装饰器 ---
# LangChain 用装饰器将普通函数包装为 Tool 对象
# 自动从类型注解和 docstring 生成 JSON Schema
@tool
def get_weather(city: str, date: str) -> str:
    """获取指定城市在指定日期的天气预报。

    Args:
        city: 城市名称，例如 "北京"
        date: 日期，格式 YYYY-MM-DD
    """
    # 实际调用天气 API
    return f'{{"city": "{city}", "date": "{date}", "temp": "31°C", "condition": "多云转雷阵雨"}}'

@tool
def create_reminder(title: str, time: str, note: str) -> str:
    """创建一个日程提醒。

    Args:
        title: 提醒标题
        time: 提醒时间，ISO 8601 格式
        note: 提醒备注内容
    """
    return f'{{"status": "created", "title": "{title}", "time": "{time}"}}'

# --- 第 2 层抽象：LLM 封装 ---
# ChatOpenAI 封装了 OpenAI API 的调用细节
llm = ChatOpenAI(model="gpt-4o", temperature=0)

# --- 第 3 层抽象：Prompt Template ---
# ChatPromptTemplate 管理消息的组装逻辑
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个智能助手，可以查询天气和管理日程。今天是 2025-09-01。"),
    ("human", "{input}"),
    MessagesPlaceholder(variable_name="agent_scratchpad"),  # Agent 的工作记忆
])

# --- 第 4 层抽象：Agent 构造 ---
# create_tool_calling_agent 将 LLM + Tools + Prompt 组合为一个 Agent
tools = [get_weather, create_reminder]
agent = create_tool_calling_agent(llm, tools, prompt)

# --- 第 5 层抽象：AgentExecutor ---
# AgentExecutor 提供控制循环：调用 Agent → 执行工具 → 反馈结果 → 循环
executor = AgentExecutor(
    agent=agent,
    tools=tools,
    verbose=True,       # 输出每一步的推理过程
    max_iterations=10,  # 最大循环次数
    handle_parsing_errors=True,  # 自动处理 LLM 输出格式错误
)

# --- 运行 ---
result = executor.invoke({"input": "帮我查看明天北京的天气，然后创建一个提醒"})
print(result["output"])
```

数一数：从你的业务逻辑（两个工具函数）到最终执行，经过了 **5 层抽象**。每一层都在"帮你做决策"——消息格式、工具注册方式、控制循环策略、错误处理逻辑、输出解析方式。

### 3.3 优点

**1. 生态最大、集成最多**

截至 2025 年，LangChain 拥有 AI Agent 框架领域最庞大的集成生态：

- 70+ LLM 提供商（OpenAI、Anthropic、Google、Mistral、本地模型等）
- 50+ 向量数据库
- 100+ 预置工具
- 30+ Document Loader（PDF、HTML、CSV、Notion、Confluence 等）

**2. 社区活跃**

GitHub 上最活跃的 AI 项目之一。遇到问题时，StackOverflow 和 GitHub Issues 中大概率能找到讨论。

**3. 上手快**

对于 PoC（Proof of Concept）和原型验证，LangChain 能让你在几小时内从零到一跑通一个完整的 Agent。

**4. 抽象统一**

不同 LLM 提供商的 API 差异被封装在统一接口下。切换 OpenAI → Anthropic 只需要换一行代码（理论上如此，实际上有细微差异）。

### 3.4 问题

以下不是主观吐槽，而是在生产环境中反复遇到的工程问题。

**问题 1：过度抽象——简单的事情被包了太多层**

考虑一个最基本的需求：调用 LLM 并获取结构化输出。

```python
# 不用框架：3 行代码，直白清晰
import openai
response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "分析这段文本的情感"}],
    response_format={"type": "json_object"},
)
result = json.loads(response.choices[0].message.content)

# 用 LangChain：需要理解 ChatOpenAI、BaseOutputParser、RunnableSequence、
# StrOutputParser vs JsonOutputParser、LCEL 管道语法...
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate.from_template("分析这段文本的情感: {text}")
llm = ChatOpenAI(model="gpt-4o")
parser = JsonOutputParser()
chain = prompt | llm | parser  # LCEL 管道语法
result = chain.invoke({"text": "这个产品太棒了"})
```

LangChain 版本代码量更多不是问题——问题在于它引入了多个你需要理解的新概念（`ChatPromptTemplate`、`JsonOutputParser`、LCEL 管道操作符 `|`），而这些概念只是在封装原本就很简单的操作。

**问题 2：调试困难——错误信息穿过多层封装后难以定位**

当 LangChain 链条中的某一环出错时，错误堆栈可能长达 20-30 层，涉及 `RunnableSequence`、`RunnableParallel`、`RunnableLambda` 等内部抽象。你需要在这些框架内部类之间导航，才能找到真正的错误源。

```
# 真实场景中的错误堆栈（简化版）
Traceback:
  langchain_core/runnables/base.py      RunnableSequence.invoke()
  langchain_core/runnables/base.py      RunnableSequence._invoke()
  langchain_core/runnables/base.py      Runnable.invoke()
  langchain_core/runnables/base.py      RunnableLambda.invoke()
  langchain/agents/output_parsers.py    ToolsAgentOutputParser.parse()
  ...
  # 15 层之后...
  你的代码.py                            你的函数()   ← 真正的问题在这里
```

在生产环境的 3 AM 报警中，这种调试体验是痛苦的。

**问题 3：版本混乱——API 变动频繁**

LangChain 在快速迭代中经历了多次重大 API 变更：

- `langchain` → `langchain-core` + `langchain-community` 的包拆分
- `LLMChain` → LCEL（LangChain Expression Language）的范式转换
- `initialize_agent` → `create_tool_calling_agent` 的 Agent 创建方式变更
- Memory 接口的多次重构

6 个月前写的代码，今天大概率跑不通。网上的教程和 StackOverflow 答案大量过时。对于需要长期维护的生产系统，这是一个严重的风险。

**问题 4："Chain" 思维的局限——线性链无法表达复杂的分支和循环**

LangChain 的核心抽象是 "Chain"——链式调用。这个模型对于线性流水线（A → B → C）非常优雅，但现实中的 Agent 逻辑往往是非线性的：

![Linear vs Complex Flow](/images/blog/agentic-12/linear-vs-complex-flow.svg)

LangChain 的 LCEL 可以通过 `RunnableBranch` 和 `RunnableParallel` 实现一些分支和并行，但语法变得复杂且不直观。这正是 LangGraph 诞生的原因。

---

## 4. LangGraph 深入分析

LangGraph 是 LangChain 团队推出的下一代框架，核心思想是用**有向图（Directed Graph）** 替代**链（Chain）** 作为基础抽象。这不是一个小改动——它从根本上改变了 Agent 逻辑的表达方式。

### 4.1 核心抽象

LangGraph 的设计围绕四个概念：

| 抽象 | 本质 | 对应的计算模型 |
|------|------|---------------|
| **State** | 共享状态对象 | 状态机的 State |
| **Node** | 一个函数 | 状态机的 State Handler |
| **Edge** | 节点间的连接 | 状态机的 Transition |
| **Graph** | 节点和边的组合 | 有限状态机（FSM）|

核心思想：**Agent 的执行流程就是一个状态机。** 每个节点是一个处理函数，每条边是一个转移条件，整个图定义了 Agent 的所有可能执行路径。

![LangGraph State Machine](/images/blog/agentic-12/langgraph-state-machine.svg)

这个图可以清晰地表达：

- **循环**：`agent_node → tool_node → agent_node`（工具调用循环）
- **分支**：`should_continue?` 条件路由
- **终止**：到达 `END` 节点时退出

### 4.2 代码示例：用 LangGraph 实现同一个 Agent

用 LangGraph 实现与上文 LangChain 相同的天气查询 + 日程创建 Agent：

```python
from typing import Annotated, TypedDict
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode


# ============================================================
# Step 1: 定义共享状态（State）
# ============================================================
# 这是 LangGraph 与 LangChain 的核心差异：
# 显式定义 Agent 的完整状态结构
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]  # 消息列表，自动追加


# ============================================================
# Step 2: 定义工具（和 LangChain 相同）
# ============================================================
@tool
def get_weather(city: str, date: str) -> str:
    """获取指定城市在指定日期的天气预报。"""
    return f'{{"city": "{city}", "date": "{date}", "temp": "31°C", "condition": "多云转雷阵雨"}}'

@tool
def create_reminder(title: str, time: str, note: str) -> str:
    """创建一个日程提醒。"""
    return f'{{"status": "created", "title": "{title}", "time": "{time}"}}'

tools = [get_weather, create_reminder]


# ============================================================
# Step 3: 定义节点（Node）
# ============================================================
llm = ChatOpenAI(model="gpt-4o", temperature=0).bind_tools(tools)

def agent_node(state: AgentState) -> dict:
    """推理节点：LLM 根据当前状态决定下一步"""
    system_message = {
        "role": "system",
        "content": "你是一个智能助手，可以查询天气和管理日程。今天是 2025-09-01。"
    }
    messages = [system_message] + state["messages"]
    response = llm.invoke(messages)
    return {"messages": [response]}

# ToolNode 是 LangGraph 的内置节点，自动执行工具调用
tool_node = ToolNode(tools)


# ============================================================
# Step 4: 定义边（Edge）—— 条件路由
# ============================================================
def should_continue(state: AgentState) -> str:
    """条件路由：检查最后一条消息是否包含工具调用"""
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"     # 有工具调用 → 去 tool_node
    return "end"           # 无工具调用 → 任务完成


# ============================================================
# Step 5: 构建图（Graph）
# ============================================================
graph_builder = StateGraph(AgentState)

# 添加节点
graph_builder.add_node("agent", agent_node)
graph_builder.add_node("tools", tool_node)

# 添加边
graph_builder.add_edge(START, "agent")                        # 入口 → 推理
graph_builder.add_conditional_edges("agent", should_continue, {
    "tools": "tools",                                         # 推理 → 工具执行
    "end": END,                                               # 推理 → 结束
})
graph_builder.add_edge("tools", "agent")                      # 工具执行 → 回到推理

# 编译图
graph = graph_builder.compile()


# ============================================================
# Step 6: 运行
# ============================================================
result = graph.invoke({
    "messages": [HumanMessage(content="帮我查看明天北京的天气，然后创建一个提醒")]
})

# 输出最终结果
for message in result["messages"]:
    print(f"[{message.type}] {message.content}")
```

对比 LangChain 版本，LangGraph 的关键差异：

1. **显式状态定义**：`AgentState` 明确声明了 Agent 运行时的完整状态
2. **显式控制流**：`add_edge` 和 `add_conditional_edges` 让执行路径一目了然
3. **图可视化**：编译后的 `graph` 可以直接渲染为流程图，便于理解和调试
4. **没有隐藏的循环**：循环通过 `tools → agent` 的边显式定义，而不是藏在 `AgentExecutor` 内部

### 4.3 优点

**1. 状态机模型比 Chain 更强大**

Chain 只能表达线性流水线。Graph 可以表达任意拓扑——分支、循环、并行、条件汇聚。这与现实中 Agent 的执行逻辑天然匹配。

**2. 确定性的控制流 + 非确定性的 LLM 决策**

这是 LangGraph 最精妙的设计哲学：

```
确定性（代码定义）：            非确定性（LLM 决定）：
├── 有哪些节点                 ├── 每个节点内部的推理
├── 节点间如何连接              ├── 工具选择和参数
├── 条件路由的判断逻辑          ├── 是否继续循环
└── 状态的数据结构              └── 最终输出内容
```

图的拓扑结构是确定性的（你在编译时就知道所有可能的执行路径），但每一步走哪条路径是 LLM 在运行时决定的。这实现了**可预测的系统行为**与**灵活的智能决策**之间的平衡。

**3. Checkpoint 支持——暂停、恢复、Time-Travel**

LangGraph 内置了状态检查点机制。这意味着：

```python
from langgraph.checkpoint.memory import MemorySaver

# 带 checkpoint 的图
checkpointer = MemorySaver()
graph = graph_builder.compile(checkpointer=checkpointer)

# 运行时传入 thread_id
config = {"configurable": {"thread_id": "user-123"}}
result = graph.invoke({"messages": [HumanMessage(content="查天气")]}, config)

# 可以暂停、恢复、回放
# - 暂停：interrupt_before=["tool_node"] 在工具执行前暂停，等待人类审批
# - 恢复：再次 invoke 同一个 thread_id，从上次中断点继续
# - Time-travel：回滚到任意 checkpoint，重新执行
```

这在 Human-in-the-Loop（人机协作）场景中极其有价值——Agent 可以在执行敏感操作前暂停，等待人类确认。

**4. 可以表达复杂的多 Agent 架构**

上一篇我们讨论的 Supervisor/Worker 模式、并行 Agent 协作，在 LangGraph 中可以自然地表达为图结构：

![Supervisor-Worker 多 Agent 架构](/images/blog/agentic-12/supervisor-worker-multi-agent.svg)

### 4.4 问题

**问题 1：学习曲线较陡**

LangGraph 要求你理解状态机、有向图、条件路由等概念。对于习惯了"调用一个函数就能跑"的开发者来说，需要一段适应期。

特别是 `Annotated[list[BaseMessage], add_messages]` 这样的状态定义语法（使用 `Annotated` 类型指定 reducer 函数），对 Python 类型系统不熟悉的开发者可能感到困惑。

**问题 2：状态定义需要提前规划**

在 LangChain 中，你可以随意传递数据，框架会帮你管理。在 LangGraph 中，所有状态必须在 `AgentState` 中预先定义。这意味着你需要在写代码之前就想清楚 Agent 需要哪些状态。

```python
# 如果开发到一半发现需要新的状态字段，
# 你需要修改 State 定义，并确保所有节点兼容
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    plan: list[str]                    # 后来加的
    current_step: int                  # 后来加的
    tool_results: dict[str, str]       # 后来加的
    retry_count: int                   # 后来加的
    # ... 状态会越来越复杂
```

对于探索性的开发来说，这种"先定义后使用"的约束会拖慢迭代速度。

**问题 3：小任务过度工程化**

如果你的 Agent 逻辑就是"调用 LLM → 可能调用工具 → 返回结果"这个简单循环，用 LangGraph 定义 State、Node、Edge、Conditional Edge 就像是用大炮打蚊子。

```python
# 一个简单的 ReAct Agent，用 LangGraph 需要 40+ 行图定义代码
# 用原生 Python 只需要一个 while 循环：
while True:
    response = llm.chat(messages, tools=tools)
    if not response.tool_calls:
        return response.content
    for tc in response.tool_calls:
        result = execute_tool(tc)
        messages.append(tool_message(tc.id, result))
```

当你的 Agent 逻辑不涉及复杂的分支和并行时，LangGraph 的开销不值得。

---

## 5. 其他框架概览

除了 LangChain 和 LangGraph，AI Agent 领域还有多个值得关注的框架。以下不深入展开，重点给出定位和适用场景。

### 5.1 框架定位速览

| 框架 | 开发者 | 核心抽象 | 定位 | 适用场景 |
|------|--------|---------|------|----------|
| **LangChain** | LangChain Inc. | Chain（链式调用） | 通用 AI 应用框架 | 原型验证、RAG、简单 Agent |
| **LangGraph** | LangChain Inc. | Graph（状态机） | 复杂 Agent 编排 | 多步推理、Human-in-the-Loop、多 Agent |
| **CrewAI** | CrewAI Inc. | Crew + Agent + Task | 多 Agent 协作 | 角色扮演式多 Agent 工作流 |
| **AutoGen** | Microsoft | Agent + Conversation | 多 Agent 对话 | 研究型多 Agent 系统、代码生成 |
| **Semantic Kernel** | Microsoft | Kernel + Plugin + Planner | 企业级 AI 编排 | 企业应用集成、.NET 生态 |
| **Haystack** | deepset | Pipeline + Component | RAG 专用 | 文档检索、知识问答 |
| **DSPy** | Stanford NLP | Module + Signature + Optimizer | Prompt 优化 | 需要自动调优 Prompt 的系统 |
| **Claude Agent SDK** | Anthropic | Agent Loop + MCP Tools | 模型原生 Agent | Claude 生态、代码/通用 Agent |
| **OpenAI Agents SDK** | OpenAI | Agent + Handoff + Guardrail | 多 Agent 编排 | GPT 生态、客服/业务流程 |
| **Google ADK** | Google | Agent + Tool + Session | 全栈 Agent 开发 | Gemini 生态、企业级 Agent |
| **Strands** | AWS | Model-driven Agent Loop | 模型驱动 Agent | Bedrock 生态、多模型 Agent |

### 5.2 简要点评

**CrewAI** 的核心思路是"角色扮演"——你定义多个 Agent，每个 Agent 有一个角色（Researcher、Writer、Reviewer），然后把一个任务分配给这个"团队"。这个抽象直观好懂，但在复杂场景中角色定义和任务分配的灵活性不足。

```python
# CrewAI 的核心抽象：角色 + 任务 + 团队
from crewai import Agent, Task, Crew

researcher = Agent(role="Researcher", goal="查找相关信息", ...)
writer = Agent(role="Writer", goal="撰写报告", ...)
task1 = Task(description="研究 AI Agent 的最新进展", agent=researcher)
task2 = Task(description="基于研究结果撰写报告", agent=writer)
crew = Crew(agents=[researcher, writer], tasks=[task1, task2])
result = crew.kickoff()
```

**AutoGen**（Microsoft）强调多 Agent 之间的对话作为协作机制。Agent 之间通过消息传递交互，可以构建复杂的对话流程。适合研究和实验性项目，生产部署的工程支持较弱。

**Semantic Kernel**（Microsoft）面向企业用户，强调与现有企业系统的集成。如果你的技术栈是 .NET/C#，或者需要与 Microsoft 365/Azure 深度集成，Semantic Kernel 是更自然的选择。

**Haystack**（deepset）不试图做通用 Agent 框架，而是专注于 RAG pipeline。如果你的核心需求是文档检索和知识问答（而不是 Agent 的自主决策和工具调用），Haystack 的 Pipeline 抽象比 LangChain 更干净。

**DSPy**（Stanford NLP）走了一条完全不同的路——它不是一个 Agent 运行时框架，而是一个 Prompt 优化框架。核心思想是把 Prompt 当作可学习的参数，通过编译和优化自动找到最佳 Prompt。适合对 Prompt 质量有极高要求的场景。

### 5.3 框架选型决策树

![框架选型决策树](/images/blog/agentic-12/framework-selection-decision-tree.svg)

---

## 6. 框架 vs 自研的决策矩阵

这是本文最重要的一节。不存在"框架一定好"或"自研一定好"的结论——关键是根据你的具体场景做出理性决策。

### 6.1 决策矩阵

| 考量因素 | 倾向选框架 | 倾向选自研 |
|----------|-----------|-----------|
| **项目阶段** | 原型验证、MVP | 生产系统、需要长期维护 |
| **团队规模** | 1-3 人小团队 | 5+ 人专职 AI 团队 |
| **定制化程度** | 标准 ReAct/RAG 模式 | 有独特的控制流或状态管理需求 |
| **调试要求** | 能接受黑盒 | 需要完全可观测、可追踪 |
| **性能要求** | 对 latency 不敏感 | 需要极致优化每一毫秒 |
| **依赖容忍度** | 能接受第三方依赖的版本变化 | 需要完全掌控依赖 |
| **上线时间** | 2 周内上线 | 3 个月以上的工程周期 |
| **团队 AI 经验** | 初次接触 Agent 开发 | 对 Agent 架构有深入理解 |

### 6.2 常见场景分析

**场景 1：初创团队做 AI 产品的 MVP**

推荐：LangChain（快速原型）→ 验证产品方向 → 决定是否重写

理由：此时最大的风险不是技术债，而是方向错误。花 3 个月自研一个完美的 Agent Runtime，结果发现用户不需要 Agent——这才是最大的浪费。用框架在 2 周内验证想法，确认方向后再决定技术路线。

**场景 2：大厂 AI 平台团队**

推荐：自研核心 Runtime + 选择性使用框架的底层模块

理由：大厂有足够的工程资源，且对可靠性、可观测性、安全性的要求远超框架的默认支持。自研 Runtime 可以完全掌控控制循环、状态管理、错误处理、日志追踪。但可以借鉴框架的设计模式，或使用框架的工具集成层（比如 LangChain 的 Tool/Retriever 集成）。

**场景 3：企业内部的 AI 助手**

推荐：LangGraph（如果逻辑复杂）或 LangChain（如果逻辑简单）

理由：企业内部项目通常有明确的需求边界和合理的 SLA 要求，框架能满足大部分需求。LangGraph 的 Human-in-the-Loop 支持对企业审批流程特别有用。

**场景 4：研究实验**

推荐：AutoGen 或自研轻量框架

理由：研究需要最大的灵活性来尝试新想法。框架的抽象可能限制实验空间。但如果实验涉及多 Agent 交互，AutoGen 的对话式抽象可以减少样板代码。

### 6.3 一个务实的折中方案

在实践中，最常见的成熟方案是**分层使用框架**：

![分层框架架构](/images/blog/agentic-12/layered-framework-architecture.svg)

核心思路：

- **控制循环自研**：这是 Agent 最核心的逻辑，也是最需要定制的部分。用 40-60 行 Python 就能实现一个健壮的控制循环（回顾第 07 篇）
- **LLM 调用用原生 SDK**：OpenAI SDK 和 Anthropic SDK 本身就很好用，不需要再包一层
- **工具集成可以借用框架**：LangChain 的 Tool 生态确实强大。你可以只 `pip install langchain-community` 来使用其预置工具，而不用采纳整个框架
- **状态管理自研**：根据你的持久化需求（Redis、PostgreSQL、内存）定制

这个方案的好处是：你在最关键的层面保留了完全掌控力，同时在最不需要掌控的层面（第三方服务的集成）借助了框架的生态。

---

## 7. 框架的正确使用姿势

无论你最终选择什么方案，以下原则都适用。

### 7.1 理解原理再用框架

这正是本系列前 7 篇文章的价值。当你理解了控制循环的六个阶段、Tool Calling 的 JSON Schema 契约、Memory 的分层架构之后，框架在你眼中就不再是黑盒——它只是这些原理的一种实现。

```
不理解原理时使用框架：
    框架 = 黑魔法（出错时手足无措）

理解原理后使用框架：
    框架 = 已知原理的一种实现（出错时知道去哪里找原因）
```

具体来说：

- 当 LangChain 的 `AgentExecutor` 出错时，你知道它内部在跑一个控制循环，可以猜测问题出在哪个阶段
- 当 LangGraph 的状态转移出现异常时，你知道这本质上是一个状态机的转移条件判断错误
- 当框架的 Memory 管理不符合你的需求时，你知道自己需要什么样的记忆架构，可以替换或扩展

### 7.2 不要被框架限制思维

框架提供了一组默认的设计模式。这些模式覆盖了 80% 的常见场景，但你的场景可能落在剩下的 20%。

**反模式**：为了适配框架的抽象而扭曲自己的业务逻辑。

```python
# 反模式：业务逻辑需要 Agent 在两个工具的结果之间做比较，
# 但框架不直接支持，于是你"发明"了一个假工具来绕过限制

@tool
def compare_results(result_a: str, result_b: str) -> str:
    """比较两个结果（实际上这应该是 Agent 内部的推理逻辑，不是工具）"""
    # 这不应该是一个 Tool —— 这是把框架的抽象当成了唯一的解法
    return llm.invoke(f"比较: {result_a} vs {result_b}")
```

**正确做法**：框架不支持的逻辑，用原生代码实现，然后插入到框架的流程中（或者干脆不用框架处理这部分）。

### 7.3 框架代码是最好的学习材料

即使你决定自研，框架的源码仍然是宝贵的学习资源。以下是几个值得阅读的代码文件：

- **LangGraph 的 `StateGraph`**：理解如何用 Python 实现一个状态机运行时
- **LangChain 的 `ToolNode`**：理解如何将 LLM 的 tool_call 输出映射为实际的函数调用
- **LangChain 的 `ChatOpenAI`**：理解如何封装 LLM Provider 的 API 差异
- **LangGraph 的 `MemorySaver`**：理解 checkpoint 和状态持久化的实现

阅读源码时，关注的不是具体的 API，而是**设计决策**：为什么这样抽象？这个 trade-off 是什么？有没有更好的方案？

### 7.4 随时准备好替换或去掉框架

一个健康的架构应该允许你在不重写业务逻辑的情况下替换底层框架。实现方式：

```python
# 定义你自己的接口（不依赖任何框架）
from abc import ABC, abstractmethod

class BaseLLM(ABC):
    @abstractmethod
    def chat(self, messages: list[dict], tools: list[dict] | None = None) -> dict:
        ...

class BaseToolExecutor(ABC):
    @abstractmethod
    def execute(self, tool_name: str, args: dict) -> str:
        ...

class BaseMemory(ABC):
    @abstractmethod
    def get_messages(self, limit: int = 20) -> list[dict]:
        ...
    @abstractmethod
    def add_message(self, message: dict) -> None:
        ...


# 框架实现（可替换）
class LangChainLLM(BaseLLM):
    def __init__(self):
        from langchain_openai import ChatOpenAI
        self._llm = ChatOpenAI(model="gpt-4o")

    def chat(self, messages, tools=None):
        # 将你的接口适配为 LangChain 接口
        ...

# 原生实现（可替换）
class NativeLLM(BaseLLM):
    def __init__(self):
        import openai
        self._client = openai.OpenAI()

    def chat(self, messages, tools=None):
        response = self._client.chat.completions.create(
            model="gpt-4o", messages=messages, tools=tools
        )
        ...


# 你的 Agent 代码只依赖自己的接口
class MyAgent:
    def __init__(self, llm: BaseLLM, tools: BaseToolExecutor, memory: BaseMemory):
        self.llm = llm
        self.tools = tools
        self.memory = memory

    def run(self, user_input: str) -> str:
        # 业务逻辑不依赖任何框架
        ...
```

这不是过度设计——这是**依赖倒置原则**在 Agent 架构中的直接应用。当框架发生 breaking change（LangChain 几乎每季度都有）时，你只需要修改适配层，而不是重写整个系统。

---

## 8. LangChain vs LangGraph：直接对比

最后，用一张表格直接对比 LangChain 和 LangGraph 在各维度的差异：

| 维度 | LangChain | LangGraph |
|------|-----------|-----------|
| **核心抽象** | Chain（线性管道） | Graph（有向状态机） |
| **控制流表达** | 线性为主，分支/循环需要 hack | 天然支持分支、循环、并行 |
| **状态管理** | 隐式（框架内部管理） | 显式（开发者定义 State 类型） |
| **学习曲线** | 低（上手快） | 中等（需要理解状态机概念） |
| **调试体验** | 差（多层抽象遮蔽错误源） | 中等（图结构可视化，但状态流转需追踪） |
| **适合场景** | 简单 Agent、RAG、原型验证 | 复杂 Agent、多 Agent、Human-in-the-Loop |
| **生态集成** | 最丰富 | 继承 LangChain 生态 |
| **Human-in-the-Loop** | 不原生支持 | 原生 Checkpoint + Interrupt 支持 |
| **多 Agent** | 需要自行编排 | 原生支持子图嵌套 |
| **生产就绪度** | 中等（需要大量自定义） | 较高（状态持久化、检查点内置） |
| **灵活性** | 框架约束多，突破框架难 | 图定义灵活，但需要提前规划 |
| **版本稳定性** | 差（API 频繁变更） | 较好（API 相对稳定） |

**总结**：如果 LangChain 是一条**传送带**（把东西从 A 运到 B），那么 LangGraph 就是一张**铁路网**（可以在任意站点之间调度列车）。传送带简单高效，铁路网灵活强大——选哪个取决于你要运的东西有多复杂。

---

## 9. LangGraph 生产实践中的坑点

在深入使用 LangGraph 进行生产部署时，框架的理想设计与现实运维需求之间会出现多个显著的鸿沟。这些不是框架设计上的缺陷，而是"在追求表达力和灵活性时，必然要付出的代价"。

### 9.1 状态序列化性能问题

LangGraph 的核心卖点是"完整的状态机"——所有 Agent 的中间状态都被保存在 State 对象中，可以随时暂停和恢复。但当你的 Agent 运行 100 个循环，每个循环产生一条消息，而消息中包含大量上下文文本（比如 RAG 的检索结果），一个 State 对象可能膨胀到数十 MB。

**问题表现**：

```python
# 每一步都需要序列化完整的 State
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]  # 消息越来越多
    documents: list[str]                                   # 检索结果缓存
    intermediate_results: dict                             # 中间计算结果
    conversation_history: str                              # 对话历史文本

# checkpoint 存储成本：
# 第 1 步：State 大小 = 0.5 MB
# 第 10 步：State 大小 = 5 MB
# 第 100 步：State 大小 = 50 MB
# 总成本 = 0.5 + 1 + 1.5 + ... + 50 = ~1.3 GB（仅用于一个会话）

# 反映为性能指标：
# - 每次 checkpoint 写入 latency：+50-200ms
# - 每次 graph.invoke() 的数据库查询：+100-300ms
# - 内存占用：每个活跃会话 100+ MB
```

**优化方案**：

```python
from typing import Annotated, TypedDict
from pydantic import BaseModel
import json

# 方案 1：状态分层——核心状态 vs 历史状态

class CoreAgentState(TypedDict):
    """仅保存当前有用的状态"""
    current_messages: Annotated[list[BaseMessage], add_messages]  # 滑动窗口：最近 10 条
    current_plan: str | None
    current_tool_call: dict | None

class HistoryState(BaseModel):
    """历史数据单独存储，不参与序列化"""
    all_messages: list[dict]  # 存到 PostgreSQL
    checkpoint_id: str

# 方案 2：消息压缩——用消息摘要替代完整文本

def compress_messages(messages: list[BaseMessage]) -> list[BaseMessage]:
    """在 checkpoint 前压缩消息"""
    if len(messages) > 20:
        # 前 15 条做摘要
        old_messages = messages[:15]
        summary_text = llm.invoke(
            f"总结以下对话的关键点:\n{[m.content for m in old_messages]}"
        )
        return [
            SystemMessage(content=f"[对话摘要] {summary_text}"),
            *messages[15:]  # 保留最近的消息
        ]
    return messages

# 使用压缩
def agent_node(state: CoreAgentState) -> dict:
    """推理节点 — 在返回前压缩消息"""
    messages = state["current_messages"]
    response = llm.invoke(messages)

    # 如果消息堆积，压缩后再返回
    compressed = compress_messages(messages + [response])
    return {"current_messages": compressed}

# 方案 3：选择性 checkpoint——不是每一步都保存

from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()
graph = graph_builder.compile(checkpointer=checkpointer)

# 每 5 步保存一次（而不是每一步）
# 通过自定义 reducer 实现
config = {
    "configurable": {
        "thread_id": "user-123",
        "checkpoint_interval": 5  # 每 5 步保存
    }
}
result = graph.invoke({"current_messages": [...]}, config)

# 方案 4：状态分片——大状态拆分为多个 Redis key

class DistributedState(TypedDict):
    """用指针替代大对象"""
    messages_version: str  # "session-123:messages:v42" → Redis key
    plan_version: str      # "session-123:plan:v5" → Redis key

def load_messages(version_key: str) -> list[BaseMessage]:
    """动态加载，而不是全量存储"""
    return redis.get(version_key)  # 从外部存储拉取

# 在 agent_node 中：
def agent_node(state: DistributedState) -> dict:
    messages = load_messages(state["messages_version"])
    response = llm.invoke(messages)

    # 存储新消息到 Redis，State 中仅保存引用
    new_version = f"session-{session_id}:messages:v{version+1}"
    redis.set(new_version, serialize(messages + [response]))

    return {"messages_version": new_version}
```

### 9.2 Checkpoint 存储成本与膨胀

当 Agent 处理长会话（比如一个用户与系统交互了 1000 次），checkpoint 的存储成本会变成一个显著的问题。

**成本分析**：

```
假设：
- 平均 State 大小：2 MB
- Checkpoint 间隔：每 5 步保存一次
- 长会话：1000 步

成本 = (1000 / 5) × 2 MB = 400 MB / 会话
对于 10,000 活跃用户 = 4 TB 存储成本
对于 PostgreSQL，这意味着 ~$1000/月 的数据库成本
```

**解决方案**：

```python
# 方案 1：差量存储（Delta Checkpoint）
# 仅存储与上一个 checkpoint 的差异

class DeltaCheckpoint:
    def __init__(self, db):
        self.db = db

    def get(self, thread_id: str, checkpoint_id: str):
        """重构状态"""
        current = checkpoint_id
        deltas = []
        while current:
            delta = self.db.get(f"{thread_id}:{current}:delta")
            if not delta:
                break
            deltas.append(delta)
            current = delta.get("parent_checkpoint")

        # 从最老的 checkpoint 开始，逐步应用 delta
        state = self.db.get(f"{thread_id}:{current}:full")
        for delta in reversed(deltas):
            state.update(delta["changes"])
        return state

    def save(self, thread_id: str, checkpoint_id: str, state: dict, prev_checkpoint_id: str):
        """仅存储变化部分"""
        if prev_checkpoint_id:
            prev_state = self.get(thread_id, prev_checkpoint_id)
            delta = {field: state[field] for field in state
                     if state[field] != prev_state.get(field)}
            self.db.set(
                f"{thread_id}:{checkpoint_id}:delta",
                {"changes": delta, "parent_checkpoint": prev_checkpoint_id}
            )
        else:
            # 首个 checkpoint，存储完整状态
            self.db.set(f"{thread_id}:{checkpoint_id}:full", state)

# 方案 2：过期 checkpoint 自动清理

import time
from datetime import datetime, timedelta

def cleanup_old_checkpoints(thread_id: str, keep_days: int = 7):
    """定期清理超过 N 天的 checkpoint"""
    cutoff_time = datetime.now() - timedelta(days=keep_days)

    for checkpoint_id in db.list_checkpoints(thread_id):
        checkpoint_time = datetime.fromtimestamp(
            db.get_checkpoint_timestamp(thread_id, checkpoint_id)
        )
        if checkpoint_time < cutoff_time:
            db.delete(f"{thread_id}:{checkpoint_id}")

# 定期执行（比如每晚 3 点）
scheduler.add_job(
    cleanup_old_checkpoints,
    args=["*", 7],
    trigger="cron",
    hour=3,
    minute=0
)

# 方案 3：分层存储策略

class TieredCheckpointStorage:
    def __init__(self, hot_storage, cold_storage):
        self.hot = hot_storage    # Redis（快，贵）
        self.cold = cold_storage  # S3（慢，便宜）

    def get(self, thread_id: str, checkpoint_id: str):
        # 先查热存储（Redis）
        hot_data = self.hot.get(f"{thread_id}:{checkpoint_id}")
        if hot_data:
            return hot_data

        # 再查冷存储（S3）
        cold_data = self.cold.get(f"{thread_id}/{checkpoint_id}")
        if cold_data:
            # 热化（放回 Redis）
            self.hot.set(f"{thread_id}:{checkpoint_id}", cold_data, expire=3600)
            return cold_data

        raise CheckpointNotFound()

    def save(self, thread_id: str, checkpoint_id: str, state: dict, is_final: bool):
        if is_final:
            # 最终 checkpoint 放热存储
            self.hot.set(f"{thread_id}:{checkpoint_id}", state, expire=86400)  # 1 天过期
        else:
            # 中间 checkpoint 放冷存储（仅用于 time-travel 调试）
            self.cold.set(f"{thread_id}/{checkpoint_id}", state)
```

### 9.3 复杂图结构的调试困难

当 Graph 包含多个条件边、并行节点、子图嵌套时，调试变成了一场噩梦——你能看到"Agent 执行了 100 步后卡住了"，但不知道到底卡在了哪个条件分支上。

**问题案例**：

```python
# 一个复杂的多 Agent 协作图
graph_builder = StateGraph(TeamState)

# 5 个节点
graph_builder.add_node("supervisor", supervisor_node)
graph_builder.add_node("researcher", researcher_node)
graph_builder.add_node("coder", coder_node)
graph_builder.add_node("reviewer", reviewer_node)
graph_builder.add_node("human_approval", human_approval_node)

# 10 条边，其中 5 条是条件边
graph_builder.add_conditional_edges("supervisor", route_supervisor, {...})
graph_builder.add_conditional_edges("researcher", route_researcher, {...})
# ... 更多条件边

# 现在，如果执行卡住了：
# - 你不知道执行当前停在哪个节点
# - 你不知道上一个条件边是如何评估的
# - 你不知道当前 State 的哪个字段导致了这个路由决策

result = graph.invoke({...})  # 卡住！
```

**解决方案**：

```python
# 方案 1：完整的执行追踪

from typing import Optional
import logging
import json
from datetime import datetime

class ExecutionTracer:
    def __init__(self):
        self.events = []

    def record_node_entry(self, node_name: str, state: dict, timestamp: Optional[float] = None):
        """记录节点进入"""
        self.events.append({
            "type": "node_entry",
            "node": node_name,
            "timestamp": timestamp or datetime.now().isoformat(),
            "state_keys": list(state.keys()),  # 哪些 State 字段存在
            "state_sizes": {k: len(json.dumps(v)) for k, v in state.items()}  # 每个字段大小
        })

    def record_node_exit(self, node_name: str, result: dict, latency_ms: float):
        """记录节点退出"""
        self.events.append({
            "type": "node_exit",
            "node": node_name,
            "latency_ms": latency_ms,
            "result_keys": list(result.keys()),
            "timestamp": datetime.now().isoformat()
        })

    def record_edge_evaluation(self, from_node: str, edge_name: str, condition_value: str):
        """记录条件边的评估结果"""
        self.events.append({
            "type": "conditional_edge",
            "from": from_node,
            "edge": edge_name,
            "condition_value": condition_value,  # 例如 "tools" 或 "end"
            "timestamp": datetime.now().isoformat()
        })

    def record_error(self, node_name: str, error: Exception, traceback: str):
        """记录错误"""
        self.events.append({
            "type": "error",
            "node": node_name,
            "error_type": type(error).__name__,
            "error_msg": str(error),
            "traceback": traceback,
            "timestamp": datetime.now().isoformat()
        })

    def get_execution_flow(self):
        """输出可视化的执行流"""
        flow = []
        for event in self.events:
            if event["type"] == "node_entry":
                flow.append(f"→ [{event['node']}] (State keys: {event['state_keys']})")
            elif event["type"] == "node_exit":
                flow.append(f"  ✓ {event['latency_ms']}ms")
            elif event["type"] == "conditional_edge":
                flow.append(f"  ▶ [{event['edge']}] → {event['condition_value']}")
            elif event["type"] == "error":
                flow.append(f"  ✗ ERROR in {event['node']}: {event['error_msg']}")
        return "\n".join(flow)

# 集成到 graph 的节点

tracer = ExecutionTracer()

def traced_agent_node(state: AgentState, tracer: ExecutionTracer) -> dict:
    node_name = "agent"
    tracer.record_node_entry(node_name, state)

    start = time.time()
    try:
        response = llm.invoke(state["messages"])
        latency = (time.time() - start) * 1000
        tracer.record_node_exit(node_name, {"messages": [response]}, latency)
        return {"messages": [response]}
    except Exception as e:
        tracer.record_error(node_name, e, traceback.format_exc())
        raise

def traced_should_continue(state: AgentState, tracer: ExecutionTracer) -> str:
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        result = "tools"
    else:
        result = "end"

    tracer.record_edge_evaluation("agent", "should_continue", result)
    return result

# 使用 tracer
result = graph.invoke({"messages": [...]})
print(tracer.get_execution_flow())

# 输出示例：
# → [agent] (State keys: ['messages'])
#   ✓ 450ms
#   ▶ [should_continue] → tools
# → [tools] (State keys: ['messages'])
#   ✓ 200ms
#   ▶ [route_tools] → agent
# → [agent] (State keys: ['messages'])
#   ✗ ERROR in agent: maximum recursion depth exceeded

# 方案 2：条件边的显式日志

def should_continue_with_debug(state: AgentState) -> str:
    last_message = state["messages"][-1]
    has_tool_calls = hasattr(last_message, "tool_calls") and last_message.tool_calls

    logger.debug(
        "Edge evaluation",
        extra={
            "node": "agent",
            "edge": "should_continue",
            "last_message_type": type(last_message).__name__,
            "has_tool_calls": has_tool_calls,
            "tool_calls": getattr(last_message, "tool_calls", None),
            "message_content_length": len(str(last_message.content))
        }
    )

    return "tools" if has_tool_calls else "end"

# 在日志中搜索 "Edge evaluation" 可以看到每个条件边的决策过程
```

### 9.4 版本升级的 Breaking Change 风险

LangGraph 相比 LangChain 的版本稳定性更好，但仍然会发生重大变化。特别是当新模型或新功能出现时，框架的 API 可能会调整。

**历史案例**：

```
LangGraph v0.1 → v0.2：
- StateGraph 的 add_edge 签名改变（streaming 参数被移除）
- Checkpoint 的序列化格式变更（旧 checkpoint 不兼容）
- ToolNode 的返回格式改变

LangGraph v0.2 → v0.3：
- Annotated reducer 的行为变更（add_messages 的合并策略不同）
- 图的编译方式改变（需要指定 checkpointer）
```

**防御策略**：

```python
# 方案 1：版本锁定 + 定期升级计划

# requirements.txt
langchain-core==0.3.25  # 精确版本
langgraph==0.2.45

# 而不是
langchain-core>=0.3.0
langgraph>=0.2.0

# 定期评估升级（比如每季度一次）
# - 测试新版本的 breaking changes
# - 准备迁移脚本

# 方案 2：Adapter 层隔离框架 API

from typing import Callable, Any

class LangGraphAdapter:
    """隔离框架 API 的适配层"""

    @staticmethod
    def create_state_graph(state_class):
        """屏蔽不同版本的 StateGraph 创建方式"""
        from langgraph.graph import StateGraph
        return StateGraph(state_class)

    @staticmethod
    def compile_graph(graph_builder, checkpointer=None):
        """屏蔽不同版本的编译参数"""
        try:
            # v0.3+ API
            return graph_builder.compile(checkpointer=checkpointer)
        except TypeError:
            # v0.2 API（没有 checkpointer 参数）
            graph = graph_builder.compile()
            if checkpointer:
                # 手动附加 checkpointer
                graph.checkpointer = checkpointer
            return graph

    @staticmethod
    def invoke_graph(graph, input_data, config=None):
        """屏蔽不同版本的 invoke 签名"""
        try:
            return graph.invoke(input_data, config)
        except TypeError:
            # 旧版本 API
            return graph.invoke(input_data)

# 在业务代码中，使用 adapter 而不是直接调用框架
class MyAgent:
    def __init__(self):
        self.graph = LangGraphAdapter.create_state_graph(AgentState)
        # ... 添加节点和边 ...
        self.compiled_graph = LangGraphAdapter.compile_graph(self.graph)

    def run(self, input_data):
        return LangGraphAdapter.invoke_graph(self.compiled_graph, input_data)

# 升级时，只需修改 LangGraphAdapter 而不是所有依赖的代码

# 方案 3：Checkpoint 格式兼容性

class BackwardCompatibleCheckpointer:
    """向后兼容的 checkpoint 管理"""

    def __init__(self, db):
        self.db = db
        self.SCHEMA_VERSION = "1"

    def get(self, thread_id: str, checkpoint_id: str):
        data = self.db.get(f"{thread_id}:{checkpoint_id}")

        if data["schema_version"] == "0":
            # 从旧格式迁移
            return self._migrate_from_v0(data)
        elif data["schema_version"] == "1":
            return data["state"]
        else:
            raise ValueError(f"Unknown schema version: {data['schema_version']}")

    def put(self, thread_id: str, checkpoint_id: str, state: dict):
        self.db.set(
            f"{thread_id}:{checkpoint_id}",
            {
                "schema_version": self.SCHEMA_VERSION,
                "state": state,
                "timestamp": datetime.now().isoformat()
            }
        )

    def _migrate_from_v0(self, v0_data: dict) -> dict:
        """从 v0 格式升级"""
        # 重新映射字段名、数据类型等
        return {
            "messages": v0_data.get("message_history", []),
            "plan": v0_data.get("current_plan"),
            # ...
        }
```

---

## 10. 其他框架深度对比

前面我们在 5.2 节给出了各框架的简要点评。现在用更深入的代码对比和量化评估来补充。

### 10.1 同一任务的代码实现对比

**任务描述**：构建一个"多角色团队报告生成系统"。团队包括 Researcher（搜索信息）、Analyst（分析数据）、Writer（撰写报告）三个角色，分别负责不同的任务阶段。最后由一个 Supervisor 决定流程。

**用 CrewAI 实现**：

```python
from crewai import Agent, Task, Crew, LLM

# CrewAI：核心抽象是 Agent 和 Task
# 特点：声明式、角色导向、任务驱动

llm = LLM(model="gpt-4o")

researcher = Agent(
    role="Research Specialist",
    goal="Find accurate and relevant information",
    backstory="You are an expert researcher with 20 years of experience.",
    tools=[search_tool, browser_tool],
    llm=llm,
)

analyst = Agent(
    role="Data Analyst",
    goal="Extract insights from raw information",
    backstory="You excel at finding patterns and correlations in data.",
    tools=[analysis_tool],
    llm=llm,
)

writer = Agent(
    role="Report Writer",
    goal="Create compelling and well-structured reports",
    backstory="You are a professional writer with a clear, engaging style.",
    llm=llm,
)

# 定义任务
research_task = Task(
    description="Research the topic: {topic}. Find at least 5 credible sources.",
    expected_output="A summary of key findings with sources",
    agent=researcher,
)

analysis_task = Task(
    description="Analyze the findings: {research_findings}. Identify key insights.",
    expected_output="A structured analysis with metrics and insights",
    agent=analyst,
)

writing_task = Task(
    description="Write a professional report based on: {analysis}",
    expected_output="A complete, well-formatted report",
    agent=writer,
)

# 创建团队（任务顺序执行）
crew = Crew(
    agents=[researcher, analyst, writer],
    tasks=[research_task, analysis_task, writing_task],
    verbose=True,
)

# 运行
result = crew.kickoff(
    inputs={"topic": "The Future of AI in Healthcare"}
)
print(result)

# 代码特点：
# - 高度声明式：定义角色 → 定义任务 → 按顺序执行
# - 隐藏控制流：框架内部决定任务的执行顺序和 Agent 的交互
# - 代码简洁：上面的代码就能跑出一个完整的多 Agent 系统
# - 代价：缺乏灵活性（如果需要条件分支、并行执行或复杂的 Agent 间通信，不好处理）
```

**用 AutoGen 实现**：

```python
from autogen import AssistantAgent, UserProxyAgent, GroupChat, GroupChatManager

# AutoGen：核心抽象是 Agent 和 Conversation
# 特点：对话驱动、灵活的消息传递、支持代码执行

# 定义 Agent（每个 Agent 是一个自主的对话参与者）
researcher = AssistantAgent(
    name="Researcher",
    system_message="You are a research specialist. Your job is to find information.",
    llm_config={"model": "gpt-4o", "api_key": "..."}
)

analyst = AssistantAgent(
    name="Analyst",
    system_message="You are a data analyst. Extract insights from findings.",
    llm_config={"model": "gpt-4o", "api_key": "..."}
)

writer = AssistantAgent(
    name="Writer",
    system_message="You are a professional writer. Create well-structured reports.",
    llm_config={"model": "gpt-4o", "api_key": "..."}
)

# 人类用户代理（启动对话）
user_proxy = UserProxyAgent(
    name="User",
    human_input_mode="NEVER",  # 完全自动化
    code_execution_config={"use_docker": False}
)

# 定义群组对话（所有 Agent 共同参与）
groupchat = GroupChat(
    agents=[user_proxy, researcher, analyst, writer],
    messages=[],
    max_round=15,  # 最多 15 轮对话
    speaker_selection_method="round_robin",  # 轮流发言
)

# 创建对话管理器
manager = GroupChatManager(groupchat=groupchat, llm_config={})

# 启动对话
message = "Please research the topic 'The Future of AI in Healthcare', analyze the findings, and write a report."
user_proxy.initiate_chat(manager, message=message)

# 代码特点：
# - 对话驱动：Agent 通过自然语言消息交互，而不是任务分配
# - 更加灵活：Agent 间可以自由地讨论、辩论、协作
# - 代价：难以预测执行流程（Agent 可能陷入无限讨论）、调试困难

# AutoGen 更适合研究和实验，不太适合生产环境要求确定性的场景
```

**用 LangGraph 实现**：

```python
from typing import Annotated, TypedDict, Literal
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

# LangGraph：显式的状态机和控制流
# 特点：确定性、可观测、支持复杂的多步流程

class TeamState(TypedDict):
    topic: str
    research_findings: Annotated[list, add_messages]
    analysis_results: Annotated[list, add_messages]
    final_report: str

llm = ChatOpenAI(model="gpt-4o")

# 定义工具
search_tool = ...  # 搜索工具
analysis_tool = ...  # 分析工具

# 定义节点
def researcher_node(state: TeamState) -> dict:
    """研究节点"""
    prompt = f"Research the topic: {state['topic']}. Find at least 5 sources."
    response = llm.invoke(prompt)
    return {"research_findings": [response]}

def analyst_node(state: TeamState) -> dict:
    """分析节点"""
    findings_text = "\n".join(state["research_findings"])
    prompt = f"Analyze these findings:\n{findings_text}"
    response = llm.invoke(prompt)
    return {"analysis_results": [response]}

def writer_node(state: TeamState) -> dict:
    """写作节点"""
    analysis_text = "\n".join(state["analysis_results"])
    prompt = f"Write a professional report based on:\n{analysis_text}"
    response = llm.invoke(prompt)
    return {"final_report": response}

# 构建图
graph_builder = StateGraph(TeamState)

graph_builder.add_node("researcher", researcher_node)
graph_builder.add_node("analyst", analyst_node)
graph_builder.add_node("writer", writer_node)

# 线性流程：researcher → analyst → writer
graph_builder.add_edge(START, "researcher")
graph_builder.add_edge("researcher", "analyst")
graph_builder.add_edge("analyst", "writer")
graph_builder.add_edge("writer", END)

graph = graph_builder.compile()

# 运行
result = graph.invoke({
    "topic": "The Future of AI in Healthcare"
})
print(result["final_report"])

# 代码特点：
# - 显式控制流：清晰看到 researcher → analyst → writer 的流程
# - 确定性执行：与 AutoGen 的对话式不同，LangGraph 保证执行流程
# - 可观测性强：每个节点的输入输出都在 State 中追踪
# - 缺点：对于简单的线性流程，有点过度工程化
```

### 10.2 7 维度框架对比表

| 维度 | LangChain | LangGraph | CrewAI | AutoGen |
|------|-----------|-----------|--------|---------|
| **学习曲线** | 低 | 中 | 低 | 中高 |
| | 10 分钟上手 | 需理解状态机 | 声明式，易上手 | 对话概念需适应 |
| **灵活性** | 中 | 高 | 低 | 高 |
| | Chain 模型受限 | 任意拓扑图 | 任务顺序固定 | Agent 间自由交互 |
| **生产就绪度** | 中 | 高 | 中 | 低 |
| | 需自定义错误处理 | Checkpoint、可观测 | 可部署，但 Agent 行为难控 | 研究型，不适合生产 |
| **社区活跃度** | 极高 | 高 | 中等 | 中等 |
| | StackOverflow 答案多 | 官方文档维护好 | 中文教程多 | 学术社区活跃 |
| **文档质量** | 高 | 高 | 中等 | 中等 |
| | 官方文档详细 | 示例丰富 | 文档不够全面 | 学术风格 |
| **调试体验** | 差 | 中等 | 中等 | 差 |
| | 多层抽象遮蔽错误 | 图可视化、消息追踪 | 部分隐藏 | Agent 对话难追踪 |
| **企业支持** | 高（LangChain Inc.） | 高（同公司） | 中（CrewAI Inc.） | 低（学术项目） |
| | 商业化快、API 多变 | 产品稳定性更好 | 创业初期 | 无商业支持 |

**得分解释**：
- **学习曲线**：1-10，越低越容易
- **灵活性**：1-10，越高越灵活
- **生产就绪度**：能直接用于生产环境的程度
- **社区活跃度**：遇到问题能找到答案的概率
- **文档质量**：官方文档的详细程度和准确性
- **调试体验**：出错时能快速定位问题
- **企业支持**：有没有公司在后面维护和支持

---

## 11. 框架迁移实战案例：从 LangChain MVP 到 LangGraph 生产系统

这是一个真实的迁移故事（合成自多个项目的经历）。通过这个案例，你可以看到迁移的全貌、踩过的坑、解决的方案。

### 11.1 迁移背景与动机

**初始状态**（6 个月前）：

一个创业团队用 LangChain 在 3 周内搭建了一个"AI 产品推荐系统"的 MVP：

```python
# 原始 LangChain MVP
from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate
from langchain_community.tools.tavily_search import TavilySearchResults

llm = ChatOpenAI(model="gpt-4o")
tools = [TavilySearchResults(max_results=3)]

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a product recommendation expert."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# 运行
result = executor.invoke({"input": "我在寻找一款生产力工具，有什么推荐吗？"})
```

**产品获得初步成功后的现实问题**：

1. **可靠性差**：Agent 有时候陷入死循环，max_iterations=10 的硬限制导致用户看到不完整的回复
2. **可观测性差**：无法追踪 Agent 为什么做了某个决策；出错时只能看到最后一行错误信息
3. **性能问题**：大量并发请求时，AgentExecutor 内部的重试逻辑不够精细，导致 P99 latency > 10s
4. **难以集成**：无法与现有的企业工作流集成（需要在某个步骤人工审批）

### 11.2 迁移设计

**迁移的目标**：

- ✓ 保持现有功能不变（对用户无感）
- ✓ 支持 Human-in-the-Loop（在推荐执行前需要人工审批）
- ✓ 完整的可观测性（每一步的决策都被记录）
- ✓ 更精细的性能控制（P99 latency < 2s）

**迁移策略**：

1. **分阶段迁移**：第 1 周改用 LangGraph，第 2 周添加 Human-in-the-Loop，第 3 周性能优化和上线
2. **保持 API 兼容**：用 Adapter 包装新的 LangGraph 实现，对外暴露相同的接口
3. **A/B 测试**：并行运行两个系统 1 周，验证结果一致性

### 11.3 迁移步骤与代码

**步骤 1：定义新的 State 结构**

```python
from typing import Annotated, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage
from langgraph.graph.message import add_messages
from datetime import datetime

class RecommendationState(TypedDict):
    # 用户输入
    user_query: str
    user_id: str

    # 消息历史
    messages: Annotated[list[BaseMessage], add_messages]

    # 推荐结果
    product_recommendations: list[dict]
    reasoning: str

    # 工具调用结果
    search_results: list[dict]

    # 审批流程
    needs_human_approval: bool
    approval_status: str | None  # "pending", "approved", "rejected"
    reviewer_id: str | None

    # 可观测性字段
    execution_trace: list[dict]  # 记录每一步
    start_time: float
```

**步骤 2：实现 Adapter 层保持 API 兼容**

```python
# adapter.py - 对外暴露相同的 API，内部用 LangGraph

from typing import Optional
import asyncio
import time
from datetime import datetime

class ProductRecommendationAgent:
    """与原 LangChain 版本 API 兼容的 Wrapper"""

    def __init__(self, graph):
        self.graph = graph
        self.llm = ChatOpenAI(model="gpt-4o")
        self.tools = [TavilySearchResults(max_results=3)]

    def invoke(self, input_dict: dict) -> dict:
        """
        与原 AgentExecutor.invoke() 兼容的接口
        """
        user_input = input_dict["input"]
        user_id = input_dict.get("user_id", "anonymous")

        # 初始化 State
        initial_state = {
            "user_query": user_input,
            "user_id": user_id,
            "messages": [HumanMessage(content=user_input)],
            "product_recommendations": [],
            "reasoning": "",
            "search_results": [],
            "needs_human_approval": False,
            "approval_status": None,
            "reviewer_id": None,
            "execution_trace": [],
            "start_time": time.time()
        }

        # 运行 LangGraph
        config = {"configurable": {"thread_id": user_id}}
        final_state = self.graph.invoke(initial_state, config)

        # 转换回与原 API 兼容的格式
        return {
            "output": final_state["reasoning"],  # 对应原 AgentExecutor 的 output 字段
            "recommendations": final_state["product_recommendations"],
            "trace": final_state["execution_trace"],  # 额外的可观测性
        }

    async def ainvoke(self, input_dict: dict) -> dict:
        """异步版本"""
        return await asyncio.to_thread(self.invoke, input_dict)

# 原始代码可以保持不变：
# executor = ProductRecommendationAgent(graph)
# result = executor.invoke({"input": "...", "user_id": "user-123"})
# print(result["output"])
```

**步骤 3：实现 LangGraph 的节点**

```python
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode
from langgraph.graph.message import add_messages
from langchain_core.tools import tool
import json

@tool
def search_products(query: str) -> str:
    """搜索产品信息"""
    search_tool = TavilySearchResults(max_results=3)
    results = search_tool.invoke(query)
    return json.dumps(results)

tools = [search_products]
tool_node = ToolNode(tools)

llm = ChatOpenAI(model="gpt-4o").bind_tools(tools)

def recommend_node(state: RecommendationState) -> dict:
    """推荐节点：LLM 分析用户需求并搜索产品"""
    # 记录进入时间
    state["execution_trace"].append({
        "node": "recommend",
        "timestamp": datetime.now().isoformat(),
        "state_keys": list(state.keys())
    })

    # 构造提示
    system_prompt = """你是一个产品推荐专家。
根据用户的需求，搜索相关产品，分析它们的优缺点，给出推荐。
可以使用搜索工具来查询产品信息。"""

    messages = [
        {"role": "system", "content": system_prompt},
        *state["messages"]
    ]

    # 调用 LLM（可能会触发工具调用）
    response = llm.invoke(messages)

    return {
        "messages": [response],
        "execution_trace": state["execution_trace"] + [{
            "node": "recommend",
            "action": "llm_response",
            "has_tool_calls": bool(getattr(response, "tool_calls", None))
        }]
    }

def should_search(state: RecommendationState) -> str:
    """条件路由：是否需要搜索"""
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "search"  # 有工具调用 → 执行搜索
    return "approve"      # 无工具调用 → 进入审批

def approval_node(state: RecommendationState) -> dict:
    """审批节点：标记需要人工审批"""
    last_message = state["messages"][-1]

    # 解析最后一条消息中的推荐结果
    recommendations = parse_recommendations(last_message.content)

    return {
        "product_recommendations": recommendations,
        "needs_human_approval": True,
        "reasoning": last_message.content,
        "approval_status": "pending",
        "execution_trace": state["execution_trace"] + [{
            "node": "approval",
            "action": "marked_for_approval",
            "recommendations_count": len(recommendations)
        }]
    }

def parse_recommendations(content: str) -> list[dict]:
    """从 LLM 的输出中解析推荐结果"""
    # 这里使用 LLM 来结构化输出
    parse_llm = ChatOpenAI(model="gpt-4o")
    response = parse_llm.invoke(
        f"Extract product recommendations from this text. Return JSON array with fields: name, pros, cons, rating.\n\n{content}"
    )
    try:
        return json.loads(response.content)
    except:
        return []

# 构建图
graph_builder = StateGraph(RecommendationState)

graph_builder.add_node("recommend", recommend_node)
graph_builder.add_node("search", tool_node)
graph_builder.add_node("approval", approval_node)

graph_builder.add_edge(START, "recommend")
graph_builder.add_conditional_edges(
    "recommend",
    should_search,
    {"search": "search", "approve": "approval"}
)
graph_builder.add_edge("search", "recommend")  # 搜索后回到推荐
graph_builder.add_edge("approval", END)

graph = graph_builder.compile()
```

**步骤 4：添加 Human-in-the-Loop 支持**

```python
from langgraph.checkpoint.postgres import PostgresSaver
from contextlib import asynccontextmanager

# 使用 PostgreSQL 持久化 checkpoint
checkpointer = PostgresSaver.from_conn_string(
    "postgresql://user:password@localhost/langraph_db"
)

graph_with_checkpoint = graph_builder.compile(checkpointer=checkpointer)

class ApprovalManager:
    def __init__(self, graph):
        self.graph = graph
        self.db = ApprovalDB()  # 自定义的审批数据库

    async def wait_for_approval(self, thread_id: str, timeout_seconds: int = 3600) -> bool:
        """
        等待人工审批

        使用场景：
        1. Agent 在需要人工确认的步骤前暂停
        2. 人类审批后，Agent 继续执行
        """
        start_time = time.time()

        # 定期检查审批状态
        while time.time() - start_time < timeout_seconds:
            approval = self.db.get_approval_status(thread_id)

            if approval and approval["status"] == "approved":
                return True
            elif approval and approval["status"] == "rejected":
                return False

            await asyncio.sleep(5)  # 每 5 秒检查一次

        # 超时
        raise TimeoutError(f"Approval timeout for thread {thread_id}")

    async def resume_execution(self, thread_id: str, approval_decision: bool):
        """
        人工审批后，恢复执行
        """
        # 更新 approval_status
        config = {"configurable": {"thread_id": thread_id}}

        # 从 checkpoint 恢复，继续执行
        # LangGraph 会从上次中断的地方继续
        result = await asyncio.to_thread(
            self.graph.invoke,
            {"approval_status": "approved" if approval_decision else "rejected"},
            config
        )

        return result

# 使用示例
approval_manager = ApprovalManager(graph_with_checkpoint)

async def handle_recommendation_request(user_id: str, query: str):
    """处理推荐请求，在审批点暂停"""

    initial_state = {
        "user_query": query,
        "user_id": user_id,
        "messages": [HumanMessage(content=query)],
        # ... 其他字段
    }

    config = {"configurable": {"thread_id": user_id}}

    # 运行直到需要审批（在 approval_node 前暂停）
    # 这需要在 graph 的构建中指定 interrupt_before=["approval"]

    # 暂停在审批之前
    try:
        result = await asyncio.to_thread(
            graph_with_checkpoint.invoke,
            initial_state,
            config
        )
    except GraphInterruptException:
        # 执行暂停了，等待人工审批
        print(f"Waiting for human approval (thread: {user_id})")

        approved = await approval_manager.wait_for_approval(user_id)

        if approved:
            # 恢复执行
            final_result = await approval_manager.resume_execution(user_id, True)
            return final_result
        else:
            return {"error": "Approval rejected"}
```

### 11.4 迁移过程中遇到的问题和解决方案

**问题 1：状态字段类型变化**

原 LangChain 版本中，消息列表被隐式管理。迁移到 LangGraph 后，需要显式定义所有状态。

```python
# 问题：原来的消息是 list[dict]，现在是 list[BaseMessage]
# 结果：存储在数据库的数据格式不兼容

# 解决方案：数据迁移脚本
def migrate_message_format():
    """将旧格式的消息转换为新格式"""
    old_messages = db.query("SELECT * FROM conversation_history")

    for old_msg in old_messages:
        if old_msg["role"] == "user":
            new_msg = HumanMessage(content=old_msg["content"])
        elif old_msg["role"] == "assistant":
            new_msg = AIMessage(content=old_msg["content"])
        else:
            new_msg = ToolMessage(content=old_msg["content"], tool_call_id=old_msg["tool_id"])

        # 保存新格式
        db.save_message(old_msg["session_id"], new_msg)
```

**问题 2：工具调用格式的差异**

LangChain 使用 `tool_calls` 列表，LangGraph 的 `ToolNode` 期望特定的格式。

```python
# 问题：两个框架对 tool_calls 的处理方式不同
# LangChain: response.tool_calls = [{"type": "tool_use", "id": "...", "name": "...", "input": {...}}]
# LangGraph: 需要 AIMessage.tool_calls 包含 ToolCall 对象

# 解决方案：在 Adapter 中转换格式
def convert_tool_calls(langchain_response):
    """将 LangChain 格式的工具调用转换为 LangGraph 格式"""
    from langchain_core.messages import tool_call

    converted_calls = []
    for call in langchain_response.tool_calls:
        converted_calls.append(
            tool_call(
                name=call["name"],
                args=call["input"],
                id=call["id"],
                type="tool_use"
            )
        )

    return converted_calls
```

**问题 3：错误处理的变化**

LangChain 的 AgentExecutor 有内置的错误恢复；LangGraph 需要显式处理。

```python
# 问题：当工具调用失败时，需要新的处理逻辑

# 解决方案：增加错误处理节点
def tool_error_handler(state: RecommendationState) -> dict:
    """处理工具调用错误"""
    last_message = state["messages"][-1]

    if isinstance(last_message, ToolMessage) and last_message.status == "error":
        # 工具执行失败，尝试恢复
        recovery_prompt = f"""
前一次工具调用失败：{last_message.content}
请尝试其他方法或给出错误提示。"""

        recovery_response = llm.invoke(recovery_prompt)

        return {
            "messages": [recovery_response],
            "execution_trace": state["execution_trace"] + [{
                "node": "error_handler",
                "error": last_message.content
            }]
        }

    return state
```

### 11.5 性能对比：迁移前后

**测试场景**：100 个并发用户，每个用户发送一个推荐请求。

| 指标 | LangChain MVP | LangGraph 生产 | 改进 |
|------|--------------|---------------|------|
| **P50 Latency** | 1.2s | 0.8s | ↓ 33% |
| **P99 Latency** | 8.5s | 2.1s | ↓ 75% |
| **错误率** | 2.3% | 0.1% | ↓ 95% |
| **内存占用/会话** | 15 MB | 3 MB | ↓ 80% |
| **可观测性** | 无 | 完整 trace | 新增 |

**性能改进的原因**：

1. **状态序列化优化**：LangGraph 的 message reducer 对消息列表做了优化，避免了每次都序列化整个历史
2. **更精细的并发控制**：LangChain 的 max_iterations 是硬限制，容易导致重试浪费；LangGraph 的条件路由更高效
3. **Checkpoint 的增量存储**：旧系统每一步都保存整个状态，新系统只保存变化部分

### 11.6 迁移后的教训

1. **Adapter 层的价值**：通过适配层，成功地在完全替换底层实现的情况下保持了 API 兼容。这让迁移风险大幅降低。

2. **测试的关键性**：迁移前建立完整的测试套件（单元测试、集成测试、性能测试），迁移后逐个通过测试，确保功能等价性。

3. **可观测性必须前置规划**：在迁移设计阶段就要考虑可观测性需求（execution_trace、checkpoint 等），而不是事后补充。

4. **分阶段上线**：先用新系统处理 10% 的流量，监控 1 周后再扩大到 100%，给问题发现和修复留足时间。

---

## 12. LLM 原生推理能力对框架设计的影响

过去一年，AI 模型的能力在发生根本性的变化。o1、o3 等推理模型不再是"快速推理"的助手，而是有能力做多步推理的"思考者"。这对 Agent 框架设计意味着什么？

### 12.1 规划模块还有必要吗？

在传统 Agent 架构中，规划（Planning）是一个独立的步骤：

```
感知 → 规划 → 决策 → 行动 → 观察 → 反思
```

规划的作用是："给定当前状态和目标，生成一个步骤序列"。这种规划通常由 LLM 完成，比如 ReAct 模式的"Think"步骤或 Chain-of-Thought。

**新问题**：当模型原生支持深度推理时，我们是否还需要框架帮我们做规划？

```python
# 传统 Agent：显式规划
def plan_node(state):
    """规划节点：生成步骤"""
    plan_prompt = f"""
    目标：{state['goal']}
    可用工具：{list(state['tools'].keys())}

    请制定一个步骤计划。返回 JSON 格式：
    {{"steps": ["step1", "step2", "step3"]}}
    """
    plan = llm.invoke(plan_prompt)
    return {"plan": plan["steps"]}

def execute_plan_node(state):
    """执行计划"""
    for i, step in enumerate(state["plan"]):
        tool_call = route_step_to_tool(step)
        result = execute_tool(tool_call)
        state["results"].append(result)
    return state

# 新时代：让模型自己思考
def reasoning_node(state):
    """推理节点：模型深度思考后给出结论"""
    reasoning_prompt = f"""
    目标：{state['goal']}
    可用工具：{json.dumps(state['available_tools'])}

    请深入思考这个问题。你可以使用工具来收集信息。
    最终给出最优的解决方案。
    """

    # 使用 o1/o3 模型进行深度推理
    result = deepthinking_model.invoke(
        reasoning_prompt,
        tools=state["available_tools"],
        thinking_budget=30000  # 允许 30000 tokens 的思考时间
    )

    # 模型不仅给出答案，还给出完整的推理过程
    return {
        "thinking_process": result.thinking,
        "final_answer": result.content,
        "tool_calls": result.tool_calls  # 模型自己决定是否需要工具
    }
```

**关键洞察**：

当模型能够原生推理时，**规划和执行可以合并**。框架不再需要为模型规划步骤，而只需要：

1. 提供工具接口（让模型知道有什么工具可用）
2. 执行工具调用（模型决定调用什么）
3. 反馈结果（模型继续推理）

这意味着 Agent 框架可以从"多步编排者"简化为"工具调用执行器"。

### 12.2 ReAct Loop 的简化可能

ReAct（Reasoning + Acting）模式要求 Agent 在每个循环中：

```
Think (生成思路) → Act (选择工具) → Observe (看工具结果) → Reflect (反思) → 循环
```

这种明确的循环结构是为了应对"早期 LLM 推理能力不足"的问题。

**问题**：当一个调用可以包含完整的思考过程时，我们还需要这个显式循环吗？

```python
# 传统 ReAct Loop
def react_loop(state):
    while True:
        # Think
        thought = llm.invoke(f"Thought: {state['observation']}")

        # Act
        action = parse_action(thought)
        result = execute_action(action)

        # Observe
        state['observation'] = result

        # Reflect
        if should_stop(state):
            break

    return state["observation"]

# 简化后的推理模式
def reasoning_once(state):
    """一次调用，模型完成所有推理"""

    # 传递完整的 context，让模型自己推理多步
    prompt = f"""
    问题：{state['problem']}
    已知信息：{state['known_facts']}
    可用工具：{state['tool_descriptions']}

    请思考这个问题的解决方案。必要时使用工具获取信息。
    """

    response = deepthinking_model.invoke(
        prompt,
        tools=state["tools"]
    )

    # 模型已经完成了多步推理，直接返回结果
    # 不需要 while 循环
    return {
        "answer": response.content,
        "thinking": response.thinking,
        "tool_calls": response.tool_calls
    }
```

**关键变化**：

- **从循环到一次性**：从 while 循环的多步推理，变为一次调用的完整推理
- **从显式步骤到隐式步骤**：步骤仍然存在，但在模型内部，不在框架外部
- **框架从"编排器"变为"执行器"**：框架不再在每一步做决策，而只是执行模型的决策

**代码体积的变化**：

```
原 ReAct 框架实现：
- 状态管理：100 行
- 循环控制：50 行
- 工具调用：80 行
- 消息管理：100 行
- 总计：~330 行

新推理模型时代：
- 工具执行：50 行
- 结果反馈：30 行
- 总计：~80 行

简化了 75%！
```

### 12.3 框架从"编排推理"转向"编排行动"的趋势

**历史的三个阶段**：

![框架演进三阶段](/images/blog/agentic-12/framework-evolution-phases.svg)

三个阶段的核心变化：框架从"编排一切"（LangChain 时代，~330 行代码），到"编排控制流"（LangGraph 时代，~200 行），再到"编排行动"（推理模型时代，~80 行，简化 75%）。框架越来越轻，模型承担的推理职责越来越重。

**代码示例：不同阶段框架的设计**

```python
# === 阶段 1：LangChain 风格 ===
class ChainAgent:
    def run(self, query):
        # 框架在这里做了很多决策
        thought = self.llm.think(query)
        plan = self.llm.plan(thought)
        for step in plan:
            action = self.llm.decide_action(step)
            result = self.execute_action(action)
            observation = self.process_result(result)
        return self.llm.summarize(observation)

# === 阶段 2：LangGraph 风格 ===
class GraphAgent:
    def __init__(self):
        self.graph = self._build_graph()

    def _build_graph(self):
        g = StateGraph(State)
        g.add_node("llm", llm_node)
        g.add_node("tool", tool_node)
        g.add_conditional_edges("llm", should_continue, ...)
        return g

    def run(self, query):
        return self.graph.invoke({"query": query})

# === 阶段 3：推理模型风格 ===
class ReasoningAgent:
    def run(self, query):
        # 框架极其简单
        response = self.reasoning_model.invoke(
            query,
            tools=self.tools
        )

        # 执行模型决定的工具调用
        for tool_call in response.tool_calls:
            result = self.tools[tool_call.name](tool_call.args)
            # 反馈给模型，让它继续推理
            response = self.reasoning_model.continue_reasoning(result)

        return response.content
```

### 12.4 对框架设计的启示

**推论 1：框架会变得更小**

随着模型能力增强，框架需要做的智能决策变少。今天的 500 行框架代码，明天可能只需要 100 行。

**推论 2：框架的核心会转移**

- **今天**：框架做推理编排（ReAct 循环、规划、决策）
- **明天**：框架做工具生态和可观测性

工具生态（Tool Registry、Tool Discovery）和可观测性（Tracing、Logging）会变成框架的核心卖点，而不是控制流编排。

**推论 3：协议会比框架更重要**

当每个模型都能做复杂推理时，框架对模型的"指导"变少了。取而代之，**协议**（如何声明工具、如何反馈结果、如何处理多轮交互）变得更重要。

这正是 MCP（Model Context Protocol）的角色——定义一个标准协议，让任何模型都能与任何工具交互。

**推论 4：自研 vs 框架的决策会改变**

```
今天：
- 自研一个生产级 Agent Runtime 需要 2-3 个月（需要实现推理、规划、控制流等）
- 用框架可以在 1 周内 MVP

明天：
- 自研一个生产级 Agent 工具执行器可能只需要 1 周（只需要执行工具调用）
- 框架的优势会缩小
```

这意味着长期来看，自研的成本会下降，框架的竞争优势会被压缩。生存下来的框架将是那些在**工具生态**和**可观测性**上做得最好的。

### 12.5 对我们的建议

**立即行动**：

1. **不要过度依赖当前框架的推理能力**。学习框架的设计思想（状态管理、控制流）比依赖框架的具体 API 更重要。

2. **关注推理模型的能力变化**。当你的模型能原生推理时，简化你的 Agent 架构。删除不必要的规划和循环。

3. **投资工具生态**。无论框架如何演变，工具集成始终是 Agent 系统的核心。学习如何定义、发现、执行工具。

4. **为协议化做准备**。下一篇我们会讨论 MCP。这个协议可能会成为 AI 工具生态的标准，现在理解它会对你的长期发展有帮助。

**长期思考**：

5. **框架可替换架构**。设计你的系统，使得底层框架可以被替换，而不影响业务逻辑。这个能力在框架快速演变的时代变得越来越重要。

---

## 13. 模型厂商 Agent SDK：框架生态的第二极

2025 年下半年到 2026 年，Agent 框架生态发生了一个结构性变化：**模型厂商开始推出自己的 Agent SDK**。Anthropic 推出 Claude Agent SDK，OpenAI 推出 Agents SDK，Google 推出 Agent Development Kit（ADK），AWS 推出 Strands。这不是巧合——当模型厂商对自家模型的能力边界最了解时，由他们定义 Agent 抽象是一个自然的演进方向。

这些 SDK 和前文讨论的第三方框架（LangChain/LangGraph/CrewAI）走的是完全不同的路线。理解这两极的差异，对框架选型至关重要。

### 13.1 四大厂商 SDK 速览

**Claude Agent SDK**（Anthropic）

Claude Agent SDK 的设计哲学是**极简 Agent Loop**。核心概念只有三个：Agent（带 system prompt 和 tools 的 Claude 模型）、Tool（包括 MCP Server 可提供的工具）、Agent Loop（感知-思考-行动的循环）。

```python
from anthropic.agent import Agent, ToolResult
import anthropic

# Claude Agent SDK：极简设计
client = anthropic.Anthropic()

agent = Agent(
    client=client,
    model="claude-sonnet-4-6",
    system="你是一个代码审查助手。",
    tools=[
        # MCP Server 提供的工具自动注册
        "mcp:github",
        "mcp:linear",
        # 自定义工具
        code_analysis_tool,
    ],
    # 支持 Extended Thinking
    thinking={"type": "enabled", "budget_tokens": 10000},
)

# 运行 Agent
result = agent.run("审查 PR #234 的安全性")
```

关键特性：与 MCP 协议原生集成（Anthropic 是 MCP 的发起者）、Extended Thinking 开箱即用（模型的推理过程可观测）、子 Agent 可以作为工具被父 Agent 调用、Managed Agents 提供托管运行环境（沙箱化、流式输出、无需自己管理容器）。

**OpenAI Agents SDK**

OpenAI 的核心创新是 **Handoff（交接）机制**——Agent 之间通过显式的 Handoff 传递控制权和上下文。

```python
from openai_agents import Agent, handoff, Runner

# Handoff：Agent 间的显式控制转移
triage_agent = Agent(
    name="Triage",
    instructions="判断用户意图，转交给对应的专业 Agent。",
    handoffs=[
        handoff(billing_agent),      # 转交给计费 Agent
        handoff(technical_agent),    # 转交给技术支持 Agent
        handoff(account_agent),      # 转交给账户管理 Agent
    ],
)

billing_agent = Agent(
    name="Billing",
    instructions="处理计费相关问题。",
    tools=[query_invoice, process_refund],
)

# Handoff 在 LLM 视角是一个 tool call
# 例如 transfer_to_billing，携带完整对话历史
result = Runner.run(triage_agent, "我上个月的账单有个异常收费")
```

Handoff 本质上是把 Agent 间的控制转移建模为 Tool Call——对 LLM 来说，"转交给 Billing Agent"和"调用查询工具"没有区别。这个设计比 LangGraph 的条件边更直观，也比 CrewAI 的角色委派更灵活。另一个亮点是内置的 **Guardrail** 机制，在 Agent 输入/输出两侧设置校验规则，拦截不合规的请求或回答。

**Google ADK**

Google ADK 的定位是**全栈 Agent 开发框架**，从开发到部署一站式覆盖。

```python
from google.adk import Agent, Tool, Runner
from google.adk.tools import google_search, code_execution

# Google ADK：全栈集成
agent = Agent(
    model="gemini-2.0-flash",
    name="research_agent",
    instruction="你是一个研究助手。",
    tools=[
        google_search,           # 内置 Google 搜索
        code_execution,          # 内置代码执行沙箱
        # MCP 工具也可以接入
    ],
    # 支持 sub-agent 作为工具
    sub_agents=[summarizer_agent],
)

# 内置 Session 管理（对话状态持久化）
session = runner.session_service.create_session(
    app_name="research",
    user_id="user_123",
)
```

特色能力：支持 Python、TypeScript、Go、Java 四种语言、内置 Session Service 管理对话状态、与 Google Cloud 一键部署（Cloud Run、GKE、Agent Runtime）、原生支持 MCP 工具和第三方框架工具（LangChain Tool 可直接接入）、Interactions API 提供有状态多轮对话的统一网关。

**AWS Strands**

Strands 走的是**模型驱动（Model-First）** 路线——框架的核心假设是"模型足够聪明，框架应该尽量少干预"。

```python
from strands import Agent
from strands.tools import tool

@tool
def search_docs(query: str) -> str:
    """搜索内部文档库"""
    return doc_store.search(query)

# Strands：极简的模型驱动设计
agent = Agent(
    model="us.anthropic.claude-sonnet-4-6-v1:0",  # Bedrock 模型
    tools=[search_docs],
    system_prompt="你是一个文档助手。",
)

response = agent("查找关于部署流程的文档")
```

核心理念：Agent 只需几行代码、模型做所有推理决策、框架只负责工具执行和结果反馈。Strands 与 Amazon Bedrock AgentCore 深度集成，提供身份认证、Memory、可观测性、安全运行时等生产级基础设施。2025 年 7 月的 v1.0 还引入了 A2A 协议支持，用于多 Agent 跨系统协作。

### 13.2 两极路线对比：第三方框架 vs 厂商 SDK

| 维度 | 第三方框架（LangChain/CrewAI） | 模型厂商 SDK |
|------|---------------------------|------------|
| **模型绑定** | 多模型抽象层（可换模型） | 深度优化自家模型（换模型体验下降） |
| **抽象层次** | 厚——提供链/图/角色等高层抽象 | 薄——Agent Loop + Tools，抽象极少 |
| **核心优势** | 生态广、模型无关、社区大 | 模型能力最大化、延迟最低、官方维护 |
| **核心风险** | 抽象泄漏、版本不稳定、性能损耗 | 厂商锁定、跨模型困难 |
| **学习曲线** | 中-高（概念多、API 变动频繁） | 低（API 少、概念简单） |
| **生产就绪** | 成熟（大量生产案例） | 快速成熟中（2025-2026 密集迭代） |
| **多 Agent** | 各有方案（Graph/Crew/Conversation） | Handoff（OpenAI）/ Sub-Agent（其他） |
| **部署** | 自己管理基础设施 | 托管选项（Managed Agents / AgentCore） |

**核心趋势**：当模型能力足够强时，框架需要做的"编排"越来越少，厂商 SDK 的"薄抽象"路线就越有优势。但当你需要跨模型切换、或者需要复杂的状态机编排时，第三方框架的"厚抽象"仍然有价值。

### 13.3 Handoff vs Graph vs Crew：多 Agent 编排范式对比

三种主流的多 Agent 编排方式，代表了不同的设计哲学：

```python
# === OpenAI Agents SDK: Handoff（显式控制转移）===
# Agent 像客服转接电话——"这个问题我处理不了，转给 Billing"
triage = Agent(handoffs=[billing, tech_support])
# LLM 自己决定什么时候转交、转交给谁

# === LangGraph: 条件边（状态机编排）===
# 开发者定义所有可能的路径和转移条件
graph.add_conditional_edges("triage", route_fn, {
    "billing": "billing_node",
    "tech": "tech_node",
})
# 开发者控制流程，LLM 只在节点内执行

# === CrewAI: 角色委派（团队协作）===
# 定义角色和任务，框架自动编排执行顺序
crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential
)
# 框架控制流程，Agent 在角色约束内自主执行
```

| | Handoff（OpenAI） | Graph（LangGraph） | Crew（CrewAI） |
|--|-----------------|-------------------|---------------|
| **控制权** | LLM 决定转交 | 开发者定义路径 | 框架自动编排 |
| **灵活性** | 高（动态路由） | 中（预定义路径） | 低（固定流程） |
| **可预测性** | 低（依赖 LLM 判断） | 高（确定性状态机） | 中 |
| **适用场景** | 客服、意图路由 | 复杂工作流、审批 | 内容生产、研究 |
| **调试难度** | 中（跟踪 Handoff 链） | 低（可视化状态图） | 高（角色交互黑箱） |

### 13.4 选型决策：什么时候用厂商 SDK

**用厂商 SDK 的场景**：

- 你的系统只用一家模型（短期内不会切换）
- 你想最大化利用模型的原生能力（Extended Thinking、Computer Use 等）
- 你需要托管运行环境（不想自己管容器和沙箱）
- 你的 Agent 逻辑相对简单（不需要复杂状态机）

**继续用第三方框架的场景**：

- 你需要跨多个模型（生产用 Claude、降级用 GPT-4o-mini）
- 你需要复杂的状态机编排（审批流、多阶段 pipeline）
- 你的团队已经在框架上有大量投入（迁移成本高）
- 你需要框架的生态（社区 Tool、Retriever、教程）

**混合方案（推荐）**：

很多团队最终会走向混合架构——用厂商 SDK 的 Agent Loop 做核心推理，用 MCP 做工具集成（跨框架通用），用 LangSmith/Langfuse 做可观测性。框架的各层可以独立选择，不必全盘接受一个方案。

---

## 14. 结语与进一步思考

回到最开始的问题——框架选还是不选？四条原则：

1. **框架是加速器，不是必需品。** 它加速了开发，但也隐藏了复杂性。当隐藏的复杂性成为你的瓶颈时，框架就从加速器变成了减速器。

2. **理解原理比掌握框架更重要。** 框架会变（LangChain 已经经历了多次 API 大改），但控制循环、状态管理、工具调用的基本原理不会变。前 7 篇文章构建的知识，是你评估和使用任何框架的基础。

3. **最好的架构是"框架可替换"的架构。** 把框架当作可插拔的实现层，而不是系统的骨架。你的业务逻辑应该依赖自己定义的接口，而不是某个框架的 API。

4. **厂商 SDK 代表了框架演进的新方向。** 当模型厂商开始定义 Agent 抽象时，"框架"和"模型"的边界变得模糊。未来的 Agent 开发可能不再是"选一个框架"，而是"选一个模型生态"。

### 框架解决了"怎么写"，协议解决"怎么连接"

框架帮你解决了一个 Agent 内部的组件编排问题：如何组织 LLM 调用、工具执行、状态管理。但当你有多个 Agent、多个工具提供者、多个模型时，一个更根本的问题浮现出来：

> 这些组件之间用什么协议通信？工具如何被发现和注册？能力如何被声明和协商？

这不是框架能解决的问题——这需要**协议（Protocol）**。下一篇我们将讨论 MCP（Model Context Protocol）和 A2A（Agent-to-Agent），看看 Agent 工具和 Agent 互操作的协议化未来。

还有几个值得琢磨的问题。LLM 本身的能力在快速增强——当模型原生支持复杂推理、长对话记忆、工具调用时，框架在中间需要做的事会越来越少还是越来越多？每一层抽象都在隐藏复杂性，Agent 系统本身就充满不确定性，你能接受多少"隐藏的复杂性"？选了一个框架就等于接受了它的抽象、生态、更新节奏和设计理念——当框架方向和你的需求分叉时，迁移成本往往比预期高得多。
