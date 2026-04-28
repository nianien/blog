---
title: "工具调用深度解析：让LLM成为可编程接口"
description: "Tool Calling 是 LLM 从「对话机器」变成「可编程接口」的关键转折点。本文从底层原理出发，系统拆解 Tool Calling 的工作机制、JSON Schema 契约设计、工具注册与发现策略、错误处理、安全性考量及关键 Trade-off，附带完整可运行代码。"
pubDate: "2025-12-18"
tags: ["Agentic", "AI Engineering", "Tool Calling"]
series:
  key: "agentic"
  order: 5
author: "skyfalling"
---

---

## 1. 为什么 Tool Calling 是关键转折点

一个纯粹的 LLM 只能做一件事：接受文本，生成文本。它无法查询数据库、无法读取文件、无法发送邮件、无法获取实时天气。它的知识冻结在训练数据的截止日期，它的能力边界就是 token 序列的排列组合。

Tool Calling 改变了这一切。

它的本质不是"让 LLM 调用工具"，而是 **让 LLM 生成结构化的调用意图，由外部运行时代为执行**。这个区分至关重要——LLM 从未真正"执行"过任何工具，它只是学会了在恰当的时机，输出一段符合约定格式的 JSON，表达"我需要调用某个工具，参数是这些"。

这意味着：
- LLM 变成了一个 **决策引擎**：决定调用什么、传什么参数
- Runtime 变成了一个 **执行引擎**：负责真正的 I/O 操作
- 两者之间的契约是 **JSON Schema**

这种分离，让 LLM 从一个封闭的文本生成器，变成了一个可以与外部世界交互的可编程接口。

---

## 2. Tool Calling 的工作原理

### 2.1 完整流程

![Tool Calling 完整序列图](/images/blog/agentic-05/tool-calling-sequence.svg)

### 2.2 关键洞察

从上面的序列图中，可以提炼出几个核心事实：

1. **LLM 发起两次推理**。第一次决定是否调用工具、调用哪个、传什么参数；第二次基于工具返回的结果生成最终回答。这意味着每次 Tool Calling 至少消耗两轮 LLM 调用的 token。

2. **LLM 的输出不是自然语言，而是结构化 JSON**。这是模型经过专门训练（fine-tuning）才获得的能力。并非所有 LLM 都支持 Tool Calling——它需要模型在训练阶段就学会"在特定上下文下输出 JSON 而非自然语言"。

3. **Runtime 是不可或缺的中间层**。它负责：解析 LLM 返回的 Tool Call、校验参数、路由到正确的函数、执行函数、收集结果、将结果注入下一轮对话。没有 Runtime，Tool Calling 就是一段无人执行的 JSON。

4. **整个过程对用户透明**。用户看到的只是"问了一个问题，得到了回答"。中间的 Tool Call 调度过程完全由系统内部完成。

---

## 3. JSON Schema 作为契约

### 3.1 工具定义的结构

每个工具的定义由三部分组成：

```python
tool_definition = {
    "type": "function",
    "function": {
        "name": "get_weather",          # 工具的唯一标识
        "description": "...",           # 给 LLM 看的"接口文档"
        "parameters": {                 # JSON Schema 格式的参数约束
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "城市名称，如 '北京'、'上海'"
                }
            },
            "required": ["city"]
        }
    }
}
```

这里的 `parameters` 遵循 JSON Schema 规范（Draft 2020-12 子集），它不仅定义了参数的类型，还定义了参数的约束、默认值、枚举范围等。JSON Schema 就是 LLM 与 Runtime 之间的 **契约**。

### 3.2 好的描述 vs 差的描述

`description` 是整个工具定义中最容易被低估的字段。它不是给人类看的注释，而是 **给 LLM 看的接口文档**。LLM 完全依赖 description 来决定是否调用这个工具、以及如何填充参数。

**差的描述：**

```python
{
    "name": "query_db",
    "description": "查询数据库",          # 太模糊：查什么数据库？返回什么？
    "parameters": {
        "type": "object",
        "properties": {
            "q": {                        # 参数名不直观
                "type": "string"
            }
        }
    }
}
```

**好的描述：**

```python
{
    "name": "query_user_orders",
    "description": (
        "根据用户 ID 查询该用户的历史订单列表。"
        "返回最近 30 天内的订单，包含订单号、金额、状态。"
        "如果用户不存在，返回空列表。"
        "不支持模糊查询，user_id 必须精确匹配。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "user_id": {
                "type": "string",
                "description": "用户的唯一标识符，格式为 'U' + 8位数字，如 'U00012345'"
            },
            "status_filter": {
                "type": "string",
                "enum": ["all", "pending", "completed", "cancelled"],
                "description": "按订单状态过滤，默认返回所有状态的订单"
            }
        },
        "required": ["user_id"]
    }
}
```

两者之间的差异在于：

| 维度 | 差的描述 | 好的描述 |
|------|---------|---------|
| 功能边界 | 不清楚能做什么 | 明确说明查询范围和返回内容 |
| 参数语义 | `q` 是什么？ | `user_id` 含义清晰，且给出格式示例 |
| 约束条件 | 无 | 明确说明不支持模糊查询 |
| 异常行为 | 未提及 | 说明了用户不存在时的返回 |
| 枚举约束 | 无 | 用 `enum` 限定合法值 |

### 3.3 参数设计原则

1. **简单优先**：参数数量尽量少。一个工具如果需要 10 个参数，说明它的职责太大，应该拆分。
2. **类型明确**：用 `enum` 约束离散值，用 `pattern` 约束格式，用 `minimum`/`maximum` 约束数值范围。
3. **必选与可选分明**：`required` 字段只放真正必须的参数，可选参数给默认值。
4. **命名即文档**：`user_id` 比 `uid` 好，`start_date` 比 `sd` 好。LLM 会从参数名推断语义。
5. **避免嵌套过深**：LLM 生成深层嵌套 JSON 的准确率会显著下降。尽量用扁平结构。

---

## 4. Structured Output vs Free-form Output

### 4.1 为什么结构化输出更可靠

在 Tool Calling 出现之前，让 LLM 调用工具的常见做法是：在 Prompt 中要求 LLM "用特定格式输出"，然后用正则或字符串解析提取调用意图。

```
# 旧做法（Prompt Hacking）
请用以下格式回答：
Action: <工具名>
Action Input: <参数 JSON>

# LLM 可能的输出（不可靠）
"我觉得应该查一下天气。Action: get_weather Action Input: {"city": "北京"}"
                       ^^ 前面混入了自然语言，解析会出错
```

这种方式的根本问题是：LLM 的输出是 **非确定性的自由文本**，它可能在格式中混入自然语言、遗漏字段、搞错 JSON 语法。

Structured Output（结构化输出）通过 **约束解码（Constrained Decoding）** 从根本上解决了这个问题。模型在生成 token 时，解码器会强制输出符合预定义 JSON Schema 的 token 序列，从而保证输出 100% 可解析。

### 4.2 三种机制的区别

| 机制 | 原理 | 可靠性 | 适用场景 |
|------|------|--------|---------|
| **JSON Mode** | 告诉模型"输出必须是合法 JSON"，但不约束 schema | 中等。JSON 语法正确，但字段可能不对 | 简单的数据提取 |
| **Function Calling / Tool Use** | 模型经过 fine-tuning，能在特定上下文下输出 tool call 结构 | 高。模型专门训练过 | Agent 工具调用 |
| **Structured Output** | 约束解码 + JSON Schema 验证，输出严格匹配 schema | 极高。解码层面保证 | 需要严格 schema 的场景 |

### 4.3 各大模型的实现差异

不同模型提供商对 Tool Calling 的 API 设计不尽相同，但核心思想一致：

**OpenAI**（GPT-4 系列）：
- 使用 `tools` 参数传递工具定义
- 返回 `tool_calls` 数组，支持并行调用
- 支持 `strict: true` 开启 Structured Output 模式

