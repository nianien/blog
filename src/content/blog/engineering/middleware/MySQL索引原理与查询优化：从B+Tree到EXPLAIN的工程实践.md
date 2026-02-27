---
title: "MySQL 索引原理与查询优化：从 B+Tree 到 EXPLAIN 的工程实践"
pubDate: "2025-11-25"
description: "索引不是加了就快的魔法，而是一套需要理解底层数据结构、遵循匹配规则、结合业务场景做判断的工程实践。从磁盘 I/O 的物理约束理解 B+Tree 的设计动机，从最左前缀匹配理解复合索引的使用规则，从 EXPLAIN 的输出理解优化器的真实决策——每一步都是在缩小扫描行数与实际需要行数之间的差距。"
tags: ["MySQL", "索引优化", "慢查询", "数据库"]
---

## 一、为什么需要索引：从磁盘 I/O 说起

"给这个查询加个索引就好了。"——这句话说起来简单，但如果不理解索引为什么有效，就无法判断什么时候该加、怎么加、以及加了为什么还是慢。

答案藏在磁盘里。

### 内存与磁盘：10 万倍的速度鸿沟

数据库的数据最终存储在磁盘上。一次磁盘 I/O 的真实耗时：

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 寻道（Seek） | ~5ms | 磁头移动到目标磁道 |
| 旋转延迟（Rotation） | ~4.17ms | 7200 RPM 磁盘，平均半圈 |
| 数据传输（Transfer） | ~0.1ms | 读取数据到内存 |
| **总计** | **~9ms** | 一次随机 I/O 的代价 |

9 毫秒看起来不多，但换算到 CPU 视角：一台 500-MIPS 的机器每秒执行 5 亿条指令，9ms 就是 **450 万条指令** 的时间。在 CPU 看来，等一次磁盘 I/O 就像等了一个世纪。

如果一张百万行的表没有索引，查一条记录需要全表扫描——假设每行读一次磁盘，那就是百万次 I/O。这就是为什么没有索引的查询会慢得不可接受。

### 操作系统的预读优化

操作系统做了一个关键优化：**页（Page）预读**。当你从磁盘读取一个字节时，OS 会把这个字节所在的整个页（通常 4KB 或 8KB）一次性加载到内存。读 1 字节和读 4KB 的 I/O 成本是一样的——都是 1 次磁盘 I/O。

这意味着：**如果一种数据结构能保证每次查询只需要少量的 I/O，并且每次 I/O 都能充分利用页的空间，那它就是高效的索引结构。**

B+Tree 正是为此而设计的。

---

## 二、B+Tree：为磁盘而生的数据结构

为什么不用二叉树、红黑树这些内存中高效的数据结构？

关键在于**树的高度**。二叉搜索树的高度是 log₂N，100 万条数据需要 20 层。每一层都意味着一次磁盘 I/O——20 次随机 I/O，每次 9ms，一个简单查询就要 180ms。

B+Tree 的解决思路：**增大每个节点的扇出（fanout），压低树的高度。**

### B+Tree 的三个关键设计决策

```
             [17 | 35]              ← 非叶子节点：只存键值，不存数据
            /    |    \
     [8|12]   [26|30]   [60|75]     ← 非叶子节点
      / | \    / | \     / | \
  [3,5][9,10][13,15][28,29][36][60][75,79][90,99]  ← 叶子节点：存储实际数据
   ↔     ↔      ↔      ↔     ↔    ↔      ↔       ← 叶子节点横向链表
```

**决策一：非叶子节点只存键值不存数据。** 这样一个磁盘页（16KB，InnoDB 默认页大小）能放下更多的键值，单节点的扇出可以达到 **1200+**（每个键值 8 字节 + 指针 6 字节，16KB / 14B ≈ 1170）。

**决策二：数据全部下沉到叶子节点。** 不管查什么数据，走过的路径长度是一样的。查询性能稳定可预测。

