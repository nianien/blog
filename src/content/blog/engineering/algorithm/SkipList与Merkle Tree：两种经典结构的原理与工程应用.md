---
title: "SkipList与Merkle Tree：两种经典结构的原理与工程应用"
pubDate: "2023-06-15"
description: "深入分析跳表与Merkle树的数据结构原理、算法实现及其在Redis、LevelDB、区块链、分布式系统中的工程应用"
tags: ["数据结构", "SkipList", "Merkle Tree", "分布式系统"]
---

> 数据结构的价值不在于理论本身的优美，而在于它如何被工程系统所采纳并解决真实问题。SkipList 和 Merkle Tree 是两种看似无关、实则共享"层次化组织"思想的经典结构：前者以随机化索引实现高效有序检索，后者以递归哈希实现数据完整性验证。它们分别活跃在 Redis、LevelDB、Bitcoin、IPFS 等系统的核心路径上。本文将从原理出发，逐层剖析两者的结构设计、算法实现与工程应用。

---

## SkipList：随机化索引的有序结构

### 设计动机：为什么不用平衡树

在有序数据的检索场景中，平衡二叉搜索树（AVL Tree、Red-Black Tree）是经典解法，能够在 O(log n) 时间内完成查找、插入和删除。然而，平衡树在工程实践中存在几个显著问题：

| 维度 | 平衡树 | 跳表 |
|------|--------|------|
| **实现复杂度** | 旋转操作逻辑复杂，AVL 需维护平衡因子，红黑树需维护颜色约束 | 核心逻辑仅为链表操作加随机数生成 |
| **并发友好性** | 旋转和重平衡需要协调，具体锁粒度取决于实现 | 插入和删除只影响局部节点，天然适合细粒度锁 |
| **范围查询** | 需要中序遍历，实现不够直观 | 底层即为有序链表，天然支持顺序扫描 |
| **内存局部性** | 树节点分散在堆中，缓存命中率低 | 是否连续分配取决于内存管理，并不天然优于树 |

1990 年，William Pugh 在论文 *Skip Lists: A Probabilistic Alternative to Balanced Trees* 中提出了跳表结构。其核心洞察是：**用随机化代替严格的平衡维护，以概率性的方式达到与平衡树相当的期望性能，同时简化部分平衡维护逻辑。**

Redis 的作者 Antirez 曾明确表示选择跳表的理由：实现简单、范围操作性能优异、且易于调试。这一工程判断使得跳表成为 Redis Sorted Set 的底层数据结构之一。

### 数据结构与核心原理

跳表的本质思想是：**在有序链表之上构建多层稀疏索引，以空间换时间，将链表的 O(n) 查找降至期望 O(log n)。**

其结构可以抽象为一个多层有序链表的叠加：

[![三层跳表的上层节点逐层稀疏，底层保留全部有序元素](/images/blog/skiplist-merkle/skiplist-levels.svg)](/images/blog/skiplist-merkle/skiplist-levels.svg)

结构性质如下：

- **底层（Level 0）** 是一个包含所有元素的完整有序链表
- **每一层**都是下一层的"索引子集"，元素按升序排列
- **最高层**通常只包含极少量节点，作为搜索的起始入口
- 每个节点包含一个值和一个指针数组，数组长度等于该节点所在的层数

以下 Java 片段展示单线程有序多重集的核心操作，允许重复元素。外层类应声明为 `SkipList<T extends Comparable<? super T>>`，持有 `MAX_LEVEL`、当前最高层 `maxLevel`（初值 0）以及分配了 `MAX_LEVEL + 1` 个指针槽的 head；这些片段不是完整类文件。最大层数需与预期容量匹配。

节点的数据结构定义如下：

```java
class SkipListNode<T> {
    T value;
    SkipListNode<T>[] forward; // forward[i] 指向第 i 层的下一个节点

    SkipListNode(T value, int level) {
        this.value = value;
        this.forward = new SkipListNode[level + 1];
    }
}
```

### 搜索算法：从顶层到底层的路径收敛

搜索过程遵循"先右后下"的策略：

1. 从最高层的头节点开始
2. 在当前层向右移动，直到下一个节点的值大于等于目标值
3. 如果下一个节点的值等于目标值，搜索成功
4. 否则，下降一层，重复步骤 2
5. 如果降到最底层仍未找到，搜索失败