**Anthropic**（Claude 系列）：
- 使用 `tools` 参数传递工具定义
- Tool Call 以 `tool_use` content block 返回
- Tool 结果以 `tool_result` content block 传回
- 原生支持并行工具调用

**Google**（Gemini 系列）：
- 使用 `tools` + `function_declarations` 结构
- 支持 `function_calling_config` 控制调用模式（AUTO / ANY / NONE）
- 返回 `function_call` part

虽然 API 格式不同，但抽象层面是一致的：**定义工具 → LLM 决定调用 → 返回结构化调用请求 → 外部执行 → 结果回传**。这也是为什么我们强调框架无关的原理理解——API 会变，原理不会。

---

## 5. 工具注册与发现（Tool Registry）

### 5.1 静态注册

最简单的方式是在代码中硬编码工具列表：

```python
TOOLS = [
    get_weather_tool,
    query_db_tool,
    send_email_tool,
]

response = client.chat.completions.create(
    model="gpt-4",
    messages=messages,
    tools=TOOLS,
)
```

优点是简单直接，缺点是每次新增或修改工具都需要改代码、重新部署。适合工具数量少且稳定的场景。

### 5.2 动态注册

当工具数量增多或需要根据上下文动态调整时，需要一个 Tool Registry：

![Tool Registry 架构](/images/blog/agentic-05/tool-registry-architecture.svg)

### 5.3 工具选择问题

当工具数量超过一定阈值（经验值：15-20 个），LLM 的工具选择准确率会明显下降。原因有两个：

1. **Context 膨胀**：每个工具定义占用数百 token，20 个工具就是数千 token 的 system prompt，挤占了有效上下文空间。
2. **选择困难**：工具越多，语义越可能重叠，LLM 越难区分应该调用哪个。

### 5.4 Tool Selection 策略

**策略一：全量传递**

```
所有工具 ──全部传递──> LLM
```

适用场景：工具少于 10 个。简单暴力，无额外开销。

**策略二：语义过滤**

```
用户输入 ──Embedding──> 向量
                          │
工具描述 ──Embedding──> 向量库 ──Top-K 相似──> 候选工具 ──> LLM
```

用 Embedding 计算用户输入与工具描述的语义相似度，只传递 Top-K 最相关的工具。缺点是可能漏掉正确工具。

**策略三：两阶段选择**

```
阶段 1：所有工具名 + 简短描述 ──> LLM ──> 选出候选工具 (3-5 个)
阶段 2：候选工具的完整定义     ──> LLM ──> 执行 Tool Call
```

第一阶段只传递工具名和一行描述（token 消耗少），让 LLM 先做粗筛；第二阶段只传递选中工具的完整定义。这种方式在工具数量 50+ 的场景下效果最好，代价是多一轮 LLM 调用。

完整实现：

```python
import json
import openai

client = openai.OpenAI()

def two_stage_tool_selection(
    user_query: str,
    tool_registry: "ToolRegistry",
    model: str = "gpt-4o-mini",
    max_candidates: int = 5,
) -> list[dict]:
    """两阶段工具选择：先粗筛再精选"""

    # ── 阶段 1：用工具摘要做粗筛 ──
    tool_summary = tool_registry.get_summary()  # "tool_name: 一句话描述" 列表

    stage1_resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": (
                f"You are a tool selector. Given a user query and a list of "
                f"available tools, select the {max_candidates} most relevant tools.\n"
                f"Return a JSON array of tool names only.\n\n"
                f"Available tools:\n{tool_summary}"
            )},
            {"role": "user", "content": user_query},
        ],
        response_format={"type": "json_object"},
    )
    selected_names = json.loads(
        stage1_resp.choices[0].message.content
    ).get("tools", [])

    # ── 阶段 2：只传候选工具的完整 Schema ──
    candidate_schemas = [
        tool_registry.get_tool(name).to_openai_schema()
        for name in selected_names
        if tool_registry.get_tool(name) is not None
    ]

    return candidate_schemas  # 传给后续的 chat.completions.create(tools=...)
```

阶段 1 用小模型（`gpt-4o-mini`）做粗筛，成本很低（摘要通常不超过 2K tokens）；阶段 2 拿到精简后的候选列表，再用主模型做正式的 Tool Calling。实测在 100+ 工具场景下，这种方式比全量注入节省 60-70% 的 token，同时准确率基本不下降。

---

## 6. 完整代码示例

### 6.1 工具定义

```python
from dataclasses import dataclass, field
from typing import Any, Callable

@dataclass
class Tool:
    """工具的统一抽象"""
    name: str
    description: str
    parameters: dict          # JSON Schema
    function: Callable        # 实际执行的函数
    requires_confirmation: bool = False  # 是否需要用户确认

    def to_openai_schema(self) -> dict:
        """转换为 OpenAI API 格式"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            }
        }

# ── 工具实现 ──────────────────────────────────────────────

def get_weather(city: str, unit: str = "celsius") -> dict:
    """模拟天气查询"""
    # 实际场景中调用天气 API
    mock_data = {
        "北京": {"temp": 28, "condition": "晴", "humidity": 45},
        "上海": {"temp": 32, "condition": "多云", "humidity": 78},
    }
    data = mock_data.get(city, {"temp": 20, "condition": "未知", "humidity": 50})
    if unit == "fahrenheit":
        data["temp"] = data["temp"] * 9 / 5 + 32
    return {"city": city, **data}


def query_database(sql: str, database: str = "default") -> dict:
    """模拟数据库查询"""
    # 实际场景中执行 SQL
    return {
        "database": database,
        "query": sql,
        "rows": [
            {"id": 1, "name": "Alice", "amount": 100.0},
            {"id": 2, "name": "Bob", "amount": 200.0},
        ],
        "row_count": 2,
    }


def calculate(expression: str) -> dict:
    """安全的数学计算"""
    allowed_chars = set("0123456789+-*/.() ")
    if not all(c in allowed_chars for c in expression):
        return {"error": "表达式包含非法字符"}
    try:
        result = eval(expression)  # 生产环境应使用 ast.literal_eval 或专用解析器
        return {"expression": expression, "result": result}
    except Exception as e:
        return {"error": str(e)}


def read_file(file_path: str, encoding: str = "utf-8") -> dict:
    """读取文件内容"""
    try:
        with open(file_path, "r", encoding=encoding) as f:
            content = f.read(10000)  # 限制读取大小
        return {"path": file_path, "content": content, "size": len(content)}
    except FileNotFoundError:
        return {"error": f"文件不存在: {file_path}"}
    except Exception as e:
        return {"error": str(e)}


def send_email(to: str, subject: str, body: str) -> dict:
    """模拟发送邮件"""
    # 实际场景中调用邮件服务
    return {"status": "sent", "to": to, "subject": subject}


# ── 工具注册 ──────────────────────────────────────────────

weather_tool = Tool(
    name="get_weather",
    description=(
        "查询指定城市的当前天气信息，包括温度、天气状况和湿度。"
        "支持国内主要城市。如果城市不在数据库中，返回默认值。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "city": {
                "type": "string",
                "description": "要查询的城市名称，如 '北京'、'上海'"
            },
            "unit": {
                "type": "string",
                "enum": ["celsius", "fahrenheit"],
                "description": "温度单位，默认摄氏度"
            }
        },
        "required": ["city"],
    },
    function=get_weather,
)

database_tool = Tool(
    name="query_database",
    description=(
        "执行 SQL 查询并返回结果。仅支持 SELECT 语句，"
        "不允许执行 INSERT/UPDATE/DELETE 等写操作。"
        "返回结果包含行数据和总行数。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "sql": {
                "type": "string",
                "description": "要执行的 SQL SELECT 语句"
            },
            "database": {
                "type": "string",
                "enum": ["default", "analytics", "users"],
                "description": "目标数据库名称，默认为 'default'"
            }
        },
        "required": ["sql"],
    },
    function=query_database,
)

calculator_tool = Tool(
    name="calculate",
    description=(
        "执行数学计算。支持加减乘除和括号。"
        "输入为数学表达式字符串，如 '(3 + 5) * 2'。"
        "不支持变量和函数调用，仅限纯数值运算。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "expression": {
                "type": "string",
                "description": "数学表达式，如 '(3 + 5) * 2'"
            }
        },
        "required": ["expression"],
    },
    function=calculate,
)

file_tool = Tool(
    name="read_file",
    description=(
        "读取指定路径的文本文件内容。最多读取 10000 字符。"
        "仅支持文本文件，不支持二进制文件。"
        "如果文件不存在，返回错误信息。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "文件的绝对路径或相对路径"
            },
            "encoding": {
                "type": "string",
                "description": "文件编码，默认 utf-8"
            }
        },
        "required": ["file_path"],
    },
    function=read_file,
)

email_tool = Tool(
    name="send_email",
    description=(
        "向指定收件人发送一封电子邮件。"
        "需要提供收件人地址、邮件主题和正文。"
        "正文支持纯文本格式。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "to": {
                "type": "string",
                "description": "收件人邮箱地址"
            },
            "subject": {
                "type": "string",
                "description": "邮件主题"
            },
            "body": {
                "type": "string",
                "description": "邮件正文，纯文本格式"
            }
        },
        "required": ["to", "subject", "body"],
    },
    function=send_email,
    requires_confirmation=True,  # 发邮件需要用户确认
)
```