**决策三：叶子节点之间用双向链表连接。** 范围查询（如 `WHERE id BETWEEN 100 AND 200`）只需定位到起点，然后顺着链表遍历，不用回到树根。

### 真实数据：22.1GB 表的 B+Tree 长什么样

以一张 22.1GB 的 InnoDB 表为例：

| 指标 | 数据 |
|------|------|
| 叶子节点容纳量 | ~468 行/页 |
| 非叶子节点扇出 | ~1200 路 |
| B+Tree 高度 | **3 层** |
| 非叶子节点总内存 | **< 18.8MB** |
| 高度 4 层时可容纳 | 25.9TB |

3 层 B+Tree 意味着：查找任意一条记录只需 **3 次磁盘 I/O**。而非叶子节点只占 18.8MB，完全可以常驻内存——实际上只有最后一次叶子节点的读取是真正的磁盘 I/O。

这就是索引高效的根本原因：**将百万次随机 I/O 压缩为 1~3 次。**

高度公式：`h = log(m+1)N`，其中 m 是每个节点的扇出数，N 是总记录数。扇出越大，高度越低。这也解释了为什么主键用 int（4 字节）比 uuid（36 字节）好——键越短，一个页能放下越多键，扇出越大，树越矮。

> 关于 B+Tree、B-Tree、LSM-Tree 等存储引擎数据结构的理论细节，参见[《存储引擎核心数据结构：B-Tree 家族与 LSM-Tree 的设计权衡》](/blog/engineering/data-structure/存储引擎核心数据结构：b-tree家族与lsm-tree的设计权衡)。本文聚焦 MySQL 层面的索引使用和优化。

---

## 三、InnoDB 索引的存储结构

理解了 B+Tree 的通用原理后，还需要理解 InnoDB 对 B+Tree 的具体实现方式——它直接决定了"回表"的代价和覆盖索引的价值。

### 聚簇索引 vs 非聚簇索引

InnoDB 和 MyISAM 在索引的组织方式上有根本区别：

```
MyISAM（非聚簇）：
  索引文件(.MYI)          数据文件(.MYD)
  ┌──────────┐           ┌──────────┐
  │ key → 地址 │  ──→     │  行数据    │
  └──────────┘           └──────────┘
  索引和数据分离，索引叶子节点存储数据文件中的物理地址

InnoDB（聚簇）：
  主键索引(.ibd)
  ┌─────────────────┐
  │ primary key → 行数据 │    ← 主键索引的叶子节点就是数据本身
  └─────────────────┘

  二级索引(.ibd)
  ┌──────────────────────┐
  │ index key → primary key │  ← 二级索引的叶子节点存主键值
  └──────────────────────┘
```

**InnoDB 的聚簇索引**：主键和数据存在一起。主键索引的叶子节点就是完整的行数据。这意味着按主键查找只需一棵 B+Tree。

**InnoDB 的二级索引**：叶子节点存储的不是数据的物理地址，而是主键值。通过二级索引查找时，先在二级索引树中找到主键值，再到主键索引树中找到完整数据——这个过程叫**回表**。

### 回表的代价

一次二级索引查询 = **两棵 B+Tree 的查找**。

```
SELECT * FROM users WHERE name = '张三';
-- 假设 name 上有索引

步骤 1：在 name 索引树中查找 '张三' → 得到主键 id = 42
步骤 2：在主键索引树中查找 id = 42 → 得到完整行数据（回表）
```

如果查询返回大量行，每一行都要回表一次，性能会急剧下降。

### 覆盖索引：避免回表

如果索引中已经包含了查询需要的所有列，就不需要回表。这就是**覆盖索引（Covering Index）**。

```sql
-- 索引：INDEX idx_name_age (name, age)

-- 需要回表：SELECT * FROM users WHERE name = '张三'
-- 索引里没有 email、address 等列，必须回表取完整数据

-- 覆盖索引：SELECT name, age FROM users WHERE name = '张三'
-- 索引里就有 name 和 age，直接返回，不用回表
-- EXPLAIN 的 Extra 列会显示 "Using index"
```

