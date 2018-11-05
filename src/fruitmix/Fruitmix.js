const Promise = require('bluebird')
const path = require('path')
const fs = Promise.promisifyAll(require('fs'))
const child = require('child_process')
const EventEmitter = require('events')
const crypto = require('crypto')

const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const mkdirpAsync = Promise.promisify(mkdirp)
const rimrafAsync = Promise.promisify(rimraf)

const UUID = require('uuid')

const User = require('./User')
const Drive = require('./Drive')
const MediaMap = require('../media/persistent')
const Thumbnail = require('./Thumbnail')
const VFS = require('./VFS')
const NFS = require('./NFS')
const Tag = require('../tags/Tag')
const DirApi = require('./apis/dir')
const DirEntryApi = require('./apis/dir-entry')
const DirStatsApi = require('./apis/dir-stats')
const FileApi = require('./apis/file')
const MediaApi = require('./apis/media')
const StatsApi = require('./apis/stats')
const Task = require('./Task')
const Samba = require('../samba/samba')
const Dlna = require('../samba/dlna')
const Transmission = require('../transmission/manager')

/**
Fruitmix is the top-level container for all modules inside fruitmix fs service.

Fruitmix has the following structure:

```
{
  user,
  drive,
  tag,

  xstat,
  mediaMap,
  forest,
  vfs,

  xcopy,
  search,

  transmission,
  samba,
  dlna,

  apis: {
    user,
    drive,
    tag,
    dir,
    dirEntry,
    file,
    media,
    task,
    taskNode,
    nfs
  }
}
```

1. we define a set of standard api methods.
2. developer can write a separate api module, or just implements those apis on the resource model module.

For example: user module provides apis. so fruitmix.user and fruitmix.apis.user are the same instance.

but for directories and files api, it is obviously that the separate api module should be created. Both depends on VFS module.

Fruitmix has no knowledge of chassis, storage, etc.
*/
class Fruitmix extends EventEmitter {
  /**
  @param {object} opts
  @param {string} opts.fruitmixDir - absolute path
  @param {boolean} opts.useSmb - use samba module
  @param {boolean} opts.useDlna - use dlna module
  @param {boolean} opts.useTransmission - use transmission module
  @param {object} [opts.boundUser] - if provided, the admin is forcefully updated
  @param {object} [opts.boundVolume] - required by nfs. If not provided, nfs is not constructed.
  */
  constructor (opts) {
    super()
    this.fruitmixDir = opts.fruitmixDir
    mkdirp.sync(this.fruitmixDir)

    this.tmpDir = path.join(this.fruitmixDir, 'tmp')
    rimraf.sync(this.tmpDir)
    mkdirp.sync(this.tmpDir)

    this.boundUser = opts.boundUser
    this.boundVolume = opts.boundVolume
    this.ejectHandler = opts.ejectHandler

    // setup user module
    this.user = new User({
      boundVolumeId: this.boundVolume && this.boundVolume.id || undefined,
      file: path.join(this.fruitmixDir, 'users.json'),
      tmpDir: path.join(this.fruitmixDir, 'tmp', 'users'),
      chassisFile: path.join(this.fruitmixDir, 'boundVolumes.json'),
      chassisTmpDir: path.join(this.fruitmixDir, 'tmp', 'boundVolumes'),
      isArray: true,
      cloudConf: opts.cloudConf
    })

    // set a getter method for this.users
    Object.defineProperty(this, 'users', {
      get () {
        return this.user.users || [] // TODO can this be undefined?
      }
    })

    if (this.boundUser) {
      this.user.bindFirstUser(this.boundUser)
    }

    this.drive = new Drive({
      file: path.join(this.fruitmixDir, 'drives.json'),
      tmpDir: path.join(this.fruitmixDir, 'tmp', 'drives')
    }, this.user)

    Object.defineProperty(this, 'drives', {
      get () {
        return this.drive.drives || [] // TODO can this be undefined?
      }
    })

    this.tag = new Tag({
      file: path.join(this.fruitmixDir, 'tags.json'),
      tmpDir: path.join(this.fruitmixDir, 'tmp', 'tags'),
      isArray: false
    })

    let metaPath = path.join(this.fruitmixDir, 'metadataDB.json')
    this.mediaMap = new MediaMap(metaPath, this.tmpDir) // TODO suffix tmpdir ?

    let vfsOpts = {
      fruitmixDir: this.fruitmixDir,
      mediaMap: this.mediaMap
    }
    this.vfs = new VFS(vfsOpts, this.user, this.drive, this.tag)

    // dir & dirEntry api
    this.dirApi = new DirApi(this.vfs)
    this.dirEntryApi = new DirEntryApi(this.vfs)
    this.dirStatsApi = new DirStatsApi(this.vfs)

    // file api
    this.fileApi = new FileApi(this.vfs)

    // media api
    this.thumbnail = new Thumbnail(path.join(this.fruitmixDir, 'thumbnail'), this.tmpDir)
    this.mediaApi = new MediaApi(this.vfs, this.thumbnail)

    this.statsApi = new StatsApi(this.vfs)

    this.apis = {
      user: this.user,
      drive: this.drive,
      tag: this.tag,
      dir: this.dirApi,
      dirEntry: this.dirEntryApi,
      dirStats: this.dirStatsApi,
      file: this.fileApi,
      media: this.mediaApi,
      stats: this.statsApi,
    }

    // 绑定transmission
    if (opts.useTransmission) {
      // create Transmission directories
      let transmissionPath = path.join(this.fruitmixDir, 'transmission')
      let torrentTmp = path.join(transmissionPath, 'torrents')
      mkdirp.sync(transmissionPath)
      mkdirp.sync(torrentTmp)
      
      this.transmission = new Transmission({
        path: transmissionPath
      }, this.user, this.drive, this.vfs)

      this.apis.transmission = this.transmission
    }

    // nfs api is optional
/**
    if (this.boundVolume) {
      this.nfs = new NFS({ volumeUUID: this.boundVolume.uuid }, this.user)
      this.apis.nfs = this.nfs
    }
**/

    let nfsOpts = {}
    if (this.boundVolume) nfsOpts.volumeUUID = this.boundVolume.uuid
    if (this.ejectHandler) nfsOpts.ejectHandler = this.ejectHandler
    this.nfs = new NFS(nfsOpts, this.user)
    this.apis.nfs = this.nfs


    // task
    this.task = new Task(this.vfs, this.nfs)
    Object.assign(this.apis, { task: this.task, taskNode: this.task.nodeApi })

    this.user.on('Update', () => {
      process.send && process.send(JSON.stringify({
        type: 'appifi_users',
        users: this.users
          .filter(x => x.status === 'ACTIVE')
          .map(u => { return { uuid: u.uuid, winasUserId: u.winasUserId }})
      }))
      this.emit('FruitmixStarted')
    })

    if (opts.useSmb) {
      this.samba = new Samba(opts, this.user, this.drive, this.vfs, this.nfs)
      this.apis.samba = this.samba
    }

    if (opts.useDlna) {
      this.dlna = new Dlna(opts, this.user, this.drive, this.vfs)
      this.apis.dlna = this.dlna
    }

  }

