---
title: "Agent Runtime from Scratch: 不依赖框架构建 Agent"
description: "不依赖 LangChain 等框架，从零实现一个功能完整的 Agent Runtime。逐模块构建 LLMClient、ToolRegistry、ToolExecutor、MessageManager 和核心控制循环，包含并行工具调用、Streaming、超时控制、死循环检测等高级特性，附完整可运行代码。"
pubDate: "2025-12-28"
tags: ["Agentic", "AI Engineering", "Runtime"]
---

# Agent Runtime from Scratch: 不依赖框架构建 Agent

> 框架是加速器，不是知识的替代品。
>
> 本文是 Agentic 系列第 07 篇，也是 Phase 2 的收官之作。我们将抛开所有框架，用纯 Python 从零构建一个功能完整的 Agent Runtime。这是系列中代码量最大的一篇——每一行代码都指向同一个目标：让你彻底理解 Agent 的运行本质。

---

## 1. 为什么要自己写 Agent Runtime？

前几篇我们理解了控制循环（第 04 篇）、Tool Calling（第 05 篇）、Prompt 工程（第 06 篇）。但这些还停留在概念层面。现在的问题是：**不用 LangChain、不用 LangGraph——你能写出一个 Agent 吗？**

自建 Runtime 的价值：

- **透明性**：每一行代码你都清楚，出了问题知道往哪里看
- **可控性**：精确控制重试策略、超时机制、消息压缩、工具调度，而不被框架的默认行为绑架
- **本质理解**：理解了 Runtime 本质，用任何框架时都能一眼看出它在做什么、哪里做得不好

更现实的原因：**生产环境中很多 Agent 系统最终都走向了自研**。框架在 PoC 阶段很方便，但到了需要精细控制 Token 成本、自定义 Observability、与内部基础设施深度集成时，框架往往成为障碍。

---

## 2. 架构设计

```
┌───────────────────────────────────────────────────┐
│                   AgentRuntime                     │
│                (Core Control Loop)                 │
│                                                    │
│  ┌────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ LLMClient  │  │MessageManager│  │ StateStore │ │
│  │ chat()     │  │ append()     │  │ save()     │ │
│  │ stream()   │  │ compress()   │  │ load()     │ │
│  │ retry()    │  │ count_tokens │  │ clear()    │ │
│  └─────┬──────┘  └──────┬───────┘  └───────────┘ │
│        │                │                          │
│        ▼                ▼                          │
│  ┌────────────────────────────────────┐            │
│  │          Runtime Loop              │            │
│  │  while not done and turns < max:   │            │
│  │    response = llm.chat(messages)   │            │
│  │    if tool_calls:                  │            │
│  │      results = executor.run()      │            │
│  │    else: done = True               │            │
│  └──────────┬─────────────────────────┘            │
│       ┌─────┴──────┐                               │
│       ▼            ▼                                │
│  ┌──────────┐ ┌────────────┐                       │
│  │ToolRegist│ │ToolExecutor│                       │
│  │ register │ │ execute()  │                       │
│  │ schema() │ │ parallel() │                       │
│  └──────────┘ └────────────┘                       │
└───────────────────────────────────────────────────┘
```

**核心设计原则——职责分离**：

| 模块 | 职责 | 边界 |
|------|------|------|
| `LLMClient` | 封装模型调用，处理重试 | 只管"调 API"，不管消息历史 |
| `ToolRegistry` | 注册工具，生成 JSON Schema | 只管"有哪些工具"，不管怎么调 |
| `ToolExecutor` | 解析 tool_calls，分发执行 | 只管"执行工具"，不管谁触发的 |
| `MessageManager` | 管理消息列表，Token 计数和压缩 | 只管"消息"，不管消息从哪来 |
| `AgentRuntime` | 组装一切，驱动控制循环 | 只管"编排"，不自己做具体事 |

任何模块可独立替换。换 Anthropic API？只改 `LLMClient`。状态存 Redis？只改 `StateStore`。Runtime 本身不需要变动。

---

