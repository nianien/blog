# Java构件发布到中央仓库

_首先强调一下，Maven中央仓库并不支持直接发布jar包。我们需要将jar包发布到一些指定的第三方Maven仓库，然后该仓库再将jar包同步到Maven中央仓库。其中，最”简单”的方式是通过_[Sonatype OSSRH](https://central.sonatype.org/pages/ossrh-guide.html)_仓库来发布jar包。所以，接下来主要介绍如何将jar包发布到Sonatype OSSRH。_

首先，先说一下大体的步骤：

* 注册Sonatype账号
* 创建Issue，验证域名
* 安装GPG，发布密钥
* 配置Maven，发布构件

这里面比较重要和容易出错的是第二步和第三步，下面一一详细介绍。

#### 1、注册Sonatype账号 <a href="#bojci" id="bojci"></a>

第一步很简单，登录官网，注册账号就好了[Sign up for Jira - Sonatype JIRA](https://issues.sonatype.org/secure/Signup!default.jspa)

注册完成，登陆后的界面如下：

<figure><img src="../.gitbook/assets/image (60).png" alt=""><figcaption></figcaption></figure>

#### 2、创建Issue <a href="#omwqz" id="omwqz"></a>

这里项目选择：Community Support - Open Source Project Repository Hosting (OSSRH)，问题 类型选择：New Project

<figure><img src="../.gitbook/assets/image (67).png" alt=""><figcaption></figcaption></figure>

#### 2.1、补充项目信息

<figure><img src="../.gitbook/assets/image (62).png" alt=""><figcaption></figcaption></figure>

#### 2.2、验证域名 <a href="#snbg0" id="snbg0"></a>

我们需要使用域名作为Group Id，如果你拥有域名_example.com，则能够使用com.example开头作为Group Id，例如：com.example.myproject。其他一些栗子如下：_

* _example.com -> com.example.domain_
* [www.springframework.org](http://www.springframework.org/) -> org.springframework
* subdomain.example.com -> example.com
* github.com/yourusername -> io.github.yourusername
* my-domain.com -> com.my-domain

要想使用某个域名作为Group Id，你需要证明拥有该域名，至于如何证明，详见官方文档：[https://central.sonatype.org/faq/how-to-set-txt-record/](https://central.sonatype.org/faq/how-to-set-txt-record)

如果你没有自己的域名，则可以通过代码托管平台的账号关联子域名。假设你托管平台账户名为myusername，那么你可以通过以下托管平台验证Group Id ：

<figure><img src="../.gitbook/assets/image (63).png" alt=""><figcaption></figcaption></figure>

由于我没有自己的域名，这里我选择使用github账号验证Group Id。点击“新建”按钮，完成提交，之后你的注册邮箱会收到一封邮件，显示创建项目信息：

<figure><img src="../.gitbook/assets/image (65).png" alt=""><figcaption></figcaption></figure>

稍后还会收到一封审核邮件，提示你进行域名验证，时间延迟大概在十分钟以内。

**2.3、人工审核及确认**

<figure><img src="../.gitbook/assets/image (66).png" alt=""><figcaption></figcaption></figure>

我使用的是github账户，按邮件提示，需要在github平台上创建一个指定的临时工程。创建完成之后，可以在issue下面添加评论，触发验证。验证成功后，你会收到一份邮件：

<figure><img src="../.gitbook/assets/image (68).png" alt=""><figcaption></figcaption></figure>

收到上述邮件，就表示完成了Group Id的验证，此时你就可以使用该Group Id或者子Group Id发布Maven构件了。如上，我填写的Group Id是 “io.github.nianien”，因此，我可以使用 “io.github.nianien”或者 “io.github.nianien.xxx” 作为项目的GroupId发布Maven构件。

在通过Maven发布构件之前，我们需要进行Maven配置，这里还需要一些前置工作。

#### 3、安装GPG，创建密钥 <a href="#dcxco" id="dcxco"></a>

安装GPG的方式有多种，这里推荐图形化安装，因为通过命令行安装，由于找不到合适的密钥服务器，发布密钥时会失败。这里给出Mac版本的下载地址：[https://releases.gpgtools.org/GPG\_Suite-2022.1.dmg](https://releases.gpgtools.org/GPG\_Suite-2022.1.dmg)

* 创建密钥

<figure><img src="../.gitbook/assets/image (69).png" alt=""><figcaption></figcaption></figure>

3.1、发布密钥

<figure><img src="../.gitbook/assets/image (70).png" alt=""><figcaption></figcaption></figure>

发布成功后，收到一份邮件：

<figure><img src="../.gitbook/assets/image (71).png" alt=""><figcaption></figcaption></figure>

按照邮件指示操作，完成密钥发布。密钥发布成功之后，下一步就是配置maven settings.xml和工程pom.xml文件。



#### 4、配置Maven，发布构件 <a href="#amad1" id="amad1"></a>

* 第一步，配置setting.xml文件，添加server节点：

{% code overflow="wrap" lineNumbers="true" fullWidth="false" %}
```xml
<servers>
<server>
    <id>ossrh</id>
    <username>sonatype账户名</username>
    <password>sonatype账户密码</password>
</server>
</servers>
<profile>
  <id>ossrh</id>
  <properties>
    <gpg.executable>gpg</gpg.executable>
    <gpg.passphrase>创建密钥时使用的密码</gpg.passphrase>
    <gpg.homedir>/Users/yourname/.gnupg</gpg.homedir>
   </properties>
</profile>
```
{% endcode %}

* 第二步，配置pom.xml文件，添加必填项

{% code overflow="wrap" lineNumbers="true" fullWidth="false" %}
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
        <connection>https://github.com/nianien/cudrania.git</connection>
        <developerConnection>scm:git:ssh://git@github.com:nianien/cudrania.git
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
                <plugin><!--必填-->﻿
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
                <plugin><!--必填--> ﻿
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
                ﻿
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
{% endcode %}

上面已经是最精简的pom配置了，我已经把必选项标注好了。这里主要包含两部分内容，一部分是snoatype要求的必备信息，包括：证书、开发者信息、仓库地址和发布地址；另一部分是deploy需要的maven插件列表，大家可以根据实际情况酌情修改。

需要说明的是，为了不用默认打包冲突，专门定义了用于发布中央仓库的profile：ossrh，这里只需要添加额外的两个插件：nexus-staging-maven-plugin和maven-gpg-plugin，前者用于jar上传，后者用于密钥签名。

* 第三步，执行maven命令，发布构件

配置好pom文件，可以执行maven命令：“mvn clean deploy -Possrh” 进行发布。如果版本号带SNAPSHOT后缀，会发布到snapshots仓库，否则发布到release仓库。

这里nexus-staging-maven-plugin插件有一个配置项：autoReleaseAfterClose，如果设置为true的话，推送完成会自动release。第一次发布成功后，会收到一封邮件：

<figure><img src="../.gitbook/assets/image (72).png" alt=""><figcaption></figcaption></figure>

* _**最后，让jar包更快的在中央仓库被搜索到**_

根据邮件提示，Jar包成功发布成功后，大约30分钟后会推到中央仓库，我们可以从仓库地址看到我们发布的Jar包：[https://repo1.maven.org/maven2/](https://repo1.maven.org/maven2)

<figure><img src="../.gitbook/assets/image (73).png" alt=""><figcaption></figcaption></figure>

此时，其他项目就可以通过maven依赖引用我们的构件了，但是这时候通过中央仓库仍然搜不到我们的Maven构件。按照邮件提示可能会需要四小时，实际情况是我等了5个小时依然搜不到。如果遇到这种情况，我们可以通过在对issue添加评论反馈，会有人工回复进行解决：

<figure><img src="../.gitbook/assets/image (74).png" alt=""><figcaption></figcaption></figure>

另外，关于mvnrepository与Maven Central的关系，有人咨询，官方也做了解答：

<figure><img src="../.gitbook/assets/image (75).png" alt=""><figcaption></figcaption></figure>

根据我的实际经验判断，mvnrepository应该是定时同步的，我发布成功后，第二天才能搜到：

<figure><img src="../.gitbook/assets/image (76).png" alt=""><figcaption></figcaption></figure>

下面是官方指导文档，介绍非常详细，基本上不用在网上搜索其他教程了。

#### 官方参考文档 <a href="#dzquo" id="dzquo"></a>

[https://central.sonatype.org/publish/publish-guide/](https://central.sonatype.org/publish/publish-guide)
