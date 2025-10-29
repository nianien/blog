---
title: "How to implement dynamic protobuf in Golang?"
pubDate: "2025-07-29"
description: "Protocol Buffers (Protobuf) is a language-neutral, platform-neutral, extensible mechanism for serializing structured data. It was developed by Google to efficiently serialize data for use in a variety of applications, including network communication, data storage, and inter-process communication (IPC).  Protobuf messages are smaller and more efficient than text-based formats like JSON and XML, and provides fast serialization and deserialization, which is crucial for high-performance systems."
tags: ["Golang","Protobuf","DynamicPb"]
---

## 1. Background 
Protocol Buffers (Protobuf) is a language-neutral, platform-neutral, extensible mechanism for serializing structured data. It was developed by Google to efficiently serialize data for use in a variety of applications, including network communication, data storage, and inter-process communication (IPC).  Protobuf messages are smaller and more efficient than text-based formats like JSON and XML ,and provides fast serialization and deserialization, which is crucial for high-performance systems. 
## 2. Protobuf compiler
Protobuf allows you to define the structure of your data (messages) in a .proto file, and then use the Protobuf compiler (protoc) to generate source code in selected programming language that can serialize and deserialize data in the Protobuf format.  Protobuf adds overhead to the development process compared to formats like JSON, where you can directly parse or serialize data without needing code generation. Additionally, any changes to the schema may require re-compiling the code to handle new or modified message types.
## 3. Dynamic compilation(Dynamic Schema)
Typically, Protobuf schemas are compiled using the protoc compiler ahead of time, which generates source code in various programming languages (such as C++, Java, Python, etc.) for serialization and deserialization. However, in some scenarios, you might need to work with Protobuf messages dynamically without relying on pre-generated codes. 

This is especially useful when:
- You want to work with Protobuf messages dynamically at runtime, where the schema is not known in advance.
- You need to handle multiple or evolving Protobuf schemas at runtime without recompiling your code.
- You want to dynamically serialize or deserialize Protobuf messages in a generic way, perhaps for applications like plugins, dynamic API handling, or protocol-based communication where the schema might change often.
### Key Concepts for Dynamic Compilation in Protobuf
- Dynamic Message (Dynamic Parsing)
- Reflection API in Protobuf
- Dynamic Code Generation

### 3.1 Dynamic Message (Dynamic Parsing)
In Protobuf, a Dynamic Message is an object where you can manipulate the message’s fields dynamically, without needing a pre-generated class for the specific message type. This is enabled through Protobuf's Reflection API.
You can use dynamic messages when:
- The Protobuf schema is available at runtime, but you don't know the message types ahead of time.
- You want to work with messages whose types are determined dynamically (e.g., reading from a file or network stream that specifies the message type).
To use dynamic messages, you typically:
- Load the schema definition (e.g., .proto file) at runtime.
- Use the Protobuf Reflection API to create message types and set/get fields.
### 3.2 Reflection API
The Protobuf Reflection API allows you to inspect the structure of Protobuf messages at runtime, and dynamically access their fields. This is the core tool for implementing dynamic compilation because it lets you:
- Discover available fields.
- Inspect field types (e.g., int32, string, nested messages).
- Set and get field values dynamically.
The key components of the Reflection API in Protobuf are:
- Descriptors: These are metadata objects that describe the fields, types, and structure of messages.
- Dynamic Messages: These are messages created dynamically using descriptors, where you can set/get fields without needing a pre-compiled class.
### 3.3 Dynamic Code Generation with Protobuf Compiler
In some use cases, you may need to generate Protobuf code dynamically based on new or unknown schemas. This would involve invoking the Protobuf compiler (protoc) programmatically to generate the code at runtime, either directly from .proto files or from a descriptor or a set of schema definitions.
This process typically involves the following steps:
1) Obtain the .proto files or schema descriptors.
2) Run protoc programmatically to generate source code.
3) Use the generated code within the application to work with dynamic messages.

## 4. Code Implementation
### 4.1 Code Analysis
The above method is valid for languages that support dynamic loading such as java, but not for golang. Since golang doesn't support dynamic loading, we can't use the generated source code. However, through technical analysis, we know that the conversion path from a text file to a binary message is: file.proto --> FileDescriptor --> proto.message, and there are two key points: 
1) how to get FileDescriptor from a proto file at runtime?
2) how to create a proto.message using FileDescriptor?

