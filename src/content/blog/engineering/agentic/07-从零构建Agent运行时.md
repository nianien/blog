---
title: "从零构建Agent运行时"
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

![Agent Runtime Architecture](/images/blog/agentic-07/agent-runtime-architecture.svg)

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

![Timeout Control Design](/images/blog/agentic-07/timeout-control.svg)

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

## 7. 自适应超时控制

在实际生产环境中，不同工具的执行时间差异巨大。Web 搜索可能需要 2-5 秒，数据库查询可能需要 100ms，而调用某个下游 API 可能不稳定且存在长尾延迟。**用固定的 30 秒超时对所有工具**是一种粗糙的策略——某些工具可能经常超时被杀死，某些工具又等得太久。

**自适应超时控制** 的核心思想是：为每个工具单独统计历史执行时间，按 p95 延迟动态调整超时阈值。同时记录异常延迟事件，便于离线分析瓶颈。

```python
# adaptive_timeout.py
import time, logging, statistics
from dataclasses import dataclass, field
from typing import Optional
from collections import defaultdict

logger = logging.getLogger(__name__)

@dataclass
class ToolTimingStats:
    """单个工具的执行时间统计"""
    name: str
    history: list[float] = field(default_factory=list)
    max_history: int = 100  # 保留最近 100 次执行记录
    p95_percentile: float = 0.0
    p99_percentile: float = 0.0
    mean: float = 0.0
    stddev: float = 0.0
    slow_executions: int = 0  # 超过 p95 的执行次数
    last_updated: float = 0.0

    def add_execution(self, duration_ms: float):
        """记录一次执行，更新统计"""
        self.history.append(duration_ms)
        if len(self.history) > self.max_history:
            self.history.pop(0)
        self._update_stats()
        if duration_ms > self.p95_percentile:
            self.slow_executions += 1

    def _update_stats(self):
        """计算 p95、p99、均值、标准差"""
        if not self.history:
            return
        sorted_hist = sorted(self.history)
        n = len(sorted_hist)
        self.mean = statistics.mean(sorted_hist)
        if n > 1:
            self.stddev = statistics.stdev(sorted_hist)
        else:
            self.stddev = 0.0
        # p95: 95% 的执行在这个时间以内
        idx_95 = max(0, int(n * 0.95) - 1)
        idx_99 = max(0, int(n * 0.99) - 1)
        self.p95_percentile = sorted_hist[idx_95]
        self.p99_percentile = sorted_hist[idx_99]
        self.last_updated = time.monotonic()

    def get_adaptive_timeout(self, multiplier: float = 1.5) -> float:
        """根据 p95 计算自适应超时，附加 multiplier 作为安全系数"""
        if self.p95_percentile == 0:
            return 30.0  # 没有历史数据时回退到默认值
        # 超时 = p95 + (p99 - p95) + 安全系数
        # 这样既不太激进，也不会过度等待
        adaptive = self.p95_percentile + (self.p99_percentile - self.p95_percentile) * 2
        return max(5.0, min(120.0, adaptive * multiplier))  # 限制在 5-120s 之间

class AdaptiveTimeoutManager:
    """为每个工具管理自适应超时阈值"""

    def __init__(self, initial_timeout: float = 30.0,
                 alert_threshold: float = 3.0):
        """
        Args:
            initial_timeout: 没有历史数据时的初始超时
            alert_threshold: 超过这个倍数的 p95 时发出告警
        """
        self.initial_timeout = initial_timeout
        self.alert_threshold = alert_threshold
        self._stats: dict[str, ToolTimingStats] = defaultdict(
            lambda: ToolTimingStats(name="")
        )
        self._lock = __import__('threading').Lock()
        self._slow_query_log: list[dict] = []

    def record_execution(self, tool_name: str, duration_ms: float, success: bool = True):
        """记录工具执行时间"""
        with self._lock:
            stats = self._stats[tool_name]
            if stats.name == "":
                stats.name = tool_name
            stats.add_execution(duration_ms)

            # 异常延迟告警
            if success and duration_ms > stats.p95_percentile * self.alert_threshold:
                alert = {
                    "timestamp": time.monotonic(),
                    "tool": tool_name,
                    "duration_ms": duration_ms,
                    "p95_ms": stats.p95_percentile,
                    "p99_ms": stats.p99_percentile,
                    "mean_ms": stats.mean,
                    "slow_count": stats.slow_executions,
                    "total_count": len(stats.history)
                }
                self._slow_query_log.append(alert)
                logger.warning(
                    f"Slow execution: {tool_name} took {duration_ms:.0f}ms "
                    f"(p95={stats.p95_percentile:.0f}ms, "
                    f"p99={stats.p99_percentile:.0f}ms)"
                )

    def get_timeout(self, tool_name: str, multiplier: float = 1.5) -> float:
        """获取某个工具的自适应超时"""
        with self._lock:
            if tool_name not in self._stats:
                return self.initial_timeout
            return self._stats[tool_name].get_adaptive_timeout(multiplier)

    def get_stats(self, tool_name: str) -> Optional[ToolTimingStats]:
        """获取工具的统计信息"""
        with self._lock:
            return self._stats.get(tool_name)

    def get_all_stats(self) -> dict[str, ToolTimingStats]:
        """获取所有工具的统计"""
        with self._lock:
            return dict(self._stats)

    def get_slow_queries(self, limit: int = 50) -> list[dict]:
        """获取最近的异常延迟事件（用于分析和告警）"""
        with self._lock:
            return self._slow_query_log[-limit:]

    def generate_report(self) -> str:
        """生成执行时间的人类可读报告"""
        with self._lock:
            lines = ["═" * 70]
            lines.append("Tool Execution Timing Report")
            lines.append("─" * 70)
            for name in sorted(self._stats.keys()):
                stats = self._stats[name]
                lines.append(f"\n{name}:")
                lines.append(f"  Executions: {len(stats.history)}")
                lines.append(f"  Mean:       {stats.mean:>8.1f}ms")
                lines.append(f"  p95:        {stats.p95_percentile:>8.1f}ms")
                lines.append(f"  p99:        {stats.p99_percentile:>8.1f}ms")
                lines.append(f"  StdDev:     {stats.stddev:>8.1f}ms")
                lines.append(f"  Slow count: {stats.slow_executions} "
                            f"({stats.slow_executions/max(1, len(stats.history))*100:.1f}%)")
            lines.append("═" * 70)
            return "\n".join(lines)
```

