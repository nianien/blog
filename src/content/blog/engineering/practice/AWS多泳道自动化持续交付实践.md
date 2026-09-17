---
title: "AWS多泳道自动化持续交付实践"
description: "本文面向 DevOps 架构师与云原生工程师，介绍如何基于 AWS CodePipeline + CloudFormation 构建一套支持多泳道（Multi-Lane）并行部署的 ECS 持续交付体系。重点解释资源归属、并发边界、镜像晋级与恢复，使模板治理和业务交付能够分别演进。"
pubDate: 2025-10-29
tags: ["AWS", "DevOps", "泳道部署"]
---

## 多泳道交付要隔离哪些变化

当多个服务或版本更新同一个 CloudFormation 栈时，部署会争用同一栈的更新入口。拆分栈可以缩小串行范围，但不能让共享资源上的冲突自动消失。本文采用“双仓模板治理、三层资源归属、泳道独立部署”的方案，重点说明哪些更新可以并行，哪些仍需协调。

作者此前遇到过多个部署共享栈、发布排队的情况。这里将设计收敛为一个明确示例：**同一服务的多个泳道共享 ALB 和 Listener，每个泳道独立管理 ECS Service、TargetGroup 与 ListenerRule**。若多个服务还要共用同一个 ALB，应把 ALB 放在环境接入栈，不能同时由各服务 Boot 栈创建。

## 双仓与三层：分别管理模板、资源和版本

Infra Repo 保存 buildspec、CloudFormation 模板和发布脚本；App Repo 保存业务代码与 Dockerfile。发布记录同时固定两个仓库的提交，避免模板更新后无法复现旧构建。业务团队仍需遵守构建产物、参数和健康检查契约，双仓减少模板复制，不等于没有依赖。

| 层级 | 示例栈名 | 资源归属 | 更新与协调 |
| --- | --- | --- | --- |
| 环境 Infra | infra-dev | VPC、子网、ECS Cluster、Cloud Map Namespace | 低频变更，先核对下游依赖 |
| 服务 Boot | boot-user-api-dev | 该服务共享的 ALB、Listener、LogGroup | 同一服务共享设施统一更新 |
| 泳道 App | app-user-api-dev-gray | TaskDefinition、ECS Service、TargetGroup、ListenerRule | 不同泳道可并行，同一泳道串行 |