## 3. 逐步构建

### Step 1: LLMClient — 封装模型调用

封装 OpenAI 兼容接口，支持 `tools` / `tool_choice`，处理流式/非流式，实现指数退避重试。

```python
# llm_client.py
import time, json, logging
from dataclasses import dataclass, field
from typing import Optional, Generator
from openai import OpenAI, APIError, RateLimitError, APITimeoutError

logger = logging.getLogger(__name__)

@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict

@dataclass
class LLMResponse:
    content: Optional[str] = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: dict = field(default_factory=dict)
    finish_reason: str = ""

    @property
    def has_tool_calls(self) -> bool:
        return len(self.tool_calls) > 0

class LLMClient:
    RETRYABLE_ERRORS = (RateLimitError, APITimeoutError, APIError)

    def __init__(self, model="gpt-4o", base_url=None, api_key=None,
                 max_retries=3, retry_base_delay=1.0, timeout=60.0):
        self.model = model
        self.max_retries = max_retries
        self.retry_base_delay = retry_base_delay
        self.client = OpenAI(base_url=base_url, api_key=api_key, timeout=timeout)

    def chat(self, messages, tools=None, tool_choice="auto", temperature=0.0):
        kwargs = {"model": self.model, "messages": messages,
                  "temperature": temperature}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice
        raw = self._call_with_retry(**kwargs)
        return self._parse_response(raw)

    def stream(self, messages, tools=None, tool_choice="auto",
               temperature=0.0) -> Generator[LLMResponse, None, None]:
        kwargs = {"model": self.model, "messages": messages,
                  "temperature": temperature, "stream": True}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice

        accumulated_tool_calls: dict[int, dict] = {}
        for chunk in self._call_with_retry(**kwargs):
            delta = chunk.choices[0].delta if chunk.choices else None
            if not delta:
                continue
            if delta.content:
                yield LLMResponse(content=delta.content)
            # 流式下 tool_calls 分片到达，需要累积拼装
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in accumulated_tool_calls:
                        accumulated_tool_calls[idx] = {
                            "id": "", "name": "", "arguments": ""}
                    if tc.id: accumulated_tool_calls[idx]["id"] = tc.id
                    if tc.function.name:
                        accumulated_tool_calls[idx]["name"] = tc.function.name
                    if tc.function.arguments:
                        accumulated_tool_calls[idx]["arguments"] += \
                            tc.function.arguments

        if accumulated_tool_calls:
            tool_calls = []
            for d in accumulated_tool_calls.values():
                args = json.loads(d["arguments"]) if d["arguments"] else {}
                tool_calls.append(ToolCall(d["id"], d["name"], args))
            yield LLMResponse(tool_calls=tool_calls)

    def _call_with_retry(self, **kwargs):
        last_error = None
        for attempt in range(self.max_retries + 1):
            try:
                return self.client.chat.completions.create(**kwargs)
            except self.RETRYABLE_ERRORS as e:
                last_error = e
                if attempt < self.max_retries:
                    delay = self.retry_base_delay * (2 ** attempt)
                    logger.warning(f"Retry {attempt+1} in {delay}s: {e}")
                    time.sleep(delay)
        raise last_error

    def _parse_response(self, raw) -> LLMResponse:
        choice = raw.choices[0]
        msg = choice.message
        tool_calls = []
        if msg.tool_calls:
            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments) \
                    if tc.function.arguments else {}
                tool_calls.append(ToolCall(tc.id, tc.function.name, args))
        return LLMResponse(
            content=msg.content, tool_calls=tool_calls,
            usage={"prompt_tokens": raw.usage.prompt_tokens,
                   "completion_tokens": raw.usage.completion_tokens,
                   "total_tokens": raw.usage.total_tokens},
            finish_reason=choice.finish_reason)
```

**关键设计决策**：