**集成到 ToolExecutor**：

```python
# 在 tool_executor.py 中添加
from adaptive_timeout import AdaptiveTimeoutManager

class ToolExecutor:
    def __init__(self, registry: ToolRegistry):
        self.registry = registry
        self.timeout_manager = AdaptiveTimeoutManager(
            initial_timeout=30.0, alert_threshold=2.5
        )
        # ... 其他初始化

    def execute(self, tool_calls: list[ToolCall]) -> list[ToolResult]:
        results = []
        for tc in tool_calls:
            start = time.monotonic()
            timeout = self.timeout_manager.get_timeout(tc.name)
            result = self._execute_single(tc, timeout)
            duration_ms = (time.monotonic() - start) * 1000
            self.timeout_manager.record_execution(tc.name, duration_ms, result.success)
            results.append(result)
        return results
```

**关键设计细节**：

- **滑动窗口统计**：只保留最近 100 次执行，权重新鲜数据
- **动态边界**：p95 超时时发送告警，便于发现工具性能问题
- **安全系数**：超时不能太激进，设定 1.5-2.0 倍数，保证偶发慢查询不会被杀死
- **线程安全**：使用锁保护共享数据结构，适合多线程并行执行工具的场景

---

## 8. 依赖感知的并行执行

现有的 `execute_parallel` 实现假设所有工具调用都是独立的。但在实际场景中，**工具之间存在依赖关系**：

- A 工具的输出是 B 工具的输入
- 必须先调用 C 工具获取配置，再调用 D 工具
- 甚至三层或更深的依赖链

**依赖感知的并行执行** 构建一个有向无环图（DAG），按拓扑排序分层执行，同时检测循环依赖。

