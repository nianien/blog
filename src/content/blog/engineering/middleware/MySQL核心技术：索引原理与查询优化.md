---
title: "MySQL 核心技术：索引原理与查询优化"
pubDate: "2025-11-25"
description: "索引不是加了就快的魔法，而是一套需要理解底层数据结构、遵循匹配规则、结合业务场景做判断的工程实践。从磁盘 I/O 的物理约束理解 B+Tree 的设计动机，从最左前缀匹配理解复合索引的使用规则，从 EXPLAIN 的输出理解优化器的真实决策——每一步都是在缩小扫描行数与实际需要行数之间的差距。"
tags: ["MySQL", "索引优化", "慢查询", "数据库"]
series:
  key: "mysql-core"
---

本文以 MySQL 8.0、InnoDB 为主要范围；历史案例保留原记录的观察值，不将其作为当前版本或其他数据集的性能承诺。

## 一、为什么需要索引：从磁盘 I/O 说起

"给这个查询加个索引就好了。"——这句话说起来简单，但如果不理解索引为什么有效，就无法判断什么时候该加、怎么加、以及加了为什么还是慢。

答案藏在磁盘里。

### 页访问与缓存决定查找成本

传统机械磁盘的随机访问需要寻道与旋转，SSD 没有相同的机械过程，二者不能共用固定延迟表。数据库也不是每行触发一次磁盘 I/O：InnoDB 按页组织数据，并由 Buffer Pool 缓存；顺序扫描与随机取页的成本不同。

B+Tree 的价值是让一个节点容纳多个导航键，以较小的高度定位目标叶页。内部页常被复用，缓存命中时无需读磁盘。索引并不只是“少走几层”，还要避免读取大量无关记录和反复回表。

## 二、B+Tree 如何组织一次查询

### B+Tree 的三个关键设计决策

```
             [17 | 35]              ← 非叶子节点：只存键值，不存数据
            /    |    \
     [8|12]   [26|30]   [60|75]     ← 非叶子节点
      / | \    / | \     / | \
  [3,5][9,10][13,15][28,29][36][60][75,79][90,99]  ← 叶子节点：存储实际数据
   ↔     ↔      ↔      ↔     ↔    ↔      ↔       ← 叶子节点横向链表
```

**决策一：内部节点存放用于导航的键和子页引用。** 不把完整行放在内部节点，可以提高扇出。默认 16 KiB 页中的有效容量还要扣除页头、记录头和目录等开销，不能直接用 16384/14 推出固定扇出。

**决策二：数据全部下沉到叶子节点。** 树的叶子处于相同深度，但缓存命中、范围大小、回表与版本检查仍会改变实际耗时。

**决策三：叶子节点之间用双向链表连接。** 范围查询（如 `WHERE id BETWEEN 100 AND 200`）只需定位到起点，然后顺着链表遍历，不用回到树根。

### 用明确假设估算容量

若一棵三层树的内部节点平均扇出为 f，叶页平均放 r 条记录，其量级可估为 f²×r。这里 f、r 都受键长、行格式、页占用和数据分布影响，不是固定常数。高度也不等于物理 I/O 次数，还要考虑缓存和页外字段。

短主键同时减少聚簇树导航键和二级索引中附带主键的空间。UUID 可以采用二进制等存储形式，并非必然占 36 字节；具体选型还要满足生成、排序和业务引用要求。

> 关于 B+Tree、B-Tree、LSM-Tree 等存储引擎数据结构的理论细节，参见[《存储引擎核心数据结构：B-Tree 家族与 LSM-Tree 的设计权衡》](/blog/engineering/algorithm/存储引擎核心数据结构：B-Tree家族与LSM-Tree的设计权衡)。本文聚焦 MySQL 层面的索引使用和优化。

---

## 三、InnoDB 索引的存储结构

理解了 B+Tree 的通用原理后，还需要理解 InnoDB 对 B+Tree 的具体实现方式——它直接决定了"回表"的代价和覆盖索引的价值。

### 聚簇索引 vs 非聚簇索引

InnoDB 和 MyISAM 在索引的组织方式上有根本区别：

| 索引组织 | 叶子项与数据的关系 |
| --- | --- |
| MyISAM | 索引项引用独立数据文件中的记录 |
| InnoDB 聚簇索引 | 叶子保存行记录 |
| InnoDB 二级索引 | 保存二级键及定位聚簇记录所需的主键 |

**InnoDB 的聚簇索引**：主键和数据存在一起。聚簇索引叶子保存行记录，较长的字段也可能使用页外存储。这意味着按主键查找只需一棵 B+Tree。

