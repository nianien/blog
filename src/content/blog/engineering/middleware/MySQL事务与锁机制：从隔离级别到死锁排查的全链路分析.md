---
title: "MySQL 事务与锁机制：从隔离级别到死锁排查的全链路分析"
pubDate: "2025-11-25"
description: "事务的四个隔离级别不是教科书上的枯燥定义，而是对"读写冲突"这个核心矛盾的四种不同权衡。Read Uncommitted 用最小代价换最大并发，Serializable 用最大代价换绝对正确——中间两档的差异藏在"锁持有多久"和"锁住什么范围"的细节里。理解这些细节，才能看懂 InnoDB 的加锁行为，才能在死锁发生时快速定位根因。"
tags: ["MySQL", "事务", "锁机制", "死锁"]
---

## 一、事务的核心问题：并发读写的五种冲突

事务不是数据库的"高级功能"，而是解决一个根本性矛盾的机制：**多个操作同时访问同一份数据时，如何保证结果的正确性。**

以银行转账为例：A 账户向 B 账户转 500 元，这个操作必须是"A 减 500"和"B 加 500"同时成功或同时失败——中间不能有其他事务看到 A 减了但 B 还没加的中间状态。

ACID 四个字母概括了事务需要保证的四种性质：

| 性质 | 含义 | 保障机制 |
|------|------|---------|
| **A**tomicity（原子性） | 要么全做，要么全不做 | undo log（回滚日志） |
| **C**onsistency（一致性） | 事务前后数据满足约束 | 由 A + I + D 共同保证 |
| **I**solation（隔离性） | 并发事务互不干扰 | 锁 + MVCC |
| **D**urability（持久性） | 提交后数据不丢 | redo log（重做日志） |

其中**隔离性**是最复杂的。完美的隔离（串行执行）性能太差，所以 SQL 标准定义了四个隔离级别，本质是在"并发度"和"正确性"之间做不同程度的取舍。

### 五种并发冲突

在讨论隔离级别之前，先搞清楚并发事务之间到底会产生哪些冲突：

**① 脏读（Dirty Read）**

```
事务 A：读取 X = 100
事务 B：将 X 改为 200（未提交）
事务 A：再读 X = 200  ← 读到了 B 未提交的数据
事务 B：回滚（X 恢复为 100）
事务 A 基于 X=200 做的决策全部错误
```

读到了别人**尚未提交**的修改。如果对方回滚，你的决策就建立在一个"从未存在过"的值上。

**② 不可重复读（Non-Repeatable Read）**

```
事务 A：读取 X = 100
事务 B：将 X 改为 200 并提交
事务 A：再读 X = 200  ← 同一事务内两次读取结果不同
```

同一事务内两次读取**同一行**，结果不一致。关注的是**已有行的修改**。

**③ 幻读（Phantom Read）**

```
事务 A：SELECT * WHERE age > 20  → 返回 10 行
事务 B：INSERT INTO ... (age=25) 并提交
事务 A：SELECT * WHERE age > 20  → 返回 11 行  ← 多了一行"幻影"
```

同一事务内两次范围查询，结果集**行数不同**。关注的是**新插入的行**。

**④ 丢失更新（Lost Update）**

```
事务 A：读取余额 = 1000
事务 B：读取余额 = 1000
事务 A：扣款 200，写入余额 = 800
事务 B：扣款 300，写入余额 = 700  ← A 的扣款被覆盖
```

两个事务都基于同一个旧值做计算，后提交的覆盖了先提交的。最终余额 700，正确答案应该是 500。

**⑤ 第二类丢失更新**

本质与丢失更新相同，但发生在"先读后写"的场景。事务 A 和 B 都读到同一行，各自修改后提交，先提交的修改被后提交的覆盖。

---

## 二、四种隔离级别：本质是锁的持有时间和范围

隔离级别的差异不在于"要不要加锁"，而在于**锁什么（行还是范围）**和**持有多久（读完就放还是事务结束才放）**。

### 2.1 Read Uncommitted（读未提交）

```
读操作：不加锁
写操作：加排他锁，事务结束释放
```

- 读不加锁意味着可以读到其他事务正在修改但尚未提交的数据 → **允许脏读**
- 写加锁防止两个事务同时修改同一行 → 防止丢失更新

**适用场景**：几乎不用。读到脏数据可能导致级联错误——你基于未提交的数据做了决策，对方回滚后你的决策就建立在错误的基础上。

