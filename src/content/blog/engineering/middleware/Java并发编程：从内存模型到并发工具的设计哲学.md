---
title: "Java并发编程：从内存模型到并发工具的设计哲学"
pubDate: "2021-11-20"
description: "从CPU缓存一致性协议到Java内存模型，从volatile的硬件级实现到Lock/Condition的协作机制，从JUC并发工具类到线程池的高级用法，系统构建Java并发编程的知识体系。"
tags: ["Java", "并发编程", "JMM", "JUC", "线程池"]
---

# Java并发编程：从内存模型到并发工具的设计哲学

> 并发编程的核心挑战不在于"如何让多个线程同时跑"，而在于"如何让多个线程正确地协作"。理解 Java 内存模型和并发工具的设计原理，是写出正确并发代码的前提。

并发编程是 Java 工程师的核心能力之一。它涉及从硬件层面的缓存一致性，到语言层面的内存模型，再到 JUC 工具类的 API 设计，是一个纵深很大的知识领域。

本文将从底层原理出发，逐层构建 Java 并发编程的知识体系。

## 一、硬件基础：CPU 缓存与一致性

### 1.1 为什么需要缓存

现代 CPU 的运算速度远超主内存的读写速度（差距约 100 倍）。为了弥补这一差距，CPU 引入了多级缓存（L1/L2/L3 Cache）。每个核心拥有独立的 L1/L2 缓存，L3 缓存为所有核心共享。

```
CPU Core 0          CPU Core 1
┌─────────┐        ┌─────────┐
│ L1 Cache│        │ L1 Cache│
│ L2 Cache│        │ L2 Cache│
└────┬────┘        └────┬────┘
     └────────┬─────────┘
         L3 Cache（共享）
              │
         主内存（RAM）
```

缓存的引入解决了性能问题，但带来了新问题：**当多个核心各自缓存了同一块数据的副本，其中一个核心修改了数据，如何保证其他核心看到的是最新值？**

### 1.2 MESI 缓存一致性协议

MESI 是最广泛采用的缓存一致性协议，每个缓存行处于四种状态之一：

| 状态 | 含义 | 对主内存 |
|------|------|----------|
| **M（Modified）** | 当前核心修改了数据，与主内存不一致 | 需要写回 |
| **E（Exclusive）** | 当前核心独占数据，与主内存一致 | 无需写回 |
| **S（Shared）** | 多个核心共享数据，与主内存一致 | 无需写回 |
| **I（Invalid）** | 缓存行无效 | 需从主内存重新加载 |

当 Core 0 修改了处于 S 状态的缓存行时：

1. Core 0 将缓存行状态改为 M
2. 通过总线嗅探（Bus Snooping）通知其他核心
3. 其他核心将对应缓存行标记为 I
4. 其他核心下次读取该数据时，从 Core 0 的缓存或主内存重新加载

### 1.3 缓存行伪共享（False Sharing）

缓存行是缓存操作的最小单位，大小通常为 **64 字节**。如果两个无关的变量恰好落在同一缓存行中，一个变量的修改会导致另一个变量的缓存行也失效——这就是伪共享。

```java
// 伪共享示例：head 和 tail 可能在同一缓存行
class Queue {
    volatile long head;  // 生产者频繁修改
    volatile long tail;  // 消费者频繁修改
}
```

Doug Lea 在 `LinkedTransferQueue` 中的解决方案——填充字节使变量独占一个缓存行：

```java
// JDK 7 中的做法
class PaddedAtomicReference<T> extends AtomicReference<T> {
    Object p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, pa, pb, pc, pd, pe;
}

// JDK 8+ 可以使用 @Contended 注解
@sun.misc.Contended
class QueueNode {
    volatile long value;
}
```

## 二、Java 内存模型（JMM）

### 2.1 JMM 的抽象

Java 内存模型（Java Memory Model）定义了**多线程如何通过共享内存进行通信**的规则。它并不描述具体的硬件实现，而是提供了一组抽象的可见性和有序性保证。

```
线程 A 工作内存          线程 B 工作内存
┌──────────────┐      ┌──────────────┐
│  变量副本      │      │  变量副本      │
└──────┬───────┘      └──────┬───────┘
       │    save/load         │
       └──────────┬───────────┘
              主内存
         ┌──────────────┐
         │  共享变量      │
         └──────────────┘
```

JMM 定义了 8 种内存交互操作：lock、unlock、read、load、use、assign、store、write。这些操作的组合规则保证了多线程程序的语义正确性。

### 2.2 三大并发问题

