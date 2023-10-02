---
description: Maven
---

# Maven使用技巧

### 1、使用maven.config定制化配置

Located within the project's **top level directory**, the files

* `maven.config`
* `jvm.config`
* `extensions.xml`

contain project specific configuration for running Maven.

This directory is part of the project and may be checked in into your version control.

> ref：[https://maven.apache.org/configure.html](https://maven.apache.org/configure.html)

常见配置如：

```processing
-Dmaven.test.skip=true
--settings
/Users/skyfalling/.m2/settings.xml
```

{% hint style="info" %}
There must not be a whitespace after `--settings,`With the introduction of `maven 3.9`, there was a BREAKING CHANGE that affects the parsing of the `maven.config` file:

Each line in `.mvn/maven.config` is now interpreted as a single argument. That is, if the file contains multiple arguments, these must now be placed on separate lines
{% endhint %}