```python
# dependency_aware_executor.py
import json, time, logging, threading
from typing import Optional, Callable
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

class DependencyGraph:
    """工具调用的依赖图"""

    def __init__(self):
        self.edges: dict[str, set[str]] = defaultdict(set)  # tool_id -> dependencies
        self.vertices: set[str] = set()
        self.metadata: dict[str, dict] = {}  # 存储工具信息

    def add_tool(self, tool_id: str, depends_on: Optional[list[str]] = None, **meta):
        """添加工具及其依赖"""
        self.vertices.add(tool_id)
        if depends_on:
            for dep in depends_on:
                self.edges[tool_id].add(dep)
        self.metadata[tool_id] = meta

    def detect_cycles(self) -> Optional[list[str]]:
        """使用 DFS 检测循环依赖"""
        visited = set()
        rec_stack = set()
        cycle = None

        def dfs(node):
            nonlocal cycle
            visited.add(node)
            rec_stack.add(node)
            for neighbor in self.edges[node]:
                if neighbor not in visited:
                    dfs(neighbor)
                elif neighbor in rec_stack:
                    cycle = [node, neighbor]
            rec_stack.remove(node)

        for v in self.vertices:
            if v not in visited:
                dfs(v)
        return cycle

    def topological_sort(self) -> Optional[list[list[str]]]:
        """拓扑排序，返回分层列表（同层可并行）

        返回: [[level0_tools], [level1_tools], ...] 或 None 如果有循环
        """
        if self.detect_cycles():
            return None

        # Kahn 算法计算入度
        in_degree = {v: 0 for v in self.vertices}
        for u in self.edges:
            for v in self.edges[u]:
                in_degree[v] += 1

        # 按层级分组
        levels = []
        current_level = [v for v in self.vertices if in_degree[v] == 0]

        while current_level:
            levels.append(current_level)
            next_level = set()
            for u in current_level:
                for v in self.edges[u]:
                    in_degree[v] -= 1
                    if in_degree[v] == 0:
                        next_level.add(v)
            current_level = list(next_level)

        return levels

class DependencyAwareExecutor:
    """依赖感知的工具执行器"""

    def __init__(self, registry, timeout_manager=None, max_workers: int = 8):
        self.registry = registry
        self.timeout_manager = timeout_manager
        self.max_workers = max_workers
        self._results: dict[str, any] = {}
        self._lock = threading.Lock()

    def execute_with_dependencies(self,
                                  tool_calls: list,
                                  dependencies: Optional[dict[str, list[str]]] = None
                                  ) -> list:
        """执行工具集合，考虑依赖关系

        Args:
            tool_calls: ToolCall 对象列表
            dependencies: {tool_id: [dependency_ids]} 映射
                         如果为 None，假设所有工具独立

        Returns:
            按原始 tool_calls 顺序的结果列表
        """
        if not tool_calls:
            return []

        # 如果没有指定依赖，假设所有工具独立
        if not dependencies:
            return self._execute_parallel_simple(tool_calls)

        # 构建依赖图
        graph = DependencyGraph()
        tool_map = {tc.id: tc for tc in tool_calls}

        for tc in tool_calls:
            deps = dependencies.get(tc.id, [])
            # 只保留存在的依赖
            valid_deps = [d for d in deps if d in tool_map]
            graph.add_tool(tc.id, depends_on=valid_deps)

        # 检测循环依赖
        cycle = graph.detect_cycles()
        if cycle:
            logger.error(f"Circular dependency detected: {cycle}")
            raise ValueError(f"Circular dependency: {cycle[0]} -> {cycle[1]}")

        # 拓扑排序
        levels = graph.topological_sort()
        if not levels:
            raise ValueError("Failed to perform topological sort")

        # 按层级执行
        logger.info(f"Executing {len(tool_calls)} tools in {len(levels)} levels")
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            for level_idx, level_tools in enumerate(levels):
                logger.info(f"Level {level_idx}: Executing {len(level_tools)} tools in parallel")
                futures = {}
                for tool_id in level_tools:
                    tc = tool_map[tool_id]
                    fut = executor.submit(
                        self._execute_with_deps, tc, tool_map, dependencies
                    )
                    futures[fut] = tc.id

                # 等待本层完成
                for fut in as_completed(futures):
                    tool_id = futures[fut]
                    try:
                        result = fut.result()
                        with self._lock:
                            self._results[tool_id] = result
                    except Exception as e:
                        logger.error(f"Tool {tool_id} failed: {e}")
                        with self._lock:
                            self._results[tool_id] = {
                                "success": False, "error": str(e)
                            }

        # 按原始顺序返回结果
        results = []
        for tc in tool_calls:
            result = self._results.get(tc.id, {"success": False, "error": "No result"})
            results.append(result)
        return results

    def _execute_with_deps(self, tc, tool_map, dependencies):
        """执行单个工具，先等待依赖完成"""
        # 等待依赖工具完成
        deps = dependencies.get(tc.id, [])
        dep_results = {}
        for dep_id in deps:
            # 自旋等待依赖完成
            while dep_id not in self._results:
                time.sleep(0.01)
            with self._lock:
                dep_results[dep_id] = self._results[dep_id]

        # 执行工具
        func = self.registry.get_function(tc.name)
        if not func:
            return {"success": False, "error": f"Tool {tc.name} not found"}

        try:
            # 将依赖结果传入参数
            args = dict(tc.arguments)
            for dep_id in deps:
                if dep_id in dep_results:
                    # 约定：依赖结果通过 _dep_{dep_id} 参数传入
                    args[f"_dep_{dep_id}"] = dep_results[dep_id].get("result", "")

            start = time.monotonic()
            timeout = (self.timeout_manager.get_timeout(tc.name)
                       if self.timeout_manager else 30.0)
            # 用线程 + 超时执行（简化版，实际可用 signal）
            result = func(**args)
            duration_ms = (time.monotonic() - start) * 1000
            if self.timeout_manager:
                self.timeout_manager.record_execution(tc.name, duration_ms)
            return {"success": True, "result": result}
        except Exception as e:
            logger.error(f"Tool {tc.name} execution failed: {e}")
            return {"success": False, "error": str(e)}

    def _execute_parallel_simple(self, tool_calls):
        """无依赖的简单并行执行"""
        results = []
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {
                executor.submit(self._exec_one, tc): i
                for i, tc in enumerate(tool_calls)
            }
            result_list = [None] * len(tool_calls)
            for fut in as_completed(futures):
                idx = futures[fut]
                result_list[idx] = fut.result()
            return result_list

    def _exec_one(self, tc):
        """执行单个工具"""
        func = self.registry.get_function(tc.name)
        if not func:
            return {"success": False, "error": f"Tool {tc.name} not found"}
        try:
            start = time.monotonic()
            timeout = (self.timeout_manager.get_timeout(tc.name)
                       if self.timeout_manager else 30.0)
            result = func(**tc.arguments)
            duration_ms = (time.monotonic() - start) * 1000
            if self.timeout_manager:
                self.timeout_manager.record_execution(tc.name, duration_ms)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
```

