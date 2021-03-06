/**
@module configuration
*/

/**
Parameterized configuration for appifi

@typedef Configuration
@property {object} chassis - chassis configuration
@property {boolean} chassis.userBinding - whether the system force a chassis-user binding or not
@property {boolean} chassis.volumeBinding - whether the system force a chassis-volume binding or not
@property {string} chassis.dir - chassis dir, located on rootfs/emmc or a separate partition
@property {string} chassis.tmpDir - chassis tmp dir, localted on the same file system with dir
@property {object} storage - storage configuration
@property {string} storage.fruitmixDir - fruitmix directory path relative to volume mountpoint.
@property {string} storage.volumeDir - absolute dir path where volumes mount points are created.
@property {string} storage.nonVolumeDir - absolute dir path where non volume mount points are created. 
@property {string[] } storage.userProps - user props returned to client when probing fruitmix
*/


/** 
configuration for wisnuc devices
@constant {Configuration} 
*/
const wisnuc = {
  chassis: {
    userBinding: true,
    volumeBinding: true,
    dir: '/etc/wisnuc',
    tmpDir: '/etc/wisnuc/atmp',
    dTmpDir: '/etc/wisnuc/dtmp',
    slots: '/etc/wisnuc/slots'
  },
  storage: {
    fruitmixDir: 'wisnuc/fruitmix',
    volumeDir: '/run/wisnuc/volumes',
    nonVolumeDir: '/run/wisnuc/blocks',
    userProps: ['uuid', 'username', 'isFirstUser', 'winasUserId' ]
  },
  tag: {
    isPrivate: false,
    visibleInPublicDrive: true,
  },
  smbAutoStart: false,
  dlnaAutoStart: false
}

/** 
configuration for winas devices
@constant {Configuration} 
*/
const winas = {
  chassis: {
    userBinding: false,
    volumeBinding: true,
    dir: '/etc/winas',
    tmpDir: '/etc/winas/atmp',
    dTmpDir: '/etc/winas/dtmp',
    slots: '/etc/winas/slots'
  },
  storage: {
    fruitmixDir: 'winas/fruitmix',
    volumeDir: '/run/winas/volumes',
    nonVolumeDir: '/run/winas/blocks',
    userProps: ['uuid', 'username', 'isFirstUser', 'winasUserId' ]
  },
  tag: {
    isPrivate: false,
    visibleInPublicDrive: true,
  },
  smbAutoStart: false,
  dlnaAutoStart: false
}

/**
configuration for phicomm n2
@constant {Configuration}
*/
const n2 = {
  chassis: {
    userBinding: true,
    volumeBinding: true,
    dir: '/mnt/reserved/userdata/phicomm',
    tmpDir: '/mnt/reserved/userdata/phicomm/atmp',
    dTmpDir: '/mnt/reserved/userdata/phicomm/dtmp',
    slots: '/phi/slots'
  },
  storage: {
    fruitmixDir: 'phicomm/n2',
    volumeDir: '/run/phicomm/volumes',
    nonVolumeDir: '/run/phicomm/blocks',
    userProps: ['uuid', 'username', 'isFirstUser', 'phicommUserId']
  },
  slots: ['ata1', 'ata2'],
  tag: {
    isPrivate: true,
    visibleInPublicDrive: false
  },
  alternativeUserId: ['phicommUserId'],
  smbAutoStart: true,
  dlnaAutoStart: true
}


module.exports = {
  wisnuc: {
    default: wisnuc,
    winas: winas
  },
  phicomm: {
    n2
  }
}

