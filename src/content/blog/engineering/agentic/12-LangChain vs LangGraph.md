---
title: "LangChain vs LangGraph: 框架的价值与边界"
pubDate: "2026-01-22"
description: "Agentic 系列第 12 篇。客观审视 AI Agent 框架的价值与局限。深入分析 LangChain 的抽象模型与陷阱、LangGraph 的状态机优势与学习曲线，横向对比 CrewAI、AutoGen、Semantic Kernel 等框架，最终给出框架 vs 自研的决策矩阵。核心立场：理解原理再用框架，框架是加速器而非必需品。"
tags: ["Agentic", "AI Engineering", "Framework"]
---

# LangChain vs LangGraph: 框架的价值与边界

> 框架是加速器，不是必需品。它替你做了决策——有些决策是好的，有些会在深夜的生产事故中反噬你。
>
> 本文是 Agentic 系列第 12 篇。前面 11 篇我们从零构建了 Agent 的每一个组件——控制循环、工具调用、记忆、规划、多 Agent 协作。现在是时候回过头来，以工程师的视角冷静审视：框架提供了什么，隐藏了什么，限制了什么。

---

## 1. 开篇：你真的需要框架吗？

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

```
┌─────────────────────────────────────────────────────────┐
│                    LangChain Architecture                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌──────────┐    ┌──────────┐    ┌──────────────────┐  │
│   │  Chain   │    │  Agent   │    │  AgentExecutor   │  │
│   │          │    │          │    │  (Control Loop)  │  │
│   │ step1 →  │    │ LLM +   │    │                  │  │
│   │ step2 →  │    │ Tools +  │    │  while not done: │  │
│   │ step3    │    │ Prompt   │    │    plan()        │  │
│   └────┬─────┘    └────┬─────┘    │    execute()     │  │
│        │               │          │    observe()     │  │
│        │               └──────────┤                  │  │
│        │                          └────────┬─────────┘  │
│        │                                   │            │
│   ┌────▼───────────────────────────────────▼─────────┐  │
│   │              LLM Abstraction Layer               │  │
│   │  ChatOpenAI │ ChatAnthropic │ ChatOllama │ ...   │  │
│   └────────────────────┬─────────────────────────────┘  │
│                        │                                │
│   ┌────────────────────▼─────────────────────────────┐  │
│   │                  Memory                          │  │
│   │  ConversationBufferMemory │ ConversationSummary  │  │
│   │  VectorStoreMemory │ EntityMemory │ ...          │  │
│   └──────────────────────────────────────────────────┘  │
│                                                         │
│   ┌──────────────────────────────────────────────────┐  │
│   │                  Retriever                       │  │
│   │  VectorStoreRetriever │ BM25 │ MultiQuery │ ... │  │
│   └──────────────────────────────────────────────────┘  │
│                                                         │
│   ┌──────────────────────────────────────────────────┐  │
│   │                  Tools                           │  │
│   │  Search │ Calculator │ SQL │ FileSystem │ ...    │  │
│   └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

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

```
线性 Chain 能表达的：

    A ──→ B ──→ C ──→ D
    (检索)  (摘要)  (格式化) (输出)


现实中 Agent 需要的：

    A ──→ B ──→ C ──→ D
    │     │     ▲     │
    │     ├─→ E ─┘     │     ← 条件分支
    │     │             │
    │     └─→ F ──→ G ──┘     ← 并行执行
    │           │
    └───────────┘              ← 循环重试
```

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

```
┌─────────────────────────────────────────────────────────────┐
│                   LangGraph State Machine                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                  Shared State                       │   │
│   │  {messages: [...], tool_results: {...}, plan: [...]} │   │
│   └────────────────────────┬────────────────────────────┘   │
│                            │                                │
│               ┌────────────▼────────────┐                   │
│               │       START             │                   │
│               └────────────┬────────────┘                   │
│                            │                                │
│               ┌────────────▼────────────┐                   │
│               │      agent_node         │                   │
│               │   (LLM Reasoning)       │                   │
│               └────────────┬────────────┘                   │
│                            │                                │
│               ┌────────────▼────────────┐                   │
│              ╱    should_continue?       ╲                   │
│             ╱  (Conditional Edge)         ╲                  │
│            ╱                               ╲                 │
│      tool_calls?                      no tool_calls?        │
│           │                                │                │
│  ┌────────▼─────────┐          ┌──────────▼──────────┐     │
│  │    tool_node      │          │       END            │     │
│  │  (Execute Tools)  │          │   (Return Result)    │     │
│  └────────┬──────────┘          └─────────────────────┘     │
│           │                                                 │
│           └──────────────────┐                              │
│                              │ (feed tool results back)     │
│               ┌──────────────▼──────────┐                   │
│               │      agent_node         │ ← 回到推理节点    │
│               └─────────────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

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