### 6.2 Tool Registry 实现

```python
import json
from typing import Optional

class ToolRegistry:
    """工具注册中心"""

    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"工具 '{tool.name}' 已注册")
        self._tools[tool.name] = tool

    def unregister(self, name: str) -> None:
        self._tools.pop(name, None)

    def get_tool(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def get_all_tools(self) -> list[Tool]:
        return list(self._tools.values())

    def get_definitions(self, names: list[str] | None = None) -> list[dict]:
        """获取工具定义列表（用于传递给 LLM API）"""
        tools = self._tools.values()
        if names:
            tools = [t for t in tools if t.name in names]
        return [t.to_openai_schema() for t in tools]

    def get_summary(self) -> str:
        """获取工具摘要（用于两阶段选择的第一阶段）"""
        lines = []
        for tool in self._tools.values():
            # 只取 description 的第一句
            short_desc = tool.description.split("。")[0] + "。"
            lines.append(f"- {tool.name}: {short_desc}")
        return "\n".join(lines)


# 初始化 Registry
registry = ToolRegistry()
for tool in [weather_tool, database_tool, calculator_tool, file_tool, email_tool]:
    registry.register(tool)
```

### 6.3 Tool Dispatcher 实现

```python
import json
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

class ToolDispatcher:
    """
    工具调度器：解析 LLM 返回的 tool calls，执行对应工具，收集结果。
    """

    def __init__(self, registry: ToolRegistry, max_parallel: int = 5):
        self.registry = registry
        self.max_parallel = max_parallel

    def validate_arguments(self, tool: Tool, arguments: dict) -> list[str]:
        """基础参数验证（生产环境建议使用 jsonschema 库）"""
        errors = []
        schema = tool.parameters
        required = schema.get("required", [])
        properties = schema.get("properties", {})

        # 检查必填参数
        for param in required:
            if param not in arguments:
                errors.append(f"缺少必填参数: {param}")

        # 检查参数类型和枚举
        for param, value in arguments.items():
            if param not in properties:
                errors.append(f"未知参数: {param}")
                continue
            prop_schema = properties[param]
            if "enum" in prop_schema and value not in prop_schema["enum"]:
                errors.append(
                    f"参数 '{param}' 的值 '{value}' "
                    f"不在允许范围内: {prop_schema['enum']}"
                )

        return errors

    def execute_single(self, tool_call: dict) -> dict:
        """执行单个工具调用"""
        name = tool_call["function"]["name"]
        raw_args = tool_call["function"]["arguments"]
        call_id = tool_call.get("id", "unknown")

        # 1. 查找工具
        tool = self.registry.get_tool(name)
        if not tool:
            return {
                "tool_call_id": call_id,
                "role": "tool",
                "content": json.dumps({"error": f"工具 '{name}' 不存在"}),
            }

        # 2. 解析参数
        try:
            arguments = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
        except json.JSONDecodeError as e:
            return {
                "tool_call_id": call_id,
                "role": "tool",
                "content": json.dumps({"error": f"参数 JSON 解析失败: {e}"}),
            }

        # 3. 验证参数
        errors = self.validate_arguments(tool, arguments)
        if errors:
            return {
                "tool_call_id": call_id,
                "role": "tool",
                "content": json.dumps({"error": "参数验证失败", "details": errors}),
            }

        # 4. 执行工具
        try:
            result = tool.function(**arguments)
            return {
                "tool_call_id": call_id,
                "role": "tool",
                "content": json.dumps(result, ensure_ascii=False),
            }
        except Exception as e:
            return {
                "tool_call_id": call_id,
                "role": "tool",
                "content": json.dumps({
                    "error": f"工具执行失败: {type(e).__name__}: {e}",
                    "traceback": traceback.format_exc()[-500:],  # 截断过长的堆栈
                }),
            }

    def execute_parallel(self, tool_calls: list[dict]) -> list[dict]:
        """并行执行多个工具调用"""
        if len(tool_calls) == 1:
            return [self.execute_single(tool_calls[0])]

        results = []
        with ThreadPoolExecutor(max_workers=self.max_parallel) as executor:
            future_to_call = {
                executor.submit(self.execute_single, tc): tc
                for tc in tool_calls
            }
            for future in as_completed(future_to_call):
                results.append(future.result())

        # 按原始顺序排列结果
        id_to_result = {r["tool_call_id"]: r for r in results}
        ordered = []
        for tc in tool_calls:
            call_id = tc.get("id", "unknown")
            ordered.append(id_to_result.get(call_id, results.pop(0)))
        return ordered


dispatcher = ToolDispatcher(registry)
```

### 6.4 完整对话循环

```python
from openai import OpenAI

def run_agent_loop(
    client: OpenAI,
    user_message: str,
    registry: ToolRegistry,
    dispatcher: ToolDispatcher,
    max_iterations: int = 10,
) -> str:
    """
    完整的 Agent 对话循环，支持多轮 Tool Calling。
    """
    messages = [
        {"role": "system", "content": "你是一个有用的助手，可以使用工具来回答用户的问题。"},
        {"role": "user", "content": user_message},
    ]
    tools = registry.get_definitions()

    for i in range(max_iterations):
        response = client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            tools=tools if tools else None,
        )
        choice = response.choices[0]
        message = choice.message

        # 如果 LLM 没有调用工具，直接返回文本回答
        if not message.tool_calls:
            return message.content

        # 将 LLM 的回复（含 tool_calls）加入消息历史
        messages.append(message.model_dump())

        # 执行所有工具调用（支持并行）
        tool_calls = [tc.model_dump() for tc in message.tool_calls]
        results = dispatcher.execute_parallel(tool_calls)

        # 将工具执行结果加入消息历史
        for result in results:
            messages.append(result)

        # 继续循环，让 LLM 基于工具结果做下一步决策

    return "达到最大迭代次数，对话终止。"


# 使用示例
# client = OpenAI()
# answer = run_agent_loop(client, "北京今天天气怎么样？然后帮我算一下 28 * 9/5 + 32", registry, dispatcher)
# print(answer)
```

---

## 7. 错误处理与验证

Tool Calling 中的错误来源比常规 API 调用更多，因为链条更长：用户输入 → LLM 推理 → 参数生成 → 参数验证 → 工具执行 → 结果回传 → LLM 再推理。每一环都可能出错。

### 7.1 参数验证

LLM 生成的参数并不总是合法的。常见问题：

