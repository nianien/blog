---
title: "深入理解AQS：Java并发的基石"
pubDate: "2025-12-28"
description: "系统性剖析 AbstractQueuedSynchronizer（AQS）的设计思想、核心数据结构、加锁解锁流程，并通过 ReentrantLock 源码深入理解其工作原理，最后梳理 AQS 在 JUC 中的典型应用场景。"
tags: ["Java", "并发编程", "AQS", "ReentrantLock", "JUC"]
---

> Java 中的大部分同步工具（ReentrantLock、Semaphore、CountDownLatch、ReentrantReadWriteLock 等）都基于 AbstractQueuedSynchronizer（AQS）实现。理解 AQS，就等于掌握了 Java 并发编程的底层脉络。本文从设计思想出发，逐层深入 AQS 的数据结构、核心流程和源码实现，并通过 ReentrantLock 串联全局，最后梳理 AQS 在 JUC 中的应用全景。

## AQS 是什么？

AQS（AbstractQueuedSynchronizer）是 `java.util.concurrent.locks` 包中的一个**抽象类**，是构建锁和同步器的基础框架。Doug Lea 设计 AQS 的核心目标是：

- 降低构建锁和同步器的工作量
- 避免在多个位置处理竞争问题
- 在基于 AQS 的同步器中，阻塞只可能在一个时刻发生，降低上下文切换开销，提高吞吐量

AQS 支持两种工作模式：

| 模式 | 含义 | 典型实现 |
|------|------|---------|
| **独占模式（Exclusive）** | 同一时刻只能有一个线程获取到锁 | ReentrantLock |
| **共享模式（Shared）** | 同一时刻可以有多个线程同时获取 | CountDownLatch、ReadWriteLock、Semaphore |

无论哪种模式，本质上都是对 AQS 内部一个 **`state` 变量**的获取和释放。

## AQS 的整体架构

AQS 框架共分为**五层**，自上而下由浅入深：

| 层次 | 内容 | 说明 |
|------|------|------|
| 第一层 | API 层 | 自定义同步器需重写的方法（tryAcquire、tryRelease 等） |
| 第二层 | 获取/释放方法 | acquire、release、acquireShared、releaseShared |
| 第三层 | 队列操作 | addWaiter、acquireQueued、shouldParkAfterFailedAcquire |
| 第四层 | 线程阻塞/唤醒 | LockSupport.park / unpark |
| 第五层 | 基础数据 | state、Node、CLH 变体队列 |

当接入自定义同步器时，**只需重写第一层的部分方法即可**，不需要关注底层实现。当加锁或解锁操作触发时，沿着第一层到第五层逐层深入。

## 核心数据结构

### 同步状态 State

AQS 使用一个 `volatile int` 类型的成员变量 `state` 来表示同步状态：

```java
private volatile int state;
```

State 的含义由具体的同步器定义，例如：
- **ReentrantLock**：state 表示锁被重入的次数，0 表示未被持有
- **Semaphore**：state 表示可用许可的数量
- **CountDownLatch**：state 表示计数器的值

AQS 提供三个方法操作 state，均为 `final` 修饰，子类不可重写：

| 方法 | 说明 |
|------|------|
| `getState()` | 获取当前 state 值 |
| `setState(int)` | 设置 state 值 |
| `compareAndSetState(int, int)` | CAS 方式更新 state |

### CLH 变体队列与 Node 节点

AQS 的核心思想是：如果请求的共享资源空闲，就将当前线程设置为有效的工作线程，并将资源设置为锁定状态；**如果资源被占用，就通过一个 CLH 变体的 FIFO 双向队列来管理等待线程**。

> CLH 队列以其发明者 Craig、Landin 和 Hagersten 命名，原始 CLH 是单向链表。AQS 中的变体是虚拟双向队列，通过将每条请求线程封装成 Node 节点来实现锁的分配。

Node 节点的关键属性：