```java
public SkipListNode<T> search(T target) {
    SkipListNode<T> current = head;
    for (int i = maxLevel; i >= 0; i--) {
        while (current.forward[i] != null
               && current.forward[i].value.compareTo(target) < 0) {
            current = current.forward[i];
        }
    }
    current = current.forward[0];
    if (current != null && current.value.compareTo(target) == 0) {
        return current;
    }
    return null;
}
```

高层用较稀疏的索引跳过大段元素，下降后在更密的索引中继续前进。它不是每下降一层都将确定区间减半，复杂度来自随机层高的期望分析。

### 插入算法：随机化层数决策

插入操作的关键在于**如何决定新节点的层数**。跳表采用几何分布的随机化策略：

```java
private int randomLevel() {
    int level = 0;
    // p = 0.5，相当于"抛硬币"
    while (Math.random() < 0.5 && level < MAX_LEVEL) {
        level++;
    }
    return level;
}
```

这一设计的数学性质：

| 性质 | 值 |
|------|-----|
| 节点出现在第 k 层的概率 | (1/2)^k |
| 每节点指针槽数的期望值 | 无高度上限时为 2；有上限时略小于 2 |
| 期望总指针槽数 | 无高度上限时为 2n；不表示有 2n 份数据节点 |

**为什么选择随机化而非确定性策略？** 简单地固定间隔建立索引，在动态更新时可能需要较多调整；也存在通过局部维护实现良好复杂度的确定性跳表，不能把所有确定性方案都归为全局重建。随机化策略的精妙之处在于：它不需要任何全局信息，仅通过局部的随机决策，就能在期望意义上维持索引的均匀分布。

插入的完整流程：

1. 从最高层开始搜索，记录每层中最后一个小于目标值的节点（即 update 数组）
2. 调用 `randomLevel()` 生成新节点的层数 k
3. 如果 k 大于当前最大层数，扩展 update 数组，将新增层的前驱设为 head
4. 创建新节点，在 0 到 k 层逐层插入（修改前驱指针）

```java
public void insert(T value) {
    SkipListNode<T>[] update = new SkipListNode[MAX_LEVEL + 1];
    SkipListNode<T> current = head;

    // 搜索并记录每层的前驱节点
    for (int i = maxLevel; i >= 0; i--) {
        while (current.forward[i] != null
               && current.forward[i].value.compareTo(value) < 0) {
            current = current.forward[i];
        }
        update[i] = current;
    }

    int newLevel = randomLevel();
    if (newLevel > maxLevel) {
        for (int i = maxLevel + 1; i <= newLevel; i++) {
            update[i] = head;
        }
        maxLevel = newLevel;
    }

    SkipListNode<T> newNode = new SkipListNode<>(value, newLevel);
    for (int i = 0; i <= newLevel; i++) {
        newNode.forward[i] = update[i].forward[i];
        update[i].forward[i] = newNode;
    }
}
```

### 删除算法

删除操作的逻辑与插入类似：

1. 搜索过程中记录每层的前驱节点
2. 找到目标节点后，在每一层中移除该节点（修改前驱指针跳过它）
3. 如果删除后最高层为空，降低 maxLevel

```java
public void delete(T value) {
    SkipListNode<T>[] update = new SkipListNode[MAX_LEVEL + 1];
    SkipListNode<T> current = head;

    for (int i = maxLevel; i >= 0; i--) {
        while (current.forward[i] != null
               && current.forward[i].value.compareTo(value) < 0) {
            current = current.forward[i];
        }
        update[i] = current;
    }

    current = current.forward[0];
    if (current != null && current.value.compareTo(value) == 0) {
        for (int i = 0; i <= maxLevel; i++) {
            if (update[i].forward[i] != current) break;
            update[i].forward[i] = current.forward[i];
        }
        while (maxLevel > 0 && head.forward[maxLevel] == null) {
            maxLevel--;
        }
    }
}
```

### 复杂度分析

| 操作 | 时间复杂度（期望） | 时间复杂度（最坏） |
|------|-------------------|-------------------|
| 搜索 | O(log n) | O(n) |
| 插入 | O(log n) | O(n) |
| 删除 | O(log n) | O(n) |

