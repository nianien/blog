---
title: "How to Implement Dynamic Protobuf in Golang"
pubDate: "2025-07-29"
description: "This article explores how to dynamically compile and manipulate Protocol Buffers messages at runtime in Go — without relying on pre-generated code. It walks through the full path from .proto file to runtime proto.Message via FileDescriptorProto, and presents a practical protoc plugin solution for hot-reloadable schema management."
tags: ["Golang", "Protobuf", "DynamicPb"]
---

# How to Implement Dynamic Protobuf in Golang

> In most Go projects, Protobuf schemas are compiled ahead of time by `protoc`, producing static Go structs. But what if the schema isn't known until runtime — or changes frequently and you can't afford to redeploy?
>
> This article walks through a practical approach to **dynamic Protobuf in Go**: loading schemas at runtime, creating messages without generated code, and building a custom protoc plugin that makes it all work.

### Reading Guide

- **Conceptual overview**: Sections 1–3 (about 5 minutes)
- **Implementation deep-dive**: Section 4 (about 15 minutes)
- **Quick start**: Jump to Section 4.3 for usage examples

---

## 1. Background: Why Protobuf

Protocol Buffers (Protobuf) is a language-neutral, platform-neutral serialization mechanism developed by Google. Compared to text-based formats like JSON and XML, Protobuf offers:

- **Compact binary encoding** — significantly smaller payloads
- **Fast serialization / deserialization** — critical for high-throughput systems
- **Strong schema contracts** — `.proto` files serve as the single source of truth for data structures
- **Cross-language support** — generated code available for Go, Java, Python, C++, etc.

These properties make Protobuf the de facto choice for gRPC services, inter-process communication, and high-performance data pipelines.

---

## 2. The Static Compilation Model and Its Limitations

### 2.1 How Static Compilation Works

The standard Protobuf workflow is straightforward:

```
.proto file  →  protoc compiler  →  generated Go code  →  compile into binary
```

You define message types in `.proto` files, run `protoc` with a language-specific plugin (e.g., `protoc-gen-go`), and get type-safe structs with built-in `Marshal` / `Unmarshal` methods.

### 2.2 Where Static Compilation Falls Short

This model works well when schemas are stable and known at compile time. But it introduces friction in several real-world scenarios:

| Scenario | Pain Point |
|----------|-----------|
| **Multi-tenant platforms** | Each tenant may have a different schema; you can't generate code for all of them ahead of time |
| **Plugin architectures** | Plugins define their own message types that the host application doesn't know at compile time |
| **Evolving APIs** | Frequent schema changes require re-compilation and redeployment for every update |
| **Generic middleware** | Message routers, loggers, or transformers need to handle arbitrary Protobuf messages |
| **Configuration-driven systems** | Schema is loaded from a registry or config center at runtime |

In all these cases, you need a way to work with Protobuf messages **dynamically** — without pre-generated Go structs.

---

## 3. Dynamic Compilation: Key Concepts

Before diving into the Go implementation, let's establish the three foundational concepts that make dynamic Protobuf possible.

### 3.1 Dynamic Message

A Dynamic Message is a Protobuf message object whose fields can be accessed and manipulated at runtime, without a pre-generated struct. In Go, this is provided by the `dynamicpb` package.

You use dynamic messages when:
- The schema is loaded at runtime (e.g., from a file, database, or config center)
- The message type is determined by external input (e.g., a message name in a request header)

### 3.2 Reflection API

The Protobuf Reflection API allows you to inspect message structure at runtime:

- **Descriptors** — metadata objects describing fields, types, and the overall structure of messages
- **`protoreflect` package** — Go's implementation of the reflection API, providing `FileDescriptor`, `MessageDescriptor`, `FieldDescriptor`, etc.

The key components form a hierarchy:

```
FileDescriptor
  └── MessageDescriptor
        └── FieldDescriptor (name, number, type, label, etc.)
```

### 3.3 Dynamic Code Generation via protoc Plugin

In some cases, you need to extract schema metadata from `.proto` files programmatically. The `protoc` compiler supports a plugin architecture: it compiles `.proto` files into `FileDescriptorProto` objects and streams them to plugins via stdin. Plugins can then process this metadata however they need — including serializing it to JSON for runtime consumption.

