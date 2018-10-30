# Name Conflict

名称冲突是文件系统根深蒂固的设计缺陷。



理解文件冲突问题的设计和解决方案的关键，是要理解用户的意图。缺省的情况（vanilla case）下，创建文件或者文件夹，如果遇到名称冲突：

1. 如果目前文件或者文件夹已经存在，称为冲突。
2. 如果存在同名但不同类型的文件（广义），称为失败。





## mkdir

**undefined/null**

冲突：

```js
err.code = 'EEXIST'
err.xcode = 'ENOTDIR' // if not dir
```



**rename**

永远不会失败。用户的意图是创建**新**的文件夹。



**replace**

在实现上这相当于一个组合操作，`rimraf



**keep**

```js
err.code = 'EEXIST'
```





## 文件

在内部模块的API层面，创建、导入、复制、或移动文件时，有如下几种可能：



vanilla case

如果同名目标文件存在，冲突；

如果同名non-regular file存在，失败；



auto-rename

永远不会失败



replace

这是一个用户操作，和文件夹一样，UUID不会保留。



update

这是一个同步操作，保留UUID。



skip/keep

不动