For the second point, the solution is not complicated. We can use dynamicpb.message mentioned before. The following code demonstrates how to create a proto.message by dynamicpb.message:
```golang
func NeweMessages(fd protoreflect.FileDescriptor, msgName string)proto.Message{
  fm := fd.Messages()
  md = fm.ByName(protoreflect.Name(msgName))
  return dynamicpb.NewMessage(md)
}
```
Now let's look at the second question, how to get FileFescriptor from a proto file at runtime? To get the FileFescriptor dynamically in golang, we first need to know how the FileFescriptor is generated. Typically, we can not get FileFescriptor directly from proto file. But we analyzed the source code in google.golang.org/protobuf , and found that FileDescriptor is created from FileDescriptorProto as follows:
```golang
fdp := new(descriptorpb.FileDescriptorProto)
//Unmarshal([]byte,fdp)
fd, err := protodesc.NewFile(fdp, nil)
```
Thus, the conversion path from a text file to a binary message is changed to:  file.proto --> FileDescriptorProto --> FileDescriptor --> proto.message,So the final question is, how do we get the FileDescriptorProto object?
FileDescriptorProto is a proto.message object, so it can be serialized to binary and deserialized from binary. In fact, we can use protoc to generate the binary data of FileDescriptorProto at the same time as the source code with option: --descriptor_set_out=your_file_descriptord_proto.pb.
Further analyzing the source code of protoc , there are plugins that receive the compiled binary streams from proto file for data processing, including code generation. 

The following is the source code analysis, and the highlighted part is the key code:

```golang
func main() {
  //...
  protogen.Options{
     ParamFunc: flags.Set,
  }.Run(func(gen *protogen.Plugin) error {
     //...
     for _, f := range gen.Files {
        if f.Generate {
           gengo.GenerateFile(gen, f)
        }
     }
     //...
     return nil
  })
}
//It reads a [pluginpb.CodeGeneratorRequest] message from [os.Stdin], invokes the plugin function, and writes a [pluginpb.CodeGeneratorResponse] message to [os.Stdout].
func (opts Options) Run(f func(*Plugin) error) {
    if err := run(opts, f); err != nil {
       fmt.Fprintf(os.Stderr, "%s: %v\n", filepath.Base(os.Args[0]), err)
       os.Exit(1)
    }
}

func run(opts Options, f func(*Plugin) error) error {
    if len(os.Args) > 1 {
       return fmt.Errorf("unknown argument %q (this program should be run by protoc, not directly)", os.Args[1])
    }
    //Here is the compiled binary stream from protoc
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
    //This is the plugin's custom processing logic
    if err := f(gen); err != nil {
       gen.Error(err)
    }
    resp := gen.Response()
    out, err := proto.Marshal(resp)
    if err != nil {
       return err
    }
    //Write the source code to a file
    if _, err := os.Stdout.Write(out); err != nil {
       return err
    }
    return nil
}

//CodeGeneratorRequest defines a FileDescriptorProto field
type CodeGeneratorRequest struct {
    state         protoimpl.MessageState
    sizeCache     protoimpl.SizeCache
    unknownFields protoimpl.UnknownFields

    FileToGenerate []string 
    Parameter *string 
    ProtoFile []*desriptorpb.FileDescriptorProto
    SourceFileDescriptors []*descriptorpb.FileDescriptorProto 
    CompilerVersion *Version
}
```

By analyzing the source code of protoc, we can also implement a custom plugin to output the text-format serialized data of FileDescriptorProto. 
Actually, there are two text-format serialization schemes for FileDescriptorProto: json/proto-text.
- JSON

For json format, we can serialize/deserialize FileDescriptorProto via protojson.Marshal/Unmarshal.
Example of json-format:
```json
{
  "name":  "protobuf/tns_demo.proto",
  "package":  "tns.search.proto",
  "messageType":  [
    {
      "name":  "TnsDemo",
      "field":  [
        {
          "name":  "id",
          "number":  1,
          "label":  "LABEL_OPTIONAL",
          "type":  "TYPE_INT64",
          "jsonName":  "id"
        },
        {
          "name":  "status",
          "number":  2,
          "label":  "LABEL_OPTIONAL",
          "type":  "TYPE_INT32",
          "jsonName":  "status"
        },
        {
          "name":  "result",
          "number":  3,
          "label":  "LABEL_REPEATED",
          "type":  "TYPE_MESSAGE",
          "typeName":  ".tns.search.proto.TnsDemo.ResultEntry",
          "jsonName":  "result"
        },
        {
          "name":  "reasons",
          "number":  4,
          "label":  "LABEL_REPEATED",
          "type":  "TYPE_INT32",
          "jsonName":  "reasons"
        }
      ],
      "nestedType":  [
        {
          "name":  "ResultEntry",
          "field":  [
            {
              "name":  "key",
              "number":  1,
              "label":  "LABEL_OPTIONAL",
              "type":  "TYPE_STRING",
              "jsonName":  "key"
            },
            {
              "name":  "value",
              "number":  2,
              "label":  "LABEL_OPTIONAL",
              "type":  "TYPE_STRING",
              "jsonName":  "value"
            }
          ],
          "options":  {
            "mapEntry":  true
          }
        }
      ]
    }
  ],
  "options":  {
    "goPackage":  "./gen;protobuf"
  },
  "syntax":  "proto3"
}
```
- Proto-Text