**空间复杂度**为 O(n)。在 p = 1/2 的常见表示中，每个数据节点带一个变长指针数组，指针槽总数的期望小于等于 2n。

所有节点均没有晋升的概率为 (1/2)^n（独立晋升、p = 1/2），但这不是所有不利布局概率的总和。随机化提供期望表现，不提供每次查询的严格最坏延迟保证。

### 工程应用

**Redis Sorted Set（ZSet）**

Redis 有序集合可采用紧凑编码；超出相应数量或元素长度阈值后，常见实现使用字典与跳表共同维护成员及有序访问。具体阈值和编码名称需按版本核对。选择跳表而非平衡树的原因包括：

- **范围查询高效**：`ZRANGEBYSCORE`、`ZRANGEBYLEX` 等命令需要按区间遍历，跳表的底层链表天然支持顺序扫描，时间复杂度为 O(log n + m)，其中 m 为返回元素数
- **实现简洁**：Redis 是单线程模型，并发优势非核心考量，但代码简洁性直接影响可维护性
- **内存效率**：Redis 的跳表实现（`zskiplist`）将 p 值设为 0.25 而非 0.5，使得平均每个节点只有 1.33 层索引，进一步降低内存开销

Redis 跳表的额外优化包括：每个节点增加了 backward 指针支持反向遍历、节点中存储 span 字段用于快速计算排名。

**LevelDB / RocksDB MemTable**

LevelDB 的内存写入缓冲区（MemTable）使用跳表作为核心数据结构。在 LSM-Tree 架构中，所有写入操作首先进入 MemTable，积累到一定大小后刷入磁盘形成 SSTable。跳表在此场景下的优势：

