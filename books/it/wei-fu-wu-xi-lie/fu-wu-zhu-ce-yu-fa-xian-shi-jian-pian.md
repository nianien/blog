# 服务注册与发现（实践篇）

## 1 服务注册中心 <a href="#scroller-1" id="scroller-1"></a>

前面我们对业内几种比较常见的注册中心做了介绍：Eureka、Zookeeper、Consul、Etcd。

并且在各个指标上做了对比：注册方式（watch\polling）、健康检查、雪崩保护、安全与权限，以及在Spring Cloud、Dubbo、Kubernets上的支持程度。方便我们在不同的场景下做正确的技术选型。

| **指标**             | **Eureka**        | **Zookeeper**   | **Consul**          | **Etcd**            |
| ------------------ | ----------------- | --------------- | ------------------- | ------------------- |
| 一致性协议              | AP                | CP（Paxos算法）     | CP（Raft算法）          | CP（Raft算法）          |
| 健康检查               | TTL(Time To Live) | TCP Keep Alive  | TTL\HTTP\TCP\Script | Lease TTL KeepAlive |
| watch/long polling | 不支持               | watch           | long polling        | watch               |
| 雪崩保护               | 支持                | 不支持             | 不支持                 | 不支持                 |
| 安全与权限              | 不支持               | ACL             | ACL                 | RBAC                |
| 是否支持多数据中心          | 是                 | 否               | 是                   | 否                   |
| 是否有管理界面            | 是                 | 否（可用第三方ZkTools） | 是                   | 否                   |
| Spring Cloud 集成    | 支持                | 支持              | 支持                  | 支持                  |
| Dubbo 集成           | 不支持               | 支持              | 支持                  | 不支持                 |
| K8S 集成             | 不支持               | 不支持             | 支持                  | 支持                  |

我们可以看出，四种技术类型对Spring Cloud的支持度都很高。Spring Cloud是微服务架构的一站式解决方案，我们平时构建微服务的过程中需要做的的如 配置管理、服务发现、负载均衡、断路器、智能路由、控制总线、全局锁、决策竞选、分布式会话和集群状态管理等操作。Spring Cloud 为我们提供了一套简易的编程模型，使我们能在 Spring Boot 的基础上轻松地实现微服务项目的构建。

Spring Cloud包含了多个不同开源产品，来保证一站式的微服务解决方案，如：Spring Cloud Config、Spring Cloud Netflix、Spring Cloud Security、Spring Cloud Commons、Spring Cloud Zookeeper、Spring Cloud CLI等项目。

## 2 Spring Cloud 框架下实现 <a href="#scroller-2" id="scroller-2"></a>

Spring Cloud为服务治理做了一层抽象，这样能够支持多种不同的服务治理框架，比如：Netflix Eureka、Consul。我们这边就以这两个为例子，看看服务治理是如何实现。

> _在Spring Cloud服务治理抽象层的作用下，可以无缝地切换服务治理实现，且不影响任何其他的服务注册、发现、调用逻辑。_
>
> _所以，下面我们通过介绍这两种服务治理的实现来体会Spring Cloud这一层抽象所带来的好处。_

### 2.1 Spring Cloud Eureka <a href="#scroller-3" id="scroller-3"></a>

Spring Cloud Eureka是Spring Cloud Netflix项目下的服务治理模块。而Spring Cloud Netflix项目是Spring Cloud的子项目之一，主要内容是对Netflix公司一系列开源产品的包装，它为Spring Boot应用提供了自配置的Netflix OSS整合。

通过一些简单的注解，开发者就可以快速的在应用中配置一下常用模块并构建庞大的分布式系统。它主要提供的模块包括：服务发现（Eureka），断路器（Hystrix），智能路由（Zuul），客户端负载均衡（Ribbon）等。

下面，就来具体看看如何使用Spring Cloud Eureka实现服务治理。

#### 2.1.1 创建注册中心 <a href="#scroller-4" id="scroller-4"></a>

创建一个Spring Cloud项目，我们命名为micro-service-center，并在`pom.xml`中引入需要的依赖内容：

```xml
1 <packaging>pom</packaging> 
```

表明这个项目中可以没有Java代码，也不执行任何代码，只是为了聚合工程或者传递依赖，所以可以把src文件夹删了。这是一个父级项目，因为我们还要在下面建立Eureka的注册中心、客户端等多个子项目 。