### 为什么 InnoDB 必须有主键

InnoDB 的数据组织方式决定了它必须依赖一个聚簇索引。如果你没有显式定义主键：

1. InnoDB 会选择第一个**非空唯一索引**作为聚簇索引
2. 如果也没有，InnoDB 会自动生成一个 6 字节的隐藏 RowID

自动生成的 RowID 用户不可见、不可查询，浪费了聚簇索引的优势。**建议总是显式定义自增整型主键**——它既短（扇出大）又有序（插入不会导致页分裂）。

---

## 四、索引的使用规则

建了索引不代表查询一定会用。MySQL 优化器在决定是否使用索引时有一套严格的规则。搞清楚这些规则，才能建出真正有效的索引。

### 4.1 最左前缀匹配（最重要的规则）

复合索引 `(a, b, c, d)` 的匹配遵循**从左到右**的顺序，遇到范围查询（`>`, `<`, `BETWEEN`, `LIKE`）就停止匹配。

```sql
-- 索引：INDEX idx (a, b, c, d)

WHERE a = 1 AND b = 2 AND c > 3 AND d = 4
-- 命中：a ✓, b ✓, c ✓（范围）, d ✗（c 之后停止匹配）
-- 实际使用了 a, b, c 三列

WHERE a = 1 AND b = 2 AND d = 4
-- 命中：a ✓, b ✓, c 跳过（不在 WHERE 中）, d ✗
-- 实际使用了 a, b 两列

WHERE b = 2 AND c = 3
-- 命中：a 缺失 → 整个索引不可用 ✗
-- 没有最左列 a，无法使用这个索引
```

**优化技巧**：如果某列在 WHERE 中是范围条件，把它放到复合索引的最后面。

```sql
-- 查询：WHERE a = 1 AND b = 2 AND c > 3 AND d = 4

-- 差索引：INDEX (a, b, c, d) → 只用 a, b, c
-- 好索引：INDEX (a, b, d, c) → 用到 a, b, d, c 四列全命中
```

### 4.2 选择性（Selectivity）

选择性衡量一个列能过滤掉多少数据：

```
选择性 = COUNT(DISTINCT col) / COUNT(*)
```

| 选择性 | 含义 | 建索引价值 |
|--------|------|-----------|
| > 0.1 | 每 10 行中有 1 个不同值 | 高，适合建索引 |
| 0.01 ~ 0.1 | 重复较多 | 取决于实际数据分布 |
| < 0.01 | 高度重复（如 status: 0/1/2） | 通常不适合，但有例外 |

**反直觉案例：低选择性也可能有效。** 如果一个 status 字段只有 3 个值（-1, 0, 1），但业务上 99.9% 的记录是 status=1，你要查的恰好是 status=0 的那一小批——索引的效果取决于你要查的值的分布，而不是列整体的选择性。

> **关键洞察**：选择性公式给出的是统计平均，但实际查询命中的是具体值的分布。对于数据分布极度不均匀的列，需要结合业务场景判断。

### 4.3 五条工程戒律

**① 不要在索引列上做计算或函数调用**

```sql
-- ✗ 不走索引：函数包裹了索引列
WHERE FROM_UNIXTIME(create_time) = '2024-05-29'
WHERE YEAR(created_date) = 2024

-- ✓ 走索引：把计算移到值一侧
WHERE create_time = UNIX_TIMESTAMP('2024-05-29')
WHERE created_date >= '2024-01-01' AND created_date < '2025-01-01'
```

原因：对索引列施加函数后，B+Tree 无法利用键值的有序性。

**② = 和 IN 的顺序不影响索引使用**

```sql
-- 以下两种写法等价，优化器会自动重排
WHERE a = 1 AND b = 2 AND c = 3
WHERE c = 3 AND a = 1 AND b = 2
```

**③ 扩展已有索引，而非新建**

