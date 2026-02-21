---
title: "深入理解JVM：从类加载到垃圾回收的全链路剖析"
pubDate: "2021-06-15"
description: "系统剖析JVM核心机制，从类加载的双亲委派模型到运行时内存布局，从PermGen到Metaspace的演进，再到七大垃圾收集器的设计原理与选型策略，构建完整的JVM知识体系。"
tags: ["JVM", "Java", "垃圾回收", "类加载", "性能调优"]
---

# 深入理解JVM：从类加载到垃圾回收的全链路剖析

> Java 程序的生命周期始于类加载，终于垃圾回收。理解 JVM 的工作原理，不仅是性能调优的基础，更是理解 Java 语言设计哲学的关键。

JVM（Java Virtual Machine）是 Java 生态的基石。它屏蔽了底层硬件差异，为 Java 程序提供了一个统一的运行时环境。但这层抽象并非没有代价——内存管理、类加载、即时编译等机制的复杂性，往往是生产环境问题的根源。

本文将沿着 Java 程序的执行链路，从类文件的加载、运行时内存的分配，到对象的回收，系统梳理 JVM 的核心机制。

## 一、类加载机制

### 1.1 类的生命周期

一个 Java 类从被加载到 JVM 内存，到最终被卸载，经历以下阶段：

```
加载（Loading）→ 验证（Verification）→ 准备（Preparation）
    → 解析（Resolution）→ 初始化（Initialization）
        → 使用（Using）→ 卸载（Unloading）
```

其中，验证、准备、解析统称为**链接（Linking）**阶段。

| 阶段 | 核心动作 | 说明 |
|------|----------|------|
| **加载** | 读取 .class 字节流，生成 Class 对象 | 由 ClassLoader 执行 |
| **验证** | 校验字节码的合法性和安全性 | 文件格式、元数据、字节码、符号引用验证 |
| **准备** | 为类的静态变量分配内存并赋零值 | `static int a = 10` 在此阶段 a = 0 |
| **解析** | 将符号引用替换为直接引用 | 类、字段、方法、接口方法的解析 |
| **初始化** | 执行类构造器 `<clinit>()` | 静态变量赋值和静态代码块的执行 |

### 1.2 ClassLoader 体系

JVM 内置三层 ClassLoader，形成层级结构：

```
Bootstrap ClassLoader（引导类加载器）
    ↑ parent
Extension ClassLoader（扩展类加载器）
    ↑ parent
Application ClassLoader（应用类加载器）
    ↑ parent
Custom ClassLoader（自定义类加载器）
```

| ClassLoader | 实现语言 | 加载路径 | 说明 |
|-------------|----------|----------|------|
| **Bootstrap** | C/C++ | `$JAVA_HOME/lib`（rt.jar 等） | JVM 内部实现，Java 中无法直接引用（返回 null） |
| **Extension** | Java | `$JAVA_HOME/lib/ext` | `sun.misc.Launcher$ExtClassLoader` |
| **Application** | Java | classpath | `sun.misc.Launcher$AppClassLoader`，默认的类加载器 |

三者的关系通过 `sun.misc.Launcher` 的构造函数建立：

```java
public Launcher() {
    // 1. 创建 ExtClassLoader
    ExtClassLoader extClassLoader = ExtClassLoader.getExtClassLoader();
    // 2. 创建 AppClassLoader，parent 设为 ExtClassLoader
    AppClassLoader appClassLoader = AppClassLoader.getAppClassLoader(extClassLoader);
    // 3. 设置线程上下文类加载器为 AppClassLoader
    Thread.currentThread().setContextClassLoader(appClassLoader);
}
```

### 1.3 双亲委派模型

**核心规则**：当一个 ClassLoader 收到类加载请求时，首先将请求委派给父加载器处理，只有当父加载器无法完成加载时，才由自身尝试加载。

执行流程（`ClassLoader.loadClass()` 源码逻辑）：

```java
protected Class<?> loadClass(String name, boolean resolve) {
    // 1. 检查类是否已被加载
    Class<?> c = findLoadedClass(name);
    if (c == null) {
        try {
            // 2. 委派给父加载器
            if (parent != null) {
                c = parent.loadClass(name, false);
            } else {
                // parent 为 null 表示委派给 Bootstrap
                c = findBootstrapClassOrNull(name);
            }
        } catch (ClassNotFoundException e) {
            // 父加载器无法加载
        }
        if (c == null) {
            // 3. 父加载器无法加载，自行加载
            c = findClass(name);
        }
    }
    return c;
}
```

**双亲委派的价值**：