| 问题 | 描述 | 根源 |
|------|------|------|
| **可见性** | 一个线程修改了变量，其他线程看不到最新值 | CPU 缓存导致各线程工作内存不一致 |
| **原子性** | 一组操作被中断导致中间状态暴露 | 线程切换导致复合操作被打断 |
| **有序性** | 代码执行顺序与编写顺序不一致 | 编译器优化、CPU 指令重排序 |

### 2.3 volatile 的语义与实现

`volatile` 是 Java 中最轻量的同步机制，它提供两个保证：

1. **可见性**：对 volatile 变量的写操作对所有线程立即可见
2. **有序性**：禁止指令重排序（通过内存屏障实现）

**但不保证原子性**：`volatile int count; count++` 并不是线程安全的，因为 `count++` 是读-改-写三步操作。

**硬件级实现**：

在 x86 架构上，对 volatile 变量的写操作会生成一条带 **LOCK 前缀**的指令。LOCK 前缀的作用：

1. 将当前处理器缓存行的数据写回主内存
2. 使其他处理器中缓存该地址的缓存行失效（通过 MESI 协议）

```
// JIT 编译后的汇编（x86）
0x01a3de24: lock addl $0x0,(%esp)  // LOCK 前缀指令
```

在 P6 及更新的处理器上，LOCK 不再锁总线，而是**锁缓存行**（Cache Locking），性能开销远小于总线锁。

### 2.4 happens-before 规则

JMM 通过 **happens-before** 关系定义了操作间的可见性保证。如果操作 A happens-before 操作 B，则 A 的结果对 B 可见。

| 规则 | 说明 |
|------|------|
| 程序顺序规则 | 同一线程中的操作，前面的 happens-before 后面的 |
| volatile 规则 | volatile 写 happens-before 后续的 volatile 读 |
| 锁规则 | unlock happens-before 后续对同一锁的 lock |
| 传递性 | 如果 A hb B，B hb C，则 A hb C |
| 线程启动规则 | `Thread.start()` happens-before 该线程的每个动作 |
| 线程终止规则 | 线程的所有动作 happens-before 其他线程检测到该线程终止 |

## 三、锁机制

### 3.1 synchronized vs Lock

Java 提供两种锁机制：内置锁（`synchronized`）和显式锁（`java.util.concurrent.locks.Lock`）。

| 维度 | synchronized | Lock |
|------|-------------|------|
| 实现层面 | JVM 内置（monitorenter/monitorexit） | Java API 层（基于 AQS） |
| 锁获取 | 阻塞式，不可中断 | 支持非阻塞 `tryLock()`、可中断 `lockInterruptibly()` |
| 锁释放 | 自动释放（退出同步块） | 必须在 `finally` 中手动 `unlock()` |
| 条件等待 | `Object.wait()/notify()` | `Condition.await()/signal()`，支持多条件队列 |
| 公平性 | 不支持 | `ReentrantLock(true)` 支持公平锁 |
| 锁状态查询 | 不支持 | `isLocked()`、`getHoldCount()` 等 |

**选择原则**：优先使用 `synchronized`（JVM 持续优化，且不会忘记释放锁）；需要高级特性（超时、中断、多条件、公平性）时选择 `Lock`。

### 3.2 Condition：精确的线程协作

`Condition` 是 `Lock` 的配套组件，它替代了 `Object.wait()/notify()` 机制，最大的优势是**支持多个等待队列**。

```java
// 使用 Object 的 wait/notify：只有一个等待队列，notifyAll 会唤醒所有线程
// 使用 Condition：可以创建多个条件队列，signal 只唤醒特定队列中的线程

ReentrantLock lock = new ReentrantLock();
Condition notFull  = lock.newCondition();  // 生产者等待队列
Condition notEmpty = lock.newCondition();  // 消费者等待队列
```

**有界缓冲区实现**（经典的生产者-消费者模型）：

```java
class BoundedBuffer<E> {
    final Lock lock = new ReentrantLock();
    final Condition notFull  = lock.newCondition();
    final Condition notEmpty = lock.newCondition();
    final Object[] items = new Object[100];
    int putIndex, takeIndex, count;

    public void put(E e) throws InterruptedException {
        lock.lock();
        try {
            while (count == items.length)
                notFull.await();      // 缓冲区满，生产者等待
            items[putIndex] = e;
            if (++putIndex == items.length) putIndex = 0;
            ++count;
            notEmpty.signal();        // 通知消费者
        } finally {
            lock.unlock();
        }
    }

    public E take() throws InterruptedException {
        lock.lock();
        try {
            while (count == 0)
                notEmpty.await();     // 缓冲区空，消费者等待
            E e = (E) items[takeIndex];
            if (++takeIndex == items.length) takeIndex = 0;
            --count;
            notFull.signal();         // 通知生产者
            return e;
        } finally {
            lock.unlock();
        }
    }
}
```