Pipeline 是交付控制器，Stack 是资源所有权边界，二者不必一一对应。可以用一条参数化 Bootstrap Pipeline 创建不同服务的 Boot 栈；是否真的并发，还取决于 Pipeline 的执行模式与动作配置。不能只传入不同 SERVICE 变量就宣布没有互斥。[CodePipeline 执行模式](https://docs.aws.amazon.com/codepipeline/latest/userguide/execution-modes.html)

跨栈引用使用 Outputs 与 ImportValue。导出被其他栈使用后，不能直接改掉被引用值或删除导出栈；资源替换需要迁移引用，而不是“底层更新完上层自然安全”。传统 Export/ImportValue 的范围也限于同一账号、同一区域。[跨栈引用限制](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-importvalue.html)

## 泳道隔离部署生命周期，共享设施仍有约束

每个泳道运行一个独立 ECS Service，允许灰度版本与默认版本分别发布和回滚。这是为了给实验环境独立的生命周期；ECS 单一 Service 本身也可在滚动更新中同时运行新旧任务，不能把泳道方案建立在“ECS 不支持多版本”的前提上。

入口为请求选择泳道，例如使用自定义 HTTP Header `X-Deployment-Lane: gray`。可信入口应删除外部伪造的内部路由标记，再按实验或测试规则注入。跨服务调用需传播路由上下文；只有入口 ALB 分流，还不能保证整个调用链都进入同一泳道。异步消息、定时任务、数据库写入和外部副作用也要分别设计隔离策略。

共享 Listener 上的规则优先级必须统一分配。给所有泳道都写 `Priority: 1000` 会发生冲突，即使它们属于不同栈。可以通过受控配置为每个服务/泳道分配唯一优先级；同一个资源不能同时由两个栈管理。

下面是 App 模板中的规则片段，参数和 TargetGroup 由同一模板其他部分定义：

```yaml
Resources:
  LaneRule:
    Type: AWS::ElasticLoadBalancingV2::ListenerRule
    Properties:
      ListenerArn:
        Fn::ImportValue:
          Fn::Sub: 'boot-${ServiceName}-${Env}-HttpListenerArn'
      Priority: !Ref LaneRulePriority
      Conditions:
        - Field: http-header
          HttpHeaderConfig:
            HttpHeaderName: X-Deployment-Lane
            Values: [!Ref Lane]
      Actions:
        - Type: forward
          TargetGroupArn: !Ref LaneTargetGroup
```

本文约定 Boot 栈的 Listener 默认动作返回固定响应；App 的 default 泳道通过低优先级的兜底规则把业务路径转入 default TargetGroup，带泳道标记的规则优先匹配。这样默认业务 TargetGroup 也由 App 栈持有，避免 Boot 与 App 同时管理默认动作。新环境须先部署 default 泳道才对外接流量。[ALB 规则求值顺序](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-rules.html)

Header 路由适合定向测试；按百分比灰度、用户稳定分组和 A/B 实验还需要明确分流算法与指标口径。它们不是创建多个 Stack 后自动获得的功能。

## 构建一次，记录产物，再晋级

CodePipeline Source 阶段输出 InfraOut 和 AppOut 两份 Artifact，CodeBuild 将 InfraOut 配为主输入。此时主目录是 `CODEBUILD_SRC_DIR`，业务源码目录是与输入标识对应的 `CODEBUILD_SRC_DIR_AppOut`。Docker 构建必须使用业务目录，不能误在模板仓目录执行。

以下为脚本主体，假设 CodeBuild 镜像已提供 AWS CLI、Docker 和 jq，构建环境允许所需 Docker 操作，ECR 仓库已创建，相关环境变量已校验：

```bash
set -euo pipefail

: "${AWS_REGION:?}"
: "${ECR_REGISTRY:?}"
: "${ECR_REPO_URI:?}"
: "${IMAGE_TAG:?}"
: "${SERVICE_NAME:?}"
: "${APP_ENV:?}"
: "${LANE:?}"
: "${CODEBUILD_SRC_DIR:?}"
: "${CODEBUILD_SRC_DIR_AppOut:?}"

IMAGE_TAG_URI="$ECR_REPO_URI:$IMAGE_TAG"
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker build -t "$IMAGE_TAG_URI" "$CODEBUILD_SRC_DIR_AppOut"
docker push "$IMAGE_TAG_URI"

jq -n \
  --arg service "$SERVICE_NAME" \
  --arg env "$APP_ENV" \
  --arg lane "$LANE" \
  --arg image "$IMAGE_TAG_URI" \
  '{Parameters: {ServiceName: $service, Env: $env, Lane: $lane, ImageUri: $image}}' \
  > "$CODEBUILD_SRC_DIR/cfn-params.json"
```

这里的 JSON 是 CodePipeline CloudFormation 动作使用的模板配置格式，不应与 AWS CLI 的参数文件格式混用。BuildSpec 将 `cfn-params.json` 作为产物输出，Deploy 动作显式引用它；Pipeline 变量也必须显式映射到 CodeBuild 和 CloudFormation。

镜像标签应不可变，发布记录保存实际 digest。灰度通过后把**同一 digest**晋级到 default，避免按同一分支重新构建出另一份镜像。BRANCH 只是自定义变量，除非 Source 动作已经配置相应关联，否则传变量不会自动切换代码来源。[Pipeline 的源修订与执行](https://docs.aws.amazon.com/codepipeline/latest/userguide/concepts-how-it-works.html)

## 参数化部署要与资源契约一起设计

模板应明确网络是新建还是复用。若提供 `CreateNetwork=false`，就必须同时定义 ExistingVpcId、已有子网参数，并用条件表达式选择输出；仅给 VPC 加 Condition、仍在 Output 中无条件 Ref 它，并不能实现复用模式。

每次发布至少记录：

| 信息 | 用途 |
| --- | --- |
| 环境、服务、泳道 | 确定目标栈与资源边界 |
| 应用提交、模板提交 | 复现构建和部署行为 |
| 镜像 digest | 保证测试与晋级使用同一产物 |
| 参数版本、变更集 | 审核资源变化，识别替换和删除 |
| 前一成功版本 | 确定恢复目标 |

账号、区域、模板角色、ECR 和日志资源需要明确授权。只允许修改 `app-*` 栈并不构成完整的最小权限：CloudFormation 执行角色可能仍有广泛的底层权限，还需限制 `iam:PassRole`、执行角色权限及部署来源。

Stack Policy 主要保护栈更新中的资源操作；防止整栈删除应另用终止保护和 IAM 等措施。资源需要保留时配置 DeletionPolicy。三者的作用不同，不能用一句“栈策略禁止删除网络”代替完整设计。

## 晋级、回滚和删除泳道

一个可核对的流程是：

1. 为 gray 分配独立栈名、规则优先级和配置，部署固定镜像 digest
2. 从可信入口导入测试流量，确认入口及后续调用的泳道一致
3. 检查业务结果、错误率、延迟和共享数据兼容性
4. 将同一 digest 部署到 default，保留上一成功版本记录
5. 稳定后停止向 gray 导流，等待连接排空与任务退出，再删除其栈

gray 与 default 若都运行新版本，保留 gray 并不能当作旧版本回滚通道。恢复需指向已记录的旧镜像及兼容配置，同时核对数据库变更和新版本已产生的业务数据。

ECS 的 Deployment Circuit Breaker 需要显式启用回滚，并存在可回退的成功部署；它也不能代替业务指标监控。应用已通过启动检查但业务错误率上升时，需要相应告警和发布控制逻辑。[ECS 部署断路器](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)

监控也应保留量纲：ALB 的 5XX Count 是数量，若要告警“错误率超过 1%”，需要用同周期请求数计算比率，并设最小样本量。TargetGroup 健康主机数和 ECS 实际任务数用于发现容量不足，不能直接证明业务功能正确。

## 这套方案带来的改变

双仓把模板变更集中管理，三层资源边界降低跨团队发布的相互影响，独立泳道把版本生命周期从共享栈中分离出来。其价值可以通过发布等待时间、恢复耗时、模板升级覆盖率和变更失败率来检验。

多栈并行成立的前提是资源归属清楚、共享标识没有冲突、同一泳道的更新有序。把这些条件落实到模板和发布记录中，才能让并发交付成为可重复的工程能力。