| 属性 | 含义 |
|------|------|
| `thread` | 该节点代表的线程 |
| `waitStatus` | 当前节点在队列中的等待状态 |
| `prev` | 前驱指针 |
| `next` | 后继指针 |
| `nextWaiter` | 指向下一个处于 CONDITION 状态的节点 |

`waitStatus` 的枚举值：

| 值 | 名称 | 含义 |
|----|------|------|
| 0 | 默认值 | Node 初始化时的状态 |
| 1 | CANCELLED | 线程获取锁的请求已取消 |
| -1 | SIGNAL | 后继节点的线程需要被唤醒 |
| -2 | CONDITION | 节点在条件队列中，等待 Condition 唤醒 |
| -3 | PROPAGATE | 共享模式下，释放操作需要向后传播 |

AQS 内部还维护了**两种队列**：

- **同步队列（Sync Queue）**：获取资源失败的线程进入此队列自旋等待，当前驱节点是头节点时尝试获取资源
- **条件队列（Condition Queue）**：基于 `Condition` 实现，调用 `await()` 时线程进入条件队列，调用 `signal()` 时转移到同步队列

> 注意：双向链表的**头节点是一个虚节点**（不存储实际线程信息），真正的第一个有效节点从第二个开始。

## 自定义同步器需要重写的方法

AQS 采用**模板方法模式**，自定义同步器只需根据需要重写以下方法：

| 方法 | 模式 | 说明 |
|------|------|------|
| `tryAcquire(int)` | 独占 | 尝试获取资源，成功返回 true |
| `tryRelease(int)` | 独占 | 尝试释放资源，成功返回 true |
| `tryAcquireShared(int)` | 共享 | 尝试获取资源，负数=失败，0=成功但无剩余，正数=成功且有剩余 |
| `tryReleaseShared(int)` | 共享 | 尝试释放资源，如果释放后允许唤醒后续节点返回 true |
| `isHeldExclusively()` | 独占 | 当前线程是否独占资源，用到 Condition 时需实现 |

独占模式实现 `tryAcquire-tryRelease`，共享模式实现 `tryAcquireShared-tryReleaseShared`。AQS 也支持同时实现两种模式，如 `ReentrantReadWriteLock`。

## 通过 ReentrantLock 理解加锁流程

ReentrantLock 是 AQS 独占模式最典型的实现。我们以**非公平锁**为例，完整追踪加锁流程。

### 第一步：lock()

```java
// ReentrantLock.NonfairSync
final void lock() {
    if (compareAndSetState(0, 1))           // 直接 CAS 尝试获取锁
        setExclusiveOwnerThread(Thread.currentThread());
    else
        acquire(1);                          // 失败则进入 AQS 框架流程
}
```

非公平锁上来就尝试 CAS 抢锁（不管队列中有没有等待线程），这是它"非公平"的体现。

### 第二步：acquire()

```java
// AbstractQueuedSynchronizer
public final void acquire(int arg) {
    if (!tryAcquire(arg) &&
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
        selfInterrupt();
}
```

这一行代码浓缩了整个加锁流程的四个步骤：

```
tryAcquire → addWaiter → acquireQueued → selfInterrupt
```

1. **tryAcquire**：尝试获取锁（由子类实现）
2. **addWaiter**：获取失败，将当前线程封装为 Node 加入队列尾部
3. **acquireQueued**：在队列中自旋等待，直到获取到锁
4. **selfInterrupt**：如果等待过程中被中断过，补上中断

### 第三步：tryAcquire（公平 vs 非公平）

**非公平锁**的实现：

```java
final boolean nonfairTryAcquire(int acquires) {
    final Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        if (compareAndSetState(0, acquires)) {   // 直接 CAS，不检查队列
            setExclusiveOwnerThread(current);
            return true;
        }
    }
    else if (current == getExclusiveOwnerThread()) {  // 可重入逻辑
        int nextc = c + acquires;
        if (nextc < 0) throw new Error("Maximum lock count exceeded");
        setState(nextc);
        return true;
    }
    return false;
}
```