```python
# LLM 可能生成的"有问题"的参数

# 1. 类型错误：期望 string，给了 number
{"city": 123}

# 2. 枚举越界：给了不在 enum 中的值
{"unit": "kelvin"}      # enum 里只有 celsius / fahrenheit

# 3. 格式错误：JSON 语法不对
'{"city": "北京",}'      # 尾部多余逗号（严格 JSON 不允许）

# 4. 幻觉参数：编造了不存在的参数
{"city": "北京", "forecast_days": 7}  # 工具根本没有这个参数

# 5. 语义错误：参数值表面合法但语义错误
{"sql": "DROP TABLE users"}  # 传了一条 DELETE 语句给 SELECT-only 工具
```

应对策略是 **分层验证**：

```python
def validate_and_execute(tool: Tool, raw_arguments: str) -> dict:
    # 第一层：JSON 语法
    try:
        args = json.loads(raw_arguments)
    except json.JSONDecodeError:
        return {"error": "参数不是合法的 JSON"}

    # 第二层：Schema 验证（使用 jsonschema 库）
    from jsonschema import validate, ValidationError
    try:
        validate(instance=args, schema=tool.parameters)
    except ValidationError as e:
        return {"error": f"参数验证失败: {e.message}"}

    # 第三层：业务规则验证
    if tool.name == "query_database":
        sql = args.get("sql", "").strip().upper()
        if not sql.startswith("SELECT"):
            return {"error": "仅支持 SELECT 查询"}

    # 执行
    return tool.function(**args)
```

### 7.2 工具执行失败的反馈

当工具执行失败时，最重要的原则是：**将错误信息回传给 LLM，让它决定下一步**。

```python
# 不要这样做 —— 对用户抛出原始异常
raise RuntimeError("Connection timeout to weather API")

# 应该这样做 —— 将错误包装为工具结果，回传给 LLM
{
    "tool_call_id": "call_abc123",
    "role": "tool",
    "content": json.dumps({
        "error": "天气 API 连接超时，请稍后重试或尝试查询其他城市",
        "error_type": "timeout",
        "retryable": True
    })
}
```

LLM 拿到这个错误信息后，可能会：
- 换一种方式重试（比如换个参数）
- 告知用户当前无法完成
- 尝试用其他工具达成目标

这里有一个容易被忽视的原则：**自信的错误答案比没有答案更危险。** 当工具返回了错误结果（比如搜索 API 没找到目标信息），LLM 经常会"创造性地"基于错误结果生成一个看似合理的回答，而不是诚实地说"未找到"。用户拿到一个自信但错误的答案，比拿到"我不确定"的后果严重得多——因为前者会被当作事实来使用。因此，工具的错误处理不仅要关注"调用是否成功"，更要验证返回结果的**语义正确性**。

### 7.3 重试策略

![Tool Call 重试策略](/images/blog/agentic-05/tool-error-retry-strategy.svg)

核心原则：**可重试的错误由 Runtime 处理，不可重试的错误交给 LLM 决策**。

- **瞬时错误**（网络超时、限流）：Runtime 自动重试，设置退避策略和最大重试次数，不需要浪费 LLM 的 token。
- **参数错误**：回传给 LLM，它可能会修正参数重新调用。
- **永久错误**（权限不足、资源不存在）：回传给 LLM，让它换一种方案或如实告知用户。

### 7.4 幂等性考量

当重试机制存在时，幂等性就变得至关重要。

```python
# 幂等操作 —— 重试安全
get_weather("北京")           # 多次调用结果相同
query_database("SELECT ...")  # 只读查询，天然幂等

# 非幂等操作 —— 重试危险
send_email(to="a@b.com", ...)  # 重试 = 发两封邮件
create_order(item="iPhone")    # 重试 = 创建两个订单
```

对于非幂等操作，要么禁止自动重试，要么引入幂等 key：

```python
def send_email_idempotent(to: str, subject: str, body: str, idempotency_key: str) -> dict:
    """带幂等 key 的邮件发送"""
    if is_already_sent(idempotency_key):
        return {"status": "already_sent", "message": "该请求已处理，跳过重复发送"}
    result = _do_send_email(to, subject, body)
    mark_as_sent(idempotency_key)
    return result
```

---

## 8. 安全性
## 9. 工具安全深度防护

Tool Calling 打开了 LLM 与外部世界的通道，这意味着需要在三个层面设计安全防护：参数注入、执行隔离和权限分级。不同的工具有不同的风险等级，需要对应的防护强度。

### 9.1 参数注入防护

LLM 生成的参数可能被恶意输入或 Prompt Injection 操纵，导致参数注入攻击。常见的注入向量包括：

```python
# 场景 1：SQL 注入
用户输入: "查询用户 U123'; DROP TABLE users; --"
LLM 生成: {"sql": "SELECT * FROM users WHERE user_id = 'U123'; DROP TABLE users; --'"}

# 场景 2：命令注入
用户输入: "帮我运行一个脚本来分析数据"
LLM 生成: {"command": "analyze.sh && rm -rf /"}

# 场景 3：路径遍历
用户输入: "读一下 ../../etc/passwd"
LLM 生成: {"file_path": "../../etc/passwd"}
```

防护策略分为三层：

**第一层：参数白名单验证**

```python
from typing import Any, Callable
import re

class ParameterValidator:
    """参数验证器，基于白名单和规则"""

    def __init__(self):
        self._rules: dict[str, Callable[[Any], bool]] = {}

    def register_rule(self, param_name: str, validator: Callable[[Any], bool]):
        """注册参数验证规则"""
        self._rules[param_name] = validator

    def validate(self, tool_name: str, arguments: dict) -> tuple[bool, list[str]]:
        """验证参数，返回 (是否有效, 错误列表)"""
        errors = []

        for param_name, param_value in arguments.items():
            if param_name not in self._rules:
                errors.append(f"未知参数: {param_name}")
                continue

            try:
                if not self._rules[param_name](param_value):
                    errors.append(f"参数 '{param_name}' 未通过验证: {param_value}")
            except Exception as e:
                errors.append(f"参数 '{param_name}' 验证异常: {e}")

        return len(errors) == 0, errors


def create_database_validator() -> ParameterValidator:
    """创建数据库查询工具的参数验证器"""
    validator = ParameterValidator()

    def validate_sql(sql: str) -> bool:
        if not isinstance(sql, str):
            return False
        cleaned = re.sub(r'--.*$', '', sql, flags=re.MULTILINE)
        cleaned = re.sub(r'/\*.*?\*/', '', cleaned, flags=re.DOTALL)
        sql_upper = cleaned.strip().upper()

        if not sql_upper.startswith("SELECT"):
            return False

        forbidden_keywords = ["DROP", "DELETE", "UPDATE", "INSERT", "CREATE", "ALTER", "EXEC", "EXECUTE"]
        for keyword in forbidden_keywords:
            if keyword in sql_upper:
                return False

        return True

    allowed_databases = {"default", "analytics", "users"}
    def validate_database(db: str) -> bool:
        return isinstance(db, str) and db in allowed_databases

    validator.register_rule("sql", validate_sql)
    validator.register_rule("database", validate_database)
    return validator


def create_file_validator() -> ParameterValidator:
    """创建文件读取工具的参数验证器"""
    import os
    validator = ParameterValidator()

    def validate_file_path(path: str) -> bool:
        if not isinstance(path, str):
            return False
        if "../" in path or path.startswith("/"):
            return False
        allowed_prefixes = ["/data/documents/", "/tmp/uploads/"]
        abs_path = os.path.abspath(path)
        return any(abs_path.startswith(prefix) for prefix in allowed_prefixes)

    validator.register_rule("file_path", validate_file_path)
    return validator
```

**第二层：SQL 注入过滤**

对于数据库工具，在白名单之外还应使用参数化查询（Parameterized Queries）：

