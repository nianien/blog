---
title: "大数据去重算法：从 Bitmap 到 HyperLogLog"
pubDate: "2025-03-25"
description: "去重（COUNT DISTINCT）是大数据分析中最常见也最棘手的操作。本文系统拆解两类核心去重算法——精确去重的 Bitmap/Roaring Bitmap 和近似去重的 HyperLogLog，从原理、空间复杂度、工程实现到选型决策，给出完整的技术选型框架。"
tags: ["大数据", "去重算法", "Bitmap", "HyperLogLog", "OLAP"]
author: "skyfalling"
---

> 去重分析（COUNT DISTINCT）在企业日常分析中使用频率极高——UV 统计、独立设备数、活跃用户数——本质都是去重。如何在大数据场景下快速完成去重，一直是 OLAP 引擎的核心挑战之一。

---

## 一、为什么去重是大数据的痛点

先看一个典型场景：一张商品访问表有 `item` 和 `user_id` 两列，需要按商品求 UV（`SELECT item, COUNT(DISTINCT user_id) FROM visits GROUP BY item`）。

数据分布在多个节点上。如果是简单的 `COUNT`，每个节点各自统计再相加就行，shuffle 量极小。但 `COUNT DISTINCT` 不同——直接按 item 汇聚原始 user_id 会产生大量 shuffle，但不是唯一执行方式：也可以局部去重、按 (item, user_id) 分区后分阶段聚合，或交换可合并的集合摘要。当 user_id 达到亿级，这个 shuffle 就是性能杀手。

[![各节点先形成摘要，再按商品合并，Bitmap 返回精确基数，HLL 返回估计](/images/blog/bigdata-deduplication/mergeable-summaries.svg)](/images/blog/bigdata-deduplication/mergeable-summaries.svg)

**核心问题**：我们最终只需要一个"不重复元素个数"，能否用一种更紧凑的数据结构替代原始值的集合，在大幅减少 shuffle 数据量的同时，依然能正确（或近似正确）地计算基数？

两类算法给出了解答：

| 类型 | 代表算法 | 精确度 | 空间复杂度 | 适用场景 |
|---|---|---|---|---|
| **精确去重** | Bitmap / Roaring Bitmap | 映射无碰撞且一致时精确 | 取决于值域、密度与容器分布 | 精确集合运算与 UV |
| **近似去重** | HyperLogLog | 标准误差随寄存器数变化 | 固定精度与哈希位宽下有界 | 大盘 UV、趋势分析 |

下面分别拆解。

---

## 二、精确去重：Bitmap 与 Roaring Bitmap

### 2.1 Bitmap 的基本原理

Bitmap（位图）用一个 bit 数组来表示一个集合——每个元素对应数组中的一位，1 表示存在，0 表示不存在。集合 {2, 3, 5, 8} 对应的 Bitmap 是 `[0,0,1,1,0,1,0,0,1]`，数组中 1 的个数就是基数。

**核心优势**：一个 bit 表示值域中的一个位置。只有在值域密集等相应条件下，才能与逐个存储 32 位整数比较；稀疏值域不能直接宣称节省 32 倍。

**核心问题**：覆盖全部 32 位模式的定长 Bitmap 需要 2^32 位，即 512 MiB（不含对象开销）；仅覆盖 Java 非负 int 值域则需要 256 MiB。定长位图一旦按值域分配，稀疏集合也要承担这部分空间。对于冷门商品（只有几个访问），这个开销完全不可接受。

```java
// 教学实现，支持固定范围 [0, maxValue] 内的非负整数
public class SimpleBitmap {
    private final long[] words;  // 每个 long 存储 64 个 bit
    private final int maxValue;

    public SimpleBitmap(int maxValue) {
        if (maxValue < 0) throw new IllegalArgumentException("negative maxValue");
        this.maxValue = maxValue;
        this.words = new long[(maxValue >> 6) + 1];
    }

    public void add(int value) {
        checkRange(value);
        words[value >> 6] |= (1L << (value & 63));
    }

    public boolean contains(int value) {
        checkRange(value);
        return (words[value >> 6] & (1L << (value & 63))) != 0;
    }

    private void checkRange(int value) {
        if (value < 0 || value > maxValue) throw new IndexOutOfBoundsException();
    }

    public long cardinality() {
        long count = 0;
        for (long word : words) {
            count += Long.bitCount(word);
        }
        return count;
    }
}
```

### 2.2 Roaring Bitmap：精巧的自适应结构

Roaring Bitmap 是一种设计精巧的压缩 Bitmap，缓解了稀疏值域的空间浪费。它的核心思想是**分层 + 自适应容器**：

1. 将 32 位 Integer 拆分为**高 16 位**（作为 key）和**低 16 位**（存入 Container）
2. 根据基数与连续区间分布选择容器；具体转换时机取决于实现与调用方式