  init (opts) {
    this.emit('initialized')
  }

  /**
   * get userinfo by phicommUserId
   * @param {string} phicommUserId - uuid
   * @return {object} user - return active user
   */
  getUserByPhicommUserId (phicommUserId) {
    for (const u of this.users) {
      if (phicommUserId === u.phicommUserId && u.status === 'ACTIVE') {
        return {
          uuid: u.uuid,
          username: u.username,
          isFirstUser: u.isFirstUser,
          phicommUserId: u.phicommUserId
        }
      }
    }
  }

  getUserByWinasUserId (winasUserId) {
    for (const u of this.users) {
      if (winasUserId === u.winasUserId && u.status === 'ACTIVE') {
        return {
          uuid: u.uuid,
          username: u.username,
          isFirstUser: u.isFirstUser,
          winasUserId: u.winasUserId
        }
      }
    }
  }

  /**
  */
  getUsers () {
    return this.users.map(u => ({
      uuid: u.uuid,
      username: u.username,
      isFirstUser: u.isFirstUser,
      phicommUserId: u.phicommUserId,
      password: !!u.password,
      smbPassword: !!u.smbPassword,
      winasUserId: u.winasUserId
    }))
  }

  /**
  This function returns a list of users with minimal attributes.
  */
  displayUsers () {
    return this.users.map(u => ({
      uuid: u.uuid,
      username: u.username,
      isFirstUser: u.isFirstUser,
      phicommUserId: u.phicommUserId,
      winasUserId: u.winasUserId
    }))
  }

  setStorage (storage) {
    if (this.nfs) this.nfs.update(storage)
  }

  bindFirstUser (boundUser) {
    this.user.bindFirstUser(boundUser)
  }
}

module.exports = Fruitmix
