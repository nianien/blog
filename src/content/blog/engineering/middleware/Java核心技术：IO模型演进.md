---
title: "Java 核心技术：IO 模型演进"
pubDate: "2022-04-18"
description: "系统梳理Java I/O体系的演进脉络，从传统BIO的流式模型到NIO的缓冲区+通道+多路复用模型，深入分析Channel、Buffer、Selector的设计原理与协作机制，理解I/O模型变革背后的系统级思考。"
tags: ["Java", "NIO", "I/O", "Netty", "网络编程"]
series:
  key: "java-core"
---

阻塞 API、非阻塞 API 和异步 API，首先改变的是程序如何等待 I/O。它们并不直接决定业务吞吐：连接数量、单次处理成本、线程模型和背压机制共同决定系统能走多远。

本文先解释传统流与 NIO 的协作方式，再说明怎样把一次就绪通知转成正确的协议处理。主体使用平台线程语境；文末补充 JDK 21 虚拟线程带来的选择变化。

## 流模型：简单，但要明确谁在等待

InputStream/OutputStream 面向字节，Reader/Writer 面向字符。它们既能逐个读取，也能批量处理数组；“面向流”不等于每次只能处理一个字节。InputStreamReader 负责解码，BufferedReader 在此基础上提供缓冲和按行读取：

```java
try (BufferedReader reader = Files.newBufferedReader(
        Path.of("data.txt"), StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        System.out.println(line);
    }
}
```

这段方法体示例需要 java.io、java.nio.file 和 java.nio.charset 中的对应导入，并由调用者处理 IOException。最外层资源关闭时会关闭其包装的底层资源。

阻塞式 Socket 读写让控制流保持直线。经典服务器为每个连接安排一个平台线程：连接没数据时，读操作等待，业务代码不必显式保存执行位置。但大量空闲连接会占用线程栈和调度资源。实际容量取决于内存、连接活跃度和处理时长，不能统一断言“数千连接必然失效”。

## Buffer 与 Channel：显式管理数据的位置

NIO 引入 Buffer、Channel 和 Selector 三个协作对象，但不是每个 Channel 都可双向读写、非阻塞或注册到 Selector。FileChannel 支持文件定位读写，不能注册到 Selector；SocketChannel 才是 TCP 非阻塞通信的主要入口。

Buffer 的读写位置需要由调用者管理：

| 属性或操作 | 含义 |
| --- | --- |
| capacity | 固定容量 |
| position | 下一次读写的位置 |
| limit | 本次操作的边界，不超过 capacity |
| mark/reset | 保存与恢复位置；没有有效标记时 reset 会失败 |
| flip | 将 limit 设为原 position，再将 position 归零，以读取刚写入的数据 |
| clear | 将位置恢复到可写状态，不擦除底层字节 |
| compact | 将未消费的数据移到开头，随后继续写入 |
| rewind | position 归零、limit 不变，用于重新读取现有范围 |

例如，容量 8 的缓冲区写入 3 个字节后，position=3、limit=8；flip 后变成 position=0、limit=3。消费 2 个字节再 compact，剩余字节移到开头，position=1、limit=8。这个状态变化比记住“读前 flip”更重要：只有知道数据来自哪里、哪些已经消费，才知道该保留什么。

Scatter/Gather 可以把一次读取分散到多个 Buffer，或把多个 Buffer 中的剩余内容聚集写出。它们仍可能只处理部分数据；从网络读到 header 的一部分时，不能立即把 body 当成完整消息。读取后还要正确设置各 Buffer 的读边界。

## 就绪通知不是完成通知

Selector 让少量事件循环监控大量连接。它报告的是当前可尝试的操作，程序仍须实际调用 accept/read/write 并检查结果。

| 事件 | 必须继续处理的状态 |
| --- | --- |
| OP_ACCEPT | accept 可能返回 null；新连接要设为非阻塞再注册 |
| OP_CONNECT | 调用 finishConnect 确认连接是否完成或失败 |
| OP_READ | read 大于 0 表示读到字节，0 表示暂无进展，-1 表示对端输出结束 |
| OP_WRITE | write 可能只写出部分内容，也可能返回 0 |

选出的 key 要从 selectedKeys 集合移除；失效连接要注销并关闭；缓冲区与协议解析状态要跨事件保存。若每次收到 OP_READ 都新建 Buffer 并丢弃未解析字节，半条消息就会消失。[Selector API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/Selector.html)