**公平锁**的区别仅在于多了一个 `hasQueuedPredecessors()` 检查：

```java
if (c == 0) {
    if (!hasQueuedPredecessors() &&   // 公平锁：先检查队列中是否有等待线程
        compareAndSetState(0, acquires)) {
        setExclusiveOwnerThread(current);
        return true;
    }
}
```

| 锁类型 | state == 0 时的行为 | 可重入逻辑 |
|--------|-------------------|-----------|
| 非公平锁 | 直接 CAS 抢锁 | 相同：state + 1 |
| 公平锁 | 先检查队列再 CAS | 相同：state + 1 |

### 第四步：addWaiter — 入队

```java
private Node addWaiter(Node mode) {
    Node node = new Node(Thread.currentThread(), mode);
    Node pred = tail;
    if (pred != null) {            // 队列已初始化，尝试快速入队
        node.prev = pred;
        if (compareAndSetTail(pred, node)) {
            pred.next = node;
            return node;
        }
    }
    enq(node);                     // 快速入队失败或队列未初始化
    return node;
}
```

`enq()` 方法通过**自旋 + CAS** 确保入队成功：

```java
private Node enq(final Node node) {
    for (;;) {
        Node t = tail;
        if (t == null) {                         // 队列为空，初始化
            if (compareAndSetHead(new Node()))    // 创建虚拟头节点
                tail = head;
        } else {
            node.prev = t;
            if (compareAndSetTail(t, node)) {
                t.next = node;
                return t;
            }
        }
    }
}
```

线程获取锁的过程可以形象理解为：

```
线程1获取锁成功 → 线程2申请锁失败 → 线程2入队等待 → 线程3申请失败 → 线程3排在线程2后面 → ...
```

### 第五步：acquireQueued — 自旋获取锁

```java
final boolean acquireQueued(final Node node, int arg) {
    boolean failed = true;
    try {
        boolean interrupted = false;
        for (;;) {
            final Node p = node.predecessor();
            if (p == head && tryAcquire(arg)) {   // 前驱是头节点，尝试获取锁
                setHead(node);                     // 获取成功，当前节点成为新的头节点
                p.next = null;                     // help GC
                failed = false;
                return interrupted;
            }
            if (shouldParkAfterFailedAcquire(p, node) &&
                parkAndCheckInterrupt())           // 获取失败，判断是否需要挂起
                interrupted = true;
        }
    } finally {
        if (failed)
            cancelAcquire(node);
    }
}
```

核心逻辑：**只有前驱节点是头节点的线程才有资格尝试获取锁**。获取失败后，通过 `shouldParkAfterFailedAcquire` 判断是否需要挂起（将前驱节点的 waitStatus 设为 SIGNAL），然后通过 `LockSupport.park()` 挂起线程，避免空转浪费 CPU。

### shouldParkAfterFailedAcquire 的三种情况

```java
private static boolean shouldParkAfterFailedAcquire(Node pred, Node node) {
    int ws = pred.waitStatus;
    if (ws == Node.SIGNAL)        // 前驱已经是 SIGNAL，可以安全挂起
        return true;
    if (ws > 0) {                 // 前驱已取消，向前找到有效节点
        do {
            node.prev = pred = pred.prev;
        } while (pred.waitStatus > 0);
        pred.next = node;
    } else {                      // 前驱状态为 0 或 PROPAGATE，设为 SIGNAL
        compareAndSetWaitStatus(pred, ws, Node.SIGNAL);
    }
    return false;
}
```

| 前驱 waitStatus | 处理 | 是否挂起 |
|----------------|------|---------|
| SIGNAL (-1) | 直接返回 true | 是 |
| CANCELLED (>0) | 跳过所有取消节点，重新链接 | 否，下次循环再判断 |
| 0 或 PROPAGATE | CAS 设为 SIGNAL | 否，下次循环再判断 |

## 解锁流程

ReentrantLock 解锁时**不区分公平和非公平**：