- **安全性**：防止核心类库被篡改。即使自定义了一个 `java.lang.String`，也不会被加载，因为 Bootstrap ClassLoader 会优先加载 rt.jar 中的版本
- **唯一性**：同一个类在 JVM 中只会被加载一次，避免类的重复加载

### 1.4 打破双亲委派

双亲委派并非不可逾越。以下场景需要打破这一模型：

**场景一：SPI 机制**

Java SPI（Service Provider Interface）的典型问题：核心接口由 Bootstrap ClassLoader 加载（如 `java.sql.Driver`），但实现类在应用 classpath 下（如 MySQL 驱动），Bootstrap 无法向下委派。

解决方案：**线程上下文类加载器（Thread Context ClassLoader）**。

```java
// JDBC DriverManager 的实现
ServiceLoader<Driver> loadedDrivers = ServiceLoader.load(Driver.class);
// ServiceLoader.load() 内部使用 Thread.currentThread().getContextClassLoader()
// 从而绕过了双亲委派，用 AppClassLoader 加载 SPI 实现类
```

**场景二：热部署**

OSGi、Tomcat 等容器需要实现类的热替换。Tomcat 为每个 Web 应用创建独立的 ClassLoader（`WebAppClassLoader`），它优先从自身路径加载类，找不到才委派给父加载器——这与双亲委派的顺序恰好相反。

**场景三：自定义 ClassLoader**

通过重写 `findClass()` 方法实现自定义加载逻辑，如从网络加载、加密 class 文件的解密加载等：

```java
public class EncryptedClassLoader extends ClassLoader {
    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        byte[] encrypted = loadBytesFromDisk(name);
        byte[] decrypted = decrypt(encrypted);  // 解密 class 字节码
        return defineClass(name, decrypted, 0, decrypted.length);
    }
}
```

## 二、运行时内存模型

### 2.1 内存区域划分

JVM 运行时内存分为线程私有和线程共享两大类：

```
┌─────────────────── JVM 内存 ───────────────────────┐
│                                                      │
│  线程私有                    线程共享                   │
│  ┌──────────────────┐      ┌────────────────────┐   │
│  │ 程序计数器（PC）    │      │       堆（Heap）     │   │
│  │ 虚拟机栈（Stack）   │      │  ┌──────────────┐  │   │
│  │ 本地方法栈         │      │  │  新生代        │  │   │
│  └──────────────────┘      │  │  Eden + S0/S1 │  │   │
│                             │  ├──────────────┤  │   │
│                             │  │  老年代        │  │   │
│                             │  └──────────────┘  │   │
│                             ├────────────────────┤   │
│                             │  元空间（Metaspace）  │   │
│                             │  （本地内存）          │   │
│                             └────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

| 区域 | 线程属性 | 存储内容 | 异常 |
|------|----------|----------|------|
| **程序计数器** | 私有 | 当前线程执行的字节码行号 | 唯一不会 OOM 的区域 |
| **虚拟机栈** | 私有 | 栈帧（局部变量表、操作数栈、方法返回地址） | StackOverflowError / OOM |
| **本地方法栈** | 私有 | Native 方法调用的栈帧 | StackOverflowError / OOM |
| **堆** | 共享 | 对象实例和数组 | OutOfMemoryError: Java heap space |
| **元空间** | 共享 | 类元数据、方法字节码、常量池 | OutOfMemoryError: Metaspace |

### 2.2 从 PermGen 到 Metaspace

Java 8 是 JVM 内存模型的一个重要分水岭——**永久代（PermGen）被元空间（Metaspace）取代**。

**永久代的问题**：

- 大小固定（默认 64MB，`-XX:MaxPermSize`），难以预估合理值
- 类元数据与普通 Java 对象混在同一 GC 管理体系中，增加了 Full GC 的复杂度
- 动态生成类（如大量使用反射、动态代理）容易触发 `java.lang.OutOfMemoryError: PermGen space`

**元空间的设计**：

| 特性 | PermGen（Java 7-） | Metaspace（Java 8+） |
|------|--------------------|-----------------------|
| 存储位置 | JVM 堆内 | 本地内存（Native Memory） |
| 默认大小 | 固定（64MB） | 无上限（受物理内存限制） |
| 内存分配 | 与堆对象相同的 GC 管理 | 每个 ClassLoader 独立分配，线性分配 |
| 回收策略 | Full GC 触发 | ClassLoader 被回收时，整块释放 |
| 调优参数 | `-XX:MaxPermSize` | `-XX:MaxMetaspaceSize`、`-XX:MetaspaceSize` |

**元空间的内存模型**：

每个 ClassLoader 拥有独立的内存块（chunk）。加载新类时，从当前 chunk 中线性分配空间。当 ClassLoader 被 GC 回收时，其对应的所有 chunk 一次性释放——不存在单个类的逐一回收。

```
ClassLoader A → [chunk1: Class1 Class2 Class3]
ClassLoader B → [chunk2: Class4 Class5]
ClassLoader C → [chunk3: Class6]