### 2.2 Read Committed（读已提交）

```
读操作：加共享锁，读完立即释放
写操作：加排他锁，事务结束释放
```

**关键行为**：共享锁**读完就释放**，不会持有到事务结束。

```sql
-- 事务 A
BEGIN;
SELECT balance FROM accounts WHERE id = 1;  -- 加共享锁，读取后立即释放
-- （此时其他事务可以修改 id=1 的行）
SELECT balance FROM accounts WHERE id = 1;  -- 再次读取，可能得到不同的值
COMMIT;
```

两次读之间，其他事务可能修改并提交了该行 → **允许不可重复读**，但**杜绝脏读**（只能读到已提交的值）。

**Read Committed 是大多数数据库（Oracle、PostgreSQL、SQL Server）的默认隔离级别。** 它在安全性和性能之间取得了不错的平衡。

### 2.3 Repeatable Read（可重复读）

```
读操作：加共享锁，事务结束才释放
写操作：加排他锁，事务结束释放
```

**关键区别**：共享锁**持有到事务结束**。

```sql
-- 事务 A
BEGIN;
SELECT balance FROM accounts WHERE id = 1;  -- 加共享锁，持有到 COMMIT
-- （其他事务无法修改 id=1 的行，因为共享锁还没释放）
SELECT balance FROM accounts WHERE id = 1;  -- 一定读到相同的值
COMMIT;  -- 释放共享锁
```

锁住了读过的行，保证本事务内两次读取结果一致 → **杜绝不可重复读**。但其他事务仍然可以 INSERT 新行 → **允许幻读**。

**Repeatable Read 是 InnoDB 的默认隔离级别。** InnoDB 通过 **Next-Key Lock**（间隙锁）在很大程度上解决了幻读问题，使得 RR 级别在 InnoDB 中几乎等同于 Serializable 的正确性，但性能好得多。

### 2.4 Serializable（可串行化）

```
所有读写操作完全串行化
读操作加范围锁（锁住行和行之间的间隙）
```

最高隔离级别，完全杜绝所有并发问题。代价是**并发度极低**——多个事务实质上排队执行。

**适用场景**：极少使用。通常有更好的替代方案（如应用层乐观锁 + Read Committed）。

### 隔离级别对比总表

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 并发度 | 锁持有特征 |
|---------|------|-----------|------|--------|-----------|
| Read Uncommitted | 可能 | 可能 | 可能 | 最高 | 读不加锁 |
| Read Committed | 杜绝 | 可能 | 可能 | 高 | 读锁读完就放 |
| **Repeatable Read** | 杜绝 | 杜绝 | 可能* | 中 | 读锁事务结束放 |
| Serializable | 杜绝 | 杜绝 | 杜绝 | 最低 | 读锁 + 范围锁 |

*InnoDB 的 RR 级别通过 Next-Key Lock 在大多数场景下也能杜绝幻读。

> **工程建议**：大多数业务场景使用 **Read Committed + 应用层乐观锁**（版本号机制）是最佳平衡。InnoDB 默认的 Repeatable Read 在不了解其加锁行为时容易引发意外的锁等待和死锁。

---

## 三、InnoDB 的锁类型体系

理解了隔离级别的宏观框架后，需要深入 InnoDB 的具体锁类型——它们决定了"到底锁了什么"。

### 3.1 按粒度分

**行锁（Record Lock）**

锁住索引中的一条记录。注意：InnoDB 的行锁是**加在索引上**的，不是加在数据行上的。

```sql
-- 假设 id 是主键
SELECT * FROM users WHERE id = 1 FOR UPDATE;
-- 锁住主键索引中 id=1 的记录
```

**间隙锁（Gap Lock）**

锁住索引记录之间的"间隙"，防止其他事务在这个间隙中插入新记录。这是 InnoDB 防止幻读的关键机制。

```sql
-- 假设索引中有 id = 5, 10, 15
SELECT * FROM users WHERE id BETWEEN 6 AND 14 FOR UPDATE;
-- 锁住 (5, 10) 和 (10, 15) 两个间隙
-- 其他事务无法在这些间隙中 INSERT
```

**Next-Key Lock**

Record Lock + Gap Lock 的组合。InnoDB 在 Repeatable Read 级别下默认使用 Next-Key Lock——既锁住当前记录，又锁住记录前面的间隙。

