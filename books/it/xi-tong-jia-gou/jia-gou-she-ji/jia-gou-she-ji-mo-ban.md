# 架构设计模板

最近一年的时间内，我参与了很多后端基础组件的设计、重构、重写、微服务化等工作，写了很多设计文档、与同事开了很多次技术研讨会，一直以来没有总结一套工作模板，以至于在开会时总有遗漏。今天我的朋友分享给了我一套架构设计模板，我针对文档做了一些总结，分享给大家：

总体来说，一个完善的设计需要考虑一下 11 个方面：

1. 需求介绍
2. 架构总览
3. 核心流程
4. 详细设计
5. 高可用设计
6. 高性能设计
7. 可扩展设计
8. 安全设计
9. 其他设计
10. 部署方案
11. 架构演进规划

这 11 条既可以作为我们写设计文档时的 CheckList，也可以直接用来做题纲，下面我们详细说说具体要做什么。

### 1. 需求介绍 <a href="#xu-qiu-jie-shao" id="xu-qiu-jie-shao"></a>

需求介绍主要描述需求的背景、以及新系统想要达成的目标。\
比如我在设计公司`用户动态与Websocet`业务时提到：旧动态系统延迟过高、进程池进程数量有限，有时会出现任务卡死的情况，需要手动重启系统才能暂时恢复（不能根治），导致用户动态推送业务极不稳定。新系统的目标是为了改善这一情况，保障动态业务稳定性。\
再比如我在设计公司自动化部署在线文档时提到：旧文档由各个开发人员在本地生成，上传到 Git 时可能有冲突、且不方便人员查看，所以准备部署一个在线文档，开发人员编写好文档后自动生成在线文档，方便查阅。\
总结就是三个关键点：哪里有问题、想怎么解决问题、能达到什么效果。

### 2. 架构总览 <a href="#jia-gou-zong-lan" id="jia-gou-zong-lan"></a>

架构总览的**核心内容是架构图**，以及针对架构图的描述，包括模块或者子系统的职责描述、核心流程。

> 架构图的画法没有严格要求，唯一的要求就是易懂。个人建议 Figma 和 ProcessOn 二者结合使用。

可以给大家瞧瞧我当初做 Wordpress 站点 CDN 优化的架构图：\


<figure><img src="https://www.kaolengmian7.com/app/imgs/architecture/architecture_design_template/1.png" alt=""><figcaption></figcaption></figure>

再给大伙看看我利用 Github Action、DroneCI/CD、Docker、K8s 做的自动化在线文档：\


<figure><img src="https://www.kaolengmian7.com/app/imgs/architecture/architecture_design_template/2.png" alt=""><figcaption></figcaption></figure>

有了架构图的支撑，会大大降低技术研讨会讲解的难度，非常实用。

### 3. 核心流程 <a href="#he-xin-liu-cheng" id="he-xin-liu-cheng"></a>

核心流程的主要任务是针对上面的架构图讲解各个关键组件是如何工作的、数据的流向与处理方式等等，复杂的业务最好给出**时序图。**\
**个人认为架构图和时序图是最重要的两个图，让整个系统结构和处理逻辑一目了然，配合口头讲解非常易懂。**

### 4. 详细设计 <a href="#xiang-xi-she-ji" id="xiang-xi-she-ji"></a>

对于一些比较复杂的小组件 or 小设计，需要额外写一些详细设计文档，降低同事理解代码的成本。\
比如我在设计分布式唯一 Id 生成器时详细介绍了`双Buffer优化`这个小设计：\
![image.png](https://www.kaolengmian7.com/app/imgs/architecture/architecture\_design\_template/3.png)

1. id 容器采用双 buffer 实现，目的是防止某一个请求进来恰巧桶内没数据需要请求 mysql 从而造成高延迟的情况。（buffer 容量可配置）
2. 双 buffer 的切换逻辑为：当前承担发号任务的 buffer 余额 < 20%，休息状态的 buffer 已经填充完毕（isReady）。

### 5. 高可用设计 <a href="#gao-ke-yong-she-ji" id="gao-ke-yong-she-ji"></a>

讲解系统设计是怎样考虑高可用这个指标的。比如数据库宕机怎么办？数据一致性如何处理？数据丢失怎么办？缓存的方案？出Bug如何补救？如何 Debug、如何排查线上问题？性能指标、业务指标监控该怎么做？\
这块内容的要诀有两个：一是要结合具体情况，二是要多积累经验。

### 6. 高性能设计 <a href="#gao-xing-neng-she-ji" id="gao-xing-neng-she-ji"></a>

讲解系统设计是怎样考虑高性能这个指标的。此外还可以提一提压力测试计划、目标 QPS 等等。

### 7. 可扩展性设计 <a href="#ke-kuo-zhan-xing-she-ji" id="ke-kuo-zhan-xing-she-ji"></a>

讲解系统设计是怎样考虑扩展性这个指标的。

### 8. 安全设计 <a href="#an-quan-she-ji" id="an-quan-she-ji"></a>

比如权限控制。如果没有可以填“无”，但是不能不写，这表明我们是有考虑安全性的，在研讨会时说不定有同事会补充。

### 9. 其他设计 <a href="#qi-ta-she-ji" id="qi-ta-she-ji"></a>

可以写一写使用的语言、框架、库等等。也可以是公司团队内部的一些规范。

### 10. 部署方案 <a href="#bu-shu-fang-an" id="bu-shu-fang-an"></a>

现在基本上都是 K8s 部署，可以讲讲是用 Stateful 部署还是用 Deployment 部署。副本数量设计，生产环境多少个副本、灰度环境多少个、测试环境多少个。

### 11. 架构演进计划 <a href="#jia-gou-yan-jin-ji-hua" id="jia-gou-yan-jin-ji-hua"></a>

如果是小项目不用写，如果是大型项目那大概率不能一下子全部完成。这时候就要分步骤、分期实现。可以写写第一期要实现 xxx、第二期要 xxx 类似这样的目标。