1. **统一 `LLMResponse`**：无论底层用什么模型，Runtime 只看到同一结构——适配器模式。
2. **重试只针对可恢复错误**：`RateLimitError` 值得重试，`AuthenticationError` 重试一万次也没用。
3. **流式 tool_calls 累积拼装**：OpenAI 把 tool_calls 拆成多个 chunk（先发 name，再逐步发 arguments），必须在客户端拼装。这是容易踩的坑。

---

### Step 2: ToolRegistry — 工具注册与发现

用装饰器注册函数，通过 type hints 和 docstring 自动生成 OpenAI 格式的 JSON Schema。

```python
# tool_registry.py
import inspect, json
from typing import Any, Callable, Optional, get_type_hints

TYPE_MAP = {str: "string", int: "integer", float: "number",
            bool: "boolean", list: "array", dict: "object"}

class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Callable] = {}
        self._schemas: dict[str, dict] = {}

    def tool(self, name=None, description=None):
        """装饰器注册工具"""
        def decorator(func):
            n = name or func.__name__
            d = description or (func.__doc__ or "").strip().split("\n")[0]
            self._tools[n] = func
            self._schemas[n] = self._gen_schema(func, n, d)
            return func
        return decorator

    def register(self, func, name=None, description=None):
        """命令式注册（适用于无法加装饰器的场景）"""
        n = name or func.__name__
        d = description or (func.__doc__ or "").strip().split("\n")[0]
        self._tools[n] = func
        self._schemas[n] = self._gen_schema(func, n, d)

    def get_function(self, name): return self._tools.get(name)
    def get_all_schemas(self): return list(self._schemas.values())
    def list_tools(self): return list(self._tools.keys())

    def _gen_schema(self, func, name, description):
        sig = inspect.signature(func)
        hints = get_type_hints(func)
        properties, required = {}, []
        for pname, param in sig.parameters.items():
            if pname in ("self", "cls"): continue
            ptype = hints.get(pname, str)
            prop = {"type": TYPE_MAP.get(ptype, "string")}
            # 从 Google 风格 docstring 提取参数描述
            pdesc = self._param_desc(func, pname)
            if pdesc: prop["description"] = pdesc
            properties[pname] = prop
            if param.default is inspect.Parameter.empty:
                required.append(pname)
        return {"type": "function", "function": {
            "name": name, "description": description,
            "parameters": {"type": "object",
                           "properties": properties, "required": required}}}

    @staticmethod
    def _param_desc(func, param_name):
        doc = func.__doc__ or ""
        in_args = False
        for line in doc.split("\n"):
            s = line.strip()
            if s.lower().startswith("args:"): in_args = True; continue
            if in_args and param_name + ":" in s:
                return s.split(":", 1)[1].strip()
        return ""
```

验证效果：

```python
registry = ToolRegistry()

@registry.tool()
def web_search(query: str, max_results: int = 5) -> str:
    """搜索网页内容
    Args:
        query: 搜索关键词
        max_results: 最大返回结果数量
    """
    return f"Results for: {query}"

# 输出 OpenAI 格式的 tool schema
# {"type":"function","function":{"name":"web_search","description":"搜索网页内容",
#  "parameters":{"type":"object","properties":{"query":{"type":"string",
#  "description":"搜索关键词"},"max_results":{"type":"integer",
#  "description":"最大返回结果数量"}},"required":["query"]}}}
```

---

### Step 3: ToolExecutor — 工具执行与结果处理

接收 LLM 返回的 `tool_calls`，分发执行，收集结果，处理异常。支持串行和并行两种模式。