```sql
-- 已有索引：INDEX idx_a (a)
-- 现在需要查 WHERE a = ? AND b = ?

-- ✗ 新建：INDEX idx_ab (a, b)  → 现在有两个索引，浪费空间且写入变慢
-- ✓ 扩展：把 idx_a 改为 INDEX idx_ab (a, b)  → idx_ab 同时覆盖单列查询
```

**④ 尽量用覆盖索引减少回表**

如果查询只需要少量列，把这些列都放进索引里，避免回表。

**⑤ 复合索引中选择性高的列放前面**

选择性高的列放前面，能更快地缩小候选集。但这条规则要让位于最左前缀匹配——如果查询条件固定，优先保证查询能命中索引。

---

## 五、EXPLAIN：读懂优化器的决策

索引建好了，查询到底用没用、怎么用？EXPLAIN 是唯一的答案。

```sql
EXPLAIN SELECT * FROM users WHERE name = '张三' AND age > 20;
```

### 核心字段解读

| 字段 | 含义 | 关注点 |
|------|------|--------|
| **type** | 访问类型 | 从好到差：system > const > eq_ref > ref > range > index > ALL |
| **key** | 实际使用的索引 | NULL 表示没走索引 |
| **rows** | 预估扫描行数 | **最关键指标**，越接近结果行数越好 |
| **Extra** | 附加信息 | 关注 Using index / Using filesort / Using temporary |

### type 等级详解

| type | 含义 | 触发条件 | 性能 |
|------|------|---------|------|
| const | 通过主键或唯一索引定位一行 | `WHERE id = 1` | 极快 |
| eq_ref | JOIN 时被驱动表主键等值匹配 | `JOIN ON a.id = b.id` | 极快 |
| ref | 非唯一索引等值匹配 | `WHERE name = '张三'` | 快 |
| range | 索引范围扫描 | `WHERE id > 100` / `WHERE id IN (1,2,3)` | 较快 |
| index | 全索引扫描 | 覆盖索引但无 WHERE 条件 | 一般 |
| ALL | 全表扫描 | 无可用索引 | 最慢 |

### Extra 中的关键信号

| Extra | 含义 | 是否需要优化 |
|-------|------|------------|
| Using index | 覆盖索引，无需回表 | 好，不用动 |
| Using where | 在存储引擎返回数据后由 Server 层过滤 | 看情况 |
| Using filesort | 无法利用索引排序，需额外排序 | 通常需要优化 |
| Using temporary | 需要创建临时表（常见于 GROUP BY） | 需要优化 |

**实战口诀**：
- 看到 `ALL` → 考虑加索引
- 看到 `Using filesort` → 检查 ORDER BY 是否能走索引
- 看到 `Using temporary` → 检查 GROUP BY 是否能走索引
- `rows` 远大于实际结果行数 → 索引选择性不够或索引列不对

---

## 六、ORDER BY 与 GROUP BY 的索引优化

排序和分组是慢查询的常见元凶。MySQL 能利用索引的有序性避免额外排序（filesort），但条件很严格。

### 6.1 ORDER BY 能走索引的条件

```sql
-- 场景一：纯 ORDER BY
-- 索引 (sort_col)
SELECT * FROM t ORDER BY sort_col;       -- ✓ 走索引

-- 场景二：WHERE + ORDER BY
-- 索引 (col_a, sort_col)
SELECT * FROM t WHERE col_a = 1 ORDER BY sort_col;  -- ✓ 走索引

-- 场景三：多列排序
-- 索引 (uid, x, y)
SELECT * FROM t WHERE uid = 1 ORDER BY x, y LIMIT 10;  -- ✓ 走索引
```

关键原则：**WHERE 条件列和 ORDER BY 列必须在同一个复合索引中，且满足最左前缀。**

### 6.2 ORDER BY 不能走索引的五种情况

