class DefaultParam {
  getContainerDefault() {
    return {
      'Hostname': '',
      'Domainname': '',
      'User': '',
      'AttachStdin': false,
      'AttachStdout': false,
      'AttachStderr': false,
      'Tty': false,
      'OpenStdin': false,
      'StdinOnce': false,
      'Env': [],
      'Cmd': null,
      'Image': '',
      'Volumes': {},
      'WorkingDir': '',
      'Entrypoint': null,
      'OnBuild': null,
      'Labels': {},
      'HostConfig': {
        'Binds': null,
        'ContainerIDFile': '',
        'LogConfig': {
          'Type': '',
          'Config': {}
        },
        'NetworkMode': 'default',
        'PortBindings': {},
        'RestartPolicy': {
          'Name': 'no',
          'MaximumRetryCount': 0
        },
        'AutoRemove': false,
        'VolumeDriver': '',
        'VolumesFrom': null,
        'CapAdd': null,
        'CapDrop': null,
        'Dns': [],
        'DnsOptions': [],
        'DnsSearch': [],
        'ExtraHosts': null,
        'GroupAdd': null,
        'IpcMode': '',
        'Cgroup': '',
        'Links': null,
        'OomScoreAdj': 0,
        'PidMode': '',
        'Privileged': false,
        'PublishAllPorts': false,
        'ReadonlyRootfs': false,
        'SecurityOpt': null,
        'StorageOpt': null,
        'UTSMode': '',
        'UsernsMode': '',
        'ShmSize': 0,
        'ConsoleSize': [
          0,
          0
        ],
        'Isolation': '',
        'CpuShares': 0,
        'Memory': 0,
        'CgroupParent': '',
        'BlkioWeight': 0,
        'BlkioWeightDevice': null,
        'BlkioDeviceReadBps': null,
        'BlkioDeviceWriteBps': null,
        'BlkioDeviceReadIOps': null,
        'BlkioDeviceWriteIOps': null,
        'CpuPeriod': 0,
        'CpuQuota': 0,
        'CpusetCpus': '',
        'CpusetMems': '',
        'Devices': [],
        'DiskQuota': 0,
        'KernelMemory': 0,
        'MemoryReservation': 0,
        'MemorySwap': 0,
        'MemorySwappiness': -1,
        'OomKillDisable': false,
        'PidsLimit': 0,
        'Ulimits': null,
        'CpuCount': 0,
        'CpuPercent': 0,
        'BlkioIOps': 0,
        'BlkioBps': 0,
        'SandboxSize': 0
      },
      'NetworkingConfig': {
        'EndpointsConfig': {}
      }
    }
  }

  getDockerURL() {
    return {
      protocol: 'http',
      ip: '127.0.0.1',
      port: '1688'
    }
  }

  getWisnucAppstationPort() {
    return 3722
  }
}

module.exports = DefaultParam