```python
import sqlite3

class SafeDatabaseTool:
    """安全的数据库工具，使用参数化查询"""

    def __init__(self, db_path: str, validator: ParameterValidator):
        self.db_path = db_path
        self.validator = validator
        self._query_templates = {
            "get_user_by_id": "SELECT * FROM users WHERE user_id = ? LIMIT 100",
            "get_orders_by_user": "SELECT * FROM orders WHERE user_id = ? AND created_at > ? LIMIT 100",
            "get_product_by_name": "SELECT * FROM products WHERE LOWER(name) LIKE ? LIMIT 20",
        }

    def execute_template_query(self, template_name: str, parameters: list) -> dict:
        """执行预定义的查询模板，参数通过占位符传入"""
        if template_name not in self._query_templates:
            return {"error": f"未知查询模板: {template_name}"}

        query = self._query_templates[template_name]

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(query, parameters)
            rows = cursor.fetchall()
            conn.close()

            return {
                "status": "success",
                "rows": rows,
                "row_count": len(rows)
            }
        except Exception as e:
            return {"error": f"查询执行失败: {e}"}

    def execute_custom_query(self, sql: str) -> dict:
        """执行用户输入的 SQL，但必须先通过参数验证"""
        is_valid, errors = self.validator.validate("query_database", {"sql": sql})
        if not is_valid:
            return {"error": "SQL 验证失败", "details": errors}

        if "'" in sql or '"' in sql:
            return {"error": "不支持包含字符串字面量的 SQL，请使用模板查询"}

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(sql)
            rows = cursor.fetchall()
            conn.close()

            return {
                "status": "success",
                "rows": rows,
                "row_count": len(rows)
            }
        except Exception as e:
            return {"error": f"查询执行失败: {e}"}
```

### 9.2 执行沙箱隔离

对于高风险工具（代码执行、文件操作、网络调用），应该在隔离的沙箱环境中执行。常见的沙箱方案有 Docker、gVisor、WASM。这里展示 Docker 沙箱的配置：

```python
import docker
import json
import time

class DockerSandbox:
    """Docker 容器沙箱执行环境"""

    def __init__(
        self,
        image: str = "python:3.11-slim",
        timeout: int = 30,
        memory_limit: str = "256m",
    ):
        self.client = docker.from_env()
        self.image = image
        self.timeout = timeout
        self.memory_limit = memory_limit

    def execute_code(self, code: str, language: str = "python") -> dict:
        """在沙箱中执行代码"""
        try:
            if language == "python":
                script = code
                entrypoint = ["python", "-c", script]
            elif language == "bash":
                script = code
                entrypoint = ["bash", "-c", script]
            else:
                return {"error": f"不支持的语言: {language}"}

            container = self.client.containers.run(
                self.image,
                entrypoint=entrypoint,
                detach=True,
                mem_limit=self.memory_limit,
                cpuset_cpus="0",
                network_disabled=True,
                read_only=True,
                tmpfs={"/tmp": "size=10m"},
                pids_limit=10,
                remove=False,
            )

            start_time = time.time()
            while time.time() - start_time < self.timeout:
                try:
                    exit_code = container.wait(timeout=1)
                    break
                except docker.errors.APIError:
                    continue
            else:
                container.kill()
                container.remove()
                return {"error": "代码执行超时", "timeout": self.timeout}

            output = container.logs(stdout=True, stderr=True).decode("utf-8")
            container.remove()

            return {
                "status": "success",
                "exit_code": exit_code,
                "output": output[:5000],
                "truncated": len(output) > 5000
            }

        except Exception as e:
            return {"error": f"沙箱执行异常: {e}"}

    def cleanup(self):
        """清理所有沙箱容器"""
        try:
            for container in self.client.containers.list(all=True):
                if "sandbox" in container.name:
                    container.remove(force=True)
        except Exception:
            pass


sandbox = DockerSandbox(memory_limit="256m", timeout=30)
result = sandbox.execute_code("print('Hello from sandbox')", language="python")
```

### 9.3 权限分级控制

根据工具的风险等级，设计不同的权限级别，每个级别需要不同的确认机制：

```python
from enum import Enum
from dataclasses import dataclass
from typing import Callable, Optional
import time

class ToolRiskLevel(Enum):
    """工具风险等级"""
    READ_ONLY = "read_only"
    WRITE = "write"
    DESTRUCTIVE = "destructive"

class ConfirmationMechanism(Enum):
    """确认机制"""
    NONE = "none"
    SOFT_CONFIRM = "soft_confirm"
    HARD_CONFIRM = "hard_confirm"
    MFA_CONFIRM = "mfa_confirm"


@dataclass
class SecureToolDefinition:
    """带安全属性的工具定义"""
    name: str
    description: str
    parameters: dict
    function: Callable
    risk_level: ToolRiskLevel
    confirmation_mechanism: ConfirmationMechanism
    requires_audit_log: bool = True
    allowed_users: Optional[list[str]] = None
    rate_limit: Optional[dict] = None


class PermissionManager:
    """权限管理器"""

    def __init__(self):
        self._tools: dict[str, SecureToolDefinition] = {}
        self._audit_log: list[dict] = []

    def register_tool(self, tool_def: SecureToolDefinition):
        """注册工具及其安全属性"""
        self._tools[tool_def.name] = tool_def

    def can_execute(self, tool_name: str, user_id: str) -> tuple[bool, Optional[str]]:
        """检查用户是否有权执行工具"""
        if tool_name not in self._tools:
            return False, f"工具不存在: {tool_name}"

        tool = self._tools[tool_name]

        if tool.allowed_users and user_id not in tool.allowed_users:
            return False, f"用户 {user_id} 无权执行工具 {tool_name}"

        if tool.rate_limit:
            is_within_limit, msg = self._check_rate_limit(tool_name, user_id, tool.rate_limit)
            if not is_within_limit:
                return False, msg

        return True, None

    def should_confirm_before_execute(self, tool_name: str) -> tuple[ConfirmationMechanism, str]:
        """检查是否需要在执行前确认"""
        if tool_name not in self._tools:
            return ConfirmationMechanism.NONE, ""

        tool = self._tools[tool_name]

        confirmations = {
            ConfirmationMechanism.NONE: ("无需确认", ""),
            ConfirmationMechanism.SOFT_CONFIRM: (
                "工具执行提示",
                f"即将执行工具: {tool.name}。{tool.description}"
            ),
            ConfirmationMechanism.HARD_CONFIRM: (
                "需要用户确认",
                f"警告：这是一个 {tool.risk_level.value} 级别的操作。请明确确认是否继续执行。"
            ),
            ConfirmationMechanism.MFA_CONFIRM: (
                "需要多因素认证",
                f"警告：执行此操作前需要多因素认证。操作名称: {tool.name}"
            ),
        }

        mechanism = tool.confirmation_mechanism
        title, msg = confirmations[mechanism]
        return mechanism, msg

    def log_execution(self, tool_name: str, user_id: str, arguments: dict, result: dict):
        """记录工具执行日志（用于审计）"""
        if tool_name not in self._tools:
            return

        tool = self._tools[tool_name]
        if tool.requires_audit_log:
            self._audit_log.append({
                "timestamp": time.time(),
                "tool_name": tool_name,
                "user_id": user_id,
                "arguments": arguments,
                "result": result,
                "risk_level": tool.risk_level.value,
            })

    def _check_rate_limit(self, tool_name: str, user_id: str, limit_config: dict) -> tuple[bool, str]:
        """检查速率限制"""
        calls_per_minute = limit_config.get("calls_per_minute", float("inf"))
        recent_calls = len([
            log for log in self._audit_log
            if log["tool_name"] == tool_name and log["user_id"] == user_id
        ])

        if recent_calls > calls_per_minute:
            return False, f"工具 {tool_name} 执行次数超过每分钟限制 ({calls_per_minute})"

        return True, ""
```

---

## 10. 并行工具调用的依赖管理

Tool Calling 支持在单次 LLM 调用中返回多个工具调用（并行调用）。然而，工具之间可能存在隐含的依赖关系——比如必须先查询订单详情，才能执行退款操作。识别和管理这些依赖对于确保执行的正确性至关重要。

### 10.1 依赖类型