当 ClassLoader B 被 GC → chunk2 整块释放
```

**压缩类指针空间（Compressed Class Space）**：

在 64 位 JVM 上，如果开启了压缩类指针（`-XX:+UseCompressedClassPointers`，默认开启），Metaspace 中的 `InstanceKlass`、`ArrayKlass` 及虚方法表会存储在一块独立的内存区域中。该区域大小通过 `-XX:CompressedClassSpaceSize` 控制（默认 1GB）。

### 2.3 对象的内存布局

一个 Java 对象在堆中的内存布局由三部分组成：

```
┌────────────────────────────────────┐
│          对象头（Header）             │
│  ┌──────────────────────────────┐  │
│  │ Mark Word（标记字）             │  │  → 哈希码、GC 年龄、锁标志位
│  │ Klass Pointer（类型指针）       │  │  → 指向元空间中的 Class 元数据
│  │ Array Length（仅数组对象）       │  │
│  └──────────────────────────────┘  │
├────────────────────────────────────┤
│          实例数据（Instance Data）    │  → 字段值（含父类字段）
├────────────────────────────────────┤
│          对齐填充（Padding）          │  → 补齐到 8 字节的整数倍
└────────────────────────────────────┘
```

**Mark Word 的结构**（64 位 JVM）：

| 锁状态 | 存储内容 | 标志位 |
|--------|----------|--------|
| 无锁 | 对象哈希码（31bit）、GC 分代年龄（4bit） | 01 |
| 偏向锁 | 线程 ID（54bit）、Epoch（2bit）、GC 年龄 | 01 |
| 轻量级锁 | 指向栈中锁记录的指针 | 00 |
| 重量级锁 | 指向 Monitor 的指针 | 10 |
| GC 标记 | 空 | 11 |

注意：GC 分代年龄占 **4 bit**，最大值为 15。这就是为什么对象晋升老年代的默认阈值 `-XX:MaxTenuringThreshold` 不能超过 15。

## 三、垃圾回收

### 3.1 对象存活判定

在回收内存之前，JVM 首先需要判断哪些对象是"活"的，哪些是"死"的。

**引用计数法**

每个对象维护一个引用计数器：被引用时加 1，引用失效时减 1。计数为 0 的对象即可回收。

优点：实现简单，判定效率高。
缺陷：**无法解决循环引用问题**。

```java
// A 和 B 互相引用，但外部已无法访问
// 引用计数永远不为 0，无法被回收
Object a = new Object();  // a.refCount = 1
Object b = new Object();  // b.refCount = 1
a.field = b;              // b.refCount = 2
b.field = a;              // a.refCount = 2
a = null;                 // a.refCount = 1（仍不为 0）
b = null;                 // b.refCount = 1（仍不为 0）
```

**可达性分析（Reachability Analysis）**

JVM 实际采用的方案。从一组称为 **GC Roots** 的根对象出发，沿引用链向下遍历。不在任何引用链上的对象即为不可达，判定为垃圾。

GC Roots 包括：

| GC Root 类型 | 说明 |
|--------------|------|
| 虚拟机栈中的局部变量 | 方法正在执行时，栈帧中引用的对象 |
| 方法区中的静态变量 | 类的 `static` 字段引用的对象 |
| 方法区中的常量 | `static final` 引用的对象 |
| JNI 引用 | Native 方法持有的对象引用 |
| 活跃线程 | 所有存活的 Thread 对象 |
| 同步锁持有的对象 | 被 `synchronized` 锁定的对象 |

### 3.2 安全点与 Stop-The-World

GC 在执行可达性分析时，需要确保对象引用关系不会发生变化，因此必须暂停所有应用线程——即 **Stop-The-World（STW）**。

但并非任何时刻都可以暂停线程。线程只有运行到**安全点（Safepoint）**时才能暂停。安全点通常设置在：

- 方法调用处
- 循环的回边（back edge）
- 异常抛出处

JVM 使用**主动式中断**：GC 需要 STW 时，设置一个全局标志，各线程在安全点检查该标志，发现需要暂停则主动挂起。

### 3.3 GC 算法

四种基础 GC 算法，各有适用场景：

**标记-清除（Mark-Sweep）**

```
标记阶段：从 GC Roots 遍历，标记所有存活对象
清除阶段：遍历堆，回收未标记的对象
```

- 优点：实现简单
- 缺点：产生内存碎片，分配大对象时可能找不到连续空间

**标记-整理（Mark-Compact）**

```
标记阶段：同标记-清除
整理阶段：将所有存活对象向内存一端移动，然后清理边界外的空间
```

- 优点：无内存碎片
- 缺点：移动对象开销大，STW 时间更长

**复制算法（Copying）**

```
将内存分为两块：对象空间和空闲空间
GC 时将存活对象从对象空间复制到空闲空间，然后清空整个对象空间
两块空间角色互换
```

- 优点：无碎片、分配高效（指针碰撞）
- 缺点：可用内存减半

**分代收集（Generational Collection）**

基于"大多数对象朝生夕灭"的统计假设，将堆划分为新生代和老年代，针对不同代的特征选择不同算法：

```
新生代（Young Generation）：Eden : S0 : S1 = 8 : 1 : 1
    → 对象存活率低，使用复制算法