```python
# tool_executor.py
import json, time, logging, traceback
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FTE
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class ToolResult:
    tool_call_id: str
    name: str
    result: str
    success: bool
    duration_ms: float = 0.0

class ToolExecutor:
    def __init__(self, registry, default_timeout=30.0, max_workers=4):
        self.registry = registry
        self.default_timeout = default_timeout
        self.max_workers = max_workers

    def execute(self, tool_calls) -> list[ToolResult]:
        """串行执行"""
        return [self._run_one(tc) for tc in tool_calls]

    def execute_parallel(self, tool_calls) -> list[ToolResult]:
        """并行执行（LLM 一次返回多个 tool_calls 时使用）"""
        if len(tool_calls) <= 1:
            return self.execute(tool_calls)
        results = []
        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            futures = {pool.submit(self._run_one, tc): tc for tc in tool_calls}
            for fut in futures:
                try:
                    results.append(fut.result(timeout=self.default_timeout))
                except FTE:
                    tc = futures[fut]
                    results.append(ToolResult(
                        tc.id, tc.name,
                        f"Error: '{tc.name}' timed out after "
                        f"{self.default_timeout}s", False))
        return results

    def _run_one(self, tool_call) -> ToolResult:
        start = time.monotonic()
        func = self.registry.get_function(tool_call.name)
        if not func:
            return ToolResult(tool_call.id, tool_call.name,
                f"Error: Unknown tool '{tool_call.name}'. "
                f"Available: {self.registry.list_tools()}", False)
        try:
            result = func(**tool_call.arguments)
            if not isinstance(result, str):
                result = json.dumps(result, ensure_ascii=False, default=str)
            ms = (time.monotonic() - start) * 1000
            logger.info(f"Tool '{tool_call.name}' OK in {ms:.0f}ms")
            return ToolResult(tool_call.id, tool_call.name, result, True, ms)
        except Exception as e:
            ms = (time.monotonic() - start) * 1000
            msg = f"Error: {type(e).__name__}: {e}"
            logger.error(f"{msg}\n{traceback.format_exc()}")
            return ToolResult(tool_call.id, tool_call.name, msg, False, ms)

    @staticmethod
    def results_to_messages(results):
        return [{"role": "tool", "tool_call_id": r.tool_call_id,
                 "content": r.result} for r in results]
```

**串行 vs 并行的 Trade-off**：串行简单可调试；并行在 LLM 同时返回多个独立 tool_calls 时显著降低延迟。LLM 在一次响应中返回多个 tool_calls 本身就隐含了"它们之间无依赖"——否则它会分成多轮调用。

---

### Step 4: MessageManager — 消息历史管理与压缩

解决 Agent 长对话中最常遇到的问题：**消息越来越多，Context Window 不够用了**。

```python
# message_manager.py
import json, logging, tiktoken
from typing import Optional
from copy import deepcopy

logger = logging.getLogger(__name__)

class MessageManager:
    def __init__(self, system_prompt="", model="gpt-4o",
                 max_tokens=120000, compression_threshold=0.75):
        self.system_prompt = system_prompt
        self.max_tokens = max_tokens
        self.compression_threshold = compression_threshold
        try: self.enc = tiktoken.encoding_for_model(model)
        except KeyError: self.enc = tiktoken.get_encoding("cl100k_base")
        self._messages: list[dict] = []

    def append(self, msg):
        self._messages.append(msg)
        self._maybe_compress()

    def extend(self, msgs):
        self._messages.extend(msgs)
        self._maybe_compress()

    def get_messages(self):
        out = []
        if self.system_prompt:
            out.append({"role": "system", "content": self.system_prompt})
        out.extend(deepcopy(self._messages))
        return out

    def count_tokens(self, msgs=None):
        msgs = msgs or self.get_messages()
        total = 2  # priming tokens
        for m in msgs:
            total += 4  # per-message overhead
            for v in m.values():
                if isinstance(v, str): total += len(self.enc.encode(v))
                elif isinstance(v, list):
                    total += len(self.enc.encode(json.dumps(v)))
        return total

    def _maybe_compress(self):
        threshold = int(self.max_tokens * self.compression_threshold)
        if self.count_tokens() <= threshold: return
        logger.info("Token threshold exceeded, compressing...")
        self._sliding_window_compress(threshold)

    def _sliding_window_compress(self, target):
        """从最早的消息移除，保持 tool_call 对完整性。

        关键约束：assistant(tool_calls) 后面的 tool(result) 消息必须
        一起移除，否则 OpenAI API 会报错。
        """
        msgs, i = self._messages, 0
        while i < len(msgs):
            remaining = msgs[i:]
            sys_msgs = ([{"role":"system","content":self.system_prompt}]
                        if self.system_prompt else [])
            if self.count_tokens(sys_msgs + remaining) <= target: break
            i += 1
            # 如果刚移除的是含 tool_calls 的 assistant，连续移除后续 tool 消息
            if (i > 0 and msgs[i-1].get("role") == "assistant"
                    and msgs[i-1].get("tool_calls")):
                while i < len(msgs) and msgs[i].get("role") == "tool":
                    i += 1
        if i > 0:
            summary = {"role": "system", "content":
                f"[{i} earlier messages removed to fit context window.]"}
            self._messages = [summary] + msgs[i:]
            logger.info(f"Removed {i} msgs, tokens: {self.count_tokens()}")
```