```python
from enum import Enum
from dataclasses import dataclass
from typing import Optional, Set

class DependencyType(Enum):
    """依赖类型"""
    DATA_DEPENDENCY = "data"
    ORDER_DEPENDENCY = "order"
    MUTEX_DEPENDENCY = "mutex"

@dataclass
class ToolDependency:
    """工具依赖关系"""
    dependent_tool: str
    required_tool: str
    dependency_type: DependencyType
    extract_param: Optional[str] = None


dependencies = [
    ToolDependency(
        dependent_tool="process_refund",
        required_tool="get_order_detail",
        dependency_type=DependencyType.DATA_DEPENDENCY,
        extract_param="order_id"
    ),
    ToolDependency(
        dependent_tool="send_email",
        required_tool="get_user_info",
        dependency_type=DependencyType.DATA_DEPENDENCY,
        extract_param="email"
    ),
    ToolDependency(
        dependent_tool="update_file_record",
        required_tool="delete_file",
        dependency_type=DependencyType.ORDER_DEPENDENCY,
    ),
    ToolDependency(
        dependent_tool="update_user_profile",
        required_tool="delete_user_account",
        dependency_type=DependencyType.MUTEX_DEPENDENCY,
    ),
]
```

### 10.2 依赖图构建与拓扑排序

```python
from collections import defaultdict, deque

class DependencyGraph:
    """工具依赖图"""

    def __init__(self):
        self.graph: dict[str, Set[str]] = defaultdict(set)
        self.dependencies: dict[tuple[str, str], ToolDependency] = {}
        self.in_degree: dict[str, int] = defaultdict(int)

    def add_dependency(self, dep: ToolDependency):
        """添加依赖关系"""
        key = (dep.dependent_tool, dep.required_tool)
        self.dependencies[key] = dep

        if dep.dependency_type in (DependencyType.DATA_DEPENDENCY, DependencyType.ORDER_DEPENDENCY):
            self.graph[dep.required_tool].add(dep.dependent_tool)
            self.in_degree[dep.dependent_tool] += 1

    def topological_sort(self, tools: list[str]) -> tuple[bool, list[str]]:
        """拓扑排序：返回 (是否有环, 排序后的工具列表)"""
        in_degree = defaultdict(int)
        for tool in tools:
            in_degree[tool] = 0

        for tool in tools:
            for neighbor in self.graph.get(tool, set()):
                if neighbor in in_degree:
                    in_degree[neighbor] += 1

        queue = deque([tool for tool in tools if in_degree[tool] == 0])
        sorted_tools = []

        while queue:
            tool = queue.popleft()
            sorted_tools.append(tool)

            for neighbor in self.graph.get(tool, set()):
                if neighbor in in_degree:
                    in_degree[neighbor] -= 1
                    if in_degree[neighbor] == 0:
                        queue.append(neighbor)

        if len(sorted_tools) != len(tools):
            return False, []

        return True, sorted_tools

    def get_parallel_layers(self, tools: list[str]) -> list[list[str]]:
        """将工具分层，同一层可以并行执行"""
        is_acyclic, sorted_tools = self.topological_sort(tools)
        if not is_acyclic:
            raise ValueError("工具依赖图中存在循环依赖")

        level = {tool: 0 for tool in tools}

        for tool in sorted_tools:
            for neighbor in self.graph.get(tool, set()):
                if neighbor in level:
                    level[neighbor] = max(level[neighbor], level[tool] + 1)

        max_level = max(level.values()) if level else 0
        layers = [[] for _ in range(max_level + 1)]
        for tool, lv in level.items():
            layers[lv].append(tool)

        return [layer for layer in layers if layer]


dep_graph = DependencyGraph()
for dep in dependencies:
    dep_graph.add_dependency(dep)

tool_calls = ["get_order_detail", "get_user_info", "process_refund", "send_email"]

try:
    parallel_layers = dep_graph.get_parallel_layers(tool_calls)
    print("执行计划:")
    for i, layer in enumerate(parallel_layers):
        print(f"  第 {i+1} 层（可并行）: {layer}")
except ValueError as e:
    print(f"依赖错误: {e}")
```

### 10.3 依赖感知的执行器

```python
from concurrent.futures import ThreadPoolExecutor, as_completed
import json

class DependencyAwareDispatcher:
    """依赖感知的工具调度器"""

    def __init__(self, registry, dep_graph: DependencyGraph):
        self.registry = registry
        self.dep_graph = dep_graph
        self.execution_results: dict[str, dict] = {}

    def execute_with_dependencies(self, tool_calls: list[dict]) -> list[dict]:
        """根据依赖关系执行工具，支持分层并行"""
        tool_names = [tc["function"]["name"] for tc in tool_calls]

        try:
            parallel_layers = self.dep_graph.get_parallel_layers(tool_names)
        except ValueError as e:
            return [{
                "tool_call_id": tc.get("id"),
                "role": "tool",
                "content": json.dumps({"error": f"依赖错误: {e}"})
            } for tc in tool_calls]

        results = []
        id_to_tc = {tc.get("id"): tc for tc in tool_calls}

        for layer in parallel_layers:
            layer_calls = [id_to_tc[id] for id in layer if id in id_to_tc]

            prepared_calls = []
            for tc in layer_calls:
                tool_name = tc["function"]["name"]
                tool = self.registry.get_tool(tool_name)
                arguments = self._inject_dependencies(tool_name, tc["function"]["arguments"])
                tc_modified = tc.copy()
                tc_modified["function"]["arguments"] = arguments
                prepared_calls.append(tc_modified)

            layer_results = []
            with ThreadPoolExecutor(max_workers=min(5, len(prepared_calls))) as executor:
                futures = {
                    executor.submit(self._execute_single_with_result_store, tc): tc
                    for tc in prepared_calls
                }
                for future in as_completed(futures):
                    layer_results.append(future.result())

            results.extend(layer_results)

        return results

    def _inject_dependencies(self, tool_name: str, arguments: dict) -> dict:
        """从已执行的结果中提取数据，注入到当前工具的参数中"""
        modified_args = arguments.copy()

        for (dependent, required), dep in self.dep_graph.dependencies.items():
            if dependent == tool_name and dep.dependency_type == DependencyType.DATA_DEPENDENCY:
                if required in self.execution_results:
                    result = self.execution_results[required]
                    if dep.extract_param and "error" not in result:
                        extracted_value = result.get(dep.extract_param)
                        if extracted_value is not None:
                            modified_args[dep.extract_param] = extracted_value

        return modified_args

    def _execute_single_with_result_store(self, tc: dict) -> dict:
        """执行单个工具并存储结果"""
        tool_name = tc["function"]["name"]
        tool = self.registry.get_tool(tool_name)

        try:
            arguments = json.loads(tc["function"]["arguments"]) if isinstance(tc["function"]["arguments"], str) else tc["function"]["arguments"]
            result = tool.function(**arguments)
            self.execution_results[tool_name] = result

            return {
                "tool_call_id": tc.get("id"),
                "role": "tool",
                "content": json.dumps(result, ensure_ascii=False),
            }
        except Exception as e:
            error_result = {"error": f"工具执行失败: {e}"}
            self.execution_results[tool_name] = error_result
            return {
                "tool_call_id": tc.get("id"),
                "role": "tool",
                "content": json.dumps(error_result),
            }
```

---

## 11. 工具 Schema 版本控制

Tool Calling 生态中的工具定义会随着功能迭代而变化。参数的添加、删除、类型变更都会影响工具的契约。如何优雅地管理这些版本变化，使得新旧客户端能共存，是生产系统的关键问题。

### 11.1 语义化版本号策略

采用 **语义化版本 (Semantic Versioning)**：`MAJOR.MINOR.PATCH`

- **MAJOR**：破坏性变更（Breaking Changes）
- **MINOR**：向后兼容的新增功能
- **PATCH**：向后兼容的错误修复