**InnoDB 的二级索引**：叶子节点存储的不是数据的物理地址，而是主键值。通过二级索引查找时，先在二级索引树中找到主键值，再到主键索引树中找到完整数据——这个过程叫**回表**。

### 回表的代价

需要从二级索引取回索引外列时，通常还要查聚簇索引；匹配多条记录时，这不是固定两次页面访问。

```
SELECT * FROM users WHERE name = '张三';
-- 假设 name 上有索引

步骤 1：在 name 索引树中查找 '张三' → 得到主键 id = 42
步骤 2：在主键索引树中查找 id = 42 → 得到完整行数据（回表）
```

如果查询返回大量行，每一行都要回表一次，性能会急剧下降。

### 覆盖索引：避免回表

如果索引包含查询所需的列，就有机会避免为取列而回表；MVCC 可见性检查等因素仍可能访问聚簇记录。这就是**覆盖索引（Covering Index）**。

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

自动生成的 RowID 用户不可见、不可查询，浪费了聚簇索引的优势。通常优先考虑短、稳定的显式主键。自增整数有利于顺序插入，但页满时仍需扩展或分裂；全局生成、数据分片等需求也可能要求其他方案。

---

## 四、索引的使用规则

建了索引不代表查询一定会用。MySQL 优化器在决定是否使用索引时有一套严格的规则。搞清楚这些规则，才能建出真正有效的索引。

### 4.1 最左前缀匹配（最重要的规则）

