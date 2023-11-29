---
description: >-
  你有没有因为应用程序没有打印SQL而导致问题排查困难？有没有因为SQL没有显示参数而导致日志毫无意义？有没有因为SQL超长而导致查看痛苦？有没有因为缺少SQL性能监控而导致无法报警？
---

# 非侵入式SQL监控

你有没有遇到过因为没有打印SQL导致问题排查困难？如果你使用了成熟ORM框架，那么很容易支撑SQL的拦截和监控，例如Mybatis的Interceptor或JOOQ的Listener都支持SQL执行过程的跟踪监控，但是，如果你的ORM框架不支持SQL监控，那么很不幸，你就只能在代码中手动打印日志了。然而，为了防SQL注入，应用中的SQL语句都是参数化的，直接打印的话，SQL语句未绑定参数，ORM框架一般都提供了SQL参数绑定的功能，原生的JDBC这样就失去了一定的监控价值。

另外，在TOB的业务中，有些场景SQL参数超长，如大IN查询，SQL语句会长达到几万甚至十几万，此时，我们又需要对SQL语句进行缩略打印。注意，这里的SQL缩略打印不是简单的对SQL语句进行截断，而是对SQL语句中的参数列表进行截断，例如下面的SQL

\


```
select * from user 
where id in (1001,1001, 1002, 1003, 1004, 1005, 1006, 1007) 
and name in(
select name from whitelist 
where name in('a','b','c','d','e','f','g','h','i','j','k','l','m')
)
```

缩略下印如下：

\


```
select * from user 
where id in (1001,1001, 1002, 1003, 1004,...) 
and name in(
select name from whitelist 
where name in('a','b','c','d','e',...)
)
```

既然SQL 监控很重要，那么对于应用层的SQL监控都有哪些手段呢？一个SQL请求的执行链路，一般从DAO层开始：DAO -> ORM -> DataSource  -> Connection -> Driver -> DB，那么在这个链路上有哪些环节可以切入监控呢？ DAO层是数据访问层的入口，而我们的目标是应用层监控，因此，能够实现SQL监控的环节只有：ORM -> DataSource  -> Connection -> Driver，而要实现通用的非侵入式监控，则应该独立于ORM，因此我们可以从**DataSource  -> Connection -> Driver**三个环节进行入手：

### **一、SQL Profile监控**

#### **1、驱动层监控**

如果Driver层支持日志监控，则最方便，例如MySQL，可以在jdbc url中添加logger：_jdbc:mysql://localhost:3306/test?useUnicode=true\&characterEncoding=utf8\&useSSL=false\&serverTimezone=UTC\&logger=Slf4JLogger\&profileSQL=true_

基于Driver监控的问题在于：一方面强依赖于DB，和ORM层面临一样的问题，不具有通用性上述的问题，且需要厂商的支持，例如Oracle Driver就不支持日志监控；另一方面SQL格式固定，无法进行定制化输出。

\


#### **2、连接层监控**