```python
from dataclasses import dataclass
import re

@dataclass
class ToolSchema:
    """带版本号的工具 Schema"""
    name: str
    version: str
    description: str
    parameters: dict
    function: callable
    changelog: list[str] = None

    def __post_init__(self):
        if not self._validate_semver():
            raise ValueError(f"无效的版本号: {self.version}")

    def _validate_semver(self) -> bool:
        """验证语义化版本号格式"""
        pattern = r"^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$"
        return bool(re.match(pattern, self.version))

    def get_major_version(self) -> int:
        return int(self.version.split(".")[0])

    def get_minor_version(self) -> int:
        return int(self.version.split(".")[1])

    def get_patch_version(self) -> int:
        return int(self.version.split(".")[2])
```

### 11.2 Breaking Change 自动检测

```python
from typing import Any, Tuple

class SchemaComparator:
    """Schema 变更检测器"""

    @staticmethod
    def compare_schemas(old: dict, new: dict) -> Tuple[bool, list[str]]:
        """比较两个 Schema，返回 (是否为 Breaking Change, 变更列表)"""
        breaking_changes = []
        changes = []

        old_props = old.get("properties", {})
        new_props = new.get("properties", {})
        old_required = set(old.get("required", []))
        new_required = set(new.get("required", []))

        removed_required = old_required - new_required
        added_required = new_required - old_required

        for param in removed_required:
            changes.append(f"✓ 参数 '{param}' 从必填改为非必填（向后兼容）")

        for param in added_required:
            breaking_changes.append(f"✗ 新增必填参数 '{param}'（Breaking Change）")

        removed_params = set(old_props.keys()) - set(new_props.keys())
        for param in removed_params:
            breaking_changes.append(f"✗ 删除参数 '{param}'（Breaking Change）")

        for param in old_props:
            if param in new_props:
                old_type = old_props[param].get("type")
                new_type = new_props[param].get("type")

                if old_type != new_type:
                    breaking_changes.append(
                        f"✗ 参数 '{param}' 类型变更: {old_type} → {new_type}（Breaking Change）"
                    )

        for param in old_props:
            if param in new_props:
                old_enum = set(old_props[param].get("enum", []))
                new_enum = set(new_props[param].get("enum", []))

                removed_values = old_enum - new_enum
                if removed_values:
                    breaking_changes.append(
                        f"✗ 参数 '{param}' 的允许值删除: {removed_values}（Breaking Change）"
                    )

        new_params = set(new_props.keys()) - set(old_props.keys())
        for param in new_params:
            if param not in new_required:
                changes.append(f"✓ 新增可选参数 '{param}'（向后兼容）")

        is_breaking = len(breaking_changes) > 0
        all_changes = breaking_changes + changes

        return is_breaking, all_changes
```

### 11.3 灰度发布与多版本共存

```python
from datetime import datetime, timedelta

class VersionedToolRegistry:
    """支持多版本的工具注册中心"""

    def __init__(self):
        self._tools: dict[str, dict[str, ToolSchema]] = {}
        self._default_version: dict[str, str] = {}
        self._deprecation_schedule: dict[str, datetime] = {}

    def register_version(self, schema: ToolSchema, is_default: bool = False):
        """注册工具的某个版本"""
        if schema.name not in self._tools:
            self._tools[schema.name] = {}

        self._tools[schema.name][schema.version] = schema

        if is_default or not self._default_version.get(schema.name):
            self._default_version[schema.name] = schema.version

    def deprecate_version(self, tool_name: str, version: str, sunset_date: datetime):
        """标记工具版本为弃用"""
        key = f"{tool_name}@{version}"
        self._deprecation_schedule[key] = sunset_date

    def get_tool_version(self, tool_name: str, version: str = None) -> ToolSchema:
        """获取指定版本的工具"""
        if tool_name not in self._tools:
            raise ValueError(f"工具 '{tool_name}' 不存在")

        if version is None:
            version = self._default_version[tool_name]

        versions = self._tools[tool_name]
        if version not in versions:
            raise ValueError(f"工具 '{tool_name}' 版本 '{version}' 不存在")

        schema = versions[version]
        key = f"{tool_name}@{version}"

        if key in self._deprecation_schedule:
            sunset = self._deprecation_schedule[key]
            now = datetime.now()

            if now > sunset:
                default_version = self._default_version[tool_name]
                return versions[default_version]
            else:
                days_left = (sunset - now).days
                schema._deprecation_warning = (
                    f"版本 {version} 将在 {days_left} 天后弃用。"
                    f"请升级到版本 {self._default_version[tool_name]}"
                )

        return schema

    def get_all_available_versions(self, tool_name: str) -> dict[str, dict]:
        """获取工具的所有可用版本及其状态"""
        if tool_name not in self._tools:
            return {}

        versions = {}
        now = datetime.now()

        for version, schema in self._tools[tool_name].items():
            key = f"{tool_name}@{version}"
            status = "available"

            if key in self._deprecation_schedule:
                sunset = self._deprecation_schedule[key]
                if now > sunset:
                    status = "expired"
                else:
                    status = "deprecated"

            versions[version] = {
                "description": schema.description,
                "status": status,
                "is_default": version == self._default_version.get(tool_name),
            }

        return versions

    def get_definitions(self, tool_names: list[str] = None, version: str = None) -> list[dict]:
        """获取工具定义列表，可以指定工具名和版本"""
        definitions = []
        tools = self._tools if tool_names is None else {
            name: self._tools[name] for name in tool_names if name in self._tools
        }

        for tool_name, versions in tools.items():
            try:
                schema = self.get_tool_version(tool_name, version)
                definitions.append({
                    "type": "function",
                    "function": {
                        "name": f"{schema.name}@{schema.version}",
                        "description": schema.description,
                        "parameters": schema.parameters,
                    }
                })
            except ValueError:
                pass

        return definitions
```

---

## 12. 工具选择策略的量化对比

在实际工程中，工具数量的增长必然导致性能与准确性的 Trade-off。我们通过量化实验对比三种常见的工具选择策略在不同规模下的表现。

### 12.1 三种策略概述

| 策略 | 原理 | Token 成本 | 延迟 | 准确率 |
|------|------|----------|------|--------|
| **全量注入** | 将所有工具定义传给 LLM | O(n) | 低 | 高（工具少时） |
| **关键词预筛选** | 用简单字符串匹配预筛选工具 | O(k)（k << n） | 最低 | 中（易误筛） |
| **向量相似度检索** | 用 Embedding 计算用户输入与工具描述的语义相似度 | O(k) | 中 | 高（需要好的 Embedding 模型） |

### 12.2 量化实验对比

以下是模拟实验的结果。假设：
- 工具总数：5、20、100、500
- 每个工具定义平均：300 tokens
- Embedding 检索成本：50 tokens
- 用户输入平均：50 tokens