```
索引中：... 5, 10, 15, 20 ...
Next-Key Lock on 10 → 锁住 (5, 10]（左开右闭）
```

**表锁**

当 UPDATE/DELETE 的 WHERE 条件没有走索引时，InnoDB 无法定位具体的行，退化为**全表扫描 + 锁住所有扫描到的行**——效果等同于表锁。

```sql
-- 假设 status 没有索引
UPDATE users SET name = '...' WHERE status = 1;
-- 全表扫描，锁住所有行 → 其他事务完全被阻塞
```

这就是为什么 UPDATE/DELETE 语句**必须走索引**的另一个重要原因。

### 3.2 按模式分

| 锁模式 | 触发方式 | 兼容性 |
|--------|---------|--------|
| 共享锁（S） | `SELECT ... LOCK IN SHARE MODE` | 与 S 兼容，与 X 互斥 |
| 排他锁（X） | `SELECT ... FOR UPDATE` / INSERT / UPDATE / DELETE | 与所有锁互斥 |
| 意向共享锁（IS） | 事务打算在行级加 S 锁时自动在表级加 IS | 表级信号，快速判断兼容性 |
| 意向排他锁（IX） | 事务打算在行级加 X 锁时自动在表级加 IX | 表级信号 |

**意向锁的作用**：当一个事务想对整张表加锁时（如 DDL 操作），不需要逐行检查是否有行锁，只需检查表上是否有 IS/IX 锁即可。

### 3.3 锁兼容矩阵

|  | S | X | IS | IX |
|--|---|---|----|----|
| **S** | 兼容 | **冲突** | 兼容 | **冲突** |
| **X** | **冲突** | **冲突** | **冲突** | **冲突** |
| **IS** | 兼容 | **冲突** | 兼容 | 兼容 |
| **IX** | **冲突** | **冲突** | 兼容 | 兼容 |

核心规则：**排他锁与一切互斥，共享锁之间互相兼容。**

### 3.4 关键认知：行锁加在索引上

这是理解 InnoDB 锁行为的最重要的一句话：**InnoDB 的行锁不是锁"行"，而是锁"索引记录"。**

这意味着：

1. **无索引 → 表锁**：WHERE 条件没走索引时，全表扫描会锁住所有行
2. **二级索引 → 两次加锁**：通过二级索引定位数据时，先锁二级索引记录，再锁主键索引记录
3. **加锁顺序不可控**：不同的二级索引可能导致不同的加锁顺序 → 死锁

```sql
-- 假设 users 表有索引 idx_name(name) 和主键 id
UPDATE users SET age = 30 WHERE name = '张三';

-- 加锁过程：
-- 1. 在 idx_name 中找到 name='张三' → 锁住 idx_name 中的这条记录
-- 2. 通过 idx_name 拿到主键 id=42 → 锁住主键索引中 id=42 的记录
-- 3. 执行 UPDATE
-- 4. 事务提交时释放所有锁
```

---

## 四、死锁：成因、案例与排查

### 4.1 死锁的四个必要条件

死锁的产生需要同时满足四个条件：

1. **互斥**：锁是排他的（排他锁不能共享）
2. **持有并等待**：事务持有一把锁的同时等待另一把锁
3. **不可抢占**：已获得的锁不会被强制释放
4. **循环等待**：A 等 B，B 等 A

打破任一条件即可避免死锁。工程上最实际的手段是**统一加锁顺序**（打破循环等待）。

### 4.2 真实案例：UPDATE 引发的死锁

**场景**：高并发下同时执行：

```sql
INSERT INTO user_praise(uid, plan_id, stage_id) VALUES(?, ?, ?);
UPDATE plan_hot SET hot = hot + 1 WHERE plan_id = ?;
```

报错：`Deadlock found when trying to get lock; try restarting transaction`

**问题 SQL**：

```sql
UPDATE coupon
SET coup_num_usr = coup_num_usr + 1
WHERE coup_usr = ? AND spec_id = ? AND coup_num_usr < ?;
```

假设 `(spec_id, coup_usr)` 上有联合索引 `idx_spec_usr`。

**加锁过程分析**：

```
事务 A 执行 UPDATE（通过 idx_spec_usr 定位）：
  ① 锁 idx_spec_usr 中的记录（二级索引锁）
  ② 等待主键索引锁...

事务 B 执行 UPDATE（通过主键定位，恰好涉及同一行）：
  ① 锁主键索引中的记录
  ② 等待 idx_spec_usr 锁...

事务 A 持有二级索引锁，等主键锁
事务 B 持有主键锁，等二级索引锁
→ 循环等待 → 死锁
```