**三种 Container**：

[![32 位整数用高 16 位定位容器，低 16 位以数组、位图或游程保存](/images/blog/bigdata-deduplication/roaring-containers.svg)](/images/blog/bigdata-deduplication/roaring-containers.svg)

**Array Container**（稀疏数据）：
- 内部是有序的 short 数组，容量管理依实现而异，常见切换阈值为 4096
- 超过 4096 个元素时自动转换为 Bitmap Container
- N 个 16 位元素的数据区为 2N Bytes，另计容量余量与元数据

**Bitmap Container**（密集数据）：
- 固定 1024 个 long 值，数据区占用 8 KiB
- 无论存 1 个还是 65536 个元素，空间恒定
- 当元素恰好为 4096 时，两者的数据区均为 8 KiB；超过后 Bitmap 数据区更小

**Run Container**（连续数据）：
- 使用游程编码（RLE）压缩连续值
- {11, 12, 13, 14, 15, 21, 22} 编码为 (11,4), (21,1)
- 一个连续区间的起点与长度数据可用 4 Bytes 表示，另计容器头与元数据
- 在 16 位值域内最多有 32768 个互不相邻的游程，游程数据区最多为 128 KiB；这种分布通常更适合其他容器

**三种 Container 的空间占用对比**：

| 元素个数 | Array Container | Bitmap Container | Run Container |
|---|---|---|---|
| 100 | 200 B | 8 KiB | 取决于连续性 |
| 4,096 | 8 KiB | 8 KiB | 取决于连续性 |
| 10,000 | 20,000 B（理论数组数据区） | 8 KiB | 取决于连续性 |
| 65,536 | 128 KiB（理论数组数据区） | 8 KiB | 4 B（整个值域为一个游程） |