**三个关键点**：System Prompt 始终保留不参与压缩；tool_call 对必须保持完整（`assistant` + 后续 `tool` 消息一起删或一起留）；在 75% 时就触发压缩，给回复留够空间。

---

### Step 5: StateStore — 状态持久化

简单的键值存储，生产中替换为 Redis 或数据库即可。

```python
# state_store.py
import json
from typing import Any, Optional
from pathlib import Path

class StateStore:
    def __init__(self, store_dir=".agent_state"):
        self.dir = Path(store_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, Any] = {}

    def save(self, key, value):
        self._cache[key] = value
        (self.dir / f"{key}.json").write_text(
            json.dumps(value, ensure_ascii=False, indent=2, default=str))

    def load(self, key, default=None):
        if key in self._cache: return self._cache[key]
        f = self.dir / f"{key}.json"
        if f.exists():
            v = json.loads(f.read_text())
            self._cache[key] = v
            return v
        return default

    def clear(self, key=None):
        if key:
            self._cache.pop(key, None)
            (self.dir / f"{key}.json").unlink(missing_ok=True)
        else:
            self._cache.clear()
            for f in self.dir.glob("*.json"): f.unlink()
```

---

## 4. 核心 Runtime Loop

所有模块就绪，组装成完整的 `AgentRuntime`。这是整篇文章的核心。