加锁顺序图示：

```
事务 A：idx_spec_usr ──→ 等待 Primary Key
                              ↑
                              │ 循环等待
                              ↓
事务 B：Primary Key  ──→ 等待 idx_spec_usr
```

### 4.3 解决方案：拆分 SELECT 和 UPDATE

**死锁写法**：

```sql
-- 通过二级索引条件直接 UPDATE
-- 加锁顺序：二级索引 → 主键（不可控）
UPDATE coupon
SET coup_num_usr = coup_num_usr + 1
WHERE coup_usr = ? AND spec_id = ? AND coup_num_usr < ?;
```

**安全写法**：

```sql
-- 第一步：SELECT 不加锁（普通读，走 MVCC 快照）
SELECT id FROM coupon WHERE coup_usr = ? AND spec_id = ?;

-- 第二步：用主键 UPDATE，加锁顺序确定且统一
UPDATE coupon
SET coup_num_usr = coup_num_usr + 1
WHERE id = ? AND coup_num_usr < ?;
```

**为什么安全**：
- SELECT 走 MVCC 快照读，不加任何锁
- UPDATE 只通过主键定位，所有事务的加锁顺序都是"只锁主键索引"
- 加锁顺序统一 → 打破循环等待 → 不会死锁

### 4.4 死锁排查工具箱

**查看最近的死锁信息**：

```sql
SHOW ENGINE INNODB STATUS\G
-- 找到 "LATEST DETECTED DEADLOCK" 段落
-- 会显示两个事务各自持有和等待的锁
```

**MySQL 8.0+ 实时查看锁信息**：

```sql
-- 查看当前持有的锁
SELECT * FROM performance_schema.data_locks;

-- 查看锁等待关系
SELECT * FROM performance_schema.data_lock_waits;
```

**关键配置项**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `innodb_lock_wait_timeout` | 50 秒 | 锁等待超时时间 |
| `innodb_deadlock_detect` | ON | 自动死锁检测 |
| `innodb_print_all_deadlocks` | OFF | 将所有死锁信息写入错误日志 |

> 建议生产环境开启 `innodb_print_all_deadlocks`，方便事后分析。

### 4.5 死锁预防通用策略

| 策略 | 做法 | 原理 |
|------|------|------|
| 统一加锁顺序 | 所有事务按主键顺序加锁 | 打破循环等待 |
| 保持事务短小 | 减少持锁时间和锁范围 | 减少冲突窗口 |
| 避免锁升级 | WHERE 条件必须走索引 | 防止行锁退化为表锁 |
| 使用主键更新 | 先 SELECT id，再 UPDATE WHERE id=? | 统一加锁路径 |
| 降低隔离级别 | Read Committed 加锁更少 | 减少间隙锁，降低冲突 |
| 重试机制 | 捕获死锁异常后自动重试 | 死锁不可完全避免时的兜底 |

---

## 五、InnoDB vs MyISAM：锁机制对比

| 维度 | InnoDB | MyISAM |
|------|--------|--------|
| 锁粒度 | 行级锁（基于索引） | 表级锁 |
| 事务支持 | 完整 ACID | 不支持 |
| 死锁 | 可能发生 | 不会（表级锁不产生循环等待） |
| 并发读写 | 高（行锁冲突少） | 低（写锁阻塞所有读） |
| 崩溃恢复 | redo log 保证恢复 | 无保障 |
| 存储文件 | FRM + ibd（聚簇存储） | FRM + MYI + MYD |
| 外键 | 支持 | 不支持 |

**MyISAM 的锁行为**：

```
读操作：对整表加共享锁 → 多个读可以并行
写操作：对整表加排他锁 → 阻塞所有读和写
```

简单粗暴，但没有死锁问题（只有表级锁，不存在"持有 A 等 B、持有 B 等 A"的情况）。

**工程判断**：除了只读归档表和全文搜索（MyISAM 的全文索引在 MySQL 5.6 之前更成熟）等极少数场景，一律使用 InnoDB。MySQL 5.5.5 之后 InnoDB 已经是默认引擎。

---

## 六、分页查询与锁的关系

分页查询的性能问题不只是"扫描行数多"，还有一个容易忽视的问题：**持锁时间。**