---

## 4. Implementation in Go

### 4.1 The Core Challenge

In languages like Java, dynamic class loading makes runtime Protobuf relatively straightforward. **Go doesn't support dynamic class loading.** So we need a different approach.

The key insight comes from analyzing the Protobuf library's internals. The conversion path from a `.proto` file to a usable `proto.Message` is:

```
.proto file  →  FileDescriptorProto  →  FileDescriptor  →  proto.Message
```

This gives us two concrete questions to solve:

1. **How to obtain a `FileDescriptor` at runtime** (without running `protoc` at runtime)
2. **How to create a `proto.Message` from a `FileDescriptor`** (without generated structs)

#### Question 2: Creating Messages from FileDescriptor

The second question is straightforward — `dynamicpb` handles it directly:

```go
func NewMessages(fd protoreflect.FileDescriptor, msgName string) proto.Message {
    md := fd.Messages().ByName(protoreflect.Name(msgName))
    if md == nil {
        return nil
    }
    return dynamicpb.NewMessage(md)
}
```

#### Question 1: Obtaining FileDescriptor at Runtime

This is the harder problem. You can't get a `FileDescriptor` directly from a `.proto` text file in Go. But analyzing the source code in `google.golang.org/protobuf`, we find that `FileDescriptor` is created from `FileDescriptorProto`:

```go
fdp := new(descriptorpb.FileDescriptorProto)
// Unmarshal from binary or text format...
fd, err := protodesc.NewFile(fdp, nil)
```

So the refined conversion path becomes:

```
.proto file  →  FileDescriptorProto (serializable!)  →  FileDescriptor  →  proto.Message
```

Since `FileDescriptorProto` is itself a `proto.Message`, it can be serialized to binary, JSON, or text format — and deserialized at runtime. The question now is: **how do we produce the serialized `FileDescriptorProto` from a `.proto` file?**

### 4.2 How protoc Plugins Work

The answer lies in the `protoc` plugin architecture. When `protoc` invokes a plugin, it sends a `CodeGeneratorRequest` via stdin containing the compiled `FileDescriptorProto` objects. Here's the relevant source code from `google.golang.org/protobuf/compiler/protogen`:

```go
// protoc invokes the plugin and streams a CodeGeneratorRequest via stdin.
func run(opts Options, f func(*Plugin) error) error {
    if len(os.Args) > 1 {
        return fmt.Errorf("unknown argument %q (this program should be run by protoc, not directly)", os.Args[1])
    }
    // Read the compiled binary stream from protoc
    in, err := io.ReadAll(os.Stdin)
    if err != nil {
        return err
    }

    req := &pluginpb.CodeGeneratorRequest{}
    if err := proto.Unmarshal(in, req); err != nil {
        return err
    }
    gen, err := opts.New(req)
    if err != nil {
        return err
    }
    // Execute the plugin's custom processing logic
    if err := f(gen); err != nil {
        gen.Error(err)
    }
    resp := gen.Response()
    out, err := proto.Marshal(resp)
    if err != nil {
        return err
    }
    // Write the response (generated files) to stdout
    if _, err := os.Stdout.Write(out); err != nil {
        return err
    }
    return nil
}
```

The `CodeGeneratorRequest` contains the `FileDescriptorProto` we need:

```go
type CodeGeneratorRequest struct {
    FileToGenerate        []string
    Parameter             *string
    ProtoFile             []*descriptorpb.FileDescriptorProto
    SourceFileDescriptors []*descriptorpb.FileDescriptorProto
    CompilerVersion       *Version
    // ...
}
```

This means we can **build a custom protoc plugin** that, instead of generating Go source code, outputs the serialized `FileDescriptorProto` in a runtime-friendly format.

### 4.3 Building the Custom Plugin

We choose JSON as the serialization format for `FileDescriptorProto` because it's human-readable, easy to store in configuration centers, and widely supported.