复合索引按键的字典序组织。构造连续查找区间时，等值前缀和后续范围条件最容易发挥作用；范围之后的列仍可能参与索引条件下推、覆盖和过滤，不等于完全无效。MySQL 8.0 在符合条件时还可以采用 skip scan，不能把缺少首列写成索引绝对不可用。[范围优化](https://dev.mysql.com/doc/refman/8.0/en/range-optimization.html)

```sql
-- 索引：INDEX idx (a, b, c, d)

WHERE a = 1 AND b = 2 AND c > 3 AND d = 4
-- a/b/c 通常用于界定连续区间，d 仍可参与过滤或索引条件下推

WHERE a = 1 AND b = 2 AND d = 4
-- a/b 构成前缀区间；缺少 c 时，d 不能直接接成长等值前缀

WHERE b = 2 AND c = 3
-- 缺少 a，通常不能直接按左前缀定位；仍需检查覆盖扫描或 skip scan 等计划
```

对以等值过滤后扫描范围为主的查询，可以评估将范围列放在等值列之后；还要兼顾其他查询、排序和索引长度。

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

这个比例描述去重值数与行数的关系，不能用 0.1 或 0.01 作为统一建索引阈值。要看具体查询值命中多少记录，以及返回和排序需要付出的成本。

**反直觉案例：低选择性也可能有效。** 如果一个 status 字段只有 3 个值（-1, 0, 1），但业务上 99.9% 的记录是 status=1，你要查的恰好是 status=0 的那一小批——索引的效果取决于你要查的值的分布，而不是列整体的选择性。

> **关键洞察**：选择性公式给出的是统计平均，但实际查询命中的是具体值的分布。对于数据分布极度不均匀的列，需要结合业务场景判断。

### 4.3 五个设计检查点

**① 不要在索引列上做计算或函数调用**

```sql
-- 普通原列索引通常不能直接服务以下函数条件
WHERE DATE(FROM_UNIXTIME(create_time)) = '2024-05-29'
WHERE YEAR(created_date) = 2024

-- 若目标是同一会话时区的一整天，可评估改写为半开区间
WHERE create_time >= UNIX_TIMESTAMP('2024-05-29')
  AND create_time < UNIX_TIMESTAMP('2024-05-30')
WHERE created_date >= '2024-01-01' AND created_date < '2025-01-01'
```

普通索引保存的是原列顺序。函数索引或生成列索引可支持相应表达式，需核对版本、表达式匹配和时区等语义，不能把改写仅当成语法替换。

**② = 和 IN 的顺序不影响索引使用**

```sql
-- 以下两种写法等价，优化器会自动重排
WHERE a = 1 AND b = 2 AND c = 3
WHERE c = 3 AND a = 1 AND b = 2
```

**③ 评估重叠索引，不直接删除旧索引**

```sql
-- 已有索引：INDEX idx_a (a)
-- 现在需要查 WHERE a = ? AND b = ?

-- idx_ab 可服务不少原有 a 前缀查询
-- 是否替换 idx_a 要核对唯一约束、索引宽度、其他查询和上线变更成本
```

**④ 尽量用覆盖索引减少回表**

对高频查询评估覆盖索引，同时计算新增列带来的存储和写入成本，不为 SELECT * 盲目复制整行。

**⑤ 先看访问模式，再看单列选择性**

当所有前缀条件都是等值时，简单交换它们不一定减少最终扫描量。哪些查询能复用前缀、是否需要范围和排序，通常比“选择性最高的永远在前”更有区分度。

---

## 五、EXPLAIN：读懂优化器的决策

索引建好了，查询到底用没用、怎么用？EXPLAIN 提供计划证据；在允许实际执行的环境中，EXPLAIN ANALYZE 可进一步核对实际行数、循环次数与时间。还要观察缓存、锁等待和系统负载。

```sql
EXPLAIN SELECT * FROM users WHERE name = '张三' AND age > 20;
```

### 核心字段解读

| 字段 | 含义 | 关注点 |
|------|------|--------|
| **type** | 访问类型 | 观察访问方式，不把类型排序当成独立的性能结论 |
| **key** | 实际使用的索引 | NULL 表示没走索引 |
| **rows** | 预估扫描行数 | 估算值，需结合过滤、循环次数和实际执行核对 |
| **Extra** | 附加信息 | 关注 Using index / Using filesort / Using temporary |

### type 等级详解

| type | 含义 | 触发条件 | 性能 |
|------|------|---------|------|
| const | 通过主键或唯一索引定位一行 | `WHERE id = 1` | 极快 |
| eq_ref | JOIN 时被驱动表主键等值匹配 | `JOIN ON a.id = b.id` | 极快 |
| ref | 非唯一索引等值匹配 | `WHERE name = '张三'` | 快 |
| range | 索引范围扫描 | `WHERE id > 100` / `WHERE id IN (1,2,3)` | 较快 |
| index | 全索引扫描 | 覆盖索引但无 WHERE 条件 | 一般 |
| ALL | 全表扫描 | 无合适索引或优化器选择扫描 | 小表或大量取数时可能合理 |

### Extra 中的关键信号

| Extra | 含义 | 是否需要优化 |
|-------|------|------------|
| Using index | 使用覆盖索引路径 | 仍可能扫描大量索引项 |
| Using where | 在存储引擎返回数据后由 Server 层过滤 | 看情况 |
| Using filesort | 需要额外排序，不表示必定落盘 | 结合数据量和实际成本判断 |
| Using temporary | 需要内部临时表 | 检查规模与内存/磁盘使用，未必值得消除 |

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
SELECT * FROM t ORDER BY sort_col;       -- 索引有机会提供顺序，最终由成本估算决定

-- 场景二：WHERE + ORDER BY
-- 索引 (col_a, sort_col)
SELECT * FROM t WHERE col_a = 1 ORDER BY sort_col;  -- 索引有机会提供顺序，最终由成本估算决定

-- 场景三：多列排序
-- 索引 (uid, x, y)
SELECT * FROM t WHERE uid = 1 ORDER BY x, y LIMIT 10;  -- 索引有机会提供顺序，最终由成本估算决定
```

过滤条件可以在扫描后应用，ORDER BY 也可能单独利用排序索引；是否值得如此取决于选择性、LIMIT 和回表成本。不能要求所有 WHERE 列必须与排序列出现在同一索引。[排序优化](https://dev.mysql.com/doc/refman/8.0/en/order-by-optimization.html)

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
ORDER BY a ASC, b DESC       -- MySQL 8.0 可评估对应的混合方向索引

-- ④ WHERE 和 ORDER BY 用了不同索引的列
-- INDEX(key1), INDEX(key2)
WHERE key1 = 1 ORDER BY key2 -- ✗ 走 key1 索引做过滤，但无法用它排序 key2

-- ⑤ 排序列上有函数
ORDER BY YEAR(login_date)     -- ✗ 函数破坏了索引有序性
```

### 6.3 GROUP BY + Top-N 查询模式

"每个分组取前 N 条"是常见的业务需求。几种实现方式的对比：

**方案一：子查询 + MAX（取每组最大值，保留并列）**

```sql
-- 每组取最大值
SELECT a.* FROM tb a
WHERE val = (SELECT MAX(val) FROM tb WHERE name = a.name)
ORDER BY a.name;
```

**方案二：INNER JOIN + GROUP BY（同样只取最大值，不是任意 Top-N）**

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
    SELECT *, ROW_NUMBER() OVER (PARTITION BY subject ORDER BY score DESC, id) rn
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

以下三个历史案例保留原稿给出的查询与观察值。原始测试环境、表定义和计划未完整附出，因此这些数字只说明原记录中的效果，不代表本次复现实验或通用提升倍数。

### 优化前先记录实验条件

记录版本、表和索引定义、样本分布、计划、缓存状态及多次执行结果。MySQL 8.0 已移除查询缓存，不再用 SQL_NO_CACHE 作为通用测试步骤；Buffer Pool 仍会影响冷热读差异。分析执行计划时也要明确 EXPLAIN ANALYZE 会真的运行查询。

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

**待核对的执行解释**：OR 关联可能使有效索引访问困难，但仅凭两个行数相乘不能确定实际比较次数或断言产生笛卡尔积，需要核对当时计划。

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

**可迁移的思路**：拆分不同关联路径，分别评估索引和计划。这里 UNION 还保留了原查询的去重语义；不能不经检查改成 UNION ALL。

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

### 7.3 案例三：改写收益依赖匹配率

**原始查询**：分页查询联系人。

```sql
SELECT c.id, c.name, c.position, c.sex, c.phone
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
SELECT c.id, c.name, c.position, c.sex, c.phone
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

**原记录的结果**：一组参数显示 0ms，这表示未超过当时计时粒度，不是零成本；另一组匹配 0 行的参数耗时 218 秒。

**可能的机制**：若计划按 created_time 扫描联系人，再逐行验证 EXISTS，低匹配率会迫使它扫描更多候选。LIMIT 10 不意味着底层固定每次取 10 行；必须由实际计划确认这一解释。

更关键的是语义：原 JOIN 可能为同一联系人返回多行，EXISTS 则只判断有无匹配。只有业务确实要唯一联系人、并处理重复与排序关系时，二者才可这样比较。

**最终结论**：**不是所有慢查询都能在 SQL 层面解决。** 当 JOIN 结果集巨大且排序字段不在过滤条件中时，需要在应用层寻找出路——比如预计算排序、异步分页、或改变产品交互方式。

---

## 八、分页查询优化

深度分页是一个高频性能问题。`LIMIT 100000, 20` 看起来只取 20 条，实际上 MySQL 需要扫描前 100,020 行，丢弃前 100,000 行。

### 四种优化方案

**方案一：基于主键翻页（最推荐）**

```sql
-- 前端传入上一页最后一条记录的 id
SELECT * FROM users WHERE id > 456891 ORDER BY id LIMIT 20;
-- 避免重复跳过之前各页；MVCC 与实际数据仍会影响访问量
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
-- 反向偏移 = 总数 - 原偏移 - 页大小 = 399980
-- ORDER BY id DESC LIMIT 399980, 20，取回后再按 id 升序展示
-- 扫描量从 120 万降到 40 万
```

前提是总数、过滤集合和分页读取基于一致的数据视图，且排序唯一；否则并发变化会使页码映射漂移。

**方案四：延迟关联**

```sql
-- 先查主键列表（走覆盖索引，无回表）
SELECT a.* FROM users a
INNER JOIN (SELECT id FROM users ORDER BY id LIMIT 100000, 20) b
ON a.id = b.id
ORDER BY a.id;
```

子查询只在索引上操作，外层 JOIN 只回表 20 行。

| 方案 | 扫描行数 | 可跳页 | 适用场景 |
|------|---------|--------|---------|
| 基于主键翻页 | 约等于 pageSize | 不可以 | 瀑布流、列表翻页 |
| 子查询定位 | 索引扫描 + pageSize | 可以 | 通用分页 |
| 反向查询 | 取决于距尾部的距离 | 可以 | 已知一致总数与唯一排序 |
| 延迟关联 | 索引扫描 + pageSize | 可以 | 需回表的分页 |

---

## 九、索引设计决策指南

### 该不该建索引

| 场景 | 建议 | 原因 |
|------|------|------|
| WHERE 条件中的等值查询列 | 建 | 直接命中 |
| 范围过滤 | 评估等值前缀后的范围列 | 后续列仍可能参与过滤与覆盖 |
| JOIN 关联字段 | 按连接方向与计划评估 | 索引嵌套循环、哈希连接等路径成本不同 |
| ORDER BY 字段 | 考虑和 WHERE 列组成复合索引 | 避免 filesort |
| 高频查询但选择性低的列 | 看数据分布 | 统计选择性不等于实际过滤效果 |
| 很少出现在 WHERE 中的列 | 不建 | 索引的写入代价大于查询收益 |

### 索引过多的代价

索引不是免费的。每多一个索引：

- 每次 INSERT 需要额外维护一棵 B+Tree（写入变慢）
- 每次 UPDATE 涉及索引列时需要更新索引
- 每个索引都占磁盘空间
- 相近候选与统计偏差可能影响选择；先核对统计和成本，再谨慎评估索引提示

按工作负载评估每个索引的读收益、写放大和空间成本，清理有证据的冗余；不以固定数量作为所有表的上限。

### 核心原则

> 索引优化应减少完成目标查询所需的总成本。估算行数是线索，实际访问量、回表、排序、锁等待和写入代价才共同决定收益；聚合查询返回一行也可能合理地读取大量数据。