```python
# agent_runtime.py
import json, time, logging
from dataclasses import dataclass, field
from typing import Optional, Callable
from collections import Counter

from llm_client import LLMClient, LLMResponse
from tool_registry import ToolRegistry
from tool_executor import ToolExecutor
from message_manager import MessageManager
from state_store import StateStore

logger = logging.getLogger(__name__)

@dataclass
class RuntimeConfig:
    max_turns: int = 20               # 最大循环轮次
    max_total_time: float = 300.0     # 最大总执行时间（秒）
    parallel_tool_calls: bool = True  # 是否并行执行工具
    loop_detection_window: int = 4    # 死循环检测窗口
    loop_detection_threshold: int = 3 # 相同调用出现次数阈值

@dataclass
class AgentResult:
    content: str
    turns: int = 0
    total_tokens: int = 0
    tool_calls_made: list[dict] = field(default_factory=list)
    duration_ms: float = 0.0
    stopped_reason: str = ""

class AgentRuntime:
    def __init__(self, llm: LLMClient, registry: ToolRegistry,
                 system_prompt="You are a helpful assistant.",
                 config: Optional[RuntimeConfig] = None):
        self.llm = llm
        self.registry = registry
        self.executor = ToolExecutor(registry)
        self.config = config or RuntimeConfig()
        self.messages = MessageManager(system_prompt=system_prompt,
                                       model=llm.model)
        self.state = StateStore()
        self.on_tool_start: Optional[Callable] = None
        self.on_tool_end: Optional[Callable] = None

    def run(self, user_input: str) -> AgentResult:
        start_time = time.monotonic()
        self.messages.append({"role": "user", "content": user_input})
        tools = self.registry.get_all_schemas() or None

        turns, total_tokens, all_tc = 0, 0, []
        tc_history: list[str] = []
        final_content, stopped = "", "completed"

        while turns < self.config.max_turns:
            turns += 1

            # ── 全局超时检查 ─────────────────────────────
            if time.monotonic() - start_time > self.config.max_total_time:
                stopped = f"timeout ({self.config.max_total_time}s)"
                break

            # ── 调用 LLM ────────────────────────────────
            logger.info(f"Turn {turns}: calling LLM...")
            resp = self.llm.chat(self.messages.get_messages(), tools=tools)
            total_tokens += resp.usage.get("total_tokens", 0)

            # ── 情况 1: 有 tool_calls → 执行工具 ────────
            if resp.has_tool_calls:
                # 构建 assistant 消息（必须包含 tool_calls 字段）
                asst = {"role": "assistant", "content": resp.content,
                        "tool_calls": [
                    {"id": tc.id, "type": "function",
                     "function": {"name": tc.name,
                                  "arguments": json.dumps(tc.arguments)}}
                    for tc in resp.tool_calls]}
                self.messages.append(asst)

                # 死循环检测
                sig = json.dumps([(tc.name, tc.arguments)
                                  for tc in resp.tool_calls], sort_keys=True)
                tc_history.append(sig)
                if self._detect_loop(tc_history):
                    stopped = "loop_detected"
                    final_content = ("I'm repeating the same actions. "
                                     "Stopping to summarize findings.")
                    break

                # 执行
                if self.on_tool_start: self.on_tool_start(resp.tool_calls)
                if self.config.parallel_tool_calls and len(resp.tool_calls) > 1:
                    results = self.executor.execute_parallel(resp.tool_calls)
                else:
                    results = self.executor.execute(resp.tool_calls)
                if self.on_tool_end: self.on_tool_end(results)

                for tc, r in zip(resp.tool_calls, results):
                    all_tc.append({"turn": turns, "name": tc.name,
                        "arguments": tc.arguments,
                        "success": r.success, "duration_ms": r.duration_ms})

                self.messages.extend(ToolExecutor.results_to_messages(results))

            # ── 情况 2: 纯文本 → 任务完成 ───────────────
            else:
                final_content = resp.content or ""
                self.messages.append(
                    {"role": "assistant", "content": final_content})
                break
        else:
            stopped = f"max_turns ({self.config.max_turns})"

        return AgentResult(
            content=final_content, turns=turns, total_tokens=total_tokens,
            tool_calls_made=all_tc,
            duration_ms=(time.monotonic() - start_time) * 1000,
            stopped_reason=stopped)

    def _detect_loop(self, history):
        """滑动窗口 + 频次统计，同时捕获连续重复和交替重复"""
        w = self.config.loop_detection_window
        t = self.config.loop_detection_threshold
        if len(history) < t: return False
        return any(c >= t for c in Counter(history[-w:]).values())
```

### 核心循环解读

**两种退出路径**——这是 Agent 与 Workflow 的本质区别：

```
resp.has_tool_calls == True   → 继续（还有事要做）
resp.has_tool_calls == False  → break（LLM 认为任务完成了）
```

**为什么 assistant 消息必须包含 tool_calls 字段？** 这是 OpenAI API 的协议约束。消息流必须是：`user` → `assistant(tool_calls)` → `tool(result)` → `assistant(final)`。打破这个顺序会报错。

**死循环检测**用滑动窗口而非简单的"连续 N 次相同"，因为 LLM 有时会在两个工具间交替调用（A→B→A→B→...），这也是死循环，但不是"连续相同"。

---

## 5. 高级特性

### 5.1 Streaming 支持

流式模式下需要边输出文本、边判断是否有 tool_calls：