注意 `await()` 必须在 `while` 循环中调用，以防止**虚假唤醒（Spurious Wakeup）**。

### 3.3 ReadWriteLock：读写分离

当读操作远多于写操作时，使用排他锁会严重限制并发度。`ReadWriteLock` 允许多个线程同时持有读锁，但写锁是排他的。

| 锁状态 | 读锁请求 | 写锁请求 |
|--------|----------|----------|
| 无锁 | 允许 | 允许 |
| 读锁已持有 | 允许（共享） | 阻塞 |
| 写锁已持有 | 阻塞 | 阻塞 |

`ReentrantReadWriteLock` 的设计决策：

- **写锁可降级为读锁**：持有写锁的线程可以再获取读锁，然后释放写锁
- **读锁不可升级为写锁**：防止死锁（多个读线程同时尝试升级会互相等待）
- **支持公平/非公平模式**：非公平模式下，读锁可能"插队"导致写线程饥饿

## 四、JUC 并发工具类

`java.util.concurrent` 包提供了一组高级同步工具，用于解决常见的线程协调问题。

### 4.1 CountDownLatch：一次性倒计数门闩

**语义**：一个或多个线程等待其他线程完成一组操作后再继续执行。

```java
CountDownLatch latch = new CountDownLatch(3);  // 计数器初始值 3

// 工作线程
executor.submit(() -> {
    doTask();
    latch.countDown();  // 计数器 -1
});

// 等待线程
latch.await();  // 阻塞直到计数器归零
// 所有任务完成，继续执行
```

**核心特征**：

- **一次性**：计数器归零后无法重置
- 底层基于 AQS 的共享模式实现

**典型场景**：服务启动时等待所有依赖组件初始化完成。

### 4.2 CyclicBarrier：可重用的屏障

**语义**：一组线程互相等待，直到所有线程都到达屏障点，然后同时继续执行。

```java
CyclicBarrier barrier = new CyclicBarrier(3, () -> {
    System.out.println("所有线程到齐，开始下一阶段");  // barrierAction
});

// 每个工作线程
executor.submit(() -> {
    doPhase1();
    barrier.await();  // 等待其他线程
    doPhase2();
    barrier.await();  // 可以重复使用
});
```

**核心特征**：

- **可重用**：所有线程通过屏障后，计数器自动重置
- 支持 **barrierAction**：所有线程到齐时执行的回调
- 如果某个线程等待超时或被中断，屏障进入 **Broken** 状态，所有等待线程收到 `BrokenBarrierException`

### 4.3 Semaphore：信号量

**语义**：控制同时访问某个资源的线程数量。

```java
Semaphore semaphore = new Semaphore(5);  // 最多 5 个并发

executor.submit(() -> {
    semaphore.acquire();    // 获取许可（可用许可 -1）
    try {
        accessResource();
    } finally {
        semaphore.release();  // 释放许可（可用许可 +1）
    }
});
```

**核心特征**：

- 支持**公平/非公平**模式
- `tryAcquire()` 提供非阻塞获取
- 许可数量可以动态增减（`release()` 可以在未 `acquire()` 的情况下调用）

### 4.4 三者对比

| 工具 | 核心语义 | 是否可重用 | 计数方向 | 典型场景 |
|------|----------|-----------|----------|----------|
| **CountDownLatch** | 一个线程等待 N 个线程 | 否 | 递减至 0 | 主线程等待子任务完成 |
| **CyclicBarrier** | N 个线程互相等待 | 是 | 递增至 N | 多阶段并行计算 |
| **Semaphore** | 控制并发访问数量 | - | 许可的获取与释放 | 限流、资源池 |

## 五、生产者-消费者模式

生产者-消费者是并发编程中最经典的协作模式。Java 提供了从底层到高层的多种实现方式。

### 5.1 三种实现方式对比

| 实现方式 | 同步机制 | 通知粒度 | 复杂度 | 推荐度 |
|----------|----------|----------|--------|--------|
| synchronized + wait/notify | 内置锁 | 全量唤醒（notifyAll） | 低 | 一般 |
| Lock + Condition | 显式锁 | 精确唤醒（signal） | 中 | 推荐 |
| BlockingQueue | 封装在队列内部 | 内部自动处理 | 最低 | 最推荐 |

**为什么 BlockingQueue 是最佳选择**：