老年代（Old Generation）：
    → 对象存活率高，使用标记-清除或标记-整理算法
```

**新生代 GC（Minor GC）流程**：

```
1. 新对象分配在 Eden 区
2. Eden 满触发 Minor GC
3. 存活对象复制到 S0（Survivor From）
4. 下一次 Minor GC，Eden + S0 的存活对象复制到 S1，清空 Eden + S0
5. S0 和 S1 角色交换
6. 对象每经历一次 Minor GC，年龄 +1
7. 年龄达到阈值（默认 15）的对象晋升老年代
```

**对象直接进入老年代的条件**：

- 大对象（超过 `-XX:PretenureSizeThreshold`）
- 长期存活对象（年龄超过阈值）
- Survivor 空间中相同年龄对象总大小超过 Survivor 一半（动态年龄判定）
- Minor GC 后 Survivor 放不下的存活对象

### 3.4 垃圾收集器

JVM 提供了多种垃圾收集器，分为新生代和老年代两组，可以组合使用：

| 收集器 | 分代 | 算法 | 线程 | 特点 |
|--------|------|------|------|------|
| **Serial** | 新生代 | 复制 | 单线程 | 简单高效，适合单核或小堆 |
| **ParNew** | 新生代 | 复制 | 多线程 | Serial 的多线程版本，能与 CMS 配合 |
| **Parallel Scavenge** | 新生代 | 复制 | 多线程 | 以吞吐量为目标，支持自适应调节 |
| **Serial Old** | 老年代 | 标记-整理 | 单线程 | Serial 的老年代版本 |
| **Parallel Old** | 老年代 | 标记-整理 | 多线程 | Parallel Scavenge 的老年代搭档 |
| **CMS** | 老年代 | 标记-清除 | 并发 | 以最短停顿为目标 |
| **G1** | 整堆 | 分区 + 复制/整理 | 并发 | 可预测停顿时间，JDK 9 默认 |

**CMS（Concurrent Mark Sweep）**

CMS 的设计目标是**最短回收停顿时间**。它采用标记-清除算法，GC 过程分为四个阶段：

| 阶段 | STW | 说明 |
|------|-----|------|
| 初始标记 | 是 | 仅标记 GC Roots 直接关联的对象，速度很快 |
| 并发标记 | 否 | 从初始标记的对象出发，遍历整个对象图 |
| 重新标记 | 是 | 修正并发标记期间因程序运行产生的引用变动 |
| 并发清除 | 否 | 清除不可达对象 |

CMS 的两次 STW 都很短暂，绝大部分工作与应用线程并发执行。

**CMS 的局限**：

- **CPU 敏感**：并发阶段占用 CPU 资源，核心数少时影响应用吞吐
- **浮动垃圾**：并发清除阶段新产生的垃圾只能等下次 GC
- **内存碎片**：标记-清除算法的固有问题

**G1（Garbage-First）**

G1 是 JDK 9 开始的默认收集器，它将堆划分为多个大小相等的 **Region**（默认 2048 个），每个 Region 可以动态充当 Eden、Survivor 或 Old 区。

```
┌────┬────┬────┬────┬────┬────┬────┬────┐
│  E │  E │  S │  O │  O │  H │  E │  O │
└────┴────┴────┴────┴────┴────┴────┴────┘
E = Eden    S = Survivor    O = Old    H = Humongous
```

G1 的核心优势：

| 特性 | 说明 |
|------|------|
| **可预测的停顿** | 通过 `-XX:MaxGCPauseMillis` 设定目标停顿时间，G1 优先回收收益最大的 Region |
| **无内存碎片** | Region 间使用复制算法，Region 内使用标记-整理 |
| **大对象处理** | 超过 Region 50% 的大对象分配在 Humongous Region |
| **混合回收** | Mixed GC 同时回收新生代和部分老年代 Region |

G1 的 GC 过程：

| 阶段 | STW | 说明 |
|------|-----|------|
| 初始标记 | 是 | 标记 GC Roots 直接关联对象（借助 Minor GC 完成） |
| 并发标记 | 否 | 遍历对象图，标记存活对象 |
| 最终标记 | 是 | 处理并发阶段遗留的 SATB（Snapshot-At-The-Beginning）记录 |
| 筛选回收 | 是 | 按回收收益排序 Region，将存活对象复制到空 Region |

### 3.5 收集器选型决策

| 场景 | 推荐收集器 | 关键参数 |
|------|-----------|----------|
| 单核 / 小堆（< 1GB） | Serial + Serial Old | `-XX:+UseSerialGC` |
| 多核 / 吞吐量优先 | Parallel Scavenge + Parallel Old | `-XX:+UseParallelGC`（JDK 8 默认） |
| 多核 / 延迟敏感 | ParNew + CMS | `-XX:+UseConcMarkSweepGC` |
| 大堆（> 4GB）/ 延迟可控 | G1 | `-XX:+UseG1GC`（JDK 9+ 默认） |
| 超大堆 / 超低延迟 | ZGC / Shenandoah | `-XX:+UseZGC`（JDK 11+） |

## 四、JVM 调优实践

### 4.1 关键调优参数

| 参数 | 说明 | 建议 |
|------|------|------|
| `-Xms` / `-Xmx` | 堆初始/最大大小 | 设为相同值，避免运行时动态扩容 |
| `-Xmn` | 新生代大小 | 通常为堆的 1/3 到 1/2 |
| `-XX:MetaspaceSize` | Metaspace 初始高水位线 | 根据类加载量设定，避免启动时频繁 Full GC |
| `-XX:MaxMetaspaceSize` | Metaspace 上限 | 建议设定上限，防止内存泄漏耗尽系统内存 |
| `-XX:SurvivorRatio` | Eden 与 Survivor 的比例 | 默认 8:1:1，一般无需调整 |
| `-XX:MaxTenuringThreshold` | 晋升老年代的年龄阈值 | 默认 15，最大 15（4 bit 限制） |
| `-XX:MaxGCPauseMillis` | G1 目标停顿时间 | 默认 200ms，根据业务 SLA 设定 |

### 4.2 常见问题与排查

| 问题 | 表现 | 排查方向 |
|------|------|----------|
| **频繁 Full GC** | 老年代频繁被填满 | 检查大对象分配、内存泄漏、Metaspace 增长 |
| **长时间 STW** | 应用周期性卡顿 | GC 日志分析、考虑切换为 G1/ZGC |
| **OOM: Java heap space** | 堆内存不足 | 堆转储分析（`jmap -dump`）、排查内存泄漏 |
| **OOM: Metaspace** | 类元数据空间耗尽 | 排查动态类生成（反射、CGLIB 代理）是否失控 |
| **OOM: GC overhead limit** | GC 耗时超过 98% 但回收不到 2% 内存 | 通常是内存泄漏的征兆 |

### 4.3 监控工具

| 工具 | 用途 |
|------|------|
| `jstat -gc` | 实时查看 GC 统计（各代容量、GC 次数和耗时） |
| `jmap -heap` | 查看堆内存使用概况 |
| `jmap -dump` | 导出堆转储文件（配合 MAT / VisualVM 分析） |
| `jstack` | 导出线程快照（排查死锁、线程阻塞） |
| `jcmd GC.class_stats` | 查看类元数据统计（替代 `jmap -permstat`） |
| GC 日志 | `-Xlog:gc*`（JDK 9+）/ `-XX:+PrintGCDetails`（JDK 8） |

## 总结

JVM 的三大核心机制——类加载、内存管理、垃圾回收——构成了 Java 程序运行的底层基石：

1. **类加载的双亲委派模型**保证了类的安全性和唯一性，但 SPI、热部署等场景需要理解如何合理打破它
2. **从 PermGen 到 Metaspace 的演进**反映了 JVM 设计从"固定分配"到"弹性管理"的思路转变
3. **GC 收集器的选型**没有最优解，只有最匹配的方案——吞吐量优先选 Parallel，延迟敏感选 CMS/G1/ZGC

> 理解 JVM 的意义不在于记住每个参数的默认值，而在于建立"代码行为 → JVM 行为 → 系统表现"的因果链，从而在生产问题出现时，能够从现象追溯到根因。