4096 是 Array 与 Bitmap 数据区的空间交叉点。Run 是否更小取决于区间数；容器选择和优化时机依实现与操作而异，例如部分 Java 用法需要调用 runOptimize()。[RoaringBitmap 项目说明](https://github.com/RoaringBitmap/RoaringBitmap)。

> **工程建议**：先测量分布、构建与集合运算成本，再选择批量插入、预分配或适用的优化接口。不应未经兼容性和空间测试直接修改库的容器阈值。

### 2.3 非数值类型的处理：全局字典

Bitmap 要求元素是数值类型，但实际业务中去重列经常是字符串（如 device_id、session_id）。解决方案是构建**全局字典**——将字符串映射为整数 ID，再放入 Bitmap。

全局字典在高基数列（数亿级不重复值）时会成为性能瓶颈。常见的优化策略：

| 优化策略 | 原理 | 适用场景 |
|---|---|---|
| **字典复用** | 当一个列的值完全被另一列包含时，复用已有字典 | 维度表的外键列 |
| **Segment 字典替代** | 当分析不跨时间分片时，用分片内字典替代全局字典 | 单日/单分片查询 |
| **多列族存储** | 将多个精确去重指标放到不同列族，减少读放大 | 多个 COUNT DISTINCT 指标并存 |

---

## 三、近似去重：HyperLogLog

### 3.1 为什么需要近似去重

Bitmap 的精确性依赖无碰撞映射。普通位图按值域分配，压缩位图的空间还受基数与分布影响。当基数达到数十亿时，即使是 Roaring Bitmap，单个实例也可能占用数十 MB。如果有上万个分组（比如按商品求 UV），总内存开销不可忽视。

HyperLogLog（HLL）提供了另一种思路：**通过固定精度的寄存器摘要估计基数，在内存与统计误差之间取舍。** 精度参数决定寄存器数量，不能把某一配置的典型误差当成统一保证。

HLL 的三个核心特性：
- 完整遍历所有元素一次（不采样、不多轮）
- 只能计算基数，不能判断某个元素是否存在
- 多个 HLL 实例可以合并（支持分布式聚合）

### 3.2 直觉理解：抛硬币实验

想象你在做一个实验：不停抛硬币，记录连续抛到正面的最长次数。如果最长记录是 3 次，你大概没做太多次实验；如果最长记录是 20 次，你可能做了上百万次。

这就是 HLL 的核心思想——**通过观察到的极端值来估算总量**。当然，一个人可能运气极好第一次就连抛 20 次正面，所以需要多人同时实验（分桶），用调和平均来降低方差。

### 3.3 算法实现

[![哈希低位分桶，剩余位计算 rank，寄存器取最大值后聚合为基数估计](/images/blog/bigdata-deduplication/hll-registers.svg)](/images/blog/bigdata-deduplication/hll-registers.svg)

HLL 的完整流程：

1. **Hash**：对每个元素求 Hash 值，得到一串二进制位
2. **分桶**：取 Hash 值的后 k 位确定桶号（精度参数，如 HLL(10) 有 2^10=1024 个桶）
3. **记录**：在剩余位中找到第一个 1 出现的位置，更新到对应桶中（取最大值）
4. **估算**：聚合各寄存器对应的 2^r 值，计算原始估计，再按基数范围做修正

```python
# 教学实现：64 位哈希、每寄存器一字节，省略大基数修正
import hashlib
import math

class HyperLogLog:
    def __init__(self, precision=14):
        if not isinstance(precision, int) or not 4 <= precision <= 18:
            raise ValueError("precision must be an integer in [4, 18]")
        self.p = precision
        self.m = 1 << precision
        self.registers = bytearray(self.m)
        constants = {16: 0.673, 32: 0.697, 64: 0.709}
        self.alpha = constants.get(self.m, 0.7213 / (1 + 1.079 / self.m))

    def add(self, value):
        if not isinstance(value, bytes):
            raise TypeError("encode values to canonical bytes before adding")
        h = int.from_bytes(hashlib.sha256(value).digest()[:8], "big")
        bucket = h & (self.m - 1)
        remaining = h >> self.p
        # 从低位起数第一个 1；全零时取剩余位宽加一
        rank = (remaining & -remaining).bit_length() if remaining else 65 - self.p
        self.registers[bucket] = max(self.registers[bucket], rank)

    def cardinality(self):
        denominator = sum(2.0 ** (-r) for r in self.registers)
        estimate = self.alpha * self.m * self.m / denominator
        empty = self.registers.count(0)
        if estimate <= 2.5 * self.m and empty:
            estimate = self.m * math.log(self.m / empty)
        return round(estimate)

    def merge(self, other):
        if not isinstance(other, HyperLogLog) or self.p != other.p:
            raise ValueError("matching precision and hash encoding required")
        for i in range(self.m):
            self.registers[i] = max(self.registers[i], other.registers[i])
```

原始估计器使用寄存器对应的 2^r 值的调和聚合及偏差系数，而不是对寄存器 r 直接取调和平均。小基数时还需要相应修正；上面的实现以 Linear Counting 处理这一阶段。

### 3.4 空间与精度

**寄存器空间**取决于哈希位宽与精度。对于 64 位哈希，取 p 位作桶编号后，剩余 64-p 位，rank 最大为 65-p。表中 p 至少为 10，六个 bit 足以表示相应范围；六位本身只能表示 0–63，不能表示 64。

下表是六位打包的稠密寄存器数据区估算，标准误差约为 1.04/√m，不是每次结果的误差上限。

| 精度 | 桶数 | 空间占用 | 标准误差 |
|---|---|---|---|
| HLL(10) | 1,024 | ~768 B | ~3.25% |
| HLL(12) | 4,096 | ~3 KB | ~1.63% |
| HLL(14) | 16,384 | ~12 KB | ~0.81% |
| HLL(16) | 65,536 | ~48 KB | ~0.41% |

**关键特性**：空间占用与基数 N 无关，只与精度参数 p 相关。当使用六位打包寄存器时，HLL(14) 的稠密寄存器数据区约为 12 KiB，另计元数据。上面的 Python bytearray 实现使用每寄存器一字节，数据区为 16 KiB，不能套用 12 KiB。

> **注意**：未经修正的原始估计器在基数相对桶数较小时偏差明显。如果基数可能很低，建议使用精确去重或在 HLL 基础上做小基数修正（Linear Counting）。

---

## 四、Bitmap vs HyperLogLog：选型框架

### 4.1 核心对比

| 维度 | Bitmap（Roaring） | HyperLogLog |
|---|---|---|
| **精确度** | ID 映射无碰撞且一致时精确 | 标准误差约为 1.04/√m，非单次上限 |
| **空间** | 依值域、基数与分布变化 | 固定精度与哈希位宽下有界 |
| **构建与查询** | 依容器、插入方式及是否缓存计数而异 | 固定精度下逐项更新；估计一般遍历 m 个寄存器 |
| **可合并性** | 支持（OR 操作） | 支持（取 max 操作） |
| **反向查询** | 支持（判断某元素是否存在） | 不支持 |
| **非数值类型** | 需要全局字典映射 | Hash 后直接使用 |
| **选型依据** | 精确集合操作、ID 映射与实际分布 | 允许统计误差，分组数与精度满足预算 |

### 4.2 把选型条件问清楚

| 如果你的场景是... | 优先比较 | 判断依据 |
|---|---|---|
| 必须返回精确基数或支持成员查询 | Bitmap、HashSet、排序去重 | 核对 ID 映射、值域密度与集合操作成本 |
| 只关心大盘 UV 或趋势，允许统计误差 | HLL | 用精度参数和误差分布匹配业务容忍度 |
| 分组多且内存预算有限 | 不同精度的 HLL 与压缩位图 | 计算每组空间及总分组数，不能只看单个实例 |
| 需要跨分片聚合 | Roaring Bitmap 或 HLL | 两者都可合并；核对映射、哈希和格式兼容性 |
| 低基数但要求很小误差 | 精确集合或带小基数修正的估计器 | 测量当前分布，避免套用大基数结论 |

### 4.3 与其他去重/概率算法的关系

| 算法 | 用途 | 和去重的关系 |
|---|---|---|
| **Bloom Filter** | 判断元素"可能存在"或"一定不存在" | 不计算基数，只做成员判断 |
| **Count-Min Sketch** | 估算每个元素的出现频率 | 不去重，计频次 |
| **Linear Counting** | 低基数场景的基数估算 | HLL 的低基数修正方案 |
| **Theta Sketch** | 支持交、并、差等集合运算的估计 | 与 HLL 采用不同方法和空间精度权衡，不能简单称为其超集 |

---

## 五、工程实践

### 5.1 在 OLAP 引擎中的应用

以 Apache Kylin 为例，精确与近似 COUNT DISTINCT 可以采用不同的度量类型。选型需要同时考虑存储表示、字典构建和查询时的聚合方式，具体配置入口以使用版本的文档为准。

其他主流引擎的支持情况：

| 引擎 | 精确去重 | 近似去重 |
|---|---|---|
| **Apache Kylin** | Roaring Bitmap | HyperLogLog |
| **ClickHouse** | `uniqExact` | `uniq`（自适应采样）、`uniqHLL12`、`uniqCombined` |
| **Apache Doris** | Bitmap 类型 | HLL 类型 |
| **Elasticsearch** | 可遍历唯一值等方式计算，需处理分页和一致性 | `cardinality`（HLL++） |
| **Redis** | Set / SCARD，或映射到 Bitmap 后 BITCOUNT | `PFADD` / `PFCOUNT`（HLL） |

ClickHouse 的 `uniq` 使用自适应采样，不能将所有近似去重函数统称为 HLL。[官方 uniq 文档](https://clickhouse.com/docs/sql-reference/aggregate-functions/reference/uniq)。

### 5.2 Redis HyperLogLog 实战

Redis 内置了 HLL 支持，使用极其简单：

下面在 redis-cli 中执行，日期只作键名示例，返回值为示意而非本次实测。

```text
# 添加元素
PFADD page_uv:2026-04-07 user_001 user_002 user_003
PFADD page_uv:2026-04-07 user_001 user_004  # user_001 重复，不影响

# 查询基数
PFCOUNT page_uv:2026-04-07
# → (integer) 4

# 合并多天的 UV（去重后的 UV 总数）
PFMERGE page_uv:week page_uv:2026-04-06 page_uv:2026-04-07
PFCOUNT page_uv:week
```

Redis HLL 的稠密寄存器约占 12 KiB，低基数可以使用更紧凑的稀疏表示；还需计入对象与键开销。标准误差约 0.81%，不是绝对误差保证。[Redis 官方文档](https://redis.io/docs/latest/develop/data-types/probabilistic/hyperloglogs/)。

### 5.3 怎样建立可比较的基准

没有一致环境的测试，不能给出一亿 UUID 的统一内存与耗时表。尤其是 Roaring Bitmap 配合全局字典时，字符串和映射本身的成本不能省略。

基准应固定输入分布、重复率、分组数和硬件，分别记录构建、合并、基数查询、序列化与峰值内存。HLL 的测试还需要多个独立样本，报告误差分布；一次结果接近真值不能证明误差有硬上限。

查询复杂度也要按实现区分：缓存了计数的集合可以快速返回，未缓存的 HLL 估计需要遍历寄存器，不能一律写成 O(1)。

---

## 总结

回到最初的场景——按商品求 UV。使用 Bitmap 或 HLL 后，每个 item 对应的不再是原始 user_id 集合，而是一个 Bitmap 实例或 HLL 实例。Shuffle 的数据量从"所有 user_id 的原始值"降低到"一个压缩后的数据结构"，收益取决于分组数、原始数据规模与摘要大小，需要结合实际查询计划测量。

**选型原则很简单**：

1. **必须精确** → 比较 Bitmap、HashSet 与排序去重，并计入无碰撞 ID 映射成本
2. **允许近似 + 基数大** → HyperLogLog
3. **条件不清楚** → 先明确精度要求、ID 映射、分组数量与预算，再用代表性数据验证

两者不是替代关系，而是互补关系。在同一个系统中，财务报表用 Bitmap 保精确，运营大盘用 HLL 省资源——是否这样组合，应由业务精度与资源预算决定。