如果厂商驱动不支持SQL日志，可以Driver进行代理实现SQL监控功能，常用的开源组件如[P6Spy](https://p6spy.readthedocs.io/en/latest/)、[log4jdbc](https://github.com/arthurblake/log4jdbc) 等，其原理都是代理了厂商的驱动，因此只需要修改jdbc url：

* pyspy

_jdbc:p6spy:mysql://localhost:3306/test?useUnicode=true\&characterEncoding=utf8\&useSSL=false\&serverTimezone=UTC_

* log4jdbc

_jdbc:log4jdbc:mysql://localhost:3306/test?useUnicode=true\&characterEncoding=utf8\&useSSL=false\&serverTimezone=UTC_

#### **3、数据源层监控**

可以通过对DataSource进行代理实现SQL监控

* P6Spy：

```
@Bean
@Primary
public DataSource spyDataSource(@Autowired DataSource dataSource) {
  // wrap a datasource using P6SpyDataSource
  ﻿return new P6DataSource(dataSource);
}
```

* log4jdbc

```
public DataSource spyDataSource(DataSource dataSource) {
    // wrap the provided dataSource
  ﻿return new DataSource() {
    @Override
    ﻿public Connection getConnection() throws SQLException {
      // wrap the connection with log4jdbc
      ﻿return new ConnectionSpy(dataSource.getConnection());
    }
      
    @Override
    ﻿public Connection getConnection(String username, String password) throws SQLException {
       // wrap the connection with log4jdbc
      ﻿return new ConnectionSpy(dataSource.getConnection(username, password));
     }
      //...
  };
}
```

上述三种方案都可以实现SQL监控，那么在实际应用场景中选择哪种方式更好呢？这和实际的生产方式有关。在我手，数据库是基于KDB的，Java应用是基于KsBoot，其中，数据库连接是在KDB平台配置的，底层的数据源是使用ShardingSphere+HikariDataSource进行魔改的。

第一种方案，由于数据库连接是由DBA维护的，升级需求修改数据库连接，因此不建议。

第二种方案，同理需要修改数据库连接，且比第一种更容易配错，因此也不建议。

排除上述两种方式，剩下的只有第三种方案了，但是第三种方案有很大的挑战，原因在于需要兼容快手kuaishou-framework奇葩的JdbcTemplate使用方式，确切地说，在于使用了DataSourceConfig。

```
public interface DataSourceConfig extends HasBizDef, WarmupAble {

    /**
     * 数据源名称，必须与KDB申请时填写的一致
     */String bizName();

    /**
     * Warmuper对象，用于warmup dataSource资源
     */@NonnullWarmuper warmuper();

    /**
     * 获取当前可用区单库只读的JdbcTemplate
     */default NamedParameterJdbcTemplate read() {
        return InternalDatasourceConfig.readForceAz(this, currentAz(), currentPaz(), "read");
    }   

    /**
     * 获取当前可用区单库读写的JdbcTemplate
     */default NamedParameterJdbcTemplate write() {
        return InternalDatasourceConfig.writeForceAz(this, currentAz(), currentPaz(), "write");
    }	
  //....
}
```

DefaultDataSourceConfig是一个接口类，默认封装了NamedParameterJdbcTemplate的创建，业务方通过继承该接口来定义数据源:

```
public final enum class AdDataSources private constructor(forTest: AdDataSources? = COMPILED_CODE, usingNewZk: kotlin.Boolean = COMPILED_CODE, bizDef: BizDef = COMPILED_CODE) : kotlin.Enum<AdDataSources>, DataSourceConfig {
  adFansTopProfileDashboardTest,

  adFansTopProfileDashboard,

  adChargeTest,

  adCharge,

  adChargeReadOnly,

  adDspReadOnlyTest,

  adDspReadOnly,
  //more datasource

  public companion object {
    private final val map: Map<kotlin.String, AdDataSources> /* compiled code */

   public final fun fromBizName(bizName: kotlin.String):AdDataSources? { /* compiled code */ }
  }

  private final val bizDef: BizDef /* compiled code */

  private final val forTest: AdDataSources? /* compiled code */

  private final val usingNewZk: kotlin.Boolean /* compiled code */

  public open fun bizDef(): BizDef { /* compiled code */ }

  public open fun bizName(): kotlin.String { /* compiled code */ }

  public open fun usingNewZk(): kotlin.Boolean { /* compiled code */ }
}
```

如果在业务中直接使用了DataSourceConfig创建的NamedParameterJdbcTemplate，那么我们就需要修改过程中创建的DataSource对象。那么，这里的DataSource究竟是怎么创建的呢？

具体扒代码的过程就不赘述了，直接说结果吧，kuaishou-framework的数据源最终是通过DataSourceFactory进行创建的，具体代码如下：

```
public static ListenableDataSource<Failover<Instance>> create(Instance i) {
   //...
   ﻿try {
       return supplyWithRetry(
        DATA_SOURCE_BUILD_RETRY,
        DATA_SOURCE_BUILD_RETRY_DELAY,
        () -> new ListenableDataSource<>(
              bizName, 
              new HikariDataSource(config), ds -> i.toString(), i),
              DataSourceFactory::needRetry);
                               
  } catch (Throwable e) {/**/}
}
```

由代码可以看到，这里的数据源实际上是通过new HikariDataSource(config)手动创建的，而DataSourceConfig又没有对外暴露创建的数据源，所以，我们该如何对DataSource代理呢?

### **二、动态修改加载类**

成本最低的方式就是直接修改这段代码，将其中的_new HikariDataSource(config)_修改成_new P6DataSource(new HikariDataSource(config))，_那么问题来了，这段代码属于基础组件包中的代码，基础架构组没有动力去修改，而我们又没有修改的权限，要想动这块代码，只能使用黑科技了。黑科技的手段有很多，那么问题又来了，哪种手段更合适呢？

首先我们来分析一下，有哪些手段可以修改Java字节码？

* 方案一、编译时修改，需要开发maven插件

（不使用maven插件的同学咋办？）

* 方案二、加载时修改，重写类加载器

需要在代码中指定特定的类加载器，用有一定的侵入式

* 方案三、运行时修改，使用JavaAgent

需要修改应用启动参数，运维成本有点高

首先要说明的是，这里不是对类方法进行增强，所以想使用cglib动态代理的想法是不可行的。前面三种方案都有一定的局限性：方案一比较麻烦，方案二侵入性强，方案三则需要使用JavaAgent技术，那有没有方案不使用Agent就可以动态修改已经加载的字节码呢？答案是没有，至少理论上没有。不过，好在天无绝人之路，JDK9之后，可以动态启动JavaAgent，这样就不用修改启动参数了。这里，我们选择使用byte-buddy进行字节码重写。

_下面是对动态启动Java Agent技术的解释_

> Note that starting with Java 9, there is the Launcher-Agent-Class manifest attribute for jar files that can specify the class of a Java Agent to start before the class specified with the Main-Class is launched. That way, you can easily have your Agent collaborating with your application code in your JVM, without the need for any additional command line options. The Agent can be as simple as having an agentmain method in your main class storing the Instrumentation reference in a static variable.

> See [the java.lang.instrument package documentation](https://docs.oracle.com/en/java/javase/15/docs/api/java.instrument/java/lang/instrument/package-summary.html#package.description)…

> Getting hands on an Instrumentation instance when the JVM has not been started with Agents is trickier. It must support launching Agents after startup in general, e.g. via the Attach API. [This answer](https://stackoverflow.com/a/19912148/2711488) demonstrates at its end such a self-attach to get hands on the Instrumentation. When you have the necessary manifest attribute in your application jar file, you could even use that as agent jar and omit the creation of a temporary stub file.

> However, recent JVMs forbid self-attaching unless -Djdk.attach.allowAttachSelf=true has been specified at startup, but I suppose, taking additional steps at startup time, is precisely what you don’t want to do. One way to circumvent this, is to use another process. All this process has to to, is to attach to your original process and tell the JVM to start the Agent. Then, it may already terminate and everything else works the same way as before the introduction of this restriction.

> As mentioned in [this comment](https://stackoverflow.com/questions/56787777/?noredirect=1\&lq=1#comment100160373\_56787777), Byte-Buddy has already implemented those necessary steps and the stripped-down Byte-Buddy-Agent contains that logic only, so you can use it to build your own logic atop it.

* 字节码工具对比

\


\


![](https://static.yximgs.com/udata/pkg/EE-KSTACK/4223630ea14c6367968188fd52cafa26.png)

\


* 使用bytebuddy修改字节码

在实现代码之前，我们回过头来再看一下快手的数据源生成：

_new ListenableDataSource<>(bizName, new HikariDataSource(config), ds -> i.toString());_

这里实际生成的数据源类型是ListenableDataSource，而ListenableDataSource刚好继承了DelegatingDataSource类，而DelegatingDataSource的构造方法如下：

\


```
public class DelegatingDataSource implements DataSource {
   //...
  ﻿public DelegatingDataSource(DataSource targetDataSource) {
    this.setTargetDataSource(targetDataSource);
   }

  public void setTargetDataSource(@Nullable DataSource targetDataSource) {
      this.targetDataSource = targetDataSource;
  }
  //...
}
```

因此，我们可以通过改写DelegatingDataSource#setTargetDataSource方法，实现同样的效果，修改后的方法应该如下：

\


```
public void setTargetDataSource(@Nullable DataSource targetDataSource) {
        this.targetDataSource = new P6DataSource(targetDataSource;
}
```

那么具体如何修改字节码呢？这里是[官方文档](https://bytebuddy.net/#/tutorial)，原理我们不做赘述，直接介绍实现了。实现方式有三种：

#### **1、类文件替换**

假设你已经通过Java代码编译了新的类，现在要替换JVM中类的定义，代码如下：

```
//
new ByteBuddy()
  .redefine(NewDelegatingDataSource.class)
  .name(DelegatingDataSource.class.getName())
  .make()
  .load(Thread.currentThread().getContextClassLoader(), 
        ClassReloadingStrategy.fromInstalledAgent());
```

#### **2、操作字节码：**

\


```
new ByteBuddy()
    .redefine(DelegatingDataSource.class)
    //重写DelegatingDataSource#setTargetDataSource方法
    .method(named("setTargetDataSource"))
    .intercept(MyImplementation.INSTANCE)
    .make()
    .load(Thread.currentThread().getContextClassLoader(),
          ClassReloadingStrategy.fromInstalledAgent());

enum MyImplementation implements Implementation {

INSTANCE; // singleton

  @Overridepublic InstrumentedType prepare(InstrumentedType instrumentedType) {
  return instrumentedType;
  }
  
  @Overridepublic ByteCodeAppender appender(Target implementationTarget) {
  return MyAppender.INSTANCE;
  }
  
}
//字节码定义
enum MyAppender implements ByteCodeAppender {

INSTANCE; // singleton

@Override
﻿public Size apply(MethodVisitor methodVisitor,
        Implementation.Context implementationContext,
        MethodDescription instrumentedMethod) {
  Label label0 = new Label();
  methodVisitor.visitLabel(label0);
  methodVisitor.visitLineNumber(70, label0);
  methodVisitor.visitVarInsn(ALOAD, 0);
  methodVisitor.visitTypeInsn(NEW, "com/p6spy/engine/spy/P6DataSource");
  methodVisitor.visitInsn(DUP);
  methodVisitor.visitVarInsn(ALOAD, 1);
  methodVisitor.visitMethodInsn(INVOKESPECIAL, "com/p6spy/engine/spy/P6DataSource", "<init>", "(Ljavax/sql/DataSource;)V", false);
  methodVisitor.visitFieldInsn(PUTFIELD, "org/springframework/jdbc/datasource/DelegatingDataSource", "targetDataSource", "Ljavax/sql/DataSource;");
  Label label1 = new Label();
  methodVisitor.visitLabel(label1);
  methodVisitor.visitLineNumber(71, label1);
  methodVisitor.visitInsn(RETURN);
  Label label2 = new Label();
  methodVisitor.visitLabel(label2);
  methodVisitor.visitLocalVariable("this", "Lorg/springframework/jdbc/datasource/DelegatingDataSource;", null, label0, label2, 0);
  methodVisitor.visitLocalVariable("targetDataSource", "Ljavax/sql/DataSource;", null, label0, label2, 1);
  methodVisitor.visitMaxs(4, 2);
  return new Size(4, 2);
  }
}
```

上述代码的核心思想是字节操作字节码，操作字节码是非常复杂和繁重的事情，且无法debug，那么有没有比较方便的方式呢？

我们可以手动改写Java代码，然后利用插件生成对应的字节码，然后在其基础上进行修改，研发成本会低很多。这里推荐IDEA的一个插件：Byte-Code-Analyzer，使用该插件可以查看类对应的ASM字节码，

\


\


![](https://static.yximgs.com/udata/pkg/EE-KSTACK/e31962a90f6598880e78d8254d6c74d9)

\


#### **3、利用byte-buddy的Advice**

\


```
 public static void redefine() {
   new ByteBuddy()
     .redefine(DelegatingDataSource.class)
     .visit(Advice.to(Decorator.class)
            .on(ElementMatchers.named("setTargetDataSource")))
     .make()
     .load(Thread.currentThread().getContextClassLoader(),
           ClassReloadingStrategy.fromInstalledAgent()).getLoaded();
 }

static class Decorator {

  //在方法开始插入代码
  @Advice.OnMethodEnter
    public static void enter(@Advice.Argument(value = 0, readOnly = false) DataSource dataSource) {
    dataSource = new P6DataSource(dataSource);
  }
}
```

byte-buddy的Advisor和动态代理的原理不一样，他是直接修改方法体的字节码，上面的方法就是表示在方法开始插入一行，其效果如下：

\


```
public void setTargetDataSource(@Nullable DataSource targetDataSource) {
  //插入的代码
  targetDataSource = new P6DataSource(targetDataSource);
  this.targetDataSource = targetDataSource;
}
```

注：

1. 动态修改已加载的类，是有限制条件的，不能添加方法或者字段，因此通过byte-buddy的Methoddelegation方法修改字节码是不可行的。
2. 使用byte-buddy的Advice，可以对非Spring托管的类进行动态增强，因为是直接修改字节码，性能更好。

### **三、自动生效**

前面我们讲了如何修改字节码，以提供SQL监控功能，那么如何让SQL监控自动生效呢？我们的目标是非侵入式解决方案：既不能修改业务代码，也不能更改系统配置。鉴于Java世界的事实标准，我们利用了SpringBoot-Starter功能，只需增加一个maven依赖，就自动提供了SQL监控能力。

\


```
<dependency>
  ﻿<groupId>com.kuaishou.ad</groupId>
  ﻿<artifactId>sqllog-spring-boot-starter</artifactId>
  ﻿<version>制品库查询最新版</version>
﻿</dependency>
```

至于SpringBoot-Starter的实现原理，网上资料很多，核心思想就是提供默认配置，开箱即用。需要注意的是，Spring6.0自动配置的方案有了调整，原来基于spring.factories的配置改成了org.springframework.boot.autoconfigure.AutoConfiguration.imports，原有的方式还支持，这对应普通应用没有影响，但是在实现Spring多容器隔离的方案上有一定的影响，后面有时间会展开讲一下。

```
private static String[] getConfigurations(File file) {
  @EnableAutoConfiguration
  class NoScan {
    //用于扫描META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports,该类定义在方法中,是为了避免扫描当前类时被加载
  }
  FileClassLoader classLoader = new FileClassLoader(file);
  AutoConfigurationImportSelector selector = new AutoConfigurationImportSelector();
  selector.setBeanClassLoader(classLoader);
  selector.setResourceLoader(new ClassLoaderResourcePatternResolver(classLoader));
  selector.setEnvironment(new StandardEnvironment());
  String[] configurations = selector.selectImports(new StandardAnnotationMetadata(NoScan.class));
  return configurations;
}
```

\


### **四、SQL打印效果**

sqllog-spring-boot-starter默认基于p6spy，并对SQL输出提供了扩展，打印SQL日志如下：

\


\


![](https://static.yximgs.com/udata/pkg/EE-KSTACK/28cd44d1451c960cfb982773aab6ec44)

\


SQL的打印内容分为三部分：

第一行，显示执行时间、耗时、SQL操作、数据库连接等信息

第二行，显示参数化SQL

第三行，显示绑定参数后的实际执行的SQL

通过日志看到，当SQL语句超长时，系统会对参数化SQL进行个性化缩略，而对实际执行的SQL，则保持原样输出，这样可以检索关键信息。