```python
# 添加到 AgentRuntime
def run_stream(self, user_input: str):
    self.messages.append({"role": "user", "content": user_input})
    tools = self.registry.get_all_schemas() or None
    turns = 0

    while turns < self.config.max_turns:
        turns += 1
        content, final_tc = "", None

        for chunk in self.llm.stream(self.messages.get_messages(), tools=tools):
            if chunk.content:
                content += chunk.content
                yield {"type": "text", "content": chunk.content}
            if chunk.tool_calls:
                final_tc = chunk.tool_calls

        if final_tc:
            yield {"type": "tool_start",
                   "calls": [{"name":tc.name} for tc in final_tc]}
            asst = {"role": "assistant", "content": content,
                    "tool_calls": [
                {"id":tc.id, "type":"function",
                 "function":{"name":tc.name,
                             "arguments":json.dumps(tc.arguments)}}
                for tc in final_tc]}
            self.messages.append(asst)
            results = self.executor.execute(final_tc)
            self.messages.extend(ToolExecutor.results_to_messages(results))
            yield {"type": "tool_end",
                   "results": [{"name":r.name, "ok":r.success} for r in results]}
        else:
            self.messages.append({"role":"assistant","content":content})
            yield {"type": "done", "content": content}
            break
```

### 5.2 超时控制的两层设计

```
┌──────────────────────────────────────┐
│ 全局超时 (max_total_time = 300s)     │
│  ┌──────┐ ┌──────┐ ┌──────┐        │
│  │Tool 1│ │Tool 2│ │Tool 3│        │
│  │30s   │ │30s   │ │30s   │        │
│  └──────┘ └──────┘ └──────┘        │
│ 单工具超时 (default_timeout = 30s)   │
└──────────────────────────────────────┘
```

单工具超时在 `ToolExecutor` 中通过 `ThreadPoolExecutor.result(timeout=30)` 控制；全局超时在 Runtime 每轮循环开始时检查 elapsed time。

---

## 6. 完整示例：研究助手 Agent

```python
# research_agent.py
import json, os, logging
from agent_runtime import AgentRuntime, RuntimeConfig
from llm_client import LLMClient
from tool_registry import ToolRegistry

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

registry = ToolRegistry()

@registry.tool()
def web_search(query: str, max_results: int = 5) -> str:
    """搜索网页内容
    Args:
        query: 搜索关键词
        max_results: 最大返回数量
    """
    # 生产环境替换为 SerpAPI / Bing API
    return json.dumps([{"title": f"Result {i+1} for '{query}'",
        "url": f"https://example.com/article-{i+1}",
        "snippet": f"Detailed article about {query}, section {i+1}..."}
        for i in range(min(max_results, 3))], ensure_ascii=False)

@registry.tool()
def read_url(url: str) -> str:
    """读取网页内容
    Args:
        url: 网页地址
    """
    # 生产环境替换为 requests + BeautifulSoup
    return (f"[Content from {url}]\n"
            f"Key points: 1) Fundamental concepts 2) Best practices "
            f"3) Common pitfalls 4) Case studies and benchmarks")

@registry.tool()
def write_file(filename: str, content: str) -> str:
    """写入文件
    Args:
        filename: 文件名
        content: 文本内容
    """
    os.makedirs("output", exist_ok=True)
    path = os.path.join("output", os.path.basename(filename))
    with open(path, "w") as f: f.write(content)
    return f"Wrote {len(content)} chars to {path}"

@registry.tool()
def ask_user(question: str) -> str:
    """向用户提问
    Args:
        question: 问题
    """
    print(f"\nAgent asks: {question}")
    return input("Your answer: ")

SYSTEM_PROMPT = """You are a research assistant. Workflow:
1. Search for information using web_search
2. Read promising articles using read_url (at least 2 sources)
3. Synthesize into a report and save with write_file
4. Present a summary. Use ask_user if the topic is unclear."""

agent = AgentRuntime(
    llm=LLMClient(model="gpt-4o", api_key=os.environ.get("OPENAI_API_KEY")),
    registry=registry,
    system_prompt=SYSTEM_PROMPT,
    config=RuntimeConfig(max_turns=15, max_total_time=120.0))

if __name__ == "__main__":
    result = agent.run("研究 Python asyncio 最佳实践，整理成技术报告并保存。")
    print(f"\n{'='*50}\nTurns: {result.turns} | Tokens: {result.total_tokens} "
          f"| {result.duration_ms:.0f}ms | {result.stopped_reason}")
    for tc in result.tool_calls_made:
        print(f"  Turn {tc['turn']}: {tc['name']}() "
              f"{'OK' if tc['success'] else 'FAIL'} {tc['duration_ms']:.0f}ms")
    print(f"\n{result.content[:300]}")
```