- **写入性能**：O(log n) 的插入复杂度，且不涉及旋转等全局调整操作
- **读写协调**：LevelDB 跳表要求外部串行化写入，并允许在满足生命周期约束时并发读取；不能把这一要求直接推广到 RocksDB 的所有 MemTable 实现。[LevelDB 源码](https://github.com/google/leveldb/blob/main/db/skiplist.h)
- **有序迭代**：MemTable 刷盘时需要按序输出所有键值对，跳表底层链表的顺序性正好满足

**Java ConcurrentSkipListMap**

Java 标准库中的 `ConcurrentSkipListMap` 是基于跳表实现的并发有序映射，与 `TreeMap`（基于红黑树）形成对照：

| 特性 | ConcurrentSkipListMap | ConcurrentHashMap |
|------|----------------------|-------------------|
| 有序性 | 有序 | 无序 |
| 并发策略 | 使用 CAS 等机制实现并发更新 | 依 JDK 版本使用 CAS 与局部同步等机制 |
| 范围操作 | O(log n + m) | 不支持 |
| 适用场景 | 需要有序性的并发映射 | 高并发键值查找 |

跳表的结构特性使其天然适合 CAS 操作：插入和删除只需修改少量指针，无需像红黑树那样进行涉及多个节点的旋转。

---

## Merkle Tree：递归哈希的信任结构

### 从 Hash 到 Merkle Tree 的演进

理解 Merkle Tree，需要先理解它所解决的问题链。

**单一 Hash 的能力与局限。** 对一份数据计算哈希值（如 SHA-256），可以快速验证数据是否被篡改。但仅凭整体哈希，无法定位哪个数据块发生变化；需要其他信息才能有选择地重传，而不是必然重传整个文件。

**Hash List 的改进。** 将大文件分成若干数据块，对每个数据块分别计算哈希值，得到一个哈希列表。验证时逐块比对哈希值，即可定位损坏的数据块。但 Hash List 本身的完整性如何保证？可以用可信渠道提供的摘要或数字签名认证整个列表。哈希本身不是签名；若验证者只持有列表整体摘要，首次认证列表通常需要完整列表，已缓存可信列表后则不必为每块重复传输。

**Merkle Tree 的泛化。** 1979 年，Ralph Merkle 提出了以他名字命名的 Merkle Tree。本文使用二叉树形式解释：叶节点存储数据块的哈希值，非叶节点存储其子节点哈希值拼接后的哈希值，根节点的哈希值（Merkle Root）即为整棵树的"指纹"。

```
                    Root Hash
                   /         \
              Hash(0-1)     Hash(2-3)
              /      \       /      \
          Hash(0)  Hash(1) Hash(2)  Hash(3)
            |        |       |        |
          Data0    Data1   Data2    Data3
```

这一结构带来了关键性质：**在根哈希可信、树的布局与哈希规则已约定的前提下，验证单块包含关系只需 O(log N) 个兄弟哈希。** 证明还需要左右位置等信息；如果根和数据一起由攻击者任意提供，匹配并不能证明来源可信。

### 核心操作

**构建：O(n)**

Merkle Tree 的构建过程是自底向上的：

1. 将原始数据分割为等大的数据块 D0, D1, ..., Dn-1
2. 对每个数据块计算叶哈希：Hi = Hash(0x00 || Di)，得到叶节点层
3. 相邻叶节点两两配对，拼接后计算哈希值：H(i,i+1) = Hash(0x01 || Hi || Hi+1)
4. 本文示例在某层节点数为奇数时复制末节点；其他协议可能补齐或采用不同树形，必须遵循各自规则
5. 递归上述过程，直到仅剩一个节点，即为 Merkle Root

固定块大小时，构建的哈希次数为 O(n)；若块大小变化，还需计入总输入字节数。以下示例用不同前缀区分叶与内部节点，空输入明确拒绝。复制末节点会产生树形歧义，因此认证时必须同时绑定叶数量与位置；不要把此教学函数直接当作完整安全协议。

```python
from hashlib import sha256


def build_merkle_tree(data_blocks):
    if not data_blocks:
        raise ValueError("data_blocks must not be empty")
    # 叶节点层
    nodes = [sha256(b'\x00' + block).digest() for block in data_blocks]
    tree = [nodes[:]]

    while len(nodes) > 1:
        if len(nodes) % 2 == 1:
            nodes.append(nodes[-1])  # 奇数时复制最后一个
        next_level = []
        for i in range(0, len(nodes), 2):
            parent = sha256(b'\x01' + nodes[i] + nodes[i + 1]).digest()
            next_level.append(parent)
        tree.append(next_level)
        nodes = next_level

    return tree  # tree[-1][0] 即为 Merkle Root
```

**验证（Merkle Proof）：O(log N)**

Merkle Proof 是 Merkle Tree 最核心的应用机制。假设要验证 Data2 是否包含在某个已知 Merkle Root 的数据集中，验证者无需获取全部数据，只需获得一条从该叶节点到根的"认证路径"（Authentication Path）：

```
验证 Data2：
需要的哈希值：Hash(3), Hash(0-1)

验证过程：
1. 计算 Hash(2) = Hash(0x00 || Data2)
2. 计算 Hash(2-3) = Hash(0x01 || Hash(2) || Hash(3))   ← Hash(3) 由证明者提供
3. 计算 Root' = Hash(0x01 || Hash(0-1) || Hash(2-3))    ← Hash(0-1) 由证明者提供
4. 比较 Root' 与已知的 Merkle Root 是否一致
```

对于包含 N 个数据块的 Merkle Tree，对于本文平衡二叉结构，认证路径最多约为 ceil(log2(N))，验证时间复杂度为 O(log N)。

**更新**

当某个数据块发生变更时，只需沿着该叶节点到根的路径重新计算哈希值，路径长度为 O(log N)，无需重建整棵树。

**一致性检测**

比较两棵 Merkle Tree 的差异时，从根节点开始：

1. 如果根哈希一致，在相同编码、树形及抗碰撞假设下，可认为对应数据一致
2. 如果根哈希不同，递归比较左右子树
3. 当某个子树的哈希一致时，剪枝（跳过该子树）
4. 最终定位到所有不一致的叶节点

最好情况下（完全一致）只需一次比较；最坏情况下（完全不同）需要遍历所有节点；若只有 k 个差异叶且布局一致，可沿其祖先路径定位，访问量上界可按 O(k log N) 估计；不能将任意“少量差异”都直接写成 O(log N)。

### 工程应用

**分布式数据一致性校验：Cassandra Anti-Entropy Repair**

在 Cassandra 等分布式数据库中，数据以多副本存储在不同节点上。由于网络分区、节点宕机等原因，副本之间可能出现不一致。Cassandra 使用 Merkle Tree 进行 Anti-Entropy Repair：

1. 每个节点为自己存储的数据构建 Merkle Tree
2. 需要同步时，两个节点交换 Merkle Root
3. 如果 Root 不同，逐层交换子树哈希值，定位不一致的数据范围
4. 仅同步不一致的数据分区

这种机制可以跳过一致范围，但开销取决于树的分区粒度与差异分布，不能保证只交换固定数量的哈希就定位所有键。

**P2P 文件传输：BitTorrent**

BitTorrent 协议中，大文件被分割为若干固定大小的数据块（通常 256KB）。种子文件（.torrent）中包含每个数据块的哈希值。当下载者从多个 Peer 获取数据块时，通过校验哈希值确保数据块的完整性。

BEP 30（Merkle Hash Torrent）草案提出了相应扩展：种子文件中只包含 Merkle Root，数据块的哈希值在下载过程中按需获取。这将哈希列表部分缩小为固定大小的根摘要；文件名、路径等其他元数据并不因此全部成为 O(1)。[BEP 30 原文](https://www.bittorrent.org/beps/bep_0030.html)。

**区块链：Bitcoin SPV 与 Ethereum MPT**

Merkle Tree 在区块链中的应用是其最广为人知的工程实践。

**Bitcoin 的交易存储与 SPV 验证。** 在 Bitcoin 中，每个区块的所有交易以 Merkle Tree 组织，Merkle Root 存储在区块头中。区块头固定为 80 字节，包含：

| 字段 | 大小 | 说明 |
|------|------|------|
| Version | 4 bytes | 区块版本号 |
| Previous Block Hash | 32 bytes | 前一区块头的哈希 |
| Merkle Root | 32 bytes | 交易 Merkle 树的根哈希 |
| Timestamp | 4 bytes | 出块时间戳 |
| Difficulty Target | 4 bytes | 挖矿难度目标 |
| Nonce | 4 bytes | 随机数 |

SPV（Simplified Payment Verification，简化支付验证）利用 Merkle Proof 使轻客户端无需下载完整区块链即可验证交易：

1. 轻客户端维护区块头链，每个头为 80 字节，总量随区块数增长
2. 验证某笔交易时，向全节点请求该交易的 Merkle Proof
3. 利用认证路径和区块头中的 Merkle Root 验证交易是否确实包含在该区块中

对于包含 4000 笔交易的区块，兄弟哈希部分约需 12 × 32 = 384 字节，另计交易、位置等信息。包含证明不能代替全节点对交易和区块规则的完整验证，还需要对头链及相应安全假设进行判断。

**Ethereum 的三棵 Merkle 树。** Ethereum 在 Bitcoin 的基础上进一步扩展，每个区块头中包含三棵独立的 Merkle 树的根哈希：

| 树 | 存储内容 | 用途 |
|----|---------|------|
| **Transaction Trie** | 区块中的所有交易 | 验证交易存在性 |
| **Receipt Trie** | 每笔交易的执行结果（日志、Gas 消耗等） | 验证合约事件和执行结果 |
| **State Trie** | 全局账户状态（余额、合约代码、存储等） | 验证任意账户在某个区块高度的状态 |

Ethereum 的 State Trie 采用了 MPT（Merkle Patricia Trie）结构，这是 Merkle Tree 与 Patricia Trie（前缀压缩字典树）的结合：

- **Patricia Trie** 提供键值映射能力，支持按地址查找账户状态
- **Merkle 化** 使子节点通过哈希或按编码长度内联的形式引用，支持状态证明
- **16 叉树** 结构（而非二叉树），分支节点有 16 个子槽（对应十六进制的 0-f）和一个 value 槽；扩展节点并非 16 叉

MPT 的节点类型包括：

| 节点类型 | 说明 |
|---------|------|
| **空节点** | 空值 |
| **叶节点（Leaf）** | 存储剩余键路径和值 |
| **扩展节点（Extension）** | 存储共享前缀和子节点哈希 |
| **分支节点（Branch）** | 16 个子节点槽位 + 1 个值槽位 |

这种设计使得 Ethereum 支持"状态证明"——验证者在可信状态根下可以验证账户证明。合约存储通常还需要从账户记录中的 storageRoot 继续验证存储证明，代码则通过 codeHash 关联，并非直接存放于账户叶中。[Ethereum MPT 文档](https://ethereum.org/en/developers/docs/data-structures-and-encoding/patricia-merkle-trie/)。

**版本控制系统：Git 对象存储**

Git 的对象模型本质上是一个 Merkle DAG（有向无环图）。每次 commit 都包含一个 tree 对象的哈希，tree 对象递归引用子 tree 和 blob（文件内容）的哈希。这意味着：

- 将文件修改写入新提交时，受影响的 blob、祖先 tree 与新 commit 标识会变化；既有对象保持不变
- 两个 commit 如果引用了相同的 tree hash，则对应的目录结构和文件内容完全一致
- `git diff` 的快速比较正是基于此：从根 tree 开始，哈希一致的子树可以直接跳过

**IPFS：Merkle DAG 的内容寻址**

IPFS（InterPlanetary File System）将 Merkle Tree 泛化为 Merkle DAG，每个节点可以有多个父节点。文件被分块后组织为 Merkle DAG，根节点的 CID（Content Identifier）包含多重哈希及版本、编解码等相关信息。这种设计实现了：

- **内容寻址**：在相同分块、编码、哈希算法与 CID 设置下，相同数据可得到相同标识；仅文件字节相同不保证所有导入方式产生相同 CID
- **增量传输**：两个版本的文件只需传输差异块
- **完整性验证**：下载过程中验证数据是否匹配预期 CID；预期 CID 的来源仍需可信。[IPFS CID 文档](https://docs.ipfs.tech/concepts/content-addressing/)

**数字签名：Merkle Signature Scheme**

Merkle Tree 最早的应用之一是构建一次性签名方案的扩展。Lamport 一次性签名方案（OTS）每个密钥只能签名一次。Merkle Signature Scheme 通过 Merkle Tree 将多个 OTS 公钥组织在一起：

1. 生成 N 个 OTS 密钥对
2. 将 N 个公钥作为叶节点构建 Merkle Tree
3. 发布 Merkle Root 作为公钥
4. 每次签名使用一个 OTS 密钥，附带对应的 Merkle Proof

这种方案在后量子密码学中受到重视，因为其安全性建立在相应哈希与一次性签名假设上，而不是大数分解或离散对数。XMSS 与 LMS 的选定参数集已被 2020 年 NIST SP 800-208 推荐，并非仅为候选；这类有状态方案必须避免一次性签名密钥重用。[NIST SP 800-208](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-208.pdf)。

---

## 对比与总结

SkipList 和 Merkle Tree 表面上分属不同领域——一个面向有序检索，一个面向数据完整性——但它们共享深层的设计哲学：

| 维度 | SkipList | Merkle Tree |
|------|----------|-------------|
| **核心思想** | 多层稀疏索引 | 递归哈希聚合 |
| **层次化组织** | 多层链表，上层是下层的索引 | 二叉树，父节点是子节点的哈希 |
| **关键操作复杂度** | 期望 O(log n) 查找/插入/删除 | 平衡树中单叶证明/更新为 O(log n)，另计块哈希成本 |
| **设计目标** | 高效的有序数据检索与范围查询 | 高效的数据完整性验证与差异检测 |
| **随机性角色** | 随机化层数决策维持结构均衡 | 哈希函数提供确定性"指纹" |
| **空间换时间** | 索引层消耗额外空间换取查找效率 | 内部节点消耗额外空间换取验证效率 |
| **典型应用系统** | Redis、LevelDB、Java ConcurrentSkipListMap | Bitcoin、Ethereum、Cassandra、Git、IPFS |

从工程视角看，两者的共同启示在于：**在海量数据场景下，层次化组织是降低操作复杂度的普适策略。** 无论是跳表通过分层索引将链表搜索从 O(n) 降至 O(log n)，还是 Merkle Tree 通过分层哈希将数据验证从 O(n) 降至 O(log n)，其本质都是利用树状/层级结构实现对数级的信息压缩。

理解这些经典数据结构的设计思想，不仅有助于读懂现有系统的实现细节，更重要的是在面对新的工程问题时，能够从中提取可复用的设计模式——分层抽象、空间换时间、随机化替代确定性平衡——这些思想远比具体的实现代码更有持久价值。