**使用示例**：

```python
# 场景：先搜索，再读取多个 URL（有依赖），最后汇总
dependencies = {
    "search_id": [],  # 无依赖
    "read_url1_id": ["search_id"],  # 依赖搜索结果
    "read_url2_id": ["search_id"],
    "summarize_id": ["read_url1_id", "read_url2_id"]  # 依赖两个读取
}
executor = DependencyAwareExecutor(registry, timeout_manager)
results = executor.execute_with_dependencies(tool_calls, dependencies)
```

**关键点**：

- **DAG 保证无循环**：拓扑排序前先检测循环依赖
- **分层并行**：同层工具并行执行，异层严格按顺序
- **依赖传递**：下游工具可以获取上游结果（通过特殊参数约定）

---

## 9. 断点续传与检查点恢复

长时间运行的 Agent 可能因网络中断、内存溢出、进程崩溃而被迫中止。**检查点（Checkpoint）机制** 允许 Agent 从上次中断点恢复，而不是重新开始。

```python
# checkpoint_manager.py
import json, time, logging
from dataclasses import dataclass, asdict
from typing import Optional, Any
from pathlib import Path
import hashlib

logger = logging.getLogger(__name__)

@dataclass
class Checkpoint:
    """检查点快照"""
    id: str  # 唯一标识，通常是时间戳
    timestamp: float
    turn: int  # 当前轮次
    messages: list[dict]  # 消息历史
    state: dict[str, Any]  # Agent 状态
    tool_calls_made: list[dict]  # 已执行的工具调用
    metadata: dict = None  # 自定义元数据

    def to_dict(self):
        return asdict(self)

class CheckpointManager:
    """管理检查点的保存、加载、清理"""

    def __init__(self, checkpoint_dir: str = ".checkpoints",
                 auto_save_interval: int = 3,  # 每 3 轮自动保存一次
                 max_checkpoints: int = 10):
        """
        Args:
            checkpoint_dir: 检查点存储目录
            auto_save_interval: 多少轮后自动保存一次
            max_checkpoints: 最多保留多少个检查点
        """
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        self.auto_save_interval = auto_save_interval
        self.max_checkpoints = max_checkpoints
        self._last_saved_turn = 0
        self._checkpoint_history: list[str] = []

    def should_save(self, current_turn: int) -> bool:
        """判断是否应该自动保存检查点"""
        return (current_turn - self._last_saved_turn) >= self.auto_save_interval

    def save(self, turn: int, messages: list[dict], state: dict,
             tool_calls_made: list[dict], metadata: dict = None) -> str:
        """保存检查点

        Returns:
            检查点 ID
        """
        checkpoint_id = str(int(time.time() * 1000))
        checkpoint = Checkpoint(
            id=checkpoint_id,
            timestamp=time.monotonic(),
            turn=turn,
            messages=messages,
            state=state,
            tool_calls_made=tool_calls_made,
            metadata=metadata or {}
        )
        checkpoint_path = self.checkpoint_dir / f"{checkpoint_id}.json"
        checkpoint_path.write_text(
            json.dumps(checkpoint.to_dict(), ensure_ascii=False, indent=2,
                      default=str)
        )
        self._checkpoint_history.append(checkpoint_id)
        self._last_saved_turn = turn
        logger.info(f"Checkpoint saved: {checkpoint_id} at turn {turn}")

        # 清理过旧的检查点
        self._cleanup_old_checkpoints()
        return checkpoint_id

    def save_on_exception(self, turn: int, messages: list[dict],
                         state: dict, tool_calls_made: list[dict],
                         error: Exception):
        """异常时保存检查点"""
        metadata = {
            "exception_type": type(error).__name__,
            "exception_msg": str(error),
            "saved_due_to": "exception"
        }
        checkpoint_id = self.save(turn, messages, state, tool_calls_made, metadata)
        logger.warning(f"Checkpoint saved due to exception: {checkpoint_id}")
        return checkpoint_id

    def load(self, checkpoint_id: Optional[str] = None) -> Optional[Checkpoint]:
        """加载检查点

        Args:
            checkpoint_id: 检查点 ID，若为 None 则加载最新的

        Returns:
            Checkpoint 对象或 None
        """
        if checkpoint_id is None:
            if not self._checkpoint_history:
                return None
            checkpoint_id = self._checkpoint_history[-1]

        checkpoint_path = self.checkpoint_dir / f"{checkpoint_id}.json"
        if not checkpoint_path.exists():
            logger.error(f"Checkpoint not found: {checkpoint_id}")
            return None

        data = json.loads(checkpoint_path.read_text())
        return Checkpoint(**data)

    def list_checkpoints(self) -> list[dict]:
        """列出所有可用的检查点"""
        checkpoints = []
        for cp_path in sorted(self.checkpoint_dir.glob("*.json")):
            data = json.loads(cp_path.read_text())
            checkpoints.append({
                "id": data["id"],
                "timestamp": data["timestamp"],
                "turn": data["turn"],
                "size_bytes": cp_path.stat().st_size
            })
        return checkpoints

    def _cleanup_old_checkpoints(self):
        """保留最新的 N 个检查点，删除旧的"""
        if len(self._checkpoint_history) > self.max_checkpoints:
            to_remove = len(self._checkpoint_history) - self.max_checkpoints
            for i in range(to_remove):
                old_id = self._checkpoint_history[i]
                old_path = self.checkpoint_dir / f"{old_id}.json"
                old_path.unlink(missing_ok=True)
                logger.info(f"Removed old checkpoint: {old_id}")
            self._checkpoint_history = self._checkpoint_history[to_remove:]

    def delete_checkpoint(self, checkpoint_id: str):
        """手动删除指定检查点"""
        cp_path = self.checkpoint_dir / f"{checkpoint_id}.json"
        cp_path.unlink(missing_ok=True)
        if checkpoint_id in self._checkpoint_history:
            self._checkpoint_history.remove(checkpoint_id)
        logger.info(f"Deleted checkpoint: {checkpoint_id}")

    def clear_all(self):
        """清空所有检查点"""
        for cp_path in self.checkpoint_dir.glob("*.json"):
            cp_path.unlink()
        self._checkpoint_history.clear()
        logger.info("All checkpoints cleared")
```