```
                 ┌──────────────┐
                 │  Supervisor  │
                 └──────┬───────┘
                        │
              ┌─────────┼─────────┐
              ▼         ▼         ▼
        ┌──────────┐ ┌──────┐ ┌──────────┐
        │ Researcher│ │Coder │ │ Reviewer │
        └──────────┘ └──────┘ └──────────┘
              │         │         │
              └─────────┼─────────┘
                        ▼
                 ┌──────────────┐
                 │  Supervisor  │ ← 回到 Supervisor 决定是否继续
                 └──────────────┘
```

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

```
你的核心需求是什么？
│
├─── 快速原型 / PoC
│    └─→ LangChain（生态最大，上手最快）
│
├─── 复杂 Agent 逻辑（分支/循环/并行）
│    └─→ LangGraph（状态机模型天然适合）
│
├─── 多 Agent 协作
│    ├─── 角色扮演式 → CrewAI
│    ├─── 对话式协作 → AutoGen
│    └─── 图编排式   → LangGraph
│
├─── RAG / 知识问答
│    ├─── 需要灵活性  → LangChain + Retriever
│    └─── 需要干净抽象 → Haystack
│
├─── 企业级集成（.NET / Azure）
│    └─→ Semantic Kernel
│
├─── Prompt 自动优化
│    └─→ DSPy
│
└─── 生产系统（需要精细控制）
     └─→ 自研，或只使用框架的底层模块
```

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

```
┌─────────────────────────────────────────────────┐
│              你的应用层代码                        │
│         (业务逻辑、API 接口、用户交互)              │
├─────────────────────────────────────────────────┤
│              自研 Agent Runtime                    │
│    (控制循环、状态管理、错误处理、可观测性)          │
├───────────────┬─────────────────────────────────┤
│  自研工具调度   │   框架的集成模块（可选使用）       │
│  自研消息管理   │   LangChain Tool/Retriever       │
│  自研状态存储   │   LangChain Document Loader      │
│               │   LangChain Embedding 接口        │
├───────────────┴─────────────────────────────────┤
│              LLM Provider SDK                     │
│         (openai, anthropic, etc.)                 │
└─────────────────────────────────────────────────┘
```

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

## 9. 结语与进一步思考

### 核心立场回顾

本文的核心立场可以用三句话概括：

1. **框架是加速器，不是必需品。** 它加速了开发，但也隐藏了复杂性。当隐藏的复杂性成为你的瓶颈时，框架就从加速器变成了减速器。

2. **理解原理比掌握框架更重要。** 框架会变（LangChain 已经经历了多次 API 大改），但控制循环、状态管理、工具调用的基本原理不会变。前 7 篇文章构建的知识，是你评估和使用任何框架的基础。

3. **最好的架构是"框架可替换"的架构。** 把框架当作可插拔的实现层，而不是系统的骨架。你的业务逻辑应该依赖自己定义的接口，而不是某个框架的 API。

### 框架解决了"怎么写"，协议解决"怎么连接"

框架帮你解决了一个 Agent 内部的组件编排问题：如何组织 LLM 调用、工具执行、状态管理。但当你有多个 Agent、多个工具提供者、多个模型时，一个更根本的问题浮现出来：

> 这些组件之间用什么协议通信？工具如何被发现和注册？能力如何被声明和协商？

这不是框架能解决的问题——这需要**协议（Protocol）**。下一篇我们将讨论 MCP（Model Context Protocol），看看 Agent 工具生态的协议化未来。

### 留给读者的思考

**关于框架的未来**：LLM 本身的能力在快速增强。当模型原生支持复杂的多步推理（如 o1/o3 的 chain-of-thought）、原生支持长对话记忆（如 Gemini 的长上下文窗口）、原生支持工具调用时，框架的价值会被压缩还是放大？换句话说——当 LLM 足够强时，我们还需要框架在中间做多少事？

**关于抽象的代价**：每一层抽象都在隐藏复杂性。隐藏复杂性是好事（让你专注于业务逻辑），但也是坏事（让你在出问题时无法理解系统行为）。在 Agent 这样本身就充满不确定性的系统中，你能接受多少"隐藏的复杂性"？

**关于生态锁定**：选择一个框架意味着接受它的抽象、它的生态、它的更新节奏、它的设计理念。当框架的方向与你的需求分叉时，迁移的成本有多高？这个成本是否在你的决策时被低估了？

这些问题没有标准答案。但作为 AI 工程师，能够清晰地提出这些问题，本身就是一种重要的能力。

---

> **系列导航**：本文是 Agentic 系列的第 12 篇。
>
> - 上一篇：[11 | Multi-Agent Collaboration](/blog/engineering/agentic/11-Multi-Agent%20Collaboration)
> - 下一篇：[13 | MCP and Tool Protocol](/blog/engineering/agentic/13-MCP%20and%20Tool%20Protocol)
> - 完整目录：[01 | From LLM to Agent](/blog/engineering/agentic/01-From%20LLM%20to%20Agent)