`BlockingQueue` 将同步、等待、通知的逻辑完全封装在 `put()`/`take()` 方法内部，调用方无需关心并发细节：

```java
BlockingQueue<Task> queue = new ArrayBlockingQueue<>(100);

// 生产者
queue.put(task);   // 队列满时自动阻塞

// 消费者
Task task = queue.take();  // 队列空时自动阻塞
```

### 5.2 BlockingQueue 的实现选型

| 实现类 | 底层结构 | 是否有界 | 锁策略 | 适用场景 |
|--------|----------|----------|--------|----------|
| `ArrayBlockingQueue` | 数组 | 有界 | 单锁 | 通用场景 |
| `LinkedBlockingQueue` | 链表 | 可选有界 | 读写分离锁 | 吞吐量要求高 |
| `SynchronousQueue` | 无容量 | 无 | CAS | 直接传递（线程池默认） |
| `PriorityBlockingQueue` | 堆 | 无界 | 单锁 | 优先级调度 |

## 六、线程池

### 6.1 ThreadPoolExecutor 核心参数

```java
new ThreadPoolExecutor(
    corePoolSize,      // 核心线程数
    maximumPoolSize,   // 最大线程数
    keepAliveTime,     // 非核心线程空闲存活时间
    TimeUnit.SECONDS,
    workQueue,         // 任务队列
    threadFactory,     // 线程工厂
    rejectedHandler    // 拒绝策略
);
```

**任务提交流程**：

```
提交任务
  → 当前线程数 < corePoolSize？        → 创建核心线程执行
  → 任务队列未满？                      → 入队等待
  → 当前线程数 < maximumPoolSize？      → 创建非核心线程执行
  → 以上都不满足                        → 执行拒绝策略
```

### 6.2 拒绝策略

| 策略 | 行为 | 适用场景 |
|------|------|----------|
| **AbortPolicy** | 抛出 `RejectedExecutionException` | 默认策略，适合需要感知过载的场景 |
| **CallerRunsPolicy** | 由提交线程自己执行任务 | 反压效果，但可能导致提交线程阻塞 |
| **DiscardPolicy** | 静默丢弃任务 | 允许丢失的场景（如日志） |
| **DiscardOldestPolicy** | 丢弃队列中最旧的任务 | 实时性要求高、可接受旧数据丢失 |

### 6.3 生产阻塞型线程池

标准 `ThreadPoolExecutor` 使用 `BlockingQueue.offer()`（非阻塞）入队。队列满时不会阻塞提交线程，而是触发拒绝策略。

在某些场景下（如需要严格的背压机制），需要让提交线程在队列满时**阻塞等待**而非被拒绝。可通过自定义拒绝策略实现：

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    coreSize, maxSize, 60, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(capacity),
    (runnable, pool) -> {
        try {
            // 队列满时，put() 会阻塞提交线程
            pool.getQueue().put(runnable);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
);
```

这种方式的优势在于：复用 `ThreadPoolExecutor` 的线程管理能力，同时实现了生产者阻塞语义，避免了手工管理线程的复杂性。

### 6.4 线程池配置最佳实践

| 任务类型 | 核心线程数建议 | 队列选择 |
|----------|--------------|----------|
| **CPU 密集型** | `N_cpu + 1` | 小容量有界队列 |
| **I/O 密集型** | `N_cpu × 2` 或更高 | 较大容量有界队列 |
| **混合型** | 拆分为 CPU 池和 I/O 池 | 各自独立配置 |

关键原则：

- **永远不要使用无界队列**：`Executors.newFixedThreadPool()` 默认使用无界的 `LinkedBlockingQueue`，可能导致 OOM
- **为线程池命名**：自定义 `ThreadFactory`，给线程添加有意义的名称前缀，便于排查问题
- **监控队列深度**：线程池队列持续增长是系统过载的信号

## 总结

Java 并发编程的知识体系可以沿着三个层次理解：

1. **硬件层**：CPU 缓存、MESI 协议、缓存行伪共享——这是并发问题的物理根源
2. **模型层**：JMM、happens-before、volatile/synchronized 语义——这是 Java 对硬件差异的抽象屏蔽
3. **工具层**：Lock/Condition、CountDownLatch/CyclicBarrier/Semaphore、BlockingQueue、ThreadPoolExecutor——这是面向工程的并发编程基础设施

> 并发工具的选择不在于功能的强大，而在于语义的匹配。`synchronized` 足以解决大多数问题；`BlockingQueue` 比手动的 wait/notify 更安全；标准 `ThreadPoolExecutor` 比自定义线程管理更可靠。优先选择高层抽象，只在确有需要时才下沉到底层机制。
