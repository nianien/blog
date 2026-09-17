---
title: "Java构件发布到中央仓库"
pubDate: "2024-04-04"
description: "记录 Java 构件通过 OSSRH 发布的历史流程，解释命名空间验证、GPG 签名与 Maven 配置，并补充 OSSRH 关闭后迁移到 Central Publisher Portal 的入口与发布检查。"
tags: ["Maven", "Java", "开源发布"]
---

## 先区分历史流程与当前入口

本文保留作者通过 OSSRH 发布构件的操作记录和截图。OSSRH 已于 **2025 年 6 月 30 日关闭**，命名空间迁移至 Central Publisher Portal；下文的 Jira 工单、旧仓库地址和 Nexus Staging 配置用于理解历史过程，不能照搬为当前发布教程。[Sonatype 关闭与迁移说明](https://central.sonatype.org/pages/ossrh-eol/)

新项目在 Central Portal 验证命名空间、生成发布 token，再按 [官方 Maven 发布指南](https://central.sonatype.org/publish/publish-portal-maven/) 配置 `central-publishing-maven-plugin`。旧项目也可按官方文档使用兼容的 Staging API。发布插件不会自动补齐 sources、Javadoc、签名和必填 POM 元数据，构建时仍需生成并检查这些产物。上传、校验通过、正式发布和搜索可见是不同阶段。

## 历史记录：通过 OSSRH 发布

首先，先说一下大体的步骤：

* 注册Sonatype账号
* 创建Issue，验证域名
* 安装GPG，发布密钥
* 配置Maven，发布构件

这里面比较重要和容易出错的是第二步和第三步，下面一一详细介绍。

#### 1、注册Sonatype账号 <a href="#bojci" id="bojci"></a>

第一步很简单，登录官网，注册账号就好了[Sign up for Jira - Sonatype JIRA](https://issues.sonatype.org/secure/Signup!default.jspa)

注册完成，登陆后的界面如下：

![image_60.png](/images/blog/engineering/practice-image_60.png)

#### 2、创建Issue <a href="#omwqz" id="omwqz"></a>

这里项目选择：Community Support - Open Source Project Repository Hosting (OSSRH)，问题 类型选择：New Project

![image_67.png](/images/blog/engineering/practice-image_67.png)

#### 2.1、补充项目信息

![image_62.png](/images/blog/engineering/practice-image_62.png)

#### 2.2、验证域名 <a href="#snbg0" id="snbg0"></a>

Group ID 通常以已经验证的域名反写命名空间开头。例如拥有 example.com，可以申请 com.example，再发布 com.example.myproject。对应关系例如：

* _example.com -> com.example.domain_
* [www.springframework.org](http://www.springframework.org/) -> org.springframework
* subdomain.example.com -> com.example.subdomain
* github.com/yourusername -> io.github.yourusername
* my-domain.com -> com.my-domain

要想使用某个域名作为Group Id，你需要证明拥有该域名，至于如何证明，详见官方文档：[https://central.sonatype.org/faq/how-to-set-txt-record/](https://central.sonatype.org/faq/how-to-set-txt-record)

如果你没有自己的域名，则可以通过代码托管平台的账号关联子域名。假设你托管平台账户名为myusername，那么你可以通过以下托管平台验证Group Id ：

![image_63.png](/images/blog/engineering/practice-image_63.png)

由于我没有自己的域名，这里我选择使用github账号验证Group Id。点击“新建”按钮，完成提交，之后你的注册邮箱会收到一封邮件，显示创建项目信息：

![image_65.png](/images/blog/engineering/practice-image_65.png)

稍后还会收到一封审核邮件，提示你进行域名验证，时间延迟大概在十分钟以内。

**2.3、人工审核及确认**

![image_66.png](/images/blog/engineering/practice-image_66.png)

我使用的是github账户，按邮件提示，需要在github平台上创建一个指定的临时工程。创建完成之后，可以在issue下面添加评论，触发验证。验证成功后，你会收到一份邮件：

![image_68.png](/images/blog/engineering/practice-image_68.png)

收到上述邮件，就表示完成了Group Id的验证，此时你就可以使用该Group Id或者子Group Id发布Maven构件了。如上，我填写的Group Id是 “io.github.nianien”，因此，我可以使用 “io.github.nianien”或者 “io.github.nianien.xxx” 作为项目的GroupId发布Maven构件。

在通过Maven发布构件之前，我们需要进行Maven配置，这里还需要一些前置工作。

#### 3、安装GPG，创建密钥 <a href="#dcxco" id="dcxco"></a>

GPG 可以通过命令行或图形界面安装；能否发布公钥取决于密钥服务器和网络配置，与是否使用命令行没有必然关系。下面保留当时图形界面的操作记录。私钥留在受控环境，只发布公钥。

* 创建密钥

![image_69.png](/images/blog/engineering/practice-image_69.png)

3.1、发布密钥

![image_70.png](/images/blog/engineering/practice-image_70.png)

发布成功后，收到一份邮件：

![image_71.png](/images/blog/engineering/practice-image_71.png)

按照邮件指示操作，完成密钥发布。密钥发布成功之后，下一步就是配置maven settings.xml和工程pom.xml文件。



#### 4、配置Maven，发布构件 <a href="#amad1" id="amad1"></a>

* 第一步，配置setting.xml文件，添加server节点：

```xml
<settings>
  <servers>
  <server>
    <id>ossrh</id>
    <username>${env.OSSRH_TOKEN_USERNAME}</username>
    <password>${env.OSSRH_TOKEN_PASSWORD}</password>
  </server>
  </servers>
</settings>
```

以上保留历史服务器 ID；当前 Portal 使用其插件对应的服务器 ID 和 Portal token。GPG 口令通过 gpg-agent / pinentry 或构建环境的受控凭据机制提供，不写进项目 POM 或提交到 Git。

* 第二步，配置pom.xml文件，添加必填项

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion><!--已经验证的Group Id-->
    <groupId>io.github.nianien</groupId>
    <artifactId>cudrania</artifactId>
    <version>1.0.1</version><!--必填-->
    <name>io.github.nianien:cudrania</name><!--必填-->
    <description>support tools for java development</description><!--必填-->
    <url>https://github.com/nianien/cudrania</url>
    <properties>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <java.version>17</java.version>
    </properties><!--必填-->
    <licenses>
        <license>
            <name>The Apache Software License, Version 2.0</name>
            <url>https://www.apache.org/licenses/LICENSE-2.0.txt</url>
        </license>
    </licenses><!--必填-->
    <developers>
        <developer>
            <id>nianien</id>
            <name>nianien</name>
            <email>nianien@126.com</email>
        </developer>
    </developers><!--必填-->
    <scm>
        <connection>scm:git:https://github.com/nianien/cudrania.git</connection>
        <developerConnection>scm:git:ssh://git@github.com/nianien/cudrania.git
        </developerConnection>
        <url>https://github.com/nianien/cudrania</url>
    </scm>
    <build>
        <pluginManagement>
            <plugins>
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-compiler-plugin</artifactId>
                    <version>3.11.0</version>
                    <configuration>
                        <source>${java.version}</source>
                        <target>${java.version}</target>
                    </configuration>
                </plugin>
                <plugin><!--必填-->
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-source-plugin</artifactId>
                    <version>3.3.0</version>
                    <executions>
                        <execution>
                            <id>attach-sources</id>
                            <goals>
                                <goal>jar-no-fork</goal>
                            </goals>
                        </execution>
                    </executions>
                </plugin>
                <plugin><!--必填--> 
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-javadoc-plugin</artifactId>
                    <version>3.5.0</version>
                    <executions>
                        <execution>
                            <id>attach-javadocs</id>
                            <goals>
                                <goal>jar</goal>
                            </goals>
                            <configuration>
                                <additionalparam>
                                    -Xdoclint:none
                                </additionalparam>
                            </configuration>
                        </execution>
                    </executions>
                </plugin><!--必填-->
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-gpg-plugin</artifactId>
                    <version>3.1.0</version>
                    <executions>
                        <execution>
                            <id>sign-artifacts</id>
                            <phase>verify</phase>
                            <goals>
                                <goal>sign</goal>
                            </goals>
                        </execution>
                    </executions>
                </plugin>
            </plugins>
        </pluginManagement>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-source-plugin</artifactId>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-javadoc-plugin</artifactId>
            </plugin>
        </plugins>
    </build>

    <profiles><!--必填-->
        <profile>
            <id>ossrh</id>
            <build>
                <plugins>
                    <plugin><!--必填-->
                        <groupId>org.sonatype.plugins</groupId>
                        <artifactId>nexus-staging-maven-plugin</artifactId>
                        <version>1.6.13</version>
                        <extensions>true</extensions>
                        <configuration>
                            <serverId>ossrh</serverId>
                            <nexusUrl>https://s01.oss.sonatype.org/</nexusUrl> 
                          <autoReleaseAfterClose>true</autoReleaseAfterClose>
                        </configuration>
                    </plugin>
                    <plugin><!--必填-->
                        <groupId>org.apache.maven.plugins</groupId>
                        <artifactId>maven-gpg-plugin</artifactId>
                    </plugin>
                </plugins>
            </build><!--必填-->
            <distributionManagement>
                <snapshotRepository>
                    <id>ossrh</id>
                  <url>https://s01.oss.sonatype.org/content/repositories/snapshots
                    </url>
                </snapshotRepository>
                <repository>
                    <id>ossrh</id>
                    <url>https://s01.oss.sonatype.org/service/local/staging/deploy/maven2/
                    </url>
                </repository>
            </distributionManagement>
        </profile>
    </profiles>

    <dependencies><!--maven依赖--></dependencies>

</project>
```

上面是当时使用的 POM 示例，包含项目坐标、许可证、开发者信息、源码地址，以及构建和发布插件。当前迁移时保留适用的项目元数据，并替换旧发布插件和地址。

需要说明的是，为了不用默认打包冲突，专门定义了用于发布中央仓库的profile：ossrh，这里只需要添加额外的两个插件：nexus-staging-maven-plugin和maven-gpg-plugin，前者用于jar上传，后者用于密钥签名。

* 第三步，执行maven命令，发布构件

配置好pom文件，可以执行maven命令：“mvn clean deploy -Possrh” 进行发布。如果版本号带SNAPSHOT后缀，会发布到snapshots仓库，否则发布到release仓库。

这里nexus-staging-maven-plugin插件有一个配置项：autoReleaseAfterClose，如果设置为true的话，推送完成会自动release。第一次发布成功后，会收到一封邮件：

![image_72.png](/images/blog/engineering/practice-image_72.png)

* _**最后，让jar包更快的在中央仓库被搜索到**_

根据邮件提示，Jar包成功发布成功后，大约30分钟后会推到中央仓库，我们可以从仓库地址看到我们发布的Jar包：[https://repo1.maven.org/maven2/](https://repo1.maven.org/maven2)

![image_73.png](/images/blog/engineering/practice-image_73.png)

此时，其他项目就可以通过maven依赖引用我们的构件了，但是这时候通过中央仓库仍然搜不到我们的Maven构件。按照邮件提示可能会需要四小时，实际情况是我等了5个小时依然搜不到。如果遇到这种情况，我们可以通过在对issue添加评论反馈，会有人工回复进行解决：

![image_74.png](/images/blog/engineering/practice-image_74.png)

另外，关于mvnrepository与Maven Central的关系，有人咨询，官方也做了解答：

![image_75.png](/images/blog/engineering/practice-image_75.png)

根据我的实际经验判断，mvnrepository应该是定时同步的，我发布成功后，第二天才能搜到：

![image_76.png](/images/blog/engineering/practice-image_76.png)

下面是官方指导文档，介绍非常详细，基本上不用在网上搜索其他教程了。

#### 官方参考文档 <a href="#dzquo" id="dzquo"></a>

[https://central.sonatype.org/publish/publish-guide/](https://central.sonatype.org/publish/publish-guide)