```go
package main

import (
    "google.golang.org/protobuf/compiler/protogen"
    "google.golang.org/protobuf/encoding/protojson"
)

func main() {
    protogen.Options{}.Run(func(gen *protogen.Plugin) error {
        gen.SupportedFeatures = SupportedFeatures
        for _, file := range gen.Files {
            if !file.Generate {
                continue
            }
            genJsonFile(file, gen)
        }
        return nil
    })
}

func genJsonFile(file *protogen.File, gen *protogen.Plugin) {
    fd := file.Proto
    // Temporarily strip SourceCodeInfo to reduce output size
    sci := fd.SourceCodeInfo
    fd.SourceCodeInfo = nil
    defer func() { fd.SourceCodeInfo = sci }()

    jsonFile := gen.NewGeneratedFile(file.GeneratedFilenamePrefix+".json", ".")
    jsonFile.P(protojson.Format(fd))
}
```

**Why JSON over binary or proto-text?**

| Format | Pros | Cons |
|--------|------|------|
| **Binary** (`.pb`) | Smallest size, fastest parsing | Not human-readable, hard to debug |
| **Proto-text** | Human-readable, canonical format | Verbose, less tooling support |
| **JSON** | Human-readable, universal tooling, easy to store in config centers | Slightly larger than binary |

For systems that prioritize hot-reload via a configuration center, JSON strikes the best balance between readability and practicality.

#### JSON Output Example

For a `.proto` file like:

```protobuf
syntax = "proto3";
package tns.search.proto;
option go_package = "./gen;protobuf";

message TnsDemo {
  int64 id = 1;
  int32 status = 2;
  map<string, string> result = 3;
  repeated int32 reasons = 4;
}
```

The plugin produces:

```json
{
  "name": "protobuf/tns_demo.proto",
  "package": "tns.search.proto",
  "messageType": [
    {
      "name": "TnsDemo",
      "field": [
        {
          "name": "id",
          "number": 1,
          "label": "LABEL_OPTIONAL",
          "type": "TYPE_INT64",
          "jsonName": "id"
        },
        {
          "name": "status",
          "number": 2,
          "label": "LABEL_OPTIONAL",
          "type": "TYPE_INT32",
          "jsonName": "status"
        },
        {
          "name": "result",
          "number": 3,
          "label": "LABEL_REPEATED",
          "type": "TYPE_MESSAGE",
          "typeName": ".tns.search.proto.TnsDemo.ResultEntry",
          "jsonName": "result"
        },
        {
          "name": "reasons",
          "number": 4,
          "label": "LABEL_REPEATED",
          "type": "TYPE_INT32",
          "jsonName": "reasons"
        }
      ],
      "nestedType": [
        {
          "name": "ResultEntry",
          "field": [
            {
              "name": "key",
              "number": 1,
              "label": "LABEL_OPTIONAL",
              "type": "TYPE_STRING",
              "jsonName": "key"
            },
            {
              "name": "value",
              "number": 2,
              "label": "LABEL_OPTIONAL",
              "type": "TYPE_STRING",
              "jsonName": "value"
            }
          ],
          "options": {
            "mapEntry": true
          }
        }
      ]
    }
  ],
  "options": {
    "goPackage": "./gen;protobuf"
  },
  "syntax": "proto3"
}
```

### 4.4 Generating the JSON Schema

Build the plugin and run it alongside `protoc`:

```bash
SRC_DIR=$(pwd)

# Build the custom plugin
go build -o $SRC_DIR/protoc-gen-ext

# Run protoc with both the standard Go plugin and our custom plugin
protoc --proto_path=$SRC_DIR \
  --plugin=protoc-gen-go=$(which protoc-gen-go) \
  --go_out=$SRC_DIR/protobuf \
  --plugin=protoc-gen-ext=$SRC_DIR/protoc-gen-ext \
  --ext_out=$SRC_DIR/protobuf \
  $SRC_DIR/protobuf/*.proto
```

This produces both the standard Go generated code **and** the JSON schema files side by side. Store the JSON in your configuration center for runtime access.

### 4.5 Using Dynamic Schema at Runtime

With the JSON schema available (e.g., from a config center, database, or file), the runtime usage is straightforward:

```go
package main

import (
    "google.golang.org/protobuf/encoding/protojson"
    "google.golang.org/protobuf/reflect/protodesc"
    "google.golang.org/protobuf/reflect/protoreflect"
    "google.golang.org/protobuf/types/descriptorpb"
    "google.golang.org/protobuf/types/dynamicpb"
)

func LoadDynamicMessage(jsonSchema []byte, messageName string) (*dynamicpb.Message, error) {
    // Step 1: Deserialize JSON into FileDescriptorProto
    fdp := new(descriptorpb.FileDescriptorProto)
    if err := protojson.Unmarshal(jsonSchema, fdp); err != nil {
        return nil, fmt.Errorf("unmarshal schema: %w", err)
    }

    // Step 2: Create FileDescriptor from FileDescriptorProto
    fd, err := protodesc.NewFile(fdp, nil)
    if err != nil {
        return nil, fmt.Errorf("create file descriptor: %w", err)
    }

    // Step 3: Find the target MessageDescriptor
    md := fd.Messages().ByName(protoreflect.Name(messageName))
    if md == nil {
        return nil, fmt.Errorf("message %q not found in schema", messageName)
    }

    // Step 4: Create a dynamic message instance
    return dynamicpb.NewMessage(md), nil
}
```

Once you have the `dynamicpb.Message`, you can use it like any other `proto.Message`:

```go
// Unmarshal binary Protobuf data into the dynamic message
msg, _ := LoadDynamicMessage(jsonSchema, "TnsDemo")
if err := proto.Unmarshal(binaryData, msg); err != nil {
    log.Fatal(err)
}

// Access fields via reflection
idField := msg.Descriptor().Fields().ByName("id")
fmt.Println("id:", msg.Get(idField).Int())

// Marshal back to binary or JSON
jsonBytes, _ := protojson.Marshal(msg)
fmt.Println(string(jsonBytes))
```

### 4.6 Hot-Reload Architecture

The complete runtime architecture for schema hot-reload looks like this:

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  .proto file │────→│  protoc + plugin │────→│  JSON schema (stored │
│  (offline)   │     │  (offline build) │     │  in config center)   │
└─────────────┘     └──────────────────┘     └──────────┬───────────┘
                                                        │ watch / poll
                                                        ▼
                                              ┌──────────────────────┐
                                              │  Application         │
                                              │                      │
                                              │  JSON → FDProto      │
                                              │  FDProto → FD        │
                                              │  FD → dynamicpb.Msg  │
                                              │                      │
                                              │  Marshal / Unmarshal  │
                                              └──────────────────────┘
```

When the `.proto` schema changes:
1. Re-run `protoc` with the custom plugin (offline)
2. Update the JSON in your config center
3. The application detects the change and reloads the schema — **no redeployment required**

---

## 5. Considerations and Trade-offs

Dynamic Protobuf is powerful but comes with trade-offs you should be aware of:

| Aspect | Static Compilation | Dynamic Schema |
|--------|-------------------|----------------|
| **Type safety** | Compile-time checks | Runtime checks only |
| **Performance** | Direct struct access | Reflection overhead |
| **Developer experience** | IDE autocomplete, type hints | Generic field access by name |
| **Schema evolution** | Requires re-compilation | Hot-reload via config update |
| **Deployment** | Redeploy on schema change | No redeploy needed |

**When to use dynamic Protobuf:**
- Schema changes frequently and redeployment is costly
- You're building a generic platform that handles arbitrary message types
- You need to decouple schema evolution from application deployment

**When to stick with static compilation:**
- Schema is stable and known at compile time
- Performance is critical and reflection overhead is unacceptable
- Type safety and developer experience are priorities

---

## 6. Conclusion

Dynamic Protobuf in Go is not natively supported in the way it is in Java or Python, but it's entirely achievable by understanding the internal compilation pipeline. The key insight is the conversion path:

```
.proto  →  FileDescriptorProto (serializable)  →  FileDescriptor  →  dynamicpb.Message
```

By building a lightweight `protoc` plugin that exports `FileDescriptorProto` as JSON, we bridge the gap between offline schema compilation and runtime message handling. Combined with a configuration center for storage and distribution, this approach enables **schema hot-reload without application redeployment** — a capability that's essential for multi-tenant platforms, plugin architectures, and rapidly evolving API systems.