**集成到 AgentRuntime**：

```python
# 在 agent_runtime.py 中修改
class AgentRuntime:
    def __init__(self, llm, registry, system_prompt="", config=None):
        # ... 其他初始化
        self.checkpoint_manager = CheckpointManager(
            checkpoint_dir=".agent_checkpoints",
            auto_save_interval=3
        )

    def run(self, user_input: str, resume_from: Optional[str] = None) -> AgentResult:
        # 尝试恢复之前的检查点
        if resume_from:
            checkpoint = self.checkpoint_manager.load(resume_from)
            if checkpoint:
                logger.info(f"Resuming from checkpoint {resume_from} at turn {checkpoint.turn}")
                # 恢复消息和状态
                self.messages._messages = checkpoint.messages
                self.state._cache = checkpoint.state
                start_turn = checkpoint.turn
            else:
                logger.warning(f"Checkpoint {resume_from} not found, starting fresh")
                start_turn = 0
        else:
            start_turn = 0

        start_time = time.monotonic()
        if start_turn == 0:
            self.messages.append({"role": "user", "content": user_input})

        turns, total_tokens, all_tc = start_turn, 0, []
        final_content, stopped = "", "completed"

        try:
            while turns < self.config.max_turns:
                turns += 1
                # ... 正常的 LLM 调用和工具执行 ...

                # 周期性保存检查点
                if self.checkpoint_manager.should_save(turns):
                    self.checkpoint_manager.save(
                        turn=turns,
                        messages=self.messages._messages,
                        state=self.state._cache,
                        tool_calls_made=all_tc
                    )

        except Exception as e:
            # 异常时保存检查点
            logger.error(f"Agent failed at turn {turns}: {e}")
            self.checkpoint_manager.save_on_exception(
                turn=turns,
                messages=self.messages._messages,
                state=self.state._cache,
                tool_calls_made=all_tc,
                error=e
            )
            stopped = f"exception: {type(e).__name__}"

        return AgentResult(...)
```