在micro-service-center下，新建一个命名为 eureka-service 的Module，依旧是Spring Cloud 项目，建完之后，pom.xml做如下改动：

```xml
 1 <!--    在子工程中添加父工程名称-->
 2 <parent>
 3     <groupId>com.microservice</groupId>
 4     <artifactId>center</artifactId>
 5     <version>1.0.0</version>
 6 </parent>
 7 
 8 
 9 <dependencies>
10 <!--   加入 eureka 服务 -->
11         <dependency>
12             <groupId>org.springframework.cloud</groupId>
13             <artifactId>spring-cloud-netflix-eureka-server</artifactId>
14         </dependency>
15 </dependencies> 
```

改完之后，回到父项目micro-service-center，修改pom中的信息：

```xml
 1 <groupId>com.microservice</groupId>
 2 <artifactId>center</artifactId>
 3 <packaging>pom</packaging>
 4 <version>1.0.0</version>
 5 <name>center</name>
 6 <description>Demo project for Spring Boot</description>
 7 
 8 <!--    在父工程添加子工程名称-->
 9 <modules>
10    <module>eureka-service</module>
11    <module>eureka-client</module>
12 </modules> 
```

对两个项目进行clean + install，应该是成功的。

eureka-service我们是作为注册中心来用的，所以在它的主类Application中加入`@EnableEurekaServer`注解，就能开启注册中心功能。

```java
1 @SpringBootApplication
2 @EnableEurekaServer
3 public class ServiceApplication {
4     public static void main(String[] args) {
5         SpringApplication.run(ServiceApplication.class, args);
6         System.out.println("Start Eureka Service");
7     }
8 }
```

但是默认情况下，该注册中心也会把自己当做客户端，那就变成自己注册自己了，这个是可以剔除的，我们看一下它的YAML中的详细配置，注释比较清楚：

```yaml
 1 server:
 2   port: 1000
 3 spring:
 4   application:
 5     name: eureka-server
 6 eureka:
 7   instance:
 8     hostname: localhost
 9   client:
10     register-with-eureka: false  # 不作为客户端进行注册
11     fetch-registry: false  # 不获取注册列表
12     service-url:  # 注册地址，客户端需要注册到该地址中
13       defaultZone: http://${eureka.instance.hostname}:${server.port}/eureka/ 
```