The Text Format  is a human-readable format used for serializing and displaying protobuf messages in text form. It is often used for debugging or configuration purposes when you want to quickly inspect the contents of a protobuf message.
In the text format, protobuf messages are represented in a straightforward key-value style, where each field in the message is written in a human-readable way, with the field name followed by the value. This format is defined in the Protocol Buffers specification.
For text-format, we can serialize/deserialize FileDescriptorProto via prototext.Marshal/Unmarshal
Example of text-format:
```protobuf
name:  "protobuf/tns_demo.proto"
package:  "tns.search.proto"
message_type:  {
  name:  "TnsDemo"
  field:  {
    name:  "id"
    number:  1
    label:  LABEL_OPTIONAL
    type:  TYPE_INT64
    json_name:  "id"
  }
  field:  {
    name:  "status"
    number:  2
    label:  LABEL_OPTIONAL
    type:  TYPE_INT32
    json_name:  "status"
  }
  field:  {
    name:  "result"
    number:  3
    label:  LABEL_REPEATED
    type:  TYPE_MESSAGE
    type_name:  ".tns.search.proto.TnsDemo.ResultEntry"
    json_name:  "result"
  }
  field:  {
    name:  "reasons"
    number:  4
    label:  LABEL_REPEATED
    type:  TYPE_INT32
    json_name:  "reasons"
  }
  nested_type:  {
    name:  "ResultEntry"
    field:  {
      name:  "key"
      number:  1
      label:  LABEL_OPTIONAL
      type:  TYPE_STRING
      json_name:  "key"
    }
    field:  {
      name:  "value"
      number:  2
      label:  LABEL_OPTIONAL
      type:  TYPE_STRING
      json_name:  "value"
    }
    options:  {
      map_entry:  true
    }
  }
}
options:  {
  go_package:  "./gen;protobuf"
}
syntax:  "proto3"
```
### 4.2 protoc-plugin
In order to keep the generality, we choose the json-format as the serialization solution. 
```golang
func main() {
    protogen.Options{}.Run(func(gen *protogen.Plugin) error {
       gen.SupportedFeatures = SupportedFeatures
       for _, file := range gen.Files {
          // Skip files that are not part of the plugin's current output.
          if !file.Generate {
             continue
          }
          genJsonFile(file, gen)
          genExtFile(file, gen)
       }
       return nil
    })
}
func genJsonFile(file *protogen.File, gen *protogen.Plugin) {
    fd := file.Proto
    sci := fd.SourceCodeInfo
    fd.SourceCodeInfo = nil
    jsonFile := gen.NewGeneratedFile(file.GeneratedFilenamePrefix+".json", ".")
    jsonFile.P(protojson.Format(fd))
    fd.SourceCodeInfo = sci
}
```
Once we get serialized content in json format, the rest is easy. We can save the json to tcc and load it later at runtime to marshal/unmarshal proto.Message. If the proto file changes, we can manually compile it offline and then update the new json data in tcc to realize the hot update. 
### 4.3 How to use dynamic schema
- generate json schema with plugin
```shell
SRC_DIR=$(pwd)
go build -o $SRC_DIR/protoc-gen-ext
protoc --proto_path=$SRC_DIR \
--plugin=protoc-gen-go=$(which protoc-gen-go) \
--go_out=$SRC_DIR/protobuf \
--fastpb_out=$SRC_DIR/protobuf \
--plugin=protoc-gen-ext=$SRC_DIR/protoc-gen-ext \
--ext_out=$SRC_DIR/protobuf \
$SRC_DIR/protobuf/*.proto
```
- manipulate dynamic schema

```golang
    //jsonData:=getJsonFromTcc(...)
    fdp := new(descriptorpb.FileDescriptorProto)
    //load schema from json
    if err := protojson.Unmarshal([]byte(jsonData), fdp); err != nil {
       panic(err)
    }
    //create FileDescriptorfrom FileDescriptorProto
    fd, err := protodesc.NewFile(fdp, nil)
    if err != nil {
       panic(err)
    }
   // find the MessageDescriptor by name
    md = fd.Messages().ByName(protoreflect.Name(msg))
   // create dynamicpb message
    dynamicpb.NewMessage(md)
```

## 5. Conlusion
Dynamic compilation of Protobuf is a powerful technique for situations where the schema cannot be known ahead of time or needs to be handled at runtime. By using Protobuf’s Reflection API, Dynamic Messages, and Any fields, you can create, manipulate, and serialize Protobuf messages dynamically. This allows for greater flexibility in scenarios such as plugin-based architectures, evolving APIs, or systems that need to work with arbitrary message types at runtime. However, dynamic compilation is more complex than static compilation and may introduce performance overhead due to reflection and dynamic handling of schema data.