### 大偏移分页的锁隐患

```sql
-- 在一个事务中
BEGIN;
SELECT * FROM orders WHERE status = 1 ORDER BY id LIMIT 100000, 20 FOR UPDATE;
-- 扫描 100,020 行，对所有扫描到的行加排他锁
-- 锁持有到事务提交
COMMIT;
```

如果这个事务执行 500ms，那 100,020 行数据被锁住 500ms。在高并发场景下，其他要修改这些行的事务全部排队等待。

### 优化方案

**方案一：基于主键翻页（最推荐）**

```sql
SELECT * FROM orders WHERE status = 1 AND id > 456891 ORDER BY id LIMIT 20;
-- 只扫描 20 行，只锁 20 行
```

**方案二：子查询定位**

```sql
SELECT * FROM orders
WHERE id >= (SELECT id FROM orders WHERE status = 1 ORDER BY id LIMIT 100000, 1)
  AND status = 1
ORDER BY id LIMIT 20;
-- 子查询走覆盖索引（只查 id），不加行锁
-- 外层只扫描 20 行
```

**方案三：延迟关联**

```sql
SELECT o.* FROM orders o
INNER JOIN (SELECT id FROM orders WHERE status = 1 ORDER BY id LIMIT 100000, 20) t
ON o.id = t.id;
-- 子查询在索引上操作，不回表不加行锁
-- 外层只回表 20 行
```

**核心原则**：缩短事务中的锁持有时间。扫描行数越少，持锁时间越短，并发冲突越少。

> 关于分页查询优化的更多细节和性能对比，参见[《MySQL 索引原理与查询优化》](/blog/engineering/middleware/mysql索引原理与查询优化：从b+tree到explain的工程实践)中的"分页查询优化"章节。

---

## 七、工程实践总结

### 场景决策矩阵

| 业务场景 | 推荐隔离级别 | 锁策略 | 注意事项 |
|---------|------------|--------|---------|
| 普通 CRUD | Read Committed | 短事务，尽快提交 | 大多数场景的最佳平衡 |
| 余额扣减 / 库存扣减 | Repeatable Read | `SELECT ... FOR UPDATE` 锁行后更新 | 用主键加锁，避免死锁 |
| 批量数据更新 | Read Committed | 分批提交（每 1000 行 COMMIT 一次） | 控制锁持有范围，避免长事务 |
| 热点行更新（秒杀） | Read Committed | 排队 + 合并写入，而非靠数据库锁硬扛 | 单行高并发更新不是数据库该解决的问题 |
| 对账 / 报表查询 | Read Committed | 不加锁，用 MVCC 快照读 | 不需要强一致，减少锁竞争 |
| 跨服务操作 | — | 参考分布式事务方案 | 不要在分布式场景下依赖数据库事务 |

### 关键原则

**① 事务越短越好**

事务持有锁的时间 = 从加锁到 COMMIT 的时间。在事务中做网络调用、文件操作、复杂计算——都是在延长锁的持有时间，放大冲突概率。

```sql
-- ✗ 坏实践：事务中包含外部调用
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
-- 调用外部支付接口... 200ms
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;
-- id=1 的行被锁住 200ms+

-- ✓ 好实践：先完成外部调用，再开事务
-- 调用外部支付接口... 200ms
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1 AND balance >= 100;
COMMIT;
-- id=1 的行只被锁住几毫秒
```

**② WHERE 条件必须走索引**

没有索引的 UPDATE/DELETE 会锁住全表扫描路径上的所有行。一条看似无害的 UPDATE 可能导致整张表不可写。

**③ 统一加锁顺序**

如果多个事务需要锁多行或多个索引，确保它们按相同的顺序加锁。最简单的做法：永远用主键作为 UPDATE 的 WHERE 条件。

**④ 死锁是正常现象**

在高并发系统中，死锁不可能完全消除。关键是：

- 设计时尽量减少死锁概率（统一顺序、缩短事务）
- 运行时有兜底机制（捕获死锁异常、自动重试）
- 事后能排查根因（开启 `innodb_print_all_deadlocks`、定期分析 `SHOW ENGINE INNODB STATUS`）

> 关于分布式场景下的事务方案（2PC、TCC、Saga、本地消息表等），参见[《分布式系统与事务：从基础到实践》](/blog/engineering/middleware/分布式系统与事务：从基础到实践)。