```java
// ReentrantLock
public void unlock() {
    sync.release(1);
}
```

```java
// AbstractQueuedSynchronizer
public final boolean release(int arg) {
    if (tryRelease(arg)) {
        Node h = head;
        if (h != null && h.waitStatus != 0)
            unparkSuccessor(h);          // 唤醒后继节点
        return true;
    }
    return false;
}
```

### tryRelease — 可重入锁的释放

```java
// ReentrantLock.Sync
protected final boolean tryRelease(int releases) {
    int c = getState() - releases;       // state 减 1
    if (Thread.currentThread() != getExclusiveOwnerThread())
        throw new IllegalMonitorStateException();
    boolean free = false;
    if (c == 0) {                         // 只有 state 减到 0，锁才真正释放
        free = true;
        setExclusiveOwnerThread(null);
    }
    setState(c);
    return free;
}
```

### unparkSuccessor — 唤醒后继线程

```java
private void unparkSuccessor(Node node) {
    int ws = node.waitStatus;
    if (ws < 0)
        compareAndSetWaitStatus(node, ws, 0);

    Node s = node.next;
    if (s == null || s.waitStatus > 0) {
        s = null;
        // 从尾部向前遍历，找到第一个非取消状态的节点
        for (Node t = tail; t != null && t != node; t = t.prev)
            if (t.waitStatus <= 0)
                s = t;
    }
    if (s != null)
        LockSupport.unpark(s.thread);    // 唤醒线程
}
```

> **为什么要从后向前遍历？** 两个原因：
> 1. `addWaiter` 中节点入队不是原子操作——`node.prev = pred` 和 `compareAndSetTail` 完成后，`pred.next = node` 可能还未执行。此时从前向后遍历会断链。
> 2. `cancelAcquire` 产生 CANCELLED 节点时，先断开的是 next 指针，prev 指针未断开。因此从后向前遍历才能保证遍历完整。

## CANCELLED 节点的处理

当 `acquireQueued` 中发生异常时，会执行 `cancelAcquire(node)` 将节点标记为 CANCELLED。处理逻辑根据节点位置分为三种情况：

| 节点位置 | 处理方式 |
|---------|---------|
| 尾节点 | 将前驱设为新的 tail，其 next 置为 null |
| 头节点的后继 | 唤醒当前节点的后继线程（unparkSuccessor） |
| 中间节点 | 将前驱的 next 指向当前节点的后继，跳过当前节点 |

> `cancelAcquire` 只操作 next 指针，不操作 prev 指针。因为执行 cancel 时前驱可能已经出队，修改 prev 不安全。prev 指针的清理留给 `shouldParkAfterFailedAcquire`——此方法在获取锁失败时执行，此时共享资源已被占用，前方节点不会变化，修改 prev 是安全的。

## 中断处理机制

AQS 的 `acquire` 方法是**不可中断**的——线程在等待过程中不会响应中断，而是记录中断状态，等获取到锁后再"补上"中断：

```java
public final void acquire(int arg) {
    if (!tryAcquire(arg) &&
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))  // 返回 true 说明被中断过
        selfInterrupt();                                  // 补上中断
}

static void selfInterrupt() {
    Thread.currentThread().interrupt();
}
```

这种设计的考量是：线程被唤醒时并不知道原因（可能是前驱释放了锁，也可能是被中断），所以通过 `Thread.interrupted()` 检查并清除中断标记，记录下来，最后在获取锁成功后统一补上。

## park / unpark 机制

AQS 中线程的阻塞和唤醒通过 `LockSupport` 实现：

| 方法 | 作用 |
|------|------|
| `LockSupport.park(this)` | 阻塞当前线程 |
| `LockSupport.unpark(thread)` | 唤醒指定线程 |

它们的底层实现是通过 `Unsafe` 类调用 CPU 原语。相比 `Object.wait/notify`，park/unpark 的优势在于：