**关键设计**：

- **自动保存**：无需手动干预，按轮次间隔自动保存
- **异常检查点**：崩溃时捕获现场，便于事后诊断
- **检查点清理**：自动清理过旧的，避免磁盘爆满
- **恢复简单**：只需一个 `resume_from` 参数即可从中断点继续

---

## 10. 完整的可观测性模块

**可观测性（Observability）** 是生产系统的必需品。需要记录：每步的 Token 消耗、延迟、工具成功率、总成本，并且格式要标准化，便于接入监控系统。

```python
# observability.py
import json, time, logging
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any
from datetime import datetime
import statistics

logger = logging.getLogger(__name__)

@dataclass
class MetricPoint:
    """单个指标数据点"""
    timestamp: float
    name: str  # e.g., "tool.execution_time", "llm.tokens", "agent.cost"
    value: float
    labels: Dict[str, str] = field(default_factory=dict)  # e.g., {"tool": "web_search"}
    unit: str = ""  # e.g., "ms", "tokens", "usd"

@dataclass
class TraceSpan:
    """一个追踪跨度（OpenTelemetry 兼容）"""
    trace_id: str
    span_id: str
    parent_span_id: Optional[str] = None
    name: str = ""
    start_time: float = 0.0
    end_time: float = 0.0
    attributes: Dict[str, Any] = field(default_factory=dict)
    events: List[Dict] = field(default_factory=list)
    status: str = "UNSET"  # UNSET, OK, ERROR

@dataclass
class RunReport:
    """整个 Agent 运行的汇总报告"""
    run_id: str
    start_time: float
    end_time: float
    total_duration_ms: float = 0.0
    turns: int = 0
    final_status: str = ""

    # Token 和成本
    total_prompt_tokens: int = 0
    total_completion_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0

    # 工具调用统计
    tools_called: Dict[str, int] = field(default_factory=dict)  # tool_name -> count
    tool_success_rate: float = 0.0
    avg_tool_duration_ms: float = 0.0

    # 消息统计
    total_messages: int = 0
    avg_message_length: int = 0

    # 详细日志
    events: List[Dict] = field(default_factory=list)
    traces: List[TraceSpan] = field(default_factory=list)

class AgentObserver:
    """Agent 运行的观测器，记录 metrics、logs、traces"""

    # Token 计价（OpenAI GPT-4o 2024 pricing）
    PRICING = {
        "gpt-4o": {"prompt": 5e-6, "completion": 15e-6},  # $ per token
        "gpt-4-turbo": {"prompt": 10e-6, "completion": 30e-6},
        "gpt-3.5-turbo": {"prompt": 0.5e-6, "completion": 1.5e-6},
    }

    def __init__(self, run_id: str, model: str = "gpt-4o"):
        self.run_id = run_id
        self.model = model
        self.start_time = time.monotonic()
        self.metrics: List[MetricPoint] = []
        self.traces: List[TraceSpan] = []
        self.events: List[Dict] = []
        self._span_stack: List[str] = []  # 用于嵌套 span

    def record_metric(self, name: str, value: float, labels: Dict = None, unit: str = ""):
        """记录一个指标点"""
        point = MetricPoint(
            timestamp=time.monotonic() - self.start_time,
            name=name,
            value=value,
            labels=labels or {},
            unit=unit
        )
        self.metrics.append(point)

    def record_event(self, event_type: str, message: str, **kwargs):
        """记录一个事件"""
        event = {
            "timestamp": time.monotonic() - self.start_time,
            "type": event_type,
            "message": message,
            **kwargs
        }
        self.events.append(event)
        logger.info(f"Event[{event_type}]: {message}")

    def start_span(self, span_id: str, name: str, attributes: Dict = None) -> TraceSpan:
        """开始一个追踪跨度（用于记录 LLM 调用、工具执行等）"""
        parent_id = self._span_stack[-1] if self._span_stack else None
        span = TraceSpan(
            trace_id=self.run_id,
            span_id=span_id,
            parent_span_id=parent_id,
            name=name,
            start_time=time.monotonic(),
            attributes=attributes or {}
        )
        self._span_stack.append(span_id)
        return span

    def end_span(self, span_id: str, status: str = "OK", status_message: str = ""):
        """结束一个追踪跨度"""
        if self._span_stack and self._span_stack[-1] == span_id:
            self._span_stack.pop()

        # 找到对应的 span，更新状态
        for span in reversed(self.traces):
            if span.span_id == span_id:
                span.end_time = time.monotonic()
                span.status = status
                if status_message:
                    span.events.append({"timestamp": time.monotonic(),
                                       "message": status_message})
                break

    def record_llm_call(self, prompt_tokens: int, completion_tokens: int):
        """记录 LLM 调用的 token 消耗"""
        total = prompt_tokens + completion_tokens
        self.record_metric("llm.tokens.prompt", prompt_tokens, unit="tokens")
        self.record_metric("llm.tokens.completion", completion_tokens, unit="tokens")
        self.record_metric("llm.tokens.total", total, unit="tokens")

        # 计算成本
        pricing = self.PRICING.get(self.model, self.PRICING["gpt-4o"])
        cost = (prompt_tokens * pricing["prompt"] +
                completion_tokens * pricing["completion"])
        self.record_metric("llm.cost", cost, unit="usd")

    def record_tool_call(self, tool_name: str, duration_ms: float,
                        success: bool = True, error: str = ""):
        """记录工具调用"""
        self.record_metric(f"tool.{tool_name}.duration", duration_ms, unit="ms")
        self.record_metric(f"tool.success", 1.0 if success else 0.0)

        if not success:
            self.record_event("tool_error",
                            f"Tool {tool_name} failed: {error}",
                            tool=tool_name)

    def generate_report(self) -> RunReport:
        """生成最终的运行报告"""
        elapsed = time.monotonic() - self.start_time

        # 汇总 metrics
        total_prompt_tokens = sum(
            m.value for m in self.metrics if m.name == "llm.tokens.prompt"
        )
        total_completion_tokens = sum(
            m.value for m in self.metrics if m.name == "llm.tokens.completion"
        )
        total_cost = sum(
            m.value for m in self.metrics if m.name == "llm.cost"
        )

        # 统计工具调用
        tools_called = {}
        tool_durations = []
        tool_successes = 0
        tool_total = 0

        for m in self.metrics:
            if m.name.startswith("tool.") and m.name.endswith(".duration"):
                tool_name = m.name.split(".")[1]
                tools_called[tool_name] = tools_called.get(tool_name, 0) + 1
                tool_durations.append(m.value)
            elif m.name == "tool.success":
                tool_total += 1
                if m.value == 1.0:
                    tool_successes += 1

        tool_success_rate = (tool_successes / tool_total) if tool_total > 0 else 0.0
        avg_tool_duration = (statistics.mean(tool_durations)
                            if tool_durations else 0.0)

        # 提取 turn 数
        turn_events = [e for e in self.events if e.get("type") == "turn_start"]
        turns = len(turn_events)

        report = RunReport(
            run_id=self.run_id,
            start_time=self.start_time,
            end_time=self.start_time + elapsed,
            total_duration_ms=elapsed * 1000,
            turns=turns,
            total_prompt_tokens=int(total_prompt_tokens),
            total_completion_tokens=int(total_completion_tokens),
            total_tokens=int(total_prompt_tokens + total_completion_tokens),
            estimated_cost_usd=total_cost,
            tools_called=tools_called,
            tool_success_rate=tool_success_rate,
            avg_tool_duration_ms=avg_tool_duration,
            events=self.events,
            traces=self.traces
        )
        return report

    def export_json(self) -> str:
        """导出为 JSON 格式（便于发送到外部监控系统）"""
        report = self.generate_report()
        return json.dumps(asdict(report), ensure_ascii=False, indent=2,
                         default=str)

    def export_prometheus_metrics(self) -> str:
        """导出为 Prometheus 格式"""
        lines = []
        for m in self.metrics:
            labels = ",".join(f'{k}="{v}"' for k, v in m.labels.items())
            if labels:
                lines.append(f"{m.name}{{{labels}}} {m.value}")
            else:
                lines.append(f"{m.name} {m.value}")
        return "\n".join(lines)

    def print_summary(self):
        """打印人类可读的汇总"""
        report = self.generate_report()
        print("┌" + "─" * 68 + "┐")
        print("│" + " Agent Run Summary".ljust(68) + "│")
        print("├" + "─" * 68 + "┤")
        print(f"│ Run ID:              {report.run_id:<48} │")
        print(f"│ Duration:            {report.total_duration_ms:>8.0f}ms (Turns: {report.turns}) │")
        print(f"│ Status:              {report.final_status:<48} │")
        print("├" + "─" * 68 + "┤")
        print(f"│ Tokens (prompt):     {report.total_prompt_tokens:>8d} tokens   │")
        print(f"│ Tokens (completion): {report.total_completion_tokens:>8d} tokens   │")
        print(f"│ Total tokens:        {report.total_tokens:>8d} tokens   │")
        print(f"│ Estimated cost:      ${report.estimated_cost_usd:>8.4f} USD      │")
        print("├" + "─" * 68 + "┤")
        tools_str = ", ".join(f"{k}({v})" for k, v in report.tools_called.items())
        if tools_str:
            print(f"│ Tools called:        {tools_str:<48} │")
        print(f"│ Tool success rate:   {report.tool_success_rate:>8.1%}          │")
        print(f"│ Avg tool duration:   {report.avg_tool_duration_ms:>8.1f}ms        │")
        print("└" + "─" * 68 + "┘")
```