```sql
-- ① 排序列来自不同索引
-- 有 INDEX(key1) 和 INDEX(key2)
ORDER BY key1, key2          -- ✗ 两个索引无法合并排序

-- ② 跳过了复合索引的中间列
-- INDEX(key_part1, key_part2)
WHERE key_part1 = 1
ORDER BY key_part2            -- ✓ 连续的

WHERE other_col = 1
ORDER BY key_part2            -- ✗ key_part1 缺失

-- ③ ASC 和 DESC 混用
-- INDEX(a, b)
ORDER BY a ASC, b DESC       -- ✗ 方向不一致（MySQL 8.0 之前）

-- ④ WHERE 和 ORDER BY 用了不同索引的列
-- INDEX(key1), INDEX(key2)
WHERE key1 = 1 ORDER BY key2 -- ✗ 走 key1 索引做过滤，但无法用它排序 key2

-- ⑤ 排序列上有函数
ORDER BY YEAR(login_date)     -- ✗ 函数破坏了索引有序性
```

### 6.3 GROUP BY + Top-N 查询模式

"每个分组取前 N 条"是常见的业务需求。几种实现方式的对比：

**方案一：子查询 + MAX（推荐）**

```sql
-- 每组取最大值
SELECT a.* FROM tb a
WHERE val = (SELECT MAX(val) FROM tb WHERE name = a.name)
ORDER BY a.name;
```

**方案二：INNER JOIN + GROUP BY（推荐）**

```sql
SELECT a.* FROM tb a
INNER JOIN (SELECT name, MAX(val) val FROM tb GROUP BY name) b
ON a.name = b.name AND a.val = b.val
ORDER BY a.name;
```

**方案三：窗口函数（MySQL 8.0+，最简洁）**

```sql
-- ROW_NUMBER：严格排名，不并列
SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY subject ORDER BY score DESC) rn
    FROM tb_score
) t WHERE rn <= 3;

-- DENSE_RANK：允许并列，无间隔
SELECT * FROM (
    SELECT *, DENSE_RANK() OVER (PARTITION BY subject ORDER BY score DESC) rk
    FROM tb_score
) t WHERE rk <= 3;
```

| 函数 | 处理并列 | 示例：分数 92, 92, 88 |
|------|---------|---------------------|
| ROW_NUMBER | 不并列 | 1, 2, 3 |
| RANK | 并列，有间隔 | 1, 1, 3 |
| DENSE_RANK | 并列，无间隔 | 1, 1, 2 |

---

## 七、慢查询优化实战

理论讲完了，以下三个真实案例覆盖了慢查询优化中最常见的思路和最重要的教训。

### 优化前的必要步骤

```sql
-- 排除查询缓存的干扰
SELECT SQL_NO_CACHE * FROM ...;
```

### 7.1 案例一：JOIN 重构——从 1.87s 到 10ms

**原始查询**：查找最近一段时间内有更新的员工。

```sql
SELECT DISTINCT cert.emp_id
FROM cm_log cl
INNER JOIN (
    SELECT emp.id emp_id, emp_cert.id cert_id
    FROM employee emp
    LEFT JOIN emp_certificate emp_cert ON emp.id = emp_cert.emp_id
    WHERE emp.is_deleted = 0
) cert
ON (cl.ref_table = 'Employee' AND cl.ref_oid = cert.emp_id)
   OR (cl.ref_table = 'EmpCertificate' AND cl.ref_oid = cert.cert_id)
WHERE cl.last_upd_date >= '2013-11-07 15:03:00'
  AND cl.last_upd_date <= '2013-11-08 16:00:00';
```

**问题诊断**：

- 结果：53 条记录，耗时 **1.87 秒**
- EXPLAIN 显示：cm_log 用 `idx_last_upd_date` 过滤后只有 **379 行**
- 但 JOIN 的派生表（cert）返回 **63,727 行**
- 379 × 63,727 ≈ 2,400 万次比较，绝大多数是无用功

**根因**：OR 连接两种关联条件导致无法走索引 JOIN，退化为笛卡尔积。

**优化方案**：拆成两条查询 + UNION，让小表 cm_log 先过滤。

