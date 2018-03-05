## Install Bazel WORKSPACE
1. Open Terminal -> cd to folder contains "tensorboard" folder.
2. type "touch WORKSPACE"
3. type "bazel build"

## Install Bazel
```
chmod +x bazel-0.5.4-installer-darwin-x86_64.sh
```
The binary version can be downloaded from (https://github.com/bazelbuild/bazel/releases/tag/0.5.4)

## Setup Environment
```
export PATH="$PATH:$HOME/bin"
```

## Build using bazel (on Terminal)
1. ```git clone https://github.com/tensorflow/tensorboard.git``` (v0.1.7)
2. ```cd tensorboard```
3. ```bazel build //tensorboard```

```
...
Target //tensorboard:tensorboard up-to-date:
bazel-bin/tensorboard/tensorboard
INFO: Elapsed time: 87.181s, Critical Path: 50.59s
```

## Bazel Run
1. ```python t1.py```
2. ```bazel run //tensorboard -- --logdir=/tmp/t1```

[Install Bazel]:https://docs.bazel.build/versions/master/install-os-x.html
[Install from Source]:https://www.tensorflow.org/install/install_sources