```python
class ToolSelectionBenchmark:
    """工具选择策略性能基准测试"""

    def __init__(self):
        self.results = []

    def benchmark_full_injection(self, num_tools: int) -> dict:
        """全量注入：所有工具都传给 LLM"""
        tool_definition_tokens = num_tools * 300
        user_input_tokens = 50
        total_input_tokens = tool_definition_tokens + user_input_tokens

        llm_calls = 2
        total_llm_tokens = total_input_tokens * llm_calls

        latency_ms = (tool_definition_tokens // 100) * 10 + 500

        if num_tools <= 10:
            accuracy = 0.95
        elif num_tools <= 20:
            accuracy = 0.90
        elif num_tools <= 50:
            accuracy = 0.80
        else:
            accuracy = 0.60

        return {
            "strategy": "全量注入",
            "num_tools": num_tools,
            "input_tokens_per_call": total_input_tokens,
            "total_llm_tokens": total_llm_tokens,
            "llm_calls": llm_calls,
            "latency_ms": latency_ms,
            "accuracy": accuracy,
            "cost_score": total_llm_tokens * 0.001,
        }

    def benchmark_keyword_filtering(self, num_tools: int) -> dict:
        """关键词预筛选"""
        selected_tools = min(10, max(3, num_tools // 10))
        tool_definition_tokens = selected_tools * 300
        filtering_tokens = 50
        user_input_tokens = 50
        total_input_tokens = tool_definition_tokens + user_input_tokens

        llm_calls = 2
        total_llm_tokens = total_input_tokens * llm_calls + filtering_tokens

        latency_ms = 10 + 400

        accuracy = max(0.50, 0.95 - (num_tools / 200))

        return {
            "strategy": "关键词预筛选",
            "num_tools": num_tools,
            "selected_tools": selected_tools,
            "input_tokens_per_call": total_input_tokens,
            "total_llm_tokens": total_llm_tokens,
            "llm_calls": llm_calls,
            "latency_ms": latency_ms,
            "accuracy": accuracy,
            "cost_score": total_llm_tokens * 0.001,
        }

    def benchmark_semantic_retrieval(self, num_tools: int) -> dict:
        """向量相似度检索"""
        selected_tools = min(10, max(5, num_tools // 20))
        tool_definition_tokens = selected_tools * 300
        embedding_tokens = 50
        user_input_tokens = 50
        total_input_tokens = tool_definition_tokens + user_input_tokens

        llm_calls = 2
        total_llm_tokens = total_input_tokens * llm_calls + embedding_tokens

        latency_ms = 200 + 400

        if num_tools <= 20:
            accuracy = 0.92
        elif num_tools <= 100:
            accuracy = 0.88
        else:
            accuracy = 0.85

        return {
            "strategy": "向量相似度检索",
            "num_tools": num_tools,
            "selected_tools": selected_tools,
            "input_tokens_per_call": total_input_tokens,
            "total_llm_tokens": total_llm_tokens,
            "llm_calls": llm_calls,
            "latency_ms": latency_ms,
            "accuracy": accuracy,
            "cost_score": total_llm_tokens * 0.001,
        }

    def run_benchmark(self, num_tools_list: list) -> list:
        """运行完整基准测试"""
        results = []

        for num_tools in num_tools_list:
            full = self.benchmark_full_injection(num_tools)
            keyword = self.benchmark_keyword_filtering(num_tools)
            semantic = self.benchmark_semantic_retrieval(num_tools)

            results.append({
                "num_tools": num_tools,
                "full_injection": full,
                "keyword_filtering": keyword,
                "semantic_retrieval": semantic,
            })

        return results


benchmark = ToolSelectionBenchmark()
results = benchmark.run_benchmark([5, 20, 100, 500])
```

### 12.3 结论与建议

基于量化对比，我们有以下建议：

| 工具规模 | 推荐策略 | Token 成本 | 延迟 | 准确率 | 实施难度 |
|---------|---------|----------|------|--------|---------|
| **5-10** | 全量注入 | 低 | 低 | 95%+ | 最简单 |
| **10-50** | 全量注入 + 优化描述 | 低-中 | 低 | 85-95% | 简单 |
| **50-200** | 向量相似度检索 | 中 | 中 | 85-90% | 中等 |
| **200+** | 两阶段选择 或 多 Agent 拆分 | 中-高 | 中 | 90%+ | 复杂 |

**关键洞察**：

1. **不要过度优化早期系统**。在工具数量 < 20 的阶段，全量注入就足够了。
2. **描述质量的影响超过预期**。一个好的工具描述能将准确率从 60% 提升到 90%。
3. **向量检索的成本常被低估**。Embedding 调用的固定开销在小规模工具时反而不划算。
4. **两阶段选择是工具数量 > 100 时的最优方案**。

---
## 13. Trade-off 分析

### 13.1 工具数量 vs 选择准确率

![工具数量 vs 选择准确率](/images/blog/agentic-05/tool-count-vs-accuracy.svg)

- **< 10 个工具**：全量传递，不需要过滤。
- **10-20 个工具**：准确率开始下降，可通过优化 description 缓解。
- **> 20 个工具**：必须引入 Tool Selection 策略（语义过滤或两阶段选择）。
- **> 50 个工具**：两阶段选择几乎是唯一可行方案，或者按领域拆分为多个 Agent。

### 13.2 工具描述详细度 vs Token 消耗

每个工具定义大约占用 100-500 token（取决于描述长度和参数数量）。20 个工具就是 2000-10000 token 的系统开销，这是每次 API 调用都要付出的 **固定成本**。

![工具描述详细度 vs Token 消耗](/images/blog/agentic-05/description-detail-vs-token.svg)

实践建议：
- 工具 `name` 起好名字（零额外 token 成本，但信息量大）
- `description` 控制在 2-3 句话
- 参数的 `description` 控制在 1 句话 + 1 个示例
- 用 `enum` 和 `required` 代替冗长的文字约束

### 13.3 确定性执行 vs LLM 灵活性

![确定性 vs 灵活性](/images/blog/agentic-05/determinism-vs-flexibility.svg)

决策框架：

| 场景特征 | 推荐方案 |
|---------|---------|
| 流程固定、合规要求高 | 硬编码工作流 + Tool Calling 作为执行层 |
| 意图模糊、工具组合多变 | 完全由 LLM 驱动的 Tool Calling |
| 核心路径固定、边缘场景多 | 混合方案：主流程硬编码，长尾交给 LLM |

关键洞察：Tool Calling 不是非此即彼的选择。你可以让 LLM 决定 **是否** 调用工具，但用代码控制 **调用后的流程**。比如 LLM 决定"需要查天气"，但查完天气后的处理逻辑是确定性的代码。

---

## 14. 常见陷阱

在实际工程中，以下几个坑值得提前规避：

**1. 工具描述与实际行为不一致**

工具描述说"返回最近 30 天的订单"，但实际实现返回所有订单。LLM 会基于描述做出错误假设，导致下游逻辑出错。**描述就是契约，必须与实现严格一致**。

**2. 忽略工具结果的 Token 消耗**

工具返回的结果会作为下一轮消息传给 LLM。如果一个数据库查询返回了 1000 行数据，这些数据全部变成 input token。务必在工具层面限制返回数据量。

```python
def query_database(sql: str, database: str = "default") -> dict:
    results = _execute_query(sql, database)
    # 限制返回行数，避免 token 爆炸
    if len(results) > 50:
        return {
            "rows": results[:50],
            "total_count": len(results),
            "truncated": True,
            "message": f"结果共 {len(results)} 行，仅返回前 50 行"
        }
    return {"rows": results, "total_count": len(results)}
```

**3. 缺少 stop condition**

如果 LLM 反复调用同一个工具（比如因为错误一直重试），而没有最大迭代次数限制，系统会陷入无限循环。前面代码中的 `max_iterations` 参数就是为此设计的。

**4. 并行调用的顺序依赖**

LLM 可能在一次回复中请求并行调用两个工具，但这两个工具之间有隐含的顺序依赖（比如先查用户 ID，再用这个 ID 查订单）。Runtime 需要能识别这种情况，或者在工具描述中引导 LLM 分步调用。

---

## 15. 总结与展望

Tool Calling 的本质是一个精心设计的 **协议**：

![Tool Calling 架构与协议](/images/blog/agentic-05/tool-calling-architecture.svg)

- **LLM** 负责理解意图、选择工具、生成参数——它是决策者。
- **Runtime** 负责验证、路由、执行、错误处理——它是执行者。
- **Tools** 是具体的能力——它们是能力的载体。
- **JSON Schema** 是三者之间的契约——它定义了什么可以做、怎么做。

理解了这个架构，你就能在任何框架（LangChain、LlamaIndex、Semantic Kernel，或者自己写的 Runtime）上实现 Tool Calling，因为底层原理是相同的。

但 Tool Calling 只是让 Agent 有了"手"。要让 Agent 真正好用，还需要精心设计的 Prompt 来引导 LLM 的决策——什么时候该调工具、什么时候该直接回答、遇到错误该怎么处理、多个工具之间如何协调。