```sql
SELECT emp.id FROM cm_log cl
INNER JOIN employee emp
    ON cl.ref_table = 'Employee' AND cl.ref_oid = emp.id
WHERE cl.last_upd_date >= '2013-11-07 15:03:00'
  AND cl.last_upd_date <= '2013-11-08 16:00:00'
  AND emp.is_deleted = 0

UNION

SELECT emp.id FROM cm_log cl
INNER JOIN emp_certificate ec
    ON cl.ref_table = 'EmpCertificate' AND cl.ref_oid = ec.id
INNER JOIN employee emp ON emp.id = ec.emp_id
WHERE cl.last_upd_date >= '2013-11-07 15:03:00'
  AND cl.last_upd_date <= '2013-11-08 16:00:00'
  AND emp.is_deleted = 0;
```

**结果**：**10ms**，提升 **187 倍**。

**教训**：JOIN 中的 OR 条件几乎总是性能杀手。拆成 UNION 让每个分支都能走索引。

---

### 7.2 案例二：低选择性索引——从 6.22s 到 200ms

**原始查询**：查找待同步的 POI 数据。

```sql
SELECT * FROM stage_poi sp
WHERE sp.accurate_result = 1
  AND sp.sync_status IN (0, 2, 4);
```

**问题诊断**：

- 结果：951 条记录，耗时 **6.22 秒**
- EXPLAIN：type = ALL，全表扫描 **361 万行**
- 两个字段的选择性都极低：
  - `accurate_result`：只有 -1, 0, 1 三个值
  - `sync_status`：只有 0, 1, 2, 3, 4 五个值

按常规判断，这两列的选择性太差，不适合建索引。

**转折点：理解业务上下文。**

这是一个数据同步任务，每 5 分钟执行一次：
- 处理状态为 0/2/4 的记录（待同步）
- 处理完毕后将状态改为 1（已同步）
- **在任意时刻，待同步的数据不超过 1000 条**，其余 360 万条都是 status=1

也就是说，虽然 sync_status 只有 5 个值，但 **你要查的值的数据量只占 0.03%**。

**优化方案**：

```sql
ALTER TABLE stage_poi ADD INDEX idx_acc_status(accurate_result, sync_status);
```

**结果**：**200ms**，提升 **31 倍**。

**教训**：数据分布比选择性统计更重要。在数据严重倾斜的场景下，低选择性的列也能从索引中获益。

---

### 7.3 案例三：不可优化的查询——13s 且无解

**原始查询**：分页查询联系人。

```sql
SELECT c.id, c.name, c.position, c.sex, c.phone, ...
FROM contact c
INNER JOIN contact_branch cb ON c.id = cb.contact_id
INNER JOIN branch_user bu ON cb.branch_id = bu.branch_id
INNER JOIN org_emp_info oei ON oei.data_id = bu.user_id
WHERE bu.status IN ('0', '1')
  AND oei.node_left = 2875 AND oei.node_right = 10802
  AND oei.org_category = -1
ORDER BY c.created_time
LIMIT 0, 10;
```

**问题诊断**：

- 结果：10 条记录，耗时 **13.06 秒**
- 单表索引都没问题，JOIN 行数也合理
- 但 JOIN 结果有 **77.8 万行**，然后对这 77.8 万行排序取前 10 条

**尝试优化**：改写为 EXISTS 子查询。

```sql
SELECT c.id, c.name, ...
FROM contact c
WHERE EXISTS (
    SELECT 1 FROM contact_branch cb
    INNER JOIN branch_user bu ON cb.branch_id = bu.branch_id
    INNER JOIN org_emp_info oei ON oei.data_id = bu.user_id
    WHERE c.id = cb.contact_id
      AND bu.status IN ('0', '1')
      AND oei.node_left = 2875 AND oei.node_right = 10802
      AND oei.org_category = -1
)
ORDER BY c.created_time LIMIT 0, 10;
```