### 执行 Trace

```
Turn 1: calling LLM...  → web_search("Python asyncio best practices")
Turn 2: calling LLM...  → read_url(url1) + read_url(url2)  [parallel]
Turn 3: calling LLM...  → web_search("asyncio common pitfalls")
Turn 4: calling LLM...  → read_url(url3)
Turn 5: calling LLM...  → write_file("asyncio-report.md", ...)
Turn 6: calling LLM...  → [no tool_calls] → Done

==================================================
Turns: 6 | Tokens: 8432 | 13245ms | completed
  Turn 1: web_search() OK 45ms
  Turn 2: read_url() OK 120ms
  Turn 2: read_url() OK 135ms
  Turn 3: web_search() OK 38ms
  Turn 4: read_url() OK 110ms
  Turn 5: write_file() OK 5ms
```

注意 Turn 2：LLM 返回了两个 `read_url`，Runtime 自动并行执行。

---

## 7. 与框架对比

### 自建 vs 框架

| 维度 | 自建 Runtime | 框架（LangChain 等） |
|------|-------------|---------------------|
| **透明性** | 完全透明 | 需要读框架源码 |
| **调试** | 直接 breakpoint | 需要理解框架抽象层 |
| **定制** | 任何行为可改 | 受 API 设计约束 |
| **依赖** | `openai` + `tiktoken` | 几十个传递依赖 |
| **边界情况** | 自己发现和处理 | 社区帮你踩过坑 |
| **生态集成** | 每个都要自己写 | 现成的 VectorStore/Retriever |
| **开发速度** | 初期更慢 | 有模板更快 |

### 决策建议

- **学习阶段**：一定要自建一次。不理解原理就用框架，永远无法判断框架是否在坑你。
- **PoC / Hackathon**：用框架，速度第一。
- **生产系统**：自建核心 Runtime + 选择性使用框架组件（如只用 LangChain 的 Retriever）。
- **基础设施团队**：自建。你们的需求框架大概率满足不了。

---

## 8. 结语：Phase 2 完成

到这里，Phase 2 四篇文章全部完成：

- **第 04 篇**：理解控制循环 — Observe → Think → Act → Reflect
- **第 05 篇**：深入 Tool Calling — JSON Schema、Function Calling、Structured Output
- **第 06 篇**：Prompt Engineering — System Prompt 设计、工具选择引导、Reflection Prompt
- **第 07 篇（本篇）**：把以上所有知识组装成可运行的 Agent Runtime

此刻你有能力**不依赖任何框架，从零构建功能完整的 Agent 系统**。

但如果你运行过这个 Agent，会很快发现几个问题：

1. **没有记忆**：每次启动都是白纸，不记得上次的对话
2. **不会计划**：面对复杂任务只是一步步试，没有全局规划
3. **一个不够用**：有些任务需要不同角色的 Agent 协作

这就是 Phase 3 要解决的问题：

- **第 08 篇**：Memory Architecture — Agent 的状态与记忆体系
- **第 09 篇**：RAG as Cognitive Memory — 检索增强生成的工程实践
- **第 10 篇**：Planning and Reflection — 从 ReAct 到分层规划
- **第 11 篇**：Multi-Agent Collaboration — 多 Agent 协作

Phase 2 给了你造一把锤子的能力。Phase 3 将教你如何造一个工具箱。

---

> **系列导航**：本文是 Agentic 系列的第 07 篇。
>
> - 上一篇：[06 | Prompt Engineering for Agents](/blog/engineering/agentic/06-Prompt%20Engineering%20for%20Agents)
> - 下一篇：[08 | Memory Architecture](/blog/engineering/agentic/08-Memory%20Architecture)
> - 完整目录：[01 | From LLM to Agent](/blog/engineering/agentic/01-From%20LLM%20to%20Agent)