文中的注释还是比较清楚的。 这边可以看到，端口号是1000，所以当工程启动之后，访问 [http://localhost:1000/](http://localhost:1000/) 是可以看到Eureka注册中心页面的。其中还没有发现任何服务。

<figure><img src="../.gitbook/assets/image (5) (1).png" alt=""><figcaption></figcaption></figure>

#### 2.1.2 创建客户端 <a href="#scroller-5" id="scroller-5"></a>

目前服务中心还是空的，所以我们创建一个能够提供服务的客户端，并将其注册到注册中心去。

同样的，我们创建一个Spring Cloud的子项目，命名为`eureka-client`，`pom.xml`中的配置如下：

```xml
 1 <!--    在子工程中添加父工程名称-->
 2 <parent>
 3     <groupId>com.microservice</groupId>
 4     <artifactId>center</artifactId>
 5     <version>1.0.0</version>
 6 </parent>
 7 
 8 
 9 <dependencies>
10 
11 <!--    加入 eureka 服务 -->
12 <dependency>
13     <groupId>org.springframework.cloud</groupId>
14     <artifactId>spring-cloud-netflix-eureka-server</artifactId>
15 </dependency>
16 
17 <dependency>
18     <groupId>org.projectlombok</groupId>
19     <artifactId>lombok</artifactId>
20 </dependency>
21 
22 </dependencies> 
```

在应用主类Application文件中通过加上`@EnableDiscoveryClient`注解，该注解保证当前服务被Eureka当成provider发现。

```java
1 @SpringBootApplication
2 @EnableDiscoveryClient
3 public class ClientApplication {
4     public static void main(String[] args) {
5         SpringApplication.run(ClientApplication.class, args);
6         System.out.println("start client!");
7     }
8 } jC
```

在YAML文件上加上如下配置：

```yaml
1 server:
2   port: 1001
3 spring:
4   application:
5     name: eureka-client
6 eureka:
7   client:
8     service-url:  # 这边就保证了注册到 eureka-service 这个注册中心去
9       defaultZone: http://localhost:1000/eureka/ 
```

`spring.application.name`属性，指定了微服务的名称，在调用的时候可以通过该名称进行服务访问。`eureka.client.serviceUrl.defaultZone`属性对应服务注册中心的配置内容，指定服务注册中心的位置。

大家看到，这边端口设置为1001，那是因为要在本机上测试 服务提供方 和 服务注册中心，所以`server的port`属性需设置不同的端口。

最后，我们再写一个接口，通过DiscoveryClient对象，在客户端中获取注册中心的所有服务信息。

```java
 1 @Controller
 2 @RequestMapping("/eurekacenter")
 3 public class EuServiceController {
 4 
 5     @Autowired
 6     DiscoveryClient discoveryClient;
 7 
 8     /**
 9      * 获取注册服务信息
10      */
11     @RequestMapping(value = "/service", method = {RequestMethod.GET})
12     @ResponseBody
13     public String getServiceInfo() {
14        return  "service:"+discoveryClient.getServices()+" , memo:"+discoveryClient.description();
15     }
16 } 
```

这时候跑一下试试看，继续访问之前的地址：[http://localhost:1000/](http://localhost:1000/) ，可以看到Eureka注册中心页面已经包含一个我们定义的服务了，就是上面新建的 1001 端口的服务。

&#x20;

<figure><img src="../.gitbook/assets/image (7).png" alt=""><figcaption></figcaption></figure>

同样，我们可以调用上面的那个获取注册服务信息的接口，从服务发现的角度看看有多少个服务被注册到注册中心去。 [http://localhost:1001/eurekacenter/service](http://localhost:1001/eurekacenter/service)

<figure><img src="../.gitbook/assets/image (30).png" alt=""><figcaption></figcaption></figure>

如上图所示，方括号中的`eureka-client`通过Spring Cloud定义的 getServiceInfo 接口在eureka的实现中获取到的所有服务清单，他是一个String的List，如果注册了多个提供者，就会全部显示。

### 2.2 Spring Cloud Consul <a href="#scroller-6" id="scroller-6"></a>

Consul 用于实现分布式系统的服务发现与配置。与其它分布式服务注册与发现的方案，Consul 的方案更具“一站式”特征，内置了服务注册与发现框 架、分布一致性协议实现、健康检查、Key/Value 存储、多数据中心方案，不再需要依赖其它工具（比如 ZooKeeper 之类的）。

而Spring Cloud Consul ，是将其作为一个整体，在微服务架构中为我们的基础设施提供服务发现和服务配置的工具。

#### 2.2.1 Consul 的优势 <a href="#scroller-7" id="scroller-7"></a>

1、使用 Raft 算法来保证一致性, 比复杂的 Paxos 算法更直接。

2、支持多数据中心，内外网的服务采用不同的端口进行监听。 多数据中心集群可以避免单数据中心的单点故障,而其部署则需要考虑网络延迟, 分片等情况等。 zookeeper 和 etcd 均不提供多数据中心功能的支持，上面表格中有体现。

3、支持健康检查。&#x20;

4、支持 http 和 dns 协议接口。 zookeeper 的集成较为复杂, etcd 只支持 http 协议。

5、官方提供 web 管理界面, etcd 无此功能。

#### 2.2.2 Consul的特性 <a href="#scroller-8" id="scroller-8"></a>

1、服务发现

2、健康检查

3、Key/Value存储

4、多数据中心

#### 2.2.3 安装Consul注册中心 <a href="#scroller-9" id="scroller-9"></a>

1、官方下载64版本 ：[https://www.consul.io/downloads.html](https://www.consul.io/downloads.html)

2、解压后复制到目录 /usr/local/bin 下

3、启动终端，先看下啥版本的

```sh
1 liyifei@MacPro ~ % consul --version
2 Consul v1.10.4
3 Revision 7bbad6fe
4 Protocol 2 spoken by default, understands 2 to 3 (agent will automatically use protocol >2 when speaking to compatible agents) 
```

4、执行安装命令，可以看到他的 Client Addr 的端口为8500。所以访问 8500端口站点，[http://127.0.0.1:8500/ui/dc1/services](http://127.0.0.1:8500/ui/dc1/services)

```sh
 1 liyifei@MacPro ~ % consul agent -dev
 2 ==> Starting Consul agent...
 3            Version: '1.10.4'
 4            Node ID: '6db154b4-62ff-e67d-e745-1a7270fa1ce8'
 5          Node name: 'B000000147796DS'
 6         Datacenter: 'dc1' (Segment: '<all>')
 7             Server: true (Bootstrap: false)
 8        Client Addr: [127.0.0.1] (HTTP: 8500, HTTPS: -1, gRPC: 8502, DNS: 8600)
 9       Cluster Addr: 127.0.0.1 (LAN: 8301, WAN: 8302)
10            Encrypt: Gossip: false, TLS-Outgoing: false, TLS-Incoming: false, Auto-Encrypt-TLS: false 
```

<figure><img src="../.gitbook/assets/image (12).png" alt=""><figcaption></figcaption></figure>

我们可以看到，现在没有客户端注册上来，只有一个自身的实例。

#### 2.2.4 创建服务提供者 <a href="#scroller-10" id="scroller-10"></a>

由于Spring Cloud Consul项目的实现，我们可以轻松的将基于Spring Boot的微服务应用注册到Consul上，并通过此实现微服务架构中的服务治理。

我们在micro-service-center下新建一个cloud项目consul-client，该项目pom文件添加如下：

```xml
 1 <!--    在子工程中添加父工程名称-->
 2 <parent>
 3     <groupId>com.microservice</groupId>
 4     <artifactId>center</artifactId>
 5     <version>1.0.0</version>
 6 </parent>
 7 
 8 <dependencies>
 9 <!--        Consul服务发现-->
10 <dependency>
11     <groupId>org.springframework.cloud</groupId>
12     <artifactId>spring-cloud-starter-consul-discovery</artifactId>
13 </dependency>
14 <!--        Consul健康检查-->
15 <dependency>
16     <groupId>org.springframework.boot</groupId>
17     <artifactId>spring-boot-starter-actuator</artifactId>
18 </dependency>
19 </dependencies>
```

然后修改一下`application.yml的配置信息`，将consul配置写入，注释应该很清楚了，如下：

```yaml
1 spring:
2   application:
3     name: consul-producer # 当前服务的名称
4   cloud:
5     consul: # 以下为Consuk注册中心的地址，如果安装的不是这个host和port，这边可以调整
6       host: localhost
7       port: 8500
8 server:
9   port: 8501 # 当前服务的端口
```

同样的，我们要在应用主类Application文件中通过加上`@EnableDiscoveryClient`注解，该注解保证当前服务被Consul当成provider发现。

大家看到这个做法跟Eureka一样，因为Spring Cloud对服务治理做的一层抽象，所以可以屏蔽Eureka和Consul服务治理的实现细节，

程序上不需要做改变，只需要引入不同的服务治理依赖，并配置相关的配置属性 就能轻松的将微服务纳入Spring Cloud的各个服务治理框架中。

```java
1 @SpringBootApplication
2 @EnableDiscoveryClient
3 public class ConsulClientApplication {
4     public static void main(String[] args) {
5         SpringApplication.run(ClientApplication.class, args);
6     }
7 } 
```

修改完成之后，我们就可以把这个服务提供者启动了，然后再去注册中心查看服务的注册情况，就可以看到被注册进来的Provider（consul-producer）：

<figure><img src="../.gitbook/assets/image (6) (1).png" alt=""><figcaption></figcaption></figure>

## 3 总结 <a href="#scroller-11" id="scroller-11"></a>

除了 Eureka、Consul，还有其他的的注册中心技术，如Zookeeper、Nocas等。但无论何种注册中心技术，本质上都是为了解决微服务中的如下问题：

**解耦服务之间相互依赖的细节**

我们知道服务之间的远程调用必须要知道对方的IP、端口信息。我们可以在调用方直接配置被调用方的IP、端口，这种调用方直接依赖IP、端口的方式存在明显的问题，如被调用的IP、端口变化后，调用方法也要同步修改。&#x20;

通过服务发现，将服务之间IP与端口的依赖转化为服务名的依赖，服务名可以根据具微服务业务来做标识，因此，屏蔽、解耦服务之间的依赖细节是服务发现与注册解决的第一个问题。&#x20;

**对微服务进行动态管理**

在微服务架构中，服务众多，服务之间的相互依赖也错综复杂，无论是服务主动停止，意外挂掉，还是因为流量增加对服务实现进行扩容，这些服务数据或状态上的动态变化，都需要尽快的通知到被调用方，被调用方才采取相应的措施。因此，对于服务注册与发现要实时管理者服务的数据与状态，包括服务的注册上线、服务主动下线，异常服务的剔除。
