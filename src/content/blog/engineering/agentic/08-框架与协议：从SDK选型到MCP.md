---
title: "框架与协议：从SDK选型到MCP"
pubDate: "2026-01-22"
description: "框架组织执行，协议约定交互。本文以订单调查说明 SDK 选型、状态恢复、业务适配与 MCP 接入，给出版本明确的本地示例，并解释 MCP 与 A2A 的职责和授权边界。"
tags: ["Agentic", "AI Engineering", "Framework", "MCP"]
slug: "agent-frameworks-and-mcp"
series:
  key: "agentic"
  order: 8
author: "skyfalling"
---

订单调查已经有了控制循环、记忆与协作方式，接下来要决定哪些能力交给框架，哪些接口用协议连接。**框架组织应用内部的执行，协议约定组件之间的交互；二者可以分别选择。** 这比先问“哪个框架最好”更接近工程问题。

本文按 2026 年 9 月核对的官方文档讨论职责，MCP 协议说明以 2025-11-25 版本为基准。不同 SDK 的版本与协议版本并不是同一个编号，落地时需要分别锁定和验证。

## 1. 选框架，是选择由谁维护运行时能力

一个 while 循环可以演示工具调用，但生产系统还要维护消息关联、取消、预算、状态恢复、权限与观测。自研只是把这些工作交给团队，并不会让它们消失；使用框架则需要理解框架提供了什么、哪里允许扩展。

| 要解决的问题 | 应检查的能力 |
| --- | --- |
| 接入多种模型 | 消息、工具调用、结构化输出与流式事件如何映射 |
| 长任务恢复 | 检查点保存什么，崩溃后哪些代码会重跑 |
| 人工审批 | 怎样暂停、绑定审批对象并可靠恢复 |
| 并行与协作 | 如何限制并发、汇聚结果、传播失败和取消 |
| 业务扩展 | 能否在动作前后插入校验，是否需要侵入内部实现 |
| 调试与维护 | 能否导出完整事件，依赖升级能否回归 |
| 部署与数据 | 状态、凭据与日志放在哪里，谁负责隔离与运维 |
| 成本与效果 | 同一批任务下的完成率、延迟和单位成功任务成本 |

团队人数、上线周期和代码行数不能直接决定选型。一个小团队可能需要框架提供成熟的恢复能力，一个简单但长期运行的服务也可能只需要原生 SDK 与少量应用代码。

## 2. LangChain 与 LangGraph：高层组合和底层编排