下面是读事件处理的局部示例：每个连接事先在 attachment 中保存一个 Buffer，consumeCompleteFrames 解析完整帧并推进 position，保留不完整帧。其帧格式由具体协议定义，因此这不是完整服务器代码。

```java
SocketChannel client = (SocketChannel) key.channel();
ByteBuffer buffer = (ByteBuffer) key.attachment();
int count = client.read(buffer);
if (count < 0) {
    key.cancel();
    client.close();
} else if (count > 0) {
    buffer.flip();
    consumeCompleteFrames(buffer);
    buffer.compact();
    if (!buffer.hasRemaining()) {
        // 教学示例选择关闭超过缓冲区容量的帧，实际协议应明确定义长度上限
        key.cancel();
        client.close();
    }
}
```

写路径也需要队列：有尚未发送的数据时关注 OP_WRITE，写完后取消该兴趣，避免可写事件持续触发形成空转。对慢客户端必须限制待发送字节数，否则事件循环虽然没有被阻塞，内存仍会被耗尽。

Linux 上的常见 OpenJDK 实现使用 epoll。它避免每次遍历完整的监听集合，但调用和处理成本仍与注册操作、就绪事件数等有关，不能写成整个 I/O 系统 O(1)。select 的 fd 集合有表示上限，poll/epoll 则仍受文件描述符配额和系统资源约束。

## Reactor 如何分工

| 模型 | I/O 与业务的分工 | 需要解决的问题 |
| --- | --- | --- |
| 单事件循环 | 同一线程接收、读取、处理和写出 | 长任务会拖慢所有连接 |
| 一个 I/O 循环加业务线程池 | 事件循环读写，工作线程计算 | 跨线程传递、响应顺序和队列容量 |
| 多个 I/O 循环 | 接收连接后分配给不同循环 | 连接归属与各循环的负载平衡 |

Netty 的典型服务端配置使用 boss group 接收连接、worker group 处理连接 I/O。ChannelPipeline 是事件处理链，**业务 Handler 默认仍可能在 I/O EventLoop 上运行**，并不会因为使用 Netty 自动转移到独立业务池。数据库阻塞调用、长时间计算和无界排队，都需要在实际配置中处理。

事件循环减少了等待连接占用的平台线程，却增加了状态管理责任。成熟框架的价值包括缓冲区、协议拆帧、写队列和生命周期管理，而不只是封装一个 Selector。

## 文件传输和 Direct Buffer 的收益有条件

FileChannel.transferTo/transferFrom 允许实现采用更高效的传输路径，但不保证所有系统、目标通道和传输大小都走零拷贝，也不保证一次传完。调用者必须累计实际传输量，遇到零进展时采取等待、退避或有边界的回退，不能无条件忙循环。[FileChannel API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/FileChannel.html)

Direct ByteBuffer 的数据位于堆外，可减少部分 I/O 路径中的中间复制；它不等于磁盘 O_DIRECT，也不意味着绕过内核缓冲。其 Java 包装对象仍与 GC 生命周期有关，底层存储的释放时机和池化策略取决于实现。大量短命直接缓冲区可能增加分配与回收负担，是否池化应通过实际负载衡量。

## 异步与虚拟线程增加了选择

NIO.2 的 AsynchronousSocketChannel 等 API 通过 Future 或 CompletionHandler 报告操作完成。它与 Selector 的“就绪后自己执行”是不同的应用编程模型，底层如何借助系统设施和线程则依平台实现而定。

**后续版本补充：**JDK 21 正式提供虚拟线程，让大量等待网络 I/O 的任务能够继续使用直线式阻塞代码，同时复用较少的平台线程。这改变了“一连接一线程必然消耗一个 OS 线程”的前提，但不会增加 CPU 算力，也不会解除数据库连接数等资源限制。[JEP 444](https://openjdk.org/jeps/444)

选型因此要回到两个问题：等待时占用什么资源，恢复后由谁保存和推进状态。已有事件驱动协议栈可以继续采用 NIO；阻塞式业务可以评估虚拟线程；文件操作和异步 API 则应按具体传输与完成语义验证。最终要测的是目标负载下的吞吐、尾延迟、内存和过载行为。