- 不需要在同步块中使用
- `unpark` 可以先于 `park` 调用（基于许可机制）
- 可以精确唤醒指定线程

在 AQS 中使用 park 的主要目的是：**让排队等待的线程挂起，停止自旋以避免浪费 CPU 资源**，并在需要时通过 unpark 精确唤醒。

## AQS 在 JUC 中的应用场景

AQS 是 JUC 包的基石，几乎所有同步工具都构建在它之上：

| 同步工具 | 如何使用 AQS |
|---------|------------|
| **ReentrantLock** | state 表示锁的重入次数。获取锁时 state+1，释放时 state-1。state 为 0 表示锁空闲。同时记录持有锁的线程用于重入检测。 |
| **Semaphore** | state 表示可用许可数。`acquireShared` 减少计数，`tryReleaseShared` 增加计数。 |
| **CountDownLatch** | state 表示计数器。每次 `countDown()` 减 1，`await()` 等待 state 变为 0 后所有线程被唤醒。 |
| **ReentrantReadWriteLock** | state 的高 16 位保存读锁持有次数，低 16 位保存写锁持有次数。读锁用共享模式，写锁用独占模式。 |
| **ThreadPoolExecutor** | Worker 内部类继承 AQS，利用独占模式实现对工作线程的状态管理。 |

### State 在不同同步器中的语义

```
ReentrantLock:       state = 重入次数 (0 = 空闲)
Semaphore:           state = 可用许可数
CountDownLatch:      state = 剩余计数 (0 = 所有线程放行)
ReadWriteLock:       state = [高16位:读锁次数][低16位:写锁次数]
```

## 自定义同步器示例

理解 AQS 后，我们可以用极少的代码实现一个简单的互斥锁：

```java
public class SimpleLock {

    private static class Sync extends AbstractQueuedSynchronizer {
        @Override
        protected boolean tryAcquire(int arg) {
            return compareAndSetState(0, 1);
        }

        @Override
        protected boolean tryRelease(int arg) {
            setState(0);
            return true;
        }

        @Override
        protected boolean isHeldExclusively() {
            return getState() == 1;
        }
    }

    private final Sync sync = new Sync();

    public void lock()   { sync.acquire(1); }
    public void unlock() { sync.release(1); }
}
```

使用：

```java
public static void main(String[] args) throws InterruptedException {
    SimpleLock lock = new SimpleLock();
    int[] count = {0};

    Runnable task = () -> {
        lock.lock();
        try {
            for (int i = 0; i < 10000; i++) count[0]++;
        } finally {
            lock.unlock();
        }
    };

    Thread t1 = new Thread(task);
    Thread t2 = new Thread(task);
    t1.start(); t2.start();
    t1.join();  t2.join();
    System.out.println(count[0]);  // 始终输出 20000
}
```

只需重写 `tryAcquire` 和 `tryRelease`，AQS 就接管了排队、阻塞、唤醒、中断处理等全部复杂逻辑。

## 总结

AQS 的设计精髓可以归纳为以下几点：

1. **一个 state 变量统一抽象**：不同的同步器通过赋予 state 不同的语义（重入次数、许可数、计数器等），复用同一套框架
2. **CLH 变体双向队列管理等待线程**：通过 FIFO 队列保证公平性，通过 CAS + 自旋保证入队的线程安全
3. **模板方法模式降低接入成本**：自定义同步器只需实现 tryAcquire/tryRelease 等少量方法，框架处理全部排队和唤醒逻辑
4. **park/unpark 精确控制线程状态**：避免自旋空转浪费 CPU，同时支持精确唤醒
5. **从后向前遍历保证正确性**：在非原子入队操作和 CANCELLED 节点处理中，始终保证能遍历到所有有效节点

> AQS 是 Doug Lea 在并发编程领域的杰作。理解了 AQS，就理解了 JUC 包中绝大部分同步工具的底层运作方式。它不仅是面试的高频考点，更是我们在实际工程中设计自定义同步器时可以直接借鉴的框架。