按当前文档，LangChain 提供模型集成和可配置的 Agent 构建接口，其 Agent 建立在 LangGraph 之上；LangGraph 则提供更底层的状态与执行编排。两者不能简单写成“只能顺序执行的 Chain”和“支持分支的 Graph”的替代关系。[LangChain 概览](https://docs.langchain.com/oss/python/langchain/overview)、[LangGraph 概览](https://docs.langchain.com/oss/python/langgraph/overview)

在订单调查中，高层接口适合快速组织查询工具与模型；需要明确控制“查询 → 等待审批 → 执行 → 核验”的状态变化时，可以使用更显式的图。

图中的节点处理状态，边或路由决定后续调度。共享状态通常还有更新合并规则。TypedDict 等类型声明帮助开发与静态检查，不能替代运行时的业务校验。

有循环的图可能产生无限多条执行轨迹；数据状态也不一定有限。因此，“拓扑已定义”不等于“编译时能枚举所有路径”，更不等于模型输出可预测。图让允许的控制关系更容易检查，实际行为仍取决于路由、节点实现和执行边界。

### 暂停与恢复要区分调试和审批

LangGraph 的动态 interrupt 可以暂停执行，通过相同 thread_id 和 Command(resume=...) 恢复。恢复时，发生 interrupt 的节点会从头重新执行，位于 interrupt 之前的代码可能再次运行。[Interrupts 文档](https://docs.langchain.com/oss/python/langgraph/interrupts)

据此设计审批节点时，应先准备可审阅的候选操作，再暂停。恢复后的服务端检查至少绑定操作标识、参数版本、审批身份与有效期，然后才允许写入。只有布尔值 true，而没有绑定具体操作的审批记录，不足以防止审批后参数变化。

静态断点可以辅助调试，但暂停本身不会建立审批权限。历史检查点回放也不会撤销已经发出的邮件或退款；再次执行仍可能产生副作用，需要业务幂等与隔离环境。

## 3. 不按厂商给 SDK 划分“厚”和“薄”

SDK 的抽象范围应看具体能力，不能从维护者身份推导。以下是职责示例，不是性能排行：

| 项目 | 官方文档描述的侧重点 | 选型时继续核对 |
| --- | --- | --- |
| OpenAI Agents SDK | 在应用中组织 Agent、工具、handoff 与运行过程 | 模型提供方适配、状态保存与工具策略 |
| Claude Agent SDK | 复用 Claude Code 的工具、Agent 循环与上下文管理 | 运行环境、权限控制与会话生命周期 |
| Google ADK | Agent 开发、编排与相关工具能力 | 所选语言版本、模型和部署方式的具体支持 |

来源：[OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk)、[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)、[ADK](https://adk.dev/)。

例如 OpenAI Agents SDK 提供模型与提供方接入机制，不能概括成“只能用自家模型”。跨模型时仍须核对工具、流式、结构化输出等能力映射，而不是只替换模型名称。[模型与提供方](https://developers.openai.com/api/docs/guides/agents/models)

Handoff 表达控制权交接，Graph 表达调度关系，角色委派表达任务分工。这些设计可以组合，不能单靠名字给它们贴上“灵活性高”“可预测性低”的固定等级。

## 4. 把需要稳定的业务契约留在应用边界

订单查询应该返回业务上明确的状态、版本和来源，不应把某个框架的消息对象传播到全部业务代码中。模型适配层也应显式处理差异：

| 边界 | 应明确的契约 |
| --- | --- |
| 模型请求 | 消息角色、工具定义、输出要求、预算与取消 |
| 模型响应 | 文本、工具调用 ID、结束原因、用量与错误 |
| 工具执行 | 身份、资源范围、参数、业务请求 ID 与结果 |
| 状态存储 | 运行版本、检查点、原子更新和恢复语义 |

仅把两个 SDK 的返回值都转换成 dict，不代表它们已经兼容。不同字段、消息语义和错误行为仍可能泄漏到业务层。

适配层应围绕实际需要建立，避免提前复制整个框架。验证替换能力时，用同一组契约测试覆盖工具调用关联、空结果、取消、超时和未知写入状态；接口签名相同只是起点。

## 5. MCP 减少重复接入，保留业务适配

假设 N 个应用要接入 M 套工具系统，逐对编写连接器，最坏需要 N×M 份接入工作。若各应用和工具方都实现兼容的共同协议，协议侧接入可以接近 N+M。

这是接口复用的理想模型，不是总成本公式。身份映射、权限、版本兼容和业务语义仍可能需要逐项集成测试。HTTP 与 CGI 本来处于不同职责层，也不适合拿“从 CGI 到 HTTP”比喻协议替换。

MCP 的 Host 管理模型、上下文和权限策略；Host 内的 Client 维护与某个 Server 的连接；Server 暴露工具、资源与提示模板。一个 Host 可以管理多个 Client。[MCP 架构规范](https://modelcontextprotocol.io/specification/2025-11-25/architecture)

[![模型提出订单查询，Host 校验后通过 MCP Client 调用 Server，Server 查询业务服务并返回结果](/images/blog/agentic/mcp-architecture.svg)](/images/blog/agentic/mcp-architecture.svg)

| 原语 | 典型控制方式 | 订单调查示例 |
| --- | --- | --- |
| Tools | 模型提出调用，Host 按策略执行 | 查询订单状态 |
| Resources | 应用决定如何读取和放入上下文 | 读取订单状态说明文档 |
| Prompts | 用户选择可复用模板 | 启动一份异常调查模板 |

这些控制方式帮助划分职责，不是自动生效的授权机制。模型提出调用后，Host 仍要检查是否允许发送，Server 仍要验证访问身份与资源范围。

## 6. 一个能独立核验的 MCP 接入示例

用固定订单数据演示协议，可以先排除模型质量、外部接口和凭据配置的影响。下面是官方 Python SDK v1 API 风格的示例，核验环境使用 Python 3.14.3、mcp 1.27.1；它是版本明确的教学示例，不表示该依赖是当前最新版本。新项目应按目标版本的[官方文档](https://github.com/modelcontextprotocol/python-sdk)评估依赖与迁移。

保存为 server.py：

```python
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel

mcp = FastMCP("order-demo")

class OrderResult(BaseModel):
    found: bool
    order_id: str
    status: str | None = None
    version: int | None = None
    source: str = "in-memory-demo"

@mcp.tool()
def get_demo_order(order_id: str) -> OrderResult:
    """查询固定演示订单，仅用于协议接入验证"""
    if order_id != "demo-001":
        return OrderResult(found=False, order_id=order_id)
    return OrderResult(
        found=True, order_id=order_id, status="paid", version=1
    )

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

同目录的 client.py 启动该子进程、协商能力、发现工具并调用：

```python
import asyncio
import sys
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(Path(__file__).with_name("server.py"))],
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            listed = await session.list_tools()
            if "get_demo_order" not in {t.name for t in listed.tools}:
                raise RuntimeError("expected tool is missing")
            result = await session.call_tool(
                "get_demo_order",
                arguments={"order_id": "demo-001"},
            )
            if result.isError:
                raise RuntimeError("tool execution failed")
            print(result.structuredContent)

if __name__ == "__main__":
    asyncio.run(main())
```

在已安装对应依赖的隔离环境执行 python client.py，应得到 found 为 true、status 为 paid、source 为 in-memory-demo 的结构化结果。它没有连接真实订单库，也没有调用模型；固定数据只用于验证发现、参数传递和结果返回。

真实服务需把数据来源替换为受控业务接口，增加身份校验、资源范围、超时与审计。工具的输入 Schema 描述参数，不会自动赋予权限；default 也不能保证调用方补齐值，默认行为仍需实现。

## 7. 传输、工具映射与授权分别处理

### stdio 与 Streamable HTTP

stdio 通过子进程标准输入输出传递协议消息；日志应写 stderr，不能混入协议 stdout。子进程是进程边界，**并不天然隔离文件、网络或凭据权限**。不可信工具需要按实际威胁选择沙箱、最小权限和网络策略。

Streamable HTTP 使用 HTTP 端点，可按需要通过 SSE 传递消息，不能理解成“已经不使用 SSE”。远程部署还需处理认证、Origin 校验、代理流式行为、超时和会话；单端点并不自动保证任意平台上的生产可用性。[传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

### 多个 Server 的工具名不能直接拼接后反拆

如果 Server ID 或工具名本身包含分隔符，简单的 server_id__tool_name 再 split 会产生歧义。Host 可以生成符合目标模型命名约束的唯一别名，并保存显式映射：

```json
{
  "order_query_01": {
    "connection_id": "order-service",
    "remote_tool_name": "get_demo_order",
    "schema_version": 1
  }
}
```

调用时只接受当前已注册的别名，从映射取出连接与真实工具名，再做参数和权限检查。工具列表分页、重新连接和能力变更也要按协商结果处理，不能把一次发现结果永久当作事实。

### 认证不等于全部业务授权

以 MCP 2025-11-25 规范为例，HTTP 授权涉及 OAuth、资源元数据和目标资源校验；动态客户端注册是可选机制，不是每个 Server 必须支持的自动步骤。stdio 场景也不能机械套用同一套 HTTP 授权流程。[授权规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

Token 必须面向正确资源并由服务端校验；完成认证后仍要检查租户、订单与操作权限。“只允许 SELECT”不能替代数据库只读权限、参数化查询和数据范围限制，容器也不能代替凭据隔离。

工具描述与返回结果是外部输入，不能因走了 MCP 就提升为可信系统指令。保留来源和信任边界，执行前依照应用策略检查，比只依赖模型判断更可控。

## 8. A2A 表达跨系统任务协作

如果履约调查由另一团队的 Agent 服务承担，调用方可能需要委派目标、接收中间状态、补充输入并取得产物。A2A 为这类交互提供 Agent Card、消息、任务与产物等协议概念。

按核对时的规范，常见发现地址是 /.well-known/agent-card.json，也可以通过目录或直接配置发现。读取名片只得到能力与连接信息，并不会自动完成信任建立、认证或业务契约对齐。[A2A 规范](https://a2a-protocol.org/latest/specification/)

| 关注点 | MCP 的典型用途 | A2A 的典型用途 |
| --- | --- | --- |
| 接入对象 | 工具、资源与提示模板 | 提供任务能力的 Agent 服务 |
| 调用方关注 | 调什么能力、传什么参数、取得什么结果 | 委派什么任务、当前状态、需要什么补充及产物 |
| 实现透明度 | 无需知道工具内部如何实现 | 无需知道远端 Agent 内部如何编排 |

两者的能力并非完全互斥：工具背后也可以运行 Agent，MCP 也不能被永久概括成“只有同步请求”。选择应看双方需要的交互语义与支持版本，不必为了内部函数调用额外引入远程协议。

框架、MCP 与 A2A 的共同价值是让职责和交接契约更明确。订单调查可以先在本地验证工具和工作流，再按复用与跨系统需求接入协议；每一步保留相同的业务验收条件。下一篇讨论如何持续观察和评估这些运行中的系统。