**结果**：在当前参数下 **0ms**。但换一组参数（匹配 0 行的情况），查询耗时 **218 秒**。

**根因**：MySQL 的嵌套循环 + LIMIT 策略在匹配率极低时退化——每次从 contact 表取 10 行，去子查询里匹配，没匹配到就取下一批 10 行，直到遍历整张表。

**最终结论**：**不是所有慢查询都能在 SQL 层面解决。** 当 JOIN 结果集巨大且排序字段不在过滤条件中时，需要在应用层寻找出路——比如预计算排序、异步分页、或改变产品交互方式。

---

## 八、分页查询优化

深度分页是一个高频性能问题。`LIMIT 100000, 20` 看起来只取 20 条，实际上 MySQL 需要扫描前 100,020 行，丢弃前 100,000 行。

### 四种优化方案

**方案一：基于主键翻页（最推荐）**

```sql
-- 前端传入上一页最后一条记录的 id
SELECT * FROM users WHERE id > 456891 ORDER BY id LIMIT 20;
-- 无论"第几页"，永远只扫描 20 行
```

限制：只能"下一页"，不能跳页。适合瀑布流、无限滚动。

**方案二：子查询定位起点**

```sql
SELECT * FROM users
WHERE id >= (SELECT id FROM users ORDER BY id LIMIT 100000, 1)
ORDER BY id LIMIT 20;
-- 子查询走覆盖索引（只查 id），速度快
-- 外层查询从定位点开始，只扫描 20 行
```

**方案三：反向查询**

```sql
-- 如果总共 160 万行，要取 LIMIT 1200000, 20（偏移 75%）
-- 反向查询：ORDER BY id DESC LIMIT 400000, 20（偏移 25%）
-- 扫描量从 120 万降到 40 万
```

适用：偏移量超过总量 50% 时。

**方案四：延迟关联**

```sql
-- 先查主键列表（走覆盖索引，无回表）
SELECT a.* FROM users a
INNER JOIN (SELECT id FROM users ORDER BY id LIMIT 100000, 20) b
ON a.id = b.id;
```

子查询只在索引上操作，外层 JOIN 只回表 20 行。

| 方案 | 扫描行数 | 可跳页 | 适用场景 |
|------|---------|--------|---------|
| 基于主键翻页 | 约等于 pageSize | 不可以 | 瀑布流、列表翻页 |
| 子查询定位 | 索引扫描 + pageSize | 可以 | 通用分页 |
| 反向查询 | 减半 | 可以 | 偏移超过 50% |
| 延迟关联 | 索引扫描 + pageSize | 可以 | 需回表的分页 |

---

## 九、索引设计决策指南

### 该不该建索引

| 场景 | 建议 | 原因 |
|------|------|------|
| WHERE 条件中的等值查询列 | 建 | 直接命中 |
| WHERE 条件中的范围查询列 | 建（放复合索引最后） | 范围查询后的列不会被使用 |
| JOIN 关联字段 | 必须建 | 否则每次 JOIN 都全表扫描 |
| ORDER BY 字段 | 考虑和 WHERE 列组成复合索引 | 避免 filesort |
| 高频查询但选择性低的列 | 看数据分布 | 统计选择性不等于实际过滤效果 |
| 很少出现在 WHERE 中的列 | 不建 | 索引的写入代价大于查询收益 |

### 索引过多的代价

索引不是免费的。每多一个索引：

- 每次 INSERT 需要额外维护一棵 B+Tree（写入变慢）
- 每次 UPDATE 涉及索引列时需要更新索引
- 每个索引都占磁盘空间
- 索引太多时优化器可能选错索引（需要 `FORCE INDEX` 纠正）

**经验法则**：单表索引数量建议不超过 5~6 个。优先使用复合索引覆盖多种查询，而非为每个查询建单独的索引。

### 核心原则

> **索引优化的本质，是让 EXPLAIN 中的 `rows` 尽可能接近查询的实际结果行数。** 扫描的行数和返回的行数之间的差距，就是浪费的 I/O。