**集成到 AgentRuntime**：

```python
# 在 agent_runtime.py 中修改
class AgentRuntime:
    def __init__(self, llm, registry, system_prompt="", config=None):
        # ... 其他初始化
        self.observer = AgentObserver(
            run_id=f"agent_{int(time.time()*1000)}",
            model=llm.model
        )

    def run(self, user_input: str) -> AgentResult:
        start_time = time.monotonic()

        for turns in range(self.config.max_turns):
            self.observer.record_event("turn_start", f"Starting turn {turns}")

            # LLM 调用
            resp = self.llm.chat(...)
            self.observer.record_llm_call(
                resp.usage.get("prompt_tokens"),
                resp.usage.get("completion_tokens")
            )

            # 工具执行
            if resp.has_tool_calls:
                results = self.executor.execute(resp.tool_calls)
                for tc, r in zip(resp.tool_calls, results):
                    self.observer.record_tool_call(
                        tc.name, r.duration_ms, r.success
                    )

            self.observer.record_event("turn_end", f"Completed turn {turns}")

        # 输出报告
        self.observer.print_summary()
        # 或导出给外部系统
        # with open("agent_metrics.json", "w") as f:
        #     f.write(self.observer.export_json())
```

**关键特性**：

- **结构化日志**：JSON 格式便于机器解析
- **多维指标**：不仅记录成本，还记录成功率、延迟分布
- **OpenTelemetry 兼容**：`TraceSpan` 可导出到 Jaeger、Datadog 等 APM 系统
- **Prometheus 导出**：可直接抓取做仪表板

---

## 11. 与框架对比

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

## 12. 结语：Phase 2 完成

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
> - 上一篇：[06 | 面向Agent的提示词工程](/blog/engineering/agentic/06-面向Agent的提示词工程)
> - 下一篇：[08 | 记忆架构：Agent的状态与记忆体系](/blog/engineering/agentic/08-记忆架构：Agent的状态与记忆体系)
> - 完整目录：[01 | 从LLM到Agent：Agentic系统的知识地图](/blog/engineering/agentic/01-从LLM到Agent：Agentic系统的知识地图)
